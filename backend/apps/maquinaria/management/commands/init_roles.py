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
APPS_PANEL = ['maquinaria', 'inventario', 'refacciones', 'renta', 'ventas', 'cotizaciones', 'clientes', 'facturacion']

# Indexados por CLAVE, no por nombre: el dueño puede renombrar sus puestos, y un
# comando que fuera por el nombre le crearía un "Cajero" vacío al lado de su
# "Mostrador" cada vez que se despliega.
ROLES = {
    'administrador': 'todo',
    # Administración DELEGADA. Mismos permisos finos de Django que el
    # Administrador: lo que lo distingue (no ve las métricas, no borra del
    # catálogo, no toca los datos bancarios y sus acciones delicadas las autoriza
    # el DUEÑO con su NIP) lo impone `puede_de` y las clases de permiso, no esta
    # tabla, que solo alimenta el admin de Django.
    'gestor': 'todo',
    'tecnico': ['view', 'change'],   # ve y ajusta equipo; no borra ni configura
    # Cajero solo consulta en el admin de Django; la caja de verdad (vender
    # refacciones, corte) la gobierna PuedeUsarCaja, no estos permisos.
    'cajero': ['view'],
}

# Roles retirados. Se BORRAN al correr el comando para que no vuelvan a aparecer
# en el selector de rol cada vez que se despliega. 'Gerente' era idéntico a
# Administrador y 'Asesor' no lo usaba nadie; si mañana hace falta un puesto
# intermedio se creará con sus propias reglas, no reviviendo un duplicado.
ROLES_RETIRADOS = ['Gerente', 'Asesor']


class Command(BaseCommand):
    help = 'Crea los roles del panel (Administrador, Gestor, Técnico, Cajero) y asigna sus permisos.'

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

        # El nombre sale de la tabla `Rol`, que es la que sabe cómo se llama hoy
        # cada puesto. Si la fila no existe todavía (base recién creada), se cae
        # al nombre de fábrica, que es con el que nace.
        from maquinaria.models import Rol
        from maquinaria.permissions import NIVEL_FABRICA, NOMBRE_FABRICA

        for clave, alcance in ROLES.items():
            fila = Rol.objects.filter(clave=clave).first()
            if not fila:
                fila = Rol.objects.create(clave=clave, nombre=NOMBRE_FABRICA[clave],
                                          nivel=NIVEL_FABRICA[clave], protegido=True)
            nombre = fila.nombre
            grupo, creado = Group.objects.get_or_create(name=nombre)
            permisos = del_panel if alcance == 'todo' else del_panel.filter(
                codename__regex=r'^(' + '|'.join(alcance) + ')_'
            )
            grupo.permissions.set(permisos)
            self.stdout.write(self.style.SUCCESS(
                f'{"Creado" if creado else "Actualizado"} rol "{nombre}" con {permisos.count()} permisos.'
            ))

        # Roles retirados: se borran SIEMPRE, no solo con --limpiar. Si el grupo
        # sobrevive, vuelve a salir en el selector de rol del panel y alguien
        # puede asignarlo sin querer. Quien lo tuviera queda sin rol y sin acceso
        # al panel hasta que se le asigne uno de los vigentes: es lo acordado, y
        # es el lado seguro (nadie se queda con permisos de un rol que ya no se
        # mantiene).
        for nombre in ROLES_RETIRADOS:
            grupo = Group.objects.filter(name=nombre).first()
            if not grupo:
                continue
            afectados = list(grupo.user_set.values_list('username', flat=True))
            grupo.delete()
            if afectados:
                self.stdout.write(self.style.WARNING(
                    f'Rol retirado "{nombre}" borrado. Se quedaron SIN ROL (y sin acceso '
                    f'al panel): {", ".join(afectados)}. Asígnales un rol vigente.'
                ))
            else:
                self.stdout.write(self.style.SUCCESS(
                    f'Rol retirado "{nombre}" borrado (no lo tenía nadie).'
                ))
