import logging

from django.db import transaction
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import permissions

from maquinaria.permissions import IsAdminGroupOrStaff, EsOperador
from .models import Venta, ItemVenta

logger = logging.getLogger(__name__)



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
                    # La venta/renta ya quedó registrada; que no truene por facturación.
                    logger.exception('No se pudo registrar la solicitud de factura de la venta de refacciones')
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
        'inventario', 'inventario__equipo', 'usuario', 'cliente_usuario', 'empresa', 'cotizacion'
    ).prefetch_related('solicitudes_factura').order_by('-fecha')

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
            # Cuenta de cliente ligada (por la liga de vinculación), si la hay.
            'cuenta': ((v.cliente_usuario.get_full_name() or v.cliente_usuario.username)
                       if v.cliente_usuario_id else None),
            'factura_estado': next((s.estado for s in v.solicitudes_factura.all() if s.estado != 'cancelada'), None),
            # Sin unidad amarrada (venta desde cotización): que la columna diga
            # de qué equipo(s) fue y de qué folio nació, no un guion.
            'origen': (
                {'folio': v.cotizacion.folio,
                 'resumen': ', '.join(i.descripcion for i in v.cotizacion.items.all()[:2])}
                if (not inv and v.cotizacion_id and v.cotizacion) else None
            ),
            'unidad': None if not inv else {
                'id': inv.id,
                'codigo': inv.codigo,
                'numero_serie': inv.numero_serie,
                'equipo': inv.equipo.modelo if inv.equipo else None,
            },
        })
    return Response({'ventas': data, 'total': len(data)})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def ventas_mias(request):
    """Compras del cliente en sesión (ligadas por la liga de vinculación)."""
    qs = (Venta.objects.filter(cliente_usuario=request.user)
          .select_related('inventario', 'inventario__equipo', 'cotizacion')
          .order_by('-fecha')[:100])
    data = []
    for v in qs:
        inv = v.inventario
        concepto = (inv.equipo.modelo if inv and inv.equipo else None) \
            or (v.cotizacion.folio if v.cotizacion_id and v.cotizacion else None) or 'Compra'
        data.append({
            'id': v.id, 'fecha': v.fecha, 'total': str(v.total),
            'estado': v.estado, 'metodo_pago': v.metodo_pago, 'concepto': concepto,
        })
    return Response({'compras': data})


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


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def mandar_por_facturar_venta(request, pk: int):
    """Manda una venta YA registrada a la bandeja "Por facturar".

    Toda venta trae IVA, pero no todos piden factura — y muchos la piden
    días después. El snapshot fiscal sale del perfil del cliente vinculado
    (si lo llenó); lo que falte se completa en la bandeja."""
    from decimal import Decimal
    from facturacion.models import SolicitudFactura
    v = Venta.objects.select_related('cliente_usuario', 'empresa').filter(pk=pk).first()
    if not v:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'La venta está cancelada.'}, status=400)
    if v.solicitudes_factura.exclude(estado='cancelada').exists():
        return Response({'detalle': 'Ya está en la bandeja de facturación.', 'ya': True})
    perfil = getattr(v.cliente_usuario, 'perfil', None) if v.cliente_usuario_id else None
    fp = {'efectivo': '01', 'transferencia': '03', 'tarjeta': '04'}.get(v.metodo_pago, '')
    s = SolicitudFactura.objects.create(
        tipo='venta', venta=v, empresa=v.empresa if v.empresa_id else None,
        rfc=getattr(perfil, 'fiscal_rfc', '') or '',
        razon_social=getattr(perfil, 'fiscal_razon_social', '') or '',
        codigo_postal=getattr(perfil, 'fiscal_cp', '') or '',
        regimen_fiscal=getattr(perfil, 'fiscal_regimen', '') or '',
        uso_cfdi=getattr(perfil, 'fiscal_uso_cfdi', '') or '',
        email=getattr(perfil, 'fiscal_email', '') or (v.cliente_usuario.email if v.cliente_usuario_id else ''),
        # Si se cobró sin desglose (aplica_iva=False), el precio ya trae el IVA
        # dentro: se desglosa del total cobrado, no se suma encima.
        subtotal=v.subtotal if v.aplica_iva else (v.total / Decimal('1.16')).quantize(Decimal('0.01')),
        iva=v.iva if v.aplica_iva else v.total - (v.total / Decimal('1.16')).quantize(Decimal('0.01')),
        total=v.total, forma_pago=fp,
        concepto=f'Venta #{v.id}',
    )
    return Response({'detalle': 'En la bandeja Por facturar.', 'solicitud_id': s.id}, status=201)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def generar_vinculo_venta(request, pk: int):
    """Genera una liga de un solo uso para que un cliente ligue esta venta a su cuenta."""
    import secrets
    from datetime import timedelta
    from django.utils import timezone
    try:
        v = Venta.objects.get(pk=pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'No se puede vincular una venta cancelada.'}, status=400)
    v.token_vinculo = secrets.token_hex(16)
    v.token_vinculo_expira = timezone.now() + timedelta(days=30)
    v.save(update_fields=['token_vinculo', 'token_vinculo_expira'])
    # Ruta RELATIVA a propósito: el frontend le antepone su propio origen, así el
    # enlace sirve en dev, en el túnel y en producción sin hardcodear el dominio.
    return Response({
        'token': v.token_vinculo,
        'ruta': f'/vincular/venta/{v.token_vinculo}',
        'expira': v.token_vinculo_expira,
    })


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def vinculo_venta(request, token: str):
    """GET previsualiza la venta de la liga; POST la liga a la cuenta del usuario (un solo uso)."""
    from django.utils import timezone
    v = Venta.objects.select_related('inventario', 'inventario__equipo').filter(token_vinculo=token).first()
    if not v:
        return Response({'detalle': 'Enlace no válido o ya utilizado.'}, status=404)
    if v.token_vinculo_expira and v.token_vinculo_expira < timezone.now():
        return Response({'detalle': 'Este enlace ya caducó. Pide uno nuevo.'}, status=410)

    concepto = 'Compra de maquinaria'
    if v.inventario and v.inventario.equipo:
        concepto = v.inventario.equipo.modelo or concepto

    if request.method == 'GET':
        return Response({
            'tipo': 'venta', 'id': v.id, 'fecha': v.fecha, 'total': str(v.total),
            'cliente': v.nombre_cliente or '', 'concepto': concepto,
            'ya_ligada': bool(v.cliente_usuario_id),
        })

    # POST → reclamar
    if v.estado == 'cancelada':
        return Response({'detalle': 'Esta venta está cancelada; no se puede vincular.'}, status=400)
    v.cliente_usuario = request.user   # cuenta del CLIENTE (no el vendedor)
    v.token_vinculo = None             # un solo uso: se limpia al reclamar
    v.token_vinculo_expira = None
    v.save(update_fields=['cliente_usuario', 'token_vinculo', 'token_vinculo_expira'])
    return Response({'detalle': 'Listo: la venta quedó ligada a tu cuenta.', 'id': v.id})


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
    # Carta presentable (el térmico queda solo para refacciones en mostrador).
    from server.orden_carta import render_orden_carta_pdf
    pdf = render_orden_carta_pdf(datos_comprobante_venta(v))
    resp = HttpResponse(pdf, content_type='application/pdf')
    resp['Content-Disposition'] = f'inline; filename="ticket_venta_{v.id}.pdf"'
    return resp
