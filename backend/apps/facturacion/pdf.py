"""La representación impresa del CFDI, tamaño carta.

El documento fiscal es el XML. Esto es su representación impresa: su diseño es
libre mientras lleve los datos obligatorios, así que aquí la factura se ve como
un documento de REMALI y no como la salida genérica de un PAC.

REGLA DURA DE ESTE MÓDULO: lo fiscal se TRANSCRIBE, nunca se calcula. El
subtotal, el IVA, el total y los conceptos se copian de lo que quedó guardado
del XML. Ni una división entre 1.16 aquí dentro. REMALI tiene su propia lógica
de IVA (venta con IVA incluido que se desglosa, renta que lo suma si hay
factura) y esa lógica NO toca este documento: si el PDF y el XML dijeran cifras
distintas, el equivocado sería el PDF, y sería un PDF que el negocio le mandó al
cliente con su logo encima.

Sobre el color: los otros documentos de la casa se distinguen por acento (azul
la venta, naranja la renta, dorado el mantenimiento). La factura no es ninguno
de esos: es el registro fiscal de uno. Por eso va en tinta, el documento más
sobrio de la familia, y el dorado se reserva para las dos cifras que de verdad
se buscan al abrirla: el folio y el total.
"""
import logging
from decimal import Decimal
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from server.documentos import dibujar_logo, fuentes

from .letras import importe_con_letra

GRIS = colors.HexColor('#6B7280')
TINTA = colors.HexColor('#111827')
LINEA = colors.HexColor('#E5E7EB')
ORO = colors.HexColor('#B8872E')
PAPEL = colors.HexColor('#FAFAF9')      # panel cálido, no gris azulado
ORO_SUAVE = colors.HexColor('#FBF6EA')
ROJO = colors.HexColor('#B91C1C')

logger = logging.getLogger(__name__)

# La letra de la casa. Los sellos y la cadena original se quedan en Courier a
# propósito: son cadenas base64 de máquina, y el ancho fijo las hace legibles
# de un vistazo y las separa de lo que el cliente sí lee.
TEXTO, MEDIA, FUERTE, ITALICA = fuentes()

#: A dónde apunta el QR para verificar el comprobante en el portal del SAT.
VERIFICADOR_SAT = 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx'

#: Etiquetas de las claves del SAT que más se usan, para no imprimir solo el
#: número. El cliente lee "PUE" y no sabe qué es; "PUE · Pago en una exhibición"
#: sí se entiende. Lo que no esté aquí se imprime tal cual.
FORMA_PAGO = {
    '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia',
    '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '99': 'Por definir',
}
METODO_PAGO = {'PUE': 'Pago en una exhibición', 'PPD': 'Pago en parcialidades o diferido'}


def _money(v):
    return f'${Decimal(str(v or 0)):,.2f}'


def _recortar(c, texto, fuente, tam, ancho):
    """Corta con puntos suspensivos lo que no cabe en `ancho`."""
    texto = str(texto or '')
    if stringWidth(texto, fuente, tam) <= ancho:
        return texto
    while texto and stringWidth(texto + '…', fuente, tam) > ancho:
        texto = texto[:-1]
    return texto + '…'


def _wrap(texto, fuente, tam, ancho):
    """Parte un texto en renglones que quepan en `ancho`.

    Corta también DENTRO de una palabra: los sellos y la cadena original son
    cadenas base64 de cientos de caracteres sin un solo espacio, y un wrap por
    palabras las dejaría saliéndose de la hoja.
    """
    texto = str(texto or '')
    if not texto:
        return []
    renglones, actual = [], ''
    for ch in texto:
        if stringWidth(actual + ch, fuente, tam) > ancho:
            renglones.append(actual)
            actual = ch
        else:
            actual += ch
    if actual:
        renglones.append(actual)
    return renglones


def _clave(mapa, valor):
    """'03' -> '03 · Transferencia'. Sin etiqueta conocida, solo la clave."""
    valor = (valor or '').strip()
    if not valor:
        return '—'
    etiqueta = mapa.get(valor)
    return f'{valor} · {etiqueta}' if etiqueta else valor


def _fecha_corta(iso):
    """'2026-08-22T10:15:30' -> '22/08/2026 10:15'. El texto viene del XML."""
    s = (iso or '').strip()
    if len(s) < 10:
        return s or '—'
    dia = f'{s[8:10]}/{s[5:7]}/{s[0:4]}'
    return f'{dia} {s[11:16]}' if len(s) >= 16 else dia


