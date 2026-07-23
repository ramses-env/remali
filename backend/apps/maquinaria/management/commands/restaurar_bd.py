"""Restaura un respaldo hecho con `respaldar_bd`.

Procedimiento sobre una base recién migrada:

    python manage.py migrate
    python manage.py restaurar_bd remali-2026-07-22_0954.json.gz

El paso que la gente olvida —y por el que suele fallar una restauración— es
vaciar contenttypes y auth.permission: `migrate` los crea automáticamente y
chocan con los del respaldo. Este comando lo hace por ti.

Acepta el archivo comprimido (.json.gz) o el JSON plano.
"""
import gzip
import os
import tempfile

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = 'Restaura un respaldo (.json.gz) generado por respaldar_bd.'

    def add_arguments(self, parser):
        parser.add_argument('archivo', help='Ruta al respaldo (.json.gz o .json)')
        parser.add_argument('--si', action='store_true',
                            help='No preguntar. Úsalo solo en scripts.')

    def handle(self, *args, **opts):
        ruta = opts['archivo']
        if not os.path.exists(ruta):
            raise CommandError(f'No encuentro "{ruta}".')

        if not opts['si']:
            from django.db import connection
            aviso = (f'Vas a SOBREESCRIBIR los datos de la base "{connection.settings_dict.get("NAME")}". '
                     'Escribe "si" para continuar: ')
            if input(aviso).strip().lower() != 'si':
                self.stdout.write('Cancelado.')
                return

        # Descomprimir a un temporal: loaddata necesita un archivo en disco.
        if ruta.endswith('.gz'):
            with gzip.open(ruta, 'rb') as f:
                crudo = f.read()
            tmp = tempfile.NamedTemporaryFile(suffix='.json', delete=False)
            tmp.write(crudo)
            tmp.close()
            plano = tmp.name
        else:
            plano = ruta

        try:
            with transaction.atomic():
                # migrate ya creó estos; el respaldo trae los suyos (incluidos los
                # de apps viejas). Si no se vacían, chocan por clave única.
                from django.contrib.auth.models import Permission
                from django.contrib.contenttypes.models import ContentType
                borrados = Permission.objects.all().delete()[0] + ContentType.objects.all().delete()[0]
                self.stdout.write(f'Limpiados {borrados} contenttypes/permisos autogenerados.')
                call_command('loaddata', plano, verbosity=1)
            self.stdout.write(self.style.SUCCESS('Restauración completa.'))
        finally:
            if plano != ruta:
                os.unlink(plano)
