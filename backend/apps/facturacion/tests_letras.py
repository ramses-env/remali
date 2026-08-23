"""El importe con letra: de un número al renglón que se imprime en la factura.

Casi todo se prueba en tabla porque lo que importa aquí son los casos frontera
del español (16, 21, 100, 101, 1000, 1000000), y una tabla deja ver de un
vistazo cuáles están cubiertos y cuáles faltan. Con `subTest`, un fallo dice
exactamente qué número se escribió mal en vez de cortar la prueba en el primero.

Es `SimpleTestCase` a propósito: el módulo no toca la base de datos y no debería
empezar a hacerlo.
"""
from decimal import Decimal

from django.test import SimpleTestCase

from facturacion.letras import importe_con_letra, numero_a_letras


class NumeroALetrasTest(SimpleTestCase):
    """El cardinal suelto, sin sustantivo detrás (VEINTIUNO, no VEINTIÚN)."""

    def test_cardinales(self):
        casos = [
            (0, 'CERO'),
            (1, 'UNO'),
            (15, 'QUINCE'),
            (16, 'DIECISÉIS'),
            (21, 'VEINTIUNO'),
            (22, 'VEINTIDÓS'),
            (30, 'TREINTA'),
            (31, 'TREINTA Y UNO'),
            (100, 'CIEN'),
            (101, 'CIENTO UNO'),
            (115, 'CIENTO QUINCE'),
            (200, 'DOSCIENTOS'),
            (500, 'QUINIENTOS'),
            (700, 'SETECIENTOS'),
            (900, 'NOVECIENTOS'),
            (999, 'NOVECIENTOS NOVENTA Y NUEVE'),
            (1000, 'MIL'),
            (1001, 'MIL UNO'),
            (2000, 'DOS MIL'),
            (21000, 'VEINTIÚN MIL'),
            (100000, 'CIEN MIL'),
            (999999, 'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE'),
            (1000000, 'UN MILLÓN'),
            (2000001, 'DOS MILLONES UNO'),
        ]
        for numero, esperado in casos:
            with self.subTest(numero=numero):
                self.assertEqual(numero_a_letras(numero), esperado)

    def test_apocope(self):
        """Con sustantivo detrás, el uno pierde la -o: UN, VEINTIÚN, CIENTO UN."""
        casos = [
            (1, 'UN'),
            (21, 'VEINTIÚN'),
            (31, 'TREINTA Y UN'),
            (101, 'CIENTO UN'),
            (121, 'CIENTO VEINTIÚN'),
            (1001, 'MIL UN'),
            (21000, 'VEINTIÚN MIL'),
            (21000000, 'VEINTIÚN MILLONES'),
        ]
        for numero, esperado in casos:
            with self.subTest(numero=numero):
                self.assertEqual(numero_a_letras(numero, apocope=True), esperado)

    def test_cientos_de_millones_y_mas(self):
        """Hasta miles de millones sin romperse: es el techo real de una factura."""
        casos = [
            (100000000, 'CIEN MILLONES'),
            (123456789, 'CIENTO VEINTITRÉS MILLONES CUATROCIENTOS CINCUENTA Y '
                        'SEIS MIL SETECIENTOS OCHENTA Y NUEVE'),
            (999999999, 'NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS '
                        'NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE'),
            (1000000000, 'MIL MILLONES'),
            (2500000000, 'DOS MIL QUINIENTOS MILLONES'),
        ]
        for numero, esperado in casos:
            with self.subTest(numero=numero):
                self.assertEqual(numero_a_letras(numero), esperado)

    def test_negativo(self):
        with self.assertRaises(ValueError):
            numero_a_letras(-1)

    def test_demasiado_grande(self):
        with self.assertRaises(ValueError):
            numero_a_letras(1_000_000_000_000)


