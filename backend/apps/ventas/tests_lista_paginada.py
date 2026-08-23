"""La lista de ventas paginada, y los KPIs que dejaron de vivir en el navegador.

La lista crecía sin techo dentro del año: el panel bajaba todas las filas del
periodo con sus máquinas y sus solicitudes de factura precargadas, y de paso
calculaba el monto y el ticket sumando lo que recibía.

Paginar sin mover esas cifras al servidor habría dejado un "Monto total" que
cambia al pasar de página, y un buscador que solo mira la página visible. Estas
pruebas cuidan las tres cosas juntas.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


class ListaDeVentasTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('1000'))
        for i in range(7):
            Venta.objects.create(nombre_cliente=f'Cliente {i}', precio_maquina=Decimal('1000'))

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_pagina_y_dice_cuantas_hay_en_total(self):
        r = self.client.get('/api/ventas/lista/?page=1&page_size=3')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data['ventas']), 3)
        # `total` es cuántas hay en el periodo, no cuántas se mandaron: con la
        # lista paginada, lo segundo no le sirve a nadie.
        self.assertEqual(r.data['total'], 7)
        self.assertEqual(r.data['paginas'], 3)

    def test_la_ultima_pagina_trae_el_resto(self):
        r = self.client.get('/api/ventas/lista/?page=3&page_size=3')
        self.assertEqual(len(r.data['ventas']), 1)

    def test_una_pagina_fuera_de_rango_no_devuelve_vacio(self):
        """Pedir la página 99 de 3 es un enlace viejo, no un error: se acota."""
        r = self.client.get('/api/ventas/lista/?page=99&page_size=3')
        self.assertEqual(r.data['pagina'], 3)
        self.assertEqual(len(r.data['ventas']), 1)

    def test_busca_en_todo_el_periodo_y_no_solo_en_la_pagina(self):
        """La de 'Cliente 6' cae en la última página; el buscador debe hallarla."""
        r = self.client.get('/api/ventas/lista/?q=Cliente 6&page_size=3')
        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['ventas'][0]['nombre_cliente'], 'Cliente 6')

    def test_busca_por_folio(self):
        """Buscar por folio es como el mostrador ubica una venta con el ticket
        en la mano; tiene que funcionar aunque esa venta esté en otra página."""
        venta = Venta.objects.create(nombre_cliente='Zulema', precio_maquina=Decimal('900'))
        self.assertTrue(venta.folio, 'la venta debería nacer con folio')
        r = self.client.get(f'/api/ventas/lista/?q={venta.folio}&page_size=3')
        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['ventas'][0]['folio'], venta.folio)


class KPIsDeVentasTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('1000'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        Venta.objects.create(nombre_cliente='A', precio_maquina=Decimal('1000'))
        Venta.objects.create(nombre_cliente='B', precio_maquina=Decimal('3000'))
        cancelada = Venta.objects.create(nombre_cliente='C', precio_maquina=Decimal('5000'))
        Venta.objects.filter(pk=cancelada.pk).update(estado='cancelada')

    def test_cuenta_todas_las_ventas_del_periodo(self):
        r = self.client.get('/api/ventas/stats/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['total'], 3)
        self.assertEqual(r.data['canceladas'], 1)

    def test_una_cancelada_no_es_dinero(self):
        """El panel las venía sumando: $9,000 de ingreso que nunca entraron."""
        r = self.client.get('/api/ventas/stats/')
        self.assertEqual(Decimal(r.data['total_vendido']), Decimal('4000.00'))

    def test_el_ticket_promedio_tampoco_las_cuenta(self):
        r = self.client.get('/api/ventas/stats/')
        self.assertEqual(Decimal(r.data['ticket']), Decimal('2000.00'))

    def test_sin_ventas_el_ticket_no_divide_entre_cero(self):
        Venta.objects.all().delete()
        r = self.client.get('/api/ventas/stats/')
        self.assertEqual(Decimal(r.data['ticket']), Decimal('0.00'))

    def test_quien_no_ve_dinero_no_recibe_el_monto_ni_en_cero(self):
        """El Gestor es justo este caso: ve la operación y no ve las cuentas.

        Se OMITEN los campos de dinero en vez de mandarlos en cero, porque un
        cero es un dato y el panel lo pintaría como "$0.00 vendido", que es
        falso. Los conteos sí los recibe: son su trabajo.
        """
        from django.contrib.auth.models import Group
        gestor = get_user_model().objects.create_user('gestor', 'g@x.com', 'pass12345')
        # `puede_de` resuelve por NOMBRE de grupo, así que basta con que exista;
        # los roles reales los siembra `init_roles`, que no corre en pruebas.
        gestor.groups.add(Group.objects.get_or_create(name='Gestor')[0])
        self.client.force_authenticate(gestor)
        r = self.client.get('/api/ventas/stats/')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertNotIn('total_vendido', r.data)
        self.assertNotIn('ticket', r.data)
        self.assertEqual(r.data['total'], 3)
