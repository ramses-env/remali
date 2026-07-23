from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

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
        v = Venta.objects.create(nombre_cliente='Cliente', inventario=self.inv, precio_maquina=Decimal('50000'))
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'vendido')
        resp = self.client.post(f'/api/ventas/{v.id}/cancelar/', {'motivo': 'error'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        v.refresh_from_db(); self.inv.refresh_from_db()
        self.assertEqual(v.estado, 'cancelada')
        self.assertEqual(self.inv.estado, 'disponible')
