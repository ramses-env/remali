"""Cotización en PDF tamaño carta, para que el cliente la reenvíe a su jefe.

El generador térmico de `server/ticketing.py` es de 58 mm: sirve para el ticket
de mostrador, no para un documento que se manda por correo. Este es carta.

Los datos del negocio salen de ConfiguracionSitio (Configuración › Negocio y
contacto), no de constantes: si cambian la dirección, cambia aquí también.
"""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

GRIS = colors.HexColor('#6B7280')
TINTA = colors.HexColor('#111827')
LINEA = colors.HexColor('#E5E7EB')
ORO = colors.HexColor('#B8872E')


def _money(v):
    return f'${float(v or 0):,.2f}'


def _recortar(c, texto, fuente, tam, ancho):
    texto = str(texto or '')
    if stringWidth(texto, fuente, tam) <= ancho:
        return texto
    while texto and stringWidth(texto + '…', fuente, tam) > ancho:
        texto = texto[:-1]
    return texto + '…'


def render_cotizacion_pdf(cot) -> bytes:
    """Devuelve los bytes del PDF de una Cotizacion."""
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 18 * mm
    y = alto - m

    # ── Encabezado ──
    c.setFillColor(TINTA)
    c.setFont('Helvetica-Bold', 18)
    c.drawString(m, y, cfg.negocio_nombre or 'REMALI')
    c.setFont('Helvetica-Bold', 15)
    c.drawRightString(ancho - m, y, 'COTIZACIÓN')
    y -= 6 * mm

    c.setFillColor(GRIS)
    c.setFont('Helvetica', 8.5)
    for dato in (cfg.negocio_direccion, cfg.negocio_telefono, f'RFC: {cfg.negocio_rfc}' if cfg.negocio_rfc else ''):
        if dato:
            c.drawString(m, y, str(dato))
            y -= 4.2 * mm
    c.setFillColor(ORO)
    c.setFont('Helvetica-Bold', 11)
    c.drawRightString(ancho - m, alto - m - 6 * mm, cot.folio or '')

    y -= 3 * mm
    c.setStrokeColor(LINEA)
    c.line(m, y, ancho - m, y)
    y -= 8 * mm

    # ── Cliente y datos ──
    col2 = ancho / 2 + 5 * mm
    y_ini = y
    c.setFillColor(ORO); c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, 'CLIENTE')
    c.drawString(col2, y, 'DATOS')
    y -= 5 * mm

    extra = cot.datos_solicitud or {}
    obra = extra.get('obra') or {}
    izquierda = [
        cot.cliente_display,
        extra.get('empresa') or (cot.empresa.nombre if cot.empresa_id and cot.empresa else ''),
        cot.cliente_telefono, cot.cliente_email,
        f"Obra: {obra.get('direccion')}" if obra.get('direccion') else '',
    ]
    derecha = [
        f'Fecha: {cot.creada.strftime("%d/%m/%Y") if cot.creada else "—"}',
        f'Válida hasta: {cot.vigencia_hasta.strftime("%d/%m/%Y") if cot.vigencia_hasta else "—"}',
        f'Tipo: {cot.get_tipo_display()}',
        'Precios sin IVA' if not cot.aplica_iva else 'Precios más IVA (16%)',
    ]
    c.setFont('Helvetica', 9)
    yi = y
    for linea in [x for x in izquierda if x]:
        c.setFillColor(TINTA)
        c.drawString(m, yi, _recortar(c, linea, 'Helvetica', 9, ancho / 2 - m - 8 * mm))
        yi -= 4.6 * mm
    yd = y
    for linea in derecha:
        c.setFillColor(GRIS)
        c.drawString(col2, yd, str(linea))
        yd -= 4.6 * mm
    y = min(yi, yd) - 5 * mm
    del y_ini

    # ── Partidas ──
    c.setFillColor(ORO); c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, 'CONCEPTOS')
    y -= 5 * mm

    # Las tres últimas van alineadas a la derecha, así que necesitan aire entre
    # ellas: un importe de 6 cifras mide ~18 mm y si no, se encima con la cantidad.
    x_desc, x_mod = m, m + 85 * mm
    x_cant, x_pu, x_imp = m + 122 * mm, m + 150 * mm, ancho - m
    c.setFillColor(GRIS); c.setFont('Helvetica-Bold', 7.5)
    c.drawString(x_desc, y, 'DESCRIPCIÓN')
    c.drawString(x_mod, y, 'MODALIDAD')
    c.drawRightString(x_cant, y, 'CANT.')
    c.drawRightString(x_pu, y, 'P. UNIT.')
    c.drawRightString(x_imp, y, 'IMPORTE')
    y -= 2 * mm
    c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y)
    y -= 5 * mm

    c.setFont('Helvetica', 9)
    for it in cot.items.all():
        if y < 55 * mm:                      # no escribir encima de los totales
            c.showPage()
            y = alto - m
            c.setFont('Helvetica', 9)
        c.setFillColor(TINTA)
        c.drawString(x_desc, y, _recortar(c, it.descripcion, 'Helvetica', 9, 82 * mm))
        c.setFillColor(GRIS)
        c.drawString(x_mod, y, _recortar(c, it.modalidad_label, 'Helvetica', 9, 30 * mm))
        c.setFillColor(TINTA)
        c.drawRightString(x_cant, y, str(it.cantidad))
        c.drawRightString(x_pu, y, _money(it.precio_unitario))
        c.drawRightString(x_imp, y, _money(it.subtotal))
        y -= 5.4 * mm

    y -= 2 * mm
    c.setStrokeColor(LINEA); c.line(ancho / 2, y, ancho - m, y)
    y -= 6 * mm

    # ── Totales ──
    def total(label, valor, fuerte=False):
        nonlocal y
        c.setFont('Helvetica-Bold' if fuerte else 'Helvetica', 11 if fuerte else 9)
        c.setFillColor(TINTA if fuerte else GRIS)
        c.drawRightString(ancho - m - 32 * mm, y, label)
        c.setFillColor(TINTA)
        c.drawRightString(ancho - m, y, _money(valor))
        y -= 6 * mm

    total('Subtotal', cot.subtotal)
    if cot.aplica_iva:
        total('IVA (16%)', cot.iva)
    total('Total', cot.total, fuerte=True)

    # ── Pie ──
    c.setFillColor(GRIS); c.setFont('Helvetica', 8)
    pie = [
        'Esta cotización es informativa y no aparta el equipo; la disponibilidad se confirma al reservar.',
        f'Dudas: {cfg.negocio_telefono or cfg.whatsapp_principal or ""}'.strip(),
        cfg.negocio_footer or '',
    ]
    yp = m + 6 * mm
    for linea in reversed([p for p in pie if p]):
        c.drawCentredString(ancho / 2, yp, linea)
        yp += 4.2 * mm

    c.showPage()
    c.save()
    return buf.getvalue()
