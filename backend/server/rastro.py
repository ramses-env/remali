"""Rastro de los errores que decidimos NO propagar.

Hay lugares donde tragarse el error es la decisión correcta: que falle el aviso
al cliente no puede impedir que se registre su pago, y que falle el sello del
latido no puede tumbar un guardado del negocio. Eso está bien.

Lo que estaba mal era el `pass` a secas. Si `crear_notificacion` se rompe, los
avisos dejan de salir y NADIE se entera —ni el usuario, que no espera nada, ni
quien revisa los logs, porque no hay línea que revisar—. El error no desaparece:
se vuelve invisible, que es peor.

`tragado()` deja la línea. Se llama DENTRO del `except`, así que `log.exception`
captura la excepción viva y el traceback apunta al sitio exacto: no hace falta
redactar un mensaje distinto en cada uno.

    try:
        avisar_al_cliente(venta)
    except Exception:
        tragado('aviso de venta %s', venta.id)   # sigue adelante, pero se sabe
"""
import logging

log = logging.getLogger('remali.tragado')


def tragado(contexto='', *args):
    """Registra la excepción en curso y devuelve el control a quien sigue.

    `contexto` es opcional: el traceback ya dice archivo, línea y función. Sirve
    para poner el dato que no se ve en el código (qué venta, qué usuario).
    """
    try:
        if contexto:
            log.exception('Error tragado a propósito · ' + contexto, *args)
        else:
            log.exception('Error tragado a propósito')
    except Exception:
        # Si hasta el logging falla, no vamos a tumbar la petición por el rastro.
        pass
