"""Contrasta el inventario contra sus rentas y ventas. Solo lee, no arregla nada.

Cada unidad es una máquina física. Si el registro dice "disponible" y la máquina
está en una obra, el catálogo la vende dos veces; si dice "vendida" y sigue en la
bodega, deja de existir para el negocio. Este comando pregunta lo mismo desde los
dos lados —qué dice la unidad y qué dicen sus operaciones— y reporta dónde no
coinciden.

    python manage.py revisar_inventario
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Revisa que el estado de cada unidad coincida con sus rentas y ventas.'

    def handle(self, *args, **opciones):
        from inventario.models import Inventario
        from renta.models import Renta
        from ventas.models import Venta

        unidades = list(Inventario.objects.select_related('equipo'))
        desajustes = 0

        def etiqueta(u):
            return f'{u.codigo} ({u.equipo.modelo if u.equipo_id and u.equipo else "?"})'

        def revisar(titulo, filas):
            nonlocal desajustes
            if filas:
                desajustes += len(filas)
                self.stdout.write(self.style.ERROR(f'✗ {titulo} — {len(filas)}'))
                for f in filas:
                    self.stdout.write(f'    {f}')
            else:
                self.stdout.write(self.style.SUCCESS(f'✓ {titulo}: ninguna'))

        revisar('Unidades RENTADAS sin renta activa', [
            etiqueta(u) for u in unidades
            if u.estado == 'rentado'
            and not Renta.objects.filter(inventario=u, estado='activa').exists()
        ])
        revisar('Rentas ACTIVAS cuya unidad no está rentada', [
            f'renta #{r.id} · {etiqueta(r.inventario)} está {r.inventario.estado}'
            for r in Renta.objects.filter(estado='activa').select_related('inventario', 'inventario__equipo')
            if r.inventario.estado != 'rentado'
        ])
        revisar('Unidades con más de una renta activa a la vez', [
            f'{etiqueta(u)}: {n} rentas activas'
            for u, n in ((u, Renta.objects.filter(inventario=u, estado='activa').count()) for u in unidades)
            if n > 1
        ])
        revisar('Unidades VENDIDAS sin una venta viva que las respalde', [
            etiqueta(u) for u in unidades
            if u.estado == 'vendido'
            and not Venta.objects.filter(inventario=u).exclude(estado='cancelada').exists()
        ])
        revisar('Ventas ACTIVAS cuya unidad no está vendida', [
            f'venta #{v.id} · {etiqueta(v.inventario)} está {v.inventario.estado}'
            for v in Venta.objects.filter(estado='activa').exclude(inventario=None).select_related('inventario', 'inventario__equipo')
            if v.inventario.estado != 'vendido'
        ])
        revisar('Unidades APARTADAS sin una venta apartada', [
            etiqueta(u) for u in unidades
            if u.estado == 'apartado'
            and not Venta.objects.filter(inventario=u, estado='apartada').exists()
        ])
        revisar('Ventas APARTADAS cuya unidad no está apartada', [
            f'venta #{v.id} · {etiqueta(v.inventario)} está {v.inventario.estado}'
            for v in Venta.objects.filter(estado='apartada').exclude(inventario=None).select_related('inventario', 'inventario__equipo')
            if v.inventario.estado != 'apartado'
        ])

        # No es un error, pero sí una sorpresa cara: cuenta como stock y no se
        # puede vender, porque una renta ya la tiene apalabrada.
        reservadas = [
            f'{etiqueta(u)} · comprometida en la renta #{u.renta_comprometida().id}'
            for u in unidades
            if u.estado == 'disponible' and u.renta_comprometida() is not None
        ]
        if reservadas:
            self.stdout.write(self.style.WARNING(
                f'\n! Disponibles pero ya apalabradas por una reserva ({len(reservadas)}): '
                f'cuentan como stock y NO se pueden vender.'))
            for r in reservadas:
                self.stdout.write(f'    {r}')

        self.stdout.write('')
        resumen = f'{len(unidades)} unidades · {Renta.objects.count()} rentas · {Venta.objects.count()} ventas'
        if desajustes:
            self.stdout.write(self.style.ERROR(f'{resumen} → {desajustes} desajuste(s)'))
        else:
            self.stdout.write(self.style.SUCCESS(f'{resumen} → todo cuadra'))
