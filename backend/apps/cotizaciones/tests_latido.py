"""El aviso de tiempo real cuando entra una cotización.

El panel no recarga solo: pregunta cada dos segundos por el sello de cada tema y
refresca lo que se movió. Si el sello de "cotizaciones" no avanza al llegar una
solicitud del cliente, el módulo se queda mostrando la lista vieja y la única
salida es recargar la página a mano — que es justo el síntoma que hubo que
corregir. Esto fija esa cadena de punta a punta.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion
from maquinaria.models import Equipo, SelloTema

User = get_user_model()


def sello(tema):
    fila = SelloTema.objects.filter(tema=tema).first()
    return fila.marca if fila else None


class LatidoCotizacionesTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.equipo = Equipo.objects.create(
            modelo='Mezcladora 1 saco', precio_dia=500, precio_venta=25000,
        )

    def test_solicitud_de_la_tienda_mueve_el_sello(self):
        antes = sello('cotizaciones')
        r = self.client.post('/api/tienda/cotizacion/', {
            'cliente': {'nombre': 'Naomi Pérez', 'telefono': '7441234567', 'email': 'naomi@correo.mx'},
            'items': [{'id': self.equipo.id, 'qty': 1, 'unit': 'dia', 'duracion': 3}],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Cotizacion.objects.count(), 1)
        despues = sello('cotizaciones')
        self.assertIsNotNone(despues, 'la solicitud no dejó sello: el panel nunca se entera')
        self.assertNotEqual(antes, despues)

    def test_el_panel_ve_el_sello_nuevo_en_el_latido(self):
        jefa = User.objects.create_superuser('jefa', 'jefa@remali.mx', 'x' * 12)
        panel = APIClient()
        panel.force_authenticate(jefa)
        primero = panel.get('/api/latido/').data.get('cotizaciones')

        self.client.post('/api/tienda/cotizacion/', {
            'cliente': {'nombre': 'Naomi Pérez', 'telefono': '7441234567', 'email': 'naomi@correo.mx'},
            'items': [{'id': self.equipo.id, 'qty': 1, 'unit': 'dia', 'duracion': 3}],
        }, format='json')

        segundo = panel.get('/api/latido/').data.get('cotizaciones')
        self.assertIsNotNone(segundo)
        self.assertNotEqual(primero, segundo,
                            'el latido no reporta el cambio: el módulo no se enteraría')
