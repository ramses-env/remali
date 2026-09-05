"""Respaldo de la base de datos.

Usa `dumpdata` en vez de mysqldump a propósito: no depende de binarios que el
contenedor no trae, funciona igual en MySQL y SQLite, y se restaura con
`restaurar_bd` sin importar el motor.

DÓNDE SE GUARDA
---------------
En el directorio que diga `BACKUP_LOCAL_DIR`, y en Railway ese directorio TIENE
que ser un volumen montado (p. ej. `/data/backups`). El disco normal del
contenedor se borra en cada despliegue, que es justo cuando más falta haría el
respaldo.

Antes esto subía el `.json.gz` a Cloudinary. No funcionaba: Cloudinary lo recibe
por el storage de IMÁGENES y lo rechaza con "Invalid image file", así que el cron
llevaba tronando todos los días sin que se notara. Y aunque se arreglara mandando
el archivo como "raw", tampoco debería ir ahí: los assets de Cloudinary se sirven
por URL pública y este archivo lleva hashes de contraseñas y datos de clientes.
Un volcado de la base no va en un CDN.

Uso:
    python manage.py respaldar_bd
    python manage.py respaldar_bd --retener 60   # conservar los 60 más recientes
    python manage.py respaldar_bd --destino /data/backups
"""
import gzip
import io
import os
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from server.rastro import tragado

# Lo único que NO se respalda: sesiones abiertas, el log del admin de Django y el
# latido del panel. Son efímeros y no valen nada al restaurar.
#
# contenttypes y auth.permission SÍ se incluyen aunque `migrate` los regenere:
# los permisos de los grupos se guardan por nombre natural y necesitan que su
# ContentType exista. Esta base arrastra tipos de una app vieja ('shop'), y sin
# ellos la restauración truena. `restaurar_bd` vacía las tablas antes de cargar
# para que no choquen con las que crea migrate.
#
# maquinaria.SelloTema es estado de runtime (la marca de "esto cambió" que el
# panel consulta cada par de segundos). Además rompía la restauración: al cargar,
# cada objeto dispara la señal del latido, que crea el sello al vuelo, y luego el
# sello del propio respaldo choca con él por el índice único de `tema`.
EXCLUIR = ['sessions', 'admin.logentry', 'maquinaria.SelloTema']

RETENCION_POR_DEFECTO = 30


class Command(BaseCommand):
    help = 'Respalda la base de datos a un archivo comprimido y poda los viejos.'

    def add_arguments(self, parser):
        parser.add_argument('--destino', default='',
                            help='Directorio donde guardar. Por defecto BACKUP_LOCAL_DIR.')
        parser.add_argument('--retener', type=int, default=RETENCION_POR_DEFECTO,
                            help=f'Cuántos respaldos conservar (por defecto {RETENCION_POR_DEFECTO}). 0 = todos.')
        # Se acepta y se ignora: el guardado local ya es el comportamiento único.
        # Existe para no romper el cron ni la documentación que ya lo usaban.
        parser.add_argument('--local', action='store_true', help='(en desuso: ya es el comportamiento normal)')

    def handle(self, *args, **opts):
        # Con segundos: dos corridas en el mismo minuto (un reintento del cron,
        # un respaldo a mano antes de migrar) escribían el MISMO archivo y la
        # segunda pisaba a la primera sin avisar.
        marca = timezone.localtime().strftime('%Y-%m-%d_%H%M%S')

        try:
            # Resolver el destino va DENTRO del try: crear el directorio es de
            # los pasos que más fallan en producción (volumen no montado, disco
            # de solo lectura) y si se queda fuera, revienta sin avisar a nadie.
            destino = self._resolver_destino(opts['destino'])
            comprimido, crudo_kb = self._volcar()
            ruta = destino / f'remali-{marca}.json.gz'
            ruta.write_bytes(comprimido)
        except Exception as e:
            # Un respaldo que falla en silencio es peor que no tenerlo: da la
            # falsa tranquilidad de que existe. Se avisa en el panel y se sale
            # con error para que el cron lo marque como fallido.
            self._avisar_falla(f'{type(e).__name__}: {e}')
            raise CommandError(f'No se pudo generar el respaldo: {e}') from e

        kb = len(comprimido) / 1024
        detalle = f'{ruta} · {kb:.0f} KB (de {crudo_kb:.0f} KB sin comprimir)'
        self.stdout.write(self.style.SUCCESS(f'Respaldo listo: {detalle}'))

        podados = self._podar(destino, opts['retener'])
        if podados:
            self.stdout.write(f'Podados {podados} respaldos viejos (se conservan {opts["retener"]}).')

        # Dejar rastro en el panel: si el cron deja de correr, se nota.
        try:
            from maquinaria.models import crear_notificacion
            crear_notificacion(
                'sistema', 'Respaldo de la base realizado', detalle,
                seccion='configuracion', ref=f'respaldo-{marca}',
            )
        except Exception:
            tragado()

    # ── piezas ────────────────────────────────────────────────────────────

    def _resolver_destino(self, explicito) -> Path:
        ruta = (explicito or os.environ.get('BACKUP_LOCAL_DIR', '')).strip()
        if ruta:
            destino = Path(ruta).expanduser()
            if not destino.is_absolute():
                destino = Path(settings.BASE_DIR).parent / destino
        else:
            destino = Path(settings.BASE_DIR).parent / 'backups' / 'respaldos'

        destino.mkdir(parents=True, exist_ok=True)

        # En Railway, escribir fuera de un volumen es tirar el respaldo a la
        # basura: el disco del contenedor no sobrevive al próximo despliegue. No
        # se puede detectar el montaje con certeza, así que se avisa y se sigue.
        if os.environ.get('RAILWAY_STATIC_URL') and not str(destino).startswith(('/data', '/mnt')):
            self.stderr.write(self.style.WARNING(
                f'AVISO: "{destino}" no parece un volumen montado. En Railway el disco del '
                'contenedor se borra en cada despliegue y este respaldo se perderá. '
                'Monta un volumen y apunta BACKUP_LOCAL_DIR ahí (p. ej. /data/backups).'
            ))
        return destino

    def _volcar(self):
        buf = io.StringIO()
        call_command('dumpdata', *[f'--exclude={e}' for e in EXCLUIR],
                     '--natural-foreign', '--natural-primary', '--indent=0', stdout=buf)
        crudo = buf.getvalue().encode('utf-8')
        if len(crudo) < 2:
            raise RuntimeError('el volcado salió vacío')
        return gzip.compress(crudo, compresslevel=6), len(crudo) / 1024

    def _podar(self, destino: Path, retener: int) -> int:
        """Borra los respaldos más viejos y conserva los `retener` más recientes.

        Sin esto el volumen se llena solo y el día que se llena deja de haber
        respaldos, que es exactamente el escenario que se quería evitar.
        """
        if retener <= 0:
            return 0
        archivos = sorted(destino.glob('remali-*.json.gz'), key=lambda p: p.name, reverse=True)
        sobran = archivos[retener:]
        for viejo in sobran:
            try:
                viejo.unlink()
            except OSError:
                pass
        return len(sobran)

    def _avisar_falla(self, motivo: str):
        self.stderr.write(self.style.ERROR(f'RESPALDO FALLIDO: {motivo}'))
        try:
            from maquinaria.models import crear_notificacion
            crear_notificacion(
                'sistema', '⚠️ El respaldo de la base FALLÓ', motivo,
                seccion='configuracion',
            )
        except Exception:
            tragado()
