"""Datos estructurados del comprobante de renta (fuente única para modal y PDF)."""

from server.documentos import fecha_larga


def datos_comprobante_renta(r) -> dict:
    meta = [
        {'label': 'Estado', 'value': r.get_estado_display()},
        {'label': 'Cliente', 'value': r.cliente_nombre},
    ]
    if r.telefono_cliente:
        meta.append({'label': 'Tel', 'value': r.telefono_cliente})
    if r.obra_id and r.obra:
        meta.append({'label': 'Obra', 'value': r.obra.nombre})
    meta.append({'label': 'Ubicacion', 'value': r.direccion})
    meta.append({'label': 'Periodo', 'value': f'{r.get_modalidad_display()} x {r.duracion}'})
    meta.append({'label': 'Inicio', 'value': str(r.fecha_inicio)})
    meta.append({'label': 'Fin previsto', 'value': str(r.fecha_fin)})
    if r.fecha_devolucion_real:
        meta.append({'label': 'Devuelto', 'value': str(r.fecha_devolucion_real)})

    eq = r.inventario.equipo.modelo if r.inventario.equipo else 'Equipo'
    items = [{
        'nombre': f'{eq} ({r.inventario.codigo})',
        'detalle': r.get_modalidad_display(),
        'cantidad': f'{r.duracion}',
        'unitario': f'{r.precio_unitario}',
        'importe': f'{r.subtotal}',
    }]

    totales = [{'label': 'Subtotal', 'value': f'{r.subtotal}'}]
    if r.descuento and r.descuento > 0:
        totales.append({'label': 'Descuento', 'value': f'-{r.descuento}'})
    if r.recargo and r.recargo > 0:
        totales.append({'label': 'Recargo x retraso', 'value': f'{r.recargo}'})
    # IVA solo si la renta llevará factura.
    if getattr(r, 'iva', 0) and r.iva > 0:
        totales.append({'label': 'IVA (16%)', 'value': f'{r.iva}'})
    totales.append({'label': 'Total', 'value': f'{r.total}', 'fuerte': True})
    if r.deposito and r.deposito > 0:
        totales.append({'label': 'Deposito', 'value': f'{r.deposito}'})

    pie = ['Conserve este comprobante', 'para la devolucion del equipo.']

    return {
        'tipo': 'renta',
        'titulo': 'Comprobante de Renta',
        'folio': f'R-{r.id}',
        'fecha': fecha_larga(r.creado_en),
        'meta': meta,
        'items': items,
        'totales': totales,
        'pie': pie,
    }
