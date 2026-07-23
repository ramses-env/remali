import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from maquinaria.permissions import IsAdminGroupOrStaff
from maquinaria.throttling import SolicitudPublicaThrottle
from .models import Cotizacion, CotizacionItem
from .serializers import CotizacionSerializer

logger = logging.getLogger(__name__)

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
        partidas.append((etiqueta, cant, Decimal(str(precio or 0)), modalidad))

    if not partidas:
        return Response({'detalle': 'No pudimos identificar los equipos de tu solicitud.'}, status=400)

    obra = d.get('obra') or {}
    with transaction.atomic():
        cot = Cotizacion.objects.create(
            tipo='venta',          # provisional: lo define recalcular_tipo() con las partidas
            origen='cliente',
            estado='enviada',
            cliente_nombre=nombre,
            cliente_telefono=(cliente.get('telefono') or '').strip(),
            cliente_email=(cliente.get('email') or '').strip(),
            aplica_iva=bool(d.get('requiere_factura')),
            datos_solicitud={
                'empresa': (cliente.get('empresa') or '').strip(),
                'obra': {
                    'responsable': (obra.get('responsable') or '').strip(),
                    'direccion': (obra.get('direccion') or '').strip(),
                    'telefono': (obra.get('telefono') or '').strip(),
                    'email': (obra.get('email') or '').strip(),
                },
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

    return Response({'detalle': 'Solicitud recibida', 'folio': cot.folio, 'id': cot.id}, status=201)


class CotizacionListCreate(generics.ListCreateAPIView):
    serializer_class = CotizacionSerializer
    permission_classes = [IsAdminGroupOrStaff]

    def get_queryset(self):
        qs = Cotizacion.objects.all().select_related('empresa').prefetch_related('items', 'conversiones')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado in ('borrador', 'enviada', 'aceptada', 'rechazada'):
            qs = qs.filter(estado=estado)
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(folio__icontains=q) | Q(cliente_nombre__icontains=q) | Q(empresa__nombre__icontains=q))
        return qs


class CotizacionDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CotizacionSerializer
    permission_classes = [IsAdminGroupOrStaff]
    queryset = Cotizacion.objects.all().select_related('empresa').prefetch_related('items', 'conversiones')

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
    # Se convierten SOLO las partidas de venta. Las de renta se concretan
    # creando la renta (eligiendo unidad y fechas), así que una cotización mixta
    # genera la venta y deja sus partidas de renta pendientes.
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
            cotizacion=cot,                    # IVA: lo fuerza el modelo Venta (toda venta con IVA)
        )
        if cot.estado != 'aceptada':
            cot.estado = 'aceptada'
            cot.save(update_fields=['estado', 'actualizada'])

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


@api_view(['DELETE'])
@permission_classes([IsAdminGroupOrStaff])
def cotizacion_eliminar_item(request, pk: int, item_id: int):
    try:
        item = CotizacionItem.objects.select_related('cotizacion').get(pk=item_id, cotizacion_id=pk)
    except CotizacionItem.DoesNotExist:
        return Response({'detalle': 'Partida no encontrada'}, status=404)
    bloqueo = _bloqueada_si_convertida(item.cotizacion)
    if bloqueo:
        return bloqueo
    with transaction.atomic():
        item.delete()
        cot = Cotizacion.objects.get(pk=pk)
        cot.recalcular_tipo()
    return Response(CotizacionSerializer(Cotizacion.objects.get(pk=pk)).data)
