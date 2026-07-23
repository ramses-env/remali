"""Gestión de usuarios del panel: quién entra y con qué rol.

El rol es el grupo de Django (Administrador / Almacén / …). Un usuario tiene
uno solo: la interfaz sería confusa con varios y el control de acceso real
(`IsAdminGroupOrStaff`) solo pregunta si pertenece a 'Administrador'.

Las cuentas NO se borran, se desactivan. Todas las referencias a usuario son
SET_NULL, así que borrar no destruye ventas ni rentas, pero sí borra el rastro
de quién las hizo. Desactivar impide entrar y conserva el historial.
"""
from django.contrib.auth.models import Group, User
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .permissions import EsDueno, ROL_ADMIN, nivel_de, NIVEL_ADMIN

def _rol(u: User):
    """Grupo del usuario, o None. Iteramos la caché del prefetch, no .first()."""
    grupos = list(u.groups.all())
    return grupos[0].name if grupos else None


def _es_admin(u: User):
    """¿Esta cuenta administra el sistema? Misma regla que usa la API."""
    return nivel_de(u) >= NIVEL_ADMIN


def _serialize(u: User):
    perfil = getattr(u, 'perfil', None)
    return {
        'id': u.id,
        'username': u.username,
        'nombre': (f'{u.first_name} {u.last_name}'.strip() or u.username),
        'first_name': u.first_name,
        'last_name': u.last_name,
        'email': u.email,
        'rol': _rol(u),
        'es_admin': _es_admin(u),
        'es_superusuario': u.is_superuser,
        'activo': u.is_active,
        'telefono': getattr(perfil, 'telefono', '') or '',
        'puesto': getattr(perfil, 'puesto', '') or '',
        'ultimo_acceso': u.last_login,
        'creado': u.date_joined,
    }


def _admins_activos_ids():
    """Ids de las cuentas que hoy pueden administrar. Sirve para no quedarnos sin ninguna."""
    return {
        u.id for u in User.objects.filter(is_active=True).prefetch_related('groups')
        if _es_admin(u)
    }


def _asignar_rol(usuario: User, rol: str | None):
    """Deja al usuario con ese único grupo (o sin ninguno si rol es vacío)."""
    if rol:
        grupo, _ = Group.objects.get_or_create(name=rol)
        usuario.groups.set([grupo])
    else:
        usuario.groups.clear()


@api_view(['GET'])
@permission_classes([EsDueno])
def roles_disponibles(request):
    """Grupos existentes, para el selector de rol."""
    return Response({'roles': list(Group.objects.order_by('name').values_list('name', flat=True))})


@api_view(['GET', 'POST'])
@permission_classes([EsDueno])
def usuarios(request):
    if request.method == 'GET':
        qs = User.objects.all().select_related('perfil').prefetch_related('groups').order_by('-is_active', 'username')
        return Response({'usuarios': [_serialize(u) for u in qs]})

    d = request.data or {}
    username = (d.get('username') or '').strip()
    password = d.get('password') or ''
    if not username:
        return Response({'detalle': 'El usuario es obligatorio.'}, status=400)
    if len(password) < 8:
        return Response({'detalle': 'La contraseña debe tener al menos 8 caracteres.'}, status=400)
    if User.objects.filter(username__iexact=username).exists():
        return Response({'detalle': f'Ya existe una cuenta con el usuario "{username}".'}, status=400)

    email = (d.get('email') or '').strip()
    if email and User.objects.filter(email__iexact=email).exists():
        return Response({'detalle': f'Ya hay una cuenta con el correo "{email}".'}, status=400)

    with transaction.atomic():
        u = User.objects.create_user(
            username=username, password=password, email=email,
            first_name=(d.get('first_name') or '').strip(),
            last_name=(d.get('last_name') or '').strip(),
        )
        _asignar_rol(u, (d.get('rol') or '').strip() or None)
        telefono, puesto = (d.get('telefono') or '').strip(), (d.get('puesto') or '').strip()
        if telefono or puesto:
            from .models import PerfilUsuario
            PerfilUsuario.objects.update_or_create(usuario=u, defaults={'telefono': telefono, 'puesto': puesto})

    u = User.objects.select_related('perfil').prefetch_related('groups').get(pk=u.pk)
    return Response(_serialize(u), status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([EsDueno])
def usuario_detalle(request, pk: int):
    try:
        u = User.objects.select_related('perfil').prefetch_related('groups').get(pk=pk)
    except User.DoesNotExist:
        return Response({'detalle': 'Usuario no encontrado'}, status=404)

    yo = request.user.id

    if request.method == 'DELETE':
        # "Eliminar" = desactivar. Ver la nota del encabezado del módulo.
        if u.id == yo:
            return Response({'detalle': 'No puedes desactivar tu propia cuenta.'}, status=400)
        if _admins_activos_ids() - {u.id} == set():
            return Response({'detalle': 'Es la última cuenta con acceso de administrador; el sistema quedaría sin quién lo administre.'}, status=400)
        u.is_active = False
        u.save(update_fields=['is_active'])
        return Response(_serialize(u))

    d = request.data or {}

    # Cambio de contraseña (el admin la define; el usuario la cambia luego en su perfil).
    nueva = d.get('password')
    if nueva is not None:
        if len(nueva) < 8:
            return Response({'detalle': 'La contraseña debe tener al menos 8 caracteres.'}, status=400)
        u.set_password(nueva)
        u.save(update_fields=['password'])
        return Response({'detalle': f'Contraseña actualizada para {u.username}.', 'usuario': _serialize(u)})

    campos = []
    for campo, clave in (('first_name', 'first_name'), ('last_name', 'last_name'), ('email', 'email')):
        if clave in d:
            valor = (d.get(clave) or '').strip()
            if campo == 'email' and valor and User.objects.filter(email__iexact=valor).exclude(pk=u.pk).exists():
                return Response({'detalle': f'Ya hay otra cuenta con el correo "{valor}".'}, status=400)
            setattr(u, campo, valor)
            campos.append(campo)

    # Rol y activación: aquí es donde uno puede dejarse fuera del sistema.
    quedaria_admin = _es_admin(u)
    if 'rol' in d:
        nuevo_rol = (d.get('rol') or '').strip() or None
        quedaria_admin = u.is_superuser or u.is_staff or nuevo_rol == ROL_ADMIN
    activo = u.is_active if 'activo' not in d else bool(d.get('activo'))

    if u.id == yo and (not activo or not quedaria_admin):
        return Response({'detalle': 'No puedes quitarte a ti mismo el acceso de administrador.'}, status=400)

    otros_admins = _admins_activos_ids() - {u.id}
    if not otros_admins and (not activo or not quedaria_admin):
        return Response({'detalle': 'Es la última cuenta con acceso de administrador; deja al menos una activa.'}, status=400)

    if 'activo' in d and activo != u.is_active:
        u.is_active = activo
        campos.append('is_active')
    if campos:
        u.save(update_fields=campos)
    if 'rol' in d:
        _asignar_rol(u, (d.get('rol') or '').strip() or None)

    telefono, puesto = d.get('telefono'), d.get('puesto')
    if telefono is not None or puesto is not None:
        from .models import PerfilUsuario
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=u)
        if telefono is not None:
            perfil.telefono = (telefono or '').strip()
        if puesto is not None:
            perfil.puesto = (puesto or '').strip()
        perfil.save()

    u = User.objects.select_related('perfil').prefetch_related('groups').get(pk=u.pk)
    return Response(_serialize(u))
