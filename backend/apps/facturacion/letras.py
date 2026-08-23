"""Convertir un importe a letra para el renglón impreso de la factura.

El "importe con letra" no es adorno: existe para que nadie pueda agregarle un
dígito al total una vez impreso. Por eso este módulo no depende de nada del
proyecto (ni modelos, ni settings): recibe un número y devuelve texto, y se
puede probar sin base de datos.

Las reglas que parecen caprichos —VEINTIÚN y no VEINTIUNO, MIL y no UN MIL,
CIEN y no CIENTO— son apócopes del español; están comentadas donde se aplican
porque es lo que casi todas las implementaciones se saltan.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

# 0-29 no siguen ningún patrón: dieciséis..diecinueve y veintiuno..veintinueve
# se escriben en una sola palabra (a partir de 31 vuelve el "treinta Y uno"),
# así que la tabla es más honesta que cualquier regla.
CARDINALES = {
    0: 'CERO', 1: 'UNO', 2: 'DOS', 3: 'TRES', 4: 'CUATRO', 5: 'CINCO',
    6: 'SEIS', 7: 'SIETE', 8: 'OCHO', 9: 'NUEVE', 10: 'DIEZ', 11: 'ONCE',
    12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE', 16: 'DIECISÉIS',
    17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE', 20: 'VEINTE',
    21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
    25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO',
    29: 'VEINTINUEVE',
}

DECENAS = {
    3: 'TREINTA', 4: 'CUARENTA', 5: 'CINCUENTA', 6: 'SESENTA',
    7: 'SETENTA', 8: 'OCHENTA', 9: 'NOVENTA',
}

# QUINIENTOS, SETECIENTOS y NOVECIENTOS son irregulares: no salen de pegarle
# "cientos" a la unidad. Van en tabla para que nadie invente "cincocientos".
CENTENAS = {
    1: 'CIENTO', 2: 'DOSCIENTOS', 3: 'TRESCIENTOS', 4: 'CUATROCIENTOS',
    5: 'QUINIENTOS', 6: 'SEISCIENTOS', 7: 'SETECIENTOS', 8: 'OCHOCIENTOS',
    9: 'NOVECIENTOS',
}

MILLON = 1_000_000
# Tope: a partir del billón cambia la escala (y en México "billón" es 10^12,
# no 10^9 como en inglés). Ningún importe facturable llega ahí; si llega, es un
# error de captura y vale más reventar que imprimir una cifra ambigua.
LIMITE = 1_000_000_000_000

# codigo -> (singular, plural, sufijo del renglón)
MONEDAS = {
    'MXN': ('PESO', 'PESOS', 'M.N.'),
    'USD': ('DÓLAR', 'DÓLARES', 'U.S.D.'),
}

CENTAVOS = Decimal('0.01')


def _menor_cien(n, apocope):
    """Escribe 0-99. `apocope` convierte los que terminan en 1 a la forma UN."""
    if n < 30:
        # El 1 pierde la -o delante de un sustantivo masculino: "veintiún
        # pesos", nunca "veintiuno pesos". Es apócope, no abreviatura.
        if apocope and n == 1:
            return 'UN'
        if apocope and n == 21:
            return 'VEINTIÚN'
        return CARDINALES[n]
    decena, unidad = divmod(n, 10)
    if unidad == 0:
        return DECENAS[decena]
    return f'{DECENAS[decena]} Y {_menor_cien(unidad, apocope)}'


def _menor_mil(n, apocope):
    """Escribe 0-999. Devuelve '' para el cero: aquí el cero no se dice."""
    if n == 0:
        return ''
    # CIENTO también se apocopa, pero al revés que UNO: solo cuando son cien
    # exactos ("cien pesos"). En cuanto le sigue algo vuelve entero: "ciento
    # uno", "ciento quince".
    if n == 100:
        return 'CIEN'
    centena, resto = divmod(n, 100)
    partes = []
    if centena:
        partes.append(CENTENAS[centena])
    if resto:
        partes.append(_menor_cien(resto, apocope))
    return ' '.join(partes)


def numero_a_letras(numero, *, apocope=False):
    """Devuelve un entero en letra, en MAYÚSCULAS.

    Con `apocope=True` se obtiene la forma que va pegada a un sustantivo
    masculino (VEINTIÚN PESOS, CIENTO UN PESOS); sin él, el cardinal suelto
    (VEINTIUNO, CIENTO UNO). Son las dos formas correctas del mismo número y
    cuál toca depende de si después hay sustantivo, por eso decide quien llama.
    """
    n = int(numero)
    if n < 0:
        raise ValueError('No se escriben con letra los números negativos.')
    if n >= LIMITE:
        raise ValueError(f'El importe es demasiado grande para escribirlo con letra: {n}.')
    if n == 0:
        return 'CERO'

    partes = []
    millones, resto = divmod(n, MILLON)
    if millones:
        # "Un millón", no "uno millón". Y de dos en adelante el sustantivo
        # millón se pluraliza; el número que lo multiplica también va apocopado
        # ("veintiún millones"), porque millón es un sustantivo masculino.
        if millones == 1:
            partes.append('UN MILLÓN')
        else:
            partes.append(f'{numero_a_letras(millones, apocope=True)} MILLONES')

    miles, unidades = divmod(resto, 1000)
    if miles:
        # MIL nunca lleva el uno delante: "mil pesos", jamás "un mil pesos".
        # Pero "veintiún mil" sí, porque ahí el uno pertenece al 21.
        if miles == 1:
            partes.append('MIL')
        else:
            partes.append(f'{_menor_mil(miles, apocope=True)} MIL')

    if unidades:
        partes.append(_menor_mil(unidades, apocope))
    return ' '.join(partes)


def _a_decimal(monto):
    """Normaliza cualquier entrada a Decimal con dos decimales (HALF_UP)."""
    if isinstance(monto, Decimal):
        valor = monto
    elif isinstance(monto, float):
        # Vía str: Decimal(0.1) arrastra la basura del binario y 2.675 se
        # redondearía "mal" aunque el usuario haya escrito 2.675.
        valor = Decimal(str(monto))
    else:
        try:
            valor = Decimal(str(monto).strip())
        except (InvalidOperation, ValueError, TypeError) as e:
            raise ValueError(f'No es un importe: {monto!r}.') from e
    if not valor.is_finite():
        raise ValueError(f'No es un importe: {monto!r}.')
    # ROUND_HALF_UP y no el bancario de Python: en una factura el medio centavo
    # se sube, que es lo que hace la calculadora de quien va a revisar.
    return valor.quantize(CENTAVOS, rounding=ROUND_HALF_UP)


def importe_con_letra(monto, moneda='MXN'):
    """Devuelve el renglón de importe con letra de una factura mexicana.

    >>> importe_con_letra(Decimal('1724.14'))
    'MIL SETECIENTOS VEINTICUATRO PESOS 14/100 M.N.'

    Los centavos NO van en letra sino como fracción de dos dígitos sobre 100.
    Es la convención de cheques y facturas: "50/100" no se puede confundir ni
    alterar, y se compara de un vistazo contra el total en números.
    """
    cantidad = _a_decimal(monto)
    if cantidad < 0:
        # Una nota de crédito se factura como comprobante tipo E con importe
        # positivo; un total negativo en un CFDI siempre es un error de captura.
        raise ValueError(f'Un importe de factura no puede ser negativo: {cantidad}.')

    entero = int(cantidad)
    centavos = int((cantidad - entero).scaleb(2))

    codigo = (str(moneda).strip().upper() or 'MXN')
    # Moneda desconocida: se imprime el código tal cual y sin sufijo. Es
    # preferible un "DOS MIL EUR" seco a inventarle un plural o un "M.N." que
    # diría que son pesos.
    singular, plural, sufijo = MONEDAS.get(codigo, (codigo, codigo, ''))

    # Solo el uno exacto lleva singular. "Veintiún pesos" y "ciento un pesos"
    # son plurales aunque terminen en uno: lo que manda es la cantidad, no la
    # última palabra.
    sustantivo = singular if entero == 1 else plural

    letras = numero_a_letras(entero, apocope=True)
    # "Millón" es sustantivo, no adjetivo, así que pide "de" cuando va pegado a
    # otro sustantivo: UN MILLÓN DE PESOS. Solo cuando la cifra termina ahí; si
    # le sigue algo ("un millón doscientos mil pesos") el "de" sobra.
    if entero >= MILLON and entero % MILLON == 0:
        letras = f'{letras} DE'

    renglon = f'{letras} {sustantivo} {centavos:02d}/100'
    return f'{renglon} {sufijo}' if sufijo else renglon
