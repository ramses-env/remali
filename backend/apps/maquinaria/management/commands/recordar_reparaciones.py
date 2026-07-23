"""Recuerda las reparaciones que se están quedando atrás.

Una reparación puede durar varios días, y con la carga del taller es fácil que
una se quede olvidada: recibida pero sin empezar, o empezada y sin avance. Este
comando corre a diario (junto con el cron de rentas) y avisa por notificación —
que el técnico y administración ya ven en el panel.

No molesta de más: una máquina recién ingresada tiene margen antes del primer
aviso, y solo se genera un recordatorio por orden por día.

    python manage.py recordar_reparaciones
    python manage.py recordar_reparaciones --dias-recibida 1 --dias-proceso 2
"""
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = 'Avisa de reparaciones sin empezar o sin avance para que no se olviden.'

    def add_arguments(self, parser):
        parser.add_argument('--dias-recibida', type=int, default=1,
                            help='Días que una orden puede estar recibida sin empezar antes de avisar.')
        parser.add_argument('--dias-proceso', type=int, default=2,
                            help='Días sin avance en una orden empezada antes de avisar.')

    def handle(self, *args, **opts):
        from inventario.models import OrdenReparacion
        from maquinaria.models import crear_notificacion

        ahora = timezone.now()
        hoy = timezone.localdate().isoformat()
        umbral = {'recibida': opts['dias_recibida'], 'proceso': opts['dias_proceso']}

        avisadas = 0
        # Se ordena por la más rezagada primero, por si algún día hay muchas.
        qs = (OrdenReparacion.objects
              .filter(estado__in=['recibida', 'proceso'])
              .select_related('unidad', 'unidad__equipo')
              .order_by('actualizado_en'))

        for o in qs:
            # actualizado_en es auto_now: se mueve al agregar una refacción o
            # cambiar el estado. Sin actividad reciente = orden estancada.
            dias_quieta = (ahora - o.actualizado_en).days
            if dias_quieta < umbral[o.estado]:
                continue

            equipo = (o.unidad.equipo.modelo if o.unidad and o.unidad.equipo else o.equipo_descripcion) or 'Equipo'
            de_quien = 'máquina propia' if o.tipo == 'interna' else (o.cliente_nombre or 'un cliente')
            if o.estado == 'recibida':
                titulo = f'Reparación sin empezar · {equipo}'
                mensaje = f'{o.folio} ({de_quien}) lleva {dias_quieta} día(s) en taller y no se ha empezado.'
            else:
                titulo = f'Reparación pausada · {equipo}'
                mensaje = f'{o.folio} ({de_quien}) sin avance desde hace {dias_quieta} día(s).'

            # La fecha en la ref hace que el aviso se repita cada día (mientras
            # siga estancada) sin duplicarse dentro del mismo día.
            creada = crear_notificacion(
                'alerta', titulo, mensaje, seccion='reparaciones',
                ref=f'recordatorio-orden-{o.id}-{hoy}',
                data={'orden_id': o.id, 'dias': dias_quieta},
            )
            if creada:
                avisadas += 1

        self.stdout.write(self.style.SUCCESS(
            f'Recordatorios de reparación enviados: {avisadas}.'
        ))
