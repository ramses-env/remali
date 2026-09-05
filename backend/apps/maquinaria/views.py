import hashlib
import logging
from datetime import timedelta
from secrets import token_urlsafe

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.db.models import Case, IntegerField, Q, Value, When
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import generics, permissions, status
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import (
    api_view, authentication_classes, permission_classes, parser_classes, throttle_classes,
)
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .throttling import (
    CuponThrottle, GoogleLoginThrottle, LoginThrottle,
    RegistroThrottle, CambioPasswordThrottle, RestablecerThrottle,
    RestablecerUsoThrottle,
)

from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon, Notificacion, PerfilUsuario, crear_notificacion,
    ConversacionSoporte, MensajeSoporte, ConfiguracionSitio, CorreoAviso,
    ObraCliente, SelloTema, nombre_propio, espejar_obra_predeterminada,
    Favorito,
)
from .permissions import (
    IsAdminGroupOrStaff, EsOperador, NoEsDelNegocio, PuedeConfigurarNegocio,
    PuedeEditarCatalogo, PuedeEmitirCupones, PuedeTenerCodigoPropio,
    PuedeVerDinero, nivel_de, puede_de,
)
from .serializers import (
    EquipoSerializer, CategoriaSerializer, MarcaSerializer, TipoSerializer,
    CuponSerializer, NotificacionSerializer, PerfilUsuarioSerializer,
    ConversacionSoporteListSerializer, ConversacionSoporteDetailSerializer, MensajeSoporteSerializer,
    ConfiguracionSitioSerializer, CorreoAvisoSerializer, ObraClienteSerializer,
    FavoritoSerializer,
)
from server.rastro import tragado
from .cupones import cupon_personal, cupon_valido_para

logger = logging.getLogger(__name__)


class ProtectedDestroyMixin:
    """Convierte un PROTECT relacional en un 400 claro para la UI, y exige la
    capacidad de BORRAR del catálogo.

    Agregar al catálogo es de administración; quitar es del dueño. Borrar un
    producto o una unidad es como se encubre una máquina que falta: si no está en
    el sistema, nadie la busca. El candado vive aquí —en el mixin que envuelven
    todas las vistas de catálogo— y no repetido en cada una, para que agregar una
    vista nueva no abra el hueco por olvido.
    """
    en_uso_label = 'registro relacionado'
    en_uso_label_plural = 'registros relacionados'

    def destroy(self, request, *args, **kwargs):
        from .permissions import puede_de
        if not puede_de(request.user).get('borrar_catalogo'):
            return Response({
                'detalle': 'Solo el dueño puede borrar del catálogo. Si ya no se usa, '
                           'desactívalo en vez de borrarlo.',
                'codigo': 'sin_permiso_borrar',
            }, status=status.HTTP_403_FORBIDDEN)
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
    # La capacidad se declara aquí, y no solo dentro de `get_permissions`, para
    # que la auditoría de capacidades la vea (ver `tests_permisos_imponen`):
    # un gate escondido en el método es un gate que nadie sabe que existe.
    permission_classes = [PuedeEditarCatalogo]

    def get_permissions(self):
        # Leer el catálogo es la tienda pública. Escribirlo cambia el patrimonio.
        if self.request.method == 'POST':
            return super().get_permissions()
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


