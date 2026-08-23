"""Caja: sesiones (turnos) y movimientos.

La caja es un concepto aparte del rol y del permiso (ver ventas/models.py):
- quién PUEDE operarla lo decide el permiso `usar_caja`;
- qué DINERO hay dentro lo lleva una SESIÓN abierta;
- cada evento queda en un LIBRO que no se borra (MovimientoCaja).

Nota MySQL: la restricción "una sesión abierta por usuario" es un índice parcial
que MySQL no crea, así que se refuerza AQUÍ (abrir_sesion revisa antes de crear).
"""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import PuedeHacerCorteCaja, PuedeUsarCaja, puede_de
from .models import Caja, SesionCaja, MovimientoCaja, Venta


def _dec(v, default='0') -> Decimal:
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def sesion_abierta_de(user):
    """La sesión abierta del usuario, o None. Fuente única de la verdad para el
    gate de venta y para el POS."""
    if not user or not user.is_authenticated:
        return None
    return SesionCaja.objects.filter(usuario=user, estado=SesionCaja.ABIERTA).select_related('caja').first()


def caja_por_defecto():
    """La caja activa del negocio; si no hay ninguna, crea la principal.

    Un negocio de una sola caja nunca tuvo que darla de alta, así que no se puede
    exigir que exista antes del primer cobro."""
    caja = Caja.objects.filter(activa=True).order_by('id').first()
    if not caja:
        caja, _ = Caja.objects.get_or_create(nombre='Caja principal', defaults={'activa': True})
    return caja


def asegurar_sesion_abierta(user):
    """Devuelve (sesion, abierta_ahora).

    Si el usuario ya tiene turno abierto, lo devuelve tal cual. Si no, abre uno
    con fondo $0 en vez de rechazar el cobro.

    Por qué se abre solo y no se deja el movimiento "pendiente de asignar": el
    dinero cobrado está en el cajón EN ESE MOMENTO. Colgarlo del turno siguiente
    haría que el arqueo dejara de responder "¿lo que hay en el cajón es lo que
    debería haber?", que es lo único para lo que sirve un corte. Abrirlo al vuelo
    da la misma comodidad —el mostrador no se detiene con el cliente enfrente—
    sin el hueco de conciliación. El fondo inicial se corrige al cerrar.
    """
    sesion = sesion_abierta_de(user)
    if sesion:
        return sesion, False
    caja = caja_por_defecto()
    with transaction.atomic():
        sesion = SesionCaja.objects.create(caja=caja, usuario=user, monto_inicial=Decimal('0'))
        MovimientoCaja.objects.create(
            sesion=sesion, caja=caja, usuario=user, tipo=MovimientoCaja.APERTURA,
            afecta_efectivo=True, monto=Decimal('0'),
            concepto='Apertura automática al registrar un cobro',
        )
    return sesion, True


def caja_permite(que):
    """¿El negocio dejó encendido cobrar `que` desde la caja? ('venta' | 'renta')

    Se consulta EN EL SERVIDOR, no solo escondiendo el botón: si el switch solo
    viviera en la interfaz, apagarlo sería decorativo y cualquiera con la sesión
    abierta podría llamar al endpoint igual.
    """
    from maquinaria.models import ConfiguracionSitio
    cfg = ConfiguracionSitio.get_solo()
    return bool(cfg.caja_vende_maquinaria if que == 'venta' else cfg.caja_renta_maquinaria)


def registrar_cobro_en_caja(user, *, monto, metodo_pago, concepto, venta=None, renta=None,
                            tipo=None):
    """Cuelga un cobro del turno del usuario, abriéndolo si hacía falta.

    Devuelve (movimiento, turno_abierto_ahora) para que la interfaz pueda avisar
    que se abrió el turno sola. Solo el EFECTIVO toca el arqueo del cajón; tarjeta
    y transferencia se registran para el corte del turno pero no se cuentan como
    billete —mismo criterio que la venta de refacciones.

    `tipo` permite distinguir lo que NO es una venta. El caso real es el depósito
    en garantía de una renta: es dinero que entra al cajón (y el arqueo lo tiene
    que esperar) pero no es ingreso —es del cliente, y algún día se le devuelve—.
    Va como ENTRADA para que cuente en el efectivo esperado sin inflar el total
    de ventas del turno.
    """
    sesion, abierta_ahora = asegurar_sesion_abierta(user)
    mov = MovimientoCaja.objects.create(
        sesion=sesion, caja=sesion.caja, usuario=user,
        tipo=tipo or MovimientoCaja.VENTA, metodo_pago=metodo_pago or 'efectivo',
        afecta_efectivo=(metodo_pago == 'efectivo'),
        monto=monto, venta=venta, renta=renta, concepto=concepto,
    )
    return mov, abierta_ahora


