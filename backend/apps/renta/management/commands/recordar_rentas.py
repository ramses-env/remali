"""Recordatorios de devolución: que al cliente no se le pase traer la máquina.

Esto es lo que SUSTITUYE al recargo por retraso. REMALI no cobra por tardarse,
así que la herramienta no puede ser un cargo: es no dejar que se olvide. Un
recordatorio a tiempo devuelve la máquina al patio, que es lo que de verdad
quiere la empresa; un recargo solo infla una deuda que nadie va a cobrar.

Calendario, contado sobre `fecha_fin`:

    −1 día   "tu renta vence mañana"
     0       "tu renta vence hoy"
    +2, +4…  "ya venció, ¿cuándo la traes?" cada dos días, mientras siga afuera

El día +1 se salta a propósito: avisar dos días seguidos (el día que vence y el
siguiente) se lee como regaño y enseña a ignorar la campana.

Solo llega a clientes CON CUENTA, que son los únicos que tienen dónde recibirlo.
A los demás los atiende la lista de "A quién recordarle" del panel, que trae
teléfono y botón de WhatsApp (endpoint `rentas/recordatorios/`).

Programar diario junto a los otros recordatorios (ver railway.cron.json):

    python manage.py recordar_rentas
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from renta.models import Renta


def clave_recordatorio(dias_restantes):
    """Qué recordatorio toca hoy, o None si hoy no toca ninguno.

    La clave entra en el `ref` de la notificación, y de ahí sale la idempotencia:
    si el cron corre dos veces (un reintento, un redeploy) el aviso no se manda
    doble, porque `crear_notificacion` descarta una `ref` que ya existe.
    """
    if dias_restantes == 1:
        return 'previo'
    if dias_restantes == 0:
        return 'hoy'
    retraso = -dias_restantes
    if retraso >= 2 and retraso % 2 == 0:
        return f'retraso-{retraso}'
    return None


def texto_recordatorio(clave, equipo, retraso):
    if clave == 'previo':
        return ('Tu renta vence mañana',
                f'Mañana termina la renta de {equipo}. Si necesitas más días, avísanos '
                f'y la extendemos; si no, te esperamos para recogerla.')
    if clave == 'hoy':
        return ('Tu renta vence hoy',
                f'Hoy termina la renta de {equipo}. ¿La traes tú o pasamos por ella?')
    return ('Tu renta ya venció',
            f'La renta de {equipo} venció hace {retraso} días. Escríbenos para '
            f'coordinar la recolección o para extenderla.')


class Command(BaseCommand):
    help = 'Avisa a los clientes que su renta está por vencer o ya venció.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Enseña qué mandaría, sin crear notificaciones.')

    def handle(self, *args, **opts):
        from maquinaria.models import crear_notificacion

        seco = opts.get('dry_run')
        hoy = timezone.localdate()
        qs = (Renta.objects.filter(estado='activa', usuario__isnull=False)
              .select_related('inventario', 'inventario__equipo', 'usuario'))

        mandados = 0
        for r in qs:
            if not r.fecha_fin:
                continue
            dias = (r.fecha_fin - hoy).days
            clave = clave_recordatorio(dias)
            if not clave:
                continue
            equipo = (r.inventario.equipo.modelo
                      if r.inventario_id and r.inventario.equipo else 'tu equipo')
            titulo, cuerpo = texto_recordatorio(clave, equipo, -dias)
            if seco:
                self.stdout.write(f'  · Renta #{r.id} → {r.usuario}: {titulo}')
                mandados += 1
                continue
            creada = crear_notificacion(
                'renta', titulo, cuerpo,
                seccion='mis-rentas',
                ref=f'recordatorio-renta-{r.id}-{clave}',
                usuario=r.usuario,
                data={'renta_id': r.id, 'vence': r.fecha_fin.isoformat()},
            )
            if creada:
                mandados += 1
                self.stdout.write(f'  ✓ Renta #{r.id} ({equipo}) → {titulo}')

        etiqueta = 'se mandarían' if seco else 'mandados'
        self.stdout.write(self.style.SUCCESS(f'{mandados} recordatorio(s) {etiqueta}.'))
