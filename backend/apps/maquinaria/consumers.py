"""Consumer de notificaciones personales del cliente (WebSocket).

Solo empuja: el cliente se conecta y recibe sus notificaciones en el momento en
que se crean (crear_notificacion las envía a su grupo). No procesa mensajes del
cliente.
"""
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async

from maquinaria.permissions import NIVEL_TECNICO, nivel_de


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


class ClienteEventoConsumer(AsyncJsonWebsocketConsumer):
    """Bus de eventos de la cuenta del cliente.

    No manda payloads pesados: solo avisa qué cambió para que el frontend vuelva
    a pedir su estado real por HTTP y mantenga una única fuente de verdad.
    """

    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close()
            return
        self.group = f'user_{user.id}'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def client_event(self, event):
        await self.send_json(event['data'])


class PanelEventoConsumer(AsyncJsonWebsocketConsumer):
    """Bus de eventos del panel interno.

    Lo usan admin y técnico para invalidar solo los módulos afectados cuando
    otra persona o un cliente cambia algo en el sistema.
    """

    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close()
            return
        if await database_sync_to_async(nivel_de)(user) < NIVEL_TECNICO:
            await self.close()
            return
        self.group = 'panel_ops'
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def panel_event(self, event):
        await self.send_json(event['data'])
