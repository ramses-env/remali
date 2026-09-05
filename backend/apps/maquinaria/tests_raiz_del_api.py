"""Una ruta suelta del backend no puede contestar un 500.

Con el frontend en su propio servicio, la plantilla index.html del SPA ya no
viaja en la imagen del backend y el catch-all reventaba con
TemplateDoesNotExist: api.remali.mx daba 500 en vez de decir algo útil.

Nota sobre la RAÍZ (`/`): no llega hasta aquí cuando existe
`staticfiles/index.html`, porque WhiteNoise la sirve antes que el URLconf
(`WHITENOISE_INDEX_FILE = True`). Por eso estas pruebas usan rutas profundas,
que es lo que sí atraviesa hasta el catch-all en cualquier entorno.
"""
from unittest.mock import patch

from django.http import HttpResponse
from django.template import TemplateDoesNotExist
from django.test import TestCase, override_settings


@override_settings(FRONTEND_URL='https://remali.mx')
class RaizDelApiTests(TestCase):
    def test_sin_el_spa_manda_al_sitio(self):
        with patch('server.urls.get_template', side_effect=TemplateDoesNotExist('index.html')):
            r = self.client.get('/loquesea/profundo', secure=True)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r['Location'], 'https://remali.mx')

    def test_sin_FRONTEND_URL_no_se_redirige_a_ningun_lado_raro(self):
        with override_settings(FRONTEND_URL=''):
            with patch('server.urls.get_template', side_effect=TemplateDoesNotExist('index.html')):
                r = self.client.get('/loquesea/profundo', secure=True)
        self.assertEqual(r['Location'], '/')

    def test_un_api_mal_escrito_sigue_dando_404_en_json(self):
        """Lo de /api/ NO pasa por el catch-all: un cliente de API necesita un
        404 que pueda leer, no una redirección a una página de HTML."""
        r = self.client.get('/api/esto-no-existe/', secure=True)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r['Content-Type'], 'application/json')

    def test_si_el_spa_esta_se_sigue_sirviendo(self):
        """Desarrollo y el despliegue todo-en-uno no cambian."""
        with patch('server.urls.get_template') as g, \
             patch('server.urls.TemplateView') as tv:
            tv.as_view.return_value = lambda req: HttpResponse('spa')
            r = self.client.get('/loquesea/profundo', secure=True)
        g.assert_called_once_with('index.html')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, b'spa')
