"""Le avisa AL CLIENTE que su autorizador no ha contestado.

Una liga que lleva días en silencio es una venta enfriándose, y hoy nadie hace
nada porque nadie la está viendo: el cliente la mandó y se olvidó, y REMALI —a
propósito— ni sabe que existe.

El aviso va a quien la mandó, nunca a REMALI. Esa es la línea: el negocio no
tiene por qué enterarse de que al jefe de alguien se le pasó contestar. Lo único
que hacemos es darle al cliente la oportunidad de insistir.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from cotizaciones.models_borrador import DIAS_RECORDATORIO, PaqueteAutorizacion


class Command(BaseCommand):
    help = 'Avisa al cliente cuando su autorizador lleva días sin responder.'

    def add_arguments(self, parser):
        parser.add_argument('--dias', type=int, default=DIAS_RECORDATORIO)
        parser.add_argument('--seco', action='store_true', help='Solo dice a quién avisaría.')

    def handle(self, *args, **opciones):
        from maquinaria.models import Notificacion

        corte = timezone.now() - timedelta(days=opciones['dias'])
        hoy = timezone.now().date()
        pendientes = (PaqueteAutorizacion.objects
                      .filter(estado='pendiente', recordatorio_en__isnull=True, congelado_en__lt=corte)
                      .filter(vence_el__gte=hoy)      # si ya venció, el recordatorio no sirve de nada
                      .prefetch_related('borradores__items__equipo'))

        avisados = 0
        for p in pendientes:
            borradores = list(p.borradores.all())
            if not borradores:
                continue
            contacto = borradores[0].datos_contacto or {}
            dias = (timezone.now() - p.congelado_en).days
            cuantas = len(borradores)
            titulo = 'Quien autoriza no ha contestado'
            cuerpo = (
                f'La liga que mandaste hace {dias} días sigue sin respuesta '
                f'({cuantas} cotización{"es" if cuantas > 1 else ""}, ${p.total}). '
                f'Los precios están congelados hasta el {p.vence_el.strftime("%d/%m/%Y")}: '
                f'si pasa esa fecha hay que armarla de nuevo. '
                f'Puedes reenviarle la liga desde "Mis cotizaciones".'
            )

            if opciones['seco']:
                self.stdout.write(f'Avisaría a {contacto.get("nombre") or p.usuario_id or contacto.get("email")}: {dias} días')
                continue

            # En la campanita, si tiene cuenta.
            if p.usuario_id:
                try:
                    Notificacion.objects.create(usuario_id=p.usuario_id, tipo='sistema', titulo=titulo,
                                                mensaje=cuerpo, seccion='cotizaciones',
                                                ref=f'paquete-recordatorio-{p.id}')
                except Exception:
                    pass

            # Y por correo, que es lo único que le llega al invitado sin cuenta.
            correo = (contacto.get('email') or '').strip()
            if correo:
                try:
                    from maquinaria.correo import enviar_async
                    enviar_async(f'Tu cotización sigue esperando autorización', cuerpo, [correo])
                except Exception:
                    pass

            p.recordatorio_en = timezone.now()
            p.save(update_fields=['recordatorio_en'])
            avisados += 1

        if not opciones['seco']:
            self.stdout.write(self.style.SUCCESS(f'Recordatorios enviados: {avisados}'))
