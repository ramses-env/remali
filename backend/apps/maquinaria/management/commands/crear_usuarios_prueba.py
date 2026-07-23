"""Cuentas de prueba para ver el panel con cada rol.

Son para DESARROLLO: las contraseñas están escritas en este archivo y cualquiera
que lea el repositorio las conoce. Por eso el comando se niega a correr con
DEBUG=False, que es como corre producción.

    python manage.py crear_usuarios_prueba
    python manage.py crear_usuarios_prueba --borrar   # quitarlas al terminar
"""
from django.conf import settings
from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand, CommandError

CUENTAS = [
    {
        'username': 'admin_prueba',
        'password': 'remali-admin-2026',
        'first_name': 'Admin', 'last_name': 'de Prueba',
        'email': 'admin.prueba@remali.local',
        'rol': 'Administrador',
        'puesto': 'Asesor de ventas',
        've': 'Todo el negocio: rentas, ventas, cotizaciones, facturación, métricas.',
        'no_ve': 'Usuarios y Configuración del negocio.',
    },
    {
        'username': 'tecnico_prueba',
        'password': 'remali-tecnico-2026',
        'first_name': 'Técnico', 'last_name': 'de Prueba',
        'email': 'tecnico.prueba@remali.local',
        'rol': 'Técnico',
        'puesto': 'Técnico de servicio',
        've': 'Dónde están las máquinas, Inventario, Refacciones, Rentas y Reparaciones.',
        'no_ve': 'Montos, Resumen, Ventas, Cotizaciones, Por facturar, Usuarios y Configuración.',
    },
]


class Command(BaseCommand):
    help = 'Crea (o borra) las cuentas de prueba para revisar el panel con cada rol.'

    def add_arguments(self, parser):
        parser.add_argument('--borrar', action='store_true', help='Elimina las cuentas de prueba.')
        parser.add_argument('--forzar', action='store_true', help='Correr aunque DEBUG esté apagado.')

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts['forzar']:
            raise CommandError(
                'DEBUG está apagado: esto parece producción y estas cuentas tienen '
                'contraseñas públicas. Usa --forzar solo si sabes lo que haces.'
            )

        if opts['borrar']:
            n, _ = User.objects.filter(username__in=[c['username'] for c in CUENTAS]).delete()
            self.stdout.write(self.style.SUCCESS(f'Cuentas de prueba eliminadas ({n} registros).'))
            return

        from maquinaria.models import PerfilUsuario

        self.stdout.write('')
        for c in CUENTAS:
            grupo, _ = Group.objects.get_or_create(name=c['rol'])
            u, creado = User.objects.get_or_create(
                username=c['username'],
                defaults={'email': c['email'], 'first_name': c['first_name'], 'last_name': c['last_name']},
            )
            u.set_password(c['password'])          # se repone en cada corrida
            u.is_active = True
            u.is_staff = False                     # is_staff daría nivel admin y arruinaría la prueba
            u.is_superuser = False
            u.email, u.first_name, u.last_name = c['email'], c['first_name'], c['last_name']
            u.save()
            u.groups.set([grupo])
            PerfilUsuario.objects.update_or_create(usuario=u, defaults={'puesto': c['puesto']})

            estado = 'creada' if creado else 'actualizada'
            self.stdout.write(self.style.SUCCESS(f"  {c['rol']}  ({estado})"))
            self.stdout.write(f"    usuario     {c['username']}")
            self.stdout.write(f"    contraseña  {c['password']}")
            self.stdout.write(f"    ve          {c['ve']}")
            self.stdout.write(f"    no ve       {c['no_ve']}")
            self.stdout.write('')

        self.stdout.write(self.style.WARNING(
            'Cuentas de desarrollo con contraseñas públicas. Bórralas con --borrar '
            'cuando termines de probar, y nunca las lleves a producción.'
        ))
