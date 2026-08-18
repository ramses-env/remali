import csv
import datetime as _dt
import logging

from django.db import transaction
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import permissions

from maquinaria.permissions import IsAdminGroupOrStaff, EsOperador, PuedeUsarCaja, puede_de
from .models import Venta, ItemVenta, SesionCaja, MovimientoCaja

logger = logging.getLogger(__name__)




def _maquinas_de(venta):
    """Los renglones de máquina de una venta, como los lee el panel.

    Vive aquí y no repetido en cada listado porque el ticket, el historial, los
    pedidos y "mis compras" tienen que contar la misma historia.
    """
    filas = []
    for r in venta.maquinas.select_related('inventario', 'inventario__equipo', 'equipo').all():
        if not r.viva:
            continue
        inv = r.inventario
        filas.append({
            'id': r.id,
            'unidad_id': inv.id if inv else None,
            'codigo': inv.codigo if inv else None,
            'numero_serie': inv.numero_serie if inv else None,
            'equipo': ((inv.equipo.modelo if inv and inv.equipo else None)
                       or (r.equipo.modelo if r.equipo_id else None)),
            'precio': str(r.precio),
            'entregada': r.entregada,
        })
    return filas


def _campos_cliente(datos):
    """Los campos de cliente para construir un documento, resueltos en un solo
    lugar (apps/clientes/resolucion.py). Si viene `cliente_id` se usa; si no, se
    crea uno con lo capturado. Nunca se une por teléfono sin confirmación."""
    from clientes.resolucion import resolver_cliente
    cli, contacto = resolver_cliente(
        cliente_id=datos.get('cliente_id') or None,
        contacto_id=datos.get('contacto_id') or None,
        nombre=datos.get('nombre_cliente') or '',
        telefono=datos.get('telefono_cliente') or '',
    )
    return {'cliente': cli, 'contacto': contacto}
@api_view(['POST'])
@permission_classes([PuedeUsarCaja])   # la caja: cajero, gerente y administración; no el técnico de campo
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
    # La caja opera dentro de un turno: sin una sesión abierta no se registra la
    # venta. El frontend usa el código 'sin_caja' para ofrecer abrir la caja.
    sesion = SesionCaja.objects.filter(usuario=request.user, estado=SesionCaja.ABIERTA).select_related('caja').first()
    if not sesion:
        return Response({'detalle': 'Debes abrir una caja para registrar esta operación.', 'codigo': 'sin_caja'}, status=400)
    try:
        with transaction.atomic():
            venta = Venta.objects.create(
                usuario=request.user if request.user.is_authenticated else None,
                nombre_cliente=(datos.get('nombre_cliente') or '').strip(),
                telefono_cliente=(datos.get('telefono_cliente') or '').strip(),
                metodo_pago=(datos.get('metodo_pago') or 'efectivo'),
                **_campos_cliente(datos),
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

            # Movimiento de caja de la venta: entra al turno. Solo el efectivo
            # toca el cajón; tarjeta/transferencia se registran para el corte del
            # turno pero no cuentan al arqueo de efectivo.
            MovimientoCaja.objects.create(
                sesion=sesion, caja=sesion.caja, usuario=request.user,
                tipo=MovimientoCaja.VENTA, metodo_pago=venta.metodo_pago,
                afecta_efectivo=(venta.metodo_pago == 'efectivo'), monto=venta.total,
                venta=venta, concepto=f'Venta {venta.folio or ("#" + str(venta.id))}',
            )

            # Solicitud de factura (si el cliente la pedirá).
            if datos.get('requiere_factura'):
                try:
                    from facturacion.models import SolicitudFactura
                    SolicitudFactura.registrar(
                        venta=venta,
                        cliente=venta.cliente if venta.cliente_id else None,
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
        'venta': {'id': venta.id, 'folio': venta.folio, 'subtotal': str(venta.subtotal), 'iva': str(venta.iva), 'total': str(venta.total)},
        'ticket_url': f'/api/ventas/{venta.id}/ticket/',
        'sesion_id': sesion.id,
    }, status=201)


