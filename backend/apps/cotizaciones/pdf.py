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

# Acento del documento por tipo: venta = azul, renta = naranja. El dorado (ORO)
# queda reservado para mantenimiento. Mixta va con el azul de venta.
ACENTO_TIPO = {
    'venta': colors.HexColor('#2B5FAD'),
    'renta': colors.HexColor('#EA580C'),
    'mixta': colors.HexColor('#2B5FAD'),
}


def _money(v):
    return f'${float(v or 0):,.2f}'


def _recortar(c, texto, fuente, tam, ancho):
    texto = str(texto or '')
    if stringWidth(texto, fuente, tam) <= ancho:
        return texto
    while texto and stringWidth(texto + '…', fuente, tam) > ancho:
        texto = texto[:-1]
    return texto + '…'


def _wrap(texto, fuente, tam, ancho):
    """Parte un texto en líneas que caben en `ancho`, respetando los saltos \n."""
    lineas = []
    for parrafo in str(texto or '').split('\n'):
        actual = ''
        for pal in parrafo.split(' '):
            prueba = f'{actual} {pal}'.strip()
            if stringWidth(prueba, fuente, tam) <= ancho or not actual:
                actual = prueba
            else:
                lineas.append(actual)
                actual = pal
        lineas.append(actual)
    return lineas


def _dibujar_datos_bancarios(c, cfg, ancho, alto, m, y, acento):
    """Datos para depósito, después de los totales (bloque con título)."""
    banco = (cfg.datos_bancarios or '').strip()
    if not banco:
        return y

    lineas = _wrap(banco, 'Helvetica', 9, ancho - 2 * m)
    if y - (5 * mm + len(lineas) * 4.4 * mm) < m + 26 * mm:    # no encimar con el pie
        c.showPage()
        y = alto - m

    y -= 3 * mm
    c.setFillColor(acento); c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, 'DATOS BANCARIOS')
    y -= 5 * mm
    c.setFillColor(TINTA); c.setFont('Helvetica', 9)
    for ln in lineas:
        c.drawString(m, y, ln)
        y -= 4.4 * mm
    return y


def _dibujar_condiciones_fina(c, cfg, tipo, ancho, alto, m, y):
    """Condiciones como letra chica gris, antes del pie (mismo tono que el pie).
    El texto depende del tipo: renta usa sus condiciones; venta (o mixta), las suyas."""
    fuente = cfg.cotizacion_condiciones_renta if tipo == 'renta' else cfg.cotizacion_condiciones
    cond = (fuente or '').strip()
    if not cond:
        return y

    lineas = _wrap(cond, 'Helvetica', 8, ancho - 2 * m)
    if y - (len(lineas) * 4 * mm) < m + 24 * mm:
        c.showPage()
        y = alto - m

    y -= 4 * mm
    c.setFillColor(GRIS); c.setFont('Helvetica', 8)
    for ln in lineas:
        c.drawString(m, y, ln)
        y -= 4 * mm
    return y


def _dibujar_fotos(c, cot, ancho, alto, m, y, acento):
    """Pinta las fotos de la cotización en una rejilla de 2 columnas.

    Va después de los totales y se pagina sola: si no cabe una fila, salta de
    página. Deja siempre aire abajo para que el pie no se encime con una foto.
    """
    fotos = [f for f in cot.fotos.all() if f.imagen]
    if not fotos:
        return y

    from reportlab.lib.utils import ImageReader

    GAP = 6 * mm
    cell_w = (ancho - 2 * m - GAP) / 2
    cell_h = 45 * mm
    RESERVA_PIE = 24 * mm          # aire para que el pie no toque la última fila

    def nueva_pagina():
        c.showPage()
        return alto - m

    # Encabezado de sección; si no cabe ni el título con una fila, salta antes.
    if y - (6 * mm + cell_h) < m + RESERVA_PIE:
        y = nueva_pagina()
    c.setFillColor(acento)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(m, y, 'FOTOS')
    y -= 6 * mm

    for idx in range(0, len(fotos), 2):
        if y - cell_h < m + RESERVA_PIE:
            y = nueva_pagina()
        for col, foto in enumerate(fotos[idx:idx + 2]):
            try:
                img = ImageReader(foto.imagen.path)
                iw, ih = img.getSize()
            except Exception:
                continue           # una foto ilegible no debe tumbar el PDF
            escala = min(cell_w / iw, cell_h / ih)
            w, h = iw * escala, ih * escala
            x0 = m + col * (cell_w + GAP)
            c.drawImage(img, x0 + (cell_w - w) / 2, y - h, width=w, height=h,
                        preserveAspectRatio=True, anchor='n')
        y -= cell_h + 4 * mm
    return y


