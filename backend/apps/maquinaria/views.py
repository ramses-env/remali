from datetime import timedelta

from django.db import IntegrityError
from django.db.models import Q, ProtectedError
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email

from rest_framework import generics, permissions, status
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from .permissions import EsDueno, EsOperador, EsOperadorEditaAdmin, puede_de, nivel_de, NIVEL_ADMIN
from .throttling import (
    SolicitudPublicaThrottle, LoginThrottle, RegistroThrottle, CambioPasswordThrottle,
)

from django.conf import settings

from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon, Notificacion, PerfilUsuario, crear_notificacion,
    ConversacionSoporte, MensajeSoporte, ConfiguracionSitio, CorreoAviso, ObraCliente,
)
from .permissions import IsAdminGroupOrStaff


class ProtectedDestroyMixin:
    """DELETE seguro para modelos referenciados con on_delete=PROTECT.
    En vez de un 500 por ProtectedError, responde 409 con un mensaje claro
    de cuántos registros dependen del objeto. Reutilizable en cualquier
    RetrieveUpdateDestroyAPIView (catálogos, refacciones, etc.)."""

    en_uso_label = 'registro'          # singular; sobreescribir (ej. 'producto')
    en_uso_label_plural = 'registros'  # plural;   sobreescribir (ej. 'productos')

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            instance.delete()
        except ProtectedError as e:
            n = len(e.protected_objects)
            label = self.en_uso_label if n == 1 else self.en_uso_label_plural
            # "está en uso por N …": frase invariante que evita el pronombre
            # gendered (lo/la) — funciona igual para producto, categoría, unidad…
            return Response(
                {'detail': f'No se puede eliminar "{instance}": está en uso por {n} {label}.'},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
from .serializers import (
    EquipoSerializer, CategoriaSerializer, MarcaSerializer, TipoSerializer,
    CuponSerializer, NotificacionSerializer, PerfilUsuarioSerializer,
    ConfiguracionSitioSerializer, CorreoAvisoSerializer,
    ConversacionSoporteListSerializer, ConversacionSoporteDetailSerializer, MensajeSoporteSerializer,
    ObraClienteSerializer,
)


# ─────────────────────────────────────────────
#  EQUIPOS (catálogo)
# ─────────────────────────────────────────────
class EquipoListCreate(generics.ListCreateAPIView):
    # select_related: los catálogos (depth=1) se traen en el mismo query.
    # prefetch_related: unidades e imágenes que consumen los SerializerMethodField.
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

        # Venta = equipos nuevos, Renta = seminuevos. Lo decide la condición del
        # propio equipo (un equipo es de venta O de renta, nunca ambos).
        uso = (params.get('uso') or '').strip().lower()
        if uso == 'venta':
            qs = qs.filter(condicion='nueva')
        elif uso == 'renta':
            qs = qs.filter(condicion='seminueva')

        if params.get('price_min'):
            qs = qs.filter(precio_dia__gte=params['price_min'])
        if params.get('price_max'):
            qs = qs.filter(precio_dia__lte=params['price_max'])

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


class EquipoRetrieveUpdateDestroy(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = (Equipo.objects
                .select_related('categoria', 'tipo', 'marca')
                .prefetch_related('unidades', 'imagenes'))
    serializer_class = EquipoSerializer
    en_uso_label = 'unidad de inventario'
    en_uso_label_plural = 'unidades de inventario'

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


class CategoriaDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer
    permission_classes = [IsAdminGroupOrStaff]
    en_uso_label = 'producto'
    en_uso_label_plural = 'productos'


class TipoDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Tipo.objects.all()
    serializer_class = TipoSerializer
    permission_classes = [IsAdminGroupOrStaff]
    en_uso_label = 'producto'
    en_uso_label_plural = 'productos'


class MarcaDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Marca.objects.all()
    serializer_class = MarcaSerializer
    permission_classes = [IsAdminGroupOrStaff]
    en_uso_label = 'producto'
    en_uso_label_plural = 'productos'


# ─────────────────────────────────────────────
#  CONFIGURACIÓN DEL SITIO (editable desde el panel)
# ─────────────────────────────────────────────
def _enviar_verificacion(correo, request):
    """Pone en camino el correo con el link de verificación (no bloquea la petición)."""
    from .correo import enviar_async
    correo.nuevo_token()
    correo.verificado = False
    correo.verificado_en = None
    correo.save(update_fields=['token', 'verificado', 'verificado_en'])
    url = request.build_absolute_uri(f'/api/config/correos/verificar/?token={correo.token}')
    cuerpo = (
        f'Hola,\n\nEste correo fue dado de alta en REMALI para recibir avisos de '
        f'nuevas solicitudes de cotización.\n\nConfírmalo aquí:\n{url}\n\n'
        f'Si no lo reconoces, ignora este mensaje.\n'
    )
    return enviar_async('[REMALI] Verifica tu correo de avisos', cuerpo, [correo.email])


@api_view(['GET'])
@permission_classes([permissions.AllowAny])  # público: la tienda necesita el WhatsApp y el nombre
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
    })


