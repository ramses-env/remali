"""PDF de la orden de reparación (la "orden de pago" que descarga el cliente).

Un solo documento tamaño Carta con reportlab, al mismo estilo que el PDF de
cotización: encabezado de marca, datos del cliente y del equipo, la falla, el
trabajo realizado, las refacciones usadas y el total. Se genera para la liga
pública (token) y para "Mis reparaciones" (cliente en sesión)."""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

TINTA = colors.HexColor('#111827')
GRIS = colors.HexColor('#6B7280')
LINEA = colors.HexColor('#E5E7EB')
# Dorado REMALI: el acento de mantenimiento/servicio (distinto del azul de venta
# y el naranja de renta de las cotizaciones).
ACENTO = colors.HexColor('#B8872E')

ESTADO_LABEL = {
    'recibida': 'Recibida', 'proceso': 'En proceso',
    'terminada': 'Lista para entrega', 'entregada': 'Entregada',
}


def _money(v):
    try:
        return f'${float(v):,.2f}'
    except Exception:
        return '$0.00'


def _fecha(v):
    try:
        return v.strftime('%d/%m/%Y')
    except Exception:
        return '—'


def _wrap(texto, font, size, max_w):
    """Parte un texto en líneas que caben en max_w (respeta saltos de línea)."""
    lineas = []
    for parrafo in (texto or '').split('\n'):
        palabras, actual = parrafo.split(), ''
        for p in palabras:
            prueba = f'{actual} {p}'.strip()
            if stringWidth(prueba, font, size) <= max_w:
                actual = prueba
            else:
                if actual:
                    lineas.append(actual)
                actual = p
        lineas.append(actual)
    return lineas or ['']


def _bloque(c, titulo, texto, ancho, alto, m, y):
    """Sección con título de acento y su texto en párrafo; pagina si no cabe."""
    cuerpo = (texto or '').strip()
    if not cuerpo:
        return y
    lineas = _wrap(cuerpo, 'Helvetica', 9.5, ancho - 2 * m)
    if y - (6 * mm + len(lineas) * 4.6 * mm) < m + 24 * mm:
        c.showPage(); y = alto - m
    c.setFillColor(ACENTO); c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, titulo)
    y -= 5 * mm
    c.setFillColor(TINTA); c.setFont('Helvetica', 9.5)
    for ln in lineas:
        c.drawString(m, y, ln)
        y -= 4.6 * mm
    return y - 2 * mm