class ImporteConLetraTest(SimpleTestCase):
    """El renglón completo, tal como sale impreso."""

    def test_pesos(self):
        casos = [
            ('0', 'CERO PESOS 00/100 M.N.'),
            ('1', 'UN PESO 00/100 M.N.'),
            ('2', 'DOS PESOS 00/100 M.N.'),
            ('15', 'QUINCE PESOS 00/100 M.N.'),
            ('16', 'DIECISÉIS PESOS 00/100 M.N.'),
            ('21', 'VEINTIÚN PESOS 00/100 M.N.'),
            ('22', 'VEINTIDÓS PESOS 00/100 M.N.'),
            ('30', 'TREINTA PESOS 00/100 M.N.'),
            ('31', 'TREINTA Y UN PESOS 00/100 M.N.'),
            ('100', 'CIEN PESOS 00/100 M.N.'),
            ('101', 'CIENTO UN PESOS 00/100 M.N.'),
            ('115', 'CIENTO QUINCE PESOS 00/100 M.N.'),
            ('200', 'DOSCIENTOS PESOS 00/100 M.N.'),
            ('500', 'QUINIENTOS PESOS 00/100 M.N.'),
            ('700', 'SETECIENTOS PESOS 00/100 M.N.'),
            ('900', 'NOVECIENTOS PESOS 00/100 M.N.'),
            ('999', 'NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.'),
            ('1000', 'MIL PESOS 00/100 M.N.'),
            ('1001', 'MIL UN PESOS 00/100 M.N.'),
            ('2000', 'DOS MIL PESOS 00/100 M.N.'),
            ('21000', 'VEINTIÚN MIL PESOS 00/100 M.N.'),
            ('100000', 'CIEN MIL PESOS 00/100 M.N.'),
            ('999999', 'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y '
                       'NUEVE PESOS 00/100 M.N.'),
            ('1000000', 'UN MILLÓN DE PESOS 00/100 M.N.'),
            ('2000000', 'DOS MILLONES DE PESOS 00/100 M.N.'),
            ('2000001', 'DOS MILLONES UN PESOS 00/100 M.N.'),
            ('1200000', 'UN MILLÓN DOSCIENTOS MIL PESOS 00/100 M.N.'),
        ]
        for monto, esperado in casos:
            with self.subTest(monto=monto):
                self.assertEqual(importe_con_letra(Decimal(monto)), esperado)

    def test_centavos(self):
        """Los centavos van en fracción sobre 100, nunca en letra."""
        casos = [
            ('0.01', 'CERO PESOS 01/100 M.N.'),
            ('0.50', 'CERO PESOS 50/100 M.N.'),
            ('1.00', 'UN PESO 00/100 M.N.'),
            ('1.50', 'UN PESO 50/100 M.N.'),
            ('1724.14', 'MIL SETECIENTOS VEINTICUATRO PESOS 14/100 M.N.'),
            ('2000.50', 'DOS MIL PESOS 50/100 M.N.'),
            ('2000.99', 'DOS MIL PESOS 99/100 M.N.'),
            ('1000000.05', 'UN MILLÓN DE PESOS 05/100 M.N.'),
        ]
        for monto, esperado in casos:
            with self.subTest(monto=monto):
                self.assertEqual(importe_con_letra(Decimal(monto)), esperado)

    def test_millon_exacto_pide_de(self):
        """UN MILLÓN DE PESOS, pero UN MILLÓN QUINIENTOS MIL PESOS sin 'de'.

        Millón es sustantivo, no adjetivo: pide preposición cuando va pegado al
        sustantivo contado, y no la pide cuando entre ambos hay más número.
        """
        self.assertEqual(
            importe_con_letra(Decimal('1500000')),
            'UN MILLÓN QUINIENTOS MIL PESOS 00/100 M.N.',
        )

    def test_tipos_de_entrada(self):
        """Decimal, int, float y str numérico dan el mismo renglón."""
        esperado = 'DOS MIL PESOS 00/100 M.N.'
        for monto in (Decimal('2000.00'), 2000, 2000.0, '2000', ' 2000.00 '):
            with self.subTest(monto=repr(monto)):
                self.assertEqual(importe_con_letra(monto), esperado)

    def test_redondeo_half_up(self):
        """Medio centavo sube: es lo que hace la calculadora de quien revisa."""
        casos = [
            ('0.005', 'CERO PESOS 01/100 M.N.'),
            ('0.004', 'CERO PESOS 00/100 M.N.'),
            ('1.005', 'UN PESO 01/100 M.N.'),
            ('2.675', 'DOS PESOS 68/100 M.N.'),
            # El redondeo puede arrastrar el entero y hasta el singular.
            ('0.999', 'UN PESO 00/100 M.N.'),
            ('999.995', 'MIL PESOS 00/100 M.N.'),
        ]
        for monto, esperado in casos:
            with self.subTest(monto=monto):
                self.assertEqual(importe_con_letra(Decimal(monto)), esperado)

    def test_dolares(self):
        casos = [
            ('1.00', 'UN DÓLAR 00/100 U.S.D.'),
            ('2000.00', 'DOS MIL DÓLARES 00/100 U.S.D.'),
            ('0.00', 'CERO DÓLARES 00/100 U.S.D.'),
            ('1724.14', 'MIL SETECIENTOS VEINTICUATRO DÓLARES 14/100 U.S.D.'),
        ]
        for monto, esperado in casos:
            with self.subTest(monto=monto):
                self.assertEqual(importe_con_letra(Decimal(monto), 'USD'), esperado)
        # El código de moneda llega del CFDI, que lo trae en mayúsculas, pero
        # nadie garantiza que quien llame haga lo mismo.
        self.assertEqual(importe_con_letra(Decimal('1'), 'usd'), 'UN DÓLAR 00/100 U.S.D.')

    def test_moneda_desconocida(self):
        """Sin plural inventado y sin sufijo: solo el código, tal cual."""
        self.assertEqual(importe_con_letra(Decimal('2000'), 'EUR'), 'DOS MIL EUR 00/100')
        self.assertEqual(importe_con_letra(Decimal('1'), 'EUR'), 'UN EUR 00/100')

    def test_negativo_no_es_factura(self):
        with self.assertRaises(ValueError):
            importe_con_letra(Decimal('-1.00'))
        with self.assertRaises(ValueError):
            importe_con_letra(-0.01)

    def test_no_numerico(self):
        with self.assertRaises(ValueError):
            importe_con_letra('dos mil')
        with self.assertRaises(ValueError):
            importe_con_letra(Decimal('NaN'))
