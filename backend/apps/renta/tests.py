from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from maquinaria.models import Equipo, Tipo
from inventario.models import Inventario
from renta.models import Renta


class RentaFlowTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='tester', password='pass12345', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.tipo = Tipo.objects.create(nombre='REV')
        self.equipo = Equipo.objects.create(
            modelo='REV-1000', tipo=self.tipo,
            precio_dia=Decimal('100'), precio_semana=Decimal('600'), precio_mes=Decimal('2000'),
            precio_venta=Decimal('50000'),
        )
        self.inv = Inventario.objects.create(
            equipo=self.equipo, condicion='seminueva', estado='disponible'
        )

    def test_crear_renta_calcula_dinero_y_ocupa_unidad(self):
        resp = self.client.post(reverse('crear_renta'), {
            'inventario_id': self.inv.id, 'modalidad': 'dia',
            'duracion': 3, 'direccion': 'Obra Centro 123',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        renta = resp.data['renta']
        self.assertEqual(renta['estado'], 'activa')
        self.assertEqual(Decimal(renta['total']), Decimal('300.00'))  # 100 x 3 días
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'rentado')

    def test_devolver_tarde_NO_genera_recargo(self):
        """REMALI no cobra por tardarse: el retraso no cambia lo que se debe.

        Se cobraba solo (`tarifa_diaria × días`) y nadie lo había pedido. Lo que
        sustituye al recargo son los recordatorios (`recordar_rentas`): en vez de
        cobrarle por tardarse, no se le deja olvidar. La máquina se devuelve
        igual y la unidad se libera igual.
        """
        r = Renta.objects.create(
            inventario=self.inv, modalidad='dia', duracion=2, direccion='Obra Norte'
        )
        self.assertEqual(r.total, Decimal('200.00'))
        r.finalizar(fecha_devolucion=r.fecha_fin + timedelta(days=2))
        self.assertEqual(r.recargo, Decimal('0.00'))
        self.assertEqual(r.total, Decimal('200.00'))     # intacto
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'disponible')
        self.assertIsNotNone(r.fecha_devolucion_real)

    def test_reserva_futura_no_ocupa_unidad(self):
        futuro = (timezone.localdate() + timedelta(days=5)).isoformat()
        resp = self.client.post(reverse('crear_renta'), {
            'inventario_id': self.inv.id, 'modalidad': 'semana',
            'duracion': 1, 'direccion': 'Obra Sur', 'fecha_inicio': futuro,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['renta']['estado'], 'reservada')
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'disponible')  # la reserva NO ocupa todavía

    def test_no_permite_traslape(self):
        resp = self.client.post(reverse('crear_renta'), {
            'inventario_id': self.inv.id, 'modalidad': 'dia',
            'duracion': 3, 'direccion': 'Obra 1',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        resp2 = self.client.post(reverse('crear_renta'), {
            'inventario_id': self.inv.id, 'modalidad': 'dia',
            'duracion': 3, 'direccion': 'Obra 2',
        }, format='json')
        self.assertEqual(resp2.status_code, 400)

    def test_cancelar_libera_unidad(self):
        # Cancelar es acción sensible: exige el PIN personal del operador.
        from maquinaria.seguridad import definir_codigo
        definir_codigo(self.user, '123456')

        r = Renta.objects.create(
            inventario=self.inv, modalidad='dia', duracion=1, direccion='Obra X'
        )
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'rentado')
        resp = self.client.post(reverse('cancelar_renta', args=[r.id]),
                                {'codigo_seguridad': '123456'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.estado, 'disponible')

    def test_unidad_nueva_no_se_renta(self):
        nueva = Inventario.objects.create(equipo=self.equipo, condicion='nueva', estado='disponible')
        resp = self.client.post(reverse('crear_renta'), {
            'inventario_id': nueva.id, 'modalidad': 'dia',
            'duracion': 1, 'direccion': 'Obra Z',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
