"""Los KPIs de Cotizaciones: la sección se abre, el monto se filtra.

`/api/cotizaciones/stats/` trae dos cosas en la misma respuesta: los conteos de
las pestañas (trabajo de la sección) y `monto_aceptado`, que suma TODAS las
cotizaciones aceptadas del periodo y ya son las cuentas del negocio. Pedir las
dos capacidades para entrar dejaba al Gestor —que cotiza pero no ve dinero— sin
pestañas y con el banner rojo de fallo. Se filtra el campo, no la pantalla.

Y se OMITE, no se manda en cero: un cero es un dato, y el panel lo pintaría como
"$0.00 aceptado este año", que es falso.
"""
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem


def _con_rol(nombre, grupo):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345')
    u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    api = APIClient()
    api.force_authenticate(u)
    return api


class StatsDeCotizacionesTest(TestCase):

    def setUp(self):
        cot = Cotizacion.objects.create(tipo='venta', estado='aceptada',
                                        cliente_nombre='Karla Santana')
        CotizacionItem.objects.create(cotizacion=cot, descripcion='Rotomartillo',
                                      cantidad=1, precio_unitario=Decimal('1500.00'))

    def test_el_gestor_ve_sus_pestanas(self):
        """Cotizar sí lo tiene (por nivel): la sección no se le niega."""
        r = _con_rol('gestor', 'Gestor').get('/api/cotizaciones/stats/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['aceptada'], 1)

    def test_pero_no_ve_el_monto_y_el_campo_NO_VIENE(self):
        r = _con_rol('gestor2', 'Gestor').get('/api/cotizaciones/stats/')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('monto_aceptado', r.data)

    def test_administracion_si_ve_el_monto(self):
        r = _con_rol('admin', 'Administrador').get('/api/cotizaciones/stats/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['monto_aceptado'], '1500.00')

    def test_sin_cotizar_no_hay_pantalla(self):
        """El técnico no cotiza: aquí sí es un 403, no un campo de menos."""
        r = _con_rol('tecnico', 'Técnico').get('/api/cotizaciones/stats/')
        self.assertEqual(r.status_code, 403)
