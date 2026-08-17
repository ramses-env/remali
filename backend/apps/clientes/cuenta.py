"""El estado de cuenta de un cliente. UN solo lugar que calcula el dinero.

De aquí comen la ficha del cliente, el resumen del buscador de mostrador y la
lista del padrón. Tres implementaciones del mismo saldo terminan en tres cifras
distintas en tres pantallas, y la que el cliente ve en el mostrador es la que
alguien va a discutir.

NADA SE GUARDA. No hay `Cliente.saldo` actualizado por señales: un saldo
guardado se desincroniza —un abono que no disparó la señal, una cancelación, un
`bulk_update`— y un número de dinero equivocado es peor que no tener el número.
Las piezas que se suman ya existen y son confiables.
"""
from decimal import Decimal

CERO = Decimal('0.00')

# Depósitos que la empresa TODAVÍA le debe al cliente. 'devuelto' ya se entregó
# y 'aplicado' se consumió; ninguno de los dos es un saldo a favor vivo.
DEPOSITOS_VIVOS = ('por_devolver', 'a_favor')


def estado_de_cuenta(cliente, *, con_documentos=False) -> dict:
    """Tres cifras: lo que debe, lo que se le debe, y el neto.

    `con_documentos=True` agrega el historial. La ficha lo pide; el buscador de
    mostrador no —ahí solo estorbaría y costaría consultas—.
    """
    rentas = cliente.rentas.exclude(estado='cancelada').select_related('inventario__equipo')
    ventas = cliente.ventas.exclude(estado='cancelada').select_related('inventario__equipo', 'equipo')

    saldo = CERO
    credito = CERO
    for r in rentas:
        saldo += r.saldo_pendiente()
        if r.deposito_estado in DEPOSITOS_VIVOS:
            credito += Decimal(r.deposito_reembolso or 0)
    for v in ventas:
        saldo += v.saldo_pendiente()

    datos = {
        'saldo': str(saldo.quantize(Decimal('0.01'))),
        'credito_a_favor': str(credito.quantize(Decimal('0.01'))),
        'neto': str((saldo - credito).quantize(Decimal('0.01'))),
        'tiene_adeudo': saldo > 0,
        'tiene_credito': credito > 0,
    }
    if con_documentos:
        datos['documentos'] = _historial(cliente, rentas, ventas)
    return datos


def _historial(cliente, rentas, ventas) -> list:
    """Todo lo del cliente en una sola lista, de lo más nuevo a lo más viejo.

    Es la respuesta a "¿qué ha hecho este señor con nosotros?", que hoy no se
    puede contestar sin abrir cuatro secciones distintas.
    """
    docs = []

    for v in ventas:
        equipo = (v.inventario.equipo.modelo if v.inventario_id and v.inventario and v.inventario.equipo_id
                  else (v.equipo.modelo if v.equipo_id else 'Refacciones'))
        docs.append({
            'tipo': 'venta',
            'id': v.id,
            'folio': v.folio or f'#{v.id}',
            'fecha': v.fecha,
            'concepto': equipo,
            'total': str(v.total or CERO),
            'saldo': str(v.saldo_pendiente()),
            'estado': v.estado,
        })

    for r in rentas:
        docs.append({
            'tipo': 'renta',
            'id': r.id,
            'folio': f'#{r.id}',
            'fecha': r.creado_en,
            'concepto': (r.inventario.equipo.modelo if r.inventario_id and r.inventario.equipo_id else 'Renta'),
            'total': str(r.total or CERO),
            'saldo': str(r.saldo_pendiente()),
            'estado': r.estado,
            'deposito_estado': r.deposito_estado,
        })

    for c in cliente.cotizaciones.all():
        docs.append({
            'tipo': 'cotizacion',
            'id': c.id,
            'folio': c.folio or f'#{c.id}',
            'fecha': c.creada,
            'concepto': c.get_tipo_display(),
            'total': str(c.total or CERO),
            'saldo': '0.00',
            'estado': c.estado,
        })

    for o in cliente.reparaciones.select_related('unidad__equipo'):
        docs.append({
            'tipo': 'reparacion',
            'id': o.id,
            'folio': o.folio or f'#{o.id}',
            'fecha': o.fecha_recibida,
            'concepto': o.equipo_descripcion or (o.unidad.equipo.modelo if o.unidad_id and o.unidad.equipo_id else 'Equipo'),
            'total': '',
            'saldo': '0.00',
            'estado': o.estado,
        })

    docs.sort(key=lambda d: d['fecha'], reverse=True)
    return docs
