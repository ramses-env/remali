from django.db.models import Q, F
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import EsOperador, IsAdminGroupOrStaff
from maquinaria.views import ProtectedDestroyMixin
from .models import Refaccion
from .serializers import RefaccionSerializer


class RefaccionListCreate(generics.ListCreateAPIView):
    serializer_class = RefaccionSerializer

    def get_permissions(self):
        # Consultar refacciones lo necesita el técnico para consumirlas en una
        # reparación. Dar de alta una refacción nueva es inventario: administración.
        return [IsAdminGroupOrStaff()] if self.request.method == 'POST' else [EsOperador()]

    def get_queryset(self):
        qs = Refaccion.objects.all()
        p = self.request.query_params
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(nombre__icontains=q) | Q(codigo_barras__icontains=q) | Q(descripcion__icontains=q))
        if (p.get('bajo_stock') or '') in ('1', 'true', 'True'):
            qs = qs.filter(stock_minimo__gt=0, stock__lte=F('stock_minimo'))
        if (p.get('para_venta') or '') in ('1', 'true', 'True'):
            qs = qs.filter(para_venta=True)
        return qs.order_by('nombre')


class RefaccionDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = Refaccion.objects.all()
    serializer_class = RefaccionSerializer

    def get_permissions(self):
        # El técnico lee y consume (el consumo descuenta stock por la orden de
        # reparación, no editando aquí). Cambiar precio/stock o borrar: admin.
        return [EsOperador()] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else [IsAdminGroupOrStaff()]
    # Refacción usada en mantenimientos o vendida (ambos PROTECT): no se borra
    # para no romper el historial ni el descuento de stock ya registrado.
    en_uso_label = 'registro de uso (mantenimiento o venta)'
    en_uso_label_plural = 'registros de uso (mantenimiento o venta)'


@api_view(['GET'])
@permission_classes([EsOperador])
def buscar_por_codigo(request):
    """Lookup por código de barras (para el lector de códigos)."""
    codigo = (request.query_params.get('codigo') or '').strip()
    if not codigo:
        return Response({'detalle': 'codigo requerido'}, status=400)
    try:
        r = Refaccion.objects.get(codigo_barras=codigo)
    except Refaccion.DoesNotExist:
        return Response({'detalle': 'Refacción no encontrada'}, status=404)
    return Response(RefaccionSerializer(r).data)
