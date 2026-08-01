import logging

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.core.exceptions import ValidationError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework import permissions

from rest_framework.decorators import throttle_classes

from maquinaria.permissions import IsAdminGroupOrStaff, EsOperador, nivel_de, NIVEL_ADMIN
from maquinaria.throttling import SubidaEvidenciaThrottle
from . import evidencia as ev
from inventario.models import Inventario
from .models import EvidenciaRenta, Renta

logger = logging.getLogger(__name__)



def _serialize_evidencia(e: EvidenciaRenta, request=None):
    try:
        url = e.imagen.url
        if request is not None:
            url = request.build_absolute_uri(url)
    except Exception:
        url = ''
    desfase = None
    if e.tomada_en and e.creada:
        dias = abs((e.creada - e.tomada_en).days)
        if dias >= 1:
            desfase = f'La foto se tomó {dias} día{"s" if dias > 1 else ""} antes de subirse.'
    return {
        'id': e.id,
        'momento': e.momento,
        'momento_label': e.get_momento_display(),
        'imagen': url,
        'nota': e.nota,
        'subida_por': e.subida_por.get_username() if e.subida_por_id else None,
        'tomada_en': e.tomada_en,
        'aviso_desfase': desfase,   # solo para que admin lo note; no bloquea
        'creada': e.creada,
    }


def _serialize_renta(r: Renta, ver_dinero: bool = True):
    """Datos de una renta. Con `ver_dinero=False` se omiten los montos.

    Los montos van incluidos por defecto: quien entrega también cobra. El
    parámetro existe para vistas donde no hacen falta (ver `ubicaciones_equipos`).
    """
    from decimal import Decimal as _D
    pagado = sum((_D(str(p.get('monto', 0))) for p in (r.pagos or [])), _D('0'))
    saldo = max((r.total or _D('0')) + (r.recargo or _D('0')) - pagado, _D('0'))
    datos = {
        'id': r.id,
        # Cuenta de cliente vinculada (para "Tus rentas"); None = sin vincular.
        'cuenta': ((f'{r.usuario.first_name} {r.usuario.last_name}'.strip()
                    or r.usuario.get_username()) if r.usuario_id else None),
        # Abonos y saldo: cuánto ha entregado el cliente y cuánto falta.
        'pagos': r.pagos or [],
        'pagado': str(pagado),
        'saldo': str(saldo),
        'inventario': {
            'id': r.inventario.id,
            'codigo': r.inventario.codigo,
            'numero_serie': r.inventario.numero_serie,
            'equipo': r.inventario.equipo.modelo if r.inventario.equipo else None,
        },
        'modalidad': r.modalidad,
        'duracion': r.duracion,
        'fecha_inicio': r.fecha_inicio,
        'fecha_fin': r.fecha_fin,
        'fecha_devolucion_real': r.fecha_devolucion_real,
        # Cliente
        'cliente': r.cliente,
        'cliente_nombre': r.cliente_nombre,
        'telefono_cliente': r.telefono_cliente,
        'empresa': {'id': r.empresa_id, 'nombre': r.empresa.nombre} if r.empresa_id else None,
        'obra': {
            'id': r.obra_id, 'nombre': r.obra.nombre,
            'responsable': r.obra.responsable, 'telefono': r.obra.telefono,
            'ubicacion': r.obra.ubicacion,
        } if r.obra_id else None,
        'direccion': r.direccion,
        'estado': r.estado,
        'vencida': r.vencida,
        'dias_restantes': r.dias_restantes,
        'alerta': 'Ya tienes que recoger el equipo' if r.vencida else (
            'Vence hoy' if (r.estado == 'activa' and r.dias_restantes == 0) else None
        ),
        # Contadores, no las fotos: la lista no debe cargar URLs de imágenes que
        # nadie va a ver. El detalle las pide aparte.
        'evidencias': _contar_evidencias(r),
        # En qué va físicamente: entregada o no, recogida o no, y por quién.
        'entrega': {
            'entregada': bool(r.entregada_en),
            'en': r.entregada_en,
            'por': r.entregada_por.get_username() if r.entregada_por_id else None,
        },
        'recoleccion': {
            'recogida': bool(r.recogida_en),
            'en': r.recogida_en,
            'por': r.recogida_por.get_username() if r.recogida_por_id else None,
        },
        'creado_en': r.creado_en,
    }
    if ver_dinero:
        datos.update({
            'precio_unitario': str(r.precio_unitario),
            'descuento': str(r.descuento),
            'deposito': str(r.deposito),
            'recargo': str(r.recargo),
            'subtotal': str(r.subtotal),
            'total': str(r.total),
        })
    return datos


