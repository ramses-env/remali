from datetime import timedelta
from secrets import token_urlsafe

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import generics, permissions, status
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .throttling import (
    CuponThrottle, GoogleLoginThrottle, LoginThrottle,
    RegistroThrottle, CambioPasswordThrottle, RestablecerThrottle,
)

from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon, Notificacion, PerfilUsuario, crear_notificacion,
    ConversacionSoporte, MensajeSoporte, ConfiguracionSitio, CorreoAviso,
    ObraCliente, SelloTema, nombre_propio, espejar_obra_predeterminada,
    Favorito,
)
from .permissions import IsAdminGroupOrStaff, EsOperador, puede_de
from .serializers import (
    EquipoSerializer, CategoriaSerializer, MarcaSerializer, TipoSerializer,
    CuponSerializer, NotificacionSerializer, PerfilUsuarioSerializer,
    ConversacionSoporteListSerializer, ConversacionSoporteDetailSerializer, MensajeSoporteSerializer,
    ConfiguracionSitioSerializer, CorreoAvisoSerializer, ObraClienteSerializer,
    FavoritoSerializer,
)


class ProtectedDestroyMixin:
    """Convierte un PROTECT relacional en un 400 claro para la UI."""
    en_uso_label = 'registro relacionado'
    en_uso_label_plural = 'registros relacionados'

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ProtectedError:
            return Response({
                'detail': f'No se puede eliminar porque tiene {self.en_uso_label_plural}.'
            }, status=status.HTTP_400_BAD_REQUEST)


# ─────────────────────────────────────────────
#  EQUIPOS (catálogo)
# ─────────────────────────────────────────────
class EquipoListCreate(generics.ListCreateAPIView):
    queryset = (Equipo.objects
                .select_related('categoria', 'tipo', 'marca')
                .prefetch_related('unidades', 'imagenes')
                .order_by('id'))
    serializer_class = EquipoSerializer
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['modelo', 'descripcion', 'categoria__nombre', 'marca__nombre', 'tipo__nombre']
    ordering_fields = ['precio_dia', 'fecha_creacion', 'modelo']

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]

    def _filtro_multi(self, qs, param, id_field, nombre_field):
        """Filtra por una lista separada por comas (acepta ids o nombres)."""
        raw = self.request.query_params.get(param)
        if not raw:
            return qs
        vals = [v.strip() for v in raw.split(',') if v.strip()]
        q = Q()
        for v in vals:
            q |= Q(**{id_field: int(v)}) if v.isdigit() else Q(**{nombre_field: v})
        return qs.filter(q) if vals else qs

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        # Venta viene del catálogo (precio de venta); renta sí depende de tener
        # unidades seminuevas en inventario.
        uso = (params.get('uso') or '').strip().lower()
        if uso == 'venta':
            qs = qs.filter(precio_venta__gt=0).distinct()
        elif uso == 'renta':
            qs = qs.filter(
                Q(precio_dia__gt=0) | Q(precio_semana__gt=0) | Q(precio_mes__gt=0),
                unidades__condicion='seminueva',
            ).exclude(unidades__estado='vendido').distinct()

        if params.get('price_min'):
            pm = float(params['price_min'])
            qs = qs.filter(
                Q(precio_dia__gte=pm) | Q(precio_semana__gte=pm) |
                Q(precio_mes__gte=pm) | Q(precio_venta__gte=pm),
            )
        if params.get('price_max'):
            pm = float(params['price_max'])
            qs = qs.filter(
                Q(precio_dia__lte=pm) | Q(precio_semana__lte=pm) |
                Q(precio_mes__lte=pm) | Q(precio_venta__lte=pm),
            )

        qs = self._filtro_multi(qs, 'category', 'categoria_id', 'categoria__nombre__iexact')
        qs = self._filtro_multi(qs, 'brand', 'marca_id', 'marca__nombre__iexact')
        qs = self._filtro_multi(qs, 'type', 'tipo_id', 'tipo__nombre__iexact')

        last_days = params.get('last_days')
        if last_days:
            try:
                desde = timezone.now() - timedelta(days=int(last_days))
                qs = qs.filter(fecha_creacion__gte=desde)
            except ValueError:
                pass
        return qs


class EquipoRetrieveUpdateDestroy(generics.RetrieveUpdateDestroyAPIView):
    queryset = (Equipo.objects
                .select_related('categoria', 'tipo', 'marca')
                .prefetch_related('unidades', 'imagenes'))
    serializer_class = EquipoSerializer

    def get_permissions(self):
        if self.request.method in ('PUT', 'PATCH', 'DELETE'):
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
@parser_classes([MultiPartParser, FormParser])
def upload_product_images(request, pk: int):
    equipo = get_object_or_404(Equipo, id=pk)
    files = request.FILES.getlist('images') or request.FILES.getlist('files') or []
    created = []
    for f in files:
        imagen = ImagenProducto.objects.create(equipo=equipo, imagen=f)
        try:
            created.append(request.build_absolute_uri(imagen.imagen.url))
        except Exception:
            pass
    return Response({'equipo': equipo.id, 'imagenes': created})


# ─────────────────────────────────────────────
#  CATÁLOGOS (categorías / tipos / marcas)
# ─────────────────────────────────────────────
class _CatalogoListCreate(generics.ListCreateAPIView):
    """Base para catálogos: lectura pública, escritura solo admin."""

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]


