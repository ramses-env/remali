"""Los permisos configurables no le quitan nada a nadie en silencio.

La primera prueba de este archivo congela lo que `puede_de()` responde HOY para
cada rol. Si una entrega futura la rompe, no es que la prueba esté vieja: es que
alguien le movió los permisos al equipo sin querer.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from maquinaria.permissions import puede_de
from maquinaria.permissions import (
    CATALOGO, NUCLEO, capacidades_fabrica, catalogo_capacidades, roles_editables,
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

    def test_existe_configurar_permisos_y_ya_se_reparte(self):
        """Era la capacidad con candado más grande —quien la tiene se puede
        conceder todo lo demás— y el dueño decidió repartirla igual."""
        nombres = {c.nombre for c in CATALOGO}
        self.assertIn('configurar_permisos', nombres)
        self.assertNotIn('configurar_permisos', NUCLEO)

    def test_ya_no_queda_nada_bajo_candado(self):
        self.assertEqual(NUCLEO, frozenset())

    def test_roles_editables_no_incluyen_al_dueno(self):
        """Y van por CLAVE, no por nombre: es lo que deja renombrar un puesto sin
        que se le caigan los permisos."""
        self.assertEqual(set(roles_editables()),
                         {'administrador', 'gestor', 'cajero', 'tecnico'})

    def test_fabrica_por_rol_coincide_con_puede_de(self):
        """`capacidades_fabrica('cajero')` dice lo mismo que un cajero real."""
        caps_usuario = puede_de(_usuario('cajero2', 'Cajero'))
        caps_rol = capacidades_fabrica('cajero')
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
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        with self.assertRaises(IntegrityError):
            PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=False)

    def test_la_bitacora_guarda_de_que_a_que(self):
        fila = CambioPermisoRol.objects.create(
            rol='cajero', capacidad='cotizar', anterior=False, nuevo=True)
        self.assertEqual(str(fila), 'cajero · cotizar: False → True')


class OverridesTest(TestCase):

    def test_enciende_una_capacidad_de_nivel_superior(self):
        cajero = _usuario('cajero3', 'Cajero')
        self.assertFalse(puede_de(cajero)['cotizar'])
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        self.assertTrue(puede_de(cajero)['cotizar'])

    def test_apaga_una_capacidad_propia(self):
        cajero = _usuario('cajero4', 'Cajero')
        PermisoRol.objects.create(rol='cajero', capacidad='usar_caja', permitido=False)
        self.assertFalse(puede_de(cajero)['usar_caja'])

    def test_borrar_el_override_devuelve_la_fabrica(self):
        cajero = _usuario('cajero5', 'Cajero')
        fila = PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        fila.delete()
        self.assertFalse(puede_de(cajero)['cotizar'])

    def test_lo_que_antes_era_nucleo_ahora_si_surte_efecto(self):
        """Gestionar usuarios estaba bajo candado y ni con la fila puesta a mano
        se encendía. Ahora el dueño se la puede dar a quien quiera."""
        cajero = _usuario('cajero6', 'Cajero')
        PermisoRol.objects.create(rol='cajero', capacidad='gestionar_usuarios', permitido=True)
        self.assertTrue(puede_de(cajero)['gestionar_usuarios'])

    def test_el_dueno_no_recibe_overrides(self):
        duena = _usuario('duena2', superusuario=True)
        PermisoRol.objects.create(rol='administrador', capacidad='ver_dinero', permitido=False)
        self.assertTrue(puede_de(duena)['ver_dinero'])

    def test_un_error_de_base_cae_a_fabrica_y_no_reparte(self):
        from unittest.mock import patch
        cajero = _usuario('cajero7', 'Cajero')
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
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


class SelloTest(TestCase):

    def _marca(self):
        from maquinaria.models import SelloTema
        fila = SelloTema.objects.filter(tema='permisos').first()
        return fila.marca if fila else None

    def test_guardar_un_override_mueve_el_sello(self):
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        self.assertIsNotNone(self._marca())

    def test_borrarlo_tambien(self):
        fila = PermisoRol.objects.create(rol='cajero', capacidad='vender', permitido=False)
        antes = self._marca()
        fila.delete()
        self.assertGreater(self._marca(), antes)
