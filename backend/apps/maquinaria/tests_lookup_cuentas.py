"""Buscar una CUENTA para vincularle una renta o una cotización.

El bug que motiva estas pruebas: el panel decía "Aún no hay cuentas de cliente
registradas" con el sistema lleno de cuentas. No había error que buscar — el
endpoint devolvía una lista pelona y el front leía `data.clientes`, que en un
array es `undefined`.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import PerfilUsuario


class BuscarCuentas(TestCase):
    def setUp(self):
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        self.josue = User.objects.create_user('josue', email='josue@correo.com',
                                              first_name='Josue Ramses', last_name='Rojas Vallejo')
        self.josue.groups.add(grupo)
        PerfilUsuario.objects.update_or_create(
            usuario=self.josue, defaults={'telefono': '7441772370', 'empresa': 'Constructora Rojas'})

        self.otra = User.objects.create_user('mariana', email='mariana@correo.com', first_name='Mariana')
        self.otra.groups.add(grupo)
        PerfilUsuario.objects.update_or_create(usuario=self.otra, defaults={'telefono': '7449998877'})

        admin = User.objects.create_user('admin', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient()
        self.api.force_authenticate(admin)

    def _buscar(self, q=None):
        r = self.api.get('/api/clientes-lookup/', {'q': q} if q else {})
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def test_la_respuesta_viene_envuelta_en_clientes(self):
        """El contrato que el panel lee. Con una lista pelona salía 'Sin cuentas'."""
        data = self._buscar()
        self.assertIn('clientes', data)
        self.assertEqual(len(data['clientes']), 2)

    def test_cada_cuenta_trae_su_id(self):
        """Sin `id`, vincular mandaba `usuario_id: NaN` y fallaba en silencio."""
        cuenta = self._buscar('josue')['clientes'][0]
        self.assertEqual(cuenta['id'], self.josue.id)
        self.assertEqual(cuenta['nombre'], 'Josue Ramses Rojas Vallejo')

    def test_se_busca_por_nombre(self):
        self.assertEqual(len(self._buscar('rojas')['clientes']), 1)

    def test_se_busca_por_TELEFONO(self):
        """Es como se pregunta en el mostrador: '¿a qué número?'."""
        r = self._buscar('7441772370')['clientes']
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]['id'], self.josue.id)

    def test_el_telefono_se_encuentra_aunque_se_teclee_con_formato(self):
        """Nadie escribe el mismo formato dos veces."""
        self.assertEqual(len(self._buscar('744 177 2370')['clientes']), 1)

    def test_se_busca_por_empresa(self):
        self.assertEqual(len(self._buscar('Constructora')['clientes']), 1)

    def test_sin_coincidencias_devuelve_lista_vacia_no_error(self):
        self.assertEqual(self._buscar('zzzz')['clientes'], [])

    def test_una_cuenta_en_dos_grupos_no_sale_repetida(self):
        otro, _ = Group.objects.get_or_create(name='Mayoreo')
        self.josue.groups.add(otro)
        ids = [c['id'] for c in self._buscar('rojas')['clientes']]
        self.assertEqual(ids, [self.josue.id])
