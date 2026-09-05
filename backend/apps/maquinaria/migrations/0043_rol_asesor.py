"""Crea el grupo del rol 'Asesor'.

El asesor atiende cotizaciones (las arma y las manda a autorizar) sin tocar
precios, inventario ni ventas. Como los demás roles del panel es un grupo de
Django y la autorización pregunta por su nombre (ver maquinaria.permissions),
así que basta con que exista para que funcione y aparezca en el selector de
Usuarios. Los permisos finos (cosméticos) los asigna `manage.py init_roles`.
"""
from django.db import migrations

ROL = 'Asesor'


def crear(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name=ROL)


def borrar(apps, schema_editor):
    # Solo si nadie lo usa: deshacer una migración no debe dejar a un usuario sin
    # su grupo.
    Group = apps.get_model('auth', 'Group')
    grupo = Group.objects.filter(name=ROL).first()
    if grupo and not grupo.user_set.exists():
        grupo.delete()


class Migration(migrations.Migration):
    dependencies = [
        ('maquinaria', '0042_favoritos'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]
    operations = [migrations.RunPython(crear, borrar)]
