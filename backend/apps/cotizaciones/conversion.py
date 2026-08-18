"""El único puente entre el taller del cliente y el libro de REMALI.

Aquí, y solo aquí, un borrador se vuelve `Cotizacion`. Es también el instante
en que nace el folio: antes de este momento la cotización no existía para el
negocio, así que no tenía por qué gastar un número del ejercicio.

El cruce va en un solo sentido —de lo privado hacia REMALI—, y solo lo dispara
el cliente: mandándola directo, o su autorizador aprobándola desde la liga.
"""
from django.db import transaction
from django.utils import timezone

from .models import Cotizacion, CotizacionItem


@transaction.atomic
def cotizacion_desde_borrador(borrador, *, autorizada_por=''):
    """Crea la `Cotizacion` de REMALI a partir de un borrador ya congelado.

    `autorizada_por` viene con nombre cuando la firmó el jefe del cliente: en
    ese caso entra ACEPTADA, porque la decisión de dinero ya se tomó y a REMALI
    solo le queda concretarla. Sin firma (envío directo) entra ENVIADA, para que
    el negocio la revise.
    """
    contacto = borrador.datos_contacto or {}
    obra = borrador.obra or {}
    lineas = [l for l in borrador.lineas() if l['disponible']]

    cot = Cotizacion.objects.create(
        tipo='venta',          # provisional: recalcular_tipo() lo fija con las partidas
        origen='cliente',
        estado='aceptada' if autorizada_por else 'enviada',
        usuario=borrador.usuario,
        cupon=borrador.cupon,
        cliente_nombre=(contacto.get('nombre') or '').strip(),
        cliente_telefono=(contacto.get('telefono') or '').strip(),
        cliente_email=(contacto.get('email') or '').strip().lower(),
        aplica_iva=borrador.requiere_factura,
        autorizada_por=autorizada_por,
        autorizada_en=timezone.now() if autorizada_por else None,
        datos_solicitud={
            'empresa': (contacto.get('empresa') or '').strip(),
            'obra': {
                'responsable': (obra.get('responsable') or '').strip(),
                'direccion': (obra.get('direccion') or '').strip(),
                'telefono': (obra.get('telefono') or '').strip(),
                'email': (obra.get('email') or '').strip().lower(),
            },
            # Snapshot del carrito para el botón "volver a cotizar" del cliente.
            'carrito': [
                {'id': l['equipo'], 'title': l['descripcion'], 'price': float(l['precio_unitario']),
                 'qty': l['cantidad'], 'duracion': l['duracion'], 'unit': l['modalidad']}
                for l in lineas
            ],
        },
    )
    for l in lineas:
        CotizacionItem.objects.create(
            cotizacion=cot,
            descripcion=l['descripcion'],
            cantidad=l['cantidad'],
            duracion=l['duracion'],
            precio_unitario=l['precio_unitario'],
            precio_lista=l['precio_lista'],
            equipo_id=l['equipo'],
            modalidad=l['modalidad'],
        )
    cot.recalcular_tipo()

    borrador.cotizacion = cot
    borrador.estado = 'entregado'
    borrador.decision = 'autorizado' if autorizada_por else ''
    borrador.save(update_fields=['cotizacion', 'estado', 'decision', 'actualizado'])
    return cot
