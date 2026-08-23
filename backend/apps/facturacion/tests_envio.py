"""La entrega de la factura por correo.

Lo que se prueba aquí no es "se llamó a la función de correo": es que un CFDI
que no llegó DEJE HUELLA. El envío corre en un hilo y su `True` solo significa
"se puso en camino"; si el resultado real no se anotara, un correo caído sería
invisible hasta que el cliente reclamara meses después. Por eso cada prueba
ejercita el callback a mano: es el único punto donde el sistema se entera.

`enviar_async` va siempre parcheado: aquí no se manda correo de verdad.
"""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from facturacion.envio import enviar_factura
from facturacion.models import Factura, SolicitudFactura
from facturacion.tests_cfdi import cfdi_xml
from maquinaria.models import Notificacion

UUID = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        email='jazmin@correo.mx', concepto='Revolvedora de concreto',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


def factura(sol=None, **extra):
    datos = dict(
        solicitud=sol or solicitud(), xml=cfdi_xml(), uuid=UUID,
        serie='A', folio='123', total=Decimal('2000.00'), moneda='MXN',
    )
    datos.update(extra)
    return Factura.objects.create(**datos)


class AdjuntosTest(TestCase):
    """Al cliente le tienen que llegar los DOS archivos, y con nombre reconocible."""

    def test_van_el_xml_y_el_pdf(self):
        f = factura()
        with patch('maquinaria.correo.enviar_async', return_value=True) as env:
            self.assertTrue(enviar_factura(f))
        _asunto, cuerpo, destinos, adjuntos = env.call_args.args
        self.assertEqual(destinos, ['jazmin@correo.mx'])
        self.assertEqual([n for n, _c, _t in adjuntos], ['A123.xml', 'A123.pdf'])
        self.assertEqual([t for _n, _c, t in adjuntos], ['application/xml', 'application/pdf'])
        # El XML sale tal cual: cualquier byte distinto invalida el sello.
        self.assertEqual(adjuntos[0][1], f.xml.encode('utf-8'))
        self.assertTrue(adjuntos[1][1].startswith(b'%PDF'))
        # El cuerpo tiene que decirle al cliente de qué es esto sin abrir nada.
        self.assertIn(UUID, cuerpo)
        self.assertIn('2,000.00', cuerpo)

    def test_sin_serie_ni_folio_los_archivos_usan_el_uuid(self):
        """Un CFDI sin folio no puede mandar dos archivos llamados ".xml"."""
        f = factura(serie='', folio='')
        with patch('maquinaria.correo.enviar_async', return_value=True) as env:
            enviar_factura(f)
        adjuntos = env.call_args.args[3]
        self.assertEqual([n for n, _c, _t in adjuntos], [f'{UUID[:8]}.xml', f'{UUID[:8]}.pdf'])

    def test_si_el_pdf_truena_el_xml_sale_igual(self):
        """El XML es el documento fiscal; el PDF es la decoración.

        Que falle el adorno no puede dejar al cliente sin su factura.
        """
        f = factura()
        with patch('facturacion.pdf.render_factura_pdf', side_effect=RuntimeError('fuente rota')), \
             patch('maquinaria.correo.enviar_async', return_value=True) as env:
            self.assertTrue(enviar_factura(f))
        adjuntos = env.call_args.args[3]
        self.assertEqual([n for n, _c, _t in adjuntos], ['A123.xml'])


class SinCorreoTest(TestCase):

    def test_no_se_inventa_destinatario(self):
        """Sin correo fiscal no se manda a "algún" correo: eso sería filtrar
        los datos fiscales de un cliente a quien no le tocan."""
        f = factura(sol=solicitud(email=''))
        with patch('maquinaria.correo.enviar_async') as env:
            self.assertFalse(enviar_factura(f))
        env.assert_not_called()
        f.refresh_from_db()
        self.assertEqual(f.envio_estado, 'pendiente')


