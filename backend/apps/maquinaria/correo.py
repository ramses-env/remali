"""Envío de correo que no bloquea la petición.

`send_mail` habla con el servidor SMTP dentro del request: si tarda 3 segundos,
el worker se queda esperando y nadie más puede usar el sitio. Aquí el envío se
manda a un hilo aparte y la respuesta sale de inmediato.

No es una cola de tareas: si el proceso muere justo en ese momento, el correo se
pierde. Para avisos (verificación, nueva solicitud) eso es aceptable — el dato
ya quedó guardado en la base y el aviso se puede reenviar desde el panel. Si
algún día hace falta garantía de entrega, esto se cambia por Celery/RQ sin tocar
a quien lo llama.
"""
import logging
import threading

from django.conf import settings
from django.core.mail import EmailMessage
from django.db import connections

log = logging.getLogger(__name__)


def _enviar(asunto, cuerpo, destinatarios, adjuntos):
    try:
        msg = EmailMessage(asunto, cuerpo, settings.DEFAULT_FROM_EMAIL, destinatarios)
        for nombre, contenido, tipo in adjuntos:
            msg.attach(nombre, contenido, tipo)
        msg.send(fail_silently=False)
    except Exception:
        log.exception('No se pudo enviar el correo "%s" a %s', asunto, destinatarios)
    finally:
        # El hilo abre su propia conexión a la BD si el backend de correo la usa;
        # sin esto quedarían conexiones colgadas en MySQL.
        connections.close_all()


def enviar_async(asunto, cuerpo, destinatarios, adjuntos=None):
    """Encola el correo en un hilo. Devuelve False solo si no hay a quién mandarlo.

    `adjuntos` es una lista de (nombre, contenido_bytes, content_type).

    Ojo: True significa "se puso en camino", no "llegó". El resultado real del
    envío queda en el log.
    """
    destinatarios = [d for d in (destinatarios or []) if d]
    if not destinatarios:
        return False
    threading.Thread(
        target=_enviar, args=(asunto, cuerpo, destinatarios, list(adjuntos or [])),
        daemon=True, name='correo-remali',
    ).start()
    return True


def enviar_plantilla_brevo(template_id, email, nombre=None, params=None, adjuntos=None):
    """Dispara una PLANTILLA transaccional de Brevo por su API, en un hilo.

    El diseño vive en Brevo (editable sin tocar código) y usa `{{ params.xxx }}`
    para los datos que le pasamos aquí. `adjuntos` es la misma lista de
    (nombre, contenido_bytes, content_type) que usa `enviar_async`; se mandan en
    base64. El asunto y el remitente los define la propia plantilla en Brevo.

    Devuelve True si está configurada (BREVO_API_KEY + template_id) y se encoló;
    False si falta configuración — así quien llama puede caer al SMTP de texto.
    """
    import os

    api_key = os.environ.get('BREVO_API_KEY', '').strip()
    if not api_key or not template_id or not email:
        return False
    import base64
    import json
    import urllib.request

    cuerpo = {
        'templateId': int(template_id),
        'to': [{'email': email, 'name': nombre or email}],
        'params': params or {},
    }
    if adjuntos:
        cuerpo['attachment'] = [
            {'name': nom, 'content': base64.b64encode(contenido).decode('ascii')}
            for nom, contenido, _tipo in adjuntos
        ]
    payload = json.dumps(cuerpo).encode('utf-8')

    def _worker():
        try:
            req = urllib.request.Request(
                'https://api.brevo.com/v3/smtp/email', data=payload,
                headers={'api-key': api_key, 'content-type': 'application/json', 'accept': 'application/json'})
            urllib.request.urlopen(req, timeout=20)
        except Exception:
            log.exception('No se pudo enviar la plantilla Brevo %s a %s', template_id, email)

    threading.Thread(target=_worker, daemon=True, name='brevo-remali').start()
    return True
