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

from maquinaria.permissions import IsAdminGroupOrStaff
from maquinaria.throttling import SolicitudPublicaThrottle, SubidaEvidenciaThrottle
from .models import Cotizacion, CotizacionItem, CotizacionFoto
from .serializers import CotizacionSerializer, CotizacionFotoSerializer

logger = logging.getLogger(__name__)

# Tope de fotos por cotización: es apoyo visual para la carta, no un álbum.
MAX_FOTOS = 10

# Unidades de renta válidas que puede mandar la tienda.
_UNIDADES_RENTA = {'dia': 'día', 'semana': 'semana', 'mes': 'mes'}
_MODALIDADES = {'venta'} | set(_UNIDADES_RENTA)


def _resolver_partida(eq, unit):
    """Traduce lo que pidió la tienda a (etiqueta, precio, modalidad).

    Si el equipo no tiene precio para esa modalidad se cae a la otra: un equipo
    que solo se vende no debe quedar cotizado en $0 por pedir "renta por día".
    """
    if unit in _UNIDADES_RENTA:
        precio = eq.get_precio_por_unidad(unit)
        if precio:
            return f'{eq.modelo} · renta por {_UNIDADES_RENTA[unit]}', precio, unit
        return f'{eq.modelo} · venta', eq.precio_venta, 'venta'

    if eq.precio_venta:
        return f'{eq.modelo} · venta', eq.precio_venta, 'venta'
    for u in ('dia', 'semana', 'mes'):          # solo se renta: cotiza la renta
        precio = eq.get_precio_por_unidad(u)
        if precio:
            return f'{eq.modelo} · renta por {_UNIDADES_RENTA[u]}', precio, u
    return f'{eq.modelo} · venta', eq.precio_venta, 'venta'


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
    """Recibe la solicitud de cotización que arma el cliente en la tienda.

    Endpoint angosto y validado: se calculan los precios DEL SERVIDOR (no se
    confía en los que manda el navegador). Crea una Cotizacion origen=cliente
    en estado 'enviada' y avisa al admin por notificación.
    """
    from maquinaria.models import Equipo, crear_notificacion

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

    # Resolver equipos y precios en el servidor.
    partidas = []
    carrito = []   # snapshot {id,title,price,qty,unit} para "volver a cotizar"
    for it in items:
        try:
            eq = Equipo.objects.get(pk=it.get('equipo_id') or it.get('id'))
        except (Equipo.DoesNotExist, ValueError, TypeError):
            continue
        try:
            cant = max(1, min(int(it.get('cantidad') or 1), 999))
        except (ValueError, TypeError):
            cant = 1
        unit = (it.get('unit') or '').lower()
        etiqueta, precio, modalidad = _resolver_partida(eq, unit)
        # Promo del equipo (la controla el admin en el panel): el precio oficial
        # de la cotización sale ya con el descuento aplicado.
        promo = min(90, max(0, getattr(eq, 'promo_pct', 0) or 0))
        if precio and promo:
            precio = (Decimal(precio) * (Decimal('100') - promo) / Decimal('100')).quantize(Decimal('0.01'))
            etiqueta = f'{etiqueta} (promo −{promo}%)'
        partidas.append((etiqueta, cant, Decimal(str(precio or 0)), modalidad))
        carrito.append({'id': eq.id, 'title': etiqueta, 'price': float(precio or 0),
                        'qty': cant, 'unit': unit or 'venta'})

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
            cliente_nombre=nombre,
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
        for etiqueta, cant, precio, modalidad in partidas:
            CotizacionItem.objects.create(cotizacion=cot, descripcion=etiqueta, cantidad=cant,
                                          precio_unitario=precio, modalidad=modalidad)
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
             'aceptada': 'Aceptada', 'rechazada': 'No disponible'}
    hoy = timezone.now().date()
    qs = (Cotizacion.objects
          .filter(usuario=request.user)
          .prefetch_related('items', 'conversiones', 'rentas_convertidas')
          .order_by('-creada')[:100])
    data = []
    for c in qs:
        vencida = c.estado in ('borrador', 'enviada') and c.vence_el and c.vence_el < hoy
        data.append({
            'folio': c.folio,
            'estado': 'vencida' if vencida else c.estado,
            'estado_label': 'Vencida' if vencida else LABEL.get(c.estado, c.estado),
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
    permission_classes = [IsAdminGroupOrStaff]
    pagination_class = CotizacionPagination

    def get_queryset(self):
        qs = Cotizacion.objects.all().select_related('empresa').prefetch_related('items', 'fotos', 'conversiones')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado == 'vencida':
            qs = qs.filter(estado__in=['borrador', 'enviada'], vence_el__lt=timezone.now().date())
        elif estado in ('borrador', 'enviada', 'aceptada', 'rechazada'):
            qs = qs.filter(estado=estado)
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(folio__icontains=q) | Q(cliente_nombre__icontains=q) | Q(empresa__nombre__icontains=q))
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
    permission_classes = [IsAdminGroupOrStaff]
    queryset = Cotizacion.objects.all().select_related('empresa').prefetch_related('items', 'fotos', 'conversiones')

    def update(self, request, *args, **kwargs):
        # Una vez convertida en venta, la cotización queda de solo lectura: es el
        # comprobante de esa venta y editarla la desincronizaría.
        # Excepción: la logística sigue viva. Cambiar SOLO la entrega prometida
        # no toca montos ni partidas, así que se permite aun convertida.
        solo_logistica = set(request.data.keys()) <= {'entrega_prometida'}
        if not solo_logistica:
            bloqueo = _bloqueada_si_convertida(self.get_object())
            if bloqueo:
                return bloqueo
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        cot = self.get_object()
        venta = cot.conversiones.first()
        if venta:
            return Response(
                {'detail': f'No se puede eliminar "{cot.folio}": ya se convirtió en la venta #{venta.id}. '
                           'Borrarla dejaría esa venta sin el detalle de sus partidas.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


@api_view(['GET'])
@permission_classes([IsAdminGroupOrStaff])
def cotizacion_stats(request):
    """Conteos para los KPIs y las pestañas, calculados en la BD (no en el cliente).

    Con la lista paginada, el navegador ya no tiene todas las filas para contar;
    esto las cuenta de una sola pasada.
    """
    from django.db.models import Count
    hoy = timezone.now().date()
    base = Cotizacion.objects.all()
    por_estado = dict(base.values_list('estado').annotate(n=Count('id')))
    vencidas = base.filter(estado__in=['borrador', 'enviada'], vence_el__lt=hoy).count()
    abiertas = max(0, por_estado.get('borrador', 0) + por_estado.get('enviada', 0) - vencidas)
    # `total` es propiedad (suma de partidas), no columna: se itera solo el
    # subconjunto de aceptadas (con prefetch), que es una fracción del total.
    monto = sum((c.total for c in base.filter(estado='aceptada').prefetch_related('items')), Decimal('0.00'))
    return Response({
        'total': base.count(),
        'borrador': por_estado.get('borrador', 0),
        'enviada': por_estado.get('enviada', 0),
        'aceptada': por_estado.get('aceptada', 0),
        'rechazada': por_estado.get('rechazada', 0),
        'vencida': vencidas,
        'abiertas': abiertas,
        'monto_aceptado': str(monto),
    })


def _bloqueada_si_convertida(cot):
    """Una cotización ya convertida en venta queda de solo lectura en sus
    partidas: editarlas desincronizaría el total y el comprobante de la venta."""
    venta = cot.conversiones.first()
    if venta:
        return Response(
            {'detalle': f'La cotización ya se convirtió en la venta #{venta.id}; sus partidas están bloqueadas.'},
            status=status.HTTP_409_CONFLICT,
        )
    return None


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def cotizacion_agregar_item(request, pk: int):
    try:
        cot = Cotizacion.objects.get(pk=pk)
    except Cotizacion.DoesNotExist:
        return Response({'detalle': 'Cotización no encontrada'}, status=404)
    bloqueo = _bloqueada_si_convertida(cot)
    if bloqueo:
        return bloqueo
    d = request.data or {}
    desc = (d.get('descripcion') or '').strip()
    if not desc:
        return Response({'detalle': 'La descripción es requerida'}, status=400)
    try:
        cant = max(1, int(d.get('cantidad') or 1))
    except (ValueError, TypeError):
        cant = 1
    try:
        precio = Decimal(str(d.get('precio_unitario') or 0))
    except Exception:
        precio = Decimal('0')
    # Si no la mandan, se hereda del tipo de la cotización (una de renta sin
    # unidad se cotiza por día, que es la más común).
    modalidad = (d.get('modalidad') or '').lower()
    if modalidad not in _MODALIDADES:
        modalidad = 'dia' if cot.tipo == 'renta' else 'venta'
    with transaction.atomic():
        CotizacionItem.objects.create(cotizacion=cot, descripcion=desc, cantidad=cant,
                                      precio_unitario=precio, modalidad=modalidad)
        cot.recalcular_tipo()
    cot.refresh_from_db()
    return Response(CotizacionSerializer(cot).data, status=201)


@api_view(['PATCH'])
@permission_classes([IsAdminGroupOrStaff])
def cotizacion_item_modalidad(request, pk: int, item_id: int):
    """Corrige si una partida es de venta o de renta (y con qué unidad)."""
    try:
        item = CotizacionItem.objects.select_related('cotizacion').get(pk=item_id, cotizacion_id=pk)
    except CotizacionItem.DoesNotExist:
        return Response({'detalle': 'Partida no encontrada'}, status=404)
    bloqueo = _bloqueada_si_convertida(item.cotizacion)
    if bloqueo:
        return bloqueo
    modalidad = (request.data or {}).get('modalidad', '')
    if modalidad not in _MODALIDADES:
        return Response({'detalle': 'Modalidad inválida. Usa venta, dia, semana o mes.'}, status=400)
    with transaction.atomic():
        item.modalidad = modalidad
        item.save(update_fields=['modalidad'])
        item.cotizacion.recalcular_tipo()
    return Response(CotizacionSerializer(Cotizacion.objects.get(pk=pk)).data)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
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
    # Unidades físicas que se entregan (número de identificación): se marcan
    # vendidas en el mismo acto, así el inventario y el catálogo público
    # (que se calculan de las unidades) quedan cuadrados sin pasos manuales.
    from inventario.models import Inventario as _Inv
    unidades = []
    for uid in (request.data.get('unidad_ids') or []):
        try:
            u = _Inv.objects.get(id=int(uid))
        except (ValueError, _Inv.DoesNotExist):
            return Response({'detalle': f'Unidad {uid} no existe.'}, status=400)
        if u.estado != 'disponible':
            return Response({'detalle': f'La unidad {u.codigo} no está disponible (está {u.estado}).'}, status=400)
        unidades.append(u)

    partidas_venta = [i for i in cot.items.all() if i.modalidad == 'venta']
    if not partidas_venta:
        return Response(
            {'detalle': 'Esta cotización no tiene partidas de venta. '
                        'Las de renta se concretan creando la renta (eligiendo unidad y fechas).'},
            status=400,
        )

    existente = cot.conversiones.first()
    if existente:
        return Response({'detalle': 'Esta cotización ya se convirtió.', 'venta_id': existente.id, 'cotizacion': CotizacionSerializer(cot).data}, status=200)

    with transaction.atomic():
        venta = Venta.objects.create(
            usuario=request.user if request.user.is_authenticated else None,
            nombre_cliente=(cot.cliente_nombre or (cot.empresa.nombre if cot.empresa_id and cot.empresa else '')),
            telefono_cliente=cot.cliente_telefono,
            empresa_id=cot.empresa_id,
            precio_maquina=cot.subtotal_venta,  # solo lo que se vende (sin IVA)
            metodo_pago=metodo,
            pagos=pagos,
            inventario=unidades[0] if unidades else None,
            cotizacion=cot,                    # IVA: lo fuerza el modelo Venta (toda venta con IVA)
        )
        for u in unidades:
            u.marcar_vendido()

    cot.refresh_from_db()
    pendientes = len(cot.items.all()) - len(partidas_venta)
    detalle = 'Cotización convertida a venta'
    if pendientes:
        detalle += f' · quedan {pendientes} partida(s) de renta por concretar'
    return Response({'detalle': detalle, 'venta_id': venta.id, 'partidas_renta_pendientes': pendientes,
                     'cotizacion': CotizacionSerializer(cot).data}, status=201)


@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
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
    return Response({'detalle': 'La estás atendiendo', 'cotizacion': CotizacionSerializer(cot).data})


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAdminGroupOrStaff])
def cotizacion_item(request, pk: int, item_id: int):
    """Edita (PATCH: descripción/cantidad/precio) o elimina (DELETE) una partida.

    La edición en línea manda solo el campo que cambió; se aplica lo que venga.
    """
    try:
        item = CotizacionItem.objects.select_related('cotizacion').get(pk=item_id, cotizacion_id=pk)
    except CotizacionItem.DoesNotExist:
        return Response({'detalle': 'Partida no encontrada'}, status=404)
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
@permission_classes([IsAdminGroupOrStaff])
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
@permission_classes([IsAdminGroupOrStaff])
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
@permission_classes([IsAdminGroupOrStaff])
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
@permission_classes([IsAdminGroupOrStaff])
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
