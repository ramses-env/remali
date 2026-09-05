"""Datos estructurados del comprobante de venta (fuente única para modal y PDF)."""

from server.documentos import fecha_larga


def datos_comprobante_venta(v) -> dict:
    meta = []
    if v.nombre_cliente:
        meta.append({'label': 'Cliente', 'value': v.nombre_cliente})
    if v.cliente_id and v.cliente:
        meta.append({'label': 'Cliente', 'value': v.cliente.nombre})
    if v.telefono_cliente:
        meta.append({'label': 'Tel', 'value': v.telefono_cliente})

    items = []
    # Si la venta nació de una cotización, las partidas son las de la cotización.
    if v.cotizacion_id and v.cotizacion:
        for ci in v.cotizacion.items.all():
            items.append({
                'nombre': ci.descripcion,
                'cantidad': f'{ci.cantidad}',
                'unitario': f'{ci.precio_unitario}',
                'importe': f'{ci.subtotal}',
            })
        meta.append({'label': 'Cotizacion', 'value': v.cotizacion.folio})
    else:
        # Una línea por máquina, con su número de serie: es lo que el cliente
        # necesita para reclamar garantía y lo que el vendedor necesita probar.
        for renglon in v.maquinas_vivas():
            inv = renglon.inventario
            eq = (inv.equipo.modelo if inv and inv.equipo else None) \
                or (renglon.equipo.modelo if renglon.equipo_id else 'Maquinaria')
            items.append({
                'nombre': f'{eq} ({inv.codigo})' if inv else f'{eq} (por llegar)',
                # El detalle es la segunda línea del concepto: el número de serie
                # es lo que el cliente necesita para reclamar garantía.
                'detalle': (f'S/N {inv.numero_serie}' if inv and inv.numero_serie else ''),
                'cantidad': '1',
                'unitario': f'{renglon.precio}',
                'importe': f'{renglon.precio}',
            })
    for it in v.items.all():
        nombre = it.refaccion.nombre if it.refaccion else 'Producto'
        items.append({
            'nombre': nombre,
            'cantidad': f'{it.cantidad}',
            'unitario': f'{it.precio_unitario}',
            'importe': f'{it.subtotal}',
        })

    # El precio de venta YA incluye IVA: el total no suma impuestos. Se desglosa
    # el IVA (subtotal + IVA = total) para el comprobante y la factura.
    if v.iva and v.iva > 0:
        totales = [
            {'label': 'Subtotal', 'value': f'{v.subtotal}'},
            {'label': 'IVA (16%)', 'value': f'{v.iva}'},
            {'label': 'Total', 'value': f'{v.total}', 'fuerte': True},
        ]
    else:
        totales = [
            {'label': 'Total', 'value': f'{v.total}', 'fuerte': True},
        ]

    if getattr(v, 'pagos', None):
        etiqueta = dict(v.METODO_PAGO)
        partes = ' · '.join(f"{etiqueta.get(p.get('metodo'), p.get('metodo'))} ${p.get('monto')}" for p in v.pagos)
        pie = [f'Pago combinado: {partes}']
    else:
        pie = [f'Pago: {v.get_metodo_pago_display()}']
    if v.estado == 'cancelada':
        pie.append('** VENTA CANCELADA **')
    pie.append('¡Gracias por su compra!')

    return {
        'tipo': 'venta',
        'titulo': 'Ticket de Venta',
        'folio': f'V-{v.id}',
        'fecha': fecha_larga(v.fecha),
        'meta': meta,
        'items': items,
        'totales': totales,
        'pie': pie,
    }