class ConfiguracionDetail(generics.RetrieveUpdateAPIView):
    """Configuración completa del negocio: solo el dueño.

    Incluye los WhatsApp de respaldo y los datos fiscales. La tienda usa
    /config/publica/, que expone únicamente lo que el cliente debe ver."""
    permission_classes = [EsDueno]
    serializer_class = ConfiguracionSitioSerializer

    def get_object(self):
        return ConfiguracionSitio.get_solo()


class CorreosAvisoList(generics.ListCreateAPIView):
    permission_classes = [EsDueno]
    serializer_class = CorreoAvisoSerializer
    queryset = CorreoAviso.objects.all()

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        correo = ser.save()
        enviado = _enviar_verificacion(correo, request)
        data = self.get_serializer(correo).data
        data['verificacion_enviada'] = enviado
        return Response(data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([EsDueno])
def correo_aviso_eliminar(request, pk: int):
    CorreoAviso.objects.filter(pk=pk).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([EsDueno])
def correo_aviso_reenviar(request, pk: int):
    try:
        correo = CorreoAviso.objects.get(pk=pk)
    except CorreoAviso.DoesNotExist:
        return Response({'detalle': 'Correo no encontrado'}, status=404)
    ok = _enviar_verificacion(correo, request)
    return Response({'detalle': 'Verificación reenviada' if ok else 'No se pudo enviar el correo', 'enviado': ok})


@api_view(['GET'])
@permission_classes([permissions.AllowAny])  # público: se abre desde el correo
def verificar_correo_aviso(request):
    from django.http import HttpResponse
    from django.utils import timezone as _tz
    token = (request.query_params.get('token') or '').strip()
    correo = CorreoAviso.objects.filter(token=token).first() if token else None
    if not correo:
        return HttpResponse('<h2>Enlace inválido o vencido.</h2>', status=400, content_type='text/html; charset=utf-8')
    correo.verificado = True
    correo.verificado_en = _tz.now()
    correo.token = ''
    correo.save(update_fields=['verificado', 'verificado_en', 'token'])
    return HttpResponse(
        f'<h2>✅ Correo verificado</h2><p>{correo.email} ya recibirá los avisos de nuevas solicitudes.</p>',
        content_type='text/html; charset=utf-8')


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
@permission_classes([permissions.AllowAny])  # público: la tienda (futura) valida el cupón del cliente sin sesión
def apply_coupon(request):
    codigo = request.data.get('code')
    try:
        cupon = Cupon.objects.get(codigo=codigo, activo=True)
        return Response({'discount': float(cupon.descuento)})
    except Cupon.DoesNotExist:
        return Response({'discount': 0}, status=400)


# ─────────────────────────────────────────────
#  AUTENTICACIÓN / PERFIL
# ─────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([CambioPasswordThrottle])
def cambiar_password(request):
    """Cambiar la propia contraseña.

    Ojo con el caso que no es obvio: quien entró con Google NO tiene contraseña
    utilizable. Para esa cuenta esto es ponerla por primera vez, así que exigirle
    la "actual" la dejaría sin poder crear una nunca. Se detecta y se salta ese
    requisito; sigue siendo seguro porque ya viene autenticado.
    """
    usuario = request.user
    actual = request.data.get('password_actual') or ''
    nueva = request.data.get('password_nueva') or ''

    if not nueva:
        return Response({'detail': 'Escribe tu contraseña nueva.'}, status=400)

    tenia_password = usuario.has_usable_password()
    if tenia_password and not usuario.check_password(actual):
        return Response({'detail': 'Tu contraseña actual no es correcta.'}, status=400)

    # Se le pasa el usuario para que el validador de similitud pueda comparar la
    # contraseña con su nombre y su correo.
    try:
        validate_password(nueva, usuario)
    except DjangoValidationError as e:
        return Response({'detail': ' '.join(e.messages)}, status=400)

    usuario.set_password(nueva)
    usuario.save(update_fields=['password'])
    return Response({'detail': 'Contraseña actualizada.', 'tenia_password': tenia_password})


def _bienvenida_brevo(email, nombre):
    """Dispara la PLANTILLA de bienvenida por la API de Brevo, en un hilo.

    Devuelve True si está configurada (BREVO_API_KEY + BREVO_WELCOME_TEMPLATE_ID)
    y se encoló; False si no hay plantilla (entonces se manda el texto plano).
    La plantilla usa {{ params.nombre }} para personalizar.
    """
    import os

    from .correo import enviar_plantilla_brevo
    tpl = os.environ.get('BREVO_WELCOME_TEMPLATE_ID', '').strip()
    return enviar_plantilla_brevo(tpl, email, nombre, {'nombre': nombre or ''})


def enviar_bienvenida(user):
    """Bienvenida al crear una cuenta de cliente. Nunca revienta el alta.

    Si hay plantilla de Brevo configurada, se usa esa (diseño editable en Brevo);
    si no, un correo de texto por el SMTP normal.
    """
    email = (getattr(user, 'email', '') or '').strip()
    if not email:
        return
    nombre = (getattr(user, 'first_name', '') or '').strip()
    try:
        if _bienvenida_brevo(email, nombre):
            return
        from .correo import enviar_async
        cfg = ConfiguracionSitio.get_solo()
        negocio = cfg.negocio_nombre or 'REMALI'
        contacto = cfg.negocio_telefono or cfg.whatsapp_principal or ''
        web = cfg.negocio_web or 'remali.mx'
        cuerpo = (
            f'Hola {nombre}'.rstrip() + ',\n\n'
            f'¡Bienvenido a {negocio}! Tu cuenta ya está lista.\n\n'
            f'Desde tu cuenta puedes ver nuestro catálogo de maquinaria y pedir '
            f'cotizaciones en línea; nosotros te contactamos para confirmar disponibilidad.\n\n'
            + (f'Visítanos en {web}.\n' if web else '')
            + (f'¿Dudas? Escríbenos al {contacto}.\n' if contacto else '')
            + f'\nGracias por confiar en {negocio}.\n— El equipo de {negocio}\n'
        )
        enviar_async(f'¡Bienvenido a {negocio}!', cuerpo, [email])
    except Exception:
        import logging
        logging.getLogger(__name__).exception('No se pudo enviar la bienvenida a %s', email)


def _enviar_verificacion(user, perfil, request=None):
    """Correo con el link para confirmar el correo del usuario. No revienta nada."""
    email = (getattr(user, 'email', '') or '').strip()
    if not email:
        return
    try:
        if not perfil.email_token:
            perfil.nuevo_email_token()
            perfil.save(update_fields=['email_token'])
        ruta = f'/api/auth/verificar-correo/{perfil.email_token}/'
        link = request.build_absolute_uri(ruta) if request is not None else ruta
        nombre = (getattr(user, 'first_name', '') or '').strip()
        import os
        from .correo import enviar_async, enviar_plantilla_brevo
        tpl = os.environ.get('BREVO_VERIFY_TEMPLATE_ID', '').strip()
        if enviar_plantilla_brevo(tpl, email, nombre, {'nombre': nombre, 'link': link}):
            return
        cfg = ConfiguracionSitio.get_solo()
        negocio = cfg.negocio_nombre or 'REMALI'
        cuerpo = (
            f'Hola {nombre}'.rstrip() + ',\n\n'
            f'Confirma tu correo para activar tu cuenta en {negocio} y desbloquear un '
            f'5% de descuento al completar tu perfil:\n\n'
            f'{link}\n\n'
            f'Si no creaste esta cuenta, ignora este correo.\n'
        )
        enviar_async(f'Confirma tu correo · {negocio}', cuerpo, [email])
    except Exception:
        import logging
        logging.getLogger(__name__).exception('No se pudo enviar la verificación a %s', email)


def _generar_cupon_perfil(user):
    """Crea (una sola vez) el cupón personal de 5% por completar el perfil."""
    import secrets
    from decimal import Decimal
    from .models import Cupon
    existente = user.cupones.filter(motivo='perfil').first()
    if existente:
        return existente
    for _ in range(6):
        codigo = 'PERFIL-' + secrets.token_hex(3).upper()
        if not Cupon.objects.filter(codigo=codigo).exists():
            return Cupon.objects.create(
                codigo=codigo, descuento=Decimal('0.05'), activo=True,
                usuario=user, motivo='perfil',
            )
    return None


def _enviar_recompensa(user, codigo):
    """Correo de '¡ganaste 5%!' con el código del cupón. No revienta nada."""
    email = (getattr(user, 'email', '') or '').strip()
    if not email:
        return
    try:
        nombre = (getattr(user, 'first_name', '') or '').strip()
        import os
        from .correo import enviar_async, enviar_plantilla_brevo
        tpl = os.environ.get('BREVO_REWARD_TEMPLATE_ID', '').strip()
        if enviar_plantilla_brevo(tpl, email, nombre, {'nombre': nombre, 'codigo': codigo, 'descuento': '5%'}):
            return
        cfg = ConfiguracionSitio.get_solo()
        negocio = cfg.negocio_nombre or 'REMALI'
        cuerpo = (
            f'¡Felicidades {nombre}'.rstrip() + '!\n\n'
            f'Completaste tu perfil en {negocio} y ganaste un 5% de descuento.\n\n'
            f'Tu código: {codigo}\n\n'
            f'Úsalo en tu próxima cotización. ¡Gracias por confiar en {negocio}!\n'
        )
        enviar_async(f'Ganaste 5% en {negocio}', cuerpo, [email])
    except Exception:
        import logging
        logging.getLogger(__name__).exception('No se pudo enviar la recompensa a %s', email)


def revisar_recompensa(perfil):
    """Si el perfil quedó verificado (correo + datos) y aún no se le premió,
    genera su cupón de 5% y le manda el correo. Idempotente; nunca revienta."""
    try:
        if not perfil.perfil_verificado or perfil.recompensado:
            return
        cupon = _generar_cupon_perfil(perfil.usuario)
        perfil.recompensado = True
        perfil.save(update_fields=['recompensado'])
        if cupon:
            _enviar_recompensa(perfil.usuario, cupon.codigo)
    except Exception:
        import logging
        logging.getLogger(__name__).exception('No se pudo entregar la recompensa de perfil')


@api_view(['GET'])
@permission_classes([permissions.AllowAny])   # público: se abre desde el link del correo
def verificar_correo_usuario(request, token):
    """Confirma el correo del usuario (link del correo) y lo regresa al sitio."""
    from django.shortcuts import redirect
    from django.utils import timezone
    perfil = PerfilUsuario.objects.filter(email_token=token).exclude(email_token='').first() if token else None
    if not perfil:
        return redirect('/?correo=invalido')
    if not perfil.email_verificado:
        perfil.email_verificado = True
        perfil.email_verificado_en = timezone.now()
        perfil.save(update_fields=['email_verificado', 'email_verificado_en'])
        enviar_bienvenida(perfil.usuario)   # ahora sí: cuenta confirmada
        revisar_recompensa(perfil)
    return redirect('/?correo=verificado')


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def reenviar_verificacion(request):
    """Reenvía el correo de verificación al usuario autenticado."""
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=request.user)
    if perfil.email_verificado:
        return Response({'detail': 'Tu correo ya está verificado.'})
    _enviar_verificacion(request.user, perfil, request)
    return Response({'detail': 'Te reenviamos el correo de verificación.'})


