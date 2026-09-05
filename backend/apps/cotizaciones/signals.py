from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from cotizaciones.models import Cotizacion, CotizacionFoto, CotizacionItem
from maquinaria.ws_events import omitir_en_restauracion, push_panel_event, push_user_event
from renta.models import Renta
from ventas.models import Venta


def _emitir_cambio_cotizacion(cot: Cotizacion | None, accion: str, origen: str):
    if not cot or not cot.usuario_id:
        if cot:
            push_panel_event('cotizaciones')
        return
    payload = {
        'topic': 'cotizaciones',
        'action': accion,
        'source': origen,
        'cotizacion_id': cot.id,
        'folio': cot.folio,
    }
    push_user_event(cot.usuario_id, payload)
    push_panel_event('cotizaciones')


@receiver(post_save, sender=Cotizacion)
@omitir_en_restauracion
def cotizacion_guardada(sender, instance, created, **kwargs):
    _emitir_cambio_cotizacion(instance, 'creada' if created else 'actualizada', 'cotizacion')


@receiver(post_delete, sender=Cotizacion)
def cotizacion_eliminada(sender, instance, **kwargs):
    _emitir_cambio_cotizacion(instance, 'eliminada', 'cotizacion')


@receiver(post_save, sender=CotizacionItem)
@omitir_en_restauracion
def cotizacion_item_guardado(sender, instance, created, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'item_creado' if created else 'item_actualizado', 'cotizacion_item')


@receiver(post_delete, sender=CotizacionItem)
def cotizacion_item_eliminado(sender, instance, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'item_eliminado', 'cotizacion_item')


@receiver(post_save, sender=CotizacionFoto)
@omitir_en_restauracion
def cotizacion_foto_guardada(sender, instance, created, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'foto_creada' if created else 'foto_actualizada', 'cotizacion_foto')


@receiver(post_delete, sender=CotizacionFoto)
def cotizacion_foto_eliminada(sender, instance, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'foto_eliminada', 'cotizacion_foto')


@receiver(post_save, sender=Renta)
@omitir_en_restauracion
def renta_guardada(sender, instance, created, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'renta_creada' if created else 'renta_actualizada', 'renta')


@receiver(post_delete, sender=Renta)
def renta_eliminada(sender, instance, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'renta_eliminada', 'renta')


@receiver(post_save, sender=Venta)
@omitir_en_restauracion
def venta_guardada(sender, instance, created, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'venta_creada' if created else 'venta_actualizada', 'venta')


@receiver(post_delete, sender=Venta)
def venta_eliminada(sender, instance, **kwargs):
    _emitir_cambio_cotizacion(instance.cotizacion, 'venta_eliminada', 'venta')
