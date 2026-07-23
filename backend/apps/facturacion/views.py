import csv

from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import IsAdminGroupOrStaff
from .models import SolicitudFactura
from .serializers import SolicitudFacturaSerializer

# Campos fiscales que se pueden completar/corregir antes de timbrar.
CAMPOS_EDITABLES = ['rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi', 'email', 'forma_pago', 'notas']


def _qs(params):
    qs = SolicitudFactura.objects.all().select_related('empresa', 'venta', 'renta')
    estado = (params.get('estado') or '').strip().lower()
    if estado in ('pendiente', 'facturada', 'cancelada'):
        qs = qs.filter(estado=estado)
    q = (params.get('q') or '').strip()
    if q:
        qs = qs.filter(Q(rfc__icontains=q) | Q(razon_social__icontains=q) | Q(uuid__icontains=q) | Q(concepto__icontains=q))
    return qs


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def listar_solicitudes(request):
    data = SolicitudFacturaSerializer(_qs(request.query_params), many=True).data
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def resumen(request):
    base = SolicitudFactura.objects.all()
    pend = base.filter(estado='pendiente')
    fact = base.filter(estado='facturada')
    return Response({
        'pendientes': pend.count(),
        'facturadas': fact.count(),
        'monto_pendiente': str(pend.aggregate(s=Sum('total'))['s'] or 0),
        'monto_facturado': str(fact.aggregate(s=Sum('total'))['s'] or 0),
    })


@api_view(['PATCH'])
@permission_classes([IsAdminGroupOrStaff])
def actualizar_solicitud(request, pk: int):
    """Completa/corrige los datos fiscales de una solicitud pendiente."""
    try:
        sol = SolicitudFactura.objects.get(pk=pk)
    except SolicitudFactura.DoesNotExist:
        return Response({'detalle': 'Solicitud no encontrada'}, status=404)
    if sol.estado != 'pendiente':
        return Response(
            {'detalle': f'No se pueden editar los datos de una solicitud {sol.get_estado_display().lower()}. '
                        'Reábrela primero si necesitas corregirla.'},
            status=409,
        )
    d = request.data or {}
    for campo in CAMPOS_EDITABLES:
        if campo in d:
            valor = (d.get(campo) or '')
            setattr(sol, campo, valor.strip().upper() if campo == 'rfc' else valor)
    sol.save()
    return Response(SolicitudFacturaSerializer(sol).data)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def marcar_facturada(request, pk: int):
    """Marca la solicitud como facturada guardando el folio fiscal (UUID)."""
    try:
        sol = SolicitudFactura.objects.get(pk=pk)
    except SolicitudFactura.DoesNotExist:
        return Response({'detalle': 'Solicitud no encontrada'}, status=404)
    if sol.estado != 'pendiente':
        return Response(
            {'detalle': f'Esta solicitud ya está {sol.get_estado_display().lower()}; '
                        'no se puede volver a marcar como facturada.'},
            status=409,
        )
    uuid = (request.data.get('uuid') or '').strip()
    if not uuid:
        return Response({'detalle': 'Captura el folio fiscal (UUID) del CFDI timbrado.'}, status=400)
    sol.uuid = uuid
    sol.estado = 'facturada'
    sol.fecha_timbrado = timezone.now()
    notas = request.data.get('notas')
    if notas is not None:
        sol.notas = notas
    sol.save()
    return Response(SolicitudFacturaSerializer(sol).data)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def reabrir_solicitud(request, pk: int):
    """Regresa una solicitud a pendiente (si se timbró por error)."""
    try:
        sol = SolicitudFactura.objects.get(pk=pk)
    except SolicitudFactura.DoesNotExist:
        return Response({'detalle': 'Solicitud no encontrada'}, status=404)
    if sol.estado != 'facturada':
        return Response(
            {'detalle': 'Solo una solicitud facturada puede reabrirse.'},
            status=409,
        )
    sol.estado = 'pendiente'
    sol.uuid = ''
    sol.fecha_timbrado = None
    sol.save()
    return Response(SolicitudFacturaSerializer(sol).data)


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def exportar_csv(request):
    """Exporta la bandeja (respeta filtros ?estado=&q=) para el PAC / contador."""
    resp = HttpResponse(content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="por_facturar.csv"'
    resp.write('﻿')  # BOM para que Excel abra bien los acentos
    w = csv.writer(resp)
    w.writerow([
        'Origen', 'Tipo', 'RFC', 'Razón social', 'CP', 'Régimen', 'Uso CFDI', 'Email',
        'Subtotal', 'IVA', 'Total', 'Forma pago', 'Concepto', 'Estado', 'UUID', 'Fecha timbrado',
    ])
    for s in _qs(request.query_params):
        w.writerow([
            s.folio_origen, s.get_tipo_display(), s.rfc, s.razon_social, s.codigo_postal,
            s.regimen_fiscal, s.uso_cfdi, s.email, s.subtotal, s.iva, s.total, s.forma_pago,
            s.concepto, s.get_estado_display(), s.uuid,
            s.fecha_timbrado.strftime('%Y-%m-%d %H:%M') if s.fecha_timbrado else '',
        ])
    return resp