def _adoptar_cotizaciones(user):
    """Cotizaciones hechas sin cuenta (o capturadas por el admin) cuyo correo
    coincide con el del nuevo usuario: se le cuelgan a su cuenta para que las
    vea en "Mis cotizaciones". Nunca roba las que ya tienen dueño."""
    try:
        from cotizaciones.models import Cotizacion
        if user.email:
            Cotizacion.objects.filter(
                usuario__isnull=True, cliente_email__iexact=user.email.strip()
            ).update(usuario=user)
    except Exception:
        pass


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: alta de cliente desde la tienda
@throttle_classes([RegistroThrottle])
def registro(request):
    """Alta de cuenta de cliente desde la tienda.

    Esto SOLO crea clientes. El rol no se lee del payload en ningún caso: si
    llegara `is_staff`, `is_superuser` o `groups`, se ignoran. Un alta pública
    que aceptara el rol del cliente sería una puerta directa a hacerse
    administrador. Quien necesite técnico o admin lo da de alta el Dueño.
    """
    nombre = (request.data.get('nombre') or '').strip()
    email = (request.data.get('email') or '').strip().lower()
    password = request.data.get('password') or ''

    if not email or not password:
        return Response({'detail': 'Correo y contraseña son obligatorios.'}, status=400)

    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'detail': 'Escribe un correo válido.'}, status=400)

    # El correo hace de usuario, y `username` tope a 150.
    if len(email) > 150:
        return Response({'detail': 'Ese correo es demasiado largo.'}, status=400)

    User = get_user_model()
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
        return Response({'detail': 'Ya existe una cuenta con ese correo.'}, status=400)

    # Las reglas de fuerza de contraseña son las del proyecto (AUTH_PASSWORD_VALIDATORS),
    # no una copia paralela que se quede desactualizada.
    try:
        validate_password(password)
    except DjangoValidationError as e:
        return Response({'detail': ' '.join(e.messages)}, status=400)

    try:
        user = User.objects.create_user(username=email, email=email, password=password)
        _adoptar_cotizaciones(user)
    except IntegrityError:
        # Dos altas simultáneas con el mismo correo: la segunda choca con el índice.
        return Response({'detail': 'Ya existe una cuenta con ese correo.'}, status=400)

    user.first_name = nombre[:150]
    user.is_staff = False
    user.is_superuser = False
    user.save(update_fields=['first_name', 'is_staff', 'is_superuser'])

    grupo, _ = Group.objects.get_or_create(name='Cliente')
    user.groups.add(grupo)

    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
    _enviar_verificacion(user, perfil, request)   # confirma el correo; la bienvenida va al verificarlo
    return Response({'detail': 'Cuenta creada. Te enviamos un correo para confirmar tu cuenta.'}, status=201)


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: punto de entrada de sesión
@throttle_classes([LoginThrottle])
def google_login(request):
    """Entrar con Google.

    Recibe el ID token que el botón de Google le entregó al navegador y, si es
    legítimo, emite el JWT propio del proyecto.

    Todo depende de la verificación: el token llega desde el cliente, así que sin
    comprobarlo cualquiera mandaría un JSON con el correo del dueño y entraría.
    `verify_oauth2_token` valida la firma contra las llaves públicas de Google,
    la caducidad, el emisor, y —lo más importante— que el token se haya emitido
    PARA esta aplicación (`aud` == nuestro client ID). Sin ese último punto
    serviría un token sacado de cualquier otro sitio que use Google.
    """
    credential = request.data.get('credential') or ''
    if not credential:
        return Response({'detail': 'Falta el token de Google.'}, status=400)

    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    if not client_id:
        return Response({'detail': 'Entrar con Google no está configurado.'}, status=503)

    try:
        info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), client_id
        )
    except ValueError:
        # Token inválido, caducado o emitido para otra aplicación.
        return Response({'detail': 'No pudimos validar tu cuenta de Google.'}, status=401)
    except Exception:
        # Fallo al consultar las llaves de Google: es un problema nuestro, no del
        # usuario. Distinguirlo evita culpar a quien sí traía un token bueno.
        return Response({'detail': 'No pudimos contactar a Google. Intenta de nuevo.'}, status=503)

    if info.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        return Response({'detail': 'Token de origen inesperado.'}, status=401)

    email = (info.get('email') or '').strip().lower()
    if not email or not info.get('email_verified'):
        # Sin correo verificado no hay prueba de que la cuenta sea suya, y enlazar
        # por correo sin esa prueba es la vía directa a suplantar a otro usuario.
        return Response({'detail': 'Tu correo de Google no está verificado.'}, status=403)

    User = get_user_model()
    # Se enlaza por correo, nunca por el nombre que venga en el token. El
    # `exclude(email='')` no es cosmético: sin él, las cuentas sin correo harían
    # match entre ellas y entrarías a la primera que apareciera.
    user = (
        User.objects.exclude(email='').filter(email__iexact=email).first()
        or User.objects.filter(username__iexact=email).first()
    )

    creada = False
    if user is None:
        if len(email) > 150:
            return Response({'detail': 'Ese correo es demasiado largo.'}, status=400)
        # Alta implícita: mismo criterio que el registro público, solo cliente.
        # El rol jamás sale del token de Google.
        user = User.objects.create_user(username=email, email=email)
        _adoptar_cotizaciones(user)
        user.set_unusable_password()   # entra por Google, no tiene contraseña
        user.first_name = (info.get('given_name') or '')[:150]
        user.last_name = (info.get('family_name') or '')[:150]
        user.is_staff = False
        user.is_superuser = False
        user.save()
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        user.groups.add(grupo)
        creada = True
        enviar_bienvenida(user)   # bienvenida solo en el alta, no en logins posteriores

    if not user.is_active:
        # Mismo criterio fail-closed que nivel_de: cuenta desactivada no entra,
        # aunque su Google sea válido.
        return Response({'detail': 'Tu cuenta no está activa. Contacta al administrador.'}, status=403)

    # Google ya verificó el correo: refléjalo en el perfil y premia si ya tiene los
    # datos completos (p. ej. un cliente antiguo que ahora entra por Google).
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
    if not perfil.email_verificado:
        from django.utils import timezone
        perfil.email_verificado = True
        perfil.email_verificado_en = timezone.now()
        perfil.save(update_fields=['email_verificado', 'email_verificado_en'])
        revisar_recompensa(perfil)

    refresh = RefreshToken.for_user(user)
    return Response({'access': str(refresh.access_token), 'refresh': str(refresh), 'creada': creada})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: punto de entrada de sesión
