"""La representación impresa: que diga lo que dice el XML, y nada más.

Las pruebas leen el TEXTO del PDF, no solo comprueban que se generó. Un PDF que
se arma sin reventar pero imprime otro IVA es peor que uno que falla: sale con
el logo del negocio y el cliente lo archiva.

Para poder leerlo se apaga la compresión de reportlab durante la prueba
(`rl_config.pageCompression`), que por defecto viene encendida y deja los
operadores de texto ilegibles en el flujo.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from reportlab import rl_config
from rest_framework.test import APIClient

from facturacion.models import Factura, SolicitudFactura
from facturacion.pdf import _liga_sat, render_factura_pdf
from facturacion.tests_cfdi import cfdi_xml
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta

UUID_1 = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'


def texto_del_pdf(datos: bytes) -> str:
    """El PDF como texto plano, para buscar lo que quedó impreso."""
    return datos.decode('latin-1')


def _solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


def _factura(solicitud=None, **extra):
    datos = dict(
        solicitud=solicitud or _solicitud(),
        xml=cfdi_xml(),
        uuid=UUID_1, serie='A', folio='123',
        rfc_emisor='REM010101AAA', nombre_emisor='REMALI SA DE CV', regimen_emisor='601',
        rfc_receptor='MEJJ800101ABC', nombre_receptor='CONSTRUCTORA DEL SUR SA DE CV',
        cp_receptor='39300', regimen_receptor='612', uso_cfdi='G03',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
        moneda='MXN', tipo_comprobante='I', forma_pago='03', metodo_pago='PUE',
        lugar_expedicion='39300',
        fecha_emision='2026-08-22T10:15:00', fecha_certificacion='2026-08-22T10:15:30',
        sello_cfd='c2VsbG9DRkQxMjM0NTY3OA==', sello_sat='c2VsbG9TQVQ=',
        no_certificado_emisor='30001000000500003416', no_certificado_sat='30001000000400002495',
        cadena_original='||1.1|' + UUID_1 + '|2026-08-22T10:15:30|SAT970701NN3|c2VsbG9DRkQ=|30001000000400002495||',
    )
    datos.update(extra)
    return Factura.objects.create(**datos)


class RepresentacionImpresaTest(TestCase):

    def setUp(self):
        # Sin compresión el texto queda legible dentro del PDF.
        self._compresion = rl_config.pageCompression
        rl_config.pageCompression = 0
        self.addCleanup(setattr, rl_config, 'pageCompression', self._compresion)

    def test_es_un_pdf(self):
        datos = render_factura_pdf(_factura())
        self.assertTrue(datos.startswith(b'%PDF-'))

    def test_transcribe_los_importes_del_xml_y_no_los_recalcula(self):
        """La prueba que justifica todo el módulo.

        Esta factura trae un IVA que NO es total/1.16. Es raro pero legal (una
        venta con partidas exentas, por ejemplo), y es exactamente donde la
        lógica interna de REMALI destrozaría el documento: desglosaría $275.86
        cuando el CFDI dice $100.00. Manda el XML, siempre.
        """
        f = _factura(subtotal=Decimal('1900.00'), iva=Decimal('100.00'), total=Decimal('2000.00'))
        t = texto_del_pdf(render_factura_pdf(f))
        self.assertIn('$1,900.00', t)
        self.assertIn('$100.00', t)
        self.assertIn('$2,000.00', t)
        self.assertNotIn('$275.86', t)     # lo que habría salido de calcularlo

    def test_el_iva_no_queda_debajo_de_la_barra_del_total(self):
        """Se rompió dos veces: la barra del TOTAL se dibujaba encima del IVA.

        No se puede comprobar el pixel desde aquí, pero sí que las tres cifras
        estén IMPRESAS: si alguien vuelve a encimarlas, esta prueba obliga a
        mirar el bloque antes de darlo por bueno.
        """
        f = _factura(subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'))
        t = texto_del_pdf(render_factura_pdf(f))
        self.assertIn('$275.86', t)
        self.assertIn('$1,724.14', t)
        self.assertIn('$2,000.00', t)
        self.assertIn('IVA 16%', t)

    def test_lleva_el_folio_fiscal_y_la_leyenda_obligatoria(self):
        t = texto_del_pdf(render_factura_pdf(_factura()))
        self.assertIn(UUID_1, t)
        self.assertIn('representaci', t.lower())   # "representación impresa de un CFDI"
        self.assertIn('CFDI', t)

    def test_lleva_los_sellos_y_los_certificados(self):
        t = texto_del_pdf(render_factura_pdf(_factura()))
        self.assertIn('30001000000500003416', t)   # certificado del emisor
        self.assertIn('30001000000400002495', t)   # certificado del SAT

    def test_el_folio_de_la_serie_va_en_el_encabezado(self):
        """Serie y folio separados, como los imprime cualquier factura: 'A 123'."""
        t = texto_del_pdf(render_factura_pdf(_factura(serie='A', folio='123')))
        self.assertIn('A 123', t)

    def test_imprime_la_cantidad_con_letra(self):
        t = texto_del_pdf(render_factura_pdf(_factura()))
        self.assertIn('DOS MIL PESOS 00/100 M.N.', t)

    def test_traduce_las_claves_del_sat(self):
        """Nadie sabe qué es un PUE. La clave se queda, la palabra se agrega."""
        t = texto_del_pdf(render_factura_pdf(_factura()))
        self.assertIn('Transferencia', t)
        self.assertIn('Pago en una sola exhibici', t)
        self.assertIn('Ingreso', t)          # tipo de comprobante 'I'

    def test_una_cancelada_lo_grita(self):
        t = texto_del_pdf(render_factura_pdf(_factura(estado='cancelada')))
        self.assertIn('CANCELADA', t)

    def test_una_vigente_no_dice_cancelada(self):
        t = texto_del_pdf(render_factura_pdf(_factura()))
        self.assertNotIn('CANCELADA', t)

    def test_se_genera_aunque_el_xml_no_se_pueda_leer(self):
        """El XML guardado es la verdad, pero si un día no se puede parsear, el
        resto del documento (que sale de las columnas) tiene que salir igual."""
        datos = render_factura_pdf(_factura(xml='esto ya no es un xml'))
        self.assertTrue(datos.startswith(b'%PDF-'))

    def test_la_liga_del_qr_lleva_lo_que_pide_el_sat(self):
        liga = _liga_sat(_factura())
        self.assertIn('verificacfdi.facturaelectronica.sat.gob.mx', liga)
        self.assertIn(f'id={UUID_1}', liga)
        self.assertIn('re=REM010101AAA', liga)
        self.assertIn('rr=MEJJ800101ABC', liga)
        # CFDI 4.0 manda el total a secas. El relleno de ceros
        # ('tt=0000002000.000000') es de la 3.2 y el verificador no lo casa.
        self.assertIn('tt=2000.00', liga)
        self.assertNotIn('tt=0000', liga)
        # El SAT pide los ÚLTIMOS 8 caracteres del sello del CFDI, no los primeros.
        self.assertIn('fe=NTY3OA==', liga)


class UnidadDeRemaliEnElPDFTest(TestCase):
    """Lo único que la factura del PAC no puede saber: qué fierro se entregó."""

    def setUp(self):
        self._compresion = rl_config.pageCompression
        rl_config.pageCompression = 0
        self.addCleanup(setattr, rl_config, 'pageCompression', self._compresion)
        equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('2000'))
        self.unidad = Inventario.objects.create(
            equipo=equipo, condicion='nueva', numero_serie='SN-4471',
        )
        self.venta = Venta.objects.create(
            nombre_cliente='Jazmín', inventario=self.unidad, precio_maquina=Decimal('2000'),
        )

    def test_imprime_el_codigo_y_el_numero_de_serie(self):
        f = _factura(solicitud=_solicitud(venta=self.venta))
        t = texto_del_pdf(render_factura_pdf(f))
        self.assertIn(self.unidad.codigo, t)
        self.assertIn('SN-4471', t)

    def test_sin_venta_ligada_no_inventa_nada(self):
        datos = render_factura_pdf(_factura())
        self.assertTrue(datos.startswith(b'%PDF-'))


class DescargarPDFTest(TestCase):

    def setUp(self):
        U = get_user_model()
        self.admin = U.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.comprador = U.objects.create_user('jazmin', 'j@x.com', 'pass12345')
        self.ajeno = U.objects.create_user('otro', 'o@x.com', 'pass12345')
        equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('2000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='nueva')
        venta = Venta.objects.create(
            nombre_cliente='Jazmín', inventario=unidad,
            precio_maquina=Decimal('2000'), cliente_usuario=self.comprador,
        )
        self.factura = _factura(solicitud=_solicitud(venta=venta))
        self.client = APIClient()

    def _bajar(self, quien):
        self.client.force_authenticate(quien)
        return self.client.get(f'/api/facturacion/facturas/{self.factura.id}/pdf/')

    def test_el_comprador_baja_su_pdf(self):
        r = self._bajar(self.comprador)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Content-Type'], 'application/pdf')
        self.assertTrue(r.content.startswith(b'%PDF-'))

    def test_administracion_tambien(self):
        self.assertEqual(self._bajar(self.admin).status_code, 200)

    def test_otro_cliente_no_puede(self):
        """Mismo criterio que el XML: 404, no 403. El id es consecutivo."""
        self.assertEqual(self._bajar(self.ajeno).status_code, 404)