class CategoriaList(_CatalogoListCreate):
    queryset = Categoria.objects.all().order_by('nombre', 'id')
    serializer_class = CategoriaSerializer


class TipoList(_CatalogoListCreate):
    queryset = Tipo.objects.all().order_by('nombre', 'id')
    serializer_class = TipoSerializer


class MarcaList(_CatalogoListCreate):
    queryset = Marca.objects.all().order_by('nombre', 'id')
    serializer_class = MarcaSerializer


class CategoriaDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [IsAdminGroupOrStaff]


class TipoDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Tipo.objects.all()
    serializer_class = TipoSerializer
    permission_classes = [IsAdminGroupOrStaff]


class MarcaDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Marca.objects.all()
    serializer_class = MarcaSerializer
    permission_classes = [IsAdminGroupOrStaff]


# ─────────────────────────────────────────────
#  CONFIGURACIÓN DEL SITIO
# ─────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def configuracion_publica(request):
    cfg = ConfiguracionSitio.get_solo()
    return Response({
        'whatsapp_principal': cfg.whatsapp_principal,
        'negocio_nombre': cfg.negocio_nombre,
        'negocio_telefono': cfg.negocio_telefono,
        'negocio_direccion': cfg.negocio_direccion,
        'negocio_email': cfg.negocio_email,
        'negocio_web': cfg.negocio_web,
        'negocio_rfc': cfg.negocio_rfc,
        'negocio_representante': cfg.negocio_representante,
        'negocio_footer': cfg.negocio_footer,
        'cotizacion_condiciones': cfg.cotizacion_condiciones,
        'cotizacion_condiciones_renta': cfg.cotizacion_condiciones_renta,
        'datos_bancarios': cfg.datos_bancarios,
        'cotizacion_cierre': cfg.cotizacion_cierre,
        'descuento_contado_pct': cfg.descuento_contado_pct,
        'anticipo_minimo_pct': cfg.anticipo_minimo_pct,
        # El código de autorización ahora es PERSONAL por operador (cada quien el
        # suyo). Las acciones sensibles SIEMPRE lo piden; el panel usa este flag
        # para pedirlo, y `tiene_codigo_seguridad` (de /me) para saber si el
        # operador ya configuró el suyo.
        'ajuste_requiere_codigo': True,
    })


@api_view(['POST'])
@permission_classes([EsOperador])
def validar_codigo_ajuste(request):
    """Valida el CÓDIGO PERSONAL del operador que ejecuta (no uno compartido).
    Solo dice si es correcto para desbloquear el campo en el panel; la acción lo
    vuelve a validar en el servidor. Cuenta intentos fallidos (anti-fuerza-bruta)."""
    from .seguridad import verificar_codigo
    ok, detalle, _status, cod = verificar_codigo(request.user, (request.data or {}).get('codigo'))
    return Response({'valido': ok, 'detalle': detalle, 'codigo': cod})


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])   # solo autoridad (admin/gerente) tiene PIN
def definir_codigo_seguridad(request):
    """Fija o cambia el código de seguridad del PROPIO usuario. Pide su
    contraseña de la cuenta para confirmar identidad (no basta la sesión).

    Solo Administrador/Gerente: el PIN autoriza acciones sensibles y esas las
    aprueba un superior, no un operador. Un cajero/asesor/técnico no tiene PIN."""
    from .seguridad import formato_valido, definir_codigo
    d = request.data or {}
    password = d.get('password') or ''
    codigo = str(d.get('codigo') or '').strip()
    if not request.user.check_password(password):
        return Response({'detalle': 'Tu contraseña de la cuenta es incorrecta.'}, status=403)
    if not formato_valido(codigo):
        return Response({'detalle': 'El código de seguridad debe ser de 6 dígitos.'}, status=400)
    definir_codigo(request.user, codigo)
    return Response({'ok': True, 'detalle': 'Código de seguridad actualizado.'})


class ConfiguracionDetail(generics.RetrieveUpdateAPIView):
    serializer_class = ConfiguracionSitioSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def get_object(self):
        return ConfiguracionSitio.get_solo()


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def verificar_correo_aviso(request):
    token = (request.query_params.get('token') or '').strip()
    if not token:
        return HttpResponse('Token inválido.', status=400)
    correo = CorreoAviso.objects.filter(token=token).first()
    if not correo:
        return HttpResponse('Token inválido.', status=404)
    correo.verificado = True
    correo.verificado_en = timezone.now()
    correo.save(update_fields=['verificado', 'verificado_en'])
    return HttpResponse('Correo verificado. Ya recibirás avisos.', status=200)


class CorreosAvisoList(generics.ListCreateAPIView):
    queryset = CorreoAviso.objects.all().order_by('email')
    serializer_class = CorreoAvisoSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def perform_create(self, serializer):
        serializer.save()


@api_view(['DELETE'])
@permission_classes([IsAdminGroupOrStaff])
def correo_aviso_eliminar(request, pk: int):
    correo = get_object_or_404(CorreoAviso, pk=pk)
    correo.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def correo_aviso_reenviar(request, pk: int):
    correo = get_object_or_404(CorreoAviso, pk=pk)
    correo.nuevo_token()
    correo.verificado = False
    correo.verificado_en = None
    correo.save(update_fields=['token', 'verificado', 'verificado_en'])
    return Response({'ok': True, 'token': correo.token})


