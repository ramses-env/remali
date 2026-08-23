"""Los permisos configurables no le quitan nada a nadie en silencio.

La primera prueba de este archivo congela lo que `puede_de()` responde HOY para
cada rol. Si una entrega futura la rompe, no es que la prueba esté vieja: es que
alguien le movió los permisos al equipo sin querer.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from maquinaria.permissions import puede_de
from maquinaria.permissions import (
    CATALOGO, NUCLEO, ROLES_EDITABLES, capacidades_fabrica, catalogo_capacidades,
)


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


class CatalogoTest(TestCase):

    def test_toda_capacidad_tiene_area(self):
        for cap in CATALOGO:
            self.assertTrue(cap.area, f'{cap.nombre} sin área')

    def test_existe_configurar_permisos_y_es_del_nucleo(self):
        nombres = {c.nombre for c in CATALOGO}
        self.assertIn('configurar_permisos', nombres)
        self.assertIn('configurar_permisos', NUCLEO)

    def test_el_nucleo_son_cinco(self):
        self.assertEqual(NUCLEO, frozenset({
            'gestionar_usuarios', 'editar_datos_bancarios', 'borrar_catalogo',
            'tener_codigo_propio', 'configurar_permisos',
        }))

    def test_roles_editables_no_incluyen_al_dueno(self):
        self.assertEqual(ROLES_EDITABLES,
                         ('Gestor', 'Administrador', 'Cajero', 'Técnico'))

    def test_fabrica_por_rol_coincide_con_puede_de(self):
        """`capacidades_fabrica('Cajero')` dice lo mismo que un cajero real."""
        caps_usuario = puede_de(_usuario('cajero2', 'Cajero'))
        caps_rol = capacidades_fabrica('Cajero')
        for cap in CATALOGO:
            self.assertEqual(caps_rol[cap.nombre], caps_usuario[cap.nombre], cap.nombre)

    def test_el_catalogo_serializado_lleva_area_y_nucleo(self):
        fila = next(c for c in catalogo_capacidades() if c['nombre'] == 'cotizar')
        self.assertEqual(fila['area'], 'Mostrador')
        self.assertFalse(fila['nucleo'])


from maquinaria.models import CambioPermisoRol, PermisoRol


class TablasTest(TestCase):

    def test_un_rol_no_repite_capacidad(self):
        from django.db import IntegrityError
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        with self.assertRaises(IntegrityError):
            PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=False)

    def test_la_bitacora_guarda_de_que_a_que(self):
        fila = CambioPermisoRol.objects.create(
            rol='Cajero', capacidad='cotizar', anterior=False, nuevo=True)
        self.assertEqual(str(fila), 'Cajero · cotizar: False → True')


class OverridesTest(TestCase):

    def test_enciende_una_capacidad_de_nivel_superior(self):
        cajero = _usuario('cajero3', 'Cajero')
        self.assertFalse(puede_de(cajero)['cotizar'])
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertTrue(puede_de(cajero)['cotizar'])

    def test_apaga_una_capacidad_propia(self):
        cajero = _usuario('cajero4', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='usar_caja', permitido=False)
        self.assertFalse(puede_de(cajero)['usar_caja'])

    def test_borrar_el_override_devuelve_la_fabrica(self):
        cajero = _usuario('cajero5', 'Cajero')
        fila = PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        fila.delete()
        self.assertFalse(puede_de(cajero)['cotizar'])

    def test_el_nucleo_se_ignora_aunque_alguien_meta_la_fila_a_mano(self):
        """Defensa en profundidad: la API lo rechaza, y aun así no surte efecto."""
        cajero = _usuario('cajero6', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='gestionar_usuarios', permitido=True)
        self.assertFalse(puede_de(cajero)['gestionar_usuarios'])

    def test_el_dueno_no_recibe_overrides(self):
        duena = _usuario('duena2', superusuario=True)
        PermisoRol.objects.create(rol='Administrador', capacidad='ver_dinero', permitido=False)
        self.assertTrue(puede_de(duena)['ver_dinero'])

    def test_un_error_de_base_cae_a_fabrica_y_no_reparte(self):
        from unittest.mock import patch
        cajero = _usuario('cajero7', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        # `permissions.overrides_de_rol` importa PermisoRol DENTRO de la función
        # (models.py ya importa permissions, así que al revés sería circular).
        # Por eso el parche va sobre la clase real, que es la que acaba usándose.
        with patch('maquinaria.models.PermisoRol.objects.filter',
                   side_effect=Exception('base caída')):
            caps = puede_de(cajero)
        self.assertFalse(caps['cotizar'])     # fail-closed: no se reparte de más
        self.assertTrue(caps['usar_caja'])    # y lo de fábrica sigue trabajando


class NivelSigueSiendoElPisoTest(TestCase):
    """`is_staff` eleva el nivel aunque el grupo sea de mostrador o de campo.

    Sin esto, un `is_staff` con grupo Cajero pasaba los gates por nivel
    (`IsAdminGroupOrStaff` lo deja entrar) mientras el mapa de capacidades lo
    trataba como cajero: el panel le escondía lo que la API sí le permite. La
    combinación no la produce el panel —solo se llega a mano desde /admin/—,
    pero mientras `nivel_de` la reconozca, `puede_de` tiene que coincidir.
    """

    def test_staff_con_grupo_de_nivel_1_conserva_lo_de_administracion(self):
        staff_solo = puede_de(_usuario('staff_solo', staff=True))
        staff_cajero = puede_de(_usuario('staff_cajero', 'Cajero', staff=True))
        for cap in CATALOGO:
            if cap.nivel_minimo is None:
                continue          # los puestos (jornada_campo) no cascadean
            self.assertEqual(staff_cajero[cap.nombre], staff_solo[cap.nombre], cap.nombre)

    def test_un_cajero_normal_no_se_eleva(self):
        caps = puede_de(_usuario('cajero_normal', 'Cajero'))
        self.assertFalse(caps['ver_dinero'])
        self.assertFalse(caps['cotizar'])

    def test_el_gestor_conserva_su_ajuste(self):
        """Gestor comparte nivel con Administrador: el nivel NO lo eleva, así que
        `ver_dinero` sigue apagado. Es el rol entero."""
        self.assertFalse(puede_de(_usuario('gestor_x', 'Gestor'))['ver_dinero'])
