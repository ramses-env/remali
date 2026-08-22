"""Orden tamaño CARTA para ventas y rentas de equipo — presentable para
imprimir o enviarle al cliente. El ticket térmico (server/ticketing.py) queda
solo para refacciones en mostrador.

Recibe el MISMO dict que el ticket (datos_comprobante_venta/renta): titulo,
folio, fecha, meta[], items[{nombre,detalle,importe}], totales[], pie[].
"""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from server.documentos import dibujar_logo

TINTA = colors.HexColor('#111827')
GRIS = colors.HexColor('#6b7280')
LINEA = colors.HexColor('#e5e7eb')
ORO = colors.HexColor('#B8872E')
ACENTO = {'venta': colors.HexColor('#2B5FAD'), 'renta': colors.HexColor('#EA580C')}


def render_orden_carta_pdf(d: dict) -> bytes:
    from maquinaria.models import ConfiguracionSitio
    cfg = ConfiguracionSitio.get_solo()
    acento = ACENTO.get(d.get('tipo'), ORO)

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 16 * mm
    y = alto - m

    # ── Membrete (mismo lenguaje que la cotización) ──
    lg = 11 * mm
    dibujar_logo(c, m, y - lg + 2 * mm, lg, respaldo=acento)
    c.setFillColor(acento)
    c.setFont('Helvetica-Bold', 17)
    c.drawString(m + lg + 4 * mm, y - 3 * mm, cfg.negocio_nombre or 'REMALI')
    titulo = 'ORDEN DE RENTA' if d.get('tipo') == 'renta' else 'ORDEN DE VENTA'
    c.setFont('Helvetica-Bold', 14)
    c.drawRightString(ancho - m, y - 2 * mm, titulo)
    c.setFillColor(GRIS); c.setFont('Helvetica', 8.5)
    c.drawRightString(ancho - m, y - 7.5 * mm, f"{d.get('folio', '')} · {d.get('fecha', '')}")
    y -= lg + 4 * mm
    for dato in (cfg.negocio_direccion,
                 '   ·   '.join(x for x in (f'Tel. {cfg.negocio_telefono}' if cfg.negocio_telefono else '',
                                            cfg.negocio_email, cfg.negocio_web) if x),
                 f'RFC: {cfg.negocio_rfc}' if cfg.negocio_rfc else ''):
        if dato:
            c.drawString(m, y, str(dato)); y -= 4.2 * mm
    y -= 2 * mm
    c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y); y -= 8 * mm

    # ── Datos del cliente (meta) ──
    from reportlab.lib.utils import simpleSplit
    c.setFillColor(TINTA)
    col2 = ancho / 2
    # Ancho útil de una columna: hasta el inicio de la otra menos un respiro.
    ancho_col = col2 - m - 6 * mm
    pares = list(d.get('meta', []))
    for i in range(0, len(pares), 2):
        fila_items = pares[i:i + 2]
        lineas_fila = 1
        for j, it in enumerate(fila_items):
            px = m if j == 0 else col2
            c.setFillColor(GRIS); c.setFont('Helvetica', 8)
            c.drawString(px, y, str(it.get('label', '')).upper())
            c.setFillColor(TINTA); c.setFont('Helvetica-Bold', 10)
            # El valor se parte al ancho de SU columna (máx 2 renglones) en vez
            # de correr por encima de la columna vecina (ubicaciones largas).
            lineas = simpleSplit(str(it.get('value', '')), 'Helvetica-Bold', 10, ancho_col)[:2] or ['']
            for k, ln in enumerate(lineas):
                c.drawString(px, y - (4.6 + 4.2 * k) * mm, ln)
            lineas_fila = max(lineas_fila, len(lineas))
        # La fila baja según el par más alto: nada se encima con lo que sigue.
        y -= (11 + 4.2 * (lineas_fila - 1)) * mm
    y -= 2 * mm

    # ── Partidas ──
    c.setFillColor(acento); c.setFont('Helvetica-Bold', 9)
    c.drawString(m, y, 'CONCEPTO'); c.drawRightString(ancho - m, y, 'IMPORTE')
    y -= 2.5 * mm
    c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y); y -= 6 * mm
    for it in d.get('items', []):
        if y < 60 * mm:
            c.showPage(); y = alto - m
        c.setFillColor(TINTA); c.setFont('Helvetica-Bold', 10.5)
        c.drawString(m, y, str(it.get('nombre', ''))[:70])
        c.setFont('Helvetica-Bold', 10.5)
        c.drawRightString(ancho - m, y, f"${it.get('importe', '')}")
        det = str(it.get('detalle', '') or '')
        if det:
            y -= 4.6 * mm
            c.setFillColor(GRIS); c.setFont('Helvetica', 9)
            c.drawString(m, y, det[:90])
        y -= 4 * mm
        c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y)
        y -= 6 * mm

    # ── Totales ──
    y -= 2 * mm
    for t in d.get('totales', []):
        fuerte = t.get('fuerte')
        c.setFillColor(TINTA if not fuerte else acento)
        c.setFont('Helvetica-Bold' if fuerte else 'Helvetica', 13 if fuerte else 10.5)
        c.drawRightString(ancho - m - 32 * mm, y, str(t.get('label', '')))
        c.drawRightString(ancho - m, y, f"${t.get('value', '')}")
        y -= (7.5 if fuerte else 6) * mm

    # ── Pagos (combinados) + pie ──
    y -= 3 * mm
    c.setFillColor(GRIS); c.setFont('Helvetica', 9)
    for linea in d.get('pie', []):
        c.drawString(m, y, str(linea)); y -= 4.8 * mm

    c.setFont('Helvetica', 8)
    c.drawCentredString(ancho / 2, 14 * mm, cfg.negocio_footer or '¡Gracias por su preferencia!')
    c.showPage(); c.save()
    return buf.getvalue()
