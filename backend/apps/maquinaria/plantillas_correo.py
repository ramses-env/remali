"""El texto del correo con el código de verificación.

Va en TEXTO PLANO, y no por falta de ganas: la versión en HTML se probó y caía
fuera de Recibidos mientras la de texto llegaba a la bandeja principal. Sin SPF
ni DKIM publicados en el dominio, Gmail perdona un correo de texto y castiga uno
de HTML. Mientras esos dos registros no existan, el texto es lo que llega.

Cuando el dominio esté autenticado, `correo.enviar_async` ya acepta `html=` y
volver a mandarlo maquetado es una línea.

Vive aparte de la vista porque lo que más cambia de un correo es lo que dice, y
nadie debería tener que entrar a la lógica de verificación para corregir una
coma.
"""


def correo_codigo(nombre, codigo, minutos):
    """Devuelve `(asunto, texto)` del correo de verificación.

    El código va también en el ASUNTO: muchos clientes lo enseñan en la
    notificación, así que se lee sin abrir nada.
    """
    asunto = f'{codigo} es tu código · REMALI'

    # Solo el primer nombre. "Hola Josue Ramses Rojas Vallejo" suena a carta de
    # banco, y el sistema se declara cálido y cercano (DESIGN.md).
    pila = (nombre or '').strip().split()
    saludo = f'Hola {pila[0]}' if pila else 'Hola'

    texto = (
        f'{saludo}:\n'
        f'\n'
        f'Este es tu código para entrar a REMALI:\n'
        f'\n'
        f'    {codigo}\n'
        f'\n'
        f'Escríbelo en la pantalla donde te quedaste. Dura {minutos} minutos; si se\n'
        f'te pasa, pide otro ahí mismo.\n'
        f'\n'
        f'Si no fuiste tú quien lo pidió, ignora este correo. Sin el código nadie\n'
        f'entra a tu cuenta, y se vence solo en un rato.\n'
        f'\n'
        f'REMALI\n'
        f'Renta, venta y servicio de maquinaria\n'
    )

    return asunto, texto