class EquipoRelacionados(generics.ListAPIView):
    """Los equipos que se parecen a este: misma categoría primero, y si no
    alcanzan, se rellena con el resto del catálogo.

    Existe para no mandarle el catálogo COMPLETO al navegador cada vez que
    alguien abre una ficha. La tienda pedía `/equipos/` entero —sin paginar, con
    sus imágenes y su veintena de campos calculados por equipo— para quedarse con
    cuatro tarjetas y tirar el resto. Aquí el recorte lo hace la base de datos,
    que es quien puede hacerlo con un LIMIT.
    """
    serializer_class = EquipoSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    LIMITE_MAX = 12

    def get_queryset(self):
        equipo = get_object_or_404(Equipo, pk=self.kwargs['pk'])
        try:
            limite = int(self.request.query_params.get('limit') or 4)
        except ValueError:
            limite = 4
        limite = max(1, min(limite, self.LIMITE_MAX))

        base = (Equipo.objects
                .select_related('categoria', 'tipo', 'marca')
                .prefetch_related('unidades', 'imagenes')
                .exclude(pk=equipo.pk))

        # Misma categoría primero. `Case/When` en vez de dos consultas: así el
        # LIMIT lo aplica el motor sobre el conjunto ya ordenado y no hay que
        # traer el sobrante para descartarlo aquí.
        mismos = Case(
            When(categoria_id=equipo.categoria_id, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        ) if equipo.categoria_id else Value(1, output_field=IntegerField())

        return base.annotate(_afinidad=mismos).order_by('_afinidad', '-fecha_creacion', 'id')[:limite]


class EquipoRetrieveUpdateDestroy(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    en_uso_label_plural = 'unidades o movimientos'
    queryset = (Equipo.objects
                .select_related('categoria', 'tipo', 'marca')
                .prefetch_related('unidades', 'imagenes'))
    serializer_class = EquipoSerializer
    permission_classes = [PuedeEditarCatalogo]

    def get_permissions(self):
        # BORRAR no se queda aquí de adorno: `ProtectedDestroyMixin` lo vuelve a
        # pesar contra `borrar_catalogo`, que es del dueño.
        if self.request.method in ('PUT', 'PATCH', 'DELETE'):
            return super().get_permissions()
        return [permissions.AllowAny()]

    PRECIOS = ('precio_dia', 'precio_semana', 'precio_mes', 'precio_venta')

    def perform_update(self, serializer):
        """Guarda el cambio y, si tocó un precio de lista, deja rastro de quién.

        Cambiar precios es trabajo legítimo de administración y por eso no se
        bloquea. Pero bajar el precio de lista y vender "a precio normal" es la
        forma más discreta de sacar dinero por diferencia, y a diferencia del
        ajuste en una venta puntual no dejaba ninguna huella. Ahora sí.
        """
        antes = {c: getattr(serializer.instance, c) for c in self.PRECIOS}
        equipo = serializer.save()
        from .models import CambioPrecioLista
        from .permissions import rol_de
        user = self.request.user if self.request.user.is_authenticated else None
        for campo in self.PRECIOS:
            viejo_v, nuevo_v = antes[campo], getattr(equipo, campo)
            if viejo_v == nuevo_v:
                continue
            CambioPrecioLista.objects.create(
                equipo=equipo, campo=campo, anterior=viejo_v, nuevo=nuevo_v,
                usuario=user, rol=rol_de(user) if user else '',
            )


@api_view(['POST'])
@permission_classes([PuedeEditarCatalogo])
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
            tragado()
    return Response({'equipo': equipo.id, 'imagenes': created})


# ─────────────────────────────────────────────
#  CATÁLOGOS (categorías / tipos / marcas)
# ─────────────────────────────────────────────
class _CatalogoListCreate(generics.ListCreateAPIView):
    """Base para catálogos: lectura pública, escritura por `editar_catalogo`."""

    permission_classes = [PuedeEditarCatalogo]

    def get_permissions(self):
        if self.request.method == 'POST':
            return super().get_permissions()
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


# Los tres catálogos chicos llevan `ProtectedDestroyMixin` por la misma razón
# que equipos y unidades: BORRAR es del dueño (`borrar_catalogo`). Sin el mixin,
# cualquier administración borraba una marca entera sin pasar por ese candado.
class CategoriaDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [PuedeEditarCatalogo]


class TipoDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Tipo.objects.all()
    serializer_class = TipoSerializer
    permission_classes = [PuedeEditarCatalogo]


class MarcaDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Marca.objects.all()
    serializer_class = MarcaSerializer
    permission_classes = [PuedeEditarCatalogo]


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
        # Personalización del ticket: la caja la necesita para imprimir igual en
        # todas las computadoras (el logo incluido, ya en 1 bit).
        'ticket_logo': cfg.ticket_logo,
        'ticket_logo_escala': cfg.ticket_logo_escala,
        'ticket_mostrar_logo': cfg.ticket_mostrar_logo,
        'ticket_lema': cfg.ticket_lema,
        'ticket_mostrar_direccion': cfg.ticket_mostrar_direccion,
        'ticket_mostrar_telefono': cfg.ticket_mostrar_telefono,
        'ticket_mostrar_rfc': cfg.ticket_mostrar_rfc,
        'ticket_mostrar_web': cfg.ticket_mostrar_web,
        'ticket_codigo_barras': cfg.ticket_codigo_barras,
        'ticket_leyenda': cfg.ticket_leyenda,
        'descuento_contado_pct': cfg.descuento_contado_pct,
        'anticipo_minimo_pct': cfg.anticipo_minimo_pct,
        'renta_liquidacion_minima_pct': cfg.renta_liquidacion_minima_pct,
        # El listón de arriba de la tienda, YA RESUELTO: llega el objeto o llega
        # None. La decisión de si está vivo se toma aquí y no en el navegador
        # porque depende de una fecha, y la del visitante puede estar en otro
        # huso, mal puesta, o ser la de ayer. Un aviso vencido que sigue
        # saliendo porque el reloj de un teléfono va atrasado es justo el tipo
        # de error que nadie reporta y todos ven.
        'aviso': _aviso_publico(cfg),
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
# El GESTOR no tiene NIP de fábrica: para él la autorización es el del DUEÑO, y
# si pudiera ponerse el suyo se autorizaría solo. Se pregunta por CAPACIDAD y no
# por nombre de puesto, así que el reparto de la pantalla de Permisos manda.
@permission_classes([PuedeTenerCodigoPropio])
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
    permission_classes = [PuedeConfigurarNegocio]

    def get_object(self):
        return ConfiguracionSitio.get_solo()


def _aviso_publico(cfg):
    """El aviso de la tienda si está vivo, o None.

    Vivo = encendido, con texto, y sin fecha o con fecha que no ha pasado.
    `aviso_hasta` es INCLUSIVO: una promoción "hasta el 30" se ve el 30 entero.
    """
    if not cfg.aviso_activo or not (cfg.aviso_texto or '').strip():
        return None
    if cfg.aviso_hasta and cfg.aviso_hasta < timezone.localdate():
        return None
    liga = (cfg.aviso_liga or '').strip()
    return {
        'texto': cfg.aviso_texto.strip(),
        'liga': liga,
        'liga_texto': (cfg.aviso_liga_texto or '').strip() or ('Ver más' if liga else ''),
        # Huella del CONTENIDO. El navegador la usa para recordar cuál aviso
        # cerró el visitante: si mañana cambia el texto, la huella cambia y la
        # barra vuelve a salir. Sin esto, quien cerró el aviso de agosto no
        # vería nunca el de diciembre.
        'id': hashlib.sha1(f'{cfg.aviso_texto}|{liga}'.encode()).hexdigest()[:12],
    }


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
    permission_classes = [PuedeConfigurarNegocio]

    def perform_create(self, serializer):
        serializer.save()


@api_view(['DELETE'])
@permission_classes([PuedeConfigurarNegocio])
def correo_aviso_eliminar(request, pk: int):
    correo = get_object_or_404(CorreoAviso, pk=pk)
    correo.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([PuedeConfigurarNegocio])
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
    # `emitir_cupones`, no un nivel: listar cupones exponía TODOS los códigos a
    # cualquier cliente registrado (podía cosechar los genéricos reutilizables y
    # aplicarlos sin habérsele emitido). El cliente valida su código puntual por
    # `apply_coupon`, no necesita enumerar la lista. Va en `permission_classes` y
    # no en `get_permissions()` para que la auditoría de capacidades la vea.
    queryset = Cupon.objects.all().order_by('id')
    serializer_class = CuponSerializer
    permission_classes = [PuedeEmitirCupones]


class CuponRetrieveUpdateDestroy(generics.RetrieveUpdateDestroyAPIView):
    queryset = Cupon.objects.all()
    serializer_class = CuponSerializer
    permission_classes = [PuedeEmitirCupones]


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([CuponThrottle])
def apply_coupon(request):
    """Valida un cupón y devuelve su descuento, para enseñarlo antes de enviar."""
    from decimal import Decimal as _Dec
    codigo = ((request.data or {}).get('code') or (request.data or {}).get('codigo') or '')
    cupon, motivo = cupon_valido_para(codigo, request.user)
    if cupon is None:
        estado = 401 if 'Inicia sesión' in (motivo or '') else 400
        return Response({'detail': motivo, 'discount': 0}, status=estado)
    return Response({
        'discount': float(cupon.descuento or _Dec('0')),
        'codigo': cupon.codigo,
        'personal': cupon.personal,
        'usado': bool(cupon.usado),
    })


# ─────────────────────────────────────────────
#  AUTENTICACIÓN / PERFIL
# ─────────────────────────────────────────────

def _set_refresh_cookie(response, refresh_str):
    """Guarda el REFRESH token en una cookie httpOnly (JS no la lee → a prueba de
    robo por XSS). `secure` solo en producción (en dev es http://localhost).
    `SameSite=Lax` + `path` acotado a /api/auth/ = no viaja en el resto de la API
    ni en peticiones cross-site (anti-CSRF)."""
    from django.conf import settings
    max_age = int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds())
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME, refresh_str,
        max_age=max_age, httponly=True, secure=not settings.DEBUG,
        samesite='Lax', path=settings.REFRESH_COOKIE_PATH,
    )
    return response


