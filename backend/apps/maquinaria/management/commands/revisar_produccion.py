"""Revisión de despegue: ¿está esto listo para atender clientes de verdad?

Corre DENTRO del entorno que va a servir, que es la única forma de saberlo: lo
que valga en la laptop de alguien no dice nada de lo que hay en Railway.

    railway run python manage.py revisar_produccion

NUNCA imprime el valor de una variable, solo si está o no. Está pensado para
pegarse en un chat o en un ticket sin filtrar nada.

Sale con código 1 si hay algún BLOQUEA, para poder colgarlo de un despliegue.
"""
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import connection

BLOQUEA, AVISA, OK = 'BLOQUEA', 'AVISA', 'OK'

# Cuentas que `crear_usuarios_prueba` deja con contraseña pública y conocida.
CUENTAS_DE_PRUEBA = ('admin_prueba', 'tecnico_prueba')


class Command(BaseCommand):
    help = 'Revisa que el entorno esté listo para producción. No imprime secretos.'

    def add_arguments(self, parser):
        parser.add_argument('--solo-problemas', action='store_true',
                            help='Omite los renglones que ya están bien.')

    def handle(self, *args, **opciones):
        self.resultados = []
        for revision in (
            self._debug, self._secret_key, self._hosts, self._urls_publicas,
            self._base_de_datos, self._migraciones, self._cuentas_de_prueba,
            self._almacenamiento, self._correo, self._estaticos,
            self._redis, self._construccion, self._csp, self._https,
        ):
            try:
                revision()
            except Exception as e:  # una revisión rota no puede tapar a las demás
                self._anotar(AVISA, revision.__name__.strip('_'),
                             f'no se pudo revisar: {type(e).__name__}: {e}')
        return self._reportar(opciones['solo_problemas'])

    # ── utilidades ──
    def _anotar(self, nivel, asunto, detalle):
        self.resultados.append((nivel, asunto, detalle))

    def _hay(self, *nombres):
        """True si TODAS esas variables de entorno traen algo. No lee el valor."""
        return all((os.environ.get(n) or '').strip() for n in nombres)

    def _faltantes(self, *nombres):
        return [n for n in nombres if not (os.environ.get(n) or '').strip()]

    # ── revisiones ──
    def _debug(self):
        if settings.DEBUG:
            self._anotar(BLOQUEA, 'DEBUG', 'está en True: cualquier error le enseña al '
                                           'visitante el código, la ruta y la configuración. '
                                           'Pon DEBUG=False.')
        else:
            self._anotar(OK, 'DEBUG', 'apagado')

    def _secret_key(self):
        clave = settings.SECRET_KEY or ''
        if not (os.environ.get('SECRET_KEY') or '').strip():
            self._anotar(BLOQUEA, 'SECRET_KEY', 'no viene del entorno: se generó una al azar al '
                                                'arrancar. Cada worker tendrá la suya y cada '
                                                'reinicio invalidará todas las sesiones y los '
                                                'enlaces de restablecer contraseña.')
        elif clave.startswith('django-insecure-'):
            self._anotar(BLOQUEA, 'SECRET_KEY', 'es una de las que Django genera para desarrollo '
                                                '(prefijo django-insecure-), y esa se filtró en el '
                                                'historial de git. Genera una nueva.')
        elif len(clave) < 50:
            self._anotar(BLOQUEA, 'SECRET_KEY', f'tiene {len(clave)} caracteres; se esperan 50 o más.')
        else:
            self._anotar(OK, 'SECRET_KEY', 'del entorno, larga y sin prefijo de desarrollo')

    def _hosts(self):
        hosts = list(settings.ALLOWED_HOSTS or [])
        if '*' in hosts:
            self._anotar(BLOQUEA, 'ALLOWED_HOSTS', "trae '*': acepta cualquier Host, que es lo que "
                                                   'permite envenenar los enlaces de los correos.')
        elif not hosts:
            self._anotar(BLOQUEA, 'ALLOWED_HOSTS', 'está vacío: Django rechazará todo con 400.')
        else:
            self._anotar(OK, 'ALLOWED_HOSTS', f'{len(hosts)} host(s) declarados')

        origenes = list(getattr(settings, 'CORS_ALLOWED_ORIGINS', []) or [])
        locales = [o for o in origenes if 'localhost' in o or '127.0.0.1' in o]
        if getattr(settings, 'CORS_ALLOW_ALL_ORIGINS', False):
            self._anotar(BLOQUEA, 'CORS', 'CORS_ALLOW_ALL_ORIGINS está en True: cualquier sitio '
                                          'del mundo puede llamar a esta API con la sesión del '
                                          'visitante.')
        elif locales:
            self._anotar(AVISA, 'CORS', f'{len(locales)} origen(es) de localhost siguen permitidos. '
                                        'No es explotable desde fuera, pero sobran en producción.')
        else:
            self._anotar(OK, 'CORS', f'{len(origenes)} origen(es), ninguno local')

    def _urls_publicas(self):
        """Lo que va DENTRO de los correos y los QR. Si apunta mal, nadie entra."""
        for nombre in ('FRONTEND_URL', 'BACKEND_URL'):
            valor = getattr(settings, nombre, '') or ''
            puesta = (os.environ.get(nombre) or '').strip()
            anfitrion = valor.split('//')[-1].split('/')[0]
            if not puesta:
                self._anotar(BLOQUEA, nombre,
                             f'no está definida: se usa el valor por defecto ({anfitrion}). '
                             'Los enlaces de verificar correo, restablecer contraseña y los QR '
                             'se mandan con ese dominio; si no es el real, no abren.')
            elif anfitrion and anfitrion not in settings.ALLOWED_HOSTS:
                self._anotar(AVISA, nombre, f'apunta a {anfitrion}, que no está en ALLOWED_HOSTS.')
            else:
                self._anotar(OK, nombre, f'apunta a {anfitrion}')

    def _base_de_datos(self):
        motor = settings.DATABASES['default']['ENGINE'].rsplit('.', 1)[-1]
        if 'sqlite' in motor:
            self._anotar(BLOQUEA, 'base de datos', 'está en SQLite. En Railway el disco del '
                                                   'contenedor se borra en cada despliegue: '
                                                   'perderías todo al actualizar.')
            return
        try:
            connection.ensure_connection()
            self._anotar(OK, 'base de datos', f'{motor}, conecta')
        except Exception as e:
            self._anotar(BLOQUEA, 'base de datos', f'no conecta: {type(e).__name__}')

    def _migraciones(self):
        from django.db.migrations.executor import MigrationExecutor
        try:
            ejecutor = MigrationExecutor(connection)
            pendientes = ejecutor.migration_plan(ejecutor.loader.graph.leaf_nodes())
        except Exception as e:
            self._anotar(AVISA, 'migraciones', f'no se pudieron leer: {type(e).__name__}')
            return
        if not pendientes:
            self._anotar(OK, 'migraciones', 'todas aplicadas')
            return
        apps = sorted({m.app_label for m, _ in pendientes})
        extra = ''
        if 'token_blacklist' in apps:
            # Ya mordió una vez: sin esa tabla, emitir el JWT truena y el login
            # devuelve "credenciales inválidas" con la contraseña correcta.
            extra = (' OJO con token_blacklist: sin sus tablas NADIE puede entrar, y el '
                     'login lo disfraza de contraseña incorrecta.')
        self._anotar(BLOQUEA, 'migraciones',
                     f'{len(pendientes)} pendiente(s) en: {", ".join(apps)}.{extra}')

    def _cuentas_de_prueba(self):
        U = get_user_model()
        vivas = list(U.objects.filter(username__in=CUENTAS_DE_PRUEBA, is_active=True)
                     .values_list('username', flat=True))
        if vivas:
            self._anotar(BLOQUEA, 'cuentas de prueba',
                         f'siguen activas: {", ".join(vivas)}. Sus contraseñas están escritas '
                         'en la documentación del repo. Bórralas con '
                         '`crear_usuarios_prueba --borrar`.')
        else:
            self._anotar(OK, 'cuentas de prueba', 'ninguna activa')

        if not U.objects.filter(is_superuser=True, is_active=True).exists():
            self._anotar(BLOQUEA, 'dueño', 'no hay ningún superusuario activo: nadie podría '
                                           'administrar el sistema.')

    def _almacenamiento(self):
        faltan = self._faltantes('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET')
        if faltan:
            self._anotar(BLOQUEA, 'Cloudinary', f'falta(n) {", ".join(faltan)}. Sin esto las fotos '
                                                'se guardan en el disco del contenedor y se '
                                                'BORRAN en el siguiente despliegue.')
        else:
            self._anotar(OK, 'Cloudinary', 'las tres variables están')

    def _correo(self):
        backend = getattr(settings, 'EMAIL_BACKEND', '')
        if 'console' in backend or 'locmem' in backend:
            self._anotar(BLOQUEA, 'correo', f'EMAIL_BACKEND es {backend.rsplit(".", 1)[-1]}: los '
                                            'correos se imprimen en el log en vez de enviarse. '
                                            'Nadie verificaría su cuenta ni recuperaría su '
                                            'contraseña.')
            return
        faltan = self._faltantes('EMAIL_HOST', 'EMAIL_HOST_USER', 'EMAIL_HOST_PASSWORD')
        if faltan:
            self._anotar(BLOQUEA, 'correo', f'falta(n) {", ".join(faltan)}.')
        elif not (getattr(settings, 'DEFAULT_FROM_EMAIL', '') or '').strip():
            self._anotar(AVISA, 'correo', 'sin DEFAULT_FROM_EMAIL: saldrá como webmaster@localhost.')
        else:
            self._anotar(OK, 'correo', 'SMTP configurado')

    def _estaticos(self):
        from pathlib import Path
        raiz = Path(getattr(settings, 'STATIC_ROOT', '') or '')
        if not raiz or not raiz.is_dir():
            self._anotar(BLOQUEA, 'estáticos', 'no existe STATIC_ROOT: no corrió collectstatic y '
                                               'el sitio saldría sin CSS ni JS.')
            return
        indice = raiz / 'index.html'
        if not indice.is_file():
            self._anotar(BLOQUEA, 'estáticos', f'{raiz} existe pero no tiene index.html: el build '
                                               'del frontend no llegó a la imagen.')
        else:
            self._anotar(OK, 'estáticos', 'recolectados, con index.html')

    def _redis(self):
        if self._hay('REDIS_URL'):
            self._anotar(OK, 'Redis', 'configurado')
            return
        obreros = os.environ.get('WEB_CONCURRENCY', '2')
        nivel = AVISA if obreros in ('1',) else BLOQUEA
        self._anotar(nivel, 'Redis', f'sin REDIS_URL y con WEB_CONCURRENCY={obreros}. La caché y '
                                     'la capa de WebSockets quedan por proceso: un aviso en '
                                     'tiempo real solo llega a quien esté conectado al mismo '
                                     'worker, y a los demás no les llega nunca.')

    def _construccion(self):
        if getattr(settings, 'MODO_CONSTRUCCION', False):
            self._anotar(AVISA, 'modo construcción', 'ENCENDIDO: todo el tráfico público ve la '
                                                     'página de "en construcción". Apágalo cuando '
                                                     'quieras abrir de verdad.')
        else:
            self._anotar(OK, 'modo construcción', 'apagado, el sitio está abierto')

    def _csp(self):
        if getattr(settings, 'CSP_REPORT_ONLY', True):
            self._anotar(AVISA, 'CSP', 'en modo REPORTE: anota violaciones pero no bloquea nada. '
                                       'Es lo correcto para estrenar; cuando lleve unos días '
                                       'limpio pon CSP_REPORT_ONLY=False.')
        else:
            self._anotar(OK, 'CSP', 'bloqueando')

    def _https(self):
        flojos = [n for n in ('SECURE_SSL_REDIRECT', 'SESSION_COOKIE_SECURE', 'CSRF_COOKIE_SECURE')
                  if not getattr(settings, n, False)]
        if flojos:
            self._anotar(BLOQUEA, 'HTTPS', f'sin activar: {", ".join(flojos)}.')
        elif not getattr(settings, 'SECURE_HSTS_SECONDS', 0):
            self._anotar(AVISA, 'HTTPS', 'sin HSTS.')
        else:
            self._anotar(OK, 'HTTPS', 'redirección, cookies seguras y HSTS')

    # ── salida ──
    def _reportar(self, solo_problemas):
        e = self.style
        orden = {BLOQUEA: 0, AVISA: 1, OK: 2}
        pinta = {BLOQUEA: e.ERROR, AVISA: e.WARNING, OK: e.SUCCESS}
        self.stdout.write('')
        self.stdout.write(e.MIGRATE_HEADING('REVISIÓN DE DESPEGUE'))
        self.stdout.write('')
        for nivel, asunto, detalle in sorted(self.resultados, key=lambda r: orden[r[0]]):
            if solo_problemas and nivel == OK:
                continue
            self.stdout.write(f'  {pinta[nivel](nivel.ljust(7))} {asunto}: {detalle}')
        bloqueos = sum(1 for n, _, _ in self.resultados if n == BLOQUEA)
        avisos = sum(1 for n, _, _ in self.resultados if n == AVISA)
        self.stdout.write('')
        if bloqueos:
            self.stdout.write(e.ERROR(f'  {bloqueos} cosa(s) que impiden salir a producción, '
                                      f'{avisos} aviso(s).'))
            raise SystemExit(1)
        self.stdout.write(e.SUCCESS(f'  Sin bloqueos. {avisos} aviso(s) por revisar.'))
        return None
