"""Los cuatro puestos de fábrica pasan a ser filas, y los permisos guardados
dejan de apuntar al NOMBRE para apuntar a la CLAVE.

Es el paso que hace posible renombrar un puesto sin que se le caigan los
permisos: a partir de aquí `permiso_rol.rol` guarda 'cajero', no 'Cajero'.
"""
from django.db import migrations

# (clave, nombre de fábrica, nivel)
FABRICA = [
    ('administrador', 'Administrador', 2),
    ('gestor', 'Gestor', 2),
    ('cajero', 'Cajero', 1),
    ('tecnico', 'Técnico', 1),
]
# Cómo se llamaban antes las filas de permisos. 'Almacén' es el nombre viejo del
# técnico: si quedó alguna fila con ese nombre, va al mismo puesto.
NOMBRE_A_CLAVE = {n: c for c, n, _ in FABRICA}
NOMBRE_A_CLAVE['Almacén'] = 'tecnico'


def sembrar(apps, schema_editor):
    Rol = apps.get_model('maquinaria', 'Rol')
    Group = apps.get_model('auth', 'Group')
    PermisoRol = apps.get_model('maquinaria', 'PermisoRol')
    CambioPermisoRol = apps.get_model('maquinaria', 'CambioPermisoRol')

    for clave, nombre, nivel in FABRICA:
        Rol.objects.get_or_create(
            clave=clave,
            defaults={'nombre': nombre, 'nivel': nivel, 'protegido': True},
        )
        # El grupo es lo que liga a la gente con su puesto; si falta, el puesto
        # existiría sin poder asignarse a nadie.
        Group.objects.get_or_create(name=nombre)

    for modelo in (PermisoRol, CambioPermisoRol):
        for fila in modelo.objects.all():
            clave = NOMBRE_A_CLAVE.get(fila.rol)
            if clave and clave != fila.rol:
                fila.rol = clave
                fila.save(update_fields=['rol'])


def deshacer(apps, schema_editor):
    """Devuelve los nombres a las filas de permisos. Los puestos creados por el
    dueño no tienen nombre de fábrica al que volver: sus filas se quedan con la
    clave, que es lo más honesto que se puede hacer al retroceder."""
    PermisoRol = apps.get_model('maquinaria', 'PermisoRol')
    CambioPermisoRol = apps.get_model('maquinaria', 'CambioPermisoRol')
    clave_a_nombre = {c: n for c, n, _ in FABRICA}
    for modelo in (PermisoRol, CambioPermisoRol):
        for fila in modelo.objects.all():
            nombre = clave_a_nombre.get(fila.rol)
            if nombre:
                fila.rol = nombre
                fila.save(update_fields=['rol'])


class Migration(migrations.Migration):

    dependencies = [
        ('maquinaria', '0056_cambiopermisorol_detalle_and_more'),
    ]

    operations = [
        migrations.RunPython(sembrar, deshacer),
    ]