def render_cotizacion_pdf(cot) -> bytes:
    """Devuelve los bytes del PDF de una Cotizacion."""
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    acento = ACENTO_TIPO.get(cot.tipo, ORO)     # naranja venta · azul renta
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 15 * mm
    y = alto - m

    # ── Encabezado ──
    # Marca REMALI: cuadro oscuro redondeado con la R en blanco. La carta HTML
    # usa el SVG exacto; aquí, sin dependencias, va esta marca equivalente.
    lg = 11 * mm
    ly = y - 3.5 * mm
    c.setFillColor(acento)
    c.roundRect(m, ly, lg, lg, 2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', 14)
    c.drawCentredString(m + lg / 2, ly + lg / 2 - 5, 'R')

    c.setFillColor(acento)
    c.setFont('Helvetica-Bold', 18)
    c.drawString(m + lg + 4 * mm, y, cfg.negocio_nombre or 'REMALI')
    c.setFont('Helvetica-Bold', 15)
    c.drawRightString(ancho - m, y, 'COTIZACIÓN')
    y -= 6 * mm

    c.setFillColor(GRIS)
    c.setFont('Helvetica', 8.5)
    contacto = '   ·   '.join(x for x in (
        f'Tel. {cfg.negocio_telefono}' if cfg.negocio_telefono else '',
        cfg.negocio_email, cfg.negocio_web,
    ) if x)
    for dato in (
        cfg.negocio_direccion,
        contacto,
        f'RFC: {cfg.negocio_rfc}' if cfg.negocio_rfc else '',
    ):
        if dato:
            c.drawString(m, y, str(dato))
            y -= 4.2 * mm
    if (cfg.negocio_representante or '').strip():
        c.setFillColor(TINTA); c.setFont('Helvetica-Bold', 8.5)
        c.drawString(m, y, cfg.negocio_representante.strip())
        y -= 4.2 * mm
    c.setFillColor(acento)
    c.setFont('Helvetica-Bold', 11)
    c.drawRightString(ancho - m, alto - m - 6 * mm, cot.folio or '')

    y -= 3 * mm
    c.setStrokeColor(LINEA)
    c.line(m, y, ancho - m, y)
    y -= 6 * mm

    # ── Cliente y datos ──
    col2 = ancho / 2 + 5 * mm
    y_ini = y
    c.setFillColor(acento); c.setFont('Helvetica-Bold', 8)
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
        ('Precios con IVA incluido' if cot.tipo == 'venta'
         else ('Precios más IVA (16%)' if cot.aplica_iva else 'Precios sin IVA')),
    ]
    c.setFont('Helvetica', 9)
    yi = y
    for linea in [x for x in izquierda if x]:
        c.setFillColor(TINTA)
        c.drawString(m, yi, _recortar(c, linea, 'Helvetica', 9, ancho / 2 - m - 8 * mm))
        yi -= 4.3 * mm
    yd = y
    for linea in derecha:
        c.setFillColor(GRIS)
        c.drawString(col2, yd, str(linea))
        yd -= 4.3 * mm
    y = min(yi, yd) - 4 * mm
    del y_ini

    # ── Partidas ──
    c.setFillColor(acento); c.setFont('Helvetica-Bold', 8)
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
        # En renta la cantidad se lee "máquinas×periodos" (2×4) para que el
        # importe (precio × máquinas × periodos) cuadre a la vista.
        cant_txt = str(it.cantidad)
        if it.modalidad in ('dia', 'semana', 'mes') and (it.duracion or 1) > 1:
            cant_txt = f'{it.cantidad}×{it.duracion}'
        c.drawRightString(x_cant, y, cant_txt)
        c.drawRightString(x_pu, y, _money(it.precio_unitario))
        c.drawRightString(x_imp, y, _money(it.subtotal))
        y -= 5.0 * mm

    y -= 2 * mm
    c.setStrokeColor(LINEA); c.line(ancho / 2, y, ancho - m, y)
    y -= 5 * mm

    # ── Totales ──
    def total(label, valor, fuerte=False):
        nonlocal y
        c.setFont('Helvetica-Bold' if fuerte else 'Helvetica', 11 if fuerte else 9)
        c.setFillColor(TINTA if fuerte else GRIS)
        c.drawRightString(ancho - m - 32 * mm, y, label)
        c.setFillColor(TINTA)
        c.drawRightString(ancho - m, y, _money(valor))
        y -= 5.4 * mm

    total('Subtotal', cot.base)
    if cot.iva:
        total('IVA (16%)', cot.iva)
    total('Total', cot.total, fuerte=True)
    # Contado (solo venta): el MAYOR descuento entre la promo y el 5% de contado,
    # SIN apilarlos. Solo se muestra si de verdad baja el precio (si la promo ya
    # supera el 5%, no hay descuento extra por pagar de contado).
    if cot.tipo != 'renta':
        contado = cot.total_contado
        if contado < cot.total:
            total('Precio de contado', float(contado))

    # ── Fotos (van a media hoja, no al final) ──
    y = _dibujar_fotos(c, cot, ancho, alto, m, y, acento)

    # ── Datos para depósito ──
    y = _dibujar_datos_bancarios(c, cfg, ancho, alto, m, y, acento)

    # ── Despedida ──
    cierre = (cfg.cotizacion_cierre or '').strip()
    if cierre:
        lineas = _wrap(cierre, 'Helvetica-Oblique', 9, ancho - 2 * m)
        if y - (len(lineas) * 4.6 * mm + 4 * mm) < m + 26 * mm:
            c.showPage()
            y = alto - m
        y -= 4 * mm
        c.setFillColor(TINTA); c.setFont('Helvetica-Oblique', 9)
        for ln in lineas:
            c.drawString(m, y, ln)
            y -= 4.6 * mm

    # ── Condiciones (letra chica, junto al pie) ──
    y = _dibujar_condiciones_fina(c, cfg, cot.tipo, ancho, alto, m, y)

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