@throttle_classes([LoginThrottle])           # anti fuerza bruta: cuenta intentos por IP
def login(request):
    """Login flexible: acepta username o email + password."""
    username_or_email = ((request.data.get('username') or request.data.get('email')) or '').strip().lower()
    password = request.data.get('password')
    if not username_or_email or not password:
        return Response({'detail': 'username/email y password requeridos'}, status=400)

    uname = username_or_email
    if '@' in uname:
        from django.contrib.auth.models import User
        try:
            uname = User.objects.get(email=uname).username or uname
        except User.DoesNotExist:
            pass

    serializer = TokenObtainPairSerializer(data={'username': uname, 'password': password})
    try:
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data)
    except Exception:
        from django.contrib.auth import authenticate
        user = authenticate(username=uname, password=password)
        if user and not user.is_active:
            return Response({'detail': 'no active account'}, status=401)
        return Response({'detail': 'credenciales inválidas'}, status=401)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    u = request.user
    # datos_completos viaja aquí para que la tienda decida si recordarle al cliente
    # que complete su perfil sin pedir otro endpoint en cada página. filter().first()
    # y no u.perfil: una cuenta recién creada por Google todavía no tiene perfil, y
    # acceder al reverse lanzaría DoesNotExist.
    perfil = PerfilUsuario.objects.filter(usuario=u).first()
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
        'datos_completos': bool(perfil and perfil.datos_completos),
        'email_verificado': bool(perfil and perfil.email_verificado),
        'perfil_verificado': bool(perfil and perfil.perfil_verificado),
    })


