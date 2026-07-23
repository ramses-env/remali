from django.test import TestCase

from maquinaria.models import Equipo
from inventario.models import Inventario


class InventarioEstadoTest(TestCase):
    def setUp(self):
        self.equipo = Equipo.objects.create(modelo='GEN-100')

    def test_codigo_automatico(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.assertTrue(u.codigo.startswith('GEN-'))

    def test_ocupar_y_liberar(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')
        u.ocupar_por_renta('Obra 1')
        self.assertEqual(u.estado, 'rentado')
        self.assertEqual(u.ubicacion_actual, 'Obra 1')
        u.liberar()
        self.assertEqual(u.estado, 'disponible')
        self.assertEqual(u.ubicacion_actual, 'Bodega')

    def test_no_ocupar_si_no_disponible(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='mantenimiento')
        with self.assertRaises(ValueError):
            u.ocupar_por_renta()

    def test_mantenimiento_ida_vuelta(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')
        u.enviar_mantenimiento()
        self.assertEqual(u.estado, 'mantenimiento')
        self.assertEqual(u.ubicacion_actual, 'Taller')
        u.salir_mantenimiento()
        self.assertEqual(u.estado, 'disponible')

    def test_nueva_no_se_renta(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='nueva', estado='disponible')
        self.assertFalse(u.puede_rentarse())
        self.assertTrue(u.puede_venderse())
