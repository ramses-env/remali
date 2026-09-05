"""Quién puede pedir direcciones a Google.

Cada consulta nueva es una llamada de PAGO. El endpoint nació público —lo
estrenaban invitados armando su cotización— y eso lo volvía un grifo que
cualquiera con la URL podía dejar corriendo. Ahora pide sesión, y el armador
solo le ofrece el buscador a quien tiene cuenta.
"""
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

RUTAS = (
    '/api/address/autocomplete/?q=Costera',
    '/api/address/search/?q=Costera',
    '/api/address/details/?place_id=abc',
)


class SoloConSesionTest(TestCase):

    def test_el_invitado_no_gasta_llamadas_de_google(self):
        anon = APIClient()
        for ruta in RUTAS:
            self.assertIn(anon.get(ruta).status_code, (401, 403), ruta)

    def test_con_sesion_si_responde(self):
        u = User.objects.create_user('clienta', 'c@x.com', 'pass12345')
        api = APIClient()
        api.force_authenticate(u)
        with patch('geo.views.get_provider') as prov:
            prov.return_value.autocomplete.return_value = [
                {'place_id': 'x', 'description': 'Costera Miguel Alemán',
                 'main_text': 'Costera', 'secondary_text': 'Acapulco'},
            ]
            r = api.get('/api/address/autocomplete/?q=Costera')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 1)

    def test_el_freno_pesa_por_CUENTA_no_por_anonimo(self):
        """El detalle que se coló al cerrar la puerta.

        Los topes usaban `AnonRateThrottle`, que solo pesa a los anónimos. Al
        exigir sesión, ese freno habría dejado de contar a TODO el mundo: el
        techo de gasto desaparecía justo al ponerle llave al endpoint.
        """
        from rest_framework.throttling import UserRateThrottle
        from geo.views import _DireccionMinThrottle, _DireccionHoraThrottle
        self.assertTrue(issubclass(_DireccionMinThrottle, UserRateThrottle))
        self.assertTrue(issubclass(_DireccionHoraThrottle, UserRateThrottle))
