"""El ciclo de vida de la factura: nace vigente, se cancela, se refactura."""
from decimal import Decimal

from django.test import TestCase

from facturacion.models import Factura, SolicitudFactura


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        email='jazmin@correo.mx',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


class CicloDeLaFacturaTest(TestCase):

    def test_nace_vigente(self):
        f = Factura.objects.create(
            solicitud=solicitud(), xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
            total=Decimal('2000.00'),
        )
        self.assertEqual(f.estado, 'vigente')

    def test_el_uuid_no_se_repite(self):
        """El mismo XML subido dos veces es el error silencioso más probable."""
        uuid = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'
        Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)
        with self.assertRaises(Exception):
            Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)
