"""Consumer de notificaciones personales del cliente (WebSocket).

Solo empuja: el cliente se conecta y recibe sus notificaciones en el momento en
que se crean (crear_notificacion las envía a su grupo). No procesa mensajes del
cliente.
"""
from channels.generic.websocket import AsyncJsonWebsocketConsumer


class NotificacionConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close()
            return
        self.group = f'notifs_{user.id}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    # Recibe el push del backend (group_send con type 'notif.push') y lo reenvía
    # al navegador tal cual.
    async def notif_push(self, event):
        await self.send_json(event['data'])
