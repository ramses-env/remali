"""El endpoint de conteos del menú del panel.

Existe para que los globitos no obliguen a bajar las listas completas. Lo que se
prueba es justo eso: que responda los números correctos y que lo pueda leer
cualquiera con acceso al panel (son conteos, no dinero).
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import Equipo, Cupon

User = get_user_model()


class ConteosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.duenio = User.objects.create_superuser('jefa', 'jefa@remali.mx', 'x' * 12)
        Equipo.objects.create(modelo='Mezcladora 1 saco', precio_dia=500)
        Equipo.objects.create(modelo='Rompedora eléctrica', precio_dia=800)
        Cupon.objects.create(codigo='BIENVENIDA', descuento=5)

    def test_devuelve_los_numeros_del_menu(self):
        self.client.force_authenticate(self.duenio)
        r = self.client.get('/api/dashboard/conteos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['equipos'], 2)
        self.assertEqual(r.data['cupones'], 1)
        self.assertEqual(r.data['unidades'], 0)
        self.assertEqual(r.data['adeudos'], 0)
        # El propio usuario cuenta: es una cuenta activa.
        self.assertEqual(r.data['usuarios_activos'], 1)

    def test_sin_sesion_no_pasa(self):
        self.assertIn(self.client.get('/api/dashboard/conteos/').status_code, (401, 403))

    def test_el_cliente_no_entra(self):
        cliente = User.objects.create_user('juan', 'juan@correo.mx', 'x' * 12)
        self.client.force_authenticate(cliente)
        self.assertEqual(self.client.get('/api/dashboard/conteos/').status_code, 403)