@api_view(['GET'])
@permission_classes([PuedeUsarCaja])
def corte_caja(request):
    """Corte del día: lo que pasó por la CAJA, desglosado por origen.

    Antes leía `Venta` filtrando `inventario__isnull=True`, es decir, solo
    refacciones: la caja era el mostrador y la maquinaria vivía aparte. Desde que
    el negocio puede encender la venta de maquinaria y las rentas en la caja, ese
    filtro escondía dinero que sí está en el cajón. Ahora la fuente son los
    MOVIMIENTOS de caja, que es donde queda registrado todo lo que se cobró ahí,
    venga de donde venga.

    El cajero ve solo lo suyo; de administración para arriba se ve la caja de
    todos, o la de un cajero en concreto (?cajero=<id>).

    Devuelve lo esperado por método (efectivo/tarjeta/transferencia), el desglose
    por origen (refacciones / maquinaria / rentas / depósitos) y el detalle; el
    conteo físico y la diferencia los pone la interfaz.
    """
    from decimal import Decimal
    from django.utils import timezone
    from .models import MovimientoCaja

    dia = timezone.localdate()
    pedida = (request.query_params.get('fecha') or '').strip()
    if pedida:
        try:
            dia = _dt.date.fromisoformat(pedida)
        except ValueError:
            pass

    qs = (MovimientoCaja.objects
          .filter(creado_en__date=dia, tipo__in=[MovimientoCaja.VENTA, MovimientoCaja.ENTRADA])
          .select_related('usuario', 'venta', 'venta__inventario', 'renta')
          .order_by('-creado_en'))

    ver_todo = bool(puede_de(request.user).get('ver_dinero'))
    if ver_todo:
        cid = (request.query_params.get('cajero') or '').strip()
        if cid.isdigit():
            qs = qs.filter(usuario_id=int(cid))
    else:
        qs = qs.filter(usuario=request.user)

    def origen_de(m):
        """De dónde salió el dinero, para que el corte lo pueda desglosar."""
        if m.renta_id:
            return 'depositos' if m.tipo == MovimientoCaja.ENTRADA else 'rentas'
        if m.venta_id:
            # Una venta con unidad de inventario es maquinaria; sin ella, mostrador.
            return 'maquinaria' if m.venta.inventario_id else 'refacciones'
        return 'otros'

    metodos = {'efectivo': [0, Decimal('0')], 'tarjeta': [0, Decimal('0')], 'transferencia': [0, Decimal('0')]}
    origenes = {k: [0, Decimal('0')] for k in ('refacciones', 'maquinaria', 'rentas', 'depositos', 'otros')}
    movimientos = []
    total = Decimal('0')
    for m in qs:
        met = m.metodo_pago if m.metodo_pago in metodos else 'efectivo'
        importe = m.monto or Decimal('0')
        org = origen_de(m)
        metodos[met][0] += 1
        metodos[met][1] += importe
        origenes[org][0] += 1
        origenes[org][1] += importe
        total += importe
        v = m.venta
        movimientos.append({
            'id': m.id,
            'folio': (v.folio if v else None) or (f'renta #{m.renta_id}' if m.renta_id else None),
            'hora': m.creado_en,
            'cliente': (v.nombre_cliente if v else None) or 'Público general',
            'metodo_pago': m.metodo_pago,
            'origen': org,
            'afecta_efectivo': m.afecta_efectivo,
            'concepto': m.concepto,
            'total': str(importe),
            'cajero': getattr(m.usuario, 'username', None),
        })

    return Response({
        'fecha': dia,
        'ver_todo': ver_todo,
        'por_metodo': {k: {'tickets': c, 'total': str(sm)} for k, (c, sm) in metodos.items()},
        'por_origen': {k: {'movimientos': c, 'total': str(sm)} for k, (c, sm) in origenes.items() if c},
        'tickets': len(movimientos),
        'total': str(total),
        'movimientos': movimientos,
    })


