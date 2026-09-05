"""Permisos configurables por rol: leer la matriz y guardarla.

La autorización de ESTA pantalla es doble a propósito: `configurar_permisos`
para abrirla (y es del núcleo, así que no se puede regalar) y el código de 6
dígitos para guardar. Ver
docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
"""
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CambioPermisoRol, PermisoRol, Rol
from .permissions import (
    CATALOGO, NIVEL_TECNICO, PuedeConfigurarPermisos, capacidades_fabrica,
    catalogo_capacidades, nivel_de_rol, nombre_de_rol, roles_editables, rol_de,
)

CAPACIDADES = {c.nombre for c in CATALOGO}


def _efectivo(clave: str, overrides: dict) -> dict:
    """Lo que ese puesto puede HOY: fábrica con lo configurado encima."""
    caps = capacidades_fabrica(clave)
    caps.update(overrides.get(clave, {}))
    return caps


def _roles():
    """Los puestos con lo que la tabla de la pantalla necesita de cada uno.

    `usuarios` se cuenta aquí y no en el navegador porque es la respuesta a la
    única pregunta peligrosa de esta pantalla: borrar un puesto deja sin panel a
    quien lo tenga, y eso se advierte ANTES, con el número enfrente.
    """
    from django.contrib.auth.models import Group
    gente = {g.name: g.user_set.count() for g in Group.objects.all()}
    filas = []
    for clave in roles_editables():
        r = Rol.objects.filter(clave=clave).first()
        nombre = r.nombre if r else nombre_de_rol(clave)
        filas.append({
            'clave': clave,
            'nombre': nombre,
            'nivel': r.nivel if r else nivel_de_rol(clave),
            'protegido': bool(r.protegido) if r else True,
            'usuarios': gente.get(nombre, 0),
            'creado_en': r.creado_en if r else None,
            'actualizado_en': r.actualizado_en if r else None,
        })
    return filas