def _clear_refresh_cookie(response):
    from django.conf import settings
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH)
    return response


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def refrescar_token(request):
    """Renueva el access token usando el refresh de la cookie httpOnly.

    El refresh NUNCA viaja en el body ni es legible por JS. Con rotación activada,
    cada renovación emite un refresh nuevo (y quema el anterior): se re-guarda en
    la cookie. Si el refresh no sirve (vencido/en lista negra), se borra la cookie
    y el front manda a login."""
    from django.conf import settings
    from rest_framework_simplejwt.serializers import TokenRefreshSerializer
    raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME) or (request.data or {}).get('refresh') or ''
    if not raw:
        return Response({'detail': 'Sin sesión que renovar.'}, status=401)
    ser = TokenRefreshSerializer(data={'refresh': raw})
    try:
        ser.is_valid(raise_exception=True)
    except Exception:
        return _clear_refresh_cookie(Response({'detail': 'Sesión expirada.'}, status=401))
    data = ser.validated_data
    resp = Response({'access': data['access']})
    if data.get('refresh'):
        _set_refresh_cookie(resp, data['refresh'])
    return resp

@api_view(['POST'])
# Igual que registro: entrar con una sesión vieja colgando no puede depender de
# que ese token siga sirviendo. Es justo cuando NO sirve que la gente viene aquí.
@authentication_classes([])
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
        data = serializer.validated_data
    except Exception:
        # Nunca revelamos si la cuenta existe / está activa: mismo mensaje para
        # contraseña mala, cuenta inexistente y cuenta desactivada.
        return Response({'detail': 'credenciales inválidas'}, status=401)

    # ── Candado de correo real ──
    # El registro promete "confirma tu correo para entrar", y aquí se cumple: la
    # cuenta de CLIENTE no entra hasta abrir la liga que le llegó. Va DESPUÉS de
    # validar la contraseña, así que no sirve para averiguar qué correos existen.
    # Al equipo NO se le aplica: sus cuentas las da de alta el panel (nadie se
    # registra a sí mismo), y dejar al dueño fuera de su propio sistema por un
    # correo sin confirmar sería peor que el problema que esto evita.
    cuenta = serializer.user
    if nivel_de(cuenta) <= 0:
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=cuenta)
        if not perfil.email_verificado:
            # El correo se devuelve a propósito: quien llega aquí ya demostró que
            # la contraseña es suya, así que no se filtra nada, y el front puede
            # ofrecer "reenviar" sin pedirle que lo vuelva a teclear.
            return Response({
                'detail': 'Confirma tu correo para entrar. Te enviamos una liga cuando creaste la cuenta.',
                'codigo': 'correo_sin_verificar',
                'email': cuenta.email,
            }, status=403)

    # El refresh va en cookie httpOnly (no en el body): que JS no lo toque.
    resp = Response({'access': data['access']})
    return _set_refresh_cookie(resp, data['refresh'])


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
        # El 5% de bienvenida viaja AQUÍ y no solo en /auth/perfil/ para que el
        # armador de la cotización pueda ofrecerlo de un toque sin pedir otra
        # vuelta a la red. Un cupón que el cliente tiene que ir a buscar a otra
        # pantalla y teclear de memoria es un cupón que no se usa.
        'cupon': cupon_personal(u),
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


# La liga del correo no solo verifica: deja la sesión abierta. Eso la vuelve una
# llave de la cuenta, y una llave que no caduca acaba olvidada en un buzón viejo.
def _nuevo_codigo_verificacion(perfil):
    """Emite un código nuevo y devuelve el claro para el correo.

    Vive aquí y no copiado en registro/reenviar porque emitir es también
    invalidar el anterior: un sitio que lo olvide deja dos códigos vivos.
    """
    from .otp import emitir
    return emitir(perfil)


def _enviar_codigo_verificacion(user, codigo):
    """Manda el código de 6 dígitos para confirmar la cuenta.

    Ya no va una liga. Una liga la abren solos los escáneres de correo
    (SafeLinks, antivirus corporativos) y quemaban el token antes que el
    usuario — este archivo ya había tenido que dejar de usar GET por eso. Un
    código no se puede "hacer clic" por accidente.

    El código va también en el ASUNTO: muchos clientes enseñan el asunto en la
    notificación, así que se puede leer sin abrir nada.

    Va en TEXTO PLANO. Se probó en HTML y caía fuera de Recibidos mientras el
    texto llegaba a la bandeja principal: sin SPF ni DKIM en el dominio, Gmail
    perdona uno y castiga el otro. El texto vive en `plantillas_correo`.
    """
    if not user or not (getattr(user, 'email', None) or '').strip() or not codigo:
        return
    from .correo import enviar_async
    from .otp import VIGENCIA
    from .plantillas_correo import correo_codigo

    minutos = int(VIGENCIA.total_seconds() // 60)
    nombre = user.get_full_name() or user.username
    asunto, texto = correo_codigo(nombre, codigo, minutos)
    enviar_async(asunto, texto, [user.email])


@api_view(['POST'])
# Sin autenticación, por la MISMA razón que solicitar_restablecer: quien viene a
# crear una cuenta suele traer un access viejo en el navegador (se registró antes,
# probó algo, se le venció la sesión). DRF valida ese token ANTES de mirar el
# AllowAny, contesta 401, y esta vista nunca corre — la cuenta no se crea y el
# usuario ve un botón que "no hace nada".
@authentication_classes([])
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
    # Las MISMAS reglas que cambiar o restablecer la contraseña: si aquí se cuela
    # una clave débil, la cuenta nace con ella y nada la obliga a cambiarla.
    from django.contrib.auth.password_validation import validate_password
    try:
        # Con un usuario (aún sin guardar) también se checa que la contraseña no
        # sea el propio correo o nombre, que es lo que la gente teclea de prisa.
        validate_password(password, user=User(
            username=username, email=email,
            first_name=(d.get('first_name') or d.get('nombre') or ''),
            last_name=(d.get('last_name') or ''),
        ))
    except DjangoValidationError as e:
        return Response({'detail': '; '.join(e.messages) if e.messages else 'Contraseña no válida.'}, status=400)

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
            # SIN esto la cuenta nacía con contraseña inutilizable: el cliente se
            # registraba, y su propia clave no servía para entrar (login siempre
            # "credenciales inválidas") sin más salida que "olvidé mi contraseña".
            password=password,
            first_name=nombre_propio(d.get('first_name') or d.get('nombre') or ''),
            last_name=nombre_propio(d.get('last_name') or ''),
        )
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        user.groups.add(grupo)
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        perfil.telefono = (d.get('telefono') or '').strip()
        codigo = _nuevo_codigo_verificacion(perfil)
        perfil.save()
        espejar_obra_predeterminada(user)
        # La cuenta entra al padrón como CONTACTO SIN CLIENTE, y REMALI recibe
        # el aviso para vincularla a mano. No se une por teléfono sola.
        from clientes.resolucion import registrar_cuenta_nueva
        registrar_cuenta_nueva(user)

    _enviar_codigo_verificacion(user, codigo)
    # NO devolvemos el código: si viaja en la respuesta, cualquiera podría
    # "verificar" el correo sin tener acceso al buzón, que es exactamente lo que
    # la verificación existe para probar. Solo llega por correo.
    # El correo SÍ vuelve: la pantalla del código lo necesita para pedir la
    # comprobación (el código solo no identifica a nadie) y para enseñarlo.
    return Response({'ok': True, 'username': user.username, 'email': user.email}, status=201)


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
            # Entrar con Google también es darse de alta: mismo trato que el
            # registro normal, o esas cuentas nunca aparecerían en la bandeja.
            from clientes.resolucion import registrar_cuenta_nueva
            registrar_cuenta_nueva(user)
    else:
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        if not perfil.email_verificado:
            perfil.email_verificado = True
            perfil.email_verificado_en = timezone.now()
            perfil.save(update_fields=['email_verificado', 'email_verificado_en'])

    if not user.is_active:
        return Response({'detail': 'Esta cuenta está desactivada.'}, status=403)

    refresh = TokenObtainPairSerializer.get_token(user)
    resp = Response({'access': str(refresh.access_token)})
    return _set_refresh_cookie(resp, str(refresh))


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
        tragado()
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
        from django.conf import settings
        refresh = request.COOKIES.get(settings.REFRESH_COOKIE_NAME) or (request.data or {}).get('refresh') or ''
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                tragado()
        ots = list(OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True))
        for ot in ots:
            try:
                BlacklistedToken.objects.get_or_create(token=ot)
            except Exception:
                tragado()
    except Exception:
        tragado()
    return _clear_refresh_cookie(Response({'ok': True}))