class ResultadoDelEnvioTest(TestCase):
    """El callback: lo único que convierte "se puso en camino" en un hecho."""

    def _callback(self, f):
        with patch('maquinaria.correo.enviar_async', return_value=True) as env:
            enviar_factura(f)
        return env.call_args.kwargs['al_terminar']

    def test_si_salio_queda_enviada_con_fecha(self):
        f = factura()
        self._callback(f)(True)
        f.refresh_from_db()
        self.assertEqual(f.envio_estado, 'enviada')
        self.assertIsNotNone(f.enviada_en)
        self.assertEqual(f.envio_error, '')

    def test_si_no_salio_queda_en_fallo_y_avisa_en_el_panel(self):
        f = factura()
        self._callback(f)(False)
        f.refresh_from_db()
        self.assertEqual(f.envio_estado, 'fallo')
        self.assertTrue(f.envio_error)
        self.assertLessEqual(len(f.envio_error), 255)
        n = Notificacion.objects.filter(seccion='facturacion').first()
        self.assertIsNotNone(n, 'un correo caído sin notificación es un correo caído invisible')
        self.assertIn(UUID, n.mensaje)

    def test_reintentar_y_volver_a_fallar_no_llena_el_panel(self):
        f = factura()
        cb = self._callback(f)
        cb(False)
        cb(False)
        self.assertEqual(Notificacion.objects.filter(seccion='facturacion').count(), 1)


class CallbackEnElHiloTest(TestCase):
    """El contrato con `correo.py`: el resultado se avisa pase lo que pase."""

    def test_el_helper_avisa_ok_y_fallo(self):
        from maquinaria.correo import _enviar

        vistos = []
        with patch('maquinaria.correo._enviar_api_brevo', return_value=True):
            _enviar('x', 'y', ['a@b.mx'], [], al_terminar=vistos.append)
        with patch('maquinaria.correo._enviar_api_brevo', return_value=False), \
             patch('maquinaria.correo.EmailMessage', side_effect=RuntimeError('SMTP caído')):
            _enviar('x', 'y', ['a@b.mx'], [], al_terminar=vistos.append)
        self.assertEqual(vistos, [True, False])

    def test_un_callback_roto_no_tumba_el_envio(self):
        from maquinaria.correo import _enviar

        def explota(_ok):
            raise RuntimeError('la base se cayó justo ahí')

        with patch('maquinaria.correo._enviar_api_brevo', return_value=True):
            _enviar('x', 'y', ['a@b.mx'], [], al_terminar=explota)  # no debe propagar


class ReenviarTest(TestCase):

    def setUp(self):
        U = get_user_model()
        self.admin = U.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _reenviar(self, f):
        return self.client.post(f'/api/facturacion/facturas/{f.id}/reenviar/')

    def test_vuelve_a_intentar(self):
        f = factura(envio_estado='fallo', envio_error='algo pasó')
        with patch('maquinaria.correo.enviar_async', return_value=True) as env:
            r = self._reenviar(f)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(env.call_args.args[2], ['jazmin@correo.mx'])

    def test_sin_correo_pide_capturarlo_en_vez_de_fingir_que_se_mandó(self):
        f = factura(sol=solicitud(email=''))
        with patch('maquinaria.correo.enviar_async') as env:
            r = self._reenviar(f)
        self.assertEqual(r.status_code, 400)
        self.assertIn('correo', r.data['detalle'].lower())
        env.assert_not_called()

    def test_el_cliente_no_puede_reenviar_facturas(self):
        f = factura()
        self.client.force_authenticate(get_user_model().objects.create_user('juan', 'j@x.com', 'pass12345'))
        self.assertIn(self._reenviar(f).status_code, (401, 403))


class SubirDisparaElEnvioTest(TestCase):
    """La subida y el envío son un solo gesto para quien está en el panel."""

    def setUp(self):
        from maquinaria.models import ConfiguracionSitio

        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        cfg = ConfiguracionSitio.get_solo()
        cfg.negocio_rfc = 'REM010101AAA'
        cfg.save()
        self.sol = solicitud()

    def _subir(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/factura/',
            {'xml': SimpleUploadedFile('f.xml', cfdi_xml().encode(), 'text/xml')},
            format='multipart',
        )

    def test_al_subir_el_cfdi_sale_el_correo(self):
        with patch('maquinaria.correo.enviar_async', return_value=True) as env:
            r = self._subir()
        self.assertEqual(r.status_code, 201, r.data)
        env.assert_called_once()
        self.assertEqual(env.call_args.args[2], ['jazmin@correo.mx'])

    def test_si_el_correo_truena_la_factura_igual_queda_registrada(self):
        """El CFDI ya existe ante el SAT: perderlo por un problema de correo
        dejaría la venta sin factura en el sistema y a nadie enterado."""
        with patch('maquinaria.correo.enviar_async', side_effect=RuntimeError('sin red')):
            r = self._subir()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Factura.objects.count(), 1)
