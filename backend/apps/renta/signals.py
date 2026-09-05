from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from maquinaria.ws_events import omitir_en_restauracion, push_panel_event, push_user_event
from renta.models import Renta


def _emitir_renta_eventos(renta: Renta | None, accion: str):
    if not renta:
        return
    push_panel_event('rentas')
    if not renta.usuario_id:
        return
    base = {
        'action': accion,
        'source': 'renta',
        'renta_id': renta.id,
        'cotizacion_id': renta.cotizacion_id,
    }
    push_user_event(renta.usuario_id, {'topic': 'rentas', **base})
    push_user_event(renta.usuario_id, {'topic': 'adeudos', **base})


@receiver(post_save, sender=Renta)
@omitir_en_restauracion
def renta_guardada(sender, instance, created, **kwargs):
    _emitir_renta_eventos(instance, 'creada' if created else 'actualizada')


@receiver(post_delete, sender=Renta)
def renta_eliminada(sender, instance, **kwargs):
    _emitir_renta_eventos(instance, 'eliminada')
