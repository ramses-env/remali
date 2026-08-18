"""Limpia los espacios de invitado que nadie volvió a tocar.

Solo los de INVITADO. El borrador de una cuenta no se purga nunca: el cliente
tiene dónde volver por él, y borrárselo sería quitarle trabajo suyo sin avisar.
El del invitado, en cambio, es una fila que nadie va a reclamar — su única llave
vivía en un navegador que ya se fue.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from cotizaciones.models_borrador import DIAS_PURGA, BorradorCliente, PaqueteAutorizacion


class Command(BaseCommand):
    help = f'Borra espacios de invitado sin actividad en {DIAS_PURGA} días.'

    def add_arguments(self, parser):
        parser.add_argument('--dias', type=int, default=DIAS_PURGA)
        parser.add_argument('--seco', action='store_true', help='Solo dice qué borraría.')

    def handle(self, *args, **opciones):
        corte = timezone.now() - timedelta(days=opciones['dias'])
        borradores = BorradorCliente.objects.filter(espacio_token__isnull=False, actualizado__lt=corte)
        paquetes = PaqueteAutorizacion.objects.filter(espacio_token__isnull=False, congelado_en__lt=corte)
        nb, np = borradores.count(), paquetes.count()

        if opciones['seco']:
            self.stdout.write(f'Borraría {nb} borrador(es) y {np} paquete(s) de invitado.')
            return

        borradores.delete()
        paquetes.delete()
        self.stdout.write(self.style.SUCCESS(f'Purgados {nb} borrador(es) y {np} paquete(s) de invitado.'))
