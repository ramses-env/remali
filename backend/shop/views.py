from rest_framework import generics, permissions
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon, Orden, ItemOrden, VerificacionEmail
)
from .serializers import (
    EquipoSerializer, CategoriaSerializer, MarcaSerializer, TipoSerializer,
    CuponSerializer, OrdenSerializer
)
from django.conf import settings
from django.core.mail import send_mail
from django.utils.crypto import get_random_string
from django.http import HttpResponseRedirect
from django.contrib.auth.models import Group
from django.db import transaction
from django.shortcuts import get_object_or_404
try:
    from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
    _jwt_serializer_available = True
except Exception:
    _jwt_serializer_available = False

class IsAdminGroupOrStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        u = getattr(request, 'user', None)
        if not u or not u.is_authenticated:
            return False
        if u.is_staff:
            return True
        try:
            return u.groups.filter(name='Administrador').exists()
        except Exception:
            return False

class EquipoListCreate(generics.ListCreateAPIView):
    queryset = Equipo.objects.all().order_by('id')
    serializer_class = EquipoSerializer
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['modelo', 'descripcion', 'categoria__nombre', 'marca__nombre', 'condicion', 'estado']
    ordering_fields = ['precio_dia', 'fecha_creacion', 'modelo']

    def get_permissions(self):
        if self.request.method in ['POST']:
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        qs = super().get_queryset()
        min_price = self.request.query_params.get('price_min')
        max_price = self.request.query_params.get('price_max')
        if min_price:
            qs = qs.filter(precio_dia__gte=min_price)
        if max_price:
            qs = qs.filter(precio_dia__lte=max_price)
        category = self.request.query_params.get('category')
        if category:
            vals = [v.strip() for v in category.split(',') if v.strip()]
            from django.db.models import Q
            q = Q()
            for v in vals:
                if v.isdigit():
                    q |= Q(categoria_id=int(v))
                else:
                    q |= Q(categoria__nombre__iexact=v)
            if q:
                qs = qs.filter(q)
        brand = self.request.query_params.get('brand')
        if brand:
            vals = [v.strip() for v in brand.split(',') if v.strip()]
            from django.db.models import Q
            q = Q()
            for v in vals:
                if v.isdigit():
                    q |= Q(marca_id=int(v))
                else:
                    q |= Q(marca__nombre__iexact=v)
            if q:
                qs = qs.filter(q)
        tipo = self.request.query_params.get('type')
        if tipo:
            vals = [v.strip() for v in tipo.split(',') if v.strip()]
            from django.db.models import Q
            q = Q()
            for v in vals:
                if v.isdigit():
                    q |= Q(tipo_id=int(v))
                else:
                    q |= Q(tipo__nombre__iexact=v)
            if q:
                qs = qs.filter(q)
        last_days = self.request.query_params.get('last_days')
        if last_days:
            from django.utils import timezone
            from datetime import timedelta
            try:
                days = int(last_days)
                qs = qs.filter(fecha_creacion__gte=timezone.now() - timedelta(days=days))
            except ValueError:
                pass
        return qs

class EquipoRetrieveUpdateDestroy(generics.RetrieveUpdateDestroyAPIView):
    queryset = Equipo.objects.all()
    serializer_class = EquipoSerializer
    def get_permissions(self):
        if self.request.method in ['PUT', 'PATCH', 'DELETE']:
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]

class CuponListCreate(generics.ListCreateAPIView):
    queryset = Cupon.objects.all().order_by('id')
    serializer_class = CuponSerializer
    def get_permissions(self):
        if self.request.method in ['POST']:
            return [IsAdminGroupOrStaff()]
        return [permissions.IsAuthenticated()]

class CuponRetrieveUpdateDestroy(generics.RetrieveUpdateDestroyAPIView):
    queryset = Cupon.objects.all()
    serializer_class = CuponSerializer
    permission_classes = [IsAdminGroupOrStaff]

@api_view(['POST'])
def apply_coupon(request):
    codigo = request.data.get('code')
    try:
        coupon = Cupon.objects.get(codigo=codigo, activo=True)
        return Response({ 'discount': float(coupon.descuento) })
    except Cupon.DoesNotExist:
        return Response({ 'discount': 0 }, status=400)

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def create_order(request):
    if not request.user.has_perm('shop.add_orden'):
        return Response({ 'detail': 'sin permiso' }, status=403)
    serializer = OrdenSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    order = serializer.save()
    return Response({ 'id': order.id })

