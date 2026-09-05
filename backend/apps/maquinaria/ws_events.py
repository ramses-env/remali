"""Push de eventos en tiempo real para cliente y panel interno.

Se usa para refrescar vistas sin polling agresivo. El canal es best-effort: si
Redis/Channels no están disponibles, la app sigue funcionando y el frontend cae
a su latido de respaldo.
"""
import functools

from asgiref.sync import async_to_sync
from server.rastro import tragado


def omitir_en_restauracion(fn):
    """Apaga un receptor de `post_save`/`pre_save` durante `loaddata`.

    Django marca esos guardados con `raw=True` justo para esto: la base está a
    medio cargar y los objetos relacionados todavía no existen. Un receptor que
    entra ahí y toca `instance.orden` revienta con `DoesNotExist` y tumba la
    restauración COMPLETA (la transacción es atómica), que es exactamente
    cuando menos te puedes permitir que falle.

    Aparte del choque: aunque no reventara, restaurar 5.000 filas mandaría
    5.000 eventos de WebSocket a los navegadores conectados.
    """
    @functools.wraps(fn)
    def envoltura(*args, **kwargs):
        if kwargs.get('raw'):
            return
        return fn(*args, **kwargs)
    return envoltura


def push_user_event(user_id: int | None, data: dict):
    if not user_id:
        return
    try:
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if not layer:
            return
        async_to_sync(layer.group_send)(f'user_{int(user_id)}', {
            'type': 'client.event',
            'data': data,
        })
    except Exception:
        tragado()


def push_panel_event(*topics: str):
    temas = [t for t in dict.fromkeys(topics) if t]
    if not temas:
        return
    try:
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if not layer:
            return
        async_to_sync(layer.group_send)('panel_ops', {
            'type': 'panel.event',
            'data': {'topics': temas},
        })
    except Exception:
        tragado()