@api_view(['POST'])
# Sin autenticación: quien viene a restablecer puede traer en el navegador un
# access token viejo o vencido. Si DRF intenta validarlo, contesta 401 ANTES de
# llegar aquí y el usuario nunca ve el formulario, aunque la vista sea pública.
@authentication_classes([])
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
                f'Abre este enlace para crear una nueva (vence en 1 hora):\n\n{url}\n\n'
                f'Si no fuiste tú, ignora este correo: tu contraseña no cambia.\n\n— REMALI'
            )
            enviar_async('Restablece tu contraseña · REMALI', cuerpo, [user.email])

    return Response({'ok': True})


@api_view(['GET'])
@authentication_classes([])       # ver nota en solicitar_restablecer
@permission_classes([permissions.AllowAny])
@throttle_classes([RestablecerUsoThrottle])
def verificar_token_restablecer(request, uidb64: str, token: str):
    User = get_user_model()
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except Exception:
        # Mismo 200 "no vale" que un token malo: si el uid inexistente diera 400
        # y el existente 200, la diferencia sirve para averiguar qué cuentas hay.
        return Response({'valido': False, 'nombre': ''})
    valido = default_token_generator.check_token(user, token)
    nombre = (user.get_full_name() or user.username) if valido else ''
    return Response({'valido': valido, 'nombre': nombre})


def _cerrar_sesiones_de(user) -> int:
    """Invalida TODOS los refresh tokens vivos del usuario (cierra sus sesiones
    en cualquier dispositivo/pestaña). Los access tokens ya emitidos siguen
    valiendo hasta caducar (máx. su lifetime); sin refresh no se pueden renovar.
    Nunca lanza: si el blacklist no está disponible, cambiar la contraseña NO
    debe romperse por esto."""
    try:
        from rest_framework_simplejwt.token_blacklist.models import (
            OutstandingToken, BlacklistedToken,
        )
        cerradas = 0
        for t in OutstandingToken.objects.filter(user=user):
            _, creado = BlacklistedToken.objects.get_or_create(token=t)
            cerradas += int(creado)
        return cerradas
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            'No se pudieron cerrar las sesiones tras cambiar la contraseña'
        )
        return 0


@api_view(['POST'])
@authentication_classes([])       # ver nota en solicitar_restablecer
@permission_classes([permissions.AllowAny])
@throttle_classes([RestablecerUsoThrottle])
def restablecer_password(request):
    from django.contrib.auth.password_validation import validate_password

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
        return Response({'detail': 'El enlace no es válido o ya venció.'}, status=400)
    if not default_token_generator.check_token(user, token):
        return Response({'detail': 'El enlace no es válido o ya venció.'}, status=400)
    # Las MISMAS reglas que cambiar la contraseña desde el panel: sin esto, por
    # correo se podía dejar una clave ("12345678") que el panel sí rechaza.
    try:
        validate_password(password, user=user)
    except DjangoValidationError as e:
        return Response({'detail': '; '.join(e.messages) if e.messages else 'Contraseña no válida.'}, status=400)
    user.set_password(password)
    user.save(update_fields=['password'])
    # Restablecer la contraseña PRUEBA que el buzón es suyo: el enlace solo llegó
    # ahí. Así que el correo queda confirmado — si no, el candado del login lo
    # dejaría fuera después de haber hecho todo bien, sin salida visible.
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
    if not perfil.email_verificado:
        from .otp import CAMPOS
        perfil.email_verificado = True
        perfil.email_verificado_en = timezone.now()
        # Un código de verificación vivo ya no hace falta y no debe quedarse
        # esperando: el buzón acaba de probarse por otra vía.
        perfil.email_otp = ''
        perfil.email_otp_creado = None
        perfil.email_otp_intentos = 0
        perfil.email_otp_bloqueado_hasta = None
        perfil.save(update_fields=CAMPOS + ['email_verificado', 'email_verificado_en'])
    # La contraseña cambió: cierra TODAS las sesiones vivas de la cuenta (otros
    # dispositivos/pestañas) invalidando sus refresh tokens. La sesión del
    # navegador actual ya la cierra el frontend al terminar el restablecimiento.
    _cerrar_sesiones_de(user)
    return Response({'ok': True})