def _contar_evidencias(r: Renta):
    """Cuenta por momento iterando la caché del prefetch (nunca .filter/.count)."""
    entrega = devolucion = 0
    for e in r.evidencias.all():
        if e.momento == 'entrega':
            entrega += 1
        else:
            devolucion += 1
    return {'entrega': entrega, 'devolucion': devolucion}


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


@api_view(['GET'])
@permission_classes([EsOperador])
def listar_rentas(request):
    estado = request.query_params.get('estado') or 'activa'
    qs = Renta.objects.all().select_related(
        'inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario'
    ).prefetch_related('evidencias')   # sin esto, contar las fotos sería 1 query por renta
    if estado in ('reservada', 'activa', 'finalizada', 'cancelada'):
        qs = qs.filter(estado=estado)
    data = [_serialize_renta(r) for r in qs.order_by('-creado_en')]
    return Response({'rentas': data})


@api_view(['POST'])
@permission_classes([EsOperador])
def registrar_abono(request, pk):
    """Registra un abono del cliente (muchos pagan después de la renta).

    Body: {monto, metodo}. Se acumula en r.pagos con fecha; el saldo sale
    de total + recargo - abonos. El save dispara el latido."""
    from decimal import Decimal, InvalidOperation
    from django.utils import timezone
    r = Renta.objects.filter(pk=pk).first()
    if not r:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    if r.estado == 'cancelada':
        return Response({'detalle': 'La renta está cancelada; no se abonan pagos.'}, status=400)
    try:
        monto = Decimal(str(request.data.get('monto', '0')))
    except InvalidOperation:
        return Response({'detalle': 'Monto no válido.'}, status=400)
    if monto <= 0:
        return Response({'detalle': 'El abono debe ser mayor a cero.'}, status=400)
    metodo = (request.data.get('metodo') or 'efectivo').strip().lower()
    if metodo not in ('efectivo', 'tarjeta', 'transferencia'):
        return Response({'detalle': 'Método no válido.'}, status=400)
    pagos = list(r.pagos or [])
    pagos.append({'fecha': timezone.now().isoformat(), 'monto': str(monto), 'metodo': metodo,
                  'por': request.user.get_username() if request.user.is_authenticated else ''})
    r.pagos = pagos
    r.save(update_fields=['pagos', 'actualizado_en'])
    return Response({'detalle': 'Abono registrado', 'renta': _serialize_renta(r)})