def _rango_fechas(params):
    """(desde, hasta) como date desde ?desde=&hasta= (AAAA-MM-DD), o (None, None)."""
    def _p(v):
        try:
            return _dt.date.fromisoformat((v or '').strip()) if v else None
        except ValueError:
            return None
    return _p(params.get('desde')), _p(params.get('hasta'))


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def exportar_ventas_csv(request):
    """Reporte de ventas en CSV (abre en Excel). Respeta ?estado=&desde=&hasta=."""
    estado = (request.query_params.get('estado') or '').strip().lower()
    desde, hasta = _rango_fechas(request.query_params)
    qs = (Venta.objects.select_related('inventario__equipo', 'equipo', 'cliente', 'usuario', 'cotizacion')
          .prefetch_related('solicitudes_factura').order_by('-fecha'))
    if estado in ('activa', 'cancelada', 'apartada'):
        qs = qs.filter(estado=estado)
    if desde:
        qs = qs.filter(fecha__date__gte=desde)
    if hasta:
        qs = qs.filter(fecha__date__lte=hasta)

    resp = HttpResponse(content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="reporte_ventas.csv"'
    resp.write('﻿')  # BOM: Excel abre bien los acentos
    w = csv.writer(resp)
    w.writerow(['Fecha', 'Venta #', 'Cliente', 'Teléfono', 'Empresa', 'Equipo', 'Código',
                'Método de pago', 'Subtotal', 'IVA', 'Total', 'Pagado', 'Saldo', 'Estado', 'Facturación'])
    from decimal import Decimal
    # Ingreso = solo ventas CONSUMADAS (activas). Un apartado aún no es ingreso:
    # se cuenta su saldo aparte como "por cobrar".
    tsub = tiva = ttot = Decimal('0')
    tapart = Decimal('0')
    for v in qs:
        inv = v.inventario
        fac = next((s.get_estado_display() for s in v.solicitudes_factura.all() if s.estado != 'cancelada'), '—')
        if v.estado == 'activa':
            tsub += v.subtotal or 0; tiva += v.iva or 0; ttot += v.total or 0
        elif v.estado == 'apartada':
            tapart += v.saldo_pendiente()
        w.writerow([
            v.fecha.strftime('%Y-%m-%d %H:%M') if v.fecha else '',
            v.id,
            v.nombre_cliente or (v.cliente.nombre if v.cliente_id else '') or 'Público general',
            v.telefono_cliente or '',
            v.cliente.nombre if v.cliente_id else '',
            (inv.equipo.modelo if inv and inv.equipo else '') or (v.equipo.modelo if v.equipo_id else '') or 'Venta mostrador',
            # Todas las máquinas de la venta, no solo la primera: el reporte tiene
            # que poder contarse contra el inventario.
            ' / '.join(r.inventario.codigo for r in v.maquinas.all() if r.viva and r.inventario_id),
            v.get_metodo_pago_display(),
            v.subtotal, v.iva, v.total,
            v.pagado(), v.saldo_pendiente(),
            v.get_estado_display(), fac,
        ])
    w.writerow([])
    w.writerow(['', '', '', '', '', '', '', 'TOTALES (solo consumadas)', tsub, tiva, ttot, '', '', '', ''])
    w.writerow(['', '', '', '', '', '', '', 'Apartados por cobrar (saldo)', '', '', '', '', tapart, '', ''])
    return resp


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def listar_ventas(request):
    """Lista de ventas (incluye ventas de maquinaria con su unidad)."""
    qs = Venta.objects.all().select_related(
        'inventario', 'inventario__equipo', 'equipo', 'usuario', 'cliente_usuario', 'cliente', 'cotizacion'
    ).prefetch_related(
        'solicitudes_factura', 'maquinas__inventario__equipo', 'maquinas__equipo',
    ).order_by('-fecha')

    solo_maquinaria = (request.query_params.get('maquinaria') or '') in ('1', 'true', 'True')
    if solo_maquinaria:
        qs = qs.filter(inventario__isnull=False)

    estado = (request.query_params.get('estado') or '').strip().lower()
    if estado in ('activa', 'cancelada', 'apartada'):
        qs = qs.filter(estado=estado)

    # Filtro por periodo (año/mes/rango). Sin periodo pedido → el año en curso,
    # para no arrastrar todo el histórico (ni volver a topar en 200 en silencio).
    from server.periodos import rango_periodo, anio_actual
    ini, fin = rango_periodo(request.query_params)
    if ini is None and fin is None:
        ini, fin = rango_periodo({'anio': str(anio_actual())})
    if ini:
        qs = qs.filter(fecha__gte=ini)
    if fin:
        qs = qs.filter(fecha__lt=fin)

    data = []
    for v in qs:
        inv = v.inventario
        data.append({
            'id': v.id,
            'folio': v.folio,
            'nombre_cliente': v.nombre_cliente,
            'telefono_cliente': v.telefono_cliente,
            'cliente': v.cliente.nombre if v.cliente_id else None,
            'estado': v.estado,
            'subtotal': str(v.subtotal),
            'iva': str(v.iva),
            'total': str(v.total),
            'pagado': str(v.pagado()),
            'saldo': str(v.saldo_pendiente()),
            'sobre_pedido': v.sobre_pedido,
            'fecha_estimada_entrega': v.fecha_estimada_entrega,
            'entregada_en': v.entregada_en,
            'metodo_pago': v.metodo_pago,
            'fecha': v.fecha,
            'vendedor': getattr(v.usuario, 'username', None),
            # Rastro si el precio se ajustó a mano al vender (de lista X → Y + motivo).
            'nota_ajuste': v.nota_ajuste or None,
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
            # Cada máquina de la venta, con su serie y su precio. `unidad` (la
            # primera) se conserva para lo que todavía la lee.
            'maquinas': _maquinas_de(v),
            'unidad': None if not inv else {
                'id': inv.id,
                'codigo': inv.codigo,
                'numero_serie': inv.numero_serie,
                'equipo': inv.equipo.modelo if inv.equipo else None,
            },
            # Equipo pedido cuando aún no hay unidad (apartado sobre pedido).
            'equipo': ((inv.equipo.modelo if inv and inv.equipo else None)
                       or (v.equipo.modelo if v.equipo_id else None)),
        })
    return Response({'ventas': data, 'total': len(data)})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def ventas_mias(request):
    """Compras del cliente en sesión (ligadas por la liga de vinculación)."""
    qs = (Venta.objects.filter(cliente_usuario=request.user)
          .select_related('inventario', 'inventario__equipo', 'equipo', 'cotizacion')
          .prefetch_related('maquinas__inventario__equipo', 'maquinas__equipo')
          .order_by('-fecha')[:100])
    data = []
    for v in qs:
        inv = v.inventario
        concepto = (inv.equipo.modelo if inv and inv.equipo else None) \
            or (v.equipo.modelo if v.equipo_id else None) \
            or (v.cotizacion.folio if v.cotizacion_id and v.cotizacion else None) or 'Compra'
        data.append({
            'id': v.id, 'fecha': v.fecha, 'total': str(v.total),
            'pagado': str(v.pagado()), 'saldo': str(v.saldo_pendiente()),
            # Historial de abonos: el cliente ve lo que ha pagado de su apartado,
            # igual que en sus rentas. Antes solo veía el saldo, sin el desglose.
            'pagos': v.pagos or [],
            'sobre_pedido': v.sobre_pedido,
            'pedido_fase': v.pedido_fase,
            'fecha_estimada_entrega': v.fecha_estimada_entrega,
            'estado': v.estado, 'metodo_pago': v.metodo_pago, 'concepto': concepto,
            # Si compró varias máquinas, que las vea todas con su número de serie.
            'maquinas': _maquinas_de(v),
        })
    return Response({'compras': data})


# ─────────────────────────────────────────────
#  PEDIDOS Y APARTADOS (venta con anticipo)
# ─────────────────────────────────────────────
def _serialize_pedido(v):
    inv = v.inventario
    return {
        'id': v.id,
        'folio': v.folio,
        'nombre_cliente': v.nombre_cliente,
        'telefono_cliente': v.telefono_cliente,
        'cliente': v.cliente.nombre if v.cliente_id else None,
        'cuenta': ((v.cliente_usuario.get_full_name() or v.cliente_usuario.username)
                   if v.cliente_usuario_id else None),
        'estado': v.estado,
        'sobre_pedido': v.sobre_pedido,
        'total': str(v.total),
        'pagado': str(v.pagado()),
        'saldo': str(v.saldo_pendiente()),
        'pagos': v.pagos or [],
        'metodo_pago': v.metodo_pago,
        'anticipo_nota': v.anticipo_nota or None,
        'fecha': v.fecha,
        'fecha_estimada_entrega': v.fecha_estimada_entrega,
        'pedido_fase': v.pedido_fase,
        'entregada_en': v.entregada_en,
        'vendedor': getattr(v.usuario, 'username', None),
        'equipo': ((inv.equipo.modelo if inv and inv.equipo else None)
                   or (v.equipo.modelo if v.equipo_id else None)),
        'equipo_id': (inv.equipo_id if inv else v.equipo_id),
        # Las máquinas del pedido: cuáles ya llegaron y cuáles se esperan.
        'maquinas': _maquinas_de(v),
        'unidad': None if not inv else {
            'id': inv.id, 'codigo': inv.codigo,
            'equipo': inv.equipo.modelo if inv.equipo else None,
        },
    }


@api_view(['GET'])
@permission_classes([EsOperador])
def pedidos_adeudos(request):
    """Ventas 'apartada' (con anticipo): lo que falta por cobrar y entregar.
    Es la sección 'Pedidos y apartados'."""
    from decimal import Decimal
    qs = (Venta.objects.filter(estado='apartada')
          .select_related('inventario', 'inventario__equipo', 'equipo', 'cliente', 'usuario', 'cliente_usuario')
          .order_by('fecha_estimada_entrega', '-fecha'))
    filas, total = [], Decimal('0')
    for v in qs:
        filas.append(_serialize_pedido(v))
        total += v.saldo_pendiente()
    clientes = len({(f.get('cuenta') or f.get('cliente') or f.get('nombre_cliente') or str(f['id'])) for f in filas})
    return Response({'pedidos': filas, 'total': str(total), 'clientes': clientes})


@api_view(['POST'])
@permission_classes([EsOperador])
def registrar_abono_venta(request, pk: int):
    """Registra un abono a un apartado (baja el saldo). NO toca caja (consistente
    con renta y con la venta de maquinaria)."""
    from decimal import Decimal, InvalidOperation
    from django.utils import timezone
    datos = request.data or {}
    try:
        v = Venta.objects.get(pk=pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'La venta está cancelada.'}, status=400)
    try:
        monto = Decimal(str(datos.get('monto') or 0))
    except (InvalidOperation, TypeError):
        return Response({'detalle': 'Monto inválido.'}, status=400)
    if monto <= 0:
        return Response({'detalle': 'El abono debe ser mayor a 0.'}, status=400)
    metodo = (str(datos.get('metodo') or 'efectivo').lower())
    if metodo not in ('efectivo', 'tarjeta', 'transferencia'):
        return Response({'detalle': 'Método de pago inválido.'}, status=400)
    saldo = v.saldo_pendiente()
    if monto > saldo:
        return Response({'detalle': f'El abono (${monto}) es mayor al saldo (${saldo}).'}, status=400)
    sello = timezone.now().isoformat()
    pagos = list(v.pagos or [])
    pagos.append({'fecha': sello, 'monto': str(monto), 'metodo': metodo,
                  'por': request.user.get_username() if request.user.is_authenticated else ''})
    v.pagos = pagos
    v.metodo_pago = metodo
    v.save(update_fields=['pagos', 'metodo_pago'])
    return Response({'detalle': 'Abono registrado', 'pedido': _serialize_pedido(v)})


