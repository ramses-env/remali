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
                vaciadas = self._vaciar_tablas_del_respaldo(plano)
                self.stdout.write(f'Vaciadas {vaciadas} tablas antes de cargar.')

                call_command('loaddata', plano, verbosity=1)

                # El latido es estado de runtime, no negocio: el respaldo ya no lo
                # trae. Se vacía por si la base venía de una versión anterior, así
                # el primer /latido/ lo regenera coherente con lo recién cargado.
                from maquinaria.models import SelloTema
                SelloTema.objects.all().delete()
            self.stdout.write(self.style.SUCCESS('Restauración completa.'))
        finally:
            if plano != ruta:
                os.unlink(plano)

    def _vaciar_tablas_del_respaldo(self, plano):
        """Deja en cero toda tabla que el respaldo vaya a repoblar.

        Restaurar significa "que la base quede como estaba", y para eso el
        destino tiene que empezar vacío. Sin esto, `loaddata` choca contra las
        filas que `migrate` acaba de sembrar por su cuenta: los ContentType y
        Permission que Django regenera, la "Caja principal" de una migración de
        datos, los grupos de roles… Cada choque es un `IntegrityError` que —al
        ir todo en una transacción— tira la restauración COMPLETA.

        Se iba parcheando tabla por tabla conforme aparecían; esto lo resuelve
        de raíz: se leen los modelos que trae el respaldo y se vacían esos, ni
        uno más. Lo que el respaldo no toca (sesiones, log del admin) se queda.

        Se usa DELETE crudo y no el ORM a propósito: `.delete()` dispararía las
        señales de post_delete y mandaría miles de eventos de WebSocket, además
        de arrastrar cascadas que aquí sobran.
        """
        import json

        from django.apps import apps
        from django.db import connection

        with open(plano, encoding='utf-8') as fh:
            registros = json.load(fh)

        etiquetas = {r['model'] for r in registros if r.get('model')}
        tablas = []
        for etiqueta in etiquetas:
            try:
                tablas.append(apps.get_model(etiqueta)._meta.db_table)
            except LookupError:
                # Modelo de una app que ya no existe (esta base arrastra tipos de
                # una 'shop' vieja). loaddata lo ignorará igual.
                continue

        # Sin desactivar las FK habría que borrar en orden topológico; con ellas
        # apagadas el orden da igual y al terminar la carga todo vuelve a cuadrar.
        with connection.constraint_checks_disabled():
            with connection.cursor() as c:
                for tabla in tablas:
                    c.execute(f'DELETE FROM `{tabla}`')
        return len(tablas)
