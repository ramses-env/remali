from rest_framework import generics, permissions
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon
)
from .serializers import (
    EquipoSerializer, CategoriaSerializer, MarcaSerializer, TipoSerializer,
    CuponSerializer
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
    # orders y revenue removidos temporalmente por refactorización de Orden
    return Response({ 'products': products, 'orders': 0, 'revenue': 0.0 })



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
