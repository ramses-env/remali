"""Leer un CFDI 4.0 timbrado.

Este módulo NO sabe que existen las solicitudes ni las ventas: recibe el texto
de un XML y devuelve sus campos. Todo lo que decide si ese CFDI corresponde a
una venta vive en `validacion.py`.

Se parsea con defusedxml y no con el ElementTree de la librería estándar: el
archivo lo sube un humano desde fuera, y la expansión de entidades es un ataque
conocido contra los parsers de XML.
"""
from decimal import Decimal, InvalidOperation

from defusedxml.ElementTree import fromstring, ParseError

CFDI = 'http://www.sat.gob.mx/cfd/4'
TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'


class CFDIInvalido(Exception):
    """El archivo no es un CFDI timbrado que se pueda leer."""


def _dec(valor, default='0'):
    try:
        return Decimal(str(valor if valor not in (None, '') else default))
    except InvalidOperation:
        return Decimal(default)


def leer_cfdi(texto):
    """Devuelve un dict con los campos del CFDI. Lanza CFDIInvalido si no lo es."""
    if isinstance(texto, bytes):
        texto = texto.decode('utf-8', errors='replace')
    try:
        raiz = fromstring(texto.encode('utf-8'))
    except (ParseError, ValueError) as e:
        raise CFDIInvalido(
            'El archivo no es un XML que se pueda leer, así que no puede ser un '
            'CFDI. ¿Subiste el PDF por error?'
        ) from e

    if not raiz.tag.endswith('}Comprobante'):
        raise CFDIInvalido('El XML no es un CFDI: falta el nodo Comprobante.')

    emisor = raiz.find(f'{{{CFDI}}}Emisor')
    receptor = raiz.find(f'{{{CFDI}}}Receptor')
    impuestos = raiz.find(f'{{{CFDI}}}Impuestos')
    timbre = raiz.find(f'.//{{{TFD}}}TimbreFiscalDigital')
    if timbre is None:
        raise CFDIInvalido(
            'Esto no es un CFDI timbrado: no trae Timbre Fiscal Digital. '
            '¿Subiste el acuse o el PDF por error?'
        )
    if emisor is None or receptor is None:
        raise CFDIInvalido('El CFDI no trae emisor o receptor.')

    g = raiz.get
    t = timbre.get
    conceptos = [
        {
            'descripcion': c.get('Descripcion', ''),
            'cantidad': _dec(c.get('Cantidad'), '1'),
            # Claves del catálogo del SAT. Se imprimen en la representación:
            # es lo que el contador del cliente busca para clasificar el gasto.
            'clave_prod_serv': c.get('ClaveProdServ', ''),
            'clave_unidad': c.get('ClaveUnidad', ''),
            'valor_unitario': _dec(c.get('ValorUnitario')),
            'importe': _dec(c.get('Importe')),
            'descuento': _dec(c.get('Descuento')),
        }
        for c in raiz.findall(f'{{{CFDI}}}Conceptos/{{{CFDI}}}Concepto')
    ]
    return {
        'version': g('Version', ''),
        'serie': g('Serie', ''),
        'folio': g('Folio', ''),
        'fecha_emision': g('Fecha', ''),
        'sello_cfd': g('Sello', ''),
        'no_certificado_emisor': g('NoCertificado', ''),
        'subtotal': _dec(g('SubTotal')),
        'descuento': _dec(g('Descuento')),
        'total': _dec(g('Total')),
        'moneda': g('Moneda', 'MXN'),
        'tipo_comprobante': g('TipoDeComprobante', ''),
        'exportacion': g('Exportacion', ''),
        'metodo_pago': g('MetodoPago', ''),
        'forma_pago': g('FormaPago', ''),
        'lugar_expedicion': g('LugarExpedicion', ''),
        'rfc_emisor': (emisor.get('Rfc') or '').upper(),
        'nombre_emisor': emisor.get('Nombre', ''),
        'regimen_emisor': emisor.get('RegimenFiscal', ''),
        'rfc_receptor': (receptor.get('Rfc') or '').upper(),
        'nombre_receptor': receptor.get('Nombre', ''),
        'cp_receptor': receptor.get('DomicilioFiscalReceptor', ''),
        'regimen_receptor': receptor.get('RegimenFiscalReceptor', ''),
        'uso_cfdi': receptor.get('UsoCFDI', ''),
        'iva': _dec(impuestos.get('TotalImpuestosTrasladados') if impuestos is not None else 0),
        'uuid': (t('UUID') or '').upper(),
        'fecha_certificacion': t('FechaTimbrado', ''),
        'rfc_prov_certif': t('RfcProvCertif', ''),
        'sello_sat': t('SelloSAT', ''),
        'no_certificado_sat': t('NoCertificadoSAT', ''),
        'cadena_original': (
            f"||{t('Version', '1.1')}|{t('UUID', '')}|{t('FechaTimbrado', '')}|"
            f"{t('RfcProvCertif', '')}|{t('SelloCFD', '')}|{t('NoCertificadoSAT', '')}||"
        ),
        'conceptos': conceptos,
    }
