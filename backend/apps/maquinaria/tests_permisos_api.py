"""La API de permisos: quién la abre, qué devuelve y qué rechaza."""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import CambioPermisoRol, PermisoRol
from maquinaria.seguridad import definir_codigo


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class LeerPermisosTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def test_devuelve_todo_lo_que_la_matriz_necesita(self):
        r = self.api.get('/api/permisos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x['nombre'] for x in r.data['roles']],
                         ['Gestor', 'Administrador', 'Cajero', 'Técnico'])
        cotizar = next(c for c in r.data['catalogo'] if c['nombre'] == 'cotizar')
        self.assertEqual(cotizar['etiqueta'], 'Cotizar')
        self.assertEqual(cotizar['area'], 'Mostrador')
        self.assertFalse(cotizar['nucleo'])
        self.assertFalse(r.data['fabrica']['Cajero']['cotizar'])
        self.assertFalse(r.data['efectivo']['Cajero']['cotizar'])
        self.assertEqual(r.data['overrides'], [])

    def test_el_efectivo_refleja_lo_configurado_y_la_fabrica_no(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        r = self.api.get('/api/permisos/')
        self.assertTrue(r.data['efectivo']['Cajero']['cotizar'])
        self.assertFalse(r.data['fabrica']['Cajero']['cotizar'])
        self.assertEqual(len(r.data['overrides']), 1)

    def test_un_gestor_no_la_abre(self):
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)

    def test_un_administrador_tampoco(self):
        api = APIClient()
        api.force_authenticate(_usuario('admin', 'Administrador'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)
