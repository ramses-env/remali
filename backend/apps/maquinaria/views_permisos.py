"""Permisos configurables por rol: leer la matriz y guardarla.

La autorización de ESTA pantalla es doble a propósito: `configurar_permisos`
para abrirla (y es del núcleo, así que no se puede regalar) y el código de 6
dígitos para guardar. Ver
docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
"""
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CambioPermisoRol, PermisoRol
from .permissions import (
    CATALOGO, NIVEL_POR_ROL, NUCLEO, ROLES_EDITABLES, PuedeConfigurarPermisos,
    capacidades_fabrica, catalogo_capacidades, rol_de,
)

CAPACIDADES = {c.nombre for c in CATALOGO}


def _efectivo(rol: str, overrides: dict) -> dict:
    """Lo que ese rol puede HOY: fábrica con lo configurado encima."""
    caps = capacidades_fabrica(rol)
    caps.update(overrides.get(rol, {}))
    return caps


def _foto():
    """La matriz completa, tal como la pinta la pantalla."""
    guardados = {}
    lista = []
    for fila in PermisoRol.objects.select_related('actualizado_por'):
        if fila.capacidad in NUCLEO or fila.rol not in ROLES_EDITABLES:
            continue        # basura de un respaldo viejo: ni se aplica ni se enseña
        guardados.setdefault(fila.rol, {})[fila.capacidad] = fila.permitido
        quien = fila.actualizado_por
        lista.append({
            'rol': fila.rol, 'capacidad': fila.capacidad, 'permitido': fila.permitido,
            'por': (quien.get_full_name() or quien.username) if quien else '',
            'cuando': fila.actualizado_en,
        })
    return {
        'roles': [{'nombre': r, 'nivel': NIVEL_POR_ROL[r]} for r in ROLES_EDITABLES],
        'catalogo': catalogo_capacidades(),
        'fabrica': {r: capacidades_fabrica(r) for r in ROLES_EDITABLES},
        'efectivo': {r: _efectivo(r, guardados) for r in ROLES_EDITABLES},
        'overrides': lista,
    }


@api_view(['GET'])
@permission_classes([PuedeConfigurarPermisos])
def permisos(request):
    return Response(_foto())