# ─────────────────────────────────────────────
#  CUPONES
# ─────────────────────────────────────────────
class CuponListCreate(generics.ListCreateAPIView):
    queryset = Cupon.objects.all().order_by('id')
    serializer_class = CuponSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdminGroupOrStaff()]
        return [permissions.IsAuthenticated()]


class CuponRetrieveUpdateDestroy(generics.RetrieveUpdateDestroyAPIView):
    queryset = Cupon.objects.all()
    serializer_class = CuponSerializer
    permission_classes = [IsAdminGroupOrStaff]


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([CuponThrottle])
def apply_coupon(request):
    """Valida un cupón (código textual) y devuelve el descuento a aplicar.

    Seguridad:
      - Si no existe o está inactivo / usado → 400 genérico (no revela cuál).
      - Si es "personal" (bienvenida), solo sirve para SU dueño.
      - Nunca marcar como usado aquí; el consumo real pasa cuando la cotización
        / pedido acepta el cupón en su transacción correspondiente.
    """
    from decimal import Decimal as _Dec
    codigo = ((request.data or {}).get('code') or (request.data or {}).get('codigo') or '').strip()
    if not codigo:
        return Response({'detail': 'Código requerido.'}, status=400)
    try:
        cupon = Cupon.objects.get(codigo=codigo, activo=True)
    except Cupon.DoesNotExist:
        return Response({'detail': 'Cupón inválido.', 'discount': 0}, status=400)
    if cupon.personal and cupon.usado:
        return Response({'detail': 'Cupón inválido.', 'discount': 0}, status=400)
    if cupon.personal and cupon.usuario_id is not None:
        if not getattr(request.user, 'is_authenticated', False):
            return Response({'detail': 'Inicia sesión para usar este cupón.'}, status=401)
        if cupon.usuario_id != request.user.id:
            return Response({'detail': 'Cupón inválido.', 'discount': 0}, status=400)
    return Response({
        'discount': float(cupon.descuento or _Dec('0')),
        'codigo': cupon.codigo,
        'personal': cupon.personal,
        'usado': bool(cupon.usado),
    })


# ─────────────────────────────────────────────
#  AUTENTICACIÓN / PERFIL
# ─────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    """Login flexible: acepta username o email + password.

    Seguridad: NO revelamos si el correo/usuario existe o no — siempre devolvemos
    el mismo mensaje genérico de credenciales inválidas, tanto si la cuenta no
    existe como si la contraseña es mala o la cuenta está desactivada. Esto
    evita la enumeración de usuarios.
    """
    d = request.data or {}
    username_or_email = (d.get('username') or d.get('email') or d.get('email_usuario') or '').strip()
    password = d.get('password') or ''
    if not username_or_email or not password:
        return Response({'detail': 'username/email y password requeridos'}, status=400)

    from django.contrib.auth import authenticate, get_user_model
    User = get_user_model()
    uname = username_or_email
    # Si parece email, intentamos resolver el username pero NO fallamos si no
    # existe — seguimos adelante con authenticate(), que dará el mismo error
    # genérico independientemente de por qué falló.
    if '@' in uname:
        try:
            encontrado = User.objects.get(email__iexact=uname)
            uname = encontrado.username or uname
        except User.DoesNotExist:
            # No existe: NO nos salimos. Seguimos con authenticate() con un
            # username que no existe para que el timing y la respuesta sean
            # indistinguibles de una contraseña mala.
            pass

    serializer = TokenObtainPairSerializer(data={'username': uname, 'password': password})
    try:
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data)
    except Exception:
        # Intento adicional por authenticate para asegurar coherencia; nunca
        # revelamos si la cuenta existe / está activa.
        return Response({'detail': 'credenciales inválidas'}, status=401)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    u = request.user
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=u)
    from .models import avatar_por_rol

    # Resolvemos avatar con la misma prioridad que el serializer:
    # foto subida → PNG del rol → SVG.
    avatar_url = None
    if getattr(perfil, 'avatar', None):
        try:
            avatar_url = perfil.avatar.url
            host = request.get_host()
            if not (host in ('localhost', '127.0.0.1') and ':' not in host):
                avatar_url = request.build_absolute_uri(avatar_url)
        except Exception:
            avatar_url = None
    if not avatar_url:
        avatar_url = avatar_por_rol(u, absoluta=True, request=request)

    return Response({
        'id': u.id,
        'email': u.email,
        'username': u.username,
        'first_name': u.first_name,
        'last_name': u.last_name,
        'is_staff': u.is_staff,
        'is_superuser': u.is_superuser,
        'groups': list(u.groups.values_list('name', flat=True)),
        'puede': puede_de(u),
        'avatar_url': avatar_url,
        # Siempre disponible, SIN importar si el usuario subió foto. Sirve como
        # segunda capa en el frontend: si avatar_url (foto subida) falla con
        # 404 (ej: Cloudinary borró el asset, enlace expirado), el componente
        # intenta esta URL → PNG del rol o su SVG fallback.
        'avatar_url_rol': avatar_por_rol(u, absoluta=True, request=request),
        'datos_completos': perfil.datos_completos,
        'email_verificado': perfil.email_verificado,
        'perfil_verificado': perfil.perfil_verificado,
        # ¿Este operador ya tiene su código de seguridad? El panel lo usa para
        # nudge ("define tu código") y para saber si puede autorizar acciones.
        'tiene_codigo_seguridad': bool(perfil.codigo_seguridad),
        'onboarding': {
            'completado': perfil.onboarding_completado,
            'pasos_completados': perfil.onboarding_pasos_completados or [],
            'version': perfil.onboarding_version,
        },
    })


class PerfilDetail(generics.RetrieveUpdateAPIView):
    """Perfil del usuario autenticado: ver y editar (incluye avatar)."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = PerfilUsuarioSerializer

    def get_object(self):
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.request.user)
        return perfil


