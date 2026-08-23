"""Los permisos configurables no le quitan nada a nadie en silencio.

La primera prueba de este archivo congela lo que `puede_de()` responde HOY para
cada rol. Si una entrega futura la rompe, no es que la prueba esté vieja: es que
alguien le movió los permisos al equipo sin querer.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from maquinaria.permissions import puede_de


def _usuario(nombre, grupo=None, staff=False, superusuario=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345',
                                 is_staff=staff, is_superuser=superusuario)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class FabricaCongeladaTest(TestCase):
    """Lo que cada rol puede cuando NADIE ha configurado nada."""

    def test_dueno_lo_puede_todo(self):
        caps = puede_de(_usuario('duena', superusuario=True))
        self.assertEqual(caps['nivel'], 3)
        self.assertTrue(caps['gestionar_usuarios'])
        self.assertTrue(caps['editar_datos_bancarios'])
        self.assertTrue(caps['ver_dinero'])

    def test_administrador(self):
        caps = puede_de(_usuario('admin', 'Administrador'))
        self.assertEqual(caps['nivel'], 2)
        self.assertTrue(caps['ver_dinero'])
        self.assertTrue(caps['cotizar'])
        self.assertTrue(caps['tener_codigo_propio'])
        self.assertFalse(caps['gestionar_usuarios'])
        self.assertFalse(caps['editar_datos_bancarios'])

    def test_gestor_opera_sin_ver_las_cuentas(self):
        caps = puede_de(_usuario('gestor', 'Gestor'))
        self.assertEqual(caps['nivel'], 2)
        self.assertFalse(caps['ver_dinero'])          # el punto entero del rol
        self.assertTrue(caps['ver_operacion'])
        self.assertTrue(caps['configurar_negocio'])
        self.assertFalse(caps['tener_codigo_propio'])
        self.assertFalse(caps['editar_datos_bancarios'])

    def test_cajero_es_mostrador_no_campo(self):
        caps = puede_de(_usuario('cajero', 'Cajero'))
        self.assertEqual(caps['nivel'], 1)
        self.assertTrue(caps['usar_caja'])
        self.assertTrue(caps['corte_caja'])
        self.assertTrue(caps['vender'])
        self.assertFalse(caps['rentar'])
        self.assertFalse(caps['reparar'])
        self.assertFalse(caps['cotizar'])
        self.assertFalse(caps['ver_dinero'])

    def test_tecnico_es_campo_no_mostrador(self):
        caps = puede_de(_usuario('tecnico', 'Técnico'))
        self.assertEqual(caps['nivel'], 1)
        self.assertTrue(caps['jornada_campo'])
        self.assertTrue(caps['reparar'])
        self.assertTrue(caps['operar_inventario'])
        self.assertFalse(caps['vender'])
        self.assertFalse(caps['rentar'])
        self.assertFalse(caps['usar_caja'])

    def test_sin_rol_no_entra(self):
        caps = puede_de(_usuario('cliente'))
        self.assertEqual(caps['nivel'], 0)
        self.assertFalse(caps['ver_operacion'])
