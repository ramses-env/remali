"""El lector de CFDI: de un XML timbrado a los campos que REMALI necesita.

Se prueba con un constructor y no con archivos sueltos: cada prueba dice en su
primera línea qué tiene de distinto ese CFDI (otro RFC, otro total, sin timbre),
y no hay que abrir un .xml para entender qué se está probando.
"""
from decimal import Decimal

from django.test import SimpleTestCase

from facturacion.cfdi import CFDIInvalido, leer_cfdi

TIMBRE = (
    '<tfd:TimbreFiscalDigital Version="1.1" '
    'UUID="A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D" '
    'FechaTimbrado="2026-08-22T10:15:30" RfcProvCertif="SAT970701NN3" '
    'SelloCFD="c2VsbG9DRkQ=" NoCertificadoSAT="30001000000400002495" '
    'SelloSAT="c2VsbG9TQVQ=" />'
)


def cfdi_xml(*, rfc_emisor='REM010101AAA', rfc_receptor='MEJJ800101ABC',
             total='2000.00', subtotal='1724.14', iva='275.86',
             serie='A', folio='123', timbre=TIMBRE):
    """Un CFDI 4.0 mínimo pero completo. Lo que cambia se pasa por parámetro."""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="{serie}" Folio="{folio}" Fecha="2026-08-22T10:15:00"
  Sello="c2VsbG9EZWxFbWlzb3I=" NoCertificado="30001000000500003416"
  SubTotal="{subtotal}" Moneda="MXN" Total="{total}"
  TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" FormaPago="03"
  LugarExpedicion="39300">
  <cfdi:Emisor Rfc="{rfc_emisor}" Nombre="REMALI SA DE CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="{rfc_receptor}" Nombre="JAZMIN MENDOZA"
    DomicilioFiscalReceptor="39300" RegimenFiscalReceptor="612" UsoCFDI="G03" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="22101502" Cantidad="1" ClaveUnidad="H87"
      Descripcion="Revolvedora de concreto 1 saco" ValorUnitario="{subtotal}"
      Importe="{subtotal}" ObjetoImp="02" />
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="{iva}" />
  <cfdi:Complemento>{timbre}</cfdi:Complemento>
</cfdi:Comprobante>'''


class LeerCFDITest(SimpleTestCase):

    def test_saca_la_identidad_fiscal(self):
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(d['uuid'], 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.assertEqual(d['serie'], 'A')
        self.assertEqual(d['folio'], '123')
        self.assertEqual(d['rfc_emisor'], 'REM010101AAA')
        self.assertEqual(d['rfc_receptor'], 'MEJJ800101ABC')
        self.assertEqual(d['uso_cfdi'], 'G03')

    def test_los_importes_llegan_como_decimal(self):
        """Como Decimal y no como float: es dinero, y se compara al centavo."""
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(d['total'], Decimal('2000.00'))
        self.assertEqual(d['subtotal'], Decimal('1724.14'))
        self.assertEqual(d['iva'], Decimal('275.86'))

    def test_arma_la_cadena_original_del_timbre(self):
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(
            d['cadena_original'],
            '||1.1|A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D|2026-08-22T10:15:30|'
            'SAT970701NN3|c2VsbG9DRkQ=|30001000000400002495||',
        )

    def test_sin_timbre_no_es_un_cfdi_valido(self):
        """El caso real: subir el XML previo al timbrado, o el acuse."""
        with self.assertRaises(CFDIInvalido) as caso:
            leer_cfdi(cfdi_xml(timbre=''))
        self.assertIn('timbrado', str(caso.exception).lower())

    def test_un_archivo_que_no_es_xml_no_revienta(self):
        with self.assertRaises(CFDIInvalido):
            leer_cfdi('%PDF-1.4 esto es un pdf')

    def test_un_xml_que_no_es_cfdi_no_revienta(self):
        with self.assertRaises(CFDIInvalido):
            leer_cfdi('<?xml version="1.0"?><lista><cosa/></lista>')
