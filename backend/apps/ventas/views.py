from django.db import transaction
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import permissions

from maquinaria.permissions import IsAdminGroupOrStaff, EsOperador
from .models import Venta, ItemVenta


@api_view(['POST'])
@permission_classes([EsOperador])   # el técnico puede cerrar la venta
def venta_mostrador(request):
    """Venta de mostrador de refacciones al público.

    body: { nombre_cliente?, telefono_cliente?, metodo_pago?, items: [{refaccion_id, cantidad}] }
    Crea una Venta + ItemVenta por cada refacción (descuenta stock, desglosa IVA) y devuelve el ticket.
    """
    from refacciones.models import Refaccion
    datos = request.data or {}
    items = datos.get('items') or []
    if not items:
        return Response({'detalle': 'Agrega al menos una refacción'}, status=400)
    try:
        with transaction.atomic():
            venta = Venta.objects.create(
                usuario=request.user if request.user.is_authenticated else None,
                nombre_cliente=(datos.get('nombre_cliente') or '').strip(),
                telefono_cliente=(datos.get('telefono_cliente') or '').strip(),
                metodo_pago=(datos.get('metodo_pago') or 'efectivo'),
                empresa_id=(datos.get('empresa_id') or None),
                # IVA siempre (lo fuerza el modelo). requiere_factura solo controla
                # si se registra la solicitud en la bandeja "Por facturar" (abajo).
            )
            agregados = 0
            for it in items:
                rid = it.get('refaccion_id') or it.get('id')
                try:
                    cant = int(it.get('cantidad') or 1)
                except (ValueError, TypeError):
                    cant = 1
                if not rid or cant <= 0:
                    continue
                try:
                    ref = Refaccion.objects.select_for_update().get(pk=rid)
                except Refaccion.DoesNotExist:
                    raise ValueError('Refacción no encontrada')
                ItemVenta.objects.create(venta=venta, refaccion=ref, cantidad=cant)  # descuenta stock + recalcula
                agregados += 1
            if agregados == 0:
                raise ValueError('No se agregó ninguna refacción válida')
            venta.refresh_from_db()

            # Solicitud de factura (si el cliente la pedirá).
            if datos.get('requiere_factura'):
                try:
                    from facturacion.models import SolicitudFactura
                    SolicitudFactura.registrar(
                        venta=venta,
                        empresa=venta.empresa if venta.empresa_id else None,
                        receptor=datos.get('factura') or {},
                        forma_pago=venta.metodo_pago,
                        concepto='Venta de refacciones',
                    )
                except Exception:
                    pass
    except ValueError as e:
        return Response({'detalle': str(e)}, status=400)

    return Response({
        'detalle': 'Venta registrada',
        'venta': {'id': venta.id, 'subtotal': str(venta.subtotal), 'iva': str(venta.iva), 'total': str(venta.total)},
        'ticket_url': f'/api/ventas/{venta.id}/ticket/',
    }, status=201)


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def listar_ventas(request):
    """Lista de ventas (incluye ventas de maquinaria con su unidad)."""
    qs = Venta.objects.all().select_related(
        'inventario', 'inventario__equipo', 'usuario', 'empresa'
    ).order_by('-fecha')

    solo_maquinaria = (request.query_params.get('maquinaria') or '') in ('1', 'true', 'True')
    if solo_maquinaria:
        qs = qs.filter(inventario__isnull=False)

    estado = (request.query_params.get('estado') or '').strip().lower()
    if estado in ('activa', 'cancelada'):
        qs = qs.filter(estado=estado)

    data = []
    for v in qs[:200]:
        inv = v.inventario
        data.append({
            'id': v.id,
            'nombre_cliente': v.nombre_cliente,
            'telefono_cliente': v.telefono_cliente,
            'empresa': v.empresa.nombre if v.empresa_id else None,
            'estado': v.estado,
            'subtotal': str(v.subtotal),
            'iva': str(v.iva),
            'total': str(v.total),
            'metodo_pago': v.metodo_pago,
            'fecha': v.fecha,
            'vendedor': getattr(v.usuario, 'username', None),
            'unidad': None if not inv else {
                'id': inv.id,
                'codigo': inv.codigo,
                'numero_serie': inv.numero_serie,
                'equipo': inv.equipo.modelo if inv.equipo else None,
            },
        })
    return Response({'ventas': data, 'total': len(data)})


@api_view(['POST', 'PATCH'])
@permission_classes([IsAdminGroupOrStaff])
def cancelar_venta(request, pk: int):
    """Cancela una venta: reabastece refacciones y devuelve la máquina a inventario."""
    try:
        v = Venta.objects.select_related('inventario', 'inventario__equipo').get(pk=pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'La venta ya está cancelada'}, status=400)

    motivo = (request.data or {}).get('motivo', '').strip()
    v.cancelar(motivo=motivo)

    try:
        from maquinaria.models import crear_notificacion
        crear_notificacion(
            'venta',
            f'Venta cancelada · #{v.id}',
            f'Se canceló la venta #{v.id} por ${v.total}.' + (f' Motivo: {motivo}' if motivo else ''),
            seccion='ventas',
            data={'venta_id': v.id},
        )
    except Exception:
        pass

    return Response({'detalle': 'Venta cancelada', 'venta': {'id': v.id, 'estado': v.estado}})


def _get_venta_full(pk):
    return Venta.objects.select_related(
        'inventario', 'inventario__equipo', 'empresa'
    ).prefetch_related('items', 'items__refaccion').get(pk=pk)


@api_view(['GET'])
@permission_classes([EsOperador])
def comprobante_venta(request, pk: int):
    """Datos del ticket de venta en JSON (para el modal dentro del sistema)."""
    try:
        v = _get_venta_full(pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    from .comprobante import datos_comprobante_venta
    return Response(datos_comprobante_venta(v))


@api_view(['GET'])
@permission_classes([EsOperador])
def ticket_venta(request, pk: int):
    """Ticket de venta en PDF (descarga/impresión alterna)."""
    try:
        v = _get_venta_full(pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    from .comprobante import datos_comprobante_venta
    from server.ticketing import render_comprobante_pdf
    pdf = render_comprobante_pdf(datos_comprobante_venta(v))
    resp = HttpResponse(pdf, content_type='application/pdf')
    resp['Content-Disposition'] = f'inline; filename="ticket_venta_{v.id}.pdf"'
    return resp
