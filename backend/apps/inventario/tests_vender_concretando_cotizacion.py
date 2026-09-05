"""Vender una unidad concretando una cotización, igual que se concreta una renta.

La venta desde una cotización se resolvía dentro del modal de cotizaciones, con
una cadena de ventanitas y sin ver el inventario. Ahora es el reflejo de la
renta: la cotización te manda a Inventario filtrado a lo que pidió el cliente,
eliges la unidad y la hoja de venta llega precargada mandando `cotizacion_id`.

Este camino ya existía en el backend pero nadie lo usaba desde el panel, así que
no tenía red. Se prueba lo que la hoja depende de: que la venta quede ligada,
que la máquina salga del patio, y que el servidor siga rechazando las
combinaciones que la hoja no debería permitir.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


class VenderConcretandoCotizacionTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.comprador = get_user_model().objects.create_user('cliente', 'c@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='GEN-100', precio_venta=Decimal('2000'))
        # Nueva a propósito: es la condición que más se vende, y la que el
        # filtro de "solo rentables" esconde. Si el panel la ocultara al venir
        # de una cotización, esta venta no se podría hacer desde el panel.
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.cot = Cotizacion.objects.create(
            tipo='venta', estado='aceptada', usuario=self.comprador,
            cliente_nombre='Jazmín Mendoza', cliente_telefono='6141234567',
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Generador de luz · venta',
            modalidad='venta', equipo=self.equipo, cantidad=1,
            precio_unitario=Decimal('2000'),
        )
        self.cot.refresh_from_db()

    def _vender(self, **extra):
        cuerpo = {
            'nombre_cliente': 'Jazmín Mendoza', 'telefono_cliente': '6141234567',
            'metodo_pago': 'efectivo', 'total': 2000,
            'cotizacion_id': self.cot.id,
        }
        cuerpo.update(extra)
        return self.client.post(f'/api/unidades/{self.unidad.id}/vender/', cuerpo, format='json')

    def test_la_venta_queda_ligada_a_la_cotizacion(self):
        resp = self._vender()
        self.assertIn(resp.status_code, (200, 201), resp.data)
        venta = Venta.objects.get()
        self.assertEqual(venta.cotizacion_id, self.cot.id)
        self.assertEqual(venta.total, Decimal('2000.00'))

    def test_el_comprador_la_ve_en_sus_compras(self):
        """La cotización la pidió una cuenta: la venta se le queda a esa cuenta."""
        self._vender()
        self.assertEqual(Venta.objects.get().cliente_usuario_id, self.comprador.id)

    def test_la_maquina_sale_del_patio(self):
        self._vender()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')

    def test_una_unidad_de_otro_equipo_se_rechaza(self):
        """El filtro del panel ya la esconde; el servidor no se confía de eso."""
        otro = Equipo.objects.create(modelo='COMP-50', precio_venta=Decimal('900'))
        ajena = Inventario.objects.create(equipo=otro, condicion='nueva')
        resp = self.client.post(f'/api/unidades/{ajena.id}/vender/', {
            'metodo_pago': 'efectivo', 'total': 900, 'cotizacion_id': self.cot.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('no coincide', resp.data['detalle'])
        self.assertFalse(Venta.objects.exists())

    def test_no_se_concreta_dos_veces(self):
        """El puente vive en sessionStorage: una pestaña vieja puede reintentar."""
        self._vender()
        otra = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        resp = self.client.post(f'/api/unidades/{otra.id}/vender/', {
            'metodo_pago': 'efectivo', 'total': 2000, 'cotizacion_id': self.cot.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('ya se convirtió', resp.data['detalle'])
        self.assertEqual(Venta.objects.count(), 1)

    def test_una_cotizacion_no_aceptada_no_se_concreta(self):
        self.cot.estado = 'enviada'
        self.cot.save(update_fields=['estado'])
        resp = self._vender()
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Venta.objects.exists())

    def test_vender_sin_cotizacion_sigue_igual(self):
        """La hoja manda `cotizacion_id` solo cuando viene de una cotización."""
        resp = self.client.post(f'/api/unidades/{self.unidad.id}/vender/', {
            'nombre_cliente': 'Mostrador', 'metodo_pago': 'efectivo', 'total': 2000,
        }, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        self.assertIsNone(Venta.objects.get().cotizacion_id)
