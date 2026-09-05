"""Content-Security-Policy.

Estaba puesto y se cayó cuando la colisión de sesiones borró este archivo; desde
entonces el sitio va sin CSP. Esto lo repone.

QUÉ APORTA: si algún día entra un `<script>` ajeno —por un campo que no escapó
bien, por una dependencia comprometida— el navegador se niega a ejecutarlo
porque su origen no está en la lista. Es la última red debajo del escape de
plantillas, no un reemplazo.

ARRANCA EN MODO REPORTE (`Content-Security-Policy-Report-Only`). Es a propósito:
un CSP mal calibrado no "degrada" la página, la rompe entera y en blanco. En
modo reporte el navegador anota cada violación en la consola y NO bloquea nada.
Se despliega así, se usa el sitio un par de días mirando la consola, y cuando no
salgan violaciones se pone `CSP_REPORT_ONLY=False` y ya bloquea de verdad.

EL SCRIPT EN LÍNEA: `index.html` trae un script que pinta el tema antes de que
React monte (sin él la página destella de un tema al otro). No se puede firmar
con nonce porque ese HTML lo sirve whitenoise como archivo estático, sin pasar
por una plantilla de Django. Así que se calcula su SHA-256 al arrancar y se
autoriza por hash: nada de 'unsafe-inline' en script-src. Si el script cambia,
el hash cambia con él en el siguiente despliegue.
"""
import base64
import hashlib
import logging
import re
from pathlib import Path

from django.conf import settings

log = logging.getLogger(__name__)

# De dónde puede venir cada cosa. Cada renglón está por una razón concreta:
FUENTES = {
    'default-src': ["'self'"],
    # Google Sign-In monta su propio script; el resto es nuestro. Los hashes de
    # los scripts en línea se añaden abajo.
    'script-src': ["'self'", 'https://accounts.google.com'],
    # 'unsafe-inline' en ESTILOS sí se queda: React escribe `style={{…}}` por
    # todo el proyecto y eso son atributos style en línea. Quitarlo exigiría
    # reescribir cientos de componentes, y el riesgo de un estilo inyectado es
    # de otro orden que el de un script.
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    # Las fotos del inventario viven en Cloudinary; data:/blob: son las
    # previsualizaciones locales antes de subir y los QR que se generan al vuelo.
    'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
    # wss: es el WebSocket de notificaciones (Channels), mismo origen.
    'connect-src': ["'self'", 'wss:', 'https://accounts.google.com'],
    # Google Sign-In se pinta en un iframe suyo.
    'frame-src': ["'self'", 'https://accounts.google.com'],
    # Nada de <object>/<embed>, y que nadie nos meta en un iframe.
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    # Los PDF se generan en el cliente y se abren en blob:.
    'worker-src': ["'self'", 'blob:'],
}

_ETIQUETA_SCRIPT = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.S | re.I)


def _hashes_del_html():
    """SHA-256 de cada script en línea del index.html construido.

    Si el archivo no está (build sin correr, o desarrollo con Vite sirviendo el
    HTML), se devuelve vacío: en modo reporte eso solo produce una violación
    anotada, y es preferible a inventar un 'unsafe-inline' permanente.
    """
    candidatos = [
        Path(settings.BASE_DIR).parent / 'frontend' / 'dist' / 'index.html',
        Path(settings.BASE_DIR) / 'staticfiles' / 'index.html',
    ]
    for ruta in candidatos:
        try:
            if not ruta.is_file():
                continue
            html = ruta.read_text(encoding='utf-8')
        except OSError:
            continue
        hashes = []
        for cuerpo in _ETIQUETA_SCRIPT.findall(html):
            if not cuerpo.strip():
                continue
            resumen = hashlib.sha256(cuerpo.encode('utf-8')).digest()
            hashes.append(f"'sha256-{base64.b64encode(resumen).decode()}'")
        if hashes:
            return hashes
    log.warning('CSP: no encontré scripts en línea que firmar (¿corrió el build del front?)')
    return []


def _armar_politica():
    fuentes = {k: list(v) for k, v in FUENTES.items()}
    if settings.DEBUG:
        # En desarrollo NO se firman hashes: en cuanto hay un hash, el navegador
        # IGNORA 'unsafe-inline', y Vite necesita justamente eso para su recarga
        # en caliente. Los dos juntos serían peor que ninguno.
        fuentes['script-src'] += ["'unsafe-inline'", "'unsafe-eval'"]
        fuentes['connect-src'] += ['ws:', 'http://localhost:*', 'http://127.0.0.1:*']
    else:
        fuentes['script-src'] += _hashes_del_html()
    partes = [f'{k} {" ".join(v)}' for k, v in fuentes.items()]
    if not settings.DEBUG:
        # Sube a https cualquier recurso que se haya colado con http://.
        partes.append('upgrade-insecure-requests')
    return '; '.join(partes)


class ContentSecurityPolicyMiddleware:
    """Pone la cabecera. La política se arma UNA vez, al arrancar el proceso."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.politica = _armar_politica()
        self.cabecera = (
            'Content-Security-Policy-Report-Only'
            if getattr(settings, 'CSP_REPORT_ONLY', True)
            else 'Content-Security-Policy'
        )

    def __call__(self, request):
        respuesta = self.get_response(request)
        # El admin de Django trae scripts y estilos en línea propios que no
        # controlamos; imponerle esta política solo lo rompería. Es una ruta
        # interna, tras autenticación, no la superficie que hay que blindar.
        if request.path.startswith('/admin'):
            return respuesta
        respuesta.setdefault(self.cabecera, self.politica)
        return respuesta