@api_view(['POST'])
@authentication_classes([])       # ver nota en solicitar_restablecer
@permission_classes([permissions.AllowAny])
@throttle_classes([RestablecerUsoThrottle])
def restablecer_password(request):
    from django.contrib.auth.password_validation import validate_password

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
        return Response({'detail': 'El enlace no es válido o ya venció.'}, status=400)
    if not default_token_generator.check_token(user, token):
        return Response({'detail': 'El enlace no es válido o ya venció.'}, status=400)
    # Las MISMAS reglas que cambiar la contraseña desde el panel: sin esto, por
    # correo se podía dejar una clave ("12345678") que el panel sí rechaza.
    try:
        validate_password(password, user=user)
    except DjangoValidationError as e:
        return Response({'detail': '; '.join(e.messages) if e.messages else 'Contraseña no válida.'}, status=400)
    user.set_password(password)
    user.save(update_fields=['password'])
    # Restablecer la contraseña PRUEBA que el buzón es suyo: el enlace solo llegó
    # ahí. Así que el correo queda confirmado — si no, el candado del login lo
    # dejaría fuera después de haber hecho todo bien, sin salida visible.
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
    if not perfil.email_verificado:
        from .otp import CAMPOS
        perfil.email_verificado = True
        perfil.email_verificado_en = timezone.now()
        # Un código de verificación vivo ya no hace falta y no debe quedarse
        # esperando: el buzón acaba de probarse por otra vía.
        perfil.email_otp = ''
        perfil.email_otp_creado = None
        perfil.email_otp_intentos = 0
        perfil.email_otp_bloqueado_hasta = None
        perfil.save(update_fields=CAMPOS + ['email_verificado', 'email_verificado_en'])
    # La contraseña cambió: cierra TODAS las sesiones vivas de la cuenta (otros
    # dispositivos/pestañas) invalidando sus refresh tokens. La sesión del
    # navegador actual ya la cierra el frontend al terminar el restablecimiento.
    _cerrar_sesiones_de(user)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def verificar_correo_usuario(request, token: str):
    """Puente para las ligas viejas (las que ya salieron por correo apuntando aquí).

    Ya NO verifica nada: manda a la página del front, que es quien confirma con un
    POST y abre la sesión. Así los correos anteriores siguen funcionando y, de
    paso, los escáneres de correo que abren la liga solos dejan de quemar el token.
    """
    from django.conf import settings
    from django.shortcuts import redirect

    token = (token or '').strip()
    destino = f'{settings.FRONTEND_URL.rstrip("/")}/verificar/{token}' if token else \
        f'{settings.FRONTEND_URL.rstrip("/")}/login'
    return redirect(destino)


@api_view(['POST'])
@authentication_classes([])       # ver nota en solicitar_restablecer: un Bearer
@permission_classes([permissions.AllowAny])   # vencido en el navegador tumbaría
@throttle_classes([RestablecerUsoThrottle])   # esta vista pública con un 401
def verificar_correo(request):
    """Confirma el correo con el CÓDIGO y, de una vez, deja la sesión abierta.

    Body: `{correo, codigo}`. Los dos hacen falta: el código son seis dígitos y
    no identifica a nadie por sí solo —un mismo código valdría para cualquier
    cuenta y se podría barrer a ciegas—. Con el correo, el freno de intentos es
    POR CUENTA, que es lo que lo vuelve inútil de adivinar.

    Abrir la sesión aquí es deliberado, igual que cuando esto era una liga:
    tener el código prueba que el buzón es suyo, y pedirle además la contraseña
    justo después no protege nada y sí pierde gente en el camino.
    """
    from .otp import comprobar

    correo = (request.data.get('correo') or request.data.get('email') or '').strip().lower()
    codigo = (request.data.get('codigo') or '').strip()
    if not correo or not codigo:
        return Response({'detail': 'Falta el correo o el código.', 'codigo': 'incompleto'}, status=400)

    User = get_user_model()
    user = User.objects.filter(email__iexact=correo).first()
    if not user:
        # La MISMA respuesta que un código incorrecto, a propósito: distinguirlas
        # convertiría esto en un detector de qué correos están registrados.
        return Response({'detail': 'Código incorrecto.', 'codigo': 'incorrecto'}, status=400)

    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)

    if perfil.email_verificado:
        # Ya estaba: no es un error, y repetirlo no debe gastar intentos.
        return Response({'detail': 'Este correo ya estaba confirmado.', 'codigo': 'ya_verificado'}, status=400)

    ok, detalle, estado, cod = comprobar(perfil, codigo)
    if not ok:
        return Response({'detail': detalle, 'codigo': cod}, status=estado)

    perfil.email_verificado = True
    perfil.email_verificado_en = timezone.now()
    perfil.save(update_fields=['email_verificado', 'email_verificado_en'])

    # El correo queda confirmado igual (es cierto y le sirve), pero la sesión no
    # se abre: una cuenta desactivada no entra por ninguna puerta.
    if not user.is_active:
        return Response({'detail': 'Esta cuenta está desactivada.', 'codigo': 'inactiva'}, status=403)

    refresh = TokenObtainPairSerializer.get_token(user)
    resp = Response({
        'ok': True,
        'access': str(refresh.access_token),
        'nombre': (user.first_name or '').strip() or user.get_full_name() or user.username,
    })
    return _set_refresh_cookie(resp, str(refresh))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def reenviar_verificacion(request):
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    from .otp import CAMPOS
    codigo = _nuevo_codigo_verificacion(perfil)
    perfil.email_verificado = False
    perfil.email_verificado_en = None
    perfil.save(update_fields=CAMPOS + ['email_verificado', 'email_verificado_en'])
    _enviar_codigo_verificacion(request.user, codigo)
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
        from .otp import CAMPOS
        codigo = _nuevo_codigo_verificacion(perfil)
        perfil.email_verificado = False
        perfil.email_verificado_en = None
        perfil.save(update_fields=CAMPOS + ['email_verificado', 'email_verificado_en'])
        _enviar_codigo_verificacion(user, codigo)
    # Se contesta OK aunque el correo no exista: decir "esa cuenta no existe"
    # convierte este endpoint en un detector de quién está registrado.
    return Response({'ok': True})


class ObrasClienteList(generics.ListCreateAPIView):
    # Las obras guardadas son el taller personal de un CLIENTE (su dirección, su
    # responsable, su teléfono), no una libreta del mostrador. Ver `NoEsDelNegocio`.
    permission_classes = [permissions.IsAuthenticated, NoEsDelNegocio]
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
    """Buscar una CUENTA de la tienda para vincularle una renta o cotización.

    Dos cosas que estaban rotas y no se veían:

    1. EL CONTRATO. Devolvía una lista pelona y las cuatro pantallas que la
       consumen leen `data.clientes`. En un array eso es `undefined`, así que
       `lista` salía vacía SIEMPRE y el panel contestaba "Aún no hay cuentas de
       cliente registradas" con el sistema lleno de cuentas. Un bug que se
       disfraza de estado vacío es de los peores: no hay error que buscar.

    2. FALTABA EL `id`. El front manda `usuario_id: Number(sel[0])` y aquí solo
       salían username, email y nombre. Aunque la lista hubiera cargado, la
       vinculación habría fallado.

    Y se busca también por TELÉFONO, que es como se pregunta en el mostrador
    ("¿a qué número?"). Los dígitos se comparan pelados: nadie teclea el mismo
    formato dos veces.
    """
    User = get_user_model()
    q = (request.query_params.get('q') or '').strip()
    qs = User.objects.filter(groups__name='Cliente').select_related('perfil')
    if q:
        filtro = (
            Q(username__icontains=q) |
            Q(email__icontains=q) |
            Q(first_name__icontains=q) |
            Q(last_name__icontains=q) |
            Q(perfil__empresa__icontains=q)
        )
        digitos = ''.join(c for c in q if c.isdigit())
        if digitos:
            filtro |= Q(perfil__telefono__contains=digitos)
        qs = qs.filter(filtro)
    # `distinct` porque el filtro cruza `groups` y el perfil: sin él, una cuenta
    # en dos grupos sale repetida en la lista de resultados.
    qs = qs.distinct().order_by('first_name', 'last_name', 'username')[:20]
    return Response({'clientes': [{
        'id': u.id,
        'username': u.username,
        'email': u.email,
        'nombre': (u.get_full_name() or u.username).strip(),
        'telefono': getattr(getattr(u, 'perfil', None), 'telefono', ''),
        'empresa': getattr(getattr(u, 'perfil', None), 'empresa', ''),
    } for u in qs]})


