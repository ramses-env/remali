"""El correo del código: que llegue, y que se entienda.

Se prueba el texto y no el diseño porque el correo va en texto plano a
propósito (ver `plantillas_correo`). Lo que puede romperse aquí no es estético:
un cero que se pierde, un código que no se puede copiar, o una redacción que
deja al cliente sin saber qué hacer con seis dígitos.
"""
import os
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings

from maquinaria.plantillas_correo import correo_codigo


class TextoDelCodigoTest(TestCase):

    def setUp(self):
        self.asunto, self.texto = correo_codigo('Josue Ramses Rojas', '078650', 15)

    def test_el_codigo_va_en_el_asunto(self):
        """Muchos clientes enseñan el asunto en la notificación: así se lee sin abrir."""
        self.assertTrue(self.asunto.startswith('078650'))

    def test_el_codigo_va_en_el_cuerpo(self):
        self.assertIn('078650', self.texto)

    def test_saluda_solo_con_el_primer_nombre(self):
        self.assertIn('Hola Josue', self.texto)
        self.assertNotIn('Rojas', self.texto)

    def test_sin_nombre_saluda_igual(self):
        _, texto = correo_codigo('', '078650', 15)
        self.assertIn('Hola:', texto)
        self.assertNotIn('Hola :', texto)

    def test_dice_cuanto_dura(self):
        self.assertIn('15 minutos', self.texto)

    def test_dice_que_hacer_con_el_codigo(self):
        """Seis dígitos sin instrucción son un acertijo."""
        self.assertIn('Escríbelo', self.texto)

    def test_dice_como_pedir_otro(self):
        """Sin esta línea, a quien se le vence el código se le acaba el camino."""
        self.assertIn('pide otro', self.texto)

    def test_cubre_el_caso_de_quien_no_lo_pidio(self):
        self.assertIn('Si no fuiste tú', self.texto)

    def test_el_codigo_se_puede_copiar_de_una_pieza(self):
        """Sin espacios entre dígitos: `0 7 8 6 5 0` se copia con espacios y ya
        no pega en el campo."""
        self.assertIn('    078650\n', self.texto)

    def test_va_firmado(self):
        self.assertIn('REMALI', self.texto)


class CodigoConCeroInicialTest(TestCase):
    """Un código que empieza en cero no puede perderlo por el camino."""

    def test_el_cero_sobrevive(self):
        asunto, texto = correo_codigo('Ana', '007123', 15)
        # Los seis dígitos completos, no los cuatro que quedarían si algo lo
        # tratara como número. Se compara la línea entera del cuerpo por eso:
        # buscar '007123' pasaría igual aunque el asunto dijera '7123'.
        self.assertTrue(asunto.startswith('007123 '))
        self.assertIn('    007123\n', texto)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class EnvioTest(TestCase):
    """Estas pruebas miden la ruta SMTP, así que apagan Brevo a propósito.

    `_enviar` intenta primero la API de Brevo y solo cae al SMTP si no hay
    llave. En cuanto alguien configura BREVO_API_KEY en su `.env` —que es lo
    normal— el correo deja de pasar por `mail.outbox` y estas pruebas se ponen
    en rojo sin que nadie haya tocado el código.
    """

    def setUp(self):
        sin_brevo = patch.dict(os.environ, {'BREVO_API_KEY': ''})
        sin_brevo.start()
        self.addCleanup(sin_brevo.stop)


    def test_sale_como_texto_sin_parte_html(self):
        """Va en texto a propósito: el HTML caía fuera de Recibidos mientras el
        texto llegaba a la bandeja. Si alguien le vuelve a colgar una parte
        HTML sin arreglar antes SPF y DKIM, esto se pone en rojo."""
        from maquinaria.correo import _enviar
        asunto, texto = correo_codigo('Ana', '123456', 15)
        _enviar(asunto, texto, ['ana@ejemplo.com'], [])
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertIn('123456', msg.body)
        self.assertFalse(getattr(msg, 'alternatives', []))

    def test_la_capa_de_correo_sigue_pudiendo_mandar_html(self):
        """La capacidad se conserva para cuando el dominio esté autenticado:
        volver a maquetarlo tiene que ser una línea, no rehacer el trabajo."""
        from maquinaria.correo import _enviar
        _enviar('Asunto', 'texto', ['ana@ejemplo.com'], [], '<p>hola</p>')
        self.assertEqual(mail.outbox[0].alternatives[0][1], 'text/html')