class PerfilDetail(generics.RetrieveUpdateAPIView):
    """Perfil del usuario autenticado: ver y editar (incluye avatar)."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = PerfilUsuarioSerializer

    def get_object(self):
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.request.user)
        return perfil

    def perform_update(self, serializer):
        perfil = serializer.save()
        revisar_recompensa(perfil)   # ¿ya completó todo y falta entregarle el 5%?


class ObrasClienteList(generics.ListCreateAPIView):
    """Las obras que el cliente guarda para reusar sus datos al cotizar."""
    serializer_class = ObraClienteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ObraCliente.objects.filter(usuario=self.request.user)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)


class ObraClienteDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ObraClienteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ObraCliente.objects.filter(usuario=self.request.user)


@api_view(['GET'])
@permission_classes([EsOperador])   # el operador vincula la renta a la cuenta del cliente
def clientes_lookup(request):
    """Cuentas de cliente para vincular una renta a su panel ("Tus rentas").
    Solo id/nombre/correo; accesible a operadores (no expone todo el usuario)."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    qs = (User.objects.filter(is_active=True, groups__name='Cliente')
          .select_related('perfil')
          .order_by('first_name', 'username')[:500])
    # La empresa (declarada en su perfil) distingue homónimos sin exhibir correos.
    data = [{'id': u.id,
             'nombre': (f'{u.first_name} {u.last_name}'.strip() or u.username),
             'empresa': getattr(getattr(u, 'perfil', None), 'empresa', '') or '',
             'email': u.email} for u in qs]
    return Response({'clientes': data})