@api_view(['GET'])
@permission_classes([EsOperador])
def latido_panel(request):
    data = {obj.tema: obj.marca.isoformat() for obj in SelloTema.objects.all()}
    return Response(data)


# ─────────────────────────────────────────────
#  MÉTRICAS / NOTIFICACIONES
# ─────────────────────────────────────────────
def _cubetas_de_meses(hoy, cuantas=6):
    """(año, mes) del mes en curso y los anteriores, del más viejo al más nuevo."""
    cubetas = []
    for atras in range(cuantas - 1, -1, -1):
        mes = hoy.month - atras
        anio = hoy.year
        while mes <= 0:
            mes += 12
            anio -= 1
        cubetas.append((anio, mes))
    return cubetas


MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

#: Cuántos días trae la serie diaria del Resumen (y contra cuántos se compara).
DIAS_SERIE = 30


def _ingresos_del_negocio():
    """Lo que de VERDAD entró, por día, de ventas y de rentas.

    Un ingreso es un pago recibido, en la fecha en que se recibió. No el total de
    la venta, ni el día que se registró, ni el día que se entregó: un apartado de
    $12,350 con anticipo de $10,000 no fueron $12,350 el día que se levantó el
    pedido — fueron $10,000 ese día y $2,350 el día que el cliente liquidó.

    Se recorren los pagos en Python porque viven dentro de un JSON y no se pueden
    sumar en SQL. Con el volumen de un negocio de maquinaria es instantáneo; el
    día que deje de serlo, el camino es normalizarlos a su propia tabla y sembrarla
    desde estos mismos datos (como se hizo con los renglones de venta).
    """
    from ventas.models import Venta
    from renta.models import Renta
    from server.cobranza import cobrado_por_dia

    # Cancelada = ese dinero no es del negocio. Se traen solo los pagos: es la
    # única columna que se lee, y así una venta con muchos renglones no pesa.
    pagos_venta = Venta.objects.exclude(estado='cancelada').values_list('pagos', flat=True)
    pagos_renta = Renta.objects.exclude(estado='cancelada').values_list('pagos', flat=True)
    return cobrado_por_dia(pagos_venta), cobrado_por_dia(pagos_renta)


#: Cuántos modelos entran al ranking del Resumen. Seis: es lo que cabe sin
#: scroll junto a la dona, y a partir del séptimo las barras son todas iguales.
TOP_EQUIPOS = 6

#: Cómo se llama el dinero que no viene de una máquina. La caja del mostrador
#: vende refacciones sin unidad ni equipo: sin este renglón ese dinero
#: desaparecía del ranking y los porcentajes no cuadraban con el total.
SIN_MAQUINA = 'Refacciones y mostrador'


def _ingresos_por_equipo(desde, hasta):
    """Lo COBRADO en el tramo, agrupado por modelo de máquina.

    Misma regla que el resto del Resumen: un ingreso es un pago recibido, en la
    fecha en que se recibió (ver `server.cobranza`). Lo que cambia aquí es el
    agrupador: en vez de por día, por la máquina que lo produjo.

    Renta y venta se guardan por separado a propósito. Un modelo que produce
    $80,000 rentándose no es el mismo negocio que uno que produce $80,000
    vendiéndose una vez —el primero lo vuelve a hacer el mes que entra—, y esa
    mezcla es la mitad de la respuesta a "¿qué me conviene comprar?".
    """
    from decimal import Decimal
    from ventas.models import Venta
    from renta.models import Renta
    from server.cobranza import fecha_de_pago, monto_de_pago

    acumulado = {}

    def sumar(modelo, columna, monto):
        fila = acumulado.setdefault(modelo, {'ventas': Decimal('0'), 'rentas': Decimal('0')})
        fila[columna] += monto

    def cobrado(pagos):
        for pago in (pagos or []):
            dia = fecha_de_pago(pago)
            if dia is None or not (desde <= dia <= hasta):
                continue
            monto = monto_de_pago(pago)
            if monto > 0:
                yield monto

    ventas = Venta.objects.exclude(estado='cancelada').select_related(
        'inventario__equipo', 'equipo')
    for v in ventas:
        # Tres orígenes posibles, en orden: la unidad vendida, el equipo pedido
        # (apartado sin unidad todavía) o nada —eso es mostrador—.
        equipo = (v.inventario.equipo if v.inventario_id and v.inventario.equipo_id else None) or (
            v.equipo if v.equipo_id else None)
        modelo = equipo.modelo if equipo else SIN_MAQUINA
        for monto in cobrado(v.pagos):
            sumar(modelo, 'ventas', monto)

    rentas = Renta.objects.exclude(estado='cancelada').select_related('inventario__equipo')
    for r in rentas:
        equipo = r.inventario.equipo if r.inventario_id and r.inventario.equipo_id else None
        modelo = equipo.modelo if equipo else SIN_MAQUINA
        for monto in cobrado(r.pagos):
            sumar(modelo, 'rentas', monto)

    filas = [
        {'modelo': modelo, 'ventas': float(d['ventas']), 'rentas': float(d['rentas']),
         'total': float(d['ventas'] + d['rentas'])}
        for modelo, d in acumulado.items()
    ]
    filas.sort(key=lambda f: (-f['total'], f['modelo']))
    return filas[:TOP_EQUIPOS]