@api_view(['POST'])
@permission_classes([EsOperador])
def vincular_cuenta(request, pk):
    """Vincula (o cambia) la cuenta de cliente de una renta ya registrada.

    Al crearla es opcional; este endpoint permite hacerlo después, para que
    la renta aparezca en el panel "Tus rentas" del cliente correcto."""
    r = Renta.objects.filter(pk=pk).first()
    if not r:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    uid = request.data.get('usuario_id')
    if not uid:
        r.usuario = None
        r.save(update_fields=['usuario'])
        return Response({'cuenta': None})
    from django.contrib.auth import get_user_model
    u = get_user_model().objects.filter(pk=uid, is_active=True, groups__name='Cliente').first()
    if not u:
        return Response({'detalle': 'Cuenta de cliente no encontrada'}, status=404)
    r.usuario = u
    r.save(update_fields=['usuario'])
    return Response({'cuenta': f'{u.first_name} {u.last_name}'.strip() or u.username})


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def generar_vinculo_renta(request, pk: int):
    """Genera una liga de un solo uso para que un cliente ligue esta renta a su cuenta."""
    import secrets
    from datetime import timedelta
    r = Renta.objects.filter(pk=pk).first()
    if not r:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    if r.estado == 'cancelada':
        return Response({'detalle': 'No se puede vincular una renta cancelada.'}, status=400)
    r.token_vinculo = secrets.token_hex(16)
    r.token_vinculo_expira = timezone.now() + timedelta(days=30)
    r.save(update_fields=['token_vinculo', 'token_vinculo_expira'])
    # Ruta RELATIVA: el frontend le antepone su propio origen (dev/túnel/prod).
    return Response({
        'token': r.token_vinculo,
        'ruta': f'/vincular/renta/{r.token_vinculo}',
        'expira': r.token_vinculo_expira,
    })


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def vinculo_renta(request, token: str):
    """GET previsualiza la renta de la liga; POST la liga a la cuenta del usuario (un solo uso)."""
    r = Renta.objects.select_related('inventario', 'inventario__equipo').filter(token_vinculo=token).first()
    if not r:
        return Response({'detalle': 'Enlace no válido o ya utilizado.'}, status=404)
    if r.token_vinculo_expira and r.token_vinculo_expira < timezone.now():
        return Response({'detalle': 'Este enlace ya caducó. Pide uno nuevo.'}, status=410)

    concepto = 'Renta de maquinaria'
    if r.inventario and r.inventario.equipo:
        concepto = r.inventario.equipo.modelo or concepto

    if request.method == 'GET':
        return Response({
            'tipo': 'renta', 'id': r.id, 'total': str(r.total),
            'fecha_inicio': r.fecha_inicio, 'fecha_fin': r.fecha_fin,
            'concepto': concepto, 'cliente': r.cliente or '',
            'ya_ligada': bool(r.usuario_id),
        })

    # POST → reclamar
    if r.estado == 'cancelada':
        return Response({'detalle': 'Esta renta está cancelada; no se puede vincular.'}, status=400)
    r.usuario = request.user
    r.token_vinculo = None            # un solo uso
    r.token_vinculo_expira = None
    r.save(update_fields=['usuario', 'token_vinculo', 'token_vinculo_expira'])
    return Response({'detalle': 'Listo: la renta quedó ligada a tu cuenta.', 'id': r.id})


@api_view(['GET'])
@permission_classes([EsOperador])
def alertas_renta(request):
    hoy = timezone.localdate()
    qs = Renta.objects.filter(
        estado='activa', fecha_fin__lt=hoy
    ).select_related('inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario').prefetch_related('evidencias')
    data = [_serialize_renta(r) for r in qs]
    return Response({'alertas': data, 'total': len(data)})


