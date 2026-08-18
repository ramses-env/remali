"""El precio de una cotización, calculado en UN solo lugar.

Antes esto vivía repetido: `_resolver_partida` en las vistas, el desglose de IVA
en las propiedades del modelo, y una copia entera del armado de partidas entre
`crear_cotizacion_publica` y `_construir_cotizacion`. Tres copias de la misma
regla de negocio son tres formas de que el total del PDF no cuadre con el del
panel.

Aquí viven las tres reglas de la casa:
  1. Qué precio le toca a un equipo según lo que pidió el cliente.
  2. Cómo entra la promo (y qué era el precio de lista antes de ella).
  3. Cómo se desglosa el IVA: en VENTA ya viene incluido en el precio y se
     desglosa; en RENTA se suma solo si el cliente pidió factura.
"""
from decimal import Decimal

IVA_RATE = Decimal('0.16')

# Unidades de renta válidas que puede pedir la tienda, con su nombre en español.
UNIDADES_RENTA = {'dia': 'día', 'semana': 'semana', 'mes': 'mes'}
MODALIDADES = {'venta'} | set(UNIDADES_RENTA)


def resolver_partida(eq, unit):
    """Traduce lo que pidió la tienda a (etiqueta, precio, modalidad).

    Si el equipo no tiene precio para esa modalidad se cae a la otra: un equipo
    que solo se vende no debe quedar cotizado en $0 por pedir "renta por día".
    """
    if unit in UNIDADES_RENTA:
        precio = eq.get_precio_por_unidad(unit)
        if precio:
            return f'{eq.modelo} · renta por {UNIDADES_RENTA[unit]}', precio, unit
        return f'{eq.modelo} · venta', eq.precio_venta, 'venta'

    if eq.precio_venta:
        return f'{eq.modelo} · venta', eq.precio_venta, 'venta'
    for u in ('dia', 'semana', 'mes'):          # solo se renta: cotiza la renta
        precio = eq.get_precio_por_unidad(u)
        if precio:
            return f'{eq.modelo} · renta por {UNIDADES_RENTA[u]}', precio, u
    return f'{eq.modelo} · venta', eq.precio_venta, 'venta'


def partida_de_equipo(eq, unit):
    """El precio de HOY para un equipo, con la promo del panel ya aplicada.

    Devuelve {descripcion, precio_unitario, precio_lista, modalidad}. El precio
    de lista es el de ANTES de la promo: lo necesita el descuento de contado
    para tomar el descuento mayor en vez de apilar los dos.
    """
    etiqueta, precio, modalidad = resolver_partida(eq, unit)
    promo = min(90, max(0, getattr(eq, 'promo_pct', 0) or 0))
    precio = Decimal(str(precio or 0))
    precio_lista = precio
    if precio and promo:
        precio = (precio * (Decimal('100') - promo) / Decimal('100')).quantize(Decimal('0.01'))
        etiqueta = f'{etiqueta} (promo −{promo}%)'
    return {
        'descripcion': etiqueta,
        'precio_unitario': precio,
        'precio_lista': precio_lista,
        'modalidad': modalidad,
    }


def periodos(modalidad, duracion):
    """Periodos que se cobran: la duración en renta; 1 en venta."""
    return duracion if modalidad in UNIDADES_RENTA else 1


def desglose(subtotal_venta, subtotal_renta, aplica_iva):
    """Base gravable e IVA a partir de los dos subtotales.

    VENTA: el precio YA incluye IVA, así que se desglosa (precio / 1.16) —
    siempre, haya factura o no. RENTA: el subtotal viene sin IVA y solo se le
    suma si el cliente pidió factura.
    """
    subtotal_venta = Decimal(subtotal_venta or 0)
    subtotal_renta = Decimal(subtotal_renta or 0)
    base_venta = subtotal_venta / (Decimal('1') + IVA_RATE)
    base = (base_venta + subtotal_renta).quantize(Decimal('0.01'))
    iva_venta = subtotal_venta - base_venta
    iva_renta = (subtotal_renta * IVA_RATE) if aplica_iva else Decimal('0.00')
    return base, (iva_venta + iva_renta).quantize(Decimal('0.01'))


def tipo_desde_modalidades(modalidades):
    """El tipo se DERIVA de las partidas: con venta y renta juntas, es 'mixta'."""
    modalidades = set(modalidades)
    if not modalidades:
        return None
    hay_venta = 'venta' in modalidades
    hay_renta = bool(modalidades - {'venta'})
    return 'mixta' if (hay_venta and hay_renta) else ('venta' if hay_venta else 'renta')


def normalizar_item(it):
    """Saca (equipo_id, cantidad, duracion, unidad) de lo que manda el navegador.

    Nada de lo que llega del cliente se cree: cantidades y duraciones se topan,
    y la unidad que no sea de renta se trata como venta.
    """
    equipo_id = it.get('equipo_id') or it.get('id')
    try:
        cantidad = max(1, min(int(it.get('cantidad') or 1), 999))
    except (ValueError, TypeError):
        cantidad = 1
    unidad = (it.get('unit') or it.get('modalidad') or '').lower()
    if unidad not in UNIDADES_RENTA:
        unidad = 'venta'
    try:
        duracion = max(1, min(int(it.get('duracion') or 1), 999)) if unidad != 'venta' else 1
    except (ValueError, TypeError):
        duracion = 1
    return equipo_id, cantidad, duracion, unidad
