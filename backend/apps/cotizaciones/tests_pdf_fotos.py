"""Las fotos de la cotización tienen que salir en el PDF que se descarga.

En pantalla salían; en el PDF, no: el generador abría cada foto con
`imagen.path`, que solo existe cuando los archivos están en disco. En
producción viven en Cloudinary, ahí esa llamada levanta NotImplementedError y
—como el intento iba dentro de un try— las fotos se caían sin dejar rastro:
quedaba el título FOTOS encabezando un hueco blanco.

El storage de estas pruebas sí guarda en disco, así que para reproducirlo se le
quita el `path` a los archivos: es exactamente lo que hace Cloudinary.
"""

from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.db.models.fields.files import FieldFile
from django.test import TestCase

from cotizaciones.models import Cotizacion, CotizacionFoto, CotizacionItem
from cotizaciones.pdf import render_cotizacion_pdf
from server.documentos import logo_bytes


def _foto(color='red') -> ContentFile:
    from PIL import Image
    buf = BytesIO()
    Image.new('RGB', (900, 700), color).save(buf, format='JPEG')
    return ContentFile(buf.getvalue(), name=f'{color}.jpg')


def _sin_path(self):
    raise NotImplementedError("This backend doesn't support absolute paths.")


class FotosEnElPdfTest(TestCase):

    def setUp(self):
        self.cot = Cotizacion.objects.create(
            tipo='venta', estado='borrador',
            cliente_nombre='Karla Santana', cliente_telefono='7441772370',
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Bomba de agua · venta',
            modalidad='venta', cantidad=1, precio_unitario=Decimal('12000'),
        )
        self.cot.refresh_from_db()

    def _fotos_del_pdf(self, pdf: bytes) -> int:
        """Cuántas fotos quedaron incrustadas.

        No se puede buscar la palabra 'FOTOS': el texto del PDF va comprimido.
        Lo que sí se ve en claro es cada imagen: las fotos entran como JPEG
        (/DCTDecode) y el logo del membrete no, así que contarlas es contar
        exactamente lo que se está probando.
        """
        return pdf.count(b'/DCTDecode')

    def test_sin_fotos_no_se_incrusta_nada(self):
        self.assertEqual(self._fotos_del_pdf(render_cotizacion_pdf(self.cot)), 0)

    def test_las_fotos_se_incrustan(self):
        CotizacionFoto.objects.create(cotizacion=self.cot, imagen=_foto('red'), orden=0)
        CotizacionFoto.objects.create(cotizacion=self.cot, imagen=_foto('blue'), orden=1)
        self.assertEqual(self._fotos_del_pdf(render_cotizacion_pdf(self.cot)), 2)

    def test_storage_remoto_sin_path_igual_incrusta(self):
        """El caso de producción: Cloudinary no da rutas de disco."""
        CotizacionFoto.objects.create(cotizacion=self.cot, imagen=_foto('green'), orden=0)
        with patch.object(FieldFile, 'path', property(_sin_path)):
            pdf = render_cotizacion_pdf(self.cot)
        self.assertEqual(self._fotos_del_pdf(pdf), 1)

    def test_una_foto_ilegible_no_tumba_el_documento(self):
        CotizacionFoto.objects.create(cotizacion=self.cot, imagen=_foto('red'), orden=0)
        with patch('cotizaciones.pdf.lector_imagen', return_value=None):
            pdf = render_cotizacion_pdf(self.cot)
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertEqual(self._fotos_del_pdf(pdf), 0)

    def test_el_logo_de_la_marca_existe(self):
        """El membrete pinta el archivo real; si se pierde, el PDF sale con la R."""
        self.assertTrue(logo_bytes())
