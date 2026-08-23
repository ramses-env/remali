import csv

from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import IsAdminGroupOrStaff
from .models import SolicitudFactura
from .serializers import SolicitudFacturaSerializer

# Campos fiscales que se pueden completar/corregir antes de timbrar.
CAMPOS_EDITABLES = ['rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi', 'email', 'forma_pago', 'notas']


def _qs(params):
    qs = (SolicitudFactura.objects.all()
          .select_related('cliente', 'venta', 'renta')
          .prefetch_related('facturas__subida_por'))
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


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def subir_factura(request, pk: int):
    """Recibe el XML timbrado en la app externa y lo liga a su solicitud.

    Todo o nada: o queda la factura completa con la solicitud marcada, o no
    queda nada. Una solicitud a medio marcar sería peor que no haber subido.
    """
    from django.db import transaction
    from maquinaria.models import ConfiguracionSitio
    from .cfdi import CFDIInvalido, leer_cfdi
    from .models import Factura
    from .serializers import FacturaSerializer
    from .validacion import DescuadreCFDI, revisar_cfdi

    try:
        sol = SolicitudFactura.objects.get(pk=pk)
    except SolicitudFactura.DoesNotExist:
        return Response({'detalle': 'Solicitud no encontrada'}, status=404)

    archivo = request.FILES.get('xml')
    if not archivo:
        return Response({'detalle': 'Adjunta el archivo XML del CFDI.'}, status=400)
    if archivo.size > 2 * 1024 * 1024:
        return Response({'detalle': 'Ese archivo es demasiado grande para ser un CFDI.'}, status=400)

    texto = archivo.read().decode('utf-8', errors='replace')
    try:
        datos = leer_cfdi(texto)
    except CFDIInvalido as e:
        return Response({'detalle': str(e)}, status=400)

    cfg = ConfiguracionSitio.objects.first()
    try:
        avisos = revisar_cfdi(datos, sol, rfc_negocio=(cfg.negocio_rfc if cfg else ''))
    except DescuadreCFDI as e:
        return Response({'detalle': str(e)}, status=400)

    campos = {k: v for k, v in datos.items() if k not in ('conceptos', 'version')}
    with transaction.atomic():
        factura = Factura.objects.create(
            solicitud=sol, xml=texto, subida_por=request.user, **campos
        )
        sol.estado = 'facturada'
        sol.uuid = factura.uuid
        sol.fecha_timbrado = timezone.now()
        sol.save(update_fields=['estado', 'uuid', 'fecha_timbrado', 'actualizada'])

    return Response(
        {'detalle': 'Factura registrada', 'avisos': avisos,
         'factura': FacturaSerializer(factura).data},
        status=201,
    )


def _factura_visible(user, pk):
    """La factura si este usuario puede verla; None si no.

    Se devuelve 404 y no 403 cuando no le toca: un 403 confirmaría que esa
    factura existe, y el id es un número consecutivo que cualquiera puede probar.
    """
    from maquinaria.permissions import nivel_de, NIVEL_ADMIN
    from .models import Factura

    f = (Factura.objects
         .select_related('solicitud__venta', 'solicitud__renta')
         .filter(pk=pk)
         .first())
    if f is None:
        return None
    if nivel_de(user) >= NIVEL_ADMIN:
        return f
    venta = f.solicitud.venta
    renta = f.solicitud.renta
    dueno = (venta.cliente_usuario_id if venta else None) or (renta.usuario_id if renta else None)
    return f if (dueno and dueno == user.id) else None


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def descargar_xml(request, pk: int):
    """Baja el CFDI tal como entró: el archivo que vale ante el SAT es este.

    No se regenera desde las columnas ni se reformatea: cualquier byte distinto
    invalida el sello del XML.
    """
    f = _factura_visible(request.user, pk)
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    nombre = f'{f.serie}{f.folio}-{f.uuid[:8]}.xml' if (f.serie or f.folio) else f'{f.uuid}.xml'
    resp = HttpResponse(f.xml, content_type='application/xml; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{nombre}"'
    return resp


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
