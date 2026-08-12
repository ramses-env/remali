"""Crea los grupos de los roles nuevos: 'Cajero' y 'Gerente'.

Los roles del panel son grupos de Django y la autorización pregunta por el nombre
del grupo (ver maquinaria.permissions.nivel_de), así que basta con que existan
para que funcionen y aparezcan solos en el selector de Usuarios. Los permisos
finos de Django (cosméticos, para el admin) los asigna `manage.py init_roles`.

    Gerente  opera al nivel de administración (encargado de piso).
    Cajero   usa la caja: vende refacciones y hace su corte, nada más.
"""
from django.db import migrations

ROLES_NUEVOS = ['Cajero', 'Gerente']


def crear(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    for nombre in ROLES_NUEVOS:
        Group.objects.get_or_create(name=nombre)


def borrar(apps, schema_editor):
    # Al revertir se quitan solo si no quedó ninguna cuenta usándolos: deshacer
    # una migración no debe dejar a un usuario sin su grupo.
    Group = apps.get_model('auth', 'Group')
    for nombre in ROLES_NUEVOS:
        grupo = Group.objects.filter(name=nombre).first()
        if grupo and not grupo.user_set.exists():
            grupo.delete()


class Migration(migrations.Migration):
    dependencies = [
        ('maquinaria', '0040_obracliente_empresa'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]
    operations = [migrations.RunPython(crear, borrar)]
