"""Toda capacidad que la pantalla enciende tiene que mandar en algún endpoint.

Sin esto, agregar una capacidad al catálogo y olvidarse de imponerla produce lo
peor: un interruptor que el dueño mueve creyendo que hizo algo.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import get_resolver
from rest_framework.test import APIClient

from maquinaria.models import PermisoRol
from maquinaria.permissions import (
    CATALOGO, NUCLEO, SOLO_PANTALLA, ExigeCapacidad,
)


def _capacidades_impuestas() -> set:
    """Las capacidades que alguna ruta exige de verdad."""
    vistas = set()
    for padre in get_resolver().url_patterns:
        for ruta in getattr(padre, 'url_patterns', [padre]):
            vista = getattr(ruta, 'callback', None)
            cls = getattr(vista, 'cls', None) or getattr(vista, 'view_class', None)
            for perm in getattr(cls, 'permission_classes', []) if cls else []:
                if isinstance(perm, type) and issubclass(perm, ExigeCapacidad) and perm.capacidad:
                    vistas.add(perm.capacidad)
    return vistas


class TodaCapacidadSeImponeTest(TestCase):

    def test_ninguna_capacidad_configurable_es_decorativa(self):
        configurables = {c.nombre for c in CATALOGO} - NUCLEO - SOLO_PANTALLA
        huerfanas = sorted(configurables - _capacidades_impuestas())
        self.assertEqual(huerfanas, [], (
            'Estas capacidades se pueden encender en la pantalla y ningún endpoint '
            'las exige: o se gatean, o se declaran en SOLO_PANTALLA con su razón.'))

    def test_solo_pantalla_esta_justificada(self):
        """Que nadie use SOLO_PANTALLA como basurero: solo capacidades que
        existen para decidir qué se VE, no qué se puede hacer."""
        self.assertEqual(SOLO_PANTALLA, frozenset({'jornada_campo', 'ver_jornada'}))


class LaPantallaNoMienteTest(TestCase):
    """Encender `cotizar` para el Cajero tiene que dejarlo cotizar DE VERDAD."""

    def setUp(self):
        self.cajero = User.objects.create_user('cajero', 'c@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.cajero)

    def _crear(self):
        return self.api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'Karla Santana',
            'cliente_telefono': '7441772370',
        }, format='json')

    def test_sin_el_override_no_puede(self):
        self.assertEqual(self._crear().status_code, 403)

    def test_con_el_override_cotiza(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertEqual(self._crear().status_code, 201)

    def test_y_apagarselo_al_administrador_lo_detiene(self):
        admin = User.objects.create_user('admin', 'a@x.com', 'pass12345')
        admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        PermisoRol.objects.create(rol='Administrador', capacidad='cotizar', permitido=False)
        api = APIClient(); api.force_authenticate(admin)
        r = api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'X', 'cliente_telefono': '7441772370',
        }, format='json')
        self.assertEqual(r.status_code, 403)

    def test_los_kpis_de_la_seccion_tambien_obedecen_al_override(self):
        """`/api/cotizaciones/stats/` es la sección, no un nivel. Pero devuelve
        `monto_aceptado` —dinero AGREGADO del negocio—, así que además de
        `cotizar` sigue pidiendo `ver_dinero`."""
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        PermisoRol.objects.create(rol='Cajero', capacidad='ver_dinero', permitido=True)
        self.assertEqual(self.api.get('/api/cotizaciones/stats/').status_code, 200)

    def test_los_kpis_no_se_abren_solo_con_cotizar(self):
        """Cotizar no es ver las cuentas: `monto_aceptado` suma TODAS las
        cotizaciones aceptadas del periodo."""
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertEqual(self.api.get('/api/cotizaciones/stats/').status_code, 403)


class LaJornadaSeImponeTest(TestCase):
    """`operar_jornada`: entregar, recoger y subir las fotos.

    Es un trabajo distinto de LEVANTAR la renta (`rentar`, que el técnico tiene
    apagada a propósito), y hasta ahora no tenía nombre: las cuatro rutas de
    campo pedían solo nivel, así que el Cajero —que nunca sale al campo— leía el
    tablero completo con sus adeudos.
    """

    def setUp(self):
        self.cajero = User.objects.create_user('caja', 'caja@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.tecnico = User.objects.create_user('tec', 'tec@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_cajero = APIClient(); self.api_cajero.force_authenticate(self.cajero)
        self.api_tecnico = APIClient(); self.api_tecnico.force_authenticate(self.tecnico)

    def test_el_cajero_no_lee_el_tablero_de_campo(self):
        self.assertEqual(self.api_cajero.get('/api/rentas/tareas/').status_code, 403)

    def test_el_tecnico_si_lo_lee(self):
        self.assertEqual(self.api_tecnico.get('/api/rentas/tareas/').status_code, 200)

    def test_el_override_se_lo_enciende_al_cajero(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='operar_jornada', permitido=True)
        self.assertEqual(self.api_cajero.get('/api/rentas/tareas/').status_code, 200)

    def test_entregar_recoger_y_evidencias_piden_la_capacidad(self):
        """Al cajero lo para el permiso (403); al técnico lo para la renta que no
        existe (404), que es la prueba de que la capacidad sí lo dejó pasar."""
        for llamada in (
            lambda api: api.post('/api/rentas/999/entregar/', {'entregado': True}, format='json'),
            lambda api: api.post('/api/rentas/999/devolver/', {}, format='json'),
            lambda api: api.get('/api/rentas/999/evidencias/'),
            lambda api: api.post('/api/rentas/999/evidencias/', {'momento': 'entrega'}, format='json'),
        ):
            self.assertEqual(llamada(self.api_cajero).status_code, 403)
            self.assertEqual(llamada(self.api_tecnico).status_code, 404)

    def test_administracion_tambien_entrega_desde_rentas(self):
        """`jornada_campo` no servía para gatear esto: no cascadea hacia arriba y
        habría dejado al administrador sin poder entregar desde Rentas."""
        admin = User.objects.create_user('adm', 'adm@x.com', 'pass12345')
        admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        api = APIClient(); api.force_authenticate(admin)
        self.assertEqual(api.get('/api/rentas/tareas/').status_code, 200)
