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