def _ocupacion_por_dia(desde, hasta):
    """Cuántas unidades estuvieron RENTADAS cada día, y de cuántas.

    Una renta ocupa su máquina todos los días entre que sale y que vuelve, así
    que se cuenta por RANGO y no por la fecha en que se levantó: contar altas
    diría "un día ocupada" de una renta de tres semanas.

    El día de cierre es la devolución REAL si ya volvió; si no, la fecha de fin
    pactada. Una renta vencida que nadie ha recogido sigue ocupando la máquina
    hasta hoy —está en la obra del cliente, no en la bodega—, así que se cuenta.

    La flota de cada día son las unidades dadas de alta hasta ese día. No se
    descuentan las vendidas: no guardamos CUÁNDO se vendió cada unidad, y
    descontarlas con la fecha de hoy reescribiría el pasado (un mes al 40% de
    ocupación se vería al 90% solo porque después se vendieron máquinas).
    """
    from inventario.models import Inventario
    from renta.models import Renta

    dias = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]
    rentadas = {d: 0 for d in dias}

    tramos = Renta.objects.exclude(estado='cancelada').values_list(
        'fecha_inicio', 'fecha_fin', 'fecha_devolucion_real', 'estado')
    for inicio, fin, devuelta, estado in tramos:
        if not inicio:
            continue
        cierre = devuelta or fin or hasta
        # Vencida y sin recoger: la fecha pactada ya pasó pero la máquina no ha
        # vuelto. Cerrar en la fecha pactada la "liberaría" sola en la gráfica y
        # enseñaría flota disponible que en realidad está en una obra.
        if devuelta is None and estado == 'activa' and cierre < hasta:
            cierre = hasta
        for d in dias:
            if inicio <= d <= cierre:
                rentadas[d] += 1

    altas = [timezone.localtime(f).date() if timezone.is_aware(f) else f.date()
             for f in Inventario.objects.values_list('fecha_creacion', flat=True)]
    return [
        {'fecha': d.isoformat(), 'rentadas': rentadas[d],
         'flota': sum(1 for alta in altas if alta <= d)}
        for d in dias
    ]


@api_view(['GET'])
@permission_classes([EsOperador])
def dashboard_conteos(request):
    """Solo los NÚMEROS del menú del panel: los globitos de cada sección.

    Existe porque el panel bajaba las listas COMPLETAS —productos, unidades,
    ventas, refacciones, órdenes, usuarios, cupones— nada más para escribir
    "12" junto a un icono, y las volvía a bajar cada vez que el latido decía
    que algo cambió. Eran ocho respuestas grandes por entrar al panel, sin
    importar a qué sección entrabas. Aquí van los mismos números en una
    respuesta chica; las listas ya solo las pide la sección que se abre.

    Son conteos, no dinero: cualquiera con acceso al panel puede verlos.
    """
    from inventario.models import Inventario, OrdenReparacion
    from refacciones.models import Refaccion
    from renta.models import Renta
    from ventas.models import Venta
    from facturacion.models import SolicitudFactura

    # Los adeudos NO se pueden contar en SQL: el saldo sale de restar los abonos
    # (un JSON) al total, y eso vive en Python. Se recorre igual que la pantalla
    # de cobranza, pero devolviendo un número en vez de la lista serializada.
    con_saldo = sum(
        1 for r in Renta.objects.exclude(estado='cancelada').iterator()
        if r.saldo_pendiente() > 0
    )

    return Response({
        'equipos': Equipo.objects.count(),
        'unidades': Inventario.objects.count(),
        'refacciones': Refaccion.objects.count(),
        'catalogos': Categoria.objects.count() + Tipo.objects.count() + Marca.objects.count(),
        'rentas_activas': Renta.objects.filter(estado='activa').count(),
        'ventas': Venta.objects.count(),
        'pedidos': Venta.objects.filter(estado='apartada').count(),
        'ordenes_abiertas': OrdenReparacion.objects.exclude(estado='entregada').count(),
        'facturas_pendientes': SolicitudFactura.objects.filter(estado='pendiente').count(),
        'adeudos': con_saldo,
        'cupones': Cupon.objects.count(),
        # El globito del menú vive sobre EQUIPO, así que cuenta cuentas de
        # trabajo activas y no todas las del sistema: con los clientes adentro
        # decía "302" y prometía una lista de 302 que la sección no enseña.
        'equipo_activos': get_user_model().objects.filter(is_active=True).exclude(
            groups__name='Cliente', is_staff=False, is_superuser=False).distinct().count(),
    })


@api_view(['GET'])
@permission_classes([PuedeVerDinero])
def dashboard_metrics(request):
    """Las cifras del Resumen: qué entró hoy y qué entró cada mes.

    Vivía como cascarón (`revenue: 0.0`), así que el panel siempre caía a su
    cálculo de respaldo, que sumaba el total de cada venta el día que se registró.
    Eso daba por cobrado dinero que todavía no llegaba y dejaba en cero los meses
    en que solo se recibieron anticipos.
    """
    from decimal import Decimal
    hoy = timezone.localdate()
    por_dia_venta, por_dia_renta = _ingresos_del_negocio()

    def suma(por_dia, filtro):
        return float(sum((m for d, m in por_dia.items() if filtro(d)), Decimal('0')))

    es_hoy = lambda d: d == hoy                                    # noqa: E731
    del_mes = lambda a, m: (lambda d: d.year == a and d.month == m)  # noqa: E731

    por_mes = []
    for anio, mes in _cubetas_de_meses(hoy):
        v = suma(por_dia_venta, del_mes(anio, mes))
        r = suma(por_dia_renta, del_mes(anio, mes))
        por_mes.append({'label': MESES_CORTOS[mes - 1], 'ventas': v, 'rentas': r, 'total': v + r})

    # Serie DIARIA de los últimos 30 días, separando renta de venta: son los dos
    # motores del negocio y no se comportan igual —la renta gotea, la venta llega
    # de golpe—, así que sumarlas en una sola línea esconde justo lo que hay que
    # ver. Los días sin un peso van explícitos en CERO: un hueco en la serie se
    # dibujaría como si el día no existiera.
    dias = []
    inicio = hoy - timedelta(days=DIAS_SERIE - 1)
    for i in range(DIAS_SERIE):
        d = inicio + timedelta(days=i)
        v = float(por_dia_venta.get(d, Decimal('0')))
        r = float(por_dia_renta.get(d, Decimal('0')))
        dias.append({'fecha': d.isoformat(), 'ventas': v, 'rentas': r, 'total': v + r})

    # El MISMO tramo, corrido 30 días atrás. Sin esto el total del periodo es un
    # número suelto: nadie sabe si $180,000 en un mes es bueno o es una caída.
    ini_previo = inicio - timedelta(days=DIAS_SERIE)
    en_previo = lambda d: ini_previo <= d < inicio  # noqa: E731
    previo = suma(por_dia_venta, en_previo) + suma(por_dia_renta, en_previo)

    return Response({
        'products': Equipo.objects.count(),
        'orders': 0,
        'revenue': 0.0,
        'ingresos_hoy': suma(por_dia_venta, es_hoy) + suma(por_dia_renta, es_hoy),
        'ingresos_mes': por_mes[-1] and {k: por_mes[-1][k] for k in ('ventas', 'rentas', 'total')},
        'ingresos_por_mes': por_mes,
        'ingresos_por_dia': dias,
        'ingresos_periodo_previo': previo,
        'dias_serie': DIAS_SERIE,
        # Las dos preguntas que el Resumen no sabía contestar: QUÉ produce el
        # dinero y CUÁNTA máquina está trabajando. Se calculan sobre el mismo
        # tramo de 30 días que la serie diaria, para que todo el bloque hable
        # del mismo periodo.
        'top_equipos': _ingresos_por_equipo(inicio, hoy),
        'ocupacion_por_dia': _ocupacion_por_dia(inicio, hoy),
    })



