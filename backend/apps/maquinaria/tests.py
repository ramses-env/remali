from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import Equipo
from inventario.models import Inventario


class EquipoPrecioTest(TestCase):
    def setUp(self):
        self.equipo = Equipo.objects.create(
            modelo='CMP-50',
            precio_dia=Decimal('100'),
            precio_semana=Decimal('600'),
            precio_mes=Decimal('2000'),
        )

    def test_get_precio_por_unidad(self):
        self.assertEqual(self.equipo.get_precio_por_unidad('dia'), Decimal('100'))
        self.assertEqual(self.equipo.get_precio_por_unidad('semana'), Decimal('600'))
        self.assertEqual(self.equipo.get_precio_por_unidad('mes'), Decimal('2000'))
        self.assertIsNone(self.equipo.get_precio_por_unidad('inexistente'))

    def test_estado_resumen_sin_unidades(self):
        self.assertEqual(self.equipo.estado_resumen, 'Sin stock')


class EquipoCatalogoInventarioTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.mixto = Equipo.objects.create(
            modelo='APS-200',
            precio_venta=Decimal('24500'),
            precio_dia=Decimal('850'),
        )
        Inventario.objects.create(equipo=self.mixto, condicion='nueva', estado='disponible')
        Inventario.objects.create(equipo=self.mixto, condicion='seminueva', estado='disponible')

        self.solo_renta = Equipo.objects.create(
            modelo='ROD-90',
            precio_dia=Decimal('650'),
        )
        Inventario.objects.create(equipo=self.solo_renta, condicion='seminueva', estado='disponible')

    def test_helpers_de_catalogo_salen_del_inventario(self):
        self.assertEqual(self.mixto.condiciones_catalogo, ['nueva', 'seminueva'])
        self.assertEqual(self.mixto.modos_catalogo, ['venta', 'renta'])
        self.assertTrue(self.mixto.ofrece_venta_catalogo)
        self.assertTrue(self.mixto.ofrece_renta_catalogo)
        self.assertTrue(self.mixto.venta_disponible_catalogo)
        self.assertTrue(self.mixto.renta_disponible_catalogo)

    def test_filtro_publico_venta_sale_por_precio_de_venta(self):
        resp = self.client.get('/api/equipos/?uso=venta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertNotIn('ROD-90', modelos)

    def test_filtro_publico_renta_exige_tarifa_y_unidad_seminueva(self):
        resp = self.client.get('/api/equipos/?uso=renta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertIn('ROD-90', modelos)
