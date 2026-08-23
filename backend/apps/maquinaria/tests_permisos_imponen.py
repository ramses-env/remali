"""Toda capacidad que la pantalla enciende tiene que mandar en algún endpoint.

Sin esto, agregar una capacidad al catálogo y olvidarse de imponerla produce lo
peor: un interruptor que el dueño mueve creyendo que hizo algo.
"""
from django.test import TestCase
from django.urls import get_resolver

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
