"""Piezas que comparten TODOS los documentos impresos: el logo y las imágenes.

Dos cosas que se hacían mal en cada PDF por separado y ahora se hacen aquí:

1. El logo. Cada generador dibujaba un cuadro redondeado con una "R" de
   Helvetica: parecido al logo, pero no el logo. Aquí se pinta el archivo real
   (`server/assets/logo-remali.png`, el mismo trazo que usa la web), igual en
   la cotización, la orden, la ficha y el ticket.

2. Leer una foto. `imagen.path` solo existe cuando los archivos viven en disco;
   en producción están en Cloudinary y esa llamada revienta —y como el intento
   iba dentro de un try, las fotos desaparecían del PDF sin un solo error. El
   archivo se abre por el storage, que sirve para los dos casos.
"""
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from django.conf import settings

LOGO_ARCHIVO = 'logo-remali.png'


def _candidatos():
    base = Path(settings.BASE_DIR)
    return (
        base / 'server' / 'assets' / LOGO_ARCHIVO,      # la copia del backend (la de siempre)
        base / 'staticfiles' / LOGO_ARCHIVO,            # collectstatic
        base.parent / 'frontend' / 'dist' / LOGO_ARCHIVO,
        base.parent / 'frontend' / 'public' / LOGO_ARCHIVO,
    )


@lru_cache(maxsize=1)
def logo_bytes():
    """Bytes del logo, o None si no se encuentra el archivo (entonces hay respaldo)."""
    for ruta in _candidatos():
        try:
            if ruta.is_file():
                return ruta.read_bytes()
        except OSError:
            continue
    return None


def logo_reader():
    """ImageReader del logo listo para `drawImage`, o None si no hay archivo."""
    datos = logo_bytes()
    if not datos:
        return None
    from reportlab.lib.utils import ImageReader
    try:
        return ImageReader(BytesIO(datos))
    except Exception:
        return None


def dibujar_logo(c, x, y, lado, respaldo=None):
    """Pinta el logo en un cuadro de `lado`, con la esquina inferior izquierda en (x, y).

    Si el archivo no estuviera, dibuja el cuadro con la R de antes en el color
    `respaldo` para que el documento nunca salga descabezado.
    """
    img = logo_reader()
    if img is not None:
        try:
            c.drawImage(img, x, y, width=lado, height=lado,
                        preserveAspectRatio=True, anchor='c', mask='auto')
            return
        except Exception:
            pass
    from reportlab.lib import colors
    c.setFillColor(respaldo or colors.HexColor('#111111'))
    c.roundRect(x, y, lado, lado, lado * 0.18, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont('Helvetica-Bold', lado * 0.6)
    c.drawCentredString(x + lado / 2, y + lado * 0.26, 'R')


# Una foto de celular pesa 3–5 MB y en la hoja se imprime a 45 mm: a 300 dpi eso
# son ~530 px de lado. Se reduce antes de incrustarla o el PDF que se manda por
# correo pesa más que el correo.
LADO_MAX = 1200


def lector_imagen(campo):
    """ImageReader de un ImageField, venga de disco o de Cloudinary.

    Además de leerlo, lo deja listo para papel: endereza la foto según su EXIF
    (las del celular vienen acostadas), la aplana sobre blanco y la reduce a un
    tamaño de impresión razonable.

    Devuelve None si la imagen no se puede leer: una foto rota no debe tumbar el
    documento entero, pero tampoco colarse como un hueco sin explicación (quien
    llama decide qué hacer con el None).
    """
    if not campo:
        return None
    from reportlab.lib.utils import ImageReader
    datos = None
    try:
        with campo.open('rb') as fh:
            datos = fh.read()
    except Exception:
        # Último recurso: el archivo en disco, por si el storage no soporta open().
        try:
            with open(campo.path, 'rb') as fh:
                datos = fh.read()
        except Exception:
            return None
    try:
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(BytesIO(datos)))
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
            fondo = Image.new('RGB', img.size, 'white')
            fondo.paste(img, mask=img.split()[-1])
            img = fondo
        else:
            img = img.convert('RGB')
        img.thumbnail((LADO_MAX, LADO_MAX), Image.LANCZOS)
        # Se re-encoda a JPEG: así reportlab la incrusta ya comprimida en vez de
        # meter los píxeles en crudo (un PDF de dos fotos pasa de ~5 MB a ~300 KB).
        chico = BytesIO()
        img.save(chico, format='JPEG', quality=82, optimize=True)
        chico.seek(0)
        return ImageReader(chico)
    except Exception:
        pass
    try:
        return ImageReader(BytesIO(datos))
    except Exception:
        return None