def _sesion_dict(s, con_movimientos=False, ligero=False) -> dict:
    d = {
        'id': s.id,
        'caja': s.caja.nombre, 'caja_id': s.caja_id,
        'usuario': getattr(s.usuario, 'username', None), 'usuario_id': s.usuario_id,
        'estado': s.estado,
        'abierta_en': s.abierta_en, 'cerrada_en': s.cerrada_en,
        'monto_inicial': str(s.monto_inicial),
        # Cerradas: el arqueo guardado. Abiertas: nulos (se calcula en vivo abajo).
        'monto_esperado': str(s.monto_esperado) if s.monto_esperado is not None else None,
        'monto_contado': str(s.monto_contado) if s.monto_contado is not None else None,
        'diferencia': str(s.diferencia) if s.diferencia is not None else None,
    }
    if not ligero:   # los agregados son consultas; se omiten en la lista
        d['efectivo_esperado'] = str(s.efectivo_esperado())
        d['por_metodo'] = {k: str(v) for k, v in s.totales_por_metodo().items()}
    if con_movimientos:
        d['movimientos'] = [{
            'id': m.id, 'tipo': m.tipo, 'tipo_label': m.get_tipo_display(),
            'metodo_pago': m.metodo_pago, 'afecta_efectivo': m.afecta_efectivo,
            'monto': str(m.monto), 'concepto': m.concepto, 'referencia': m.referencia,
            'venta_id': m.venta_id, 'creado_en': m.creado_en,
            'usuario': getattr(m.usuario, 'username', None),
        } for m in s.movimientos.select_related('usuario').all()]
    return d


@api_view(['GET'])
@permission_classes([PuedeUsarCaja])
def sesion_actual(request):
    """La sesión abierta del usuario, o null. El POS la consulta al entrar."""
    s = sesion_abierta_de(request.user)
    return Response({'sesion': _sesion_dict(s) if s else None})


@api_view(['POST'])
@permission_classes([PuedeUsarCaja])
def abrir_sesion(request):
    """Abre un turno con un fondo inicial. Uno por usuario a la vez."""
    if sesion_abierta_de(request.user):
        return Response({'detalle': 'Ya tienes una caja abierta. Ciérrala antes de abrir otra.', 'codigo': 'ya_abierta'}, status=400)
    inicial = _dec(request.data.get('monto_inicial'))
    if inicial < 0:
        return Response({'detalle': 'El fondo inicial no puede ser negativo.'}, status=400)
    caja_id = request.data.get('caja_id')
    caja = (Caja.objects.filter(pk=caja_id, activa=True).first() if caja_id
            else Caja.objects.filter(activa=True).order_by('id').first())
    if not caja and not caja_id:
        # Negocio de una sola caja / primera vez: se crea la principal al vuelo,
        # para que nadie se quede sin poder abrir turno si no hay ninguna.
        caja, _ = Caja.objects.get_or_create(nombre='Caja principal', defaults={'activa': True})
    if not caja:
        return Response({'detalle': 'Esa caja no está disponible.'}, status=400)
    with transaction.atomic():
        s = SesionCaja.objects.create(caja=caja, usuario=request.user, monto_inicial=inicial)
        MovimientoCaja.objects.create(
            sesion=s, caja=caja, usuario=request.user, tipo=MovimientoCaja.APERTURA,
            afecta_efectivo=True, monto=inicial, concepto='Apertura de caja',
        )
    return Response({'detalle': 'Caja abierta', 'sesion': _sesion_dict(s, con_movimientos=True)}, status=201)


@api_view(['POST'])
@permission_classes([PuedeHacerCorteCaja])   # cerrar el turno es el corte, no usar la caja
def cerrar_sesion(request, pk: int):
    """Cierra el turno con el arqueo: contado vs esperado → diferencia."""
    s = SesionCaja.objects.filter(pk=pk).select_related('caja').first()
    if not s:
        return Response({'detalle': 'Sesión no encontrada'}, status=404)
    # El cajero cierra la suya; administración puede cerrar cualquiera.
    if s.usuario_id != request.user.id and not puede_de(request.user).get('ver_dinero'):
        return Response({'detalle': 'No puedes cerrar la caja de otro usuario.'}, status=403)
    if s.estado == SesionCaja.CERRADA:
        return Response({'detalle': 'Esta caja ya está cerrada.'}, status=400)
    esperado = s.efectivo_esperado()
    contado = _dec(request.data.get('monto_contado'))
    with transaction.atomic():
        s.monto_esperado = esperado
        s.monto_contado = contado
        s.diferencia = contado - esperado
        s.cerrada_en = timezone.now()
        s.estado = SesionCaja.CERRADA
        s.notas_cierre = (request.data.get('notas') or '').strip()[:300]
        s.save(update_fields=['monto_esperado', 'monto_contado', 'diferencia', 'cerrada_en', 'estado', 'notas_cierre'])
        MovimientoCaja.objects.create(
            sesion=s, caja=s.caja, usuario=request.user, tipo=MovimientoCaja.CIERRE,
            afecta_efectivo=False, monto=Decimal('0'),
            concepto=f'Cierre · esperado {esperado} · contado {contado} · dif {s.diferencia}',
        )
    return Response({'detalle': 'Caja cerrada', 'sesion': _sesion_dict(s, con_movimientos=True)})


