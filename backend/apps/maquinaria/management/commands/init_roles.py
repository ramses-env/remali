"""Crea los roles del panel y, opcionalmente, limpia permisos huérfanos.

Los roles son grupos de Django. El control de acceso real (`IsAdminGroupOrStaff`)
pregunta si el usuario pertenece a 'Administrador'; los permisos finos de Django
no se usan hoy, pero se asignan para que el admin de Django sea coherente.

Este comando estaba roto: importaba modelos (Orden, ItemOrden…) de cuando la app
se llamaba 'shop'. De ese renombre quedaron ContentTypes apuntando a modelos que
ya no existen, y con ellos los permisos de los grupos. `--limpiar` los borra.

Uso:
    python manage.py init_roles
    python manage.py init_roles --limpiar     # además, quita los huérfanos
"""
from django.apps import apps
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand

# Apps cuyos permisos administra el panel.
APPS_PANEL = ['maquinaria', 'inventario', 'refacciones', 'renta', 'ventas', 'cotizaciones', 'empresas', 'facturacion']

ROLES = {
    'Administrador': 'todo',
    # Gerente opera al nivel de administración; el nombre distingue al encargado
    # de piso del dueño. Mismos permisos finos que Administrador (cosméticos).
    'Gerente': 'todo',
    'Técnico': ['view', 'change'],   # ve y ajusta equipo; no borra ni configura
    # Cajero solo consulta en el admin de Django; la caja de verdad (vender
    # refacciones, corte) la gobierna PuedeUsarCaja, no estos permisos.
    'Cajero': ['view'],
    # Asesor consulta y crea (cotizaciones, clientes); la regla real la impone
    # PuedeCotizar. No edita ni borra, no convierte a venta.
    'Asesor': ['view', 'add'],
}


class Command(BaseCommand):
    help = 'Crea los roles del panel (Administrador, Gerente, Técnico, Cajero, Asesor) y asigna sus permisos.'

    def add_arguments(self, parser):
        parser.add_argument('--limpiar', action='store_true',
                            help='Borra ContentTypes y permisos de apps que ya no existen.')

    def handle(self, *args, **opts):
        vivas = {a.label for a in apps.get_app_configs()}

        if opts['limpiar']:
            huerfanos = ContentType.objects.exclude(app_label__in=vivas)
            etiquetas = sorted({c.app_label for c in huerfanos})
            n_perms = Permission.objects.filter(content_type__in=huerfanos).count()
            n_ct = huerfanos.count()
            huerfanos.delete()   # arrastra sus permisos y las filas de grupo
            self.stdout.write(self.style.WARNING(
                f'Limpiados {n_ct} contenttypes y {n_perms} permisos de apps que ya no existen: '
                f'{", ".join(etiquetas) or "ninguna"}.'
            ))

        del_panel = Permission.objects.filter(content_type__app_label__in=APPS_PANEL)

        for nombre, alcance in ROLES.items():
            grupo, creado = Group.objects.get_or_create(name=nombre)
            permisos = del_panel if alcance == 'todo' else del_panel.filter(
                codename__regex=r'^(' + '|'.join(alcance) + ')_'
            )
            grupo.permissions.set(permisos)
            self.stdout.write(self.style.SUCCESS(
                f'{"Creado" if creado else "Actualizado"} rol "{nombre}" con {permisos.count()} permisos.'
            ))