def _liga_sat(f):
    """La liga que codifica el QR para verificar el CFDI en el portal del SAT."""
    sello = (f.sello_cfd or '')[-8:]
    return (
        f'{VERIFICADOR_SAT}?id={f.uuid}&re={f.rfc_emisor}&rr={f.rfc_receptor}'
        f'&tt={Decimal(str(f.total or 0)):.6f}&fe={sello}'
    )


def _qr_reader(texto):
    """ImageReader con el QR, o None si la librería no está disponible."""
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader
    except Exception:
        return None
    try:
        img = qrcode.make(texto)
        buf = BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        return ImageReader(buf)
    except Exception:
        return None


def _conceptos_del_xml(factura):
    """Los conceptos, releídos del XML guardado.

    Se releen en vez de guardarse en columnas porque el XML es la verdad y esto
    se genera una vez cada tanto: parsear 10 KB en el momento cuesta menos que
    mantener sincronizada una tabla que nadie más consulta.
    """
    try:
        from .cfdi import leer_cfdi
        return leer_cfdi(factura.xml).get('conceptos') or []
    except Exception:
        return []


def _unidades_de_remali(factura):
    """Código y número de serie de las máquinas de la venta que originó la factura.

    Es lo único que la factura del PAC no puede saber y que al cliente le sirve
    para amarrar el papel con el fierro que recibió. Si no se puede resolver, se
    omite: no se inventa.
    """
    venta = getattr(factura.solicitud, 'venta', None)
    if venta is None:
        return []
    try:
        filas = []
        # El código y el serie viven en la UNIDAD, no en el renglón de la venta.
        for renglon in venta.maquinas.select_related('inventario'):
            unidad = renglon.inventario
            if unidad is None:
                continue
            etiqueta = unidad.codigo or ''
            if unidad.numero_serie:
                etiqueta = f'{etiqueta} · S/N {unidad.numero_serie}'
            etiqueta = etiqueta.strip(' ·')
            if etiqueta:
                filas.append(etiqueta)
        return filas
    except Exception:
        # Esto es decoración: que falte no puede dejar al cliente sin factura.
        # Pero tampoco desaparece en silencio, o un error de código se ve igual
        # que una venta sin unidades.
        logger.exception('No se pudieron leer las unidades de la factura %s', factura.pk)
        return []