def _enviar_correo_verificacion(user, token):
    """Envía el correo con la liga para confirmar la cuenta.

    Se dispara al registrarse y al pedir un reenvío. La liga apunta al endpoint
    público del backend (GET) que marca el correo como verificado y muestra la
    confirmación. Si el usuario no tiene correo o token, no hace nada.
    """
    if not user or not (getattr(user, 'email', None) or '').strip() or not token:
        return
    from django.conf import settings
    from .correo import enviar_async

    url = f'{settings.BACKEND_URL.rstrip("/")}/api/auth/verificar-correo/{token}/'
    nombre = user.get_full_name() or user.username
    cuerpo = (
        f'Hola {nombre}:\n\n'
        f'Gracias por crear tu cuenta en REMALI. Para activarla, confirma que este '
        f'correo es tuyo abriendo la siguiente liga:\n\n{url}\n\n'
        f'Si no creaste esta cuenta, puedes ignorar este mensaje.\n\n— REMALI'
    )
    enviar_async('Verifica tu correo · REMALI', cuerpo, [user.email])


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([RegistroThrottle])
def registro(request):
    User = get_user_model()
    d = request.data or {}
    email = (d.get('email') or '').strip().lower()
    username = (d.get('username') or email.split('@')[0] or '').strip()
    password = d.get('password') or ''
    if not email or not password:
        return Response({'detail': 'email y password requeridos'}, status=400)
    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'detail': 'correo inválido'}, status=400)
    if len(password) < 8:
        return Response({'detail': 'La contraseña debe tener al menos 8 caracteres.'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'detail': 'Ya existe una cuenta con ese correo.'}, status=400)

    base = username or 'cliente'
    candidato = base
    i = 1
    while User.objects.filter(username__iexact=candidato).exists():
        i += 1
        candidato = f'{base}{i}'

    with transaction.atomic():
        user = User.objects.create_user(
            username=candidato,
            email=email,
            first_name=nombre_propio(d.get('first_name') or d.get('nombre') or ''),
            last_name=nombre_propio(d.get('last_name') or ''),
        )
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        user.groups.add(grupo)
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        perfil.telefono = (d.get('telefono') or '').strip()
        perfil.email_token = token = token_urlsafe(24)
        perfil.save()
        espejar_obra_predeterminada(user)

    _enviar_correo_verificacion(user, token)
    return Response({'ok': True, 'username': user.username, 'email_token': token}, status=201)


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([GoogleLoginThrottle])
def google_login(request):
    """Entrar (o darse de alta) con Google.

    El front manda el `credential`: un id_token firmado por Google. Aquí se
    verifica contra NUESTRO client_id (settings.GOOGLE_CLIENT_ID) —así nadie
    cuela un token emitido para otra app— y, si es válido, se emite el mismo par
    de JWT que el login por contraseña. Un correo de Google llega ya verificado.
    """
    from django.conf import settings
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    credential = (request.data.get('credential') or '').strip()
    if not credential:
        return Response({'detail': 'Falta el credential de Google.'}, status=400)

    try:
        info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=10,
        )
    except ValueError:
        return Response({'detail': 'No se pudo validar tu sesión de Google. Intenta de nuevo.'}, status=401)

    email = (info.get('email') or '').strip().lower()
    if not email:
        return Response({'detail': 'Tu cuenta de Google no compartió un correo.'}, status=400)
    if info.get('email_verified') is False:
        return Response({'detail': 'Tu correo de Google no está verificado.'}, status=400)

    User = get_user_model()
    user = User.objects.filter(email__iexact=email).first()

    if user is None:
        base = (email.split('@')[0] or 'cliente').strip()
        candidato, i = base, 1
        while User.objects.filter(username__iexact=candidato).exists():
            i += 1
            candidato = f'{base}{i}'
        with transaction.atomic():
            user = User.objects.create_user(
                username=candidato,
                email=email,
                password=None,
                first_name=nombre_propio(info.get('given_name') or info.get('name') or ''),
                last_name=nombre_propio(info.get('family_name') or ''),
            )
            grupo, _ = Group.objects.get_or_create(name='Cliente')
            user.groups.add(grupo)
            perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
            perfil.email_verificado = True
            perfil.email_verificado_en = timezone.now()
            perfil.save()
    else:
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        if not perfil.email_verificado:
            perfil.email_verificado = True
            perfil.email_verificado_en = timezone.now()
            perfil.save(update_fields=['email_verificado', 'email_verificado_en'])

    if not user.is_active:
        return Response({'detail': 'Esta cuenta está desactivada.'}, status=403)

    refresh = TokenObtainPairSerializer.get_token(user)
    return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([CambioPasswordThrottle])
