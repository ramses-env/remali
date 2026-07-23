from decimal import Decimal

from django.test import TestCase

from maquinaria.models import Equipo


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
