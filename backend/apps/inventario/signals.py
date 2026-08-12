from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from inventario.models import OrdenReparacion, OrdenReparacionItem
from maquinaria.ws_events import omitir_en_restauracion, push_panel_event, push_user_event


def _emitir_reparacion_eventos(orden: OrdenReparacion | None, accion: str, origen: str):
    if not orden:
        return
    push_panel_event('reparaciones')
    if not orden.usuario_id:
        return
    push_user_event(orden.usuario_id, {
        'topic': 'reparaciones',
        'action': accion,
        'source': origen,
        'reparacion_id': orden.id,
        'folio': orden.folio,
    })


@receiver(post_save, sender=OrdenReparacion)
@omitir_en_restauracion
def reparacion_guardada(sender, instance, created, **kwargs):
    _emitir_reparacion_eventos(instance, 'creada' if created else 'actualizada', 'reparacion')


@receiver(post_delete, sender=OrdenReparacion)
def reparacion_eliminada(sender, instance, **kwargs):
    _emitir_reparacion_eventos(instance, 'eliminada', 'reparacion')


@receiver(post_save, sender=OrdenReparacionItem)
@omitir_en_restauracion
def reparacion_item_guardado(sender, instance, created, **kwargs):
    _emitir_reparacion_eventos(instance.orden, 'item_creado' if created else 'item_actualizado', 'reparacion_item')


@receiver(post_delete, sender=OrdenReparacionItem)
def reparacion_item_eliminado(sender, instance, **kwargs):
    _emitir_reparacion_eventos(instance.orden, 'item_eliminado', 'reparacion_item')