def cambiar_password(request):
    actual = request.data.get('password_actual') or ''
    nueva = request.data.get('password_nueva') or ''
    user = request.user
    if not user.check_password(actual):
        return Response({'detail': 'La contraseña actual no coincide.'}, status=400)
    if len(nueva) < 8:
        return Response({'detail': 'La nueva contraseña debe tener al menos 8 caracteres.'}, status=400)
    from django.contrib.auth.password_validation import validate_password as _vp
    try:
        _vp(nueva, user=user)
    except DjangoValidationError as e:
        return Response({'detail': '; '.join(e.messages) if e.messages else 'Contraseña no válida.'}, status=400)
    user.set_password(nueva)
    user.save(update_fields=['password'])
    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        OutstandingToken.objects.filter(user=user).delete()
    except Exception:
        pass
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout(request):
    """Cierra la sesión: invalida el refresh token pasado y todos los pendientes."""
    user = request.user
    try:
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import (
            OutstandingToken, BlacklistedToken,
        )
        refresh = (request.data or {}).get('refresh') or ''
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                pass
        ots = list(OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True))
        for ot in ots:
            try:
                BlacklistedToken.objects.get_or_create(token=ot)
            except Exception:
                pass
    except Exception:
        pass
    return Response({'ok': True})

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([RestablecerThrottle])
def solicitar_restablecer(request):
    """Paso 1 del restablecimiento.

    Si el correo pertenece a una cuenta REAL y activa, se genera un enlace de un
    solo uso (uid + token de Django) y se envía por correo. Si el correo no está
    registrado, NO se hace nada — no tiene caso mandar un enlace a una cuenta que
    no existe. En ambos casos la respuesta es la MISMA (neutra) para no revelar
    qué correos están dados de alta; el front ya muestra "si hay una cuenta, te
    llegó el enlace".
    """
    from django.conf import settings
    from .correo import enviar_async

    email = (request.data.get('email') or '').strip().lower()
    if email:
        User = get_user_model()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user and user.email:
            uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            url = f'{settings.FRONTEND_URL.rstrip("/")}/restablecer/{uidb64}/{token}'
            nombre = user.get_full_name() or user.username
            cuerpo = (
                f'Hola {nombre}:\n\n'
                f'Recibimos una solicitud para restablecer la contraseña de tu cuenta en REMALI.\n'
                f'Abre este enlace para crear una nueva (vence en unas horas):\n\n{url}\n\n'
                f'Si no fuiste tú, ignora este correo: tu contraseña no cambia.\n\n— REMALI'
            )
            enviar_async('Restablece tu contraseña · REMALI', cuerpo, [user.email])

    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def verificar_token_restablecer(request, uidb64: str, token: str):
    User = get_user_model()
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except Exception:
        return Response({'valido': False, 'nombre': ''}, status=400)
    valido = default_token_generator.check_token(user, token)
    nombre = (user.get_full_name() or user.username) if valido else ''
    return Response({'valido': valido, 'nombre': nombre})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def restablecer_password(request):
    User = get_user_model()
    uidb64 = request.data.get('uid') or ''
    token = request.data.get('token') or ''
    password = request.data.get('password') or ''
    if len(password) < 8:
        return Response({'detail': 'La contraseña debe tener al menos 8 caracteres.'}, status=400)
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except Exception:
        return Response({'detail': 'Token inválido.'}, status=400)
    if not default_token_generator.check_token(user, token):
        return Response({'detail': 'Token inválido o vencido.'}, status=400)
    user.set_password(password)
    user.save(update_fields=['password'])
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def verificar_correo_usuario(request, token: str):
    perfil = PerfilUsuario.objects.filter(email_token=token).select_related('usuario').first()
    if not perfil:
        return HttpResponse('Token inválido.', status=404)
    perfil.email_verificado = True
    perfil.email_verificado_en = timezone.now()
    return HttpResponse('Correo verificado correctamente.', status=200)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def reenviar_verificacion(request):
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    perfil.email_token = token_urlsafe(24)
    perfil.email_verificado = False
    perfil.email_verificado_en = None
    perfil.save(update_fields=['email_token', 'email_verificado', 'email_verificado_en'])
    _enviar_correo_verificacion(request.user, perfil.email_token)
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([RestablecerThrottle])
def reenviar_verificacion_publica(request):
    email = (request.data.get('email') or '').strip().lower()
    User = get_user_model()
    user = User.objects.filter(email__iexact=email).first()
    if user:
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        perfil.email_token = token_urlsafe(24)
        perfil.email_verificado = False
        perfil.email_verificado_en = None
        perfil.save(update_fields=['email_token', 'email_verificado', 'email_verificado_en'])
        _enviar_correo_verificacion(user, perfil.email_token)
    return Response({'ok': True})