# Inventory adjustment is not compatible with unique items logic (Equipo)
# Removed adjust_inventory view

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def register(request):
    from django.contrib.auth.models import User
    from django.core.validators import validate_email
    from django.core.exceptions import ValidationError
    from django.contrib.auth.password_validation import validate_password
    email = request.data.get('email')
    full_name = request.data.get('full_name')
    password = request.data.get('password')
    if not email or not password:
        return Response({ 'detail': 'email/password requeridos' }, status=400)
    try:
        validate_email(email)
    except ValidationError:
        return Response({ 'detail': 'email inválido' }, status=400)
    if User.objects.filter(email=email).exists() or User.objects.filter(username=email).exists():
        return Response({ 'detail': 'email ya registrado' }, status=400)
    first_name = ''
    last_name = ''
    if full_name:
        parts = full_name.strip().split(' ')
        first_name = parts[0]
        last_name = ' '.join(parts[1:]) if len(parts) > 1 else ''
    try:
        validate_password(password)
    except ValidationError as e:
        return Response({ 'detail': 'password no cumple políticas', 'errors': e.messages }, status=400)
    user = User.objects.create_user(username=email, email=email, password=password, first_name=first_name, last_name=last_name)
    user.is_active = False
    user.save()
    try:
        g, _ = Group.objects.get_or_create(name='Cliente')
        user.groups.add(g)
    except Exception:
        pass
    token = get_random_string(48)
    VerificacionEmail.objects.create(usuario=user, token=token)
    verify_url = f"{settings.BACKEND_URL}/api/auth/verify/{token}/"
    send_mail(
        'Verifica tu correo',
        f'Hola {first_name or ""}, verifica tu cuenta: {verify_url}',
        settings.DEFAULT_FROM_EMAIL,
        [email],
        fail_silently=True,
        html_message=f'Hola {first_name or ""}, <a href="{verify_url}">Verificar aquí</a>'
    )
    payload = { 'id': user.id, 'email': user.email, 'full_name': f"{user.first_name} {user.last_name}".strip(), 'sent': True }
    return Response(payload)

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login(request):
    if not _jwt_serializer_available:
        return Response({ 'detail': 'jwt no disponible' }, status=501)
    username_or_email = request.data.get('username') or request.data.get('email')
    password = request.data.get('password')
    if not username_or_email or not password:
        return Response({ 'detail': 'username/email y password requeridos' }, status=400)
    uname = username_or_email
    if '@' in uname:
        from django.contrib.auth.models import User
        try:
            u = User.objects.get(email=uname)
            uname = u.username or u.email
        except User.DoesNotExist:
            pass
    ser = TokenObtainPairSerializer(data={'username': uname, 'password': password})
    try:
        ser.is_valid(raise_exception=True)
        return Response(ser.validated_data)
    except Exception:
        from django.contrib.auth import authenticate
        user = authenticate(username=uname, password=password)
        if user and not user.is_active:
            return Response({ 'detail': 'no active account' }, status=401)
        return Response({ 'detail': 'credenciales inválidas' }, status=401)

@api_view(['GET'])
def dashboard_metrics(request):
    from django.db.models import Sum, F
    products = Equipo.objects.count()
    orders = Orden.objects.count()
    revenue = Orden.objects.aggregate(total=Sum(F('items__precio')))['total'] or 0
    return Response({ 'products': products, 'orders': orders, 'revenue': float(revenue) })

@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def verify_email(request, token: str):
    from django.utils import timezone
    from datetime import timedelta
    try:
        rec = VerificacionEmail.objects.get(token=token, usado=False)
        timeout = getattr(settings, 'EMAIL_VERIFICATION_TIMEOUT', 14400)
        if rec.fecha_creacion < timezone.now() - timedelta(seconds=timeout):
            return HttpResponseRedirect(f"{settings.FRONTEND_URL}/login?verified=0&expired=1")
        rec.usado = True
        rec.save()
        u = rec.usuario
        u.is_active = True
        u.save()
        return HttpResponseRedirect(f"{settings.FRONTEND_URL}/login?verified=1")
    except VerificacionEmail.DoesNotExist:
        return HttpResponseRedirect(f"{settings.FRONTEND_URL}/login?verified=0")

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def resend_verification(request):
    from django.contrib.auth.models import User
    email = request.data.get('email')
    try:
        user = User.objects.get(email=email)
        if user.is_active:
            return Response({ 'detail': 'ya verificado' })
        token = get_random_string(48)
        VerificacionEmail.objects.create(usuario=user, token=token)
        verify_url = f"{settings.BACKEND_URL}/api/auth/verify/{token}/"
        send_mail('Verifica tu correo', f'Verifica tu cuenta: {verify_url}', settings.DEFAULT_FROM_EMAIL, [email], fail_silently=True, html_message=f'<a href="{verify_url}">Verificar aquí</a>')
        payload = { 'sent': True }
        return Response(payload)
    except User.DoesNotExist:
        return Response({ 'detail': 'email no encontrado' }, status=404)

class CategoriaList(generics.ListCreateAPIView):
    queryset = Categoria.objects.all().order_by('nombre', 'id')
    def get_permissions(self):
        if self.request.method in ['POST']:
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        from .serializers import CategoriaSerializer
        return CategoriaSerializer

class TipoList(generics.ListCreateAPIView):
    queryset = Tipo.objects.all().order_by('nombre', 'id')
    def get_permissions(self):
        if self.request.method in ['POST']:
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]
    def get_serializer_class(self):
        from .serializers import TipoSerializer
        return TipoSerializer

class MarcaList(generics.ListCreateAPIView):
    queryset = Marca.objects.all().order_by('nombre', 'id')
    def get_permissions(self):
        if self.request.method in ['POST']:
            return [IsAdminGroupOrStaff()]
        return [permissions.AllowAny()]
    def get_serializer_class(self):
        from .serializers import MarcaSerializer
        return MarcaSerializer

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    u = request.user
    payload = {
        'id': u.id,
        'email': u.email,
        'username': u.username,
        'first_name': u.first_name,
        'last_name': u.last_name,
        'is_staff': u.is_staff,
        'groups': list(u.groups.values_list('name', flat=True)),
    }
    return Response(payload)

@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
@parser_classes([MultiPartParser, FormParser])
def upload_product_images(request, pk: int):
    equipo = get_object_or_404(Equipo, id=pk)
    files = request.FILES.getlist('images') or request.FILES.getlist('files') or []
    created = []
    for f in files:
        pi = ImagenProducto.objects.create(equipo=equipo, imagen=f)
        try:
            url = pi.imagen.url
        except Exception:
            url = None
        if url:
            created.append(request.build_absolute_uri(url))
    return Response({ 'equipo': equipo.id, 'imagenes': created })
