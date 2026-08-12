from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from maquinaria.ws_events import omitir_en_restauracion, push_panel_event, push_user_event
from ventas.models import Venta


def _emitir_venta_eventos(venta: Venta | None, accion: str):
    if not venta:
        return
    push_panel_event('ventas')
    if not venta.cliente_usuario_id:
        return
    push_user_event(venta.cliente_usuario_id, {
        'topic': 'compras',
        'action': accion,
        'source': 'venta',
        'venta_id': venta.id,
        'cotizacion_id': venta.cotizacion_id,
    })


@receiver(post_save, sender=Venta)
@omitir_en_restauracion
def venta_guardada(sender, instance, created, **kwargs):
    _emitir_venta_eventos(instance, 'creada' if created else 'actualizada')


@receiver(post_delete, sender=Venta)
def venta_eliminada(sender, instance, **kwargs):
    _emitir_venta_eventos(instance, 'eliminada')
