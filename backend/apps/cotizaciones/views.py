import logging
import uuid
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


class CotizacionPagination(PageNumberPagination):
    """Pagina la lista para que no crezca sin límite con los años."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100

from maquinaria.permissions import (
    IsAdminGroupOrStaff, EsOperador, PuedeCotizar, PuedeVender, PuedeVerDinero,
    puede_de,
)
from maquinaria.throttling import SolicitudPublicaThrottle, SubidaEvidenciaThrottle
from maquinaria.ws_events import push_user_event
from . import precios
from .models import Cotizacion, CotizacionItem, CotizacionFoto
from .serializers import CotizacionSerializer, CotizacionFotoSerializer

logger = logging.getLogger(__name__)

# Tope de fotos por cotización: es apoyo visual para la carta, no un álbum.
MAX_FOTOS = 10

# Unidades de renta válidas que puede mandar la tienda.
_UNIDADES_RENTA = {'dia': 'día', 'semana': 'semana', 'mes': 'mes'}
_MODALIDADES = {'venta'} | set(_UNIDADES_RENTA)



def _enviar_acuse_cliente(cot):
    """Manda al cliente su folio y la cotización en PDF. Devuelve True si se encoló.

    Nunca revienta la petición: si el PDF falla, la solicitud ya quedó guardada
    y el admin puede reenviarla desde el panel.
    """
    if not cot.cliente_email:
        return False
    from maquinaria.correo import enviar_async
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    contacto = cfg.negocio_telefono or cfg.whatsapp_principal or ''
    negocio = cfg.negocio_nombre or 'REMALI'
    cuerpo = (
        f'Hola {cot.cliente_nombre or ""},\n\n'
        f'Recibimos tu solicitud de cotización. Tu folio es {cot.folio}.\n\n'
        f'Adjuntamos la cotización en PDF por si necesitas compartirla.\n'
        f'Total estimado: ${cot.total}'
        f'{" (más IVA al facturar)" if not cot.aplica_iva else ""}.\n'
        f'Válida hasta: {cot.vigencia_hasta.strftime("%d/%m/%Y") if cot.vigencia_hasta else "—"}.\n\n'
        f'En breve te contactamos para confirmar disponibilidad.\n'
        f'{f"Si prefieres, escríbenos al {contacto}." if contacto else ""}\n\n'
        f'— {negocio}\n'
    )
    adjuntos = []
    try:
        from .pdf import render_cotizacion_pdf
        adjuntos.append((f'{cot.folio}.pdf', render_cotizacion_pdf(cot), 'application/pdf'))
    except Exception:
        logger.exception('No se pudo generar el PDF de %s; se manda el correo sin adjunto', cot.folio)
    return enviar_async(f'Tu cotización {cot.folio} · {negocio}', cuerpo, [cot.cliente_email], adjuntos)



@api_view(['POST'])
@permission_classes([AllowAny])  # público: la tienda envía la solicitud del cliente
@throttle_classes([SolicitudPublicaThrottle])  # cada solicitud manda correos: sin techo es spam
def crear_cotizacion_publica(request):
    """Recibe la solicitud que el cliente manda DIRECTO a REMALI, sin su jefe.

    Los precios se calculan en el SERVIDOR (no se confía en los del navegador).
    El camino con autorización interna ya no pasa por aquí: vive en los
    borradores (`views_borrador.py`), que REMALI no ve hasta que se autorizan.
    """
    from maquinaria.models import Equipo, crear_notificacion, nombre_propio

    d = request.data or {}
    items = d.get('items') or []
    if not isinstance(items, list) or not items:
        return Response({'detalle': 'Agrega al menos un equipo a tu solicitud.'}, status=400)
    if len(items) > 50:
        return Response({'detalle': 'Demasiados equipos en una sola solicitud.'}, status=400)

    cliente = d.get('cliente') or {}
    nombre = (cliente.get('nombre') or '').strip()
    if not nombre:
        return Response({'detalle': 'Tu nombre es obligatorio.'}, status=400)

    # Precios del servidor, resueltos en un solo lugar (cotizaciones/precios.py).
    partidas = []
    carrito = []   # snapshot {id,title,price,qty,unit} para "volver a cotizar"
    for it in items:
        equipo_id, cant, dur, unit = precios.normalizar_item(it)
        try:
            eq = Equipo.objects.get(pk=equipo_id)
        except (Equipo.DoesNotExist, ValueError, TypeError):
            continue
        partida = precios.partida_de_equipo(eq, unit)
        partidas.append((partida, cant, dur, eq))
        carrito.append({'id': eq.id, 'title': partida['descripcion'],
                        'price': float(partida['precio_unitario']),
                        'qty': cant, 'duracion': dur, 'unit': unit})

    if not partidas:
        return Response({'detalle': 'No pudimos identificar los equipos de tu solicitud.'}, status=400)

    obra = d.get('obra') or {}
    with transaction.atomic():
        cot = Cotizacion.objects.create(
            tipo='venta',          # provisional: lo define recalcular_tipo() con las partidas
            origen='cliente',
            estado='enviada',
            # Si la mandó con sesión, queda ligada a su cuenta para "Mis cotizaciones".
            usuario=request.user if request.user.is_authenticated else None,
            cliente_nombre=nombre_propio(nombre),
            cliente_telefono=(cliente.get('telefono') or '').strip(),
            cliente_email=(cliente.get('email') or '').strip().lower(),
            aplica_iva=bool(d.get('requiere_factura')),
            datos_solicitud={
                'empresa': (cliente.get('empresa') or '').strip(),
                'obra': {
                    'responsable': (obra.get('responsable') or '').strip(),
                    'direccion': (obra.get('direccion') or '').strip(),
                    'telefono': (obra.get('telefono') or '').strip(),
                    'email': (obra.get('email') or '').strip().lower(),
                },
                'carrito': carrito,
            },
        )
        for partida, cant, dur, eq_ref in partidas:
            CotizacionItem.objects.create(cotizacion=cot, descripcion=partida['descripcion'],
                                          cantidad=cant, duracion=dur,
                                          precio_unitario=partida['precio_unitario'],
                                          precio_lista=partida['precio_lista'],
                                          equipo=eq_ref, modalidad=partida['modalidad'])
        cot.recalcular_tipo()   # venta, renta o mixta según lo que armó el cliente

    tel = cot.cliente_telefono or '—'
    # 1) Notificación en el panel.
    try:
        crear_notificacion(
            'sistema',
            f'Nueva solicitud de cotización · {cot.folio}',
            f'{nombre} ({tel}) solicitó cotización de {len(partidas)} equipo(s) por ${cot.total}.',
            seccion='cotizaciones',
            ref=f'cotizacion-cliente-{cot.id}',
            data={'cotizacion_id': cot.id, 'folio': cot.folio, 'telefono': tel},
        )
    except Exception:
        pass

    # 2) Aviso INMEDIATO por correo a los respaldos (para que contacten al cliente
    #    manualmente si el principal no responde). Simple: sin cron ni temporizador.
    #    Los destinatarios se configuran en el panel y deben estar VERIFICADOS.
    #    Va en un hilo: el cliente no debe esperar al SMTP para ver su folio.
    from maquinaria.correo import enviar_async
    from maquinaria.models import CorreoAviso
    destinatarios = list(CorreoAviso.objects.filter(verificado=True).values_list('email', flat=True))
    if destinatarios:
        cuerpo = (
            f'El cliente {nombre} ({tel}) envió la solicitud de cotización {cot.folio}.\n\n'
            f'— Datos —\n  Teléfono: {tel}\n  Email: {cot.cliente_email or "—"}\n'
            f'  Empresa: {(cot.datos_solicitud or {}).get("empresa") or "—"}\n'
            f'  Equipos: {len(partidas)} · Total estimado: ${cot.total}\n\n'
            f'Escríbele por WhatsApp: https://wa.me/52{tel.replace(" ", "")}\n'
        )
        enviar_async(f'[REMALI] Nueva solicitud {cot.folio}', cuerpo, destinatarios)

    # 3) Acuse al CLIENTE con su cotización en PDF, para que la reenvíe a quien
    #    autoriza. Sin esto manda la solicitud y se queda sin comprobante.
    _enviar_acuse_cliente(cot)

    # Liga pública (PDF con token): el cliente la puede copiar y compartir.
    liga = request.build_absolute_uri(f'/api/cotizaciones/publica/{cot.token_publico}/pdf/') if getattr(cot, 'token_publico', None) else None
    return Response({'detalle': 'Solicitud recibida', 'folio': cot.folio, 'id': cot.id, 'liga': liga}, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def solicitar_cancelacion(request, pk):
    """El CLIENTE dueño CANCELA su cotización — directo, sin aprobación.

    Es una cotización, no un trato cerrado: si él ya no la quiere, no hay
    nada que aprobar. Se cancela al instante, queda su motivo de registro y
    el panel se entera por notificación (y el latido la pinta). Si ya se
    concretó, eso es una venta/renta viva: ahí sí, con REMALI."""
    from django.utils import timezone
    cot = Cotizacion.objects.filter(pk=pk, usuario=request.user).first()
    if not cot:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    if cot.conversiones.exists() or cot.rentas_convertidas.exists():
        return Response({'detalle': 'Esta cotización ya se concretó; contáctanos por WhatsApp para cualquier cambio.'}, status=400)
    if cot.estado in ('rechazada', 'cancelada'):
        return Response({'detalle': 'Esta cotización ya está cerrada.', 'ya': True})
    cot.cancelacion_solicitada = timezone.now()
    cot.cancelacion_motivo = (request.data.get('motivo') or '').strip()[:500]
    cot.estado = 'cancelada'
    cot.save(update_fields=['cancelacion_solicitada', 'cancelacion_motivo', 'estado'])
    try:
        from maquinaria.models import crear_notificacion
        crear_notificacion(
            'sistema',
            f'El cliente CANCELÓ la {cot.folio}',
            f'{cot.cliente_nombre or request.user.get_username()} la canceló'
            + (f': {cot.cancelacion_motivo}' if cot.cancelacion_motivo else '.'),
            seccion='cotizaciones',
            ref=f'cancelacion-{cot.id}',
            data={'cotizacion_id': cot.id, 'folio': cot.folio},
        )
    except Exception:
        pass
    return Response({'detalle': 'Tu cotización quedó cancelada.'})


@api_view(['POST'])
# `ver_dinero`, no `cotizar`: aceptar o rechazar una cotización ya lo exige
# dentro del PATCH de estado, y aprobar la cancelación cierra la cotización
# igual. Con `cotizar` esta ruta era la puerta de atrás para cerrar una sin
# tener las cuentas del negocio.
@permission_classes([PuedeVerDinero])
def aprobar_cancelacion(request, pk):
    """Administración aprueba la cancelación que pidió el cliente: estado final
    'cancelada' + aviso a su campanita. La cotización deja de contar."""
    from django.utils import timezone as _tz
    cot = Cotizacion.objects.filter(pk=pk).first()
    if not cot:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    if not cot.cancelacion_solicitada:
        return Response({'detalle': 'El cliente no ha solicitado cancelarla.'}, status=400)
    if cot.conversiones.exists() or cot.rentas_convertidas.exists():
        return Response({'detalle': 'Ya se concretó en venta/renta; cancela aquella, no la cotización.'}, status=400)
    if cot.estado == 'cancelada':
        return Response({'detalle': 'Ya estaba cancelada.', 'ya': True})
    cot.estado = 'cancelada'
    cot.save(update_fields=['estado'])
    if cot.usuario_id:
        try:
            from maquinaria.models import Notificacion
            Notificacion.objects.create(
                usuario=cot.usuario, tipo='sistema',
                titulo=f'Tu cancelación de la {cot.folio} fue aprobada',
                mensaje='Quedó cancelada sin cargos. Cuando necesites otra cotización, aquí estamos.',
                seccion='cotizaciones', ref=f'cancelacion-ok-{cot.id}',
            )
        except Exception:
            pass
    return Response({'detalle': 'Cancelación aprobada.'})


@api_view(['POST'])
@permission_classes([EsOperador])
def vincular_cuenta_cotizacion(request, pk):
    """Vincula (o cambia/quita) la cuenta de cliente de una cotización.

    Para las capturadas en el panel: al vincularla, el cliente la ve en su
    "Mis cotizaciones" (su latido la trae en segundos) y ÉL decide aceptarla;
    de ahí sigue el flujo normal hacia venta o renta."""
    cot = Cotizacion.objects.filter(pk=pk).first()
    if not cot:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    uid = request.data.get('usuario_id')
    if uid and not cot.items.exists():
        return Response({'detalle': 'La cotización está vacía: agrega partidas antes de vincularla.'}, status=400)
    if uid and not cot.folio:
        return Response({'detalle': 'Márcala como enviada primero: el folio nace ahí.'}, status=400)
    if not uid:
        cot.usuario = None
        cot.save(update_fields=['usuario'])
        return Response({'cuenta': None})
    from django.contrib.auth import get_user_model
    u = get_user_model().objects.filter(pk=uid, is_active=True, groups__name='Cliente').first()
    if not u:
        return Response({'detalle': 'Cuenta de cliente no encontrada'}, status=404)
    cot.usuario = u
    campos = ['usuario']
    # Si la captura no traía correo/nombre, hereda los de la cuenta: así el
    # PDF y los avisos le llegan a él sin recapturar nada.
    if not (cot.cliente_email or '').strip():
        cot.cliente_email = (u.email or '').strip().lower()
        campos.append('cliente_email')
    if not (cot.cliente_nombre or '').strip():
        cot.cliente_nombre = (f'{u.first_name} {u.last_name}'.strip() or u.username)
        campos.append('cliente_nombre')
    cot.save(update_fields=campos)
    return Response({'cuenta': f'{u.first_name} {u.last_name}'.strip() or u.username})





@api_view(['POST'])
@permission_classes([EsOperador])
def generar_vinculo_cotizacion(request, pk):
    """Liga de un solo uso para que el cliente ligue esta cotización a su cuenta."""
    import secrets
    from datetime import timedelta
    from django.utils import timezone
    cot = Cotizacion.objects.filter(pk=pk).first()
    if not cot:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    if cot.usuario_id:
        return Response({'detalle': 'Ya está vinculada a una cuenta.'}, status=400)
    if not cot.items.exists():
        # Vincular una cotización EN BLANCO no significa nada: primero el pedido.
        return Response({'detalle': 'La cotización está vacía: agrega partidas antes de vincularla.'}, status=400)
    if not cot.folio:
        # Sin folio sigue siendo borrador de trabajo: el cliente no debe verla.
        return Response({'detalle': 'Márcala como enviada primero: el folio nace ahí y es lo que el cliente verá.'}, status=400)
    cot.token_vinculo = secrets.token_hex(16)
    cot.token_vinculo_expira = timezone.now() + timedelta(days=30)
    cot.save(update_fields=['token_vinculo', 'token_vinculo_expira'])
    # Ruta relativa: el frontend le antepone su origen (dev, túnel o remali.mx).
    return Response({
        'token': cot.token_vinculo,
        'ruta': f'/vincular/cotizacion/{cot.token_vinculo}',
        'expira': cot.token_vinculo_expira,
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def vinculo_cotizacion(request, token):
    """GET previsualiza la cotización de la liga; POST la liga a la cuenta (un solo uso)."""
    from django.utils import timezone
    cot = Cotizacion.objects.prefetch_related('items').filter(token_vinculo=token).first()
    if not cot:
        return Response({'detalle': 'Enlace no válido o ya utilizado.'}, status=404)
    if cot.token_vinculo_expira and cot.token_vinculo_expira < timezone.now():
        return Response({'detalle': 'Este enlace ya caducó. Pide uno nuevo.'}, status=410)

    items = list(cot.items.all()[:3])
    concepto = ', '.join(i.descripcion for i in items) or 'Cotización de maquinaria'

    if request.method == 'GET':
        return Response({
            'tipo': 'cotizacion', 'id': cot.id, 'fecha': cot.creada, 'total': str(cot.total),
            'cliente': cot.cliente_nombre or '', 'concepto': concepto,
            'ya_ligada': bool(cot.usuario_id),
        })

    if cot.usuario_id and cot.usuario_id != request.user.id:
        return Response({'detalle': 'Esta cotización ya está en otra cuenta.'}, status=400)
    cot.usuario = request.user
    campos = ['usuario', 'token_vinculo', 'token_vinculo_expira']
    # Hereda contacto de la cuenta si la captura no lo traía: el PDF y los
    # recordatorios le llegan a él.
    if not (cot.cliente_email or '').strip():
        cot.cliente_email = (request.user.email or '').strip().lower()
        campos.append('cliente_email')
    if not (cot.cliente_nombre or '').strip():
        cot.cliente_nombre = (f'{request.user.first_name} {request.user.last_name}'.strip() or request.user.username)
        campos.append('cliente_nombre')
    cot.token_vinculo = None
    cot.token_vinculo_expira = None
    cot.save(update_fields=campos)
    return Response({'detalle': 'Listo: la cotización quedó en tu cuenta.', 'id': cot.id})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def latido_cotizaciones(request):
    """Sello de versión para tiempo real por sondeo barato.

    Cambia cuando algo de las cotizaciones o rentas del usuario cambió; el
    navegador lo consulta cada pocos segundos y SOLO recarga la lista
    completa si el sello se movió. Latencia de 1-2 s al costo de un par de
    consultas agregadas — sin websockets que mantener en el hosting.
    Con ?todas=1 (operadores) el sello cubre todo el negocio, para que el
    panel vea llegar lo que capturan otros."""
    from django.db.models import Count
    from maquinaria.permissions import nivel_de
    from renta.models import Renta
    todas = bool(request.query_params.get('todas')) and nivel_de(request.user) >= 1
    qc = Cotizacion.objects.all() if todas else Cotizacion.objects.filter(usuario=request.user)
    qr = Renta.objects.all() if todas else Renta.objects.filter(usuario=request.user)
    c = qc.aggregate(n=Count('id'), m=Max('actualizada'))
    r = qr.aggregate(
        n=Count('id'),
        act=Count('id', filter=Q(estado='activa')),
        fin=Count('id', filter=Q(estado='finalizada')),
        can=Count('id', filter=Q(estado='cancelada')),
    )
    v = f"c{c['n']}-{c['m'].isoformat() if c['m'] else 0}-r{r['n']}.{r['act']}.{r['fin']}.{r['can']}"
    if todas:
        from ventas.models import Venta
        v += f"-v{Venta.objects.count()}"
    return Response({'v': v})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def cotizaciones_mias(request):
    """Las cotizaciones que el propio cliente ha solicitado, para su cuenta.

    Solo las ligadas a SU usuario (las que mandó con sesión). El estado se
    traduce a algo entendible para el cliente; el PDF va por el link con token,
    que no necesita login.
    """
    # Etiquetas de cara al cliente: 'enviada' significa "ya la recibimos y la
    # estamos revisando", no un estado interno del panel.
    LABEL = {'borrador': 'En revisión', 'enviada': 'En revisión',
             'aceptada': 'Aceptada', 'rechazada': 'No disponible', 'cancelada': 'Cancelada'}
    hoy = timezone.now().date()
    qs = (Cotizacion.objects
          .filter(usuario=request.user)
          .prefetch_related('items', 'conversiones', 'rentas_convertidas')
          .order_by('-creada')[:100])
    data = []
    for c in qs:
        vencida = c.estado in ('borrador', 'enviada') and c.vence_el and c.vence_el < hoy
        data.append({
            'id': c.id,
            'folio': c.folio,
            'estado': 'vencida' if vencida else c.estado,
            'estado_label': 'Vencida' if vencida else LABEL.get(c.estado, c.estado),
            'cancelacion_solicitada': c.cancelacion_solicitada.isoformat() if c.cancelacion_solicitada else None,
            # Vino firmada por el autorizador del cliente (si fue el caso).
            'autorizada_por': c.autorizada_por or None,
            'tipo': c.tipo,
            'total': str(c.total),
            'aplica_iva': c.aplica_iva,
            'creada': c.creada,
            'vence_el': c.vence_el,
            'items': [{'descripcion': i.descripcion, 'cantidad': i.cantidad} for i in c.items.all()],
            'carrito': (c.datos_solicitud or {}).get('carrito') or [],   # para "volver a cotizar"
            'entrega_prometida': c.entrega_prometida,
            'atendida': bool(c.atendida_en or c.atendida_por_id),
            'convertida': bool(len(c.conversiones.all()) or len(c.rentas_convertidas.all())),
            'venta_id': next((x.id for x in c.conversiones.all()), None),
            'renta_id': next((x.id for x in c.rentas_convertidas.all()), None),
            # Entrega REAL: la marca el técnico (entregada_en), NO la conversión.
            # Sin esto el cliente veía "equipo entregado" apenas se creaba la renta.
            'entregada_en': next((x.entregada_en.isoformat() for x in c.rentas_convertidas.all() if x.entregada_en), None),
            'atendida_por': (
                (c.atendida_por.get_full_name() or c.atendida_por.username)
                if c.atendida_por_id and c.atendida_por else None
            ),
            # Ruta RELATIVA a propósito: este link lo abre la SPA como <a href>,
            # y debe resolverse contra el origen desde el que se ve la app (dev,
            # túnel de pruebas o producción). Con build_absolute_uri + proxy
            # (changeOrigin) salía como http://localhost:8000/... y no cargaba
            # desde fuera de la máquina (p. ej. por un túnel).
            'pdf': f'/api/cotizaciones/publica/{c.token_publico}/pdf/' if c.token_publico else None,
        })
    return Response({'cotizaciones': data})


class CotizacionListCreate(generics.ListCreateAPIView):
    serializer_class = CotizacionSerializer
    # El asesor arma y lista cotizaciones. Convertir a venta, borrar y autorizar
    # siguen pidiendo administración (ver más abajo).
    permission_classes = [PuedeCotizar]
    pagination_class = CotizacionPagination

    def get_queryset(self):
        qs = Cotizacion.objects.all().select_related('cliente', 'usuario', 'atendida_por', 'cupon').prefetch_related('items', 'fotos', 'conversiones')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado == 'vencida':
            qs = qs.filter(estado__in=['borrador', 'enviada'], vence_el__lt=timezone.now().date())
        elif estado in ('borrador', 'enviada', 'aceptada', 'rechazada'):
            qs = qs.filter(estado=estado)
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(folio__icontains=q) | Q(cliente_nombre__icontains=q) | Q(cliente__nombre__icontains=q))
        # Filtro por periodo (año/mes/rango) sobre la fecha de alta.
        from server.periodos import rango_periodo
        ini, fin = rango_periodo(p)
        if ini:
            qs = qs.filter(creada__gte=ini)
        if fin:
            qs = qs.filter(creada__lt=fin)
        return qs


class CotizacionDetail(generics.RetrieveUpdateDestroyAPIView):
    def perform_update(self, serializer):
        # Estado anterior para detectar si "la contestaron" (aviso al cliente).
        estado_antes = serializer.instance.estado
        # Quien la trabaja desde el panel queda como su asesor asignado.
        obj = serializer.save()
        if not obj.atendida_por_id and self.request.user.is_authenticated:
            from django.utils import timezone as tz
            obj.atendida_por = self.request.user
            obj.atendida_en = tz.now()
            obj.save(update_fields=['atendida_por', 'atendida_en'])
        # Notificación PERSONAL al cliente cuando su cotización es contestada.
        if obj.usuario_id and obj.estado != estado_antes and obj.estado in ('aceptada', 'rechazada'):
            from maquinaria.models import crear_notificacion
            etiqueta = 'aceptada' if obj.estado == 'aceptada' else 'marcada como no disponible'
            crear_notificacion(
                'sistema',
                f'Tu cotización {obj.folio} fue {etiqueta}',
                'Entra a "Mis cotizaciones" para ver el detalle.',
                ref=f'cot-cliente-{obj.id}-{obj.estado}',
                data={'folio': obj.folio, 'cotizacion_id': obj.id},
                usuario=obj.usuario,
            )

    serializer_class = CotizacionSerializer
    queryset = Cotizacion.objects.all().select_related('cliente', 'usuario', 'atendida_por', 'cupon').prefetch_related('items', 'fotos', 'conversiones')

    def get_permissions(self):
        # Ver y trabajar la cotización: cualquiera que cotice (el asesor incluido).
        # Borrarla es de administración: el asesor propone, no destruye.
        if self.request.method == 'DELETE':
            return [IsAdminGroupOrStaff()]
        return [PuedeCotizar()]

    def update(self, request, *args, **kwargs):
        # Una vez convertida en venta, la cotización queda de solo lectura: es el
        # comprobante de esa venta y editarla la desincronizaría.
        # Excepción: la logística sigue viva. Cambiar SOLO la entrega prometida
        # no toca montos ni partidas, así que se permite aun convertida.
        solo_logistica = set(request.data.keys()) <= {'entrega_prometida'}
        cot = self.get_object()
        if not solo_logistica:
            bloqueo = _bloqueada_si_convertida(cot)
            if bloqueo:
                return bloqueo
        # Máquina de estados: no se regresa a etapas que ya pasaron.
        nuevo_estado = request.data.get('estado')
        if nuevo_estado and nuevo_estado != cot.estado:
            # Aceptar o rechazar ES autorizar: es la decisión del negocio. El
            # asesor propone y la manda a autorizar; quien acepta o rechaza ve las
            # cuentas (administración, o el jefe desde su liga).
            if nuevo_estado in ('aceptada', 'rechazada') and not puede_de(request.user).get('ver_dinero'):
                return Response({'detalle': 'Solo administración autoriza (acepta o rechaza). Tú puedes mandarla a autorizar.'}, status=403)
            if cot.estado == 'cancelada':
                return Response({'detalle': 'Está cancelada: es un estado final.'}, status=400)
            if nuevo_estado == 'cancelada' and not cot.cancelacion_solicitada:
                return Response({'detalle': 'Cancelada solo aplica cuando el cliente la solicitó (usa Aprobar cancelación).'}, status=400)
            if cot.autorizada_por and nuevo_estado in ('borrador', 'enviada'):
                return Response({'detalle': f'Vino autorizada por {cot.autorizada_por}: solo puede estar Aceptada, Rechazada o Cancelada.'}, status=400)
            if cot.estado != 'borrador' and nuevo_estado == 'borrador':
                return Response({'detalle': 'Ya tiene folio y el cliente la conoce: no puede regresar a borrador.'}, status=400)
            # La vigencia protege los PRECIOS: aceptar una vencida solo con
            # confirmación explícita de que se respetan (queda a decisión
            # humana, no pasa de largo).
            if nuevo_estado == 'aceptada' and cot.vence_el and cot.vence_el < timezone.now().date() \
                    and not request.data.get('confirmar_vencida'):
                return Response({
                    'detalle': f'Esta cotización venció el {cot.vence_el.strftime("%d/%m/%Y")}: sus precios ya no están garantizados.',
                    'codigo': 'vencida',
                }, status=400)
        # Identidad del cliente en solicitudes de la tienda: la puso ÉL, igual
        # que sus partidas. Se corrige desde su cuenta, no desde el panel.
        if cot.origen == 'cliente':
            tocados = [k for k in ('cliente_nombre', 'cliente_telefono', 'cliente_email')
                       if k in request.data and (request.data.get(k) or '').strip() != (getattr(cot, k) or '')]
            if tocados:
                return Response({'detalle': 'El nombre, teléfono y correo los puso el cliente en su solicitud: no se editan desde el panel.'}, status=400)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        cot = self.get_object()
        bloqueo = _bloqueada_si_convertida(cot)
        if bloqueo:
            # Borrarla dejaría a la venta o a la renta sin el detalle de sus
            # partidas, que es el único comprobante de qué se acordó.
            return bloqueo
        return super().destroy(request, *args, **kwargs)


@api_view(['GET'])
@permission_classes([PuedeCotizar])
def cotizacion_stats(request):
    """Conteos para los KPIs y las pestañas, calculados en la BD (no en el cliente).

    Con la lista paginada, el navegador ya no tiene todas las filas para contar;
    esto las cuenta de una sola pasada.

    El candado es `cotizar` y nada más: son los KPIs y las pestañas de ESTA
    sección, y quien la trabaja los necesita. Lo que sí es de las cuentas del
    negocio es `monto_aceptado` —suma TODAS las aceptadas del periodo—, así que
    ese campo se filtra por `ver_dinero`. Se OMITE, no se manda en cero: un cero
    es un dato, y el panel lo pintaría como "$0.00 aceptado", que es falso. Pedir
    las dos capacidades para ENTRAR dejaba al Gestor —que cotiza y no ve
    dinero— sin pestañas y con el banner rojo de fallo.
    """
    from django.db.models import Count
    from server.periodos import rango_periodo
    hoy = timezone.now().date()
    base = Cotizacion.objects.all()
    # Mismos KPIs que la lista: si viene un periodo, los conteos lo respetan.
    ini, fin = rango_periodo(request.query_params)
    if ini:
        base = base.filter(creada__gte=ini)
    if fin:
        base = base.filter(creada__lt=fin)
    por_estado = dict(base.values_list('estado').annotate(n=Count('id')))
    vencidas = base.filter(estado__in=['borrador', 'enviada'], vence_el__lt=hoy).count()
    abiertas = max(0, por_estado.get('borrador', 0) + por_estado.get('enviada', 0) - vencidas)
    datos = {
        'total': base.count(),
        'borrador': por_estado.get('borrador', 0),
        'enviada': por_estado.get('enviada', 0),
        'aceptada': por_estado.get('aceptada', 0),
        'rechazada': por_estado.get('rechazada', 0),
        'vencida': vencidas,
        'abiertas': abiertas,
    }
    if puede_de(request.user).get('ver_dinero'):
        # `total` es propiedad (suma de partidas), no columna: se itera solo el
        # subconjunto de aceptadas (con prefetch), que es una fracción del total.
        # Y solo se calcula para quien lo puede ver: sin `ver_dinero` ni se suma.
        monto = sum((c.total for c in base.filter(estado='aceptada').prefetch_related('items')),
                    Decimal('0.00'))
        datos['monto_aceptado'] = str(monto)
    return Response(datos)


def _bloqueada_si_convertida(cot):
    """Una cotización ya concretada queda de solo lectura en sus partidas.

    Vale igual para la venta y para la RENTA. Antes solo miraba las ventas, así
    que a una cotización de renta ya concretada se le podía cambiar el equipo o
    la cantidad con la máquina ya en la obra: el papel dejaba de describir lo
    que el cliente tiene enfrente.
    """
    venta = cot.conversiones.first()
    if venta:
        return Response(
            {'detalle': f'La cotización ya se convirtió en la venta #{venta.id}; sus partidas están bloqueadas.',
             'codigo': 'ya_convertida'},
            status=status.HTTP_409_CONFLICT,
        )
    renta = cot.rentas_convertidas.exclude(estado='cancelada').first()
    if renta:
        return Response(
            {'detalle': f'La cotización ya se concretó en la renta #{renta.id}; sus partidas están bloqueadas.',
             'codigo': 'ya_concretada'},
            status=status.HTTP_409_CONFLICT,
        )
    return None


@api_view(['POST'])
@permission_classes([PuedeCotizar])
def cotizacion_agregar_item(request, pk: int):
    try:
        cot = Cotizacion.objects.get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    bloqueo = _bloqueada_si_convertida(cot)
    if bloqueo:
        return bloqueo
    if cot.origen == 'cliente':
        # El pedido lo armó EL CLIENTE: sus conceptos no se tocan desde el
        # panel. El admin solo edita partidas de sus propias capturas.
        return Response({'detalle': 'Los conceptos los armó el cliente: no se modifican desde el panel.'}, status=400)
    d = request.data or {}
    try:
        cant = max(1, int(d.get('cantidad') or 1))
    except (ValueError, TypeError):
        cant = 1
    # Si no la mandan, se hereda del tipo de la cotización (una de renta sin
    # unidad se cotiza por día, que es la más común).
    modalidad = (d.get('modalidad') or '').lower()
    if modalidad not in _MODALIDADES:
        modalidad = 'dia' if cot.tipo == 'renta' else 'venta'
    # Duración = periodos (solo renta); en venta es 1.
    try:
        dur = max(1, int(d.get('duracion') or 1)) if modalidad in _UNIDADES_RENTA else 1
    except (ValueError, TypeError):
        dur = 1

    # Partida DEL CATÁLOGO: el precio lo resuelve el servidor (el de la web,
    # con su promo), igual que en la tienda. El admin puede ajustarlo después,
    # pero la desviación contra lista queda a la vista.
    equipo_id = d.get('equipo_id')
    if equipo_id:
        from maquinaria.models import Equipo
        try:
            eq = Equipo.objects.get(pk=equipo_id)
        except (Equipo.DoesNotExist, ValueError, TypeError):
            return Response({'detalle': 'Equipo no encontrado'}, status=404)
        etiqueta, precio, modalidad = precios.resolver_partida(eq, modalidad if modalidad in _UNIDADES_RENTA else '')
        precio = Decimal(str(precio or 0))
        lista = precio
        promo = min(90, max(0, getattr(eq, 'promo_pct', 0) or 0))
        if precio and promo:
            precio = (precio * (Decimal('100') - promo) / Decimal('100')).quantize(Decimal('0.01'))
            etiqueta = f'{etiqueta} (promo −{promo}%)'
        with transaction.atomic():
            CotizacionItem.objects.create(cotizacion=cot, descripcion=etiqueta, cantidad=cant,
                                          duracion=dur, precio_unitario=precio, precio_lista=lista,
                                          equipo=eq, modalidad=modalidad)
            cot.recalcular_tipo()
        cot.refresh_from_db()
        return Response(CotizacionSerializer(cot).data, status=201)

    # Partida LIBRE (flete, operador, un servicio): concepto y precio a mano,
    # sin referencia de lista.
    desc = (d.get('descripcion') or '').strip()
    if not desc:
        return Response({'detalle': 'La descripción es requerida'}, status=400)
    try:
        precio = Decimal(str(d.get('precio_unitario') or 0))
    except Exception:
        precio = Decimal('0')
    with transaction.atomic():
        CotizacionItem.objects.create(cotizacion=cot, descripcion=desc, cantidad=cant,
                                      duracion=dur, precio_unitario=precio, modalidad=modalidad)
        cot.recalcular_tipo()
    cot.refresh_from_db()
    return Response(CotizacionSerializer(cot).data, status=201)


@api_view(['PATCH'])
@permission_classes([PuedeCotizar])
def cotizacion_item_modalidad(request, pk: int, item_id: int):
    """Corrige si una partida es de venta o de renta (y con qué unidad)."""
    try:
        item = CotizacionItem.objects.select_related('cotizacion').get(pk=item_id, cotizacion_id=pk)
    except CotizacionItem.DoesNotExist:
        return Response({'detalle': 'Partida no encontrada'}, status=404)
    if item.cotizacion.origen == 'cliente':
        return Response({'detalle': 'Los conceptos los armó el cliente: no se modifican desde el panel.'}, status=400)
    bloqueo = _bloqueada_si_convertida(item.cotizacion)
    if bloqueo:
        return bloqueo
    modalidad = (request.data or {}).get('modalidad', '')
    if modalidad not in _MODALIDADES:
        return Response({'detalle': 'Modalidad inválida. Usa venta, dia, semana o mes.'}, status=400)
    with transaction.atomic():
        item.modalidad = modalidad
        campos = ['modalidad']
        if modalidad == 'venta' and item.duracion != 1:
            item.duracion = 1; campos.append('duracion')
        # Partida de catálogo: al cambiar la modalidad, el precio de la web de
        # ESA modalidad vuelve a mandar (con su promo). Si el equipo no tiene
        # precio para ella, se conserva el capturado y se suelta la referencia.
        if item.equipo_id:
            eq = item.equipo
            precio = eq.precio_venta if modalidad == 'venta' else eq.get_precio_por_unidad(modalidad)
            if precio:
                lista = Decimal(str(precio))
                promo = min(90, max(0, getattr(eq, 'promo_pct', 0) or 0))
                final = (lista * (Decimal('100') - promo) / Decimal('100')).quantize(Decimal('0.01')) if promo else lista
                sufijo = 'venta' if modalidad == 'venta' else f'renta por {CotizacionItem.UNIDADES_RENTA[modalidad]}'
                item.precio_unitario = final
                item.precio_lista = lista
                item.descripcion = f'{eq.modelo} · {sufijo}' + (f' (promo −{promo}%)' if promo else '')
                campos += ['precio_unitario', 'precio_lista', 'descripcion']
            else:
                item.precio_lista = Decimal('0')
                campos += ['precio_lista']
        item.save(update_fields=campos)
        item.cotizacion.recalcular_tipo()
    return Response(CotizacionSerializer(Cotizacion.objects.get(pk=pk)).data)


@api_view(['POST'])
@permission_classes([PuedeVender])   # convertir es VENDER, no cotizar
def convertir_cotizacion(request, pk: int):
    """Convierte una cotización aceptada en una VENTA (arrastra cliente + partidas + IVA)."""
    from ventas.models import Venta
    try:
        cot = Cotizacion.objects.prefetch_related('items').get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    # Solo se convierte lo que el cliente YA aceptó: si no está 'aceptada', no
    # se vende. (Una cotización ya convertida quedó en 'aceptada', así que el
    # reintento idempotente de más abajo sigue funcionando.)
    if cot.estado != 'aceptada':
        return Response(
            {'detalle': 'Solo se puede convertir a venta una cotización Aceptada. '
                        'Márcala como “Aceptada” primero.'},
            status=400,
        )
    # Se convierten SOLO las partidas de venta. Las de renta se concretan
    # creando la renta (eligiendo unidad y fechas), así que una cotización mixta
    # genera la venta y deja sus partidas de renta pendientes.
    from decimal import Decimal, InvalidOperation
    from ventas.models import Venta as _V
    metodo = (request.data.get('metodo_pago') or 'efectivo').strip().lower()
    if metodo not in dict(_V.METODO_PAGO):
        metodo = 'efectivo'
    # Pago combinado opcional: [{'metodo', 'monto'}]; debe cuadrar con el total.
    pagos = []
    for p in (request.data.get('pagos') or []):
        m = (p.get('metodo') or '').strip().lower()
        try:
            monto = Decimal(str(p.get('monto') or '0'))
        except InvalidOperation:
            return Response({'detalle': 'Monto de pago no válido.'}, status=400)
        if m not in dict(_V.METODO_PAGO) or monto <= 0:
            return Response({'detalle': 'Pago combinado no válido (método o monto).'}, status=400)
        pagos.append({'metodo': m, 'monto': str(monto.quantize(Decimal('0.01')))})
    if pagos:
        suma = sum(Decimal(p['monto']) for p in pagos)
        if abs(suma - cot.total) > Decimal('0.01'):
            return Response({'detalle': f'Los pagos suman {suma} y el total es {cot.total}.'}, status=400)
        metodo = max(pagos, key=lambda p: Decimal(p['monto']))['metodo']
    partidas_venta = [i for i in cot.items.all() if i.modalidad == 'venta']
    if not partidas_venta:
        return Response(
            {'detalle': 'Esta cotización no tiene partidas de venta. '
                        'Las de renta se concretan creando la renta (eligiendo unidad y fechas).'},
            status=400,
        )
    # Unidades físicas que se entregan (número de identificación): se marcan
    # vendidas en el mismo acto, así el inventario y el catálogo público
    # (que se calculan de las unidades) quedan cuadrados sin pasos manuales.
    # Si la cotización nació de equipo(s) concretos, las unidades elegidas deben
    # corresponder a ese mismo equipo y no exceder lo que el cliente pidió.
    from inventario.models import Inventario as _Inv
    unidades = []
    requeridas_por_equipo = {}
    precio_por_equipo = {}
    for item in partidas_venta:
        if item.equipo_id:
            requeridas_por_equipo[item.equipo_id] = requeridas_por_equipo.get(item.equipo_id, 0) + max(item.cantidad or 0, 0)
            # Precio de CADA máquina de ese equipo (IVA incluido, como toda venta).
            # Sale de la partida, no de dividir el total: sin divisiones no hay
            # centavos perdidos.
            precio_por_equipo[item.equipo_id] = item.precio_unitario
    elegidas_por_equipo = {}
    unidades_vistas = set()
    for uid in (request.data.get('unidad_ids') or []):
        try:
            u = _Inv.objects.get(id=int(uid))
        except (ValueError, _Inv.DoesNotExist):
            return Response({'detalle': f'Unidad {uid} no existe.'}, status=400)
        if u.id in unidades_vistas:
            return Response({'detalle': f'La unidad {u.codigo} viene repetida.'}, status=400)
        unidades_vistas.add(u.id)
        if u.estado != 'disponible':
            return Response({'detalle': f'La unidad {u.codigo} no está disponible (está {u.estado}).'}, status=400)
        if requeridas_por_equipo:
            if u.equipo_id not in requeridas_por_equipo:
                return Response({
                    'detalle': f'La unidad {u.codigo} no coincide con el equipo cotizado por el cliente.'
                }, status=400)
            elegidas_por_equipo[u.equipo_id] = elegidas_por_equipo.get(u.equipo_id, 0) + 1
            if elegidas_por_equipo[u.equipo_id] > requeridas_por_equipo[u.equipo_id]:
                return Response({
                    'detalle': f'Estás asignando más unidades de {u.equipo.modelo if u.equipo_id and u.equipo else "ese equipo"} de las que pidió el cliente.'
                }, status=400)
        unidades.append(u)

    existente = cot.conversiones.first()
    if existente:
        return Response({'detalle': 'Esta cotización ya se convirtió.', 'venta_id': existente.id, 'cotizacion': CotizacionSerializer(cot).data}, status=200)

    with transaction.atomic():
        # Con el candado puesto y releyendo el estado: hasta aquí la revisión de
        # arriba fue optimista (sin bloqueo), y dos conversiones simultáneas
        # podían llevarse la misma máquina.
        if unidades:
            bloqueadas = {
                u.id: u for u in _Inv.objects.select_for_update()
                .select_related('equipo').filter(id__in=[x.id for x in unidades])
            }
            unidades = [bloqueadas[x.id] for x in unidades if x.id in bloqueadas]
            for u in unidades:
                if u.estado != 'disponible':
                    return Response(
                        {'detalle': f'La unidad {u.codigo} ya no está disponible (está {u.estado}).'},
                        status=400,
                    )

        venta = Venta.objects.create(
            usuario=request.user if request.user.is_authenticated else None,
            # Cuenta del COMPRADOR: si la cotización la pidió un cliente con
            # sesión, la venta queda ligada a su perfil y aparece en "Mis
            # compras" (igual que la renta liga su cuenta al concretarse).
            cliente_usuario=cot.usuario,
            nombre_cliente=(cot.cliente_nombre or (cot.cliente.nombre if cot.cliente_id and cot.cliente else '')),
            telefono_cliente=cot.cliente_telefono,
            cliente_id=cot.cliente_id,
            # Sin unidades (o con ellas), el importe de la cotización es el que
            # manda: los renglones de abajo reparten ese mismo dinero por máquina.
            precio_maquina=(Decimal('0.00') if unidades else cot.subtotal_venta),
            metodo_pago=metodo,
            pagos=pagos,
            cotizacion=cot,                    # IVA: lo fuerza el modelo Venta (toda venta con IVA)
        )
        # UN RENGLÓN POR MÁQUINA: cada unidad queda amarrada a esta venta, con su
        # precio y su número de serie. Antes solo la primera se guardaba y las
        # demás salían del patio sin venta que las respaldara; cancelar no las
        # devolvía nunca.
        from ventas.models import VentaMaquina
        restante = Decimal(cot.subtotal_venta)
        for i, u in enumerate(unidades):
            precio = precio_por_equipo.get(u.equipo_id)
            if precio is None or i == len(unidades) - 1:
                # La última se lleva lo que quede: así la suma de los renglones
                # cuadra al centavo con el total de la cotización.
                precio = restante
            precio = Decimal(precio)
            restante -= precio
            try:
                VentaMaquina.objects.create(venta=venta, inventario=u, precio=precio)
            except ValueError as e:
                return Response({'detalle': str(e)}, status=400)

    cot.refresh_from_db()
    pendientes = len(cot.items.all()) - len(partidas_venta)
    detalle = 'Cotización convertida a venta'
    if pendientes:
        detalle += f' · quedan {pendientes} partida(s) de renta por concretar'
    return Response({'detalle': detalle, 'venta_id': venta.id, 'partidas_renta_pendientes': pendientes,
                     'cotizacion': CotizacionSerializer(cot).data}, status=201)


@api_view(['POST'])
@permission_classes([PuedeCotizar])
def atender_cotizacion(request, pk: int):
    """Un asesor toma la solicitud del cliente → detiene el escalamiento."""
    try:
        cot = Cotizacion.objects.select_related('atendida_por').get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    if cot.atendida_por_id and cot.atendida_por_id != getattr(request.user, 'id', None):
        return Response({'detalle': f'Ya la está atendiendo {cot.atendida_por.get_username()}.',
                         'cotizacion': CotizacionSerializer(cot).data}, status=200)
    cot.atendida_por = request.user
    cot.atendida_en = timezone.now()
    cot.save(update_fields=['atendida_por', 'atendida_en', 'actualizada'])
    if cot.usuario_id:
        push_user_event(cot.usuario_id, {
            'topic': 'cotizaciones',
            'action': 'atendida_por_asignado',
            'source': 'cotizacion_admin',
            'cotizacion_id': cot.id,
            'folio': cot.folio,
        })
    return Response({'detalle': 'La estás atendiendo', 'cotizacion': CotizacionSerializer(cot).data})



@api_view(['PATCH', 'DELETE'])
@permission_classes([PuedeCotizar])
def cotizacion_item(request, pk: int, item_id: int):
    """Edita (PATCH: descripción/cantidad/precio) o elimina (DELETE) una partida.

    La edición en línea manda solo el campo que cambió; se aplica lo que venga.
    """
    try:
        item = CotizacionItem.objects.select_related('cotizacion').get(pk=item_id, cotizacion_id=pk)
    except CotizacionItem.DoesNotExist:
        return Response({'detalle': 'Partida no encontrada'}, status=404)
    if item.cotizacion.origen == 'cliente':
        return Response({'detalle': 'Los conceptos los armó el cliente: no se modifican desde el panel.'}, status=400)
    bloqueo = _bloqueada_si_convertida(item.cotizacion)
    if bloqueo:
        return bloqueo

    if request.method == 'DELETE':
        with transaction.atomic():
            item.delete()
            Cotizacion.objects.get(pk=pk).recalcular_tipo()
        return Response(CotizacionSerializer(Cotizacion.objects.get(pk=pk)).data)

    d = request.data or {}
    if 'descripcion' in d:
        desc = (d.get('descripcion') or '').strip()
        if not desc:
            return Response({'detalle': 'La descripción no puede quedar vacía'}, status=400)
        item.descripcion = desc[:255]
    if 'cantidad' in d:
        try:
            item.cantidad = max(1, int(d.get('cantidad') or 1))
        except (ValueError, TypeError):
            return Response({'detalle': 'Cantidad inválida'}, status=400)
    if 'duracion' in d:
        try:
            item.duracion = max(1, int(d.get('duracion') or 1)) if item.modalidad in ('dia', 'semana', 'mes') else 1
        except (ValueError, TypeError):
            return Response({'detalle': 'Duración inválida'}, status=400)
    if 'precio_unitario' in d:
        try:
            item.precio_unitario = Decimal(str(d.get('precio_unitario') or 0))
        except Exception:
            return Response({'detalle': 'Precio inválido'}, status=400)
    with transaction.atomic():
        item.save()
        item.cotizacion.recalcular_tipo()
    return Response(CotizacionSerializer(Cotizacion.objects.get(pk=pk)).data)


def _nombre_foto(cot_id: int, formato: str) -> str:
    """Nombre generado por nosotros: el del cliente puede traer rutas o repetirse."""
    from renta.evidencia import EXTENSION
    marca = timezone.now().strftime('%Y%m%d-%H%M%S')
    return f'cot{cot_id}-{marca}-{uuid.uuid4().hex[:8]}.{EXTENSION[formato]}'


@api_view(['GET', 'POST'])
@permission_classes([PuedeCotizar])
@throttle_classes([SubidaEvidenciaThrottle])
def cotizacion_fotos(request, pk: int):
    """GET: fotos de la cotización. POST: sube una o varias.

    La validación de que sea una imagen real (Pillow, tamaño, formato) es la
    misma que la de la evidencia de rentas: se reutiliza para no tener dos
    verificaciones de seguridad que puedan desincronizarse.
    """
    try:
        cot = Cotizacion.objects.get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)

    if request.method == 'GET':
        return Response({'fotos': CotizacionFotoSerializer(
            cot.fotos.all(), many=True, context={'request': request}).data})

    bloqueo = _bloqueada_si_convertida(cot)   # convertida en venta → sin cambios
    if bloqueo:
        return bloqueo

    archivos = request.FILES.getlist('imagenes') or request.FILES.getlist('images') or []
    if not archivos:
        return Response({'detalle': 'Adjunta al menos una foto.'}, status=400)

    ya_hay = cot.fotos.count()
    if ya_hay + len(archivos) > MAX_FOTOS:
        return Response(
            {'detalle': f'Máximo {MAX_FOTOS} fotos por cotización; ya hay {ya_hay}.'},
            status=400,
        )

    from renta import evidencia as ev
    # Se validan TODAS antes de guardar ninguna: dejar la mitad subida sería peor.
    validados = []
    for f in archivos:
        try:
            validados.append((f, ev.validar_imagen(f)))
        except ev.EvidenciaInvalida as e:
            return Response({'detalle': str(e)}, status=400)

    base = cot.fotos.aggregate(m=Max('orden'))['m'] or 0
    creadas = []
    with transaction.atomic():
        for i, (f, formato) in enumerate(validados, start=1):
            f.name = _nombre_foto(cot.id, formato)   # no confiamos en el nombre del cliente
            creadas.append(CotizacionFoto.objects.create(cotizacion=cot, imagen=f, orden=base + i))
    return Response(
        {'fotos': CotizacionFotoSerializer(creadas, many=True, context={'request': request}).data},
        status=201,
    )


@api_view(['GET'])
@permission_classes([PuedeCotizar])
def cotizacion_pdf(request, pk: int):
    """Descarga la cotización en PDF.

    Es el MISMO documento que se adjunta al correo del cliente (mismo generador
    de reportlab, con las fotos embebidas): no una recreación del HTML, para que
    lo que descarga el admin y lo que recibe el cliente sean idénticos.
    """
    from django.http import HttpResponse
    try:
        cot = Cotizacion.objects.prefetch_related('items', 'fotos').get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    from .pdf import render_cotizacion_pdf
    resp = HttpResponse(render_cotizacion_pdf(cot), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="{cot.folio or "cotizacion"}.pdf"'
    return resp


@api_view(['GET'])
@permission_classes([AllowAny])  # link público: el cliente lo abre sin cuenta
def cotizacion_publica_pdf(request, token):
    """Sirve el PDF por su token público (para compartir por WhatsApp/correo).

    El token no es adivinable y solo revela ESA cotización, que es justo la que
    se le está mandando al cliente.
    """
    from django.http import Http404, HttpResponse
    try:
        cot = Cotizacion.objects.prefetch_related('items', 'fotos').get(token_publico=token)
    except Cotizacion.DoesNotExist:
        raise Http404
    from .pdf import render_cotizacion_pdf
    resp = HttpResponse(render_cotizacion_pdf(cot), content_type='application/pdf')
    resp['Content-Disposition'] = f'inline; filename="{cot.folio or "cotizacion"}.pdf"'   # abre en el navegador
    return resp


@api_view(['POST'])
@permission_classes([PuedeCotizar])
def cotizacion_enviar(request, pk: int):
    """Envía la cotización al correo del cliente con el PDF adjunto y el link.

    Enviarla la marca como 'enviada' si estaba en borrador.
    """
    try:
        cot = Cotizacion.objects.prefetch_related('items').get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    correo = (cot.cliente_email or '').strip()
    if not correo:
        return Response({'detalle': 'Agrega el correo del cliente para poder enviarla.'}, status=400)
    if not cot.items.exists():
        return Response({'detalle': 'La cotización no tiene conceptos.'}, status=400)

    import os

    from maquinaria.correo import enviar_async, enviar_plantilla_brevo
    from maquinaria.models import ConfiguracionSitio
    from .pdf import render_cotizacion_pdf
    cfg = ConfiguracionSitio.get_solo()
    negocio = cfg.negocio_nombre or 'REMALI'
    contacto = cfg.negocio_telefono or cfg.whatsapp_principal or ''
    link = request.build_absolute_uri(f'/api/cotizaciones/publica/{cot.token_publico}/pdf/')
    vigencia = cot.vigencia_hasta.strftime('%d/%m/%Y') if cot.vigencia_hasta else '—'
    nota_iva = '' if cot.aplica_iva else ' (más IVA al facturar)'

    adjuntos = []
    try:
        adjuntos.append((f'{cot.folio}.pdf', render_cotizacion_pdf(cot), 'application/pdf'))
    except Exception:
        logger.exception('No se pudo adjuntar el PDF de %s; se manda sin adjunto', cot.folio)

    # Si hay plantilla de Brevo, el diseño lo controla la empresa desde Brevo y el
    # PDF va adjunto igual. Si no, el correo de texto de siempre por SMTP.
    tpl = os.environ.get('BREVO_COT_TEMPLATE_ID', '').strip()
    enviada = enviar_plantilla_brevo(tpl, correo, cot.cliente_nombre, {
        'nombre': cot.cliente_nombre or '',
        'folio': cot.folio,
        'total': f'${cot.total:,.2f}',
        'iva': nota_iva.strip(),
        'vigencia': vigencia,
        'link': link,
        'negocio': negocio,
        'contacto': contacto,
    }, adjuntos)
    if not enviada:
        cuerpo = (
            f'Hola {cot.cliente_nombre or ""},\n\n'
            f'Le compartimos su cotización {cot.folio} por ${cot.total}{nota_iva}.\n'
            f'Válida hasta: {vigencia}.\n\n'
            f'Puede verla o descargarla aquí: {link}\n'
            f'(también va adjunta en PDF).\n\n'
            f'{f"Cualquier duda, escríbanos al {contacto}." if contacto else ""}\n\n'
            f'— {negocio}\n'
        )
        enviar_async(f'Su cotización {cot.folio} · {negocio}', cuerpo, [correo], adjuntos)

    if cot.estado == 'borrador':
        cot.estado = 'enviada'
        cot.save(update_fields=['estado', 'actualizada'])
    cot.refresh_from_db()
    return Response({'detalle': f'Cotización enviada a {correo}',
                     'cotizacion': CotizacionSerializer(cot, context={'request': request}).data})


@api_view(['DELETE'])
@permission_classes([PuedeCotizar])
def cotizacion_foto_eliminar(request, pk: int, foto_id: int):
    try:
        foto = CotizacionFoto.objects.select_related('cotizacion').get(pk=foto_id, cotizacion_id=pk)
    except CotizacionFoto.DoesNotExist:
        return Response({'detalle': 'Foto no encontrada'}, status=404)
    bloqueo = _bloqueada_si_convertida(foto.cotizacion)   # convertida en venta → sin cambios
    if bloqueo:
        return bloqueo
    foto.imagen.delete(save=False)   # no dejar el archivo huérfano en el almacenamiento
    foto.delete()
    return Response(status=204)
