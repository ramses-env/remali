"""Sube a Cloudinary los archivos que quedaron SOLO en disco.

Por qué existe: el proyecto empezó guardando media en el sistema de archivos
(`backend/media/`) y después cambió a Cloudinary. Los registros creados antes
del cambio conservan su ruta relativa (`avatars/foo.jpg`), pero ahora Django
construye la URL de Cloudinary para un asset que nunca se subió ahí: la imagen
da 404 y en el panel se ve rota.

Este comando recorre todos los campos de archivo, detecta los que fallan en el
storage activo pero sí existen en `MEDIA_ROOT`, y los sube conservando la MISMA
ruta relativa — así el valor guardado en la base sigue siendo válido y no hay
que tocar ni un registro.

    python manage.py migrar_media_cloudinary            # solo reporta
    python manage.py migrar_media_cloudinary --confirm  # sube de verdad

Es idempotente: lo que ya está en Cloudinary se salta.
"""
import os

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

# (app_label.Modelo, campo). Se resuelven en runtime para no importar apps
# que podrían no estar instaladas en un despliegue recortado.
CAMPOS = [
    ('maquinaria.PerfilUsuario', 'avatar'),
    ('maquinaria.Equipo', 'imagen'),
    ('maquinaria.Equipo', 'ficha_tecnica'),
    ('maquinaria.ImagenProducto', 'imagen'),
    ('renta.EvidenciaRenta', 'imagen'),
    ('cotizaciones.CotizacionFoto', 'imagen'),
]


class Command(BaseCommand):
    help = 'Sube a Cloudinary los archivos de media que quedaron solo en disco.'

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true',
                            help='Sube de verdad. Sin esto solo reporta.')

    def handle(self, *args, **opts):
        from django.apps import apps

        backend = settings.STORAGES['default']['BACKEND']
        self.stdout.write(f'Storage activo: {backend}')
        if 'cloudinary' not in backend.lower():
            self.stdout.write(self.style.WARNING(
                'El storage activo NO es Cloudinary. Este comando no tiene nada que hacer.'
            ))
            return

        subidos, perdidos, ya_ok, fallidos = 0, [], 0, []

        for etiqueta, campo in CAMPOS:
            try:
                modelo = apps.get_model(etiqueta)
            except LookupError:
                continue

            qs = modelo.objects.exclude(**{campo: ''}).exclude(**{f'{campo}__isnull': True})
            for obj in qs.iterator():
                nombre = getattr(obj, campo).name
                if not nombre:
                    continue

                try:
                    if default_storage.exists(nombre):
                        ya_ok += 1
                        continue
                except Exception:
                    pass  # exists() puede fallar por red: se trata como ausente.

                ruta_local = os.path.join(str(settings.MEDIA_ROOT), nombre)
                if not os.path.exists(ruta_local):
                    perdidos.append(f'{etiqueta}#{obj.pk}.{campo} → {nombre}')
                    continue

                if not opts['confirm']:
                    self.stdout.write(f'  [dry-run] subiría {nombre}')
                    subidos += 1
                    continue

                try:
                    with open(ruta_local, 'rb') as fh:
                        # save() con el MISMO nombre: si el storage lo respeta, el
                        # valor de la base sigue apuntando al lugar correcto.
                        guardado = default_storage.save(nombre, fh)
                    if guardado != nombre:
                        # Cloudinary renombró (colisión). Hay que actualizar el
                        # registro o la imagen seguiría rota.
                        setattr(obj, campo, guardado)
                        obj.save(update_fields=[campo])
                        self.stdout.write(f'  subido como {guardado} (registro actualizado)')
                    else:
                        self.stdout.write(f'  subido {nombre}')
                    subidos += 1
                except Exception as e:
                    fallidos.append(f'{nombre}: {type(e).__name__} {e}')

        self.stdout.write('')
        self.stdout.write(f'Ya estaban en Cloudinary: {ya_ok}')
        self.stdout.write(self.style.SUCCESS(
            f'{"Subidos" if opts["confirm"] else "Por subir"}: {subidos}'))

        if perdidos:
            self.stdout.write(self.style.WARNING(
                f'Sin archivo en ningún lado ({len(perdidos)}) — el registro apunta a la nada:'))
            for p in perdidos:
                self.stdout.write(f'  {p}')

        if fallidos:
            self.stdout.write(self.style.ERROR(f'Fallaron ({len(fallidos)}):'))
            for f in fallidos:
                self.stdout.write(f'  {f}')

        if not opts['confirm'] and subidos:
            self.stdout.write('')
            self.stdout.write('Nada se subió todavía. Repite con --confirm.')