def render_orden_reparacion_pdf(orden) -> bytes:
    """Devuelve los bytes del PDF de una OrdenReparacion."""
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 15 * mm
    y = alto - m

    # ── Encabezado: marca + título ──
    lg = 11 * mm
    ly = y - 3.5 * mm
    c.setFillColor(ACENTO)
    c.roundRect(m, ly, lg, lg, 2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont('Helvetica-Bold', 14)
    c.drawCentredString(m + lg / 2, ly + lg / 2 - 5, 'R')

    c.setFillColor(ACENTO); c.setFont('Helvetica-Bold', 18)
    c.drawString(m + lg + 4 * mm, y, cfg.negocio_nombre or 'REMALI')
    c.setFillColor(TINTA); c.setFont('Helvetica-Bold', 14)
    c.drawRightString(ancho - m, y, 'ORDEN DE REPARACIÓN')
    y -= 6 * mm
    c.setFillColor(ACENTO); c.setFont('Helvetica-Bold', 11)
    c.drawRightString(ancho - m, y, orden.folio or '')

    # Contacto del negocio (izquierda)
    c.setFillColor(GRIS); c.setFont('Helvetica', 8.5)
    contacto = '   ·   '.join(x for x in (
        f'Tel. {cfg.negocio_telefono}' if cfg.negocio_telefono else '',
        cfg.negocio_email, cfg.negocio_web,
    ) if x)
    for dato in (cfg.negocio_direccion, contacto):
        if dato:
            c.drawString(m, y, str(dato))
            y -= 4.2 * mm
    # Estado (derecha, a la altura del contacto)
    c.setFillColor(GRIS); c.setFont('Helvetica', 9)
    c.drawRightString(ancho - m, y + 4.2 * mm, ESTADO_LABEL.get(orden.estado, orden.estado))

    y -= 2 * mm
    c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y)
    y -= 6 * mm

    # ── Cliente y datos ──
    col2 = ancho / 2 + 5 * mm
    c.setFillColor(ACENTO); c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, 'CLIENTE')
    c.drawString(col2, y, 'EQUIPO')
    y -= 5 * mm
    izquierda = [orden.cliente_display, f'Tel: {orden.cliente_telefono}' if orden.cliente_telefono else '']
    derecha = [
        orden.equipo_display,
        f'No. de serie: {orden.numero_serie}' if orden.numero_serie else '',
        f'Recibido: {_fecha(orden.fecha_recibida)}',
        f'Entregado: {_fecha(orden.fecha_entrega)}' if orden.fecha_entrega else '',
    ]
    c.setFont('Helvetica', 9)
    yi = y
    for ln in [x for x in izquierda if x]:
        c.setFillColor(TINTA); c.drawString(m, yi, str(ln)); yi -= 4.3 * mm
    yd = y
    for ln in [x for x in derecha if x]:
        c.setFillColor(GRIS); c.drawString(col2, yd, str(ln)); yd -= 4.3 * mm
    y = min(yi, yd) - 4 * mm

    # ── Falla y trabajo ──
    y = _bloque(c, 'FALLA REPORTADA', orden.diagnostico, ancho, alto, m, y)
    y = _bloque(c, 'TRABAJO REALIZADO', orden.trabajo_realizado, ancho, alto, m, y)

    # ── Refacciones ──
    items = list(orden.items.all())
    if items:
        if y - (10 * mm + len(items) * 5 * mm) < m + 40 * mm:
            c.showPage(); y = alto - m
        c.setFillColor(ACENTO); c.setFont('Helvetica-Bold', 8)
        c.drawString(m, y, 'REFACCIONES Y MATERIALES')
        y -= 5 * mm
        x_cant, x_pu, x_imp = m + 118 * mm, m + 150 * mm, ancho - m
        c.setFillColor(GRIS); c.setFont('Helvetica-Bold', 7.5)
        c.drawString(m, y, 'DESCRIPCIÓN')
        c.drawRightString(x_cant, y, 'CANT.')
        c.drawRightString(x_pu, y, 'P. UNIT.')
        c.drawRightString(x_imp, y, 'IMPORTE')
        y -= 2 * mm
        c.setStrokeColor(LINEA); c.line(m, y, ancho - m, y)
        y -= 5 * mm
        c.setFont('Helvetica', 9)
        for it in items:
            if y < 45 * mm:
                c.showPage(); y = alto - m; c.setFont('Helvetica', 9)
            c.setFillColor(TINTA)
            nombre = it.nombre or (it.refaccion.nombre if it.refaccion_id and it.refaccion else 'Refacción')
            # recorta el nombre para que no invada la columna de cantidad
            while nombre and stringWidth(nombre, 'Helvetica', 9) > 98 * mm:
                nombre = nombre[:-2]
            c.drawString(m, y, nombre)
            c.drawRightString(x_cant, y, str(it.cantidad))
            c.drawRightString(x_pu, y, _money(it.costo_unitario))
            c.drawRightString(x_imp, y, _money(it.subtotal))
            y -= 5 * mm
        y -= 1 * mm

    # ── Totales ──
    if y < 45 * mm:
        c.showPage(); y = alto - m
    c.setStrokeColor(LINEA); c.line(ancho / 2, y, ancho - m, y)
    y -= 5 * mm

    def _fila(label, valor, fuerte=False):
        nonlocal y
        c.setFont('Helvetica-Bold' if fuerte else 'Helvetica', 12 if fuerte else 9)
        c.setFillColor(TINTA if fuerte else GRIS)
        c.drawRightString(ancho - m - 32 * mm, y, label)
        c.setFillColor(TINTA)
        c.drawRightString(ancho - m, y, _money(valor))
        y -= 5.6 * mm

    if items:
        _fila('Refacciones', orden.total_refacciones)
    _fila('Mano de obra', orden.costo_mano_obra)
    _fila('TOTAL', orden.total, fuerte=True)

    # ── Notas ──
    y = _bloque(c, 'NOTAS', orden.notas, ancho, alto, m, y - 2 * mm)

    # ── Pie ──
    c.setFillColor(GRIS); c.setFont('Helvetica', 8)
    pie = [
        'Este documento ampara el servicio realizado a su equipo.',
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
