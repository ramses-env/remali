"""Rangos de fecha para filtrar listados por periodo (año / mes / rango).

Compara el DateTimeField contra límites AWARE calculados en Python, en vez de
usar los lookups ``__year`` / ``__month`` — que en MySQL exigen tener cargadas
las tablas de zonas horarias. Así el filtro por periodo funciona igual en
SQLite, MySQL y PostgreSQL, con o sin esas tablas.

Uso típico en una vista::

    from server.periodos import rango_periodo
    ini, fin = rango_periodo(request.query_params)
    if ini:
        qs = qs.filter(fecha__gte=ini)
    if fin:
        qs = qs.filter(fecha__lt=fin)   # fin es EXCLUSIVO
"""
from datetime import datetime, timedelta

from django.conf import settings
from django.utils import timezone


def _limite(anio, mes=1, dia=1):
    """Primer instante de ese (año, mes, día) en la zona horaria del proyecto."""
    dt = datetime(anio, mes, dia)
    if settings.USE_TZ:
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _parse_fecha(s):
    try:
        return datetime.strptime((s or '').strip(), '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


def anio_actual():
    """El año en curso según la zona horaria del negocio (no UTC)."""
    return (timezone.localtime() if settings.USE_TZ else timezone.now()).year


def rango_periodo(params):
    """Lee ``anio`` / ``mes`` / ``desde`` / ``hasta`` de los query params y
    devuelve ``(inicio, fin)`` con ``fin`` EXCLUSIVO.

    Devuelve ``(None, None)`` si no se pidió ningún periodo. Prioridad:
    ``desde``/``hasta`` (rango explícito) por encima de ``anio`` (+ ``mes``
    opcional). Un ``mes`` sin ``anio`` se ignora.
    """
    desde = _parse_fecha(params.get('desde'))
    hasta = _parse_fecha(params.get('hasta'))
    if desde or hasta:
        ini = _limite(desde.year, desde.month, desde.day) if desde else None
        # hasta es INCLUSIVO para el usuario → sumamos un día y comparamos con "<".
        fin = (_limite(hasta.year, hasta.month, hasta.day) + timedelta(days=1)) if hasta else None
        return ini, fin

    try:
        anio = int(params.get('anio') or 0)
    except (ValueError, TypeError):
        anio = 0
    if not anio:
        return None, None

    try:
        mes = int(params.get('mes') or 0)
    except (ValueError, TypeError):
        mes = 0
    if 1 <= mes <= 12:
        ini = _limite(anio, mes, 1)
        fin = _limite(anio + 1, 1, 1) if mes == 12 else _limite(anio, mes + 1, 1)
    else:
        ini = _limite(anio, 1, 1)
        fin = _limite(anio + 1, 1, 1)
    return ini, fin


def mas_meses(momento, meses):
    """`momento` corrido N meses hacia adelante, sin `dateutil`.

    Sumar 90 días no es sumar 3 meses: al cliente que recibió su cupón el 30 de
    noviembre hay que decirle "vence el 28 de febrero", no una fecha a media
    semana que no cuadra con nada. Y el último día del mes es justo donde una
    suma ingenua truena (31 de enero + 1 mes no existe), así que se recorta al
    último día real del mes destino.
    """
    import calendar

    mes = momento.month - 1 + meses
    anio = momento.year + mes // 12
    mes = mes % 12 + 1
    dia = min(momento.day, calendar.monthrange(anio, mes)[1])
    return momento.replace(year=anio, month=mes, day=dia)
