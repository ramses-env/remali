"""Modo "sitio en construcción".

Se enciende con `MODO_CONSTRUCCION=True` y devuelve una sola página a todo el
tráfico público.

Va como middleware y no como una ruta más porque la intención es tapar el sitio
entero: si fuera una vista habría que acordarse de taparla en cada URL nueva, y
la que se olvide queda expuesta. Aquí, lo que no está explícitamente permitido
queda cubierto.
"""
from django.conf import settings
from django.http import HttpResponse
from django.template.loader import render_to_string

# El admin de Django queda accesible: si el sitio está tapado justo porque algo
# se rompió, hay que poder entrar a arreglarlo sin apagar el modo construcción.
RUTAS_LIBRES = ('/admin', '/static', '/media')

RESPALDO = {
    'negocio_nombre': 'REMALI',
    'telefono': '744 373 7201',
    'whatsapp': '7443737201',
    'direccion': 'Acapulco, Guerrero',
}


class ModoConstruccionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not getattr(settings, 'MODO_CONSTRUCCION', False):
            return self.get_response(request)
        if request.path.startswith(RUTAS_LIBRES):
            return self.get_response(request)
        # Se renderiza SIN pasar el request: este middleware corre antes que el de
        # autenticación (tiene que ir delante de WhiteNoise), así que request.user
        # todavía no existe y el context processor de auth reventaría. La plantilla
        # no necesita nada del request.
        #
        # Responde 200 a propósito, no 503: si la plataforma tiene healthcheck, un
        # 503 marcaría el despliegue como caído y la página nunca llegaría a verse
        # —lo contrario de lo que se busca—. Que los buscadores no la indexen se
        # resuelve con el <meta name="robots" content="noindex">.
        return HttpResponse(render_to_string('construccion.html', self._datos()))

    def _datos(self):
        """Datos del negocio, con respaldo fijo.

        La configuración se consulta si se puede, pero nunca a costa de la página:
        el modo construcción suele estar encendido justo cuando algo falla (base
        recién creada, migraciones sin correr), y un error aquí dejaría al visitante
        mirando una pantalla de error en vez del aviso.
        """
        datos = dict(RESPALDO)
        try:
            from maquinaria.models import ConfiguracionSitio
            cfg = ConfiguracionSitio.objects.first()
            if cfg:
                datos['negocio_nombre'] = cfg.negocio_nombre or datos['negocio_nombre']
                datos['telefono'] = cfg.negocio_telefono or datos['telefono']
                datos['whatsapp'] = cfg.whatsapp_principal or datos['whatsapp']
                datos['direccion'] = cfg.negocio_direccion or datos['direccion']
        except Exception:
            pass

        # tel: no admite espacios ni guiones.
        datos['telefono_link'] = ''.join(c for c in datos['telefono'] if c.isdigit())
        # wa.me tampoco: el prefijo de país lo pone la plantilla.
        datos['whatsapp'] = ''.join(c for c in datos['whatsapp'] if c.isdigit())
        return datos
