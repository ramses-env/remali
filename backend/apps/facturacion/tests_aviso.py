"""Al marcar una solicitud como facturada, el cliente se entera.

Es lo único que el cliente necesita saber: pidió factura y ya está. El XML y el
PDF se los manda administración por fuera, así que el aviso NO promete un
archivo que el sistema no tiene.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from facturacion.models import SolicitudFactura
from inventario.models import Inventario
from maquinaria.models import Equipo, Notificacion
from ventas.models import Venta


class AvisoDeFacturaTest(TestCase):

    def setUp(self):
        U = get_user_model()
        self.admin = U.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.comprador = U.objects.create_user('jazmin', 'j@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('2000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='nueva')
        self.venta = Venta.objects.create(
            nombre_cliente='Jazmín', inventario=unidad,
            precio_maquina=Decimal('2000'), cliente_usuario=self.comprador,
        )
        self.sol = SolicitudFactura.objects.create(
            tipo='venta', venta=self.venta, rfc='MEJJ800101ABC',
            razon_social='Jazmín Mendoza', total=Decimal('2000.00'),
        )

    def _facturar(self, uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'):
        return self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/facturada/',
            {'uuid': uuid}, format='json',
        )

    def test_marcar_facturada_avisa_al_comprador(self):
        r = self._facturar()
        self.assertEqual(r.status_code, 200, r.data)
        aviso = Notificacion.objects.filter(usuario=self.comprador).first()
        self.assertIsNotNone(aviso, 'el cliente no recibió aviso')
        self.assertIn('facturada', aviso.titulo.lower())

    def test_el_aviso_es_personal_y_no_del_tablero(self):
        """Va a SU buzón, no al broadcast del panel: es de su compra."""
        self._facturar()
        self.assertEqual(Notificacion.objects.filter(usuario__isnull=True).count(), 0)

    def test_no_se_repite_si_se_reabre_y_se_vuelve_a_marcar(self):
        self._facturar()
        self.client.post(f'/api/facturacion/solicitudes/{self.sol.id}/reabrir/', {}, format='json')
        self._facturar()
        self.assertEqual(Notificacion.objects.filter(usuario=self.comprador).count(), 1)

    def test_una_venta_sin_cuenta_no_inventa_destinatario(self):
        self.venta.cliente_usuario = None
        self.venta.save(update_fields=['cliente_usuario'])
        r = self._facturar()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Notificacion.objects.count(), 0)

    def test_marcar_facturada_sigue_pidiendo_el_folio_fiscal(self):
        """El comportamiento de antes se conserva tal cual."""
        r = self._facturar(uuid='')
        self.assertEqual(r.status_code, 400)
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.estado, 'pendiente')


class FolioFiscalTest(TestCase):
    """El UUID es el único hilo entre la venta y el CFDI del SAT.

    Si entra mal escrito o repetido, la solicitud queda "facturada" apuntando a
    nada (o dos ventas apuntando al mismo CFDI) y nadie se entera hasta que el
    contador reclama.
    """

    def setUp(self):
        U = get_user_model()
        self.client = APIClient()
        self.client.force_authenticate(U.objects.create_superuser('duena2', 'd2@x.com', 'pass12345'))
        self.a = SolicitudFactura.objects.create(tipo='venta', rfc='AAA010101AAA', total=Decimal('100'))
        self.b = SolicitudFactura.objects.create(tipo='venta', rfc='BBB010101BBB', total=Decimal('200'))

    def _marcar(self, sol, uuid):
        return self.client.post(f'/api/facturacion/solicitudes/{sol.id}/facturada/', {'uuid': uuid}, format='json')

    def test_un_folio_mal_escrito_no_pasa(self):
        r = self._marcar(self.a, 'no-es-un-uuid')
        self.assertEqual(r.status_code, 400)
        self.a.refresh_from_db()
        self.assertEqual(self.a.estado, 'pendiente')

    def test_el_folio_se_guarda_en_mayusculas(self):
        r = self._marcar(self.a, ' 3f2504e0-4f89-11d3-9a0c-0305e82c3301 ')
        self.assertEqual(r.status_code, 200, r.data)
        self.a.refresh_from_db()
        self.assertEqual(self.a.uuid, '3F2504E0-4F89-11D3-9A0C-0305E82C3301')

    def test_el_mismo_cfdi_no_factura_dos_ventas(self):
        uuid = '3F2504E0-4F89-11D3-9A0C-0305E82C3301'
        self.assertEqual(self._marcar(self.a, uuid).status_code, 200)
        r = self._marcar(self.b, uuid)
        self.assertEqual(r.status_code, 409)
        self.b.refresh_from_db()
        self.assertEqual(self.b.estado, 'pendiente')

    def test_un_numero_en_un_campo_de_texto_no_tumba_la_peticion(self):
        """El cuerpo es JSON: que llegue un número donde va texto es un 400/200, no un 500."""
        r = self.client.patch(f'/api/facturacion/solicitudes/{self.a.id}/', {'rfc': 12345}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.a.refresh_from_db()
        self.assertEqual(self.a.rfc, '12345')