@api_view(['POST'])
@permission_classes([EsOperador])
def entregar_venta(request, pk: int):
    """Cierra un apartado: exige saldo 0; si es sobre pedido, asigna la unidad que
    ya llegó (`unidad_id`). Marca la unidad vendida y la venta 'activa'."""
    from inventario.models import Inventario
    datos = request.data or {}
    with transaction.atomic():
        try:
            v = Venta.objects.select_for_update().select_related('inventario', 'equipo', 'cliente_usuario').get(pk=pk)
        except Venta.DoesNotExist:
            return Response({'detalle': 'Venta no encontrada'}, status=404)
        if v.estado != 'apartada':
            return Response({'detalle': 'Solo se puede entregar un apartado.'}, status=400)
        if v.saldo_pendiente() > 0:
            return Response({'detalle': f'Falta liquidar el saldo (${v.saldo_pendiente()}). Registra el abono antes de entregar.'}, status=400)
        # Un pedido de varias máquinas rara vez llega completo: se entregan las
        # que estén. `unidad_ids` es la forma nueva; `unidad_id`, la de siempre.
        ids = [i for i in (datos.get('unidad_ids') or []) if i]
        if not ids and datos.get('unidad_id'):
            ids = [datos['unidad_id']]
        unidades = []
        if ids:
            try:
                ids = [int(i) for i in ids]
            except (TypeError, ValueError):
                return Response({'detalle': 'Unidad no válida.'}, status=400)
            unidades = list(Inventario.objects.select_for_update().select_related('equipo').filter(pk__in=ids))
            if len(unidades) != len(set(ids)):
                return Response({'detalle': 'Unidad no encontrada.'}, status=404)
        elif v.sobre_pedido or not v.inventario_id:
            return Response({'detalle': 'Elige la unidad que llegó para entregar el pedido.'}, status=400)
        try:
            v.entregar(unidades=unidades or None, user=request.user)
        except ValueError as e:
            return Response({'detalle': str(e)}, status=400)
        try:
            from maquinaria.models import crear_notificacion
            if v.cliente_usuario_id:
                cod = v.inventario.codigo if v.inventario_id else ''
                crear_notificacion(
                    'venta', 'Tu compra fue entregada',
                    f'Se entregó tu máquina{(" (" + cod + ")") if cod else ""}. ¡Gracias por tu compra!',
                    seccion='mis-compras', usuario=v.cliente_usuario, data={'venta_id': v.id},
                )
        except Exception:
            pass
    return Response({'detalle': 'Entregado', 'pedido': _serialize_pedido(v)})