def render_factura_pdf(factura) -> bytes:
    """Devuelve los bytes de la representación impresa de un CFDI."""
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 15 * mm
    util = ancho - 2 * m
    y = alto - m

    # ── Encabezado ────────────────────────────────────────────────────────
    # Una banda dorada delgada arriba de todo: es la firma visual del
    # documento y lo primero que distingue esta factura de la de cualquiera.
    c.setFillColor(ORO)
    c.rect(0, alto - 4 * mm, ancho, 4 * mm, stroke=0, fill=1)

    lg = 11 * mm
    dibujar_logo(c, m, y - 3.5 * mm, lg, respaldo=TINTA)

    c.setFillColor(TINTA)
    c.setFont(FUERTE, 17)
    c.drawString(m + lg + 4 * mm, y, cfg.negocio_nombre or 'REMALI')

    # "FACTURA" con las letras separadas: a ese tamaño el espaciado hace que
    # se lea como un rótulo y no como una palabra más.
    titulo, tam = 'F A C T U R A', 15
    c.setFont(FUERTE, tam)
    c.drawRightString(ancho - m, y, titulo)
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 7.5)
    c.drawRightString(ancho - m, y - 4.6 * mm, 'Comprobante Fiscal Digital por Internet · CFDI 4.0')

    # El folio, donde se pidió: pegado al rótulo, en dorado y grande. Es el
    # dato que se busca al abrir el papel, junto con el total.
    serie_folio = f'{factura.serie or ""}{factura.folio or ""}'.strip()
    if serie_folio:
        c.setFillColor(ORO)
        c.setFont(FUERTE, 20)
        c.drawRightString(ancho - m, y - 12.5 * mm, serie_folio)
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 7.5)
    c.drawRightString(ancho - m, y - 17 * mm, f'Timbrada el {_fecha_corta(factura.fecha_certificacion)}')

    # Datos fiscales del emisor, bajo el nombre.
    y -= 6 * mm
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 8)
    izq = m + lg + 4 * mm
    for dato in (
        f'RFC {factura.rfc_emisor}' if factura.rfc_emisor else '',
        f'Régimen fiscal {factura.regimen_emisor}' if factura.regimen_emisor else '',
        cfg.negocio_direccion,
        '   ·   '.join(x for x in (
            f'Tel. {cfg.negocio_telefono}' if cfg.negocio_telefono else '', cfg.negocio_email,
        ) if x),
        f'Lugar de expedición {factura.lugar_expedicion}' if factura.lugar_expedicion else '',
    ):
        if dato:
            c.drawString(izq, y, _recortar(c, dato, TEXTO, 8, util * 0.58))
            y -= 4 * mm

    y = min(y, alto - m - 22 * mm) - 3 * mm
    c.setStrokeColor(TINTA)
    c.setLineWidth(1)
    c.line(m, y, ancho - m, y)
    c.setLineWidth(0.5)
    y -= 7 * mm

    # ── Receptor y origen ────────────────────────────────────────────────
    # Dos columnas que dicen cosas distintas a propósito: a la izquierda lo
    # fiscal (a quién se le factura), a la derecha lo de REMALI (de qué venta
    # salió). Separadas para que nadie confunda un dato interno con uno del SAT.
    col2 = m + util * 0.56
    y_ini = y
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 7.5)
    c.drawString(m, y, 'F A C T U R A R   A')
    c.drawString(col2, y, 'O R I G E N   E N   R E M A L I')
    y -= 5 * mm

    c.setFillColor(TINTA)
    c.setFont(FUERTE, 10.5)
    c.drawString(m, y, _recortar(c, factura.nombre_receptor or '—', FUERTE, 10.5, util * 0.52))
    y_recep = y - 4.6 * mm
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 8)
    for dato in (
        f'RFC {factura.rfc_receptor}' if factura.rfc_receptor else '',
        f'C.P. {factura.cp_receptor}' if factura.cp_receptor else '',
        f'Régimen fiscal {factura.regimen_receptor}' if factura.regimen_receptor else '',
        f'Uso del CFDI {factura.uso_cfdi}' if factura.uso_cfdi else '',
    ):
        if dato:
            c.drawString(m, y_recep, dato)
            y_recep -= 4 * mm

    y_orig = y
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 10.5)
    c.drawString(col2, y_orig, factura.solicitud.folio_origen)
    y_orig -= 4.6 * mm
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 8)
    for dato in _unidades_de_remali(factura)[:4]:
        c.drawString(col2, y_orig, _recortar(c, dato, TEXTO, 8, util * 0.42))
        y_orig -= 4 * mm

    y = min(y_recep, y_orig) - 3 * mm
    c.setStrokeColor(LINEA)
    c.line(m, y, ancho - m, y)
    y -= 7 * mm

    # ── Conceptos ─────────────────────────────────────────────────────────
    # Encabezado en negativo (banda de tinta con texto blanco): ancla la tabla
    # y evita tener que dibujar rejilla, que ensucia.
    fila_alto = 5.6 * mm
    c.setFillColor(TINTA)
    c.rect(m, y - 1.5 * mm, util, 6.5 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(FUERTE, 7.5)
    x_cant, x_desc = m + 3 * mm, m + 20 * mm
    x_unit, x_imp = ancho - m - 52 * mm, ancho - m - 3 * mm
    c.drawString(x_cant, y, 'CANT.')
    c.drawString(x_desc, y, 'DESCRIPCIÓN')
    c.drawRightString(x_unit + 26 * mm, y, 'P. UNITARIO')
    c.drawRightString(x_imp, y, 'IMPORTE')
    y -= 8.5 * mm

    # La tabla ocupa una REGIÓN FIJA, no lo que le toque según cuántos renglones
    # traiga. Con un solo concepto el documento quedaba apretado arriba y con
    # media carta en blanco; con la región fija, una factura de un concepto y
    # una de diez se leen igual de compuestas. Lo que no quepa se corta: el
    # detalle completo vive en el XML, que es el documento de verdad.
    PISO_TABLA = 122 * mm

    conceptos = _conceptos_del_xml(factura)
    unidades = _unidades_de_remali(factura)
    ancho_desc = x_unit - x_desc - 6 * mm
    for i, con in enumerate(conceptos):
        if y < PISO_TABLA + fila_alto:
            break
        if i % 2:            # cebra apenas perceptible, para seguir el renglón
            c.setFillColor(PAPEL)
            c.rect(m, y - 1.8 * mm, util, fila_alto, stroke=0, fill=1)
        c.setFillColor(TINTA)
        c.setFont(TEXTO, 9)
        cant = con.get('cantidad') or 0
        cant_txt = f'{cant:g}' if isinstance(cant, (int, float, Decimal)) else str(cant)
        c.drawString(x_cant, y, cant_txt)
        c.drawString(x_desc, y, _recortar(c, con.get('descripcion'), TEXTO, 9, ancho_desc))
        c.drawRightString(x_unit + 26 * mm, y, _money(con.get('valor_unitario')))
        c.drawRightString(x_imp, y, _money(con.get('importe')))
        y -= fila_alto

        # La unidad de REMALI cuelga del concepto, en dorado y más chica: se lee
        # como anotación de la casa, no como contenido del CFDI.
        if i < len(unidades):
            c.setFillColor(ORO)
            c.setFont(TEXTO, 7.5)
            c.drawString(x_desc + 3 * mm, y + 0.8 * mm, f'↳ {unidades[i]}')
            y -= 4.2 * mm

    # Se sigue la cebra hasta el piso, sin texto: la tabla se lee como un
    # contenedor y no como cuatro renglones flotando en la hoja.
    fila = len(conceptos)
    while y > PISO_TABLA + fila_alto:
        if fila % 2:
            c.setFillColor(PAPEL)
            c.rect(m, y - 1.8 * mm, util, fila_alto, stroke=0, fill=1)
        y -= fila_alto
        fila += 1

    y = PISO_TABLA
    c.setStrokeColor(LINEA)
    c.line(m, y, ancho - m, y)
    y -= 8 * mm

    # ── Importe con letra y totales ───────────────────────────────────────
    # La cantidad con letra ocupa su propia caja a la izquierda, a la altura de
    # los totales: es la lectura en palabras de la cifra que está enfrente.
    ancho_letra = util * 0.55
    alto_letra = 14 * mm
    c.setFillColor(PAPEL)
    c.setStrokeColor(LINEA)
    c.rect(m, y - alto_letra + 5 * mm, ancho_letra, alto_letra, stroke=1, fill=1)
    c.setFillColor(GRIS)
    c.setFont(FUERTE, 6.5)
    c.drawString(m + 3 * mm, y + 1.5 * mm, 'I M P O R T E   C O N   L E T R A')
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 8.5)
    letra = importe_con_letra(factura.total, factura.moneda or 'MXN')
    renglones = _wrap(letra, FUERTE, 8.5, ancho_letra - 6 * mm)[:2]
    yl = y - 3.5 * mm
    for r in renglones:
        c.drawString(m + 3 * mm, yl, r)
        yl -= 4 * mm

    x_lbl, x_val = ancho - m - 52 * mm, ancho - m - 3 * mm
    yt = y + 2 * mm
    c.setFont(TEXTO, 9)
    filas = [('Subtotal', factura.subtotal)]
    if Decimal(str(factura.descuento or 0)) > 0:
        filas.append(('Descuento', factura.descuento))
    filas.append(('IVA trasladado', factura.iva))
    for etiqueta, valor in filas:
        c.setFillColor(GRIS)
        c.drawString(x_lbl, yt, etiqueta)
        c.setFillColor(TINTA)
        c.drawRightString(x_val, yt, _money(valor))
        yt -= 5 * mm

    # El total en caja dorada: es la otra cifra que se busca al abrir el papel.
    # El respiro de antes NO es decorativo: sin él la caja se dibuja encima del
    # último renglón y tapa el IVA. Se vio en la primera prueba impresa.
    yt -= 2.5 * mm
    caja_alto = 9.5 * mm
    c.setFillColor(ORO_SUAVE)
    c.setStrokeColor(ORO)
    c.rect(x_lbl - 3 * mm, yt - 2.5 * mm, (x_val + 3 * mm) - (x_lbl - 3 * mm), caja_alto, stroke=1, fill=1)
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 8)
    c.drawString(x_lbl, yt, f'TOTAL {factura.moneda or "MXN"}')
    c.setFont(FUERTE, 12)
    c.drawRightString(x_val, yt - 0.5 * mm, _money(factura.total))

    y = min(y - alto_letra + 2 * mm, yt - 8 * mm)

    # ── Pago ──────────────────────────────────────────────────────────────
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 8)
    pago = '        '.join(x for x in (
        f'Forma de pago: {_clave(FORMA_PAGO, factura.forma_pago)}',
        f'Método: {_clave(METODO_PAGO, factura.metodo_pago)}',
        f'Tipo: {factura.tipo_comprobante or "—"}',
    ) if x)
    c.drawString(m, y, _recortar(c, pago, TEXTO, 8, util))
    y -= 7 * mm

    # ── Bloque de validación fiscal ───────────────────────────────────────
    # Todo lo que el SAT pide para verificar, en un panel aparte y en mono: es
    # dato de máquina, y separarlo evita que compita con lo que el cliente lee.
    #
    # Va anclado al PIE de la hoja y no a donde terminó el contenido. Con una
    # factura de un solo concepto, seguir el flujo dejaba el documento apretado
    # arriba y media carta en blanco abajo; anclado, la hoja se lee compuesta
    # lleve un concepto o lleve diez.
    panel_alto = 62 * mm
    panel_y = m
    if y - 6 * mm < panel_y + panel_alto:      # contenido largo: se cede el ancla
        panel_alto = max(52 * mm, y - 6 * mm - m)
        panel_y = m
    c.setFillColor(PAPEL)
    c.setStrokeColor(LINEA)
    c.rect(m, panel_y, util, panel_alto, stroke=1, fill=1)

    qr_lado = 30 * mm
    qr = _qr_reader(_liga_sat(factura))
    if qr is not None:
        c.drawImage(qr, m + 4 * mm, panel_y + panel_alto - qr_lado - 4 * mm,
                    qr_lado, qr_lado, mask='auto')

    xd = m + qr_lado + 10 * mm
    ancho_dato = ancho - m - xd - 4 * mm
    yd = panel_y + panel_alto - 6 * mm

    c.setFillColor(TINTA)
    c.setFont(FUERTE, 6.5)
    c.drawString(xd, yd, 'F O L I O   F I S C A L   ( U U I D )')
    yd -= 4.2 * mm
    c.setFont('Courier-Bold', 8.5)
    c.drawString(xd, yd, factura.uuid or '—')
    yd -= 5.5 * mm

    def bloque(etiqueta, valor, tam=5.2, maximo=3):
        nonlocal yd
        if not valor:
            return
        c.setFillColor(GRIS)
        c.setFont(FUERTE, 6)
        c.drawString(xd, yd, etiqueta)
        yd -= 3.2 * mm
        c.setFillColor(TINTA)
        c.setFont('Courier', tam)
        for r in _wrap(valor, 'Courier', tam, ancho_dato)[:maximo]:
            c.drawString(xd, yd, r)
            yd -= 2.6 * mm
        yd -= 1.4 * mm

    bloque('CERTIFICADO DEL EMISOR / DEL SAT',
           f'{factura.no_certificado_emisor or "—"}   ·   {factura.no_certificado_sat or "—"}',
           tam=6, maximo=1)
    bloque('SELLO DIGITAL DEL CFDI', factura.sello_cfd)
    bloque('SELLO DEL SAT', factura.sello_sat)
    bloque('CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACIÓN DIGITAL DEL SAT',
           factura.cadena_original, maximo=4)

    c.setFillColor(GRIS)
    c.setFont(ITALICA, 7)
    c.drawString(m + 4 * mm, panel_y + 3.5 * mm,
                 'Este documento es una representación impresa de un CFDI')

    # ── Cancelada ─────────────────────────────────────────────────────────
    # Al final para que quede encima de todo: una factura cancelada que se ve
    # normal es peor que no tener el papel.
    if factura.estado == 'cancelada':
        c.saveState()
        c.setFillColor(colors.Color(ROJO.red, ROJO.green, ROJO.blue, alpha=0.16))
        c.translate(ancho / 2, alto / 2)
        c.rotate(32)
        c.setFont(FUERTE, 78)
        c.drawCentredString(0, 0, 'CANCELADA')
        c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()