@api_view(['POST'])
@permission_classes([PuedeUsarCaja])
def movimiento_caja(request, pk: int):
    """Entrada / retiro de efectivo, o ajuste autorizado. Todos tocan el cajón."""
    s = SesionCaja.objects.filter(pk=pk).select_related('caja').first()
    if not s:
        return Response({'detalle': 'Sesión no encontrada'}, status=404)
    if s.estado != SesionCaja.ABIERTA:
        return Response({'detalle': 'La caja está cerrada.'}, status=400)
    if s.usuario_id != request.user.id and not puede_de(request.user).get('ver_dinero'):
        return Response({'detalle': 'No es tu caja.'}, status=403)
    tipo = (request.data.get('tipo') or '').strip().lower()
    if tipo not in (MovimientoCaja.ENTRADA, MovimientoCaja.RETIRO, MovimientoCaja.AJUSTE):
        return Response({'detalle': 'Tipo inválido. Usa entrada, retiro o ajuste.'}, status=400)
    # El ajuste lo autoriza administración: mueve la caja sin una venta detrás.
    if tipo == MovimientoCaja.AJUSTE and not puede_de(request.user).get('ver_dinero'):
        return Response({'detalle': 'Un ajuste solo lo autoriza administración.'}, status=403)
    monto = _dec(request.data.get('monto'))
    if monto <= 0:
        return Response({'detalle': 'El monto debe ser mayor a cero.'}, status=400)
    # Signo: entra (+) / sale (−). El ajuste toma el signo pedido.
    if tipo == MovimientoCaja.RETIRO:
        monto = -abs(monto)
    elif tipo == MovimientoCaja.ENTRADA:
        monto = abs(monto)
    else:
        negativo = str(request.data.get('signo') or '').strip() in ('-', 'menos', 'negativo', 'salida')
        monto = -abs(monto) if negativo else abs(monto)
    m = MovimientoCaja.objects.create(
        sesion=s, caja=s.caja, usuario=request.user, tipo=tipo,
        afecta_efectivo=True, monto=monto,
        concepto=(request.data.get('concepto') or '').strip()[:200],
        referencia=(request.data.get('referencia') or '').strip()[:80],
    )
    return Response({'detalle': 'Movimiento registrado', 'movimiento_id': m.id,
                     'sesion': _sesion_dict(s, con_movimientos=True)}, status=201)


@api_view(['GET'])
@permission_classes([PuedeUsarCaja])
def sesion_detalle(request, pk: int):
    """Detalle + movimientos de una sesión (arqueo)."""
    s = SesionCaja.objects.filter(pk=pk).select_related('caja').first()
    if not s:
        return Response({'detalle': 'Sesión no encontrada'}, status=404)
    if s.usuario_id != request.user.id and not puede_de(request.user).get('ver_dinero'):
        return Response({'detalle': 'No es tu caja.'}, status=403)
    return Response({'sesion': _sesion_dict(s, con_movimientos=True)})


@api_view(['GET'])
@permission_classes([PuedeUsarCaja])
def sesiones_lista(request):
    """Historial de sesiones. El cajero ve las suyas; administración, todas."""
    ver_todo = bool(puede_de(request.user).get('ver_dinero'))
    qs = SesionCaja.objects.select_related('caja', 'usuario').all()
    if ver_todo:
        uid = (request.query_params.get('usuario') or '').strip()
        if uid.isdigit():
            qs = qs.filter(usuario_id=int(uid))
    else:
        qs = qs.filter(usuario=request.user)
    return Response({'sesiones': [_sesion_dict(s, ligero=True) for s in qs[:100]], 'ver_todo': ver_todo})