# ─────────────────────────────────────────────
#  MÉTRICAS / NOTIFICACIONES
# ─────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])  # dinero del negocio: no lo ve el almacén
def dashboard_metrics(request):
    from datetime import timedelta, date
    from django.db.models import Sum, Count
    from django.db.models.functions import TruncMonth
    from inventario.models import Inventario
    from renta.models import Renta
    from ventas.models import Venta

    hoy = timezone.localdate()
    inicio_mes = hoy.replace(day=1)

    inv_por_estado = {
        row['estado']: row['n']
        for row in Inventario.objects.values('estado').annotate(n=Count('id'))
    }

    ventas_mes = Venta.objects.filter(
        estado='activa', fecha__date__gte=inicio_mes
    ).aggregate(t=Sum('total'))['t'] or 0
    rentas_mes = Renta.objects.filter(
        estado__in=['activa', 'finalizada'], creado_en__date__gte=inicio_mes
    ).aggregate(t=Sum('total'))['t'] or 0

    rentas_activas = Renta.objects.filter(estado='activa').count()
    reservas = Renta.objects.filter(estado='reservada').count()
    vencidas = Renta.objects.filter(estado='activa', fecha_fin__lt=hoy).count()
    por_vencer = Renta.objects.filter(
        estado='activa', fecha_fin__gte=hoy, fecha_fin__lte=hoy + timedelta(days=2)
    ).count()
    ventas_activas = Venta.objects.filter(estado='activa').count()

    ingresos_total = float(ventas_mes) + float(rentas_mes)

    # ── Ingresos por mes (últimos 6): ventas + rentas, autoritativo y sin tope ──
    meses = []
    yy, mm = hoy.year, hoy.month
    for i in range(5, -1, -1):
        y2, m2 = yy, mm - i
        while m2 <= 0:
            m2 += 12
            y2 -= 1
        meses.append((y2, m2))
    desde = date(meses[0][0], meses[0][1], 1)

    v_mensual = (Venta.objects.filter(estado='activa', fecha__date__gte=desde)
                 .annotate(mes=TruncMonth('fecha')).values('mes').annotate(t=Sum('total')))
    r_mensual = (Renta.objects.filter(estado__in=['activa', 'finalizada'], creado_en__date__gte=desde)
                 .annotate(mes=TruncMonth('creado_en')).values('mes').annotate(t=Sum('total')))
    vmap = {(row['mes'].year, row['mes'].month): float(row['t'] or 0) for row in v_mensual}
    rmap = {(row['mes'].year, row['mes'].month): float(row['t'] or 0) for row in r_mensual}
    MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    ingresos_por_mes = [{
        'anio': y2, 'mes': m2, 'label': MESES[m2],
        'ventas': vmap.get((y2, m2), 0.0),
        'rentas': rmap.get((y2, m2), 0.0),
        'total': vmap.get((y2, m2), 0.0) + rmap.get((y2, m2), 0.0),
    } for (y2, m2) in meses]

    # Ingreso de hoy (ventas + rentas), autoritativo.
    ventas_hoy = Venta.objects.filter(estado='activa', fecha__date=hoy).aggregate(t=Sum('total'))['t'] or 0
    rentas_hoy = Renta.objects.filter(estado__in=['activa', 'finalizada'], creado_en__date=hoy).aggregate(t=Sum('total'))['t'] or 0
    ingresos_hoy = float(ventas_hoy) + float(rentas_hoy)

    return Response({
        'products': Equipo.objects.count(),
        'inventario': {
            'total': sum(inv_por_estado.values()),
            'disponible': inv_por_estado.get('disponible', 0),
            'rentado': inv_por_estado.get('rentado', 0),
            'mantenimiento': inv_por_estado.get('mantenimiento', 0),
            'vendido': inv_por_estado.get('vendido', 0),
        },
        'rentas': {
            'activas': rentas_activas,
            'reservas': reservas,
            'vencidas': vencidas,
            'por_vencer': por_vencer,
        },
        'ingresos_mes': {
            'ventas': float(ventas_mes),
            'rentas': float(rentas_mes),
            'total': ingresos_total,
        },
        'ingresos_por_mes': ingresos_por_mes,
        'ingresos_hoy': ingresos_hoy,
        # Compatibilidad con el frontend anterior
        'orders': rentas_activas + ventas_activas,
        'revenue': ingresos_total,
    })


