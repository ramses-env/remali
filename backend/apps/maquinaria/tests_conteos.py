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
        self.assertEqual(r.data['equipo_activos'], 1)

    def test_sin_sesion_no_pasa(self):
        self.assertIn(self.client.get('/api/dashboard/conteos/').status_code, (401, 403))

    def test_el_cliente_no_entra(self):
        cliente = User.objects.create_user('juan', 'juan@correo.mx', 'x' * 12)
        self.client.force_authenticate(cliente)
        self.assertEqual(self.client.get('/api/dashboard/conteos/').status_code, 403)


class ConteoDeEquipoTest(TestCase):
    """El globito del menú cuenta EQUIPO, no todas las cuentas del sistema.

    Vive sobre la sección Equipo, que enseña solo cuentas de trabajo. Contando a
    los clientes decía "302" y prometía una lista que la sección no tiene.
    """

    def setUp(self):
        from django.contrib.auth.models import Group
        self.client = APIClient()
        self.duenio = User.objects.create_superuser('jefa2', 'jefa2@remali.mx', 'x' * 12)
        self.client.force_authenticate(self.duenio)
        tecnico = User.objects.create_user('tec', 'tec@remali.mx', 'x' * 12)
        tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        for n in range(3):
            cliente = User.objects.create_user(f'cli{n}', f'cli{n}@x.com', 'x' * 12)
            cliente.groups.add(Group.objects.get_or_create(name='Cliente')[0])

    def test_los_clientes_no_cuentan(self):
        r = self.client.get('/api/dashboard/conteos/')

        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['equipo_activos'], 2)   # la dueña y el técnico

    def test_una_cuenta_sin_acceso_tampoco(self):
        User.objects.filter(username='tec').update(is_active=False)

        self.assertEqual(self.client.get('/api/dashboard/conteos/').data['equipo_activos'], 1)
