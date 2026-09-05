"""Una cotización se concreta UNA sola vez.

El botón "Concretar renta" del panel desaparece cuando la cotización ya tiene
renta, pero eso es maquillaje: basta una pestaña vieja, dos personas trabajando
a la vez, o el puente guardado en sessionStorage de otra pestaña, para que se
cree una SEGUNDA renta colgada de la misma cotización. Entonces el cliente tiene
una máquina en la obra y REMALI dos rentas cobrándole.

El candado tiene que estar donde no se puede esquivar: en el servidor.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem
from inventario.models import Inventario
from maquinaria.models import Equipo, Tipo
from renta.models import Renta


class CotizacionSeConcretaUnaVezTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='op', password='pass12345', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.tipo = Tipo.objects.create(nombre='REV')
        self.equipo = Equipo.objects.create(
            modelo='REV-1000', tipo=self.tipo,
            precio_dia=Decimal('100'), precio_semana=Decimal('600'), precio_mes=Decimal('2000'),
        )
        self.inv1 = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')
        self.inv2 = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')

        self.cot = Cotizacion.objects.create(tipo='renta', estado='aceptada', aplica_iva=False)
        CotizacionItem.objects.create(cotizacion=self.cot, descripcion='REV-1000 · renta por día',
                                      cantidad=1, duracion=3, precio_unitario=Decimal('100'),
                                      equipo=self.equipo, modalidad='dia')

    def _concretar(self, inventario):
        return self.client.post(reverse('crear_renta'), {
            'inventario_id': inventario.id, 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Obra Centro 123', 'cotizacion_id': self.cot.id,
        }, format='json')

    def test_la_segunda_vez_se_rechaza(self):
        primera = self._concretar(self.inv1)
        self.assertEqual(primera.status_code, 201, primera.data)

        segunda = self._concretar(self.inv2)
        self.assertEqual(segunda.status_code, 409, segunda.data)
        self.assertEqual(segunda.data['codigo'], 'ya_concretada')
        # Y no se creó nada: ni la renta, ni se ocupó la segunda unidad.
        self.assertEqual(Renta.objects.filter(cotizacion=self.cot).count(), 1)
        self.inv2.refresh_from_db()
        self.assertEqual(self.inv2.estado, 'disponible')

    def test_el_mensaje_dice_cuál_renta_ya_existe(self):
        """El admin necesita poder ir a verla, no solo enterarse de que no puede."""
        self._concretar(self.inv1)
        renta = Renta.objects.get(cotizacion=self.cot)
        r = self._concretar(self.inv2)
        self.assertIn(str(renta.id), r.data['detalle'])
        self.assertEqual(r.data['renta_id'], renta.id)

    def test_si_la_renta_se_canceló_sí_se_puede_de_nuevo(self):
        """Una renta cancelada no es una renta: el trato se cayó y hay que rehacerlo."""
        self._concretar(self.inv1)
        Renta.objects.filter(cotizacion=self.cot).update(estado='cancelada')
        r = self._concretar(self.inv2)
        self.assertEqual(r.status_code, 201, r.data)

    def test_sin_cotizacion_no_estorba(self):
        """La renta de mostrador, sin cotización de por medio, sigue igual."""
        r = self.client.post(reverse('crear_renta'), {
            'inventario_id': self.inv1.id, 'modalidad': 'dia', 'duracion': 1,
            'direccion': 'Obra Sur',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)


class CotizacionConcretadaEsSoloLecturaTest(TestCase):
    """El hermano del mismo problema: la cotización sigue editable después.

    `_bloqueada_si_convertida` solo miraba las VENTAS, así que a una cotización
    de renta ya concretada se le podía cambiar el equipo por API — con la
    máquina ya en la obra.
    """

    def setUp(self):
        self.user = User.objects.create_user(username='admin2', password='pass12345',
                                             is_staff=True, is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.equipo = Equipo.objects.create(modelo='REV-2000', precio_dia=Decimal('150'))
        self.inv = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')
        self.cot = Cotizacion.objects.create(tipo='renta', estado='aceptada', aplica_iva=False)
        self.item = CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='REV-2000 · renta por día', cantidad=1, duracion=2,
            precio_unitario=Decimal('150'), equipo=self.equipo, modalidad='dia')
        Renta.objects.create(inventario=self.inv, modalidad='dia', duracion=2,
                             direccion='Obra Norte', cotizacion=self.cot)

    def test_no_se_le_agregan_partidas(self):
        r = self.client.post(f'/api/cotizaciones/{self.cot.id}/items/',
                             {'descripcion': 'Otro equipo', 'cantidad': 1,
                              'precio_unitario': '500', 'modalidad': 'dia'}, format='json')
        self.assertEqual(r.status_code, 409, r.data)

    def test_no_se_le_cambia_el_equipo_a_una_partida(self):
        r = self.client.patch(f'/api/cotizaciones/{self.cot.id}/items/{self.item.id}/',
                              {'cantidad': 9}, format='json')
        self.assertEqual(r.status_code, 409, r.data)
        self.item.refresh_from_db()
        self.assertEqual(self.item.cantidad, 1)

    def test_la_entrega_prometida_sí_se_puede_mover(self):
        """La logística sigue viva: cambiar la fecha no toca montos ni partidas."""
        r = self.client.patch(f'/api/cotizaciones/{self.cot.id}/',
                              {'entrega_prometida': '2026-09-01T10:00:00Z'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

    def test_una_cotizacion_de_renta_no_se_convierte_en_venta(self):
        """Red de seguridad del botón que mentía.

        El pie decía "Ver ticket" pero llamaba a convertir: con una cotización
        de renta el atajo idempotente no aplica (no hay venta_id), así que caía
        en el diálogo "Convertir en venta". El servidor lo rechaza porque no hay
        partidas de venta — nunca hubo riesgo de cobrar dos veces— pero conviene
        que quede fijado, porque es lo único que separaba al usuario de un
        diálogo sin sentido de una venta duplicada.
        """
        from ventas.models import Venta
        r = self.client.post(f'/api/cotizaciones/{self.cot.id}/convertir/',
                             {'metodo_pago': 'efectivo'}, format='json')
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn('partidas de venta', r.data['detalle'])
        self.assertEqual(Venta.objects.filter(cotizacion=self.cot).count(), 0)