def _sync_alertas_vencimiento():
    """Notificaciones de entregas y recolecciones que ya tocan (idempotente vía ref).

    Igual que Mi jornada: mientras la renta no se haya entregado, la tarea es
    ENTREGAR; una vez entregada, se vigila la RECOLECCIÓN. Una renta genera una u
    otra, no las dos.
    """
    try:
        from renta.models import Renta  # import diferido para evitar import circular
    except Exception:
        return
    hoy = timezone.localdate()
    # Reservadas incluidas: una reserva cuyo día de inicio ya llegó necesita
    # entrega aunque el cron todavía no la haya pasado a activa.
    rentas = Renta.objects.filter(estado__in=['activa', 'reservada']).select_related('inventario', 'inventario__equipo')

    # Se arman las notificaciones candidatas en memoria y se deduplica/inserta en
    # bloque: antes era 1 exists() + 1 insert POR renta (N+1) en cada consulta de
    # notificaciones; ahora son 2 queries fijas (existentes + bulk_create).
    candidatas = []
    for r in rentas:
        equipo = r.inventario.equipo.modelo if r.inventario and r.inventario.equipo else 'Equipo'
        cliente = r.cliente or 'Cliente'
        data = {'renta_id': r.id, 'inventario_id': r.inventario_id, 'equipo_id': getattr(r.inventario, 'equipo_id', None), 'codigo': getattr(r.inventario, 'codigo', None)}

        # Falta ENTREGAR: solo se avisa cuando ya toca (hoy o atrasada). Las
        # entregas a futuro se agendan en Mi jornada, no se notifican.
        if not r.entregada_en:
            if r.fecha_inicio and r.fecha_inicio <= hoy:
                atrasada = r.fecha_inicio < hoy
                candidatas.append(Notificacion(
                    tipo='alerta',
                    titulo=f'{"Entrega atrasada" if atrasada else "Entregar hoy"} · {equipo}',
                    mensaje=(f'Entregar a {cliente}. Ubicación: {r.direccion}.'
                             + (f' Debía salir el {r.fecha_inicio}.' if atrasada else '')),
                    seccion='rentas', ref=f'renta-entrega-{r.id}-{r.fecha_inicio}', data=data,
                ))
            continue

        # Ya entregada: ahora toca vigilar la RECOLECCIÓN, solo en rentas activas.
        if r.estado != 'activa':
            continue
        dias = (r.fecha_fin - hoy).days
        if dias < 0:
            candidatas.append(Notificacion(
                tipo='alerta', titulo=f'Renta vencida · {equipo}',
                mensaje=f'{cliente} debió devolver el equipo el {r.fecha_fin}. Ubicación: {r.direccion}.',
                seccion='rentas', ref=f'renta-vencida-{r.id}-{r.fecha_fin}', data=data,
            ))
        elif dias <= 1:
            candidatas.append(Notificacion(
                tipo='alerta', titulo=f'Renta por vencer · {equipo}',
                mensaje=f'La renta de {cliente} vence el {r.fecha_fin}.',
                seccion='rentas', ref=f'renta-porvencer-{r.id}-{r.fecha_fin}', data=data,
            ))

    if not candidatas:
        return
    refs = [n.ref for n in candidatas]
    existentes = set(Notificacion.objects.filter(ref__in=refs).values_list('ref', flat=True))
    nuevas = [n for n in candidatas if n.ref not in existentes]
    if nuevas:
        Notificacion.objects.bulk_create(nuevas)


