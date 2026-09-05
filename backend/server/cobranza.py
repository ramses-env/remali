"""Los abonos, leídos igual en todas partes.

Un abono vive como una línea dentro de un JSON (`Venta.pagos`, `Renta.pagos`):
`{fecha, monto, metodo, por}`. Eso alcanza para listarlos, pero cada quien los
sellaba y los leía a su manera —la renta guardaba una fecha (`2026-08-19`), la
venta un instante completo, y el Resumen ni siquiera los miraba—, así que el
mismo dinero se contaba distinto según quién preguntara.

Aquí vive esa única forma de leerlos y de sellarlos. Es deliberadamente
tolerante: un pago viejo con la fecha en un formato raro se queda fuera del
conteo, pero jamás tumba la pantalla de inicio.
"""

import datetime as _dt
from decimal import Decimal, InvalidOperation

from django.utils import timezone

METODOS = ('efectivo', 'tarjeta', 'transferencia')


def sellar_abono(fecha_txt):
    """Devuelve (sello, error) para la fecha que capturó el operador.

    Vacío = ahora. Con fecha (`AAAA-MM-DD`) se respeta tal cual, porque a nadie
    se le registra el anticipo el mismo minuto en que lo recibe; hacia adelante
    no, porque un ingreso con fecha futura es dinero que todavía no existe.
    """
    fecha_txt = (str(fecha_txt or '')).strip()
    if not fecha_txt:
        return timezone.now().isoformat(), None
    try:
        f = _dt.date.fromisoformat(fecha_txt)
    except ValueError:
        return None, 'Fecha no válida (usa AAAA-MM-DD).'
    if f > timezone.localdate():
        return None, 'La fecha del abono no puede ser futura.'
    return f.isoformat(), None


def fecha_de_pago(pago):
    """El día en que entró ese dinero, o None si la fecha no se puede leer.

    Aguanta las dos formas que ya conviven en la base: la fecha sola que sella
    un abono con fecha capturada, y el instante completo del que se registra al
    momento. Un instante con zona horaria se pasa a la del negocio antes de
    quedarse con el día: si no, un cobro de las 7 de la tarde caería en el día
    siguiente y el corte no cuadraría con el Resumen.
    """
    crudo = (pago or {}).get('fecha')
    if not crudo:
        return None
    texto = str(crudo).strip()
    try:
        momento = _dt.datetime.fromisoformat(texto)
    except ValueError:
        try:
            return _dt.date.fromisoformat(texto[:10])
        except ValueError:
            return None
    if timezone.is_aware(momento):
        momento = timezone.localtime(momento)
    return momento.date()


def monto_de_pago(pago):
    """El importe del abono. Un valor ilegible vale cero, no revienta."""
    try:
        return Decimal(str((pago or {}).get('monto', 0)))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')


def cobrado_por_dia(listas_de_pagos):
    """{date: Decimal} con lo que entró cada día, de todos los pagos que se le den.

    Recibe iterables de listas de pagos (los de las ventas, los de las rentas)
    para que quien llama decida qué incluir —una venta cancelada no aporta— sin
    que este módulo tenga que saber de modelos.
    """
    por_dia = {}
    for pagos in listas_de_pagos:
        for pago in (pagos or []):
            dia = fecha_de_pago(pago)
            if dia is None:
                continue
            monto = monto_de_pago(pago)
            if monto <= 0:
                continue
            por_dia[dia] = por_dia.get(dia, Decimal('0')) + monto
    return por_dia
