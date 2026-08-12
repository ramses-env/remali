from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Verifica si Redis está habilitado para cache y Channels.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--strict',
            action='store_true',
            help='Falla si Redis no está activo o si una prueba no pasa.',
        )

    def handle(self, *args, **opts):
        strict = opts['strict']
        redis_url = (getattr(settings, 'REDIS_URL', '') or '').strip()
        cache_backend = settings.CACHES['default']['BACKEND']
        channel_backend = settings.CHANNEL_LAYERS['default']['BACKEND']
        redis_activo = bool(redis_url) and 'redis' in cache_backend.lower() and 'redis' in channel_backend.lower()

        self.stdout.write(f'REDIS_URL configurado: {"si" if redis_url else "no"}')
        self.stdout.write(f'Cache backend: {cache_backend}')
        self.stdout.write(f'Channels backend: {channel_backend}')

        cache_ok = False
        try:
            cache.set('redis_probe', 'ok', 30)
            cache_ok = cache.get('redis_probe') == 'ok'
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'Cache probe fallo: {exc}'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Cache probe: {"ok" if cache_ok else "fallo"}'))

        channel_ok = False
        try:
            layer = get_channel_layer()
            channel_name = async_to_sync(layer.new_channel)('redis-probe.')
            async_to_sync(layer.send)(channel_name, {'type': 'probe.message', 'text': 'ok'})
            message = async_to_sync(layer.receive)(channel_name)
            channel_ok = message.get('text') == 'ok'
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'Channels probe fallo: {exc}'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Channels probe: {"ok" if channel_ok else "fallo"}'))

        if strict and not redis_activo:
            raise CommandError('Redis no esta activo. Define REDIS_URL y reinicia la app.')
        if strict and not cache_ok:
            raise CommandError('La prueba de cache no paso.')
        if strict and not channel_ok:
            raise CommandError('La prueba de Channels no paso.')

        if redis_activo and cache_ok and channel_ok:
            self.stdout.write(self.style.SUCCESS('Redis esta habilitado y funcionando para cache + Channels.'))
        elif redis_activo:
            raise CommandError('Redis parece configurado, pero una de las pruebas fallo.')
        else:
            self.stdout.write(self.style.WARNING('Redis no esta activo; el proyecto sigue en modo memoria local.'))