@api_view(['POST'])
@permission_classes([EsOperador])   # el técnico cierra la renta al entregar
def crear_renta(request):
    datos = request.data or {}
    inventario_id = datos.get('inventario_id')
    cotizacion_id = datos.get('cotizacion_id')
    modalidad = (datos.get('modalidad') or '').lower()
    duracion = int(datos.get('duracion', 1) or 1)
    direccion = (datos.get('direccion') or '').strip()
    cliente = (datos.get('cliente') or '').strip()
    telefono_cliente = (datos.get('telefono_cliente') or '').strip()
    empresa_id = datos.get('empresa_id') or None
    obra_id = datos.get('obra_id') or None

    def _dec(v):
        try:
            return Decimal(str(v or 0))
        except Exception:
            return Decimal('0')

    descuento = _dec(datos.get('descuento'))
    deposito = _dec(datos.get('deposito'))

    if modalidad not in ('dia', 'semana', 'mes'):
        return Response({'detalle': 'Modalidad inválida. Usa dia, semana o mes.'}, status=400)
    if not inventario_id:
        return Response({'detalle': 'inventario_id es requerido'}, status=400)
    if not direccion:
        return Response({'detalle': 'direccion es requerida'}, status=400)

    with transaction.atomic():
        try:
            inv = Inventario.objects.select_for_update().select_related('equipo').get(pk=inventario_id)
        except Inventario.DoesNotExist:
            return Response({'detalle': 'Inventario no encontrado'}, status=404)

        if not inv.puede_rentarse():
            return Response({'detalle': 'La unidad no está disponible para renta'}, status=400)

        fecha_inicio = _parse_date(datos.get('fecha_inicio')) or timezone.localdate()
        # Si la renta inicia a futuro se agenda como RESERVA (no ocupa la unidad todavía)
        estado = 'reservada' if fecha_inicio > timezone.localdate() else 'activa'

        r = Renta(
            inventario=inv,
            modalidad=modalidad,
            duracion=max(duracion, 1),
            direccion=direccion,
            cliente=cliente,
            telefono_cliente=telefono_cliente,
            empresa_id=empresa_id,
            obra_id=obra_id,
            usuario_id=datos.get('usuario_id') or None,   # cuenta del cliente, para "Tus rentas"
            descuento=descuento,
            deposito=deposito,
            fecha_inicio=fecha_inicio,
            estado=estado,
            aplica_iva=bool(datos.get('requiere_factura')),  # precios sin IVA; se suma si hay factura
        )
        r.fecha_fin = r.calcular_fecha_fin()

        try:
            r.save()
            # Liga con su cotización: explícita si viene, o match único e inequívoco
            # (mismo cliente, tipo renta, aceptada y sin rentas ya ligadas).
            try:
                from cotizaciones.models import Cotizacion as _Cot
                cot = None
                if cotizacion_id:
                    cot = _Cot.objects.filter(id=cotizacion_id, tipo='renta').first()
                elif r.usuario_id:
                    cands = list(_Cot.objects.filter(usuario_id=r.usuario_id, tipo='renta', estado='aceptada', rentas_convertidas__isnull=True)[:2])
                    cot = cands[0] if len(cands) == 1 else None
                if cot:
                    r.cotizacion = cot
                    r.save(update_fields=['cotizacion'])
                    # Toca la cotización: su sello de versión avanza y el
                    # cliente ve el paso "completada" en su siguiente latido.
                    _Cot.objects.filter(pk=cot.pk).update(actualizada=timezone.now())
            except Exception:
                pass  # valida traslape, calcula montos y ocupa la unidad si es 'activa'
        except ValidationError as e:
            return Response({'detalle': ' '.join(e.messages)}, status=400)
        except ValueError as e:
            return Response({'detalle': str(e)}, status=400)

        try:
            from maquinaria.models import crear_notificacion
            equipo_nombre = inv.equipo.modelo if inv.equipo else 'Equipo'
            verbo = 'reservó' if estado == 'reservada' else 'rentó'
            crear_notificacion(
                'renta',
                f'{"Nueva reserva" if estado == "reservada" else "Nueva renta"} · {equipo_nombre}',
                f'{r.cliente_nombre} {verbo} {inv.codigo} ({r.modalidad} x{r.duracion}) '
                f'por ${r.total}. Ubicación: {direccion}.',
                seccion='rentas',
                data={'renta_id': r.id, 'inventario_id': inv.id, 'equipo_id': inv.equipo_id, 'codigo': inv.codigo},
            )
        except Exception:
            pass

        # Solicitud de factura (si el cliente la pedirá) → bandeja "por facturar".
        if datos.get('requiere_factura'):
            try:
                from facturacion.models import SolicitudFactura
                equipo_nombre = inv.equipo.modelo if inv.equipo else 'Equipo'
                SolicitudFactura.registrar(
                    renta=r,
                    empresa=r.empresa if r.empresa_id else None,
                    receptor=datos.get('factura') or {},
                    concepto=f'Renta {r.modalidad} · {equipo_nombre} ({inv.codigo})',
                )
            except Exception:
                # La venta/renta ya quedó registrada; que no truene por facturación.
                logger.exception('No se pudo registrar la solicitud de factura de la renta')

        return Response({
            'renta': _serialize_renta(r),
            'ticket_url': f'/api/rentas/{r.id}/ticket/',
        }, status=201)


