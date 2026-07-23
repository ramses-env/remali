from rest_framework import generics, permissions, status
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from maquinaria.permissions import IsAdminGroupOrStaff
from .models import Empresa, Obra
from .serializers import EmpresaSerializer, ObraSerializer


class EmpresaListCreate(generics.ListCreateAPIView):
    queryset = Empresa.objects.all().prefetch_related('obras').order_by('nombre')
    serializer_class = EmpresaSerializer
    permission_classes = [IsAdminGroupOrStaff]
    filter_backends = [SearchFilter]
    search_fields = ['nombre', 'rfc', 'contacto', 'email']


class EmpresaDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Empresa.objects.all().prefetch_related('obras')
    serializer_class = EmpresaSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def destroy(self, request, *args, **kwargs):
        """Una empresa con historial NO se borra: sus rentas/ventas/facturas
        apuntan con SET_NULL, así que borrarla las dejaría huérfanas y se
        perdería para siempre a quién se le rentó o facturó. Se desactiva."""
        empresa = self.get_object()
        historial = {
            'renta': empresa.rentas.count(),
            'venta': empresa.ventas.count(),
            'cotización': empresa.cotizaciones.count(),
            'orden de reparación': empresa.ordenes_reparacion.count(),
            'solicitud de factura': empresa.solicitudes_factura.count(),
        }
        usados = [f'{n} {nombre}{"" if n == 1 else "s"}' for nombre, n in historial.items() if n]
        if usados:
            return Response(
                {'detail': f'No se puede eliminar "{empresa.nombre}": tiene {", ".join(usados)}. '
                           'Desactívala para ocultarla sin perder el historial.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class ObrasPorEmpresa(generics.ListCreateAPIView):
    """Lista y crea obras de una empresa."""
    serializer_class = ObraSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def get_queryset(self):
        return Obra.objects.filter(empresa_id=self.kwargs['empresa_id']).order_by('nombre')

    def perform_create(self, serializer):
        empresa = get_object_or_404(Empresa, pk=self.kwargs['empresa_id'])
        serializer.save(empresa=empresa)


class ObraDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Obra.objects.all()
    serializer_class = ObraSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def destroy(self, request, *args, **kwargs):
        """Borrar una obra con rentas las dejaría sin encargado ni ubicación
        (SET_NULL). Se bloquea; para cerrarla se usa estado='finalizada'."""
        obra = self.get_object()
        n = obra.rentas.count()
        if n:
            return Response(
                {'detail': f'No se puede eliminar la obra "{obra.nombre}": tiene {n} renta{"" if n == 1 else "s"} '
                           'asociada(s). Márcala como finalizada en su lugar.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)
