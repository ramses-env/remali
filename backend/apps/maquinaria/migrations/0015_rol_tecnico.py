"""Renombra el rol 'Almacén' a 'Técnico'.

Se renombra el grupo existente en vez de crear uno nuevo: así las cuentas que ya
lo tenían conservan su acceso sin tocarlas. Si el grupo nuevo ya existiera (por
haber corrido init_roles antes), se mueven los usuarios y se borra el viejo.
"""
from django.db import migrations

VIEJO, NUEVO = 'Almacén', 'Técnico'


def renombrar(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    viejo = Group.objects.filter(name=VIEJO).first()
    if not viejo:
        return
    nuevo = Group.objects.filter(name=NUEVO).first()
    if nuevo:
        # Ya existían los dos: consolidamos en el nuevo y quitamos el viejo.
        for u in viejo.user_set.all():
            nuevo.user_set.add(u)
        viejo.delete()
    else:
        viejo.name = NUEVO
        viejo.save(update_fields=['name'])


def revertir(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    grupo = Group.objects.filter(name=NUEVO).first()
    if grupo and not Group.objects.filter(name=VIEJO).exists():
        grupo.name = VIEJO
        grupo.save(update_fields=['name'])


class Migration(migrations.Migration):
    dependencies = [
        ('maquinaria', '0014_configuracionsitio_correoaviso'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]
    operations = [migrations.RunPython(renombrar, revertir)]