@api_view(['POST', 'PATCH'])
@permission_classes([EsOperador])
def devolver_renta(request, pk: int):
    try:
        r = Renta.objects.select_related('inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario').get(pk=pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    # Operadores ven todas; un cliente solo la suya.
    if nivel_de(request.user) < 1 and r.usuario_id != request.user.id:
        return Response({'detalle': 'Sin permiso para esta renta.'}, status=403)
    if r.estado != 'activa':
        return Response({'detalle': f'La renta no está activa (estado: {r.estado})'}, status=400)

    fecha_dev = _parse_date((request.data or {}).get('fecha_devolucion'))
    r.finalizar(fecha_devolucion=fecha_dev, commit=True)

    # Quién la recogió y cuándo: el mismo rastro que la entrega.
    r.recogida_en = timezone.now()
    r.recogida_por = request.user if request.user.is_authenticated else None
    r.save(update_fields=['recogida_en', 'recogida_por', 'actualizado_en'])
    _avisar_movimiento(r, 'recogió', request.user)

    detalle = 'Equipo devuelto y renta finalizada'
    if r.recargo and r.recargo > 0:
        detalle += f'. Recargo por retraso: ${r.recargo}'
    return Response({'renta': _serialize_renta(r), 'detalle': detalle})


@api_view(['POST', 'PATCH'])
@permission_classes([IsAdminGroupOrStaff])
def cancelar_renta(request, pk: int):
    try:
        r = Renta.objects.select_related('inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario').get(pk=pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    if r.estado in ('finalizada', 'cancelada'):
        return Response({'detalle': f'La renta ya está {r.estado}'}, status=400)

    motivo = (request.data or {}).get('motivo', '').strip()
    r.cancelar(motivo=motivo)
    return Response({'renta': _serialize_renta(r), 'detalle': 'Renta cancelada'})


def _get_renta_full(pk):
    return Renta.objects.select_related(
        'inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario'
    ).get(pk=pk)


@api_view(['GET'])
@permission_classes([EsOperador])   # tiene que poder mostrar el comprobante
def comprobante_renta(request, pk: int):
    """Datos del comprobante de renta en JSON (para el modal dentro del sistema)."""
    try:
        r = _get_renta_full(pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    from .comprobante import datos_comprobante_renta
    return Response(datos_comprobante_renta(r))


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def ticket_renta(request, pk: int):
    """Comprobante de renta en PDF (descarga/impresión alterna)."""
    try:
        r = _get_renta_full(pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    from .comprobante import datos_comprobante_renta
    # Carta presentable (el térmico queda solo para refacciones en mostrador).
    from server.orden_carta import render_orden_carta_pdf
    pdf = render_orden_carta_pdf(datos_comprobante_renta(r))
    resp = HttpResponse(pdf, content_type='application/pdf')
    resp['Content-Disposition'] = f'inline; filename="ticket_renta_{r.id}.pdf"'
    return resp


# ─────────────────────────────────────────────
#  EVIDENCIA FOTOGRÁFICA (entrega / devolución)
# ─────────────────────────────────────────────
_MOMENTOS = {'entrega', 'devolucion'}


@api_view(['GET', 'POST'])
@permission_classes([EsOperador])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@throttle_classes([SubidaEvidenciaThrottle])
def evidencias_renta(request, pk: int):
    """GET: fotos de la renta. POST: sube una o varias para un momento dado.

    Las reglas de qué se acepta y cuándo viven en `evidencia.py`, no aquí: son
    de negocio, no de transporte.
    """
    try:
        renta = Renta.objects.get(pk=pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)

    if request.method == 'GET':
        evidencias = renta.evidencias.select_related('subida_por').all()
        return Response({'evidencias': [_serialize_evidencia(e, request) for e in evidencias]})

    momento = (request.data.get('momento') or '').strip().lower()
    if momento not in _MOMENTOS:
        return Response({'detalle': 'Indica el momento: entrega o devolucion.'}, status=400)

    archivos = request.FILES.getlist('imagenes') or request.FILES.getlist('images') or []
    if not archivos:
        return Response({'detalle': 'Adjunta al menos una foto.'}, status=400)

    try:
        ev.revisar_momento(renta, momento)
    except ev.EvidenciaInvalida as e:
        return Response({'detalle': str(e)}, status=409)

    # Tope por momento: esto prueba un estado, no es un álbum.
    ya_hay = sum(1 for x in renta.evidencias.all() if x.momento == momento)
    if ya_hay + len(archivos) > ev.MAX_POR_MOMENTO:
        return Response(
            {'detalle': f'Máximo {ev.MAX_POR_MOMENTO} fotos por momento; ya hay {ya_hay}.'},
            status=400,
        )

    # Se validan TODAS antes de guardar ninguna: media subida deja la evidencia
    # incompleta sin que nadie se entere.
    validados = []
    for f in archivos:
        try:
            formato = ev.validar_imagen(f)
            validados.append((f, formato, ev.fecha_de_captura(f)))
        except ev.EvidenciaInvalida as e:
            return Response({'detalle': str(e)}, status=400)

    nota = (request.data.get('nota') or '').strip()[:200]
    creadas = []
    with transaction.atomic():
        for f, formato, tomada in validados:
            f.name = ev.nombre_seguro(renta.id, momento, formato)   # no confiamos en el nombre del cliente
            creadas.append(EvidenciaRenta.objects.create(
                renta=renta, momento=momento, imagen=f, nota=nota, tomada_en=tomada,
                subida_por=request.user if request.user.is_authenticated else None,
            ))
    return Response({'evidencias': [_serialize_evidencia(e, request) for e in creadas]}, status=201)


@api_view(['DELETE'])
@permission_classes([IsAdminGroupOrStaff])
def evidencia_renta_eliminar(request, pk: int, evidencia_id: int):
    try:
        foto = EvidenciaRenta.objects.select_related('renta').get(pk=evidencia_id, renta_id=pk)
    except EvidenciaRenta.DoesNotExist:
        return Response({'detalle': 'Evidencia no encontrada'}, status=404)
    if not ev.puede_borrarse(foto.renta):
        return Response(
            {'detalle': 'La renta ya está cerrada: su evidencia queda como está. '
                        'Es justo cuando alguien tendría motivo para quitarla.'},
            status=409,
        )
    foto.imagen.delete(save=False)   # no dejar el archivo huérfano en el almacenamiento
    foto.delete()
    return Response(status=204)


# ─────────────────────────────────────────────
#  EL DÍA DEL TÉCNICO: dónde está el equipo y qué hay en taller
# ─────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([EsOperador])
def confirmar_entrega(request, pk: int):
    """El técnico marca que ya entregó el equipo (o corrige que aún no).

    Body: {"entregado": true|false}. Deja constancia de quién y cuándo, y avisa
    a administración por notificación: así se enteran sin llamar a preguntar.
    """
    try:
        r = Renta.objects.select_related('inventario', 'inventario__equipo', 'obra').get(pk=pk)
    except Renta.DoesNotExist:
        return Response({'detalle': 'Renta no encontrada'}, status=404)
    if r.estado in ('finalizada', 'cancelada'):
        return Response({'detalle': f'La renta está {r.get_estado_display().lower()}; ya no se puede marcar la entrega.'}, status=400)

    entregado = request.data.get('entregado', True)
    if not entregado:
        r.entregada_en, r.entregada_por = None, None
        r.save(update_fields=['entregada_en', 'entregada_por', 'actualizado_en'])
        return Response({'detalle': 'Se quitó la marca de entrega', 'renta': _serialize_renta(r)})

    if r.entregada_en:
        return Response({'detalle': 'Ya estaba marcada como entregada', 'renta': _serialize_renta(r)}, status=200)

    r.entregada_en = timezone.now()
    r.entregada_por = request.user if request.user.is_authenticated else None
    r.save(update_fields=['entregada_en', 'entregada_por', 'actualizado_en'])
    # Entregada = la renta ya corre: si era RESERVA, pasa a activa y ocupa la
    # unidad ahí mismo, sin esperar al cron de la fecha de inicio. Las fechas
    # pactadas no se mueven (el vencimiento sigue siendo el acordado).
    if r.estado == 'reservada':
        r.activar()
    _avisar_movimiento(r, 'entregó', request.user)
    # Aviso PERSONAL al cliente ligado a la renta.
    if r.usuario_id:
        from maquinaria.models import crear_notificacion
        eq = r.inventario.equipo.modelo if (r.inventario and r.inventario.equipo) else 'equipo'
        crear_notificacion(
            'renta', 'Tu equipo fue entregado',
            f'Tu renta de {eq} ya fue entregada. Consulta "Tus rentas".',
            ref=f'renta-entrega-{r.id}', data={'renta_id': r.id}, usuario=r.usuario,
        )
    return Response({'detalle': 'Entrega confirmada', 'renta': _serialize_renta(r)})


def _avisar_movimiento(r, verbo, usuario):
    """Notifica a administración. Su panel refresca notificaciones cada pocos
    segundos, así que se entera sin recargar ni preguntar por teléfono."""
    try:
        from maquinaria.models import crear_notificacion
        equipo = r.inventario.equipo.modelo if r.inventario.equipo else 'Equipo'
        lugar = (r.obra.ubicacion if r.obra_id and r.obra.ubicacion else r.direccion) or 'sin dirección'
        quien = getattr(usuario, 'get_username', lambda: 'Alguien')()
        crear_notificacion(
            'renta',
            f'{quien} {verbo} {equipo}',
            f'{r.inventario.codigo} · {lugar}',
            seccion='rentas',
            ref=f'mov-renta-{r.id}-{verbo}',
            data={'renta_id': r.id, 'movimiento': verbo},
        )
    except Exception:
        pass


def _lugar_de(r):
    """Dónde está / a dónde va, con su contacto. Una sola fuente para la tarea."""
    obra = r.obra if r.obra_id else None
    return {
        'lugar': (obra.ubicacion if obra and obra.ubicacion else r.direccion) or 'Sin dirección',
        'obra': obra.nombre if obra else None,
        'contacto': (obra.responsable if obra and obra.responsable else r.cliente_nombre) or '',
        'telefono': (obra.telefono if obra and obra.telefono else r.telefono_cliente) or '',
        'empresa': r.empresa.nombre if r.empresa_id else None,
    }


# Orden de atención. La recolección vencida es lo más urgente que existe: es
# equipo que ya debería estar de vuelta y no lo está.
PRIORIDAD = {'vencida': 0, 'hoy': 1, 'reparar': 2, 'manana': 3, 'proxima': 4}


@api_view(['GET'])
@permission_classes([EsOperador])
def mis_tareas(request):
    """Lo ÚNICO que el técnico tiene que hacer, ordenado por lo que urge.

    No es un inventario ni un mapa: es una lista de acciones. Una máquina
    entregada a mitad de renta no aparece (no hay nada que hacer con ella); solo
    lo que exige entregar, recoger o reparar ahora.
    """
    hoy = timezone.localdate()
    tareas = []

    rentas = (Renta.objects
              .filter(estado__in=['activa', 'reservada'])
              .select_related('inventario', 'inventario__equipo', 'empresa', 'obra', 'usuario')
              .prefetch_related('evidencias'))

    for r in rentas:
        base = {
            'renta_id': r.id,
            'equipo': r.inventario.equipo.modelo if r.inventario.equipo else 'Equipo',
            'codigo': r.inventario.codigo,
            'numero_serie': r.inventario.numero_serie,
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'evidencias': _contar_evidencias(r),
            **_lugar_de(r),
        }

        if not r.entregada_en:
            # Falta entregar. Si ya debía haber salido, urge; si es a futuro, se agenda.
            if r.fecha_inicio <= hoy:
                urgencia = 'hoy'
                etiqueta = 'Entregar hoy' if r.fecha_inicio == hoy else 'Entrega atrasada'
            else:
                urgencia = 'proxima'
                etiqueta = f'Entregar el {r.fecha_inicio:%d/%m}'
            tareas.append({**base, 'tipo': 'entregar', 'urgencia': urgencia, 'etiqueta': etiqueta})
            continue

        # Ya entregada: solo es tarea si toca recogerla pronto. A mitad de renta
        # no hay nada que hacer, así que no ensucia la lista.
        if r.estado != 'activa':
            continue
        d = r.dias_restantes
        if r.vencida:
            atraso = (hoy - r.fecha_fin).days
            tareas.append({**base, 'tipo': 'recoger', 'urgencia': 'vencida',
                           'etiqueta': f'Recoger · venció hace {atraso} día{"s" if atraso != 1 else ""}'})
        elif d == 0:
            tareas.append({**base, 'tipo': 'recoger', 'urgencia': 'hoy', 'etiqueta': 'Recoger hoy'})
        elif d == 1:
            tareas.append({**base, 'tipo': 'recoger', 'urgencia': 'manana', 'etiqueta': 'Recoger mañana'})
        # con más días por delante NO es tarea pendiente

    # Reparaciones abiertas: qué arreglar cuando no hay que salir.
    from inventario.models import OrdenReparacion
    ordenes = (OrdenReparacion.objects
               .filter(estado__in=['recibida', 'proceso'])
               .select_related('unidad', 'unidad__equipo')
               .order_by('fecha_recibida'))
    for o in ordenes:
        dias = (timezone.now().date() - o.fecha_recibida.date()).days
        tareas.append({
            'tipo': 'reparar',
            'orden_id': o.id,
            'folio': o.folio,
            'orden_tipo': o.tipo,
            'estado': o.estado,
            'estado_label': o.get_estado_display(),
            'equipo': (o.unidad.equipo.modelo if o.unidad and o.unidad.equipo else o.equipo_descripcion) or 'Equipo',
            'codigo': o.unidad.codigo if o.unidad else (o.numero_serie or ''),
            'de_quien': 'Máquina propia' if o.tipo == 'interna' else (o.cliente_nombre or 'Cliente'),
            'falla': (o.diagnostico or '').strip()[:180],
            'dias_en_taller': dias,
            'urgencia': 'reparar',
            'etiqueta': 'Entró hoy' if dias == 0 else f'{dias} día{"s" if dias > 1 else ""} en taller',
        })

    def _clave(t):
        # Dentro de la misma urgencia, agrupa por lugar para no repetir el viaje.
        return (PRIORIDAD.get(t['urgencia'], 9), t.get('lugar') or 'zzz', t.get('fecha_fin') or hoy)
    tareas.sort(key=_clave)

    resumen = {
        'total': len(tareas),
        'entregar': sum(1 for t in tareas if t['tipo'] == 'entregar' and t['urgencia'] != 'proxima'),
        'recoger': sum(1 for t in tareas if t['tipo'] == 'recoger'),
        'reparar': sum(1 for t in tareas if t['tipo'] == 'reparar'),
        'vencidas': sum(1 for t in tareas if t['urgencia'] == 'vencida'),
        'proximas': sum(1 for t in tareas if t['urgencia'] == 'proxima'),
    }
    # Entregas PROMETIDAS de hoy (cotizaciones aceptadas con fecha, aún sin
    # convertir): el técnico las ve en su día aunque la venta/renta formal no
    # exista todavía. Sin botones de acción: son un compromiso, no una renta.
    try:
        from cotizaciones.models import Cotizacion as _Cot
        hoy_ini = timezone.make_aware(timezone.datetime.combine(hoy, timezone.datetime.min.time()))
        hoy_fin = hoy_ini + timezone.timedelta(days=1)
        for c in _Cot.objects.filter(estado='aceptada', entrega_prometida__gte=hoy_ini,
                                     entrega_prometida__lt=hoy_fin,
                                     conversiones__isnull=True, rentas_convertidas__isnull=True):
            obra = (c.datos_solicitud or {}).get('obra') or {}
            tareas.append({
                'renta_id': None, 'cotizacion_folio': c.folio,
                'equipo': ', '.join(i.descripcion for i in c.items.all()[:2]) or 'Equipo',
                'codigo': c.folio, 'numero_serie': '',
                'fecha_inicio': hoy, 'fecha_fin': None, 'evidencias': None,
                'lugar': obra.get('direccion') or c.cliente_nombre or '',
                'tipo': 'entrega_prometida', 'urgencia': 'hoy',
                'etiqueta': f"Entrega prometida · {timezone.localtime(c.entrega_prometida):%H:%M}",
            })
    except Exception:
        pass

    return Response({'tareas': tareas, 'resumen': resumen})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def rentas_mias(request):
    """Las rentas ligadas a la cuenta del cliente (para 'Tus rentas')."""
    hoy = timezone.localdate()
    LABEL = {'activa': 'Activa', 'reservada': 'Reservada',
             'finalizada': 'Finalizada', 'cancelada': 'Cancelada'}
    qs = (Renta.objects
          .filter(usuario=request.user)
          .select_related('inventario__equipo')
          .order_by('-creado_en')[:100])
    data = []
    for r in qs:
        eq = getattr(getattr(r.inventario, 'equipo', None), 'modelo', '') if r.inventario_id else ''
        vencida = r.estado == 'activa' and r.fecha_fin and r.fecha_fin < hoy
        data.append({
            'id': r.id,
            'equipo': eq,
            'modalidad': r.modalidad,
            'estado': r.estado,
            'estado_label': 'Vencida' if vencida else LABEL.get(r.estado, r.estado),
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'total': str(r.total),
            'direccion': r.direccion,
        })
    return Response({'rentas': data})
