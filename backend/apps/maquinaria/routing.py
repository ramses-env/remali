from django.urls import path

from .consumers import ClienteEventoConsumer, NotificacionConsumer, PanelEventoConsumer

websocket_urlpatterns = [
    path('ws/notificaciones/', NotificacionConsumer.as_asgi()),
    path('ws/cliente-eventos/', ClienteEventoConsumer.as_asgi()),
    path('ws/panel-eventos/', PanelEventoConsumer.as_asgi()),
]
