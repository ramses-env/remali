"""Reglas de la evidencia fotográfica de una renta.

La evidencia existe para resolver una disputa de dinero: en qué estado salió la
máquina y en qué estado volvió. Eso le impone tres exigencias que una galería
normal no tiene.

1. **Tiene que ser una foto de verdad.** `ImageField` valida en formularios y
   serializadores, pero no cuando se crea el objeto directo, así que un archivo
   cualquiera con extensión .jpg entraba tal cual. Aquí se abre con Pillow.

2. **Tiene que ser de cuando dice ser.** Una foto de "entrega" subida después de
   recoger el equipo no prueba nada: se puede tomar cuando ya apareció el daño.
   Por eso cada momento tiene su ventana.

3. **No debe poder alterarse después.** Mientras la renta está viva se pueden
   corregir errores; una vez cerrada, la evidencia queda como está.
"""
import uuid

from django.utils import timezone

# Lo que Pillow debe reconocer. HEIC de iPhone lo convierte el navegador antes
# de subir; si algún día llega crudo, se agrega aquí con su plugin.
FORMATOS = {'JPEG', 'PNG', 'WEBP'}
EXTENSION = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}

MAX_MB = 10
MAX_POR_MOMENTO = 12
# Margen para subir lo del día cuando no hubo señal en la obra.
DIAS_GRACIA = 3


class EvidenciaInvalida(Exception):
    """Motivo legible para devolver al cliente."""


def validar_imagen(archivo):
    """Comprueba que el archivo sea una imagen real y devuelve su formato.

    No se confía en la extensión ni en el Content-Type: los dos los pone quien
    sube. La única prueba es que Pillow pueda decodificarla.
    """
    if archivo.size > MAX_MB * 1024 * 1024:
        raise EvidenciaInvalida(f'"{archivo.name}" pesa más de {MAX_MB} MB.')
    if archivo.size == 0:
        raise EvidenciaInvalida(f'"{archivo.name}" está vacío.')

    from PIL import Image, UnidentifiedImageError

    try:
        archivo.seek(0)
        with Image.open(archivo) as img:
            formato = (img.format or '').upper()
            img.verify()          # detecta archivos corruptos o que no son imagen
    except (UnidentifiedImageError, OSError, ValueError):
        raise EvidenciaInvalida(f'"{archivo.name}" no es una imagen válida.')
    finally:
        archivo.seek(0)           # verify() consume el archivo; el guardado lo necesita entero

    if formato not in FORMATOS:
        raise EvidenciaInvalida(
            f'"{archivo.name}" está en {formato or "un formato desconocido"}. '
            f'Usa JPG, PNG o WEBP.'
        )
    return formato


def fecha_de_captura(archivo):
    """Fecha EXIF de la foto, o None. Nunca lanza: es un dato de apoyo.

    No se valida contra ella (ver la nota del encabezado): un teléfono que la
    borra daría un falso 'sin fecha', y bloquear por eso rechazaría fotos buenas.
    """
    from datetime import datetime
    from django.utils import timezone as _tz
    try:
        from PIL import Image
        archivo.seek(0)
        with Image.open(archivo) as img:
            exif = img.getexif()
        # 36867 = DateTimeOriginal; 306 = DateTime. Formato 'YYYY:MM:DD HH:MM:SS'.
        crudo = exif.get(36867) or exif.get(306)
        if not crudo:
            return None
        naive = datetime.strptime(str(crudo).strip(), '%Y:%m:%d %H:%M:%S')
        return _tz.make_aware(naive, _tz.get_current_timezone())
    except Exception:
        return None
    finally:
        try:
            archivo.seek(0)
        except Exception:
            pass


def nombre_seguro(renta_id: int, momento: str, formato: str) -> str:
    """Nombre generado por nosotros.

    El que manda el cliente puede traer rutas, caracteres raros o repetirse entre
    dos técnicos subiendo a la vez. Este no.
    """
    marca = timezone.now().strftime('%Y%m%d-%H%M%S')
    return f'renta{renta_id}-{momento}-{marca}-{uuid.uuid4().hex[:8]}.{EXTENSION[formato]}'


def revisar_momento(renta, momento: str):
    """¿Tiene sentido subir esta evidencia ahora? Lanza si no."""
    if renta.estado == 'cancelada':
        raise EvidenciaInvalida('La renta está cancelada; no se le agrega evidencia.')

    if renta.estado == 'finalizada':
        cerrada = renta.recogida_en or renta.actualizado_en
        dias = (timezone.now() - cerrada).days
        if dias > DIAS_GRACIA:
            raise EvidenciaInvalida(
                f'Esta renta se cerró hace {dias} días. La evidencia se sube al momento, '
                f'no después; pídele a administración que la agregue si hace falta.'
            )
        if momento == 'entrega':
            raise EvidenciaInvalida(
                'El equipo ya volvió: una foto de la entrega subida ahora no prueba '
                'en qué estado salió.'
            )

    if momento == 'devolucion' and renta.estado == 'reservada':
        raise EvidenciaInvalida('El equipo todavía no sale; aún no hay devolución que documentar.')


def puede_borrarse(renta) -> bool:
    """Una vez cerrada la renta, la evidencia ya cumplió su función y se congela.

    Mientras sigue viva se admite borrar (una foto movida, la máquina equivocada);
    después no, porque es justo cuando alguien tendría motivo para quitarla.
    """
    return renta.estado not in ('finalizada', 'cancelada')