@api_view(['POST'])
@permission_classes([EsOperador])
def actualizar_pedido_fase(request, pk: int):
    """Avanza el seguimiento de un SOBRE PEDIDO (confirmado → en_camino → en_sucursal)
    y avisa al cliente si tiene cuenta ligada. La entrega final se hace aparte."""
    try:
        v = Venta.objects.select_related('equipo', 'inventario', 'inventario__equipo', 'cliente_usuario').get(pk=pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Pedido no encontrado.'}, status=404)
    if not v.sobre_pedido:
        return Response({'detalle': 'Solo los pedidos sobre pedido tienen seguimiento.'}, status=400)
    if v.estado != 'apartada':
        return Response({'detalle': 'El pedido ya se entregó o canceló.'}, status=400)
    fase = str(request.data.get('fase') or '').strip()
    if fase not in dict(Venta.PEDIDO_FASES):
        return Response({'detalle': 'Fase inválida.'}, status=400)

    v.pedido_fase = fase
    v.save(update_fields=['pedido_fase'])

    try:
        from maquinaria.models import crear_notificacion
        if v.cliente_usuario_id:
            equipo = ((v.equipo.modelo if v.equipo_id else None)
                      or (v.inventario.equipo.modelo if v.inventario_id and v.inventario.equipo else None)
                      or 'tu equipo')
            eta = f' Llega aprox. el {v.fecha_estimada_entrega:%d/%m/%Y}.' if (fase == 'en_camino' and v.fecha_estimada_entrega) else ''
            cuerpo = {
                'confirmado': f'Tu pedido de {equipo} está confirmado. Te avisamos cuando salga del proveedor.',
                'en_camino': f'{equipo} ya viene en camino desde el proveedor.{eta}',
                'en_sucursal': f'¡{equipo} llegó a sucursal! Pasa a recogerla; liquida el saldo si te falta.',
            }[fase]
            crear_notificacion(
                'venta', 'Actualización de tu pedido', cuerpo,
                seccion='mis-compras', ref=f'pedido-fase-{v.id}-{fase}',
                usuario=v.cliente_usuario, data={'venta_id': v.id, 'fase': fase},
            )
    except Exception:
        pass
    return Response({'detalle': 'Seguimiento actualizado', 'pedido': _serialize_pedido(v)})


@api_view(['POST'])
@permission_classes([EsOperador])
def crear_pedido(request):
    """Aparta una máquina SOBRE PEDIDO (sin stock): crea una venta 'apartada' con
    anticipo y sin unidad; la unidad se asigna al entregar (cuando llega)."""
    from decimal import Decimal
    from django.utils import timezone
    from maquinaria.models import Equipo, ConfiguracionSitio
    from ventas.models import evaluar_anticipo
    datos = request.data or {}
    try:
        equipo = Equipo.objects.get(pk=int(datos.get('equipo_id')))
    except (TypeError, ValueError, Equipo.DoesNotExist):
        return Response({'detalle': 'Equipo no encontrado.'}, status=404)
    # Puente desde una cotización de SOBRE PEDIDO: si viene `cotizacion_id`, el
    # pedido nace ligado a esa cotización (hereda la cuenta del cliente y, tras
    # guardar, consume su cupón). Es el equivalente a vender_unidad, pero para
    # una máquina que NO está en stock.
    cot = None
    cot_id = datos.get('cotizacion_id')
    if cot_id:
        from cotizaciones.models import Cotizacion
        try:
            cot = Cotizacion.objects.get(pk=int(cot_id))
        except (TypeError, ValueError, Cotizacion.DoesNotExist):
            return Response({'detalle': 'La cotización indicada no existe.'}, status=404)
        if cot.estado != 'aceptada':
            return Response({'detalle': 'Solo se puede concretar una cotización aceptada.'}, status=400)
        if cot.conversiones.exists():
            return Response({'detalle': 'Esta cotización ya se convirtió.'}, status=400)
    # Un sobre pedido lo surte el proveedor a petición del cliente: sirve cualquier
    # equipo con precio de venta (no exigimos el flag 'permite_sobre_pedido', que
    # solo rige cómo se muestra en el catálogo público).
    try:
        precio = Decimal(str(datos.get('precio') or equipo.precio_venta or 0))
    except Exception:
        precio = Decimal('0')
    if precio <= 0:
        return Response({'detalle': 'El equipo no tiene precio de venta definido. Ponle uno para poder pedirlo.'}, status=400)

    metodo = (str(datos.get('metodo_pago') or 'efectivo').lower())
    if metodo not in ('efectivo', 'tarjeta', 'transferencia'):
        metodo = 'efectivo'
    try:
        anticipo = Decimal(str(datos.get('anticipo') or 0))
    except Exception:
        anticipo = Decimal('0')
    anticipo_nota, err = evaluar_anticipo(precio, anticipo, datos.get('codigo_ajuste'), user=request.user)
    if err:
        return Response({'detalle': err['detalle']}, status=err['status'])

    # Fecha estimada de entrega: la que capture el admin (ETA real del proveedor),
    # o, si no la da, la calculada por días del equipo / general del sitio.
    fee = None
    fee_in = (str(datos.get('fecha_estimada_entrega') or '')).strip()
    if fee_in:
        try:
            fee = _dt.date.fromisoformat(fee_in)
        except ValueError:
            fee = None
    if not fee:
        dias = equipo.dias_entrega_pedido or ConfiguracionSitio.get_solo().dias_entrega_pedido or 0
        fee = (timezone.localdate() + _dt.timedelta(days=dias)) if dias else None

    v = Venta(
        usuario=request.user if request.user.is_authenticated else None,
        # Cuenta del cliente (opcional): si se liga, el cliente ve su pedido y su
        # ETA en "Mis compras" y puede seguirlo hasta que llegue. Si el pedido nace
        # de una cotización, hereda la cuenta del cliente que la pidió.
        cliente_usuario_id=(datos.get('cliente_usuario_id') or (cot.usuario_id if cot else None) or None),
        nombre_cliente=(datos.get('nombre_cliente') or '').strip(),
        telefono_cliente=(datos.get('telefono_cliente') or '').strip(),
        **_campos_cliente(datos),
        equipo=equipo,
        sobre_pedido=True,
        estado='apartada',
        inventario=None,
        precio_maquina=precio,
        metodo_pago=metodo,
        anticipo_nota=anticipo_nota,
        fecha_estimada_entrega=fee,
        cotizacion=cot,
    )
    try:
        v.save()
        sello = timezone.now().isoformat()
        por = request.user.get_username() if request.user.is_authenticated else ''
        v.pagos = [{'fecha': sello, 'monto': str(anticipo), 'metodo': metodo, 'por': por}]
        v.save(update_fields=['pagos'])
        # El cliente "gasta" su cupón (5% de bienvenida) al concretarse el pedido.
        # Idempotente y a prueba de fallos: un tropiezo marcándolo jamás debe
        # tumbar un pedido ya guardado.
        if cot is not None and getattr(cot, 'cupon_id', None):
            try:
                cot.cupon.marcar_usado()
            except Exception:
                pass
    except ValueError as e:
        return Response({'detalle': str(e)}, status=400)
    try:
        from maquinaria.models import crear_notificacion
        crear_notificacion(
            'venta', f'Pedido registrado · {equipo.modelo}',
            f'{v.nombre_cliente or "Cliente"} pidió {equipo.modelo}: anticipo ${v.pagado():,.2f} de ${v.total:,.2f} (saldo ${v.saldo_pendiente():,.2f}).',
            seccion='pedidos', data={'venta_id': v.id, 'equipo_id': equipo.id},
        )
    except Exception:
        pass
    return Response({'detalle': 'Pedido registrado', 'pedido': _serialize_pedido(v)}, status=201)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def quitar_maquina_venta(request, pk: int, linea_id: int):
    """Saca una máquina de una venta de varias y la devuelve al inventario.

    Se dañó en el traslado, salió con falla, el cliente se arrepintió de una de
    tres. Cancelar la venta completa mentiría sobre las otras. Es acción
    sensible: pide el código personal de quien la ejecuta y guarda el motivo.
    """
    from ventas.models import VentaMaquina
    try:
        v = Venta.objects.select_related('inventario').get(pk=pk)
    except Venta.DoesNotExist:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'La venta está cancelada.'}, status=400)
    try:
        renglon = VentaMaquina.objects.select_related('inventario', 'inventario__equipo').get(pk=linea_id, venta=v)
    except VentaMaquina.DoesNotExist:
        return Response({'detalle': 'Esa máquina no es de esta venta.'}, status=404)

    datos = request.data or {}
    motivo = (datos.get('motivo') or '').strip()
    if not motivo:
        return Response({'detalle': 'Escribe el motivo por el que se quita la máquina.'}, status=400)

    from maquinaria.seguridad import verificar_codigo
    ok, detalle, status_cod, _c = verificar_codigo(request.user, datos.get('codigo_seguridad'))
    if not ok:
        return Response({'detalle': detalle}, status=status_cod)

    quien = getattr(request.user, 'username', '') or 's/d'
    try:
        with transaction.atomic():
            v.quitar_maquina(renglon, f'{motivo} — autorizó {quien}', user=request.user)
    except ValueError as e:
        return Response({'detalle': str(e)}, status=400)

    try:
        from maquinaria.models import crear_notificacion
        codigo = renglon.inventario.codigo if renglon.inventario_id else 'una máquina'
        crear_notificacion(
            'venta', f'Máquina retirada de la venta #{v.id}',
            f'{codigo} volvió al inventario. Motivo: {motivo}. Nuevo total: ${v.total:,.2f}.',
            seccion='ventas', ref=f'quita-{v.id}-{renglon.id}', data={'venta_id': v.id},
        )
    except Exception:
        pass

    return Response({
        'detalle': 'Máquina retirada de la venta',
        'total': str(v.total),
        'maquinas': _maquinas_de(v),
    })


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

    # Acción sensible: exige el CÓDIGO PERSONAL del operador que la ejecuta.
    from maquinaria.seguridad import verificar_codigo
    ok, detalle, status_cod, _c = verificar_codigo(request.user, (request.data or {}).get('codigo_seguridad'))
    if not ok:
        return Response({'detalle': detalle}, status=status_cod)

    motivo = (request.data or {}).get('motivo', '').strip()
    quien = getattr(request.user, 'username', '') or 's/d'
    v.cancelar(motivo=(f'{motivo} — autorizó {quien}' if motivo else f'Autorizó {quien}'))

    # Reverso de caja (auditoría): si la venta entró a un turno, se crea un
    # movimiento INVERSO (devolución) y se conserva el original. Nunca se borra.
    mov = MovimientoCaja.objects.filter(venta=v, tipo=MovimientoCaja.VENTA).order_by('id').first()
    if mov and not MovimientoCaja.objects.filter(venta=v, tipo=MovimientoCaja.DEVOLUCION).exists():
        MovimientoCaja.objects.create(
            sesion=mov.sesion, caja=mov.caja, usuario=request.user,
            tipo=MovimientoCaja.DEVOLUCION, metodo_pago=mov.metodo_pago,
            afecta_efectivo=mov.afecta_efectivo, monto=-mov.monto, venta=v,
            concepto=f'Cancelación de {v.folio or ("#" + str(v.id))}' + (f' · {motivo}' if motivo else ''),
        )

    try:
        from maquinaria.models import crear_notificacion
        equipo_nombre = (
            v.inventario.equipo.modelo
            if v.inventario_id and v.inventario and v.inventario.equipo
            else 'tu equipo'
        )
        # ── BROADCAST para STAFF ─────────────────────────────────────────────
        crear_notificacion(
            'venta',
            f'Venta cancelada · #{v.id}',
            f'Se canceló la venta #{v.id} por ${v.total}.' + (f' Motivo: {motivo}' if motivo else ''),
            seccion='ventas',
            data={'venta_id': v.id},
        )
        # ── PERSONAL para CLIENTE (2ª persona) ─────────────────────────────
        if v.cliente_usuario_id:
            try:
                crear_notificacion(
                    'venta',
                    f'Se canceló tu compra de {equipo_nombre}',
                    f'Tu compra #{v.id} por ${v.total} fue cancelada.'
                    + (f' Motivo: {motivo}' if motivo else '')
                    + ' Si tienes dudas, contacta a REMALI.',
                    seccion='mis-compras',
                    ref=f'cancelacion-compra-cliente-{v.id}',
                    usuario=v.cliente_usuario,
                    data={'venta_id': v.id, 'accion_cliente': 'cancelacion', 'motivo': motivo or ''},
                )
            except Exception:
                pass
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
    v = Venta.objects.select_related('cliente_usuario', 'cliente').filter(pk=pk).first()
    if not v:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.estado == 'cancelada':
        return Response({'detalle': 'La venta está cancelada.'}, status=400)
    if v.solicitudes_factura.exclude(estado='cancelada').exists():
        return Response({'detalle': 'Ya está en la bandeja de facturación.', 'ya': True})
    perfil = getattr(v.cliente_usuario, 'perfil', None) if v.cliente_usuario_id else None
    fp = {'efectivo': '01', 'transferencia': '03', 'tarjeta': '04'}.get(v.metodo_pago, '')
    s = SolicitudFactura.objects.create(
        tipo='venta', venta=v, cliente=v.cliente if v.cliente_id else None,
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
        concepto=f'Venta {v.folio or ("#" + str(v.id))}',
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
    # Defensa: si ya está ligada a OTRA cuenta, no reasignar (evita robo si se
    # regeneró un enlace sobre una venta ya vinculada). Igual que cotización/orden.
    if v.cliente_usuario_id and v.cliente_usuario_id != request.user.id:
        return Response({'detalle': 'Esta venta ya está ligada a otra cuenta.'}, status=409)
    v.cliente_usuario = request.user   # cuenta del CLIENTE (no el vendedor)
    v.token_vinculo = None             # un solo uso: se limpia al reclamar
    v.token_vinculo_expira = None
    v.save(update_fields=['cliente_usuario', 'token_vinculo', 'token_vinculo_expira'])
    return Response({'detalle': 'Listo: la venta quedó ligada a tu cuenta.', 'id': v.id})


def _get_venta_full(pk):
    return Venta.objects.select_related(
        'inventario', 'inventario__equipo', 'cliente'
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