def _foto():
    """La matriz completa, tal como la pinta la pantalla."""
    editables = roles_editables()
    guardados = {}
    lista = []
    for fila in PermisoRol.objects.select_related('actualizado_por'):
        if fila.rol not in editables:
            continue        # basura de un respaldo viejo: ni se aplica ni se enseña
        guardados.setdefault(fila.rol, {})[fila.capacidad] = fila.permitido
        quien = fila.actualizado_por
        lista.append({
            'rol': fila.rol, 'capacidad': fila.capacidad, 'permitido': fila.permitido,
            'por': (quien.get_full_name() or quien.username) if quien else '',
            'cuando': fila.actualizado_en,
        })
    return {
        'roles': _roles(),
        'catalogo': catalogo_capacidades(),
        'fabrica': {r: capacidades_fabrica(r) for r in editables},
        'efectivo': {r: _efectivo(r, guardados) for r in editables},
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
    editables = roles_editables()
    for c in cambios:
        rol, cap = c.get('rol'), c.get('capacidad')
        if rol not in editables:
            return Response({'detalle': f'Ese puesto no se configura aquí.',
                             'codigo_error': 'rol_invalido'}, status=400)
        if cap not in CAPACIDADES:
            return Response({'detalle': f'La capacidad «{cap}» no existe.',
                             'codigo_error': 'capacidad_invalida'}, status=400)
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


ETIQUETAS = {c.nombre: c.etiqueta for c in CATALOGO}


@api_view(['GET'])
@permission_classes([PuedeConfigurarPermisos])
def bitacora(request):
    """El rastro. Se lee; no se deshace desde aquí —deshacer es volver a mover
    el interruptor, que a su vez deja su propio renglón."""
    try:
        # `max(1, ...)` porque un `?limite=-5` en la barra se convertiría en
        # `filas[:-5]`: en vez de fallar, escondería los 5 renglones más viejos.
        limite = max(1, min(int(request.query_params.get('limite', 50)), 200))
    except (TypeError, ValueError):
        limite = 50
    filas = CambioPermisoRol.objects.select_related('usuario')[:limite]
    return Response({'cambios': [{
        'rol': nombre_de_rol(f.rol),
        'capacidad': f.capacidad,
        # Sin capacidad, el renglón es del puesto entero (se creó, se renombró,
        # se borró) y lo que se lee es su detalle.
        'etiqueta': ETIQUETAS.get(f.capacidad, f.capacidad) or f.detalle,
        'detalle': f.detalle,
        'anterior': f.anterior,
        'nuevo': f.nuevo,
        'quien': f.usuario.username if f.usuario else '',
        'rol_quien': f.rol_usuario,
        'cuando': f.creado_en,
    } for f in filas]})


# ═══════════════════════════════════════════════════════════════════
#  EL PUESTO EN SÍ: crearlo, renombrarlo, borrarlo
# ═══════════════════════════════════════════════════════════════════
#: Nombres que no se pueden usar: son de la tienda o del vocabulario del sistema,
#: y un puesto llamado así confundiría al que reparte permisos y al que los lee.
NOMBRES_RESERVADOS = {'cliente', 'dueño', 'dueno', 'sin acceso', 'superusuario'}


def _nombre_actual(clave: str) -> str:
    r = Rol.objects.filter(clave=clave).first() if clave else None
    return r.nombre if r else '\x00'      # nada coincide con esto


def _validar_nombre(nombre: str, excluir_clave: str = ''):
    """(nombre limpio, error). El nombre es lo ÚNICO que el dueño escribe aquí,
    así que se revisa entero antes de tocar la base."""
    from django.contrib.auth.models import Group
    nombre = ' '.join((nombre or '').split())       # espacios de más, fuera
    if len(nombre) < 3:
        return '', 'El nombre del puesto necesita al menos 3 letras.'
    if len(nombre) > 60:
        return '', 'El nombre del puesto no puede pasar de 60 letras.'
    if nombre.lower() in NOMBRES_RESERVADOS:
        return '', f'«{nombre}» está reservado por el sistema. Escoge otro nombre.'
    if Rol.objects.filter(nombre__iexact=nombre).exclude(clave=excluir_clave).exists():
        return '', f'Ya hay un puesto que se llama «{nombre}».'
    # También se mira el GRUPO: puede existir uno sin puesto (de un respaldo o
    # del /admin/ de Django), y dos grupos con el mismo nombre no caben.
    if (Group.objects.filter(name__iexact=nombre).exists()
            and nombre.lower() != _nombre_actual(excluir_clave).lower()):
        return '', f'Ya existe un grupo llamado «{nombre}».'
    return nombre, ''


def _clave_libre(nombre: str) -> str:
    """Una identidad interna a partir del nombre. Solo se usa al CREAR: de ahí en
    adelante la clave es la del puesto para siempre, aunque lo renombren."""
    from django.utils.text import slugify
    base = slugify(nombre)[:32] or 'puesto'
    clave, n = base, 2
    while Rol.objects.filter(clave=clave).exists():
        clave, n = f'{base}-{n}', n + 1
    return clave


def _apuntar(request, clave: str, detalle: str):
    """Un renglón en la bitácora para el ciclo de vida del puesto: crear,
    renombrar y borrar mueven quién puede qué tanto como encender una casilla."""
    CambioPermisoRol.objects.create(
        rol=clave, capacidad='', detalle=detalle,
        usuario=request.user, rol_usuario=rol_de(request.user))


@api_view(['POST'])
@permission_classes([PuedeConfigurarPermisos])
def crear_rol(request):
    """Un puesto nuevo, con el nombre que el dueño quiera.

    Nace EN BLANCO: entra al panel y no puede nada más. Lo cómodo sería copiarle
    las capacidades a un puesto parecido, pero entonces heredaría sin querer
    permisos que nadie revisó; así, lo que este puesto pueda hacer es
    exactamente lo que alguien le encendió a mano.
    """
    from django.contrib.auth.models import Group
    nombre, error = _validar_nombre(request.data.get('nombre') or '')
    if error:
        return Response({'detalle': error, 'codigo_error': 'nombre'}, status=400)
    with transaction.atomic():
        rol = Rol.objects.create(clave=_clave_libre(nombre), nombre=nombre,
                                 nivel=NIVEL_TECNICO, protegido=False,
                                 creado_por=request.user)
        Group.objects.get_or_create(name=nombre)
        _apuntar(request, rol.clave, f'Puesto creado: {nombre}')
    salida = _foto()
    salida['clave'] = rol.clave
    return Response(salida, status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([PuedeConfigurarPermisos])
def rol_detalle(request, clave: str):
    """Renombrar o borrar un puesto.

    Renombrar es seguro por diseño: los permisos se guardan contra la CLAVE, así
    que cambiarle el nombre no mueve una sola casilla ni saca a nadie de su
    puesto —el grupo es el mismo, solo se llama distinto—. Borrar sí es serio, y
    por eso pide el código de 6 dígitos.
    """
    from django.contrib.auth.models import Group
    rol = Rol.objects.filter(clave=clave).first()
    if not rol:
        return Response({'detalle': 'Ese puesto no existe.'}, status=404)

    if request.method == 'PATCH':
        nombre, error = _validar_nombre(request.data.get('nombre') or '', excluir_clave=clave)
        if error:
            return Response({'detalle': error, 'codigo_error': 'nombre'}, status=400)
        if nombre == rol.nombre:
            return Response(_foto())
        anterior = rol.nombre
        with transaction.atomic():
            grupo = Group.objects.filter(name=anterior).first()
            if grupo:
                grupo.name = nombre       # el MISMO grupo: nadie pierde su puesto
                grupo.save(update_fields=['name'])
            else:
                Group.objects.get_or_create(name=nombre)
            rol.nombre = nombre
            rol.save(update_fields=['nombre', 'actualizado_en'])
            _apuntar(request, clave, f'Puesto renombrado: {anterior} → {nombre}')
        return Response(_foto())

    # ── DELETE ──
    if rol.protegido:
        return Response({
            'detalle': f'«{rol.nombre}» es uno de los puestos base del sistema y no se '
                       'borra. Se le puede cambiar el nombre y repartir sus permisos.',
            'codigo_error': 'rol_protegido',
        }, status=400)
    from .seguridad import verificar_codigo
    ok, detalle, status_code, codigo_error = verificar_codigo(
        request.user, request.data.get('codigo') or '')
    if not ok:
        return Response({'detalle': detalle, 'codigo_error': codigo_error}, status=status_code)
    with transaction.atomic():
        grupo = Group.objects.filter(name=rol.nombre).first()
        cuantos = grupo.user_set.count() if grupo else 0
        nombre = rol.nombre
        if grupo:
            grupo.delete()                # quien lo tenía se queda sin puesto
        PermisoRol.objects.filter(rol=clave).delete()
        rol.delete()
        _apuntar(request, clave, f'Puesto borrado: {nombre}'
                 + (f' ({cuantos} sin acceso)' if cuantos else ''))
    salida = _foto()
    salida['sin_acceso'] = cuantos
    return Response(salida)
