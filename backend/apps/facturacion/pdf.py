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
METODO_PAGO = {'PUE': 'Pago en una sola exhibición', 'PPD': 'Pago en parcialidades o diferido'}
TIPO_COMPROBANTE = {'I': 'Ingreso', 'E': 'Egreso', 'T': 'Traslado', 'N': 'Nómina', 'P': 'Pago'}
EXPORTACION = {'01': 'No aplica', '02': 'Definitiva', '03': 'Temporal', '04': 'Definitiva con clave distinta'}


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
    """La liga que codifica el QR para verificar el CFDI en el portal del SAT.

    El `tt` va TAL CUAL, sin relleno de ceros. El formato con ceros a la
    izquierda y seis decimales (`tt=0000001234.567800`) es el de CFDI 3.2 y
    sigue circulando en ejemplos viejos; 3.3 y 4.0 usan el total a secas
    (`tt=2010.01`). Ponerle el relleno del formato viejo a un CFDI 4.0 hace que
    el verificador del SAT no case el comprobante, y eso solo se descubre
    cuando el contador del cliente escanea el papel.

    `fe` son los ÚLTIMOS ocho caracteres del sello del emisor, y puede traer
    `/` y `=`: van sin escapar, que es como los espera el verificador.
    """
    sello = (f.sello_cfd or '')[-8:]
    # str() de un Decimal de 2 posiciones da '2000.00', que es la forma en que
    # el CFDI escribe el total en el caso normal.
    total = Decimal(str(f.total or 0))
    return (
        f'{VERIFICADOR_SAT}?id={f.uuid}&re={f.rfc_emisor}&rr={f.rfc_receptor}'
        f'&tt={total}&fe={sello}'
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


def _leer_xml(factura):
    """Lo que solo vive en el XML: conceptos, claves del SAT y exportación.

    Se relee en vez de guardarse en columnas porque el XML es la verdad y esto
    se genera una vez cada tanto: parsear 10 KB en el momento cuesta menos que
    mantener sincronizada una tabla que nadie más consulta.

    Si el XML no se puede leer, el documento sale igual con lo que sí está en
    las columnas: media factura es mejor que ninguna.
    """
    try:
        from .cfdi import leer_cfdi
        return leer_cfdi(factura.xml)
    except Exception:
        logger.warning('No se pudo releer el XML de la factura %s', factura.pk)
        return {}


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


def _acento(cfg):
    """El color de la factura: el que se capturó en Configuración, o el dorado.

    Un hex mal escrito NO puede dejar a un cliente sin su factura, así que
    cualquier cosa que reportlab no entienda cae al dorado de la casa.
    """
    valor = (getattr(cfg, 'factura_color', '') or '').strip()
    if not valor:
        return ORO
    try:
        return colors.HexColor(valor)
    except Exception:
        logger.warning('factura_color inválido (%r); se usa el dorado', valor)
        return ORO


def _chip(c, x, y, texto, ancho, acento, alto=6.2 * mm):
    """Etiqueta de sección: rectángulo oscuro con el texto en blanco."""
    c.setFillColor(TINTA)
    c.roundRect(x, y, ancho, alto, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(FUERTE, 7.5)
    c.drawString(x + 3.5 * mm, y + 2 * mm, texto)


def _tarjeta(c, x, y, ancho, alto):
    c.setFillColor(colors.white)
    c.setStrokeColor(LINEA)
    c.roundRect(x, y, ancho, alto, 2 * mm, stroke=1, fill=1)


def render_factura_pdf(factura) -> bytes:
    """Devuelve los bytes de la representación impresa de un CFDI."""
    from maquinaria.models import ConfiguracionSitio

    cfg = ConfiguracionSitio.get_solo()
    acento = _acento(cfg)
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    ancho, alto = letter
    m = 14 * mm
    util = ancho - 2 * m
    datos_xml = _leer_xml(factura)
    conceptos = datos_xml.get('conceptos') or []
    unidades = _unidades_de_remali(factura)

    # ── Banda superior ────────────────────────────────────────────────────
    c.setFillColor(acento)
    c.rect(0, alto - 4 * mm, ancho, 4 * mm, stroke=0, fill=1)

    y = alto - m - 4 * mm

    # Logo + emisor a la izquierda, rótulo y folio a la derecha.
    lg = 14 * mm
    dibujar_logo(c, m, y - lg + 3 * mm, lg, respaldo=TINTA)
    xi = m + lg + 4 * mm
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 13)
    c.drawString(xi, y - 1 * mm, (factura.nombre_emisor or cfg.negocio_nombre or 'REMALI').upper())
    c.setFont(TEXTO, 8)
    c.setFillColor(GRIS)
    yl = y - 6 * mm
    for etiqueta, valor in (
        ('RFC:', factura.rfc_emisor),
        ('Régimen Fiscal:', factura.regimen_emisor),
        ('', cfg.negocio_direccion),
        ('Tel.', cfg.negocio_telefono),
    ):
        if not valor:
            continue
        txt = f'{etiqueta} {valor}'.strip()
        c.drawString(xi, yl, _recortar(c, txt, TEXTO, 8, util * 0.46))
        yl -= 4 * mm

    # Rótulo del documento.
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 15)
    c.drawRightString(ancho - m, y - 1 * mm, 'FACTURA ELECTRÓNICA')
    c.setFillColor(GRIS)
    c.setFont(TEXTO, 9)
    c.drawRightString(ancho - m, y - 6.5 * mm, '(CFDI 4.0)')

    # Insignia del folio: la caja oscura de la referencia.
    caja_ancho, caja_alto = util * 0.34, 13 * mm
    caja_x, caja_y = ancho - m - caja_ancho, y - 23 * mm
    c.setFillColor(TINTA)
    c.roundRect(caja_x, caja_y, caja_ancho, caja_alto, 2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.65))
    c.setFont(FUERTE, 6.5)
    c.drawString(caja_x + 5 * mm, caja_y + caja_alto - 5 * mm, 'FOLIO')
    c.setFillColor(colors.white)
    c.setFont(FUERTE, 13)
    serie_folio = f'{factura.serie or ""} {factura.folio or ""}'.strip() or '—'
    c.drawString(caja_x + 5 * mm, caja_y + 2.6 * mm, serie_folio)

    # ── Columna derecha de datos fiscales ────────────────────────────────
    yd = caja_y - 6 * mm
    for etiqueta, valor in (
        ('UUID', factura.uuid),
        ('FECHA Y HORA DE EMISIÓN', _fecha_corta(factura.fecha_emision)),
        ('LUGAR DE EXPEDICIÓN', factura.lugar_expedicion),
        ('TIPO DE COMPROBANTE', _clave(TIPO_COMPROBANTE, factura.tipo_comprobante)),
        ('EXPORTACIÓN', _clave(EXPORTACION, datos_xml.get('exportacion'))),
    ):
        if not valor:
            continue
        c.setFillColor(acento)
        c.setFont(FUERTE, 6.5)
        c.drawString(caja_x, yd, etiqueta)
        c.setFillColor(TINTA)
        c.setFont(TEXTO if etiqueta != 'UUID' else 'Courier', 8 if etiqueta != 'UUID' else 7.5)
        c.drawString(caja_x, yd - 4 * mm, _recortar(c, valor, TEXTO, 8, caja_ancho))
        yd -= 9.5 * mm

    # ── Tarjetas de emisor y receptor ────────────────────────────────────
    ancho_izq = util * 0.60
    y_tar = y - 30 * mm
    for titulo, filas in (
        ('EMISOR', (
            (factura.nombre_emisor or cfg.negocio_nombre or '', True),
            (f'RFC: {factura.rfc_emisor}' if factura.rfc_emisor else '', False),
            (f'Régimen Fiscal: {factura.regimen_emisor}' if factura.regimen_emisor else '', False),
        )),
        ('RECEPTOR', (
            (factura.nombre_receptor or '', True),
            (f'RFC: {factura.rfc_receptor}' if factura.rfc_receptor else '', False),
            (f'Régimen Fiscal: {factura.regimen_receptor}' if factura.regimen_receptor else '', False),
            (f'Domicilio Fiscal: {factura.cp_receptor}' if factura.cp_receptor else '', False),
            (f'Uso CFDI: {factura.uso_cfdi}' if factura.uso_cfdi else '', False),
        )),
    ):
        visibles = [f for f in filas if f[0]]
        alto_tar = 7 * mm + len(visibles) * 4.4 * mm
        _tarjeta(c, m, y_tar - alto_tar, ancho_izq, alto_tar)
        _chip(c, m, y_tar - 3.1 * mm, titulo, 26 * mm, acento)
        yt2 = y_tar - 9 * mm
        for texto, fuerte in visibles:
            c.setFillColor(TINTA if fuerte else GRIS)
            c.setFont(FUERTE if fuerte else TEXTO, 9 if fuerte else 8)
            c.drawString(m + 4 * mm, yt2, _recortar(c, texto, TEXTO, 8.5, ancho_izq - 8 * mm))
            yt2 -= 4.4 * mm
        y_tar -= alto_tar + 8 * mm

    y = min(y_tar, yd) - 2 * mm

    # ── Conceptos ─────────────────────────────────────────────────────────
    c.setFillColor(TINTA)
    c.rect(m, y - 1.5 * mm, util, 7 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(FUERTE, 6.8)
    x_cant = m + 3 * mm
    x_clave = m + 16 * mm
    x_desc = m + 40 * mm
    x_unit = ancho - m - 52 * mm
    x_imp = ancho - m - 3 * mm
    c.drawString(x_cant, y + 0.4 * mm, 'CANT.')
    c.drawString(x_clave, y + 0.4 * mm, 'CLAVE SAT')
    c.drawString(x_desc, y + 0.4 * mm, 'DESCRIPCIÓN')
    c.drawRightString(x_unit + 26 * mm, y + 0.4 * mm, 'VALOR UNITARIO')
    c.drawRightString(x_imp, y + 0.4 * mm, 'IMPORTE')
    y -= 9 * mm

    PISO_TABLA = 108 * mm
    ancho_desc = x_unit - x_desc - 6 * mm
    fila = 0
    for i, con in enumerate(conceptos):
        if y < PISO_TABLA + 12 * mm:
            break
        alto_fila = 11 * mm
        if fila % 2:
            c.setFillColor(PAPEL)
            c.rect(m, y - alto_fila + 6 * mm, util, alto_fila, stroke=0, fill=1)
        cant = con.get('cantidad') or 0
        c.setFillColor(TINTA)
        c.setFont(TEXTO, 8.5)
        c.drawString(x_cant, y, f'{cant:g}' if isinstance(cant, (int, float, Decimal)) else str(cant))
        # Clave del producto arriba y la de unidad abajo, como en la referencia:
        # dos claves de catálogo en columnas propias aprietan la descripción.
        c.setFont(FUERTE, 8)
        c.drawString(x_clave, y, con.get('clave_prod_serv') or '—')
        c.setFillColor(GRIS)
        c.setFont(ITALICA, 6.8)
        c.drawString(x_clave, y - 3.6 * mm, f"Unidad {con.get('clave_unidad') or '—'}")
        c.setFillColor(TINTA)
        c.setFont(FUERTE, 8.5)
        c.drawString(x_desc, y, _recortar(c, con.get('descripcion'), FUERTE, 8.5, ancho_desc))
        c.setFont(TEXTO, 9)
        c.drawRightString(x_unit + 26 * mm, y, _money(con.get('valor_unitario')))
        c.drawRightString(x_imp, y, _money(con.get('importe')))
        # Lo de REMALI cuelga del concepto, en el acento: se lee como anotación
        # de la casa y no como contenido del CFDI.
        if i < len(unidades):
            c.setFillColor(acento)
            c.setFont(TEXTO, 7)
            c.drawString(x_desc, y - 3.6 * mm, f'↳ {unidades[i]}')
        y -= alto_fila
        fila += 1

    while y > PISO_TABLA + 6 * mm:
        if fila % 2:
            c.setFillColor(PAPEL)
            c.rect(m, y - 5 * mm, util, 11 * mm, stroke=0, fill=1)
        y -= 11 * mm
        fila += 1

    y = PISO_TABLA + 6 * mm

    # ── Pago (izquierda) y totales (derecha) ─────────────────────────────
    ancho_pago = util * 0.55
    alto_pago = 20 * mm
    _tarjeta(c, m, y - alto_pago, ancho_pago, alto_pago)
    c.setFillColor(acento)
    c.setFont(FUERTE, 6.5)
    c.drawString(m + 4 * mm, y - 5 * mm, 'FORMA DE PAGO')
    c.setFillColor(TINTA)
    c.setFont(TEXTO, 8.5)
    c.drawString(m + 4 * mm, y - 9 * mm, _clave(FORMA_PAGO, factura.forma_pago))
    c.setFillColor(acento)
    c.setFont(FUERTE, 6.5)
    c.drawString(m + 4 * mm, y - 14 * mm, 'MÉTODO DE PAGO')
    c.drawString(m + ancho_pago * 0.58, y - 14 * mm, 'MONEDA')
    c.setFillColor(TINTA)
    c.setFont(TEXTO, 8.5)
    c.drawString(m + 4 * mm, y - 18 * mm, _clave(METODO_PAGO, factura.metodo_pago))
    c.drawString(m + ancho_pago * 0.58, y - 18 * mm, factura.moneda or 'MXN')

    x_lbl = m + ancho_pago + 8 * mm
    x_val = ancho - m - 4 * mm
    yt = y - 4 * mm
    filas_tot = [('SUBTOTAL', factura.subtotal)]
    if Decimal(str(factura.descuento or 0)) > 0:
        filas_tot.append(('DESCUENTO', factura.descuento))
    filas_tot.append(('IVA 16%', factura.iva))
    for etiqueta, valor in filas_tot:
        c.setFillColor(GRIS)
        c.setFont(FUERTE, 7.5)
        c.drawString(x_lbl, yt, etiqueta)
        c.setFillColor(TINTA)
        c.setFont(TEXTO, 9)
        c.drawRightString(x_val, yt, _money(valor))
        yt -= 5.5 * mm

    # El TOTAL en barra de color: es lo que se busca al abrir el papel.
    # El respiro NO es decorativo: sin él la barra se dibuja encima del último
    # renglón y tapa el IVA. Ya pasó dos veces (al escribirlo y al rediseñarlo),
    # por eso hay una prueba que lo cuida.
    yt -= 4 * mm
    barra_alto = 9.5 * mm
    c.setFillColor(acento)
    c.roundRect(x_lbl - 4 * mm, yt - 3 * mm, (x_val + 4 * mm) - (x_lbl - 4 * mm), barra_alto, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(FUERTE, 9)
    c.drawString(x_lbl, yt, 'TOTAL')
    c.setFont(FUERTE, 12)
    c.drawRightString(x_val, yt - 0.6 * mm, _money(factura.total))

    y = min(y - alto_pago, yt - 5 * mm) - 5 * mm

    # ── Total con letra, a todo lo ancho ─────────────────────────────────
    c.setFillColor(PAPEL)
    c.setStrokeColor(LINEA)
    c.rect(m, y - 7 * mm, util, 9 * mm, stroke=1, fill=1)
    c.setFillColor(acento)
    c.setFont(FUERTE, 7.5)
    c.drawString(m + 4 * mm, y - 4 * mm, 'TOTAL CON LETRA')
    c.setFillColor(TINTA)
    c.setFont(FUERTE, 8.5)
    letra = importe_con_letra(factura.total, factura.moneda or 'MXN')
    c.drawString(m + 42 * mm, y - 4 * mm, _recortar(c, letra, FUERTE, 8.5, util - 46 * mm))
    y -= 13 * mm

    # ── Bloque de validación fiscal ──────────────────────────────────────
    panel_alto = y - m - 8 * mm
    panel_y = m + 8 * mm
    c.setFillColor(PAPEL)
    c.setStrokeColor(LINEA)
    c.rect(m, panel_y, util, panel_alto, stroke=1, fill=1)

    qr_lado = min(30 * mm, panel_alto - 6 * mm)
    qr = _qr_reader(_liga_sat(factura))
    if qr is not None:
        c.drawImage(qr, m + 4 * mm, panel_y + panel_alto - qr_lado - 3 * mm,
                    qr_lado, qr_lado, mask='auto')

    xd = m + qr_lado + 9 * mm
    ancho_cert = 46 * mm
    ancho_dato = ancho - m - xd - ancho_cert - 8 * mm
    yd2 = panel_y + panel_alto - 5 * mm

    def bloque(etiqueta, valor, maximo=3, tam=5.2):
        nonlocal yd2
        if not valor:
            return
        c.setFillColor(acento)
        c.setFont(FUERTE, 6)
        c.drawString(xd, yd2, etiqueta)
        yd2 -= 3.2 * mm
        c.setFillColor(TINTA)
        c.setFont('Courier', tam)
        for r in _wrap(valor, 'Courier', tam, ancho_dato)[:maximo]:
            c.drawString(xd, yd2, r)
            yd2 -= 2.5 * mm
        yd2 -= 1.6 * mm

    bloque('SELLO DIGITAL DEL CFDI', factura.sello_cfd)
    bloque('SELLO DIGITAL DEL SAT', factura.sello_sat)
    bloque('CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACIÓN DIGITAL DEL SAT',
           factura.cadena_original, maximo=4)

    # Certificados, a la derecha del panel.
    xc = ancho - m - ancho_cert - 3 * mm
    yc = panel_y + panel_alto - 5 * mm
    for etiqueta, valor in (
        ('CERTIFICADO EMISOR', factura.no_certificado_emisor),
        ('CERTIFICADO SAT', factura.no_certificado_sat),
        ('FECHA Y HORA DE CERTIFICACIÓN', _fecha_corta(factura.fecha_certificacion)),
        ('PROVEEDOR DE CERTIFICACIÓN', factura.rfc_prov_certif),
    ):
        if not valor:
            continue
        c.setFillColor(acento)
        c.setFont(FUERTE, 6)
        c.drawString(xc, yc, etiqueta)
        c.setFillColor(TINTA)
        c.setFont(TEXTO, 7.5)
        c.drawString(xc, yc - 3.4 * mm, _recortar(c, valor, TEXTO, 7.5, ancho_cert))
        yc -= 8.6 * mm

    c.setFillColor(GRIS)
    c.setFont(ITALICA, 6.8)
    c.drawRightString(ancho - m - 3 * mm, panel_y + 3 * mm,
                      'Este documento es una representación impresa de un CFDI 4.0')

    # ── Pie ───────────────────────────────────────────────────────────────
    c.setFillColor(TINTA)
    c.rect(0, 0, ancho, 7 * mm, stroke=0, fill=1)
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.85))
    c.setFont(TEXTO, 7)
    pie = '   ·   '.join(x for x in (cfg.negocio_web, cfg.negocio_email, cfg.negocio_telefono) if x)
    if pie:
        c.drawString(m, 2.5 * mm, pie)
    if (cfg.negocio_footer or '').strip():
        c.drawRightString(ancho - m, 2.5 * mm, cfg.negocio_footer.strip()[:70])

    # ── Cancelada ─────────────────────────────────────────────────────────
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
