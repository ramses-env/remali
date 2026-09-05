from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem
from maquinaria.models import Equipo
from inventario.models import Inventario
from ventas.models import Venta


class VentaMaquinaTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='vendedor', password='pass12345', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.equipo = Equipo.objects.create(modelo='EXC-200', precio_venta=Decimal('50000'))
        self.inv = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')

    def test_vender_desglosa_iva_y_marca_vendido(self):
        resp = self.client.post(f'/api/unidades/{self.inv.id}/vender/', {
            'nombre_cliente': 'Constructora ABC', 'total': '50000',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = resp.data['venta']
        self.assertEqual(Decimal(venta['total']), Decimal('50000.00'))
        self.assertEqual(Decimal(venta['subtotal']), Decimal('43103.45'))
        self.assertEqual(Decimal(venta['iva']), Decimal('6896.55'))
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'vendido')

    def test_no_vende_en_cero(self):
        eq = Equipo.objects.create(modelo='SINPRECIO')  # sin precio_venta
        inv = Inventario.objects.create(equipo=eq, condicion='seminueva', estado='disponible')
        resp = self.client.post(f'/api/unidades/{inv.id}/vender/', {'nombre_cliente': 'X'}, format='json')
        self.assertEqual(resp.status_code, 400)
        inv.refresh_from_db()
        self.assertEqual(inv.estado, 'disponible')  # no se vendió

    def test_cancelar_venta_devuelve_maquina(self):
        # Cancelar es acción sensible: exige el PIN personal del operador.
        from maquinaria.seguridad import definir_codigo
        definir_codigo(self.user, '123456')

        v = Venta.objects.create(nombre_cliente='Cliente', inventario=self.inv, precio_maquina=Decimal('50000'))
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'vendido')
        resp = self.client.post(f'/api/ventas/{v.id}/cancelar/',
                                {'motivo': 'error', 'codigo_seguridad': '123456'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        v.refresh_from_db(); self.inv.refresh_from_db()
        self.assertEqual(v.estado, 'cancelada')
        self.assertEqual(self.inv.estado, 'disponible')


class ConversionCotizacionVentaTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='adminventa', password='pass12345', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.equipo_cotizado = Equipo.objects.create(modelo='MINI-EXC', precio_venta=Decimal('34800'))
        self.equipo_otro = Equipo.objects.create(modelo='RODILLO', precio_venta=Decimal('51000'))
        self.unidad_correcta = Inventario.objects.create(
            equipo=self.equipo_cotizado, condicion='seminueva', estado='disponible'
        )
        self.unidad_incorrecta = Inventario.objects.create(
            equipo=self.equipo_otro, condicion='seminueva', estado='disponible'
        )
        self.cot = Cotizacion.objects.create(
            tipo='venta',
            estado='aceptada',
            cliente_nombre='Cliente Cotizado',
            cliente_telefono='5512345678',
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot,
            descripcion='MINI-EXC · venta',
            cantidad=1,
            precio_unitario=Decimal('34800'),
            equipo=self.equipo_cotizado,
            modalidad='venta',
        )

    def test_convertir_rechaza_unidad_de_otro_equipo(self):
        resp = self.client.post(
            f'/api/cotizaciones/{self.cot.id}/convertir/',
            {'metodo_pago': 'efectivo', 'unidad_ids': [self.unidad_incorrecta.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('no coincide con el equipo cotizado', resp.data['detalle'].lower())
        self.unidad_incorrecta.refresh_from_db()
        self.assertEqual(self.unidad_incorrecta.estado, 'disponible')
        self.assertFalse(Venta.objects.filter(cotizacion=self.cot).exists())

    def test_convertir_con_metodo_simple_sigue_funcionando(self):
        resp = self.client.post(
            f'/api/cotizaciones/{self.cot.id}/convertir/',
            {'metodo_pago': 'transferencia', 'unidad_ids': [self.unidad_correcta.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(venta.metodo_pago, 'transferencia')
        self.assertEqual(venta.pagos, [])
        self.unidad_correcta.refresh_from_db()
        self.assertEqual(self.unidad_correcta.estado, 'vendido')

    def test_vender_unidad_liga_la_cotizacion_desde_inventario(self):
        resp = self.client.post(
            f'/api/unidades/{self.unidad_correcta.id}/vender/',
            {
                'nombre_cliente': 'Cliente Cotizado',
                'telefono_cliente': '5512345678',
                'metodo_pago': 'efectivo',
                'total': '34800',
                'cotizacion_id': self.cot.id,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = Venta.objects.get(pk=resp.data['venta']['id'])
        self.assertEqual(venta.cotizacion_id, self.cot.id)
        self.assertEqual(venta.inventario_id, self.unidad_correcta.id)
