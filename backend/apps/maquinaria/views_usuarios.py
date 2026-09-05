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
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .permissions import (
    CLAVE_ADMIN, PuedeGestionarUsuarios, clave_de_grupo, nivel_de, NIVEL_ADMIN,
)

def _rol(u: User):
    """Grupo del usuario, o None. Iteramos la caché del prefetch, no .first()."""
    grupos = list(u.groups.all())
    return grupos[0].name if grupos else None


def _es_admin(u: User):
    """¿Esta cuenta administra el sistema? Misma regla que usa la API."""
    return nivel_de(u) >= NIVEL_ADMIN


def _es_cliente(u: User):
    """Cliente de la tienda: sin rol de personal (ni staff, ni superusuario, ni
    grupo distinto de 'Cliente'). El panel NO le cambia la contraseña —la
    recupera él desde el login— ni le marca la verificación de correo —la hace
    él al confirmar su correo—. El personal interno sí lo administra el admin."""
    return not u.is_staff and not u.is_superuser and _rol(u) in (None, 'Cliente')


def _serialize(u: User, request=None):
    from .models import avatar_por_rol
    perfil = getattr(u, 'perfil', None)
    avatar_url = None
    if getattr(perfil, 'avatar', None):
        try:
            avatar_url = perfil.avatar.url
            if request is not None:
                avatar_url = request.build_absolute_uri(avatar_url)
        except Exception:
            avatar_url = None
    if not avatar_url:
        avatar_url = avatar_por_rol(u, absoluta=True, request=request)
    avatar_url_rol = avatar_por_rol(u, absoluta=True, request=request)

    nombre_completo = (f'{u.first_name} {u.last_name}'.strip() or u.username)
    return {
        'id': u.id,
        'username': u.username,
        'nombre': nombre_completo,
        'first_name': u.first_name,
        'last_name': u.last_name,
        'email': u.email,
        'rol': _rol(u),
        'es_admin': _es_admin(u),
        'es_superusuario': u.is_superuser,
        'activo': u.is_active,
        'telefono': getattr(perfil, 'telefono', '') or '',
        'puesto': getattr(perfil, 'puesto', '') or '',
        'email_verificado': bool(getattr(perfil, 'email_verificado', False)),
        'datos_completos': bool(perfil and perfil.datos_completos),
        'perfil_verificado': bool(perfil and perfil.perfil_verificado),
        # ¿Ya tiene su código de seguridad (PIN para autorizar acciones sensibles)?
        'tiene_codigo': bool(getattr(perfil, 'codigo_seguridad', '')),
        'ultimo_acceso': u.last_login,
        'creado': u.date_joined,
        'avatar_url': avatar_url,
        'avatar_url_rol': avatar_url_rol,
        # `avatar_url` SIEMPRE trae algo (cae al dibujo del rol), así que no
        # sirve para saber si la persona subió una foto de verdad. Esto sí.
        'tiene_foto': bool(getattr(perfil, 'avatar', None)),
        # Para el AvatarUsuario del frontend: nombre visible + email / username
        'display_nombre': (u.get_full_name() or u.username or u.email or '').strip(),
        'display_correo': (u.email or u.username or '').strip(),
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
@permission_classes([PuedeGestionarUsuarios])
def roles_disponibles(request):
    """Los puestos que se le pueden asignar a una cuenta de trabajo.

    Van con su CLAVE además del nombre: la pantalla necesita preguntar "¿este es
    el administrador?" para pedirle su PIN, y preguntarlo por el texto deja de
    funcionar en cuanto el dueño renombra el puesto.

    'Cliente' se excluye a propósito: desde el panel solo se crea EQUIPO; los
    clientes nacen registrándose en la tienda.
    """
    from .permissions import mapa_roles
    mapa = mapa_roles()
    vistos, filas = set(), []
    for grupo in Group.objects.exclude(name='Cliente').order_by('name'):
        datos = mapa.get(grupo.name)
        clave = datos['clave'] if datos else ''
        # Un grupo suelto (sin puesto) sigue saliendo: existe y alguien lo puede
        # tener. Lo que no se repite es el mismo puesto con su nombre viejo.
        if clave and clave in vistos:
            continue
        vistos.add(clave)
        filas.append({'clave': clave, 'nombre': grupo.name,
                      'nivel': datos['nivel'] if datos else 0})
    return Response({'roles': filas})


def _guardar_foto(usuario, archivo):
    """La foto de la cuenta. Es el mismo `PerfilUsuario.avatar` que el usuario se
    pone desde su perfil: el panel no inventa un campo aparte, solo se la puede
    poner de una vez al darlo de alta —que es cuando alguien tiene la foto a la
    mano— en vez de esperar a que la persona entre a ponérsela."""
    from .models import PerfilUsuario
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=usuario)
    perfil.avatar = archivo
    perfil.save(update_fields=['avatar'])


