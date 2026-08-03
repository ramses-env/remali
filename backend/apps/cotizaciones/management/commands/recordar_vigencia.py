"""Recordatorio de vigencia: aviso por correo a cotizaciones ENVIADAS que
vencen en <= 2 días y aún no reciben recordatorio.

Programar diario (ej. Railway cron / crontab):
    python manage.py recordar_vigencia
Usa la plantilla Brevo BREVO_VIGENCIA_TEMPLATE_ID si está configurada;
si no, un correo simple por SMTP. Nunca truena el comando por un correo.
"""
import os
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from cotizaciones.models import Cotizacion


class Command(BaseCommand):
    help = 'Envía recordatorios a cotizaciones por vencer (<=2 días).'

    def handle(self, *args, **opts):
        hoy = timezone.now().date()
        limite = hoy + timedelta(days=2)
        qs = Cotizacion.objects.filter(
            estado='enviada', recordatorio_vigencia__isnull=True,
            vence_el__gte=hoy, vence_el__lte=limite,
        ).exclude(cliente_email='')
        enviados = 0
        for c in qs:
            liga = f"https://remali.mx/api/cotizaciones/publica/{c.token_publico}/pdf/" if c.token_publico else ''
            try:
                template = os.environ.get('BREVO_VIGENCIA_TEMPLATE_ID')
                if template:
                    from maquinaria.correo import enviar_plantilla_brevo
                    enviar_plantilla_brevo(int(template), c.cliente_email, c.cliente_nombre or 'Cliente', {
                        'folio': c.folio, 'vence_el': str(c.vence_el), 'total': str(c.total), 'liga': liga,
                    })
                else:
                    from django.core.mail import send_mail
                    send_mail(
                        f'Tu cotización {c.folio} vence el {c.vence_el}',
                        (f'Hola {c.cliente_nombre or ""},\n\n'
                         f'Tu cotización {c.folio} por ${c.total} vence el {c.vence_el}. '
                         f'Para respetarte estos precios, confírmanos antes de esa fecha.\n'
                         + (f'\nVer cotización: {liga}\n' if liga else '')
                         + '\n— REMALI'),
                        None, [c.cliente_email], fail_silently=False,
                    )
                c.recordatorio_vigencia = timezone.now()
                c.save(update_fields=['recordatorio_vigencia'])
                enviados += 1
            except Exception as e:  # un correo caído no debe frenar al resto
                self.stderr.write(f'{c.folio}: {e}')
        self.stdout.write(self.style.SUCCESS(f'Recordatorios enviados: {enviados} de {qs.count()} candidatas'))

        # ── Cierre por silencio: aceptada que NADIE concretó en 15 días ──
        # La regla de la casa: si el cliente (o su jefe) autorizó pero después
        # no hubo respuesta, la cotización no se hace. Se cierra como
        # rechazada (recuperable por el admin si el cliente reaparece; una
        # cancelada sería terminal).
        from django.db.models import Q
        limite = timezone.now() - timedelta(days=15)
        hoy2 = timezone.now().date()
        silenciosas = (Cotizacion.objects
                       .filter(estado='aceptada', conversiones__isnull=True, rentas_convertidas__isnull=True)
                       .filter(Q(aceptada_en__lt=limite) | Q(aceptada_en__isnull=True, vence_el__lt=hoy2)))
        cerradas = 0
        for cot in silenciosas:
            cot.estado = 'rechazada'
            cot.save(update_fields=['estado'])
            cerradas += 1
            try:
                from maquinaria.models import crear_notificacion
                if cot.usuario_id:
                    crear_notificacion(
                        'sistema',
                        f'Tu cotización {cot.folio} se cerró por falta de respuesta',
                        'Pasaron 15 días desde que quedó lista sin concretarse. Si aún la necesitas, vuelve a cotizar: los precios pueden variar.',
                        ref=f'cot-silencio-{cot.id}',
                        data={'folio': cot.folio, 'cotizacion_id': cot.id},
                        usuario=cot.usuario,
                    )
                crear_notificacion(
                    'sistema',
                    f'{cot.folio} se cerró sola: 15 días aceptada sin concretarse',
                    f'{cot.cliente_nombre or "El cliente"} nunca respondió para concretar. Si reaparece, puedes reabrirla marcándola Aceptada.',
                    seccion='cotizaciones',
                    ref=f'cot-silencio-panel-{cot.id}',
                    data={'cotizacion_id': cot.id, 'folio': cot.folio},
                )
            except Exception as e:
                self.stderr.write(f'{cot.folio} (aviso): {e}')
        if cerradas:
            self.stdout.write(self.style.SUCCESS(f'Cerradas por silencio: {cerradas}'))
