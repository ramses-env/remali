"""Bandeja "por facturar": capturar, completar y marcar.

REMALI **no timbra**. Se queda con la solicitud (el snapshot fiscal + los
importes) y con el folio fiscal que le devuelve el PAC. El XML y el PDF los
manda administración por fuera, así que aquí no se guarda ni se promete ningún
archivo.
"""
import csv
import logging
import re

from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import PuedeFacturar
from .models import SolicitudFactura
from .serializers import SolicitudFacturaSerializer

log = logging.getLogger(__name__)

# Campos fiscales que se pueden completar/corregir antes de timbrar.
CAMPOS_EDITABLES = ['rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi', 'email', 'forma_pago', 'notas']

# Folio fiscal del SAT: UUID de 36 caracteres. Ni más corto ni con adornos.
UUID_RE = re.compile(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$')


def _qs(params):
    qs = SolicitudFactura.objects.all().select_related('cliente', 'venta', 'renta')
    estado = (params.get('estado') or '').strip().lower()
    if estado in ('pendiente', 'facturada', 'cancelada'):
        qs = qs.filter(estado=estado)
    q = (params.get('q') or '').strip()
    if q:
        qs = qs.filter(Q(rfc__icontains=q) | Q(razon_social__icontains=q) | Q(uuid__icontains=q) | Q(concepto__icontains=q))
    return qs


def _buscar(pk):
    """La solicitud, o None. Cada vista arma su propio 404 con el mismo texto."""
    return SolicitudFactura.objects.filter(pk=pk).first()


def _no_encontrada():
    return Response({'detalle': 'Solicitud no encontrada'}, status=404)


@api_view(['GET'])
@permission_classes([PuedeFacturar])
def listar_solicitudes(request):
    data = SolicitudFacturaSerializer(_qs(request.query_params), many=True).data
    return Response(data)


@api_view(['GET'])
@permission_classes([PuedeFacturar])
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
@permission_classes([PuedeFacturar])
def actualizar_solicitud(request, pk: int):
    """Completa/corrige los datos fiscales de una solicitud pendiente."""
    sol = _buscar(pk)
    if sol is None:
        return _no_encontrada()
    if sol.estado != 'pendiente':
        return Response(
            {'detalle': f'No se pueden editar los datos de una solicitud {sol.get_estado_display().lower()}. '
                        'Reábrela primero si necesitas corregirla.'},
            status=409,
        )
    d = request.data if isinstance(request.data, dict) else {}
    for campo in CAMPOS_EDITABLES:
        if campo in d:
            # Se pasa por str porque el cuerpo es JSON: un número o un nulo en
            # un campo de texto no puede tumbar la petición con un 500.
            valor = str(d.get(campo) or '')
            setattr(sol, campo, valor.strip().upper() if campo == 'rfc' else valor)
    sol.save()
    return Response(SolicitudFacturaSerializer(sol).data)


def _avisar_al_cliente(sol):
    """Le dice al cliente que su compra o renta ya está facturada.

    Es lo único que el cliente necesita saber de esto: pidió factura y ya está.
    El XML y el PDF se los sigue mandando administración por fuera, así que
    aquí NO se promete un archivo que el sistema no tiene.

    Solo si la venta o la renta está ligada a su cuenta: sin cuenta no hay a
    quién avisarle, y no se inventa un destinatario.
    """
    from maquinaria.models import crear_notificacion

    fuente = sol.venta or sol.renta
    if fuente is None:
        return
    cuenta = getattr(fuente, 'cliente_usuario', None) or getattr(fuente, 'usuario', None)
    if cuenta is None:
        return
    que = 'compra' if sol.venta_id else 'renta'
    try:
        crear_notificacion(
            'sistema',
            f'Tu {que} ya está facturada',
            f'Emitimos la factura de {sol.folio_origen} por ${sol.total}. '
            'Si no la recibes, pídenosla y te la reenviamos.',
            seccion='mis-compras' if sol.venta_id else 'mis-rentas',
            # De un solo aviso por solicitud: reabrir y volver a marcar no debe
            # llenarle el buzón al cliente con la misma noticia.
            ref=f'factura-lista-{sol.id}',
            # `venta_id`/`renta_id` van porque de ahí saca la campana del
            # cliente el botón "Ver mi compra"; sin ellos el aviso llega mudo.
            data={
                'solicitud_id': sol.id,
                'folio': sol.folio_origen,
                **({'venta_id': sol.venta_id} if sol.venta_id else {'renta_id': sol.renta_id}),
            },
            usuario=cuenta,
        )
    except Exception:
        # Avisar es cortesía: que falle no puede impedir marcar la factura.
        log.exception('No se pudo avisar de la factura %s', sol.id)


@api_view(['POST'])
@permission_classes([PuedeFacturar])
def marcar_facturada(request, pk: int):
    """Marca la solicitud como facturada guardando el folio fiscal (UUID)."""
    sol = _buscar(pk)
    if sol is None:
        return _no_encontrada()
    if sol.estado != 'pendiente':
        return Response(
            {'detalle': f'Esta solicitud ya está {sol.get_estado_display().lower()}; '
                        'no se puede volver a marcar como facturada.'},
            status=409,
        )
    uuid = str(request.data.get('uuid') or '').strip().upper()
    if not uuid:
        return Response({'detalle': 'Captura el folio fiscal (UUID) del CFDI timbrado.'}, status=400)
    # El folio fiscal es el único dato que liga esta venta con el CFDI del SAT:
    # si entra mal escrito, la solicitud queda "facturada" apuntando a nada.
    if not UUID_RE.match(uuid):
        return Response(
            {'detalle': 'Ese no es un folio fiscal válido. Son 36 caracteres con guiones, '
                        'como 3F2504E0-4F89-11D3-9A0C-0305E82C3301.'},
            status=400,
        )
    otra = SolicitudFactura.objects.filter(uuid=uuid).exclude(pk=sol.pk).first()
    if otra is not None:
        return Response(
            {'detalle': f'Ese folio fiscal ya está en la solicitud de {otra.folio_origen}. '
                        'Un CFDI no puede facturar dos operaciones.'},
            status=409,
        )
    sol.uuid = uuid
    sol.estado = 'facturada'
    sol.fecha_timbrado = timezone.now()
    notas = request.data.get('notas')
    if notas is not None:
        sol.notas = str(notas)
    sol.save()
    _avisar_al_cliente(sol)
    return Response(SolicitudFacturaSerializer(sol).data)


@api_view(['POST'])
@permission_classes([PuedeFacturar])
def reabrir_solicitud(request, pk: int):
    """Regresa una solicitud a pendiente (si se timbró por error)."""
    sol = _buscar(pk)
    if sol is None:
        return _no_encontrada()
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
@permission_classes([PuedeFacturar])
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
