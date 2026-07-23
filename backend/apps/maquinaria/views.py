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

from .permissions import EsDueno, EsOperador, EsOperadorEditaAdmin, puede_de
from .throttling import SolicitudPublicaThrottle, LoginThrottle, RegistroThrottle

from django.conf import settings

from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon, Notificacion, PerfilUsuario, crear_notificacion,
    ConversacionSoporte, MensajeSoporte, ConfiguracionSitio, CorreoAviso,
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

        # Disponibilidad derivada de las unidades de inventario
        uso = (params.get('uso') or '').strip().lower()
        if uso == 'venta':
            qs = qs.filter(unidades__estado='disponible').distinct()
        elif uso == 'renta':
            qs = qs.filter(unidades__condicion='seminueva', unidades__estado='disponible').distinct()

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
        'negocio_rfc': cfg.negocio_rfc,
        'negocio_footer': cfg.negocio_footer,
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
    except IntegrityError:
        # Dos altas simultáneas con el mismo correo: la segunda choca con el índice.
        return Response({'detail': 'Ya existe una cuenta con ese correo.'}, status=400)

    user.first_name = nombre[:150]
    user.is_staff = False
    user.is_superuser = False
    user.save(update_fields=['first_name', 'is_staff', 'is_superuser'])

    grupo, _ = Group.objects.get_or_create(name='Cliente')
    user.groups.add(grupo)

    return Response({'detail': 'Cuenta creada.'}, status=201)


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
        user.set_unusable_password()   # entra por Google, no tiene contraseña
        user.first_name = (info.get('given_name') or '')[:150]
        user.last_name = (info.get('family_name') or '')[:150]
        user.is_staff = False
        user.is_superuser = False
        user.save()
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        user.groups.add(grupo)
        creada = True

    if not user.is_active:
        # Mismo criterio fail-closed que nivel_de: cuenta desactivada no entra,
        # aunque su Google sea válido.
        return Response({'detail': 'Tu cuenta no está activa. Contacta al administrador.'}, status=403)

    refresh = RefreshToken.for_user(user)
    return Response({'access': str(refresh.access_token), 'refresh': str(refresh), 'creada': creada})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: punto de entrada de sesión
@throttle_classes([LoginThrottle])           # anti fuerza bruta: cuenta intentos por IP
def login(request):
    """Login flexible: acepta username o email + password."""
    username_or_email = request.data.get('username') or request.data.get('email')
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
    })


class PerfilDetail(generics.RetrieveUpdateAPIView):
    """Perfil del usuario autenticado: ver y editar (incluye avatar)."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = PerfilUsuarioSerializer

    def get_object(self):
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.request.user)
        return perfil


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
    """Genera notificaciones de rentas vencidas / por vencer (idempotente vía ref)."""
    try:
        from renta.models import Renta  # import diferido para evitar import circular
    except Exception:
        return
    hoy = timezone.localdate()
    activas = Renta.objects.filter(estado='activa').select_related('inventario', 'inventario__equipo')

    # Se arman las notificaciones candidatas en memoria y se deduplica/inserta en
    # bloque: antes era 1 exists() + 1 insert POR renta (N+1) en cada consulta de
    # notificaciones; ahora son 2 queries fijas (existentes + bulk_create).
    candidatas = []
    for r in activas:
        equipo = r.inventario.equipo.modelo if r.inventario.equipo else 'Equipo'
        cliente = r.cliente or 'Cliente'
        dias = (r.fecha_fin - hoy).days
        data = {'renta_id': r.id, 'inventario_id': r.inventario_id, 'equipo_id': getattr(r.inventario, 'equipo_id', None), 'codigo': getattr(r.inventario, 'codigo', None)}
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


class NotificacionesList(generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificacionSerializer

    def list(self, request, *args, **kwargs):
        _sync_alertas_vencimiento()
        qs = Notificacion.objects.all()[:100]
        return Response({
            'notificaciones': self.get_serializer(qs, many=True).data,
            'no_leidas': Notificacion.objects.filter(leida=False).count(),
        })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_notificacion_leida(request, pk: int):
    Notificacion.objects.filter(pk=pk).update(leida=True)
    return Response({'ok': True, 'no_leidas': Notificacion.objects.filter(leida=False).count()})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_todas_leidas(request):
    Notificacion.objects.filter(leida=False).update(leida=True)
    return Response({'ok': True, 'no_leidas': 0})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])  # público: formulario de contacto del cliente
@throttle_classes([SolicitudPublicaThrottle])  # crea registros sin sesión: mismo techo
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