# Lo único que el técnico ve por notificación son AVISOS DE ACCIÓN de campo, y
# todos son tipo 'alerta': renta vencida (ir a recoger), renta por vencer, y
# reparación estancada. Nada más.
#
# En particular NO ve tipo 'renta': "Nueva renta" y las confirmaciones de
# "entregó/recogió" son eventos del negocio; que se rentó un equipo no es asunto
# suyo, y la entrega ya le aparece como tarea en Mi jornada el día que toca.
# Tampoco 'venta', 'inventario' (estados de mantenimiento) ni 'sistema'
# (cotizaciones, respaldos): todo eso es de administración.
TIPOS_OPERATIVOS = ('alerta',)


def _notifs_visibles(user):
    """Las notificaciones que le tocan a este usuario.

    El técnico (por debajo de administrador) solo ve lo operativo: su trabajo es
    el campo, no las cuentas del negocio. Administración y dueño ven todo.
    """
    qs = Notificacion.objects.all()
    if nivel_de(user) < NIVEL_ADMIN:
        qs = qs.filter(tipo__in=TIPOS_OPERATIVOS)
    return qs


class NotificacionesList(generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificacionSerializer

    def list(self, request, *args, **kwargs):
        _sync_alertas_vencimiento()
        visibles = _notifs_visibles(request.user)
        return Response({
            'notificaciones': self.get_serializer(visibles[:100], many=True).data,
            'no_leidas': visibles.filter(leida=False).count(),
        })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_notificacion_leida(request, pk: int):
    # Scope a lo que el usuario ve: un técnico no marca (ni cuenta) notificaciones
    # de administración que ni siquiera le aparecen.
    visibles = _notifs_visibles(request.user)
    visibles.filter(pk=pk).update(leida=True)
    return Response({'ok': True, 'no_leidas': visibles.filter(leida=False).count()})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_todas_leidas(request):
    # Solo las que el usuario ve: el técnico no debe marcar leídas las del negocio.
    _notifs_visibles(request.user).filter(leida=False).update(leida=True)
    return Response({'ok': True, 'no_leidas': 0})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: formulario de contacto del cliente
@throttle_classes([SolicitudPublicaThrottle])  # crea registros sin sesión: mismo techo
def crear_contacto_soporte(request):
    nombre = (request.data.get('nombre') or '').strip()
    email = (request.data.get('email') or '').strip().lower()
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
        qs = ConversacionSoporte.objects.all().prefetch_related('mensajes')
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