def fecha_larga(dt):
    """Fecha de documento como la lee un cliente: "22 ago 2026, 6:04 p.m.".

    El "22/08/2026 18:04" de antes es correcto y frío; en un ticket que ya se
    lee de reojo, el mes en letra quita la duda entre día y mes. Se traduce con
    el idioma del proyecto (es-mx) y en la hora local, no en UTC.
    """
    from django.utils import formats, timezone

    if dt is None:
        return ''
    if timezone.is_aware(dt):
        dt = timezone.localtime(dt)
    # En minúsculas: el localizador escribe "Ago" y en el ticket el mes es un
    # dato, no un título.
    return formats.date_format(dt, 'd M Y, g:i a').lower()

# ══════════════════════════════════════════════════════════════════════
#  TIPOGRAFÍA
# ══════════════════════════════════════════════════════════════════════
# Los documentos salían en Helvetica —la que reportlab trae de fábrica— mientras
# la pantalla, la tienda y el panel usan Plus Jakarta Sans. Un cliente que ve la
# cotización en el navegador y luego abre el PDF veía dos empresas distintas.
#
# Los .ttf viven en el repo (server/assets/fuentes/) y no se piden por red: un
# PDF se genera en el servidor, y una fuente que se descarga al momento de
# imprimir es un documento que un día sale con otra letra, o no sale.

#: Nombres registrados. Se usan como cualquier fuente de reportlab.
TEXTO = 'Jakarta'
MEDIA = 'Jakarta-Media'          # peso 600: etiquetas y encabezados chicos
FUERTE = 'Jakarta-Fuerte'        # peso 700: títulos y totales
ITALICA = 'Jakarta-Italica'

_ARCHIVOS = {
    TEXTO: 'PlusJakartaSans-Regular.ttf',
    MEDIA: 'PlusJakartaSans-SemiBold.ttf',
    FUERTE: 'PlusJakartaSans-Bold.ttf',
    ITALICA: 'PlusJakartaSans-Italic.ttf',
}

#: A qué caen si falta un archivo. Un documento sin la letra de la casa sigue
#: siendo legible; uno que revienta al generarse, no.
_RESPALDO = {
    TEXTO: 'Helvetica', MEDIA: 'Helvetica-Bold',
    FUERTE: 'Helvetica-Bold', ITALICA: 'Helvetica-Oblique',
}


@lru_cache(maxsize=1)
def registrar_fuentes() -> dict:
    """Registra Plus Jakarta en reportlab. Devuelve {nombre lógico: fuente real}.

    Se llama una vez por proceso (lru_cache). Si un archivo falta o está roto,
    ESA fuente cae a su Helvetica equivalente y las demás siguen: nunca se
    tumba la generación de un documento por un problema de tipografía.
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    base = Path(settings.BASE_DIR) / 'server' / 'assets' / 'fuentes'
    resueltas = {}
    for nombre, archivo in _ARCHIVOS.items():
        try:
            pdfmetrics.registerFont(TTFont(nombre, str(base / archivo)))
            resueltas[nombre] = nombre
        except Exception:
            resueltas[nombre] = _RESPALDO[nombre]
    if resueltas[TEXTO] == TEXTO:
        # Que negritas y cursivas funcionen también cuando algo pide la familia.
        pdfmetrics.registerFontFamily(
            TEXTO, normal=TEXTO, bold=resueltas[FUERTE], italic=resueltas[ITALICA],
            boldItalic=resueltas[FUERTE])
    return resueltas


def fuentes():
    """(texto, media, fuerte, itálica) listas para `setFont`, ya registradas."""
    r = registrar_fuentes()
    return r[TEXTO], r[MEDIA], r[FUERTE], r[ITALICA]