class ObrasClienteList(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ObraClienteSerializer

    def get_queryset(self):
        return ObraCliente.objects.filter(usuario=self.request.user).order_by('-predeterminada', 'nombre')

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


class ObraClienteDetail(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ObraClienteSerializer

    def get_queryset(self):
        return ObraCliente.objects.filter(usuario=self.request.user)


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def clientes_lookup(request):
    User = get_user_model()
    q = (request.query_params.get('q') or '').strip()
    qs = User.objects.filter(groups__name='Cliente')
    if q:
        qs = qs.filter(
            Q(username__icontains=q) |
            Q(email__icontains=q) |
            Q(first_name__icontains=q) |
            Q(last_name__icontains=q)
        )
    qs = qs.order_by('first_name', 'last_name', 'username')[:20]
    return Response([{
        'username': u.username,
        'email': u.email,
        'nombre': (u.get_full_name() or u.username).strip(),
    } for u in qs])


@api_view(['GET'])
@permission_classes([EsOperador])
def latido_panel(request):
    data = {obj.tema: obj.marca.isoformat() for obj in SelloTema.objects.all()}
    return Response(data)


# ─────────────────────────────────────────────
#  MÉTRICAS / NOTIFICACIONES
# ─────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([EsOperador])
def dashboard_metrics(request):
    return Response({
        'products': Equipo.objects.count(),
        'orders': 0,
        'revenue': 0.0,
    })



def _sync_alertas_vencimiento():
    """Genera notificaciones de rentas vencidas / por vencer (idempotente vía ref)."""
    try:
        from renta.models import Renta  # import diferido para evitar import circular
    except Exception:
        return
    hoy = timezone.localdate()
    activas = Renta.objects.filter(estado='activa').select_related('inventario', 'inventario__equipo')
    for r in activas:
        equipo = r.inventario.equipo.modelo if r.inventario and r.inventario.equipo else 'Equipo'
        cliente = r.cliente or 'Cliente'
        dias = (r.fecha_fin - hoy).days
        if dias < 0:
            crear_notificacion(
                tipo='alerta',
                titulo=f'Renta vencida: {cliente} · {equipo}',
                mensaje=f'{abs(dias)} día(s) de retraso. Folio {r.folio}.',
                seccion='rentas',
                ref=f'vencida-{r.id}',
            )
        elif dias <= 3:
            crear_notificacion(
                tipo='alerta',
                titulo=f'Renta por vencer: {cliente} · {equipo}',
                mensaje=f'Faltan {dias} día(s). Folio {r.folio}.',
                seccion='rentas',
                ref=f'porvencer-{r.id}',
            )


def _tipos_broadcast_por_rol(user):
    """Filtrado de tipos de notificación BROADCAST visibles según el rol.

    La BD guarda `tipo` ∈ {renta, venta, alerta, inventario, sistema}.
    Por cada nivel de acceso, el subconjunto que le corresponde:
      - Cliente (nivel 0): NO ve broadcasts (solo personales).
      - Técnico (nivel 1 mínimo): renta, inventario, alerta, sistema.
      - Cajero (nivel 1): venta, inventario, alerta, sistema, facturación.
      - Admin/Dueño (nivel ≥2): TODO.
    """
    from maquinaria.permissions import nivel_de, NIVEL_ADMIN, NIVEL_GERENTE
    n = nivel_de(user)
    if n >= NIVEL_ADMIN or n >= NIVEL_GERENTE:
        return Q(usuario__isnull=True)
    if n <= 0:
        # cliente / sin acceso: sin broadcasts
        return Q(pk__in=[])
    # Staff nivel 1 (operador / técnico / cajero / asesor): todos los tipos
    # excepto los puramente administrativos. Por ahora dejamos pasar todos
    # los tipos estándar; si alguno es sensible se restringe abajo.
    return Q(usuario__isnull=True)


def _notificaciones_usuario_qs(user):
    """Devuelve el queryset de notificaciones VISIBLES para el usuario actual.

    Reglas:
      - Las notificaciones PERSONALES (usuario=user) siempre llegan, sin excepción.
      - Las broadcasts (usuario__isnull=True) se filtran por rol vía
        _tipos_broadcast_por_rol. Un cliente no ve eventos internos.
    """
    q_personal = Q(usuario=user)
    q_broadcast = _tipos_broadcast_por_rol(user)
    return Notificacion.objects.filter(q_personal | q_broadcast).order_by('-creada', '-id')


class NotificacionesList(generics.ListAPIView):
    """Panel general del admin/operador: las notificaciones que SÍ le tocan ver."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificacionSerializer

    def get_queryset(self):
        _sync_alertas_vencimiento()
        return _notificaciones_usuario_qs(self.request.user)[:200]

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
        return Response({
            'notificaciones': self.get_serializer(qs, many=True).data,
            'no_leidas': no_leidas,
        })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_notificacion_leida(request, pk: int):
    """Marca leída ÚNICAMENTE si la notificación pertenece o es visible
    para el usuario en sesión."""
    visible = _notificaciones_usuario_qs(request.user).filter(pk=pk)
    visible.update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([EsOperador])
def eliminar_notificacion(request, pk: int):
    """Quita UNA notificación del panel del admin (la X del dropdown), de una en
    una. Solo staff; el conteo de no leídas se recalcula para el badge."""
    # Solo borramos notificaciones VISIBLES para él (no las ajenas).
    visible = _notificaciones_usuario_qs(request.user).filter(pk=pk)
    visible.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_todas_leidas(request):
    """Marca leídas solo las notificaciones que el usuario SÍ puede ver."""
    _notificaciones_usuario_qs(request.user).filter(leida=False).update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([EsOperador])
def limpiar_notificaciones(request):
    """Vacía el panel del usuario logueado: borra sus notificaciones broadcast
    VISIBLES (según su rol) y NO toca las personales de nadie (ni las suyas,
    que las gestiona por la ruta /mias/limpiar/)."""
    qs_broadcasts_visibles = _tipos_broadcast_por_rol(request.user)
    Notificacion.objects.filter(qs_broadcasts_visibles).delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def notificaciones_mias(request):
    qs = _notificaciones_usuario_qs(request.user)[:100]
    return Response({
        'notificaciones': NotificacionSerializer(qs, many=True).data,
        'no_leidas': _notificaciones_usuario_qs(request.user).filter(leida=False).count(),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_mias_leidas(request):
    _notificaciones_usuario_qs(request.user).filter(leida=False).update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def limpiar_mias(request):
    """Vacía SOLO las notificaciones PERSONALES del usuario autenticado
    (las broadcast no son suyas: se borran por /limpiar/)."""
    # Borra únicamente aquellas donde usuario=user (personales), no broadcasts
    # compartidos que otros también verían.
    visibles = _notificaciones_usuario_qs(request.user)
    personales = visibles.filter(usuario=request.user)
    personales.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def eliminar_mia(request, pk: int):
    """Elimina una notificación personal del usuario; se recalcula el conteo
    de no leídas exclusivamente para su propio universo."""
    # Restringir a VISIBLES y además que la notificación sea exclusivamente suya
    notif = get_object_or_404(
        _notificaciones_usuario_qs(request.user).filter(Q(pk=pk)),
    )
    # Solo permitir borrar personales del usuario o (si es staff) broadcasts.
    # Si no es staff y la notificación es broadcast → 404 (por seguridad).
    from maquinaria.permissions import nivel_de
    if nivel_de(request.user) <= 0 and notif.usuario_id != request.user.id:
        return Response({'detail': 'No permitido.'}, status=403)
    notif.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
def crear_contacto_soporte(request):
    nombre = (request.data.get('nombre') or '').strip()
    email = (request.data.get('email') or '').strip()
    telefono = (request.data.get('telefono') or '').strip()
    asunto = (request.data.get('asunto') or '').strip()
    mensaje = (request.data.get('mensaje') or '').strip()
    if not mensaje:
        return Response({'detail': 'mensaje requerido'}, status=400)

    conv = ConversacionSoporte.objects.create(
        nombre=nombre,
        email=email,
        telefono=telefono,
        asunto=asunto,
        estado='abierta',
    )
    MensajeSoporte.objects.create(
        conversacion=conv,
        autor_tipo='usuario',
        cuerpo=mensaje,
    )
    conv.save()
    return Response({'id': conv.id})


class ConversacionesSoporteList(generics.ListAPIView):
    permission_classes = [IsAdminGroupOrStaff]
    serializer_class = ConversacionSoporteListSerializer

    def get_queryset(self):
        qs = ConversacionSoporte.objects.all()
        estado = (self.request.query_params.get('estado') or '').strip().lower()
        if estado in ('abierta', 'cerrada'):
            qs = qs.filter(estado=estado)
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(nombre__icontains=q) |
                Q(email__icontains=q) |
                Q(telefono__icontains=q) |
                Q(asunto__icontains=q)
            )
        return qs.order_by('-actualizada', '-id')

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = self.get_serializer(qs, many=True).data
        try:
            no_leidas_total = sum(int(x.get('no_leidos_admin') or 0) for x in data)
        except Exception:
            no_leidas_total = 0
        return Response({'conversaciones': data, 'no_leidas_total': no_leidas_total})


class ConversacionSoporteDetail(generics.RetrieveAPIView):
    permission_classes = [IsAdminGroupOrStaff]
    serializer_class = ConversacionSoporteDetailSerializer
    queryset = ConversacionSoporte.objects.all()

    def retrieve(self, request, *args, **kwargs):
        obj = self.get_object()
        obj.last_read_admin = timezone.now()
        obj.save(update_fields=['last_read_admin', 'actualizada'])
        data = self.get_serializer(obj).data
        return Response(data)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def responder_soporte(request, pk: int):
    conv = get_object_or_404(ConversacionSoporte, pk=pk)
    cuerpo = (request.data.get('mensaje') or request.data.get('cuerpo') or '').strip()
    if not cuerpo:
        return Response({'detail': 'mensaje requerido'}, status=400)
    m = MensajeSoporte.objects.create(
        conversacion=conv,
        autor_tipo='admin',
        autor_admin=request.user,
        cuerpo=cuerpo,
    )
    conv.last_read_admin = timezone.now()
    conv.save(update_fields=['last_read_admin', 'actualizada'])
    return Response(MensajeSoporteSerializer(m).data)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def cerrar_conversacion_soporte(request, pk: int):
    conv = get_object_or_404(ConversacionSoporte, pk=pk)
    conv.estado = 'cerrada'
    conv.save(update_fields=['estado', 'actualizada'])
    return Response({'ok': True, 'estado': conv.estado})


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def abrir_conversacion_soporte(request, pk: int):
    conv = get_object_or_404(ConversacionSoporte, pk=pk)
    conv.estado = 'abierta'
    conv.save(update_fields=['estado', 'actualizada'])
    return Response({'ok': True, 'estado': conv.estado})


# ─────────────────────────────────────────────
#  ONBOARDING — guía de primer uso para clientes
# ─────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def onboarding_estado(request):
    """Devuelve el estado actual del onboarding para el usuario autenticado."""
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    return Response({
        'completado': perfil.onboarding_completado,
        'pasos_completados': perfil.onboarding_pasos_completados or [],
        'version': perfil.onboarding_version,
        'iniciado_en': perfil.onboarding_iniciado_en.isoformat() if perfil.onboarding_iniciado_en else None,
        'finalizado_en': perfil.onboarding_finalizado_en.isoformat() if perfil.onboarding_finalizado_en else None,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def onboarding_registrar_paso(request):
    """Marca un paso o tour individual como completado (idempotente)."""
    paso_id = (request.data.get('paso_id') or request.data.get('tour_id') or '').strip()
    if not paso_id:
        return Response({'detalle': 'paso_id es requerido'}, status=400)
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    if perfil.onboarding_iniciado_en is None:
        perfil.onboarding_iniciado_en = timezone.now()
    pasos = list(perfil.onboarding_pasos_completados or [])
    if paso_id not in pasos:
        pasos.append(paso_id)
        perfil.onboarding_pasos_completados = pasos
    perfil.save(update_fields=['onboarding_pasos_completados', 'onboarding_iniciado_en'])
    return Response({'ok': True, 'pasos_completados': perfil.onboarding_pasos_completados})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def onboarding_completar(request):
    """Marca todo el onboarding como completado."""
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    if perfil.onboarding_iniciado_en is None:
        perfil.onboarding_iniciado_en = timezone.now()
    perfil.onboarding_completado = True
    perfil.onboarding_finalizado_en = timezone.now()
    perfil.save(update_fields=[
        'onboarding_completado', 'onboarding_iniciado_en',
        'onboarding_finalizado_en', 'fecha_actualizacion',
    ])
    return Response({'ok': True, 'completado': True, 'finalizado_en': perfil.onboarding_finalizado_en.isoformat()})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def onboarding_reiniciar(request):
    """Reinicia el onboarding (repite la guía)."""
    version_destino = int(request.data.get('version') or 1)
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    perfil.onboarding_completado = False
    perfil.onboarding_pasos_completados = []
    perfil.onboarding_iniciado_en = None
    perfil.onboarding_finalizado_en = None
    perfil.onboarding_version = max(perfil.onboarding_version, version_destino)
    perfil.save(update_fields=[
        'onboarding_completado', 'onboarding_pasos_completados',
        'onboarding_iniciado_en', 'onboarding_finalizado_en',
        'onboarding_version', 'fecha_actualizacion',
    ])
    return Response({
        'ok': True,
        'version': perfil.onboarding_version,
        'completado': perfil.onboarding_completado,
    })


# ─────────────────────────────────────────────
#  FAVORITOS
# ─────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def favoritos_listar(request):
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    qs = (Favorito.objects
          .filter(perfil=perfil)
          .select_related('equipo', 'equipo__categoria', 'equipo__tipo', 'equipo__marca')
          .prefetch_related('equipo__unidades', 'equipo__imagenes')
          .order_by('-fecha_agregado', '-id'))
    serializer = FavoritoSerializer(qs, many=True, context={'request': request})
    ids_ordenados = [f['equipo']['id'] for f in serializer.data if f.get('equipo')]
    return Response({
        'items': serializer.data,
        'ids': ids_ordenados,
        'total': len(ids_ordenados),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def favoritos_toggle(request):
    equipo_id = request.data.get('equipo_id')
    if not equipo_id:
        return Response({'detalle': 'equipo_id es requerido'}, status=400)
    try:
        equipo = Equipo.objects.get(pk=equipo_id)
    except Equipo.DoesNotExist:
        return Response({'detalle': 'Equipo no encontrado'}, status=404)
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    existente = Favorito.objects.filter(perfil=perfil, equipo=equipo).first()
    if existente:
        existente.delete()
        agregado = False
    else:
        Favorito.objects.create(perfil=perfil, equipo=equipo)
        agregado = True
    ids = list(Favorito.objects.filter(perfil=perfil).order_by('-fecha_agregado', '-id').values_list('equipo_id', flat=True))
    return Response({
        'ok': True,
        'agregado': agregado,
        'equipo_id': equipo.id,
        'ids': ids,
        'total': len(ids),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def favoritos_fusionar(request):
    """
    Fusiona favoritos anónimos (listado de IDs enviado por el front) con los
    favoritos ya existentes en BD. Este endpoint se llama justo después de
    login/registro exitoso. Es idempotente.
    """
    ids_anonimos = request.data.get('ids') or []
    try:
        ids_anonimos = [int(x) for x in list(ids_anonimos)][:1000]
    except (TypeError, ValueError):
        return Response({'detalle': 'ids debe ser lista de enteros'}, status=400)
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    existentes = set(Favorito.objects.filter(perfil=perfil).values_list('equipo_id', flat=True))
    nuevos = [eid for eid in ids_anonimos if eid not in existentes]
    creados = 0
    if nuevos:
        equipos_validos = set(Equipo.objects.filter(id__in=nuevos).values_list('id', flat=True))
        bulk = []
        ahora = timezone.now()
        for eid in equipos_validos:
            bulk.append(Favorito(perfil=perfil, equipo_id=eid, fecha_agregado=ahora))
        if bulk:
            # usamos bulk_create con ignore_conflicts por si unique_together atrapa alguno
            Favorito.objects.bulk_create(bulk, ignore_conflicts=True, batch_size=200)
            creados = len(equipos_validos)
    ids = list(Favorito.objects.filter(perfil=perfil).order_by('-fecha_agregado', '-id').values_list('equipo_id', flat=True))
    return Response({
        'ok': True,
        'fusionados': creados,
        'ids': ids,
        'total': len(ids),
    })