@api_view(['GET', 'POST'])
@permission_classes([PuedeGestionarUsuarios])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def usuarios(request):
    if request.method == 'GET':
        qs = User.objects.all().select_related('perfil').prefetch_related('groups').order_by('-is_active', 'username')
        return Response({'usuarios': [_serialize(u, request=request) for u in qs]})

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

    if (d.get('rol') or '').strip() == 'Cliente':
        return Response({'detalle': 'Desde el panel solo se crea equipo de trabajo; los clientes se registran en la tienda.'}, status=400)

    # Código de seguridad: SOLO para roles de AUTORIDAD (Administrador / Gerente).
    # Es el PIN con el que AUTORIZAN acciones sensibles (cancelar venta/renta,
    # ajustar precio, anticipo bajo el mínimo, resolver depósito). Un operador
    # (cajero/asesor/técnico) NO autoriza nada —eso lo aprueba un superior—, así
    # que no se le pide ni se le guarda PIN (si el formulario lo mandara, se ignora).
    from .seguridad import formato_valido, hash_codigo
    rol = (d.get('rol') or '').strip()
    # Por CLAVE y no por nombre: el dueño puede renombrar "Administrador", y una
    # comparación contra el texto dejaría de pedir el PIN sin que nadie se entere.
    es_autoridad = clave_de_grupo(rol) == CLAVE_ADMIN
    codigo = str(d.get('codigo_seguridad') or '').strip()
    if es_autoridad and not formato_valido(codigo):
        return Response({'detalle': 'Define el código de seguridad (6 dígitos): el administrador o gerente lo usa para autorizar acciones sensibles.'}, status=400)

    with transaction.atomic():
        u = User.objects.create_user(
            username=username, password=password, email=email,
            first_name=(d.get('first_name') or '').strip(),
            last_name=(d.get('last_name') or '').strip(),
        )
        _asignar_rol(u, rol or None)
        from .models import PerfilUsuario
        defaults = {
            'telefono': (d.get('telefono') or '').strip(),
            'puesto': (d.get('puesto') or '').strip(),
        }
        # Solo la autoridad guarda PIN; el operador nunca (ni siquiera vacío).
        if es_autoridad:
            defaults['codigo_seguridad'] = hash_codigo(codigo)
        PerfilUsuario.objects.update_or_create(usuario=u, defaults=defaults)
        foto = request.FILES.get('avatar')
        if foto:
            _guardar_foto(u, foto)

    u = User.objects.select_related('perfil').prefetch_related('groups').get(pk=u.pk)
    return Response(_serialize(u, request=request), status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([PuedeGestionarUsuarios])
@parser_classes([MultiPartParser, FormParser, JSONParser])
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
        return Response(_serialize(u, request=request))

    d = request.data or {}

    # Cambio de contraseña (el admin la define; el usuario la cambia luego en su perfil).
    nueva = d.get('password')
    if nueva is not None:
        # A un CLIENTE no se le cambia la contraseña desde el panel: la recupera
        # él mismo desde el login. Solo aplica al personal interno.
        if _es_cliente(u):
            return Response({'detalle': 'La contraseña de un cliente no se cambia desde el panel; el cliente la recupera desde el login.'}, status=403)
        if len(nueva) < 8:
            return Response({'detalle': 'La contraseña debe tener al menos 8 caracteres.'}, status=400)
        u.set_password(nueva)
        u.save(update_fields=['password'])
        return Response({'detalle': f'Contraseña actualizada para {u.username}.', 'usuario': _serialize(u, request=request)})

    # Reset del código de seguridad (por si el operador lo olvidó). El propio
    # usuario también puede cambiarlo desde su perfil (con su contraseña).
    nuevo_codigo = d.get('codigo_seguridad')
    if nuevo_codigo is not None:
        if _es_cliente(u):
            return Response({'detalle': 'Los clientes no usan código de seguridad.'}, status=403)
        # Solo la autoridad (Administrador/Gerente) tiene PIN: no se le asigna uno
        # a un operador, porque su PIN jamás autoriza nada (lo gatea verificar_codigo).
        from .permissions import nivel_de, NIVEL_ADMIN
        if nivel_de(u) < NIVEL_ADMIN:
            return Response({'detalle': 'Solo Administrador o Gerente usa código de seguridad; un operador (cajero, asesor, técnico) no autoriza acciones.'}, status=400)
        from .seguridad import formato_valido, definir_codigo
        if not formato_valido(nuevo_codigo):
            return Response({'detalle': 'El código de seguridad debe ser de 6 dígitos.'}, status=400)
        definir_codigo(u, str(nuevo_codigo).strip())
        return Response({'detalle': f'Código de seguridad actualizado para {u.username}.', 'usuario': _serialize(u, request=request)})

    # Verificación del correo: la hace el propio cliente al confirmar su correo.
    # El admin NO lo marca desde el panel (ni verificado ni no verificado).
    if 'email_verificado' in d:
        if _es_cliente(u):
            return Response({'detalle': 'La verificación de correo la hace el propio cliente; no se marca desde el panel.'}, status=403)
        from django.utils import timezone
        from .models import PerfilUsuario
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=u)
        perfil.email_verificado = bool(d.get('email_verificado'))
        perfil.email_verificado_en = timezone.now() if perfil.email_verificado else None
        perfil.save(update_fields=['email_verificado', 'email_verificado_en'])
        return Response(_serialize(u, request=request))

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
        if nuevo_rol == 'Cliente':
            return Response({'detalle': 'El rol Cliente no se asigna desde el panel.'}, status=400)
        quedaria_admin = u.is_superuser or u.is_staff or clave_de_grupo(nuevo_rol or '') == CLAVE_ADMIN
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
        _asignar_rol(u, nuevo_rol)
        # Al DEGRADAR (deja de ser autoridad: ya no admin/staff/superuser)
        # se borra su PIN. Un operador no autoriza nada; no debe quedar un código
        # colgando (aunque verificar_codigo ya lo neutraliza por rol).
        es_autoridad_final = u.is_superuser or u.is_staff or clave_de_grupo(nuevo_rol or '') == CLAVE_ADMIN
        if not es_autoridad_final:
            from .models import PerfilUsuario
            PerfilUsuario.objects.filter(usuario=u).exclude(codigo_seguridad='').update(
                codigo_seguridad='', codigo_intentos=0, codigo_bloqueado_hasta=None,
            )

    foto = request.FILES.get('avatar')
    if foto:
        _guardar_foto(u, foto)

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
    return Response(_serialize(u, request=request))