def _sync_alertas_vencimiento():
    """Genera notificaciones de rentas vencidas / por vencer (idempotente vía ref).

    Es un efecto secundario de LEER las notificaciones, así que va aislado: una
    renta con datos raros no puede tumbar el buzón entero. Antes sí podía —una
    referencia a un campo inexistente dejó `/api/notificaciones/` en 500 y la
    campana vacía para todos, sin que se viera un solo aviso en pantalla.
    """
    try:
        from renta.models import Renta  # import diferido para evitar import circular
    except Exception:
        return
    hoy = timezone.localdate()
    activas = Renta.objects.filter(estado='activa').select_related('inventario', 'inventario__equipo')
    for r in activas:
        try:
            # Sin fecha de fin no hay vencimiento que calcular.
            if not r.fecha_fin:
                continue
            inv = r.inventario
            equipo = inv.equipo.modelo if inv and inv.equipo else 'Equipo'
            # La renta no tiene folio: se identifica por el código de la unidad,
            # igual que en el resto de los avisos de rentas.
            unidad = inv.codigo if inv else f'renta #{r.id}'
            cliente = r.cliente_nombre
            dias = (r.fecha_fin - hoy).days
            datos = {'renta_id': r.id, 'inventario_id': inv.id if inv else None}
            if dias < 0:
                crear_notificacion(
                    tipo='alerta',
                    titulo=f'Renta vencida: {cliente} · {equipo}',
                    mensaje=f'{abs(dias)} día(s) de retraso. Unidad {unidad}.',
                    seccion='rentas',
                    ref=f'vencida-{r.id}',
                    data=datos,
                )
            elif dias <= 3:
                crear_notificacion(
                    tipo='alerta',
                    titulo=f'Renta por vencer: {cliente} · {equipo}',
                    mensaje=f'Faltan {dias} día(s). Unidad {unidad}.',
                    seccion='rentas',
                    ref=f'porvencer-{r.id}',
                    data=datos,
                )
        except Exception:
            logger.exception('No se pudo generar la alerta de vencimiento de la renta %s', r.id)


# Qué capacidad hace falta para que un aviso BROADCAST sea tuyo.
#
# La regla es una sola y se lee de corrido: **si no puedes abrir la pantalla, no
# te llega su aviso.** Es el espejo del mapa `REQUIERE` del panel (Dashboard.tsx),
# que decide qué secciones aparecen en el menú. Tenerlo de los dos lados evita la
# incoherencia que había: al técnico no le sale "Adeudos" en el menú y sin embargo
# le llegaba "Se recogió con saldo: $2,000" con el nombre y el teléfono del
# cliente. Un aviso que apunta a una pantalla que no puedes abrir no es solo
# ruido: es una filtración con forma de campanita.
#
# Una sección sin entrada aquí se considera de TODO EL EQUIPO (avisos de
# operación general). Lo sensible se declara; lo demás pasa.
CAPACIDAD_POR_SECCION = {
    'adeudos': 'ver_operacion',
    'ventas': 'ver_operacion',
    'pedidos': 'ver_operacion',
    'rentas': 'ver_operacion',
    # La misma capacidad que abre la sección: quien puede trabajar el padrón
    # recibe sus avisos ("Cuenta nueva: Fulana, vincúlala con un cliente"), y
    # quien no, no. El técnico ya no la tiene (ver `AJUSTES_POR_PUESTO`), y el
    # mostrador sí — que es justo quien vincula cuentas con el cliente enfrente.
    'clientes': 'ver_clientes',
    'cotizaciones': 'cotizar',
    'facturacion': 'facturar',
    'reparaciones': 'gestionar_reparaciones',
    'configuracion': 'configurar_negocio',
}


def _secciones_broadcast_visibles(user):
    """Las secciones cuyos avistos generales le tocan a este usuario."""
    from maquinaria.permissions import puede_de
    puede = puede_de(user)
    return {sec for sec, cap in CAPACIDAD_POR_SECCION.items() if puede.get(cap)}


def _filtro_broadcast(user):
    """Qué avisos BROADCAST puede ver este usuario.

    Antes esta función prometía el filtrado en su docstring y luego devolvía
    `Q(usuario__isnull=True)` para todo el staff — la misma línea que la rama del
    admin. El filtro estaba documentado y no escrito, así que el técnico veía el
    buzón completo: ventas, facturación, cobranza y montos.
    """
    from maquinaria.permissions import nivel_de, NIVEL_ADMIN

    n = nivel_de(user)
    # Gerente ya es NIVEL_ADMIN (ver nivel_de): Admin, Gerente y Dueño ven todo.
    if n >= NIVEL_ADMIN:
        return Q(usuario__isnull=True)
    if n <= 0:
        # Cliente o sin acceso: ningún aviso interno.
        return Q(pk__in=[])

    # Staff de nivel 1 (técnico, cajero, asesor): los avisos de las secciones
    # que sí puede abrir, más los que no apuntan a ninguna sección concreta
    # (avisos de sistema y operación general).
    restringidas = set(CAPACIDAD_POR_SECCION) - _secciones_broadcast_visibles(user)
    return Q(usuario__isnull=True) & ~Q(seccion__in=restringidas)


def _notificaciones_usuario_qs(user):
    """Devuelve el queryset de notificaciones VISIBLES para el usuario actual.

    Reglas:
      - Las notificaciones PERSONALES (usuario=user) siempre llegan, sin excepción.
      - Las broadcasts (usuario__isnull=True) se filtran por CAPACIDAD vía
        `_filtro_broadcast`: si no puedes abrir la pantalla, no te llega su
        aviso. Un cliente no ve ningún evento interno.
    """
    q_personal = Q(usuario=user)
    q_broadcast = _filtro_broadcast(user)
    return Notificacion.objects.filter(q_personal | q_broadcast).order_by('-creada', '-id')


class NotificacionesList(generics.ListAPIView):
    """Panel general del admin/operador: las notificaciones que SÍ le tocan ver."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificacionSerializer

    def get_queryset(self):
        # Generar alertas es de mejor esfuerzo: si falla, se leen igual las que
        # ya existen. Leer el buzón no puede depender de escribir en él.
        try:
            _sync_alertas_vencimiento()
        except Exception:
            logger.exception('Falló la sincronización de alertas de vencimiento')
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
    """Vacía el panel del usuario logueado: borra las notificaciones broadcast
    que ÉL puede ver y NO toca las personales de nadie (ni las suyas, que se
    gestionan por /mias/limpiar/).

    Ojo con lo que esto es: un broadcast es COMPARTIDO, así que borrarlo se lo
    borra a todo el equipo. Que el filtro sea el correcto importa por eso — con
    el anterior, que dejaba pasar todo, un técnico vaciaba también los avisos de
    cobranza y facturación que nunca debió ver."""
    qs_broadcasts_visibles = _filtro_broadcast(request.user)
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
