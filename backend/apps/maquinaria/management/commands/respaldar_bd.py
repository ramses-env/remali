"""Respaldo de la base de datos.

Usa `dumpdata` en vez de mysqldump a propósito: no depende de binarios que el
contenedor no trae, funciona igual en MySQL y SQLite, y se restaura con
`loaddata` sin importar el motor.

El archivo se sube al mismo almacenamiento remoto que las fichas técnicas
(Cloudinary si está configurado). Guardarlo en el disco del contenedor no
serviría de nada: en Railway ese disco se borra en cada despliegue, que es
justo cuando más falta haría el respaldo.

Uso:
    python manage.py respaldar_bd
    python manage.py respaldar_bd --local     # forzar guardado en disco
"""
import gzip
import io

from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

# Lo único que NO se respalda: sesiones abiertas y el log del admin de Django.
# Son efímeros y no valen nada al restaurar.
#
# contenttypes y auth.permission SÍ se incluyen aunque `migrate` los regenere:
# los permisos de los grupos se guardan por nombre natural y necesitan que su
# ContentType exista. Esta base arrastra tipos de una app vieja ('shop'), y sin
# ellos la restauración truena. `restaurar_bd` limpia esas dos tablas antes de
# cargar para que no choquen con las que crea migrate.
EXCLUIR = ['sessions', 'admin.logentry']


class Command(BaseCommand):
    help = 'Respalda la base de datos a un archivo comprimido en el almacenamiento remoto.'

    def add_arguments(self, parser):
        parser.add_argument('--local', action='store_true',
                            help='Guarda en el disco local aunque haya almacenamiento remoto.')

    def handle(self, *args, **opts):
        marca = timezone.localtime().strftime('%Y-%m-%d_%H%M')
        nombre = f'respaldos/remali-{marca}.json.gz'

        # 1) Volcar a memoria (esta base es chica; no vale la pena un temporal).
        buf = io.StringIO()
        call_command('dumpdata', *[f'--exclude={e}' for e in EXCLUIR],
                     '--natural-foreign', '--natural-primary', '--indent=0', stdout=buf)
        crudo = buf.getvalue().encode('utf-8')
        if len(crudo) < 2:
            self.stderr.write(self.style.ERROR('El volcado salió vacío; no se guardó nada.'))
            return
        comprimido = gzip.compress(crudo, compresslevel=6)

        # 2) Guardar donde sobreviva al próximo despliegue.
        if opts['local']:
            from django.core.files.storage import default_storage as storage
        else:
            from maquinaria.models import select_ficha_storage
            storage = select_ficha_storage()
        ruta = storage.save(nombre, ContentFile(comprimido))

        kb = len(comprimido) / 1024
        detalle = f'{ruta} · {kb:.0f} KB (de {len(crudo) / 1024:.0f} KB sin comprimir)'
        self.stdout.write(self.style.SUCCESS(f'Respaldo listo: {detalle}'))

        # 3) Dejar rastro en el panel: si el cron deja de correr, se nota.
        try:
            from maquinaria.models import crear_notificacion
            crear_notificacion(
                'sistema', 'Respaldo de la base realizado', detalle,
                seccion='configuracion', ref=f'respaldo-{marca}',
            )
        except Exception:
            pass
