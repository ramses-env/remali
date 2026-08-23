import csv

from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import PuedeFacturar
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
@permission_classes([PuedeFacturar])
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
@permission_classes([PuedeFacturar])
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

    # El correo sale FUERA del atómico, ya con la factura confirmada en la base:
    # el envío corre en otro hilo, y desde ahí una transacción sin commitear
    # todavía no existe — el callback intentaría marcar una factura invisible.
    # Y si el correo falla, la factura ya quedó: subirla no se deshace por eso.
    from .envio import enviar_factura
    try:
        enviar_factura(factura)
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Falló el arranque del envío de la factura %s', factura.uuid)

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
@permission_classes([permissions.IsAuthenticated])
def descargar_pdf(request, pk: int):
    """La representación impresa del CFDI, generada por REMALI.

    No se guarda en ningún lado: se arma cada vez a partir del XML. Así el
    documento no puede desincronizarse de su CFDI, y cambiar el logo o el
    formato reescribe también las facturas viejas sin migrar nada.
    """
    from django.http import HttpResponse

    from .pdf import render_factura_pdf

    f = _factura_visible(request.user, pk)
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    nombre = f'{f.serie}{f.folio}' if (f.serie or f.folio) else f.uuid[:8]
    resp = HttpResponse(render_factura_pdf(f), content_type='application/pdf')
    resp['Content-Disposition'] = f'inline; filename="factura-{nombre}.pdf"'
    return resp


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def facturas_mias(request):
    """Las facturas del cliente que las pide, para "Mis facturas".

    Solo las de SUS ventas y rentas. El filtro va por la cuenta ligada a la
    operación, no por el RFC: dos personas pueden facturar al mismo RFC de una
    empresa y no por eso ven las compras la una de la otra.
    """
    from django.db.models import Q

    from .models import Factura
    from .serializers import FacturaSerializer

    qs = (Factura.objects
          .filter(Q(solicitud__venta__cliente_usuario=request.user)
                  | Q(solicitud__renta__usuario=request.user))
          .select_related('solicitud', 'solicitud__venta', 'solicitud__renta')
          .order_by('-subida_en')[:200])
    return Response({'facturas': FacturaSerializer(qs, many=True).data})


@api_view(['POST'])
@permission_classes([PuedeFacturar])
def cancelar_factura(request, pk: int):
    """Registra que el CFDI se canceló ANTE EL SAT. REMALI no cancela nada allá.

    La solicitud regresa a pendiente y reaparece en Por facturar: una factura
    cancelada que deja la solicitud en "facturada" es dinero facturado que nadie
    volvió a emitir, y nadie se entera porque ya no se ve en ningún lado.
    """
    from django.db import transaction
    from .models import Factura
    from .serializers import FacturaSerializer

    f = Factura.objects.select_related('solicitud').filter(pk=pk).first()
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    if f.estado == 'cancelada':
        return Response({'detalle': 'Esta factura ya está cancelada.'}, status=409)
    motivo = (request.data.get('motivo') or '').strip()
    if not motivo:
        return Response(
            {'detalle': 'Escribe por qué se canceló: queda en el rastro de la factura.'},
            status=400,
        )

    with transaction.atomic():
        f.estado = 'cancelada'
        f.cancelada_en = timezone.now()
        f.cancelada_motivo = motivo[:255]
        f.save(update_fields=['estado', 'cancelada_en', 'cancelada_motivo'])

        sol = f.solicitud
        vigente = sol.facturas.filter(estado='vigente').first()
        sol.uuid = vigente.uuid if vigente else ''
        sol.fecha_timbrado = vigente.subida_en if vigente else None
        sol.estado = 'facturada' if vigente else 'pendiente'
        sol.save(update_fields=['uuid', 'fecha_timbrado', 'estado', 'actualizada'])

    return Response({'detalle': 'Factura marcada como cancelada',
                     'factura': FacturaSerializer(f).data})


@api_view(['POST'])
@permission_classes([PuedeFacturar])
def reenviar_factura(request, pk: int):
    """Vuelve a mandar la factura por correo.

    Es la salida para los dos casos que deja el envío automático: la que quedó
    'pendiente' porque la solicitud no traía correo (se captura y se reenvía) y
    la que quedó en 'fallo'. Se permite también sobre una ya enviada: que el
    cliente diga "no me llegó" es más común que cualquier fallo técnico.
    """
    from .envio import enviar_factura
    from .models import Factura
    from .serializers import FacturaSerializer

    f = Factura.objects.select_related('solicitud').filter(pk=pk).first()
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    if not (f.solicitud.email or '').strip():
        return Response(
            {'detalle': 'Esta solicitud no tiene correo. Captúralo en los datos '
                        'fiscales y vuelve a intentar el envío.'},
            status=400,
        )

    enviar_factura(f)
    return Response({'detalle': 'La factura va en camino a ' + f.solicitud.email,
                     'factura': FacturaSerializer(f).data})


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
