"""Datos estructurados del comprobante de venta (fuente única para modal y PDF)."""


def datos_comprobante_venta(v) -> dict:
    meta = []
    if v.nombre_cliente:
        meta.append({'label': 'Cliente', 'value': v.nombre_cliente})
    if v.empresa_id and v.empresa:
        meta.append({'label': 'Empresa', 'value': v.empresa.nombre})
    if v.telefono_cliente:
        meta.append({'label': 'Tel', 'value': v.telefono_cliente})

    items = []
    # Si la venta nació de una cotización, las partidas son las de la cotización.
    if v.cotizacion_id and v.cotizacion:
        for ci in v.cotizacion.items.all():
            items.append({
                'nombre': ci.descripcion,
                'detalle': f'{ci.cantidad} x ${ci.precio_unitario}',
                'importe': f'{ci.subtotal}',
            })
        meta.append({'label': 'Cotizacion', 'value': v.cotizacion.folio})
    elif v.inventario:
        eq = v.inventario.equipo.modelo if v.inventario.equipo else 'Maquinaria'
        items.append({
            'nombre': f'{eq} ({v.inventario.codigo})',
            'detalle': '1 pza',
            'importe': f'{v.precio_maquina}',
        })
    for it in v.items.all():
        nombre = it.refaccion.nombre if it.refaccion else 'Producto'
        items.append({
            'nombre': nombre,
            'detalle': f'{it.cantidad} x ${it.precio_unitario}',
            'importe': f'{it.subtotal}',
        })

    # Los precios son SIN IVA: solo se desglosa IVA si la venta llevará factura.
    if v.iva and v.iva > 0:
        totales = [
            {'label': 'Subtotal', 'value': f'{v.subtotal}'},
            {'label': 'IVA (16%)', 'value': f'{v.iva}'},
            {'label': 'TOTAL', 'value': f'{v.total}', 'fuerte': True},
        ]
    else:
        totales = [
            {'label': 'TOTAL', 'value': f'{v.total}', 'fuerte': True},
        ]

    pie = [f'Pago: {v.get_metodo_pago_display()}']
    if v.estado == 'cancelada':
        pie.append('** VENTA CANCELADA **')
    pie.append('¡Gracias por su compra!')

    return {
        'tipo': 'venta',
        'titulo': 'Ticket de Venta',
        'folio': f'V-{v.id}',
        'fecha': v.fecha.strftime('%d/%m/%Y %H:%M'),
        'meta': meta,
        'items': items,
        'totales': totales,
        'pie': pie,
    }
