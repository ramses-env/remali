"""El ciclo de vida de la factura: nace vigente, se cancela, se refactura."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from facturacion.models import Factura, SolicitudFactura
from facturacion.tests_cfdi import cfdi_xml
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        email='jazmin@correo.mx',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


class CicloDeLaFacturaTest(TestCase):

    def test_nace_vigente(self):
        f = Factura.objects.create(
            solicitud=solicitud(), xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
            total=Decimal('2000.00'),
        )
        self.assertEqual(f.estado, 'vigente')

    def test_el_uuid_no_se_repite(self):
        """El mismo XML subido dos veces es el error silencioso más probable."""
        uuid = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'
        Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)
        with self.assertRaises(Exception):
            Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)


class DescargarXMLTest(TestCase):

    def setUp(self):
        U = get_user_model()
        self.admin = U.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.comprador = U.objects.create_user('jazmin', 'j@x.com', 'pass12345')
        self.ajeno = U.objects.create_user('otro', 'o@x.com', 'pass12345')
        equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('2000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='nueva')
        venta = Venta.objects.create(
            nombre_cliente='Jazmín', inventario=unidad,
            precio_maquina=Decimal('2000'), cliente_usuario=self.comprador,
        )
        self.xml = cfdi_xml()
        self.factura = Factura.objects.create(
            solicitud=solicitud(venta=venta), xml=self.xml,
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )
        self.client = APIClient()

    def _bajar(self, quien):
        self.client.force_authenticate(quien)
        return self.client.get(f'/api/facturacion/facturas/{self.factura.id}/xml/')

    def test_el_comprador_baja_su_xml_intacto(self):
        r = self._bajar(self.comprador)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content.decode(), self.xml)

    def test_administracion_tambien(self):
        self.assertEqual(self._bajar(self.admin).status_code, 200)

    def test_otro_cliente_no_puede(self):
        """La prueba más importante: son los datos fiscales de una empresa."""
        self.assertEqual(self._bajar(self.ajeno).status_code, 404)

    def test_sin_sesion_tampoco(self):
        r = self.client.get(f'/api/facturacion/facturas/{self.factura.id}/xml/')
        self.assertIn(r.status_code, (401, 403))


class CancelarYRefacturarTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.sol = solicitud(estado='facturada', uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.factura = Factura.objects.create(
            solicitud=self.sol, xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )

    def _cancelar(self, motivo='Datos fiscales equivocados'):
        return self.client.post(
            f'/api/facturacion/facturas/{self.factura.id}/cancelar/',
            {'motivo': motivo}, format='json',
        )

    def test_cancelar_regresa_la_solicitud_a_pendiente(self):
        """Si no, la cancelación se vuelve una factura que nadie reemitió."""
        self.assertEqual(self._cancelar().status_code, 200)
        self.factura.refresh_from_db()
        self.sol.refresh_from_db()
        self.assertEqual(self.factura.estado, 'cancelada')
        self.assertEqual(self.sol.estado, 'pendiente')
        self.assertEqual(self.sol.uuid, '')

    def test_la_cancelada_se_conserva(self):
        self._cancelar()
        self.assertEqual(Factura.objects.count(), 1)
        self.assertEqual(self.factura.solicitud.facturas.count(), 1)

    def test_exige_motivo(self):
        self.assertEqual(self._cancelar(motivo='').status_code, 400)

    def test_no_se_cancela_dos_veces(self):
        self._cancelar()
        self.assertEqual(self._cancelar().status_code, 409)

    def test_refacturar_deja_las_dos_ligadas(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from facturacion.tests_cfdi import cfdi_xml
        from maquinaria.models import ConfiguracionSitio

        cfg = ConfiguracionSitio.objects.first() or ConfiguracionSitio.objects.create()
        cfg.negocio_rfc = 'REM010101AAA'
        cfg.save()
        self._cancelar()

        nuevo = cfdi_xml(folio='124').replace(
            'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
            'F9E8D7C6-B5A4-4321-9876-543210FEDCBA',
        )
        r = self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/factura/',
            {'xml': SimpleUploadedFile('n.xml', nuevo.encode(), 'text/xml')},
            format='multipart',
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.facturas.count(), 2)
        self.assertEqual(self.sol.facturas.filter(estado='vigente').count(), 1)
        self.assertEqual(self.sol.estado, 'facturada')
