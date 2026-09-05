"""Los caminos del cliente no son para el equipo.

Decisión del dueño (sep 2026): una cuenta del negocio entra al panel a hacer lo
de su puesto. Si alguien del equipo quiere pedir como cliente, se hace su cuenta
de cliente.

No es celo: es que las dos cosas se ven IGUAL en la base. Una cotización pedida
desde la tienda por el cajero cae en el mismo buzón que la de un cliente real,
dispara los mismos correos y entra en los mismos conteos, sin forma de saber
después cuáles eran clientes de verdad.

Lo que NO se toca es el panel: levantar una renta, registrar una venta o cotizar
desde Cotizaciones sigue siendo el trabajo del equipo. Aquello es el negocio
registrando; esto es alguien pidiendo.
"""
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class CaminosDelClienteTest(TestCase):

    def setUp(self):
        call_command('init_roles', verbosity=0)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.cliente = _usuario('clienta', 'Cliente')
        self.cajera = _usuario('cajera', 'Cajero')
        self.tecnico = _usuario('tecnico', 'Técnico')
        self.duena = _usuario('duena', sup=True)

    def _api(self, user=None):
        api = APIClient()
        if user:
            api.force_authenticate(user)
        return api

    def _pedir_cotizacion(self, api):
        return api.post('/api/tienda/cotizacion/', {
            'client': {'nombre': 'Quien sea', 'telefono': '6141234567',
                       'direccion': 'Calle 5', 'responsable': 'Yo'},
            'items': [{'equipo_id': self.equipo.id, 'modalidad': 'dia', 'cantidad': 1, 'dias': 2}],
        }, format='json')

    # ── quién SÍ ─────────────────────────────────────────────────────────────
    def test_el_invitado_puede_pedir_cotizacion(self):
        """La tienda es pública y de ahí salen los clientes nuevos: sin esto,
        cerrar el paso al equipo cerraría también el negocio."""
        self.assertNotIn(self._pedir_cotizacion(self._api()).status_code, (401, 403))

    def test_el_cliente_puede_pedir_cotizacion(self):
        self.assertNotIn(self._pedir_cotizacion(self._api(self.cliente)).status_code, (401, 403))

    def test_el_cliente_guarda_sus_obras(self):
        r = self._api(self.cliente).post('/api/obras-cliente/',
                                         {'nombre': 'Hotel Princess', 'direccion': 'Costera 1'},
                                         format='json')
        self.assertIn(r.status_code, (200, 201), r.data)

    # ── quién NO ─────────────────────────────────────────────────────────────
    def test_la_cajera_no_pide_cotizaciones_como_cliente(self):
        self.assertEqual(self._pedir_cotizacion(self._api(self.cajera)).status_code, 403)

    def test_el_tecnico_tampoco(self):
        self.assertEqual(self._pedir_cotizacion(self._api(self.tecnico)).status_code, 403)

    def test_ni_la_duena(self):
        """Sin excepción para arriba: si el dueño puede, la cifra de solicitudes
        vuelve a mezclar clientes con la casa."""
        self.assertEqual(self._pedir_cotizacion(self._api(self.duena)).status_code, 403)

    def test_el_equipo_no_guarda_obras_de_cliente(self):
        r = self._api(self.cajera).post('/api/obras-cliente/',
                                        {'nombre': 'Mía', 'direccion': 'X'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_el_equipo_no_arma_borradores(self):
        self.assertEqual(self._api(self.cajera).get('/api/borradores/').status_code, 403)

    def test_el_mensaje_dice_qué_hacer(self):
        """Un 403 pelón deja a la cajera pensando que algo se rompió."""
        r = self._pedir_cotizacion(self._api(self.cajera))
        texto = str(r.data)
        self.assertIn('cuenta de cliente', texto)
        self.assertIn('panel', texto)

    # ── y el panel sigue siendo suyo ─────────────────────────────────────────
    def test_el_trabajo_de_la_cajera_no_se_toca(self):
        """Lo que se cierra es pedir COMO CLIENTE, no trabajar.

        Se prueban las pantallas que la cajera usa de verdad con el cliente
        enfrente. (La lista de rentas NO está aquí a propósito: ya le daba 403
        antes de esto, porque no tiene `ver_operacion`.)
        """
        api = self._api(self.cajera)
        for ruta in ('/api/refacciones/', '/api/equipos/', '/api/caja/sesion-actual/',
                     '/api/clientes/'):
            self.assertNotEqual(api.get(ruta).status_code, 403, ruta)
