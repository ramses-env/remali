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


@api_view(['GET', 'POST'])
@permission_classes([PuedeConfigurarPermisos])
def permisos(request):
    if request.method == 'GET':
        return Response(_foto())

    cambios = request.data.get('cambios') or []
    if not isinstance(cambios, list):
        return Response({'detalle': 'Formato inválido.', 'codigo_error': 'formato'}, status=400)

    # Se valida TODO el lote antes de tocar la base: la barra prometió "3
    # cambios", así que o entran los tres o no entra ninguno.
    for c in cambios:
        rol, cap = c.get('rol'), c.get('capacidad')
        if rol not in ROLES_EDITABLES:
            return Response({'detalle': f'El rol «{rol}» no se configura aquí.',
                             'codigo_error': 'rol_invalido'}, status=400)
        if cap not in CAPACIDADES:
            return Response({'detalle': f'La capacidad «{cap}» no existe.',
                             'codigo_error': 'capacidad_invalida'}, status=400)
        if cap in NUCLEO:
            return Response({'detalle': 'Esa capacidad no se reparte desde esta pantalla.',
                             'codigo_error': 'nucleo_bloqueado'}, status=400)
        if not isinstance(c.get('permitido'), bool):
            return Response({'detalle': 'Cada cambio necesita permitido: true o false.',
                             'codigo_error': 'formato'}, status=400)

    from .seguridad import verificar_codigo
    ok, detalle, status, codigo_error = verificar_codigo(request.user, request.data.get('codigo') or '')
    if not ok:
        return Response({'detalle': detalle, 'codigo_error': codigo_error}, status=status)

    quien = rol_de(request.user)
    with transaction.atomic():
        for c in cambios:
            rol, cap, permitido = c['rol'], c['capacidad'], c['permitido']
            fabrica = capacidades_fabrica(rol)[cap]
            fila = PermisoRol.objects.filter(rol=rol, capacidad=cap).first()
            anterior = fila.permitido if fila else fabrica
            if anterior == permitido:
                continue                     # no cambió nada: ni bitácora ni sello
            if permitido == fabrica:
                # Volvió a su valor original: el override deja de existir. Así la
                # tabla solo guarda decisiones vivas y el punto dorado de la
                # pantalla es "¿existe la fila?".
                if fila:
                    fila.delete()
            else:
                PermisoRol.objects.update_or_create(
                    rol=rol, capacidad=cap,
                    defaults={'permitido': permitido, 'actualizado_por': request.user})
            CambioPermisoRol.objects.create(
                rol=rol, capacidad=cap, anterior=anterior, nuevo=permitido,
                usuario=request.user, rol_usuario=quien)
    return Response(_foto())
