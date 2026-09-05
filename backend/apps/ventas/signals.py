from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from maquinaria.ws_events import omitir_en_restauracion, push_panel_event, push_user_event
from ventas.models import Venta
from server.rastro import tragado


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
    if created:
        _emitir_garantia(instance)


def _emitir_garantia(venta: Venta):
    """Toda venta de maquinaria nace con su garantía, si el catálogo dice que
    esa máquina la lleva (`Equipo.garantia_meses`, 3 por defecto).

    Va en una señal y no en cada endpoint a propósito: hay tres formas de
    registrar una venta —desde inventario, desde una cotización y desde el
    mostrador— y una garantía que dependa de cuál se usó es una garantía que
    algún cliente va a reclamar y no vamos a encontrar.

    Nunca tumba la venta: si algo falla aquí, la venta ya está hecha y esa es la
    operación que importa.
    """
    if venta.estado == 'cancelada':
        return
    try:
        from clientes.models import Garantia
        Garantia.emitir(venta)
    except Exception:
        tragado()


@receiver(post_delete, sender=Venta)
def venta_eliminada(sender, instance, **kwargs):
    _emitir_venta_eventos(instance, 'eliminada')
