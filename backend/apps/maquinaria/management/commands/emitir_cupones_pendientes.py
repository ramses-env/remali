"""Los cupones de quienes completaron su perfil ANTES de que existiera el código.

El 5% se prometía en pantalla desde el principio, pero nadie lo emitía. Toda esa
gente vio "Todo listo — tu 5% te espera" y se quedó sin nada. Esto se lo da.

De un solo uso en la práctica: `recompensado` impide repetirlo, así que correrlo
dos veces no duplica nada.

    python manage.py emitir_cupones_pendientes            # a quién le tocaría
    python manage.py emitir_cupones_pendientes --aplicar  # emitirlos
"""
from django.core.management.base import BaseCommand

from maquinaria.cupon_bienvenida import emitir_si_toca, perfil_esta_completo
from maquinaria.models import PerfilUsuario


class Command(BaseCommand):
    help = 'Emite el cupón de bienvenida a quien ya completó su perfil y no lo recibió.'

    def add_arguments(self, parser):
        parser.add_argument('--aplicar', action='store_true',
                            help='Sin esto solo se listan, no se emite nada.')

    def handle(self, *args, **opciones):
        aplicar = opciones['aplicar']
        pendientes = [p for p in PerfilUsuario.objects.filter(recompensado=False)
                      .select_related('usuario')
                      if perfil_esta_completo(p)]

        if not pendientes:
            self.stdout.write('Nadie pendiente: todos los perfiles completos ya tienen su cupón.')
            return

        for p in pendientes:
            quien = p.usuario.get_full_name() or p.usuario.get_username()
            if aplicar:
                cupon = emitir_si_toca(p)
                self.stdout.write(f'  ✓ {quien} → {cupon.codigo}' if cupon else f'  · {quien} (ya lo tenía)')
            else:
                self.stdout.write(f'  · {quien} ({p.usuario.email})')

        if aplicar:
            self.stdout.write(self.style.SUCCESS(f'{len(pendientes)} cupón(es) emitido(s).'))
        else:
            self.stdout.write(f'{len(pendientes)} pendiente(s). Corre con --aplicar para emitirlos.')
