"""Decidir si un CFDI ya leído corresponde a una solicitud.

Separado del lector a propósito: aquí no se parsea nada, se comparan
diccionarios contra filas. Cada rechazo dice QUÉ no cuadró y con qué, porque el
mensaje es lo único que tiene enfrente quien acaba de subir el archivo
equivocado.
"""
from decimal import Decimal

TOLERANCIA = Decimal('0.01')


class DescuadreCFDI(Exception):
    """El CFDI no corresponde a esta solicitud."""


def revisar_cfdi(datos, solicitud, *, rfc_negocio):
    """Lanza DescuadreCFDI si algo no cuadra. Devuelve la lista de avisos.

    Un aviso no impide subir: dice que algo no se pudo verificar, para que nadie
    crea que se revisó lo que no se revisó.
    """
    from .models import Factura

    avisos = []

    # 1. ¿La emitimos nosotros?
    if rfc_negocio:
        if datos['rfc_emisor'] != rfc_negocio.strip().upper():
            raise DescuadreCFDI(
                f"Este CFDI lo emitió {datos['rfc_emisor']}, no {rfc_negocio.strip().upper()}. "
                '¿Es la factura de un proveedor?'
            )
    else:
        avisos.append(
            'No se verificó quién emitió el CFDI: falta el RFC del negocio en '
            'Configuración.'
        )

    # 2. ¿Es de este cliente? Sin excepción posible: mandarle a alguien la
    #    factura de otro es problema fiscal y de privacidad al mismo tiempo.
    esperado = (solicitud.rfc or '').strip().upper()
    if esperado and datos['rfc_receptor'] != esperado:
        raise DescuadreCFDI(
            f"El CFDI está a nombre de {datos['rfc_receptor']} y esta solicitud "
            f'es de {esperado}. No es la factura de este cliente.'
        )

    # 3. ¿Es de esta venta?
    if abs(datos['total'] - Decimal(solicitud.total)) > TOLERANCIA:
        raise DescuadreCFDI(
            f"El CFDI es por ${datos['total']} y la solicitud es por "
            f'${solicitud.total}. Si es una factura parcial, hoy no se puede '
            'registrar así.'
        )

    # 4. ¿Ya estaba en otro lado?
    repetida = Factura.objects.filter(uuid=datos['uuid']).select_related('solicitud').first()
    if repetida:
        raise DescuadreCFDI(
            f'Ese folio fiscal ya está en {repetida.solicitud.folio_origen}. '
            'Es el mismo XML, subido dos veces.'
        )

    return avisos
