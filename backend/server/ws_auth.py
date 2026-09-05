"""Middleware de autenticación por JWT para conexiones WebSocket.

Lee el token del query string (?token=<access>), lo valida con SimpleJWT y deja
el usuario en scope['user']. Si no hay token válido, queda AnonymousUser y el
consumer cierra la conexión.
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _usuario_de_token(token: str):
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        from django.contrib.auth import get_user_model
        data = AccessToken(token)
        return get_user_model().objects.get(id=data['user_id'], is_active=True)
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        qs = parse_qs((scope.get('query_string') or b'').decode())
        token = (qs.get('token') or [None])[0]
        scope['user'] = await _usuario_de_token(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)
