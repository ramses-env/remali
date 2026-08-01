"""ASGI para el proyecto: HTTP normal + WebSockets (Channels).

Los WebSockets se autentican con el MISMO JWT del API (va como ?token=...), no
con cookies de sesión, para que funcione igual desde la SPA que desde el túnel.
"""
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'server.settings')

from django.core.asgi import get_asgi_application

# Inicializa Django (apps, settings) ANTES de importar consumers/modelos.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from server.ws_auth import JWTAuthMiddleware  # noqa: E402
from maquinaria.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # Auth por JWT (query string). Un socket sin token válido se rechaza en el
    # consumer, así que no hace falta validar Origin (que además rompería el túnel).
    'websocket': JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
