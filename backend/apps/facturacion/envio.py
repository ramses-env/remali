"""Entrega de la factura al cliente por correo, con acuse.

Aquí se resuelve el problema de fondo: `enviar_async` manda en un hilo y su
`True` significa "se puso en camino", no "llegó". Un CFDI que nunca salió sería
invisible, y este proyecto ya se quemó con un respaldo que fallaba en silencio.
Por eso cada envío deja constancia en la propia factura (`envio_estado`) y un
fallo levanta notificación en el panel: el problema tiene que llegar solo,
sin que nadie vaya a leer logs.
"""
import logging

from django.utils import timezone

log = logging.getLogger(__name__)

# El motivo real del fallo (traceback SMTP, respuesta de Brevo) queda en el log:
# el callback solo sabe si salió o no. Lo que se guarda en la factura es para
# que quien mira la bandeja entienda qué pasó y qué puede hacer.
MOTIVO_FALLO = ('No se pudo entregar el correo al servidor de envío. '
                'Revisa que la dirección sea correcta y reenvía.')


def _nombre_base(factura):
    """Cómo se llaman los archivos que le llegan al cliente.

    Serie+folio es lo que el cliente reconoce y lo que le pide su contador; el
    UUID recortado es el respaldo para los CFDI que no traen folio, y sirve
    porque igual es único entre las facturas de una misma persona.
    """
    return f'{factura.serie}{factura.folio}' if (factura.serie or factura.folio) else factura.uuid[:8]


def _adjuntos(factura, base):
    """El XML siempre; el PDF si se pudo generar.

    El XML es el documento fiscal: es el que vale ante el SAT y el que el
    contador carga. El PDF es su representación impresa, útil pero decorativa.
    Si el PDF truena (una fuente, un logo, un dato raro), el correo sale
    igualmente con el XML: dejar al cliente sin factura porque falló la
    decoración sería el error más caro de los dos.
    """
    adjuntos = [(f'{base}.xml', factura.xml.encode('utf-8'), 'application/xml')]
    try:
        from .pdf import render_factura_pdf
        adjuntos.append((f'{base}.pdf', render_factura_pdf(factura), 'application/pdf'))
    except Exception:
        log.exception('No se pudo generar el PDF de la factura %s; sale solo el XML', factura.uuid)
    return adjuntos


def _cuerpo(factura, negocio):
    sol = factura.solicitud
    origen = sol.folio_origen if sol else '—'
    lineas = [
        f'{sol.razon_social or sol.rfc or "Estimado cliente"}:' if sol else 'Estimado cliente:',
        '',
        f'Adjuntamos su factura electrónica (CFDI) por su {sol.get_tipo_display().lower() if sol else "operación"} {origen}.',
        '',
        f'Folio fiscal (UUID): {factura.uuid}',
    ]
    if factura.serie or factura.folio:
        lineas.append(f'Serie y folio: {factura.serie}{factura.folio}')
    lineas += [
        f'Total: ${factura.total:,.2f} {factura.moneda or "MXN"}',
    ]
    if sol and sol.concepto:
        lineas.append(f'Concepto: {sol.concepto}')
    lineas += [
        '',
        'Van dos archivos: el XML, que es el documento fiscal válido ante el SAT '
        'y el que necesita su contador, y el PDF, que es su representación impresa.',
        '',
        f'{negocio}',
    ]
    return '\n'.join(lineas)


def _guardar_resultado(factura_id, uuid, base):
    """Arma el callback que anota en la base cómo terminó el envío.

    Corre en el hilo del correo, así que escribe con `update()` sobre el id en
    vez de guardar la instancia que traía el request: esa puede llevar minutos
    en memoria y pisar cambios que otro hizo mientras tanto.
    """
    def al_terminar(ok):
        from maquinaria.models import crear_notificacion
        from .models import Factura

        if ok:
            Factura.objects.filter(pk=factura_id).update(
                envio_estado='enviada', enviada_en=timezone.now(), envio_error='')
            return

        Factura.objects.filter(pk=factura_id).update(
            envio_estado='fallo', envio_error=MOTIVO_FALLO[:255])
        # `ref` fija por factura a propósito: si el correo está mal y se
        # reintenta cinco veces, el panel debe mostrar un problema, no cinco.
        crear_notificacion(
            'alerta',
            f'No se pudo enviar la factura {base}',
            f'{MOTIVO_FALLO} Folio fiscal {uuid}.',
            seccion='facturacion',
            ref=f'factura-envio-fallo-{factura_id}',
            data={'factura': factura_id, 'uuid': uuid},
        )

    return al_terminar


def enviar_factura(factura) -> bool:
    """Manda la factura (XML + PDF) al correo fiscal de su solicitud.

    Devuelve True si se puso en camino. El resultado de verdad llega después,
    por el callback, a `envio_estado`.
    """
    from maquinaria.correo import enviar_async
    from maquinaria.models import ConfiguracionSitio

    sol = factura.solicitud
    correo = ((sol.email if sol else '') or '').strip()
    if not correo:
        # Sin correo no se inventa destinatario: mandarle el CFDI de un cliente
        # a la dirección de contacto equivocada es filtrar sus datos fiscales.
        # Queda 'pendiente' y la bandeja lo muestra como "sin correo".
        from .models import Factura
        if factura.envio_estado != 'pendiente':
            # Si venía de un 'fallo', regresa a 'pendiente': el problema ya no es
            # que el correo se cayó, es que falta a quién mandárselo.
            Factura.objects.filter(pk=factura.pk).update(envio_estado='pendiente', envio_error='')
            factura.envio_estado = 'pendiente'
            factura.envio_error = ''
        return False

    cfg = ConfiguracionSitio.get_solo()
    negocio = cfg.negocio_nombre or 'REMALI'
    base = _nombre_base(factura)

    return enviar_async(
        f'Su factura {base} · {negocio}',
        _cuerpo(factura, negocio),
        [correo],
        _adjuntos(factura, base),
        al_terminar=_guardar_resultado(factura.pk, factura.uuid, base),
    )