@api_view(['GET'])
@permission_classes([PuedeUsarCaja])
def ventas_recientes(request):
    """Ventas de mostrador recientes (activas), para buscar una y devolverla."""
    from django.db.models import Q
    q = (request.query_params.get('q') or '').strip()
    qs = (Venta.objects.filter(estado='activa', inventario__isnull=True)
          .prefetch_related('items', 'items__refaccion').order_by('-fecha'))
    if q:
        qs = qs.filter(Q(folio__icontains=q) | Q(nombre_cliente__icontains=q))
    data = []
    for v in qs[:30]:
        items = list(v.items.all())
        data.append({
            'id': v.id, 'folio': v.folio, 'fecha': v.fecha,
            'cliente': v.nombre_cliente or 'Público general',
            'metodo_pago': v.metodo_pago, 'total': str(v.total),
            'piezas': sum(i.cantidad for i in items),
            'resumen': ', '.join(i.refaccion.nombre for i in items[:2] if i.refaccion_id) or '—',
        })
    return Response({'ventas': data})


def _quien_autoriza_devolucion(request, usuario, password):
    """El gerente/admin/dueño que respalda la devolución, o None.

    Una devolución mueve dinero, así que la autoriza alguien que ve las cuentas.
    Si quien la hace ya las ve, es su propia autoridad (no se pide dos veces); si
    es un cajero, valida las credenciales de un autorizador en el momento
    (override de supervisor, sin cerrar la sesión del cajero)."""
    if puede_de(request.user).get('ver_dinero'):
        return request.user
    ident = (usuario or '').strip()
    if not ident or not password:
        return None
    from django.contrib.auth import get_user_model
    from django.db.models import Q
    U = get_user_model()
    m = U.objects.filter(Q(username__iexact=ident) | Q(email__iexact=ident), is_active=True).first()
    if m and m.check_password(password) and puede_de(m).get('ver_dinero'):
        return m
    return None


@api_view(['POST'])
@permission_classes([PuedeUsarCaja])
def devolucion_caja(request):
    """Devuelve una venta de mostrador: reabastece el stock y saca el reembolso de
    la sesión ACTUAL (el efectivo sale del cajón abierto). Genera un movimiento
    inverso (devolución); la venta original y su movimiento de venta NO se borran.

    La respalda un gerente/admin (ver _quien_autoriza_devolucion): quien ya ve las
    cuentas se autoriza solo; el cajero necesita las credenciales de un gerente."""
    sesion = sesion_abierta_de(request.user)
    if not sesion:
        return Response({'detalle': 'Debes abrir una caja para registrar la devolución.', 'codigo': 'sin_caja'}, status=400)
    v = Venta.objects.filter(pk=request.data.get('venta_id')).prefetch_related('items').first()
    if not v:
        return Response({'detalle': 'Venta no encontrada'}, status=404)
    if v.inventario_id:
        return Response({'detalle': 'Aquí solo se devuelven ventas de mostrador (refacciones).'}, status=400)
    if v.estado == 'cancelada':
        return Response({'detalle': 'Esta venta ya fue cancelada o devuelta.'}, status=400)
    if MovimientoCaja.objects.filter(venta=v, tipo=MovimientoCaja.DEVOLUCION).exists():
        return Response({'detalle': 'Esta venta ya tiene una devolución registrada.'}, status=400)
    autoriza = _quien_autoriza_devolucion(request, request.data.get('autoriza_usuario'), request.data.get('autoriza_password'))
    if not autoriza:
        return Response({'detalle': 'Esta devolución necesita la autorización de un gerente o administrador.', 'codigo': 'requiere_autorizacion'}, status=403)
    motivo = (request.data.get('motivo') or '').strip()
    total, metodo = v.total, v.metodo_pago
    with transaction.atomic():
        v.cancelar(motivo=motivo or 'Devolución en caja')   # reabastece stock + estado cancelada
        MovimientoCaja.objects.create(
            sesion=sesion, caja=sesion.caja, usuario=request.user,
            tipo=MovimientoCaja.DEVOLUCION, metodo_pago=metodo,
            afecta_efectivo=(metodo == 'efectivo'), monto=-total, venta=v,
            concepto=f'Devolución {v.folio or ("#" + str(v.id))}' + (f' · {motivo}' if motivo else ''),
            referencia=(f'Autorizó {autoriza.get_username()}' if autoriza.id != request.user.id else ''),
        )
    return Response({
        'detalle': 'Devolución registrada',
        'reembolso': str(total), 'metodo': metodo, 'efectivo': (metodo == 'efectivo'),
        'autorizo': autoriza.get_username(),
        'sesion': _sesion_dict(sesion, con_movimientos=True),
    })
