"""Los candados: qué XML puede entrar a qué solicitud.

Cada prueba deja claro qué pasa si el candado no estuviera. El del RFC es el que
evita mandarle a un cliente la factura de otro; el del UUID es el que atrapa
subir dos veces el mismo archivo, que no se ve raro hasta que alguien reclama.
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from facturacion.cfdi import leer_cfdi
from facturacion.models import Factura, SolicitudFactura
from facturacion.tests_cfdi import cfdi_xml
from facturacion.validacion import DescuadreCFDI, revisar_cfdi
from maquinaria.models import ConfiguracionSitio

RFC_NEGOCIO = 'REM010101AAA'


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


class CandadosTest(TestCase):

    def test_un_cfdi_que_cuadra_pasa(self):
        revisar_cfdi(leer_cfdi(cfdi_xml()), solicitud(), rfc_negocio=RFC_NEGOCIO)

    def test_rechaza_la_factura_de_otro_cliente(self):
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(rfc_receptor='XAXX010101000')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('XAXX010101000', str(caso.exception))
        self.assertIn('MEJJ800101ABC', str(caso.exception))

    def test_rechaza_la_factura_de_un_proveedor(self):
        """Emitida por otro RFC: no la emitimos nosotros."""
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(rfc_emisor='AAA010101AAA')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('emitió', str(caso.exception))

    def test_rechaza_otro_total(self):
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(total='3500.00')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('3500', str(caso.exception))

    def test_un_centavo_de_diferencia_sí_pasa(self):
        """Redondeo, no error: el mismo criterio que los pagos combinados."""
        revisar_cfdi(leer_cfdi(cfdi_xml(total='2000.01')),
                     solicitud(), rfc_negocio=RFC_NEGOCIO)

    def test_rechaza_un_uuid_que_ya_existe(self):
        s = solicitud()
        Factura.objects.create(
            solicitud=s, xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml()), solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('ya está', str(caso.exception))

    def test_sin_rfc_del_negocio_no_verifica_al_emisor_pero_lo_dice(self):
        avisos = revisar_cfdi(leer_cfdi(cfdi_xml(rfc_emisor='AAA010101AAA')),
                              solicitud(), rfc_negocio='')
        self.assertTrue(any('negocio' in a for a in avisos))


class SubirFacturaTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        cfg = ConfiguracionSitio.objects.first() or ConfiguracionSitio.objects.create()
        cfg.negocio_rfc = RFC_NEGOCIO
        cfg.save()
        self.sol = solicitud()

    def _subir(self, xml=None):
        archivo = SimpleUploadedFile('factura.xml', (xml or cfdi_xml()).encode(), 'text/xml')
        return self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/factura/',
            {'xml': archivo}, format='multipart',
        )

    def test_entra_y_marca_la_solicitud(self):
        r = self._subir()
        self.assertEqual(r.status_code, 201, r.data)
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.estado, 'facturada')
        self.assertEqual(self.sol.uuid, 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.assertIsNotNone(self.sol.fecha_timbrado)

    def test_guarda_el_xml_intacto(self):
        """Byte por byte: el que se descargue tiene que ser el que se subió."""
        original = cfdi_xml()
        self._subir(original)
        self.assertEqual(Factura.objects.get().xml, original)

    def test_deja_rastro_de_quien_lo_subio(self):
        self._subir()
        self.assertEqual(Factura.objects.get().subida_por_id, self.admin.id)

    def test_un_descuadre_no_deja_nada_a_medias(self):
        r = self._subir(cfdi_xml(rfc_receptor='XAXX010101000'))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Factura.objects.exists())
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.estado, 'pendiente')

    def test_un_archivo_que_no_es_cfdi_da_400_y_no_500(self):
        r = self._subir('%PDF-1.4 esto es el pdf del PAC')
        self.assertEqual(r.status_code, 400)
        self.assertIn('CFDI', r.data['detalle'])

    def test_el_cliente_no_puede_subir_facturas(self):
        cliente = get_user_model().objects.create_user('juan', 'j@x.com', 'pass12345')
        self.client.force_authenticate(cliente)
        self.assertIn(self._subir().status_code, (401, 403))
