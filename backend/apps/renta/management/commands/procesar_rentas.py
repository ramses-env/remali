"""Activa las reservas cuya fecha de inicio ya llegó (reservada -> activa).

Pensado para correr una vez al día por cron / tarea programada:

    python manage.py procesar_rentas
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from renta.models import Renta


class Command(BaseCommand):
    help = 'Activa reservas cuya fecha de inicio ya llegó (reservada -> activa).'

    def handle(self, *args, **options):
        hoy = timezone.localdate()
        pendientes = Renta.objects.filter(estado='reservada', fecha_inicio__lte=hoy)
        activadas = 0
        for r in pendientes:
            try:
                r.activar()
                activadas += 1
                self.stdout.write(f'  ✓ Renta #{r.id} ({r.inventario.codigo}) activada.')
            except Exception as e:  # noqa: BLE001
                self.stderr.write(f'  ✗ Renta #{r.id}: {e}')
        self.stdout.write(self.style.SUCCESS(f'{activadas} reserva(s) activada(s) de {pendientes.count()} pendiente(s).'))
