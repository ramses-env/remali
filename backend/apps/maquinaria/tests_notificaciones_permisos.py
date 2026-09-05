"""Quién ve qué en la campanita.

La regla: **si no puedes abrir la pantalla, no te llega su aviso.** Un aviso que
apunta a una sección que no puedes abrir no es solo ruido, es una filtración con
forma de campanita: "Se recogió con saldo: $2,000" lleva el nombre y el teléfono
del cliente, y al técnico ni siquiera le aparece Adeudos en el menú.

Esto no se probaba, y por eso el filtro llevaba tiempo prometido en un docstring
y sin escribir: la función devolvía `Q(usuario__isnull=True)` para todo el staff,
la misma línea que la rama del admin.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import Notificacion, crear_notificacion


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class BuzonPorRolTest(TestCase):

    def setUp(self):
        from django.core.management import call_command
        call_command('init_roles', verbosity=0)
        self.duena = _usuario('duena', sup=True)
        self.tecnico = _usuario('tecnico', 'Técnico')
        self.cliente = _usuario('clienta', 'Cliente')

        # Un aviso por cada sección sensible, más uno sin sección.
        for sec in ('adeudos', 'ventas', 'cotizaciones', 'facturacion', 'clientes'):
            crear_notificacion('alerta', f'Aviso de {sec}', 'cuerpo',
                               seccion=sec, ref=f'x-{sec}')
        crear_notificacion('sistema', 'Aviso general', 'cuerpo', ref='x-general')

    def _titulos(self, user):
        api = APIClient()
        api.force_authenticate(user)
        r = api.get('/api/notificaciones/')
        self.assertEqual(r.status_code, 200, r.data)
        return {n['titulo'] for n in r.data['notificaciones']}

    def test_el_dueno_ve_todo(self):
        titulos = self._titulos(self.duena)
        self.assertIn('Aviso de adeudos', titulos)
        self.assertIn('Aviso de facturacion', titulos)
        self.assertIn('Aviso general', titulos)

    def test_el_tecnico_no_ve_cobranza_ni_facturacion(self):
        """El caso que lo destapó: le llegaba el buzón entero."""
        titulos = self._titulos(self.tecnico)
        self.assertNotIn('Aviso de adeudos', titulos)
        self.assertNotIn('Aviso de facturacion', titulos)
        self.assertNotIn('Aviso de cotizaciones', titulos)

    def test_al_tecnico_sí_le_llegan_los_avisos_generales(self):
        """Filtrar no es dejarlo sordo: lo que no apunta a una sección sensible
        es operación del día y le toca."""
        self.assertIn('Aviso general', self._titulos(self.tecnico))

    def test_lo_personal_llega_siempre_aunque_sea_de_una_seccion_vetada(self):
        """Si el aviso trae su nombre, es suyo: la sección no lo tapa."""
        crear_notificacion('alerta', 'Tu cobro de hoy', 'cuerpo',
                           seccion='adeudos', ref='personal-tec', usuario=self.tecnico)
        self.assertIn('Tu cobro de hoy', self._titulos(self.tecnico))

    def test_el_tecnico_no_ve_las_altas_de_cuentas(self):
        """El caso que reportó el dueño: "Cuenta nueva: Fulana" con su correo.

        Lo gatea `ver_clientes`, que al técnico se le apaga en
        `AJUSTES_POR_PUESTO`: su trabajo llega servido en "Mi jornada" y nunca
        necesita buscar en el padrón. El mostrador sí la conserva, y es quien
        vincula la cuenta con el cliente enfrente.
        """
        from clientes.resolucion import registrar_cuenta_nueva
        nueva = _usuario('jazmin')
        nueva.first_name, nueva.last_name = 'Jazmin', 'Mendoza'
        nueva.save()
        registrar_cuenta_nueva(nueva)

        titulos = self._titulos(self.tecnico)
        self.assertFalse([t for t in titulos if t.startswith('Cuenta nueva')], titulos)
        # Y a quien sí lo trabaja le sigue llegando.
        self.assertTrue([t for t in self._titulos(self.duena) if t.startswith('Cuenta nueva')])

    def test_el_correo_del_cliente_no_viaja_al_tecnico(self):
        """Lo que se filtraba no era el título: era el correo en el cuerpo."""
        api = APIClient()
        api.force_authenticate(self.tecnico)
        cuerpos = ' '.join(n['mensaje'] or '' for n in api.get('/api/notificaciones/').data['notificaciones'])
        self.assertNotIn('@', cuerpos)

    def test_al_mostrador_si_le_llegan_las_altas_de_cuentas(self):
        """El cajero vincula la cuenta con el cliente enfrente: el aviso es suyo.

        Va con prueba propia porque es el error fácil de este cambio: apagar el
        padrón "para los de nivel 1" se lo apagaría también a él, y el buscador
        del mostrador es justo lo que no puede romperse.
        """
        from clientes.resolucion import registrar_cuenta_nueva
        nueva = _usuario('jazmin')
        nueva.first_name = 'Jazmin'
        nueva.save()
        registrar_cuenta_nueva(nueva)
        cajera = _usuario('cajera', 'Cajero')
        self.assertTrue([t for t in self._titulos(cajera) if t.startswith('Cuenta nueva')])

    def test_el_cliente_no_ve_ningun_aviso_interno(self):
        titulos = self._titulos(self.cliente)
        self.assertNotIn('Aviso general', titulos)
        self.assertNotIn('Aviso de ventas', titulos)

    def test_el_conteo_de_no_leidas_cuadra_con_lo_que_ve(self):
        """Un globito que cuenta lo que no puedes abrir manda a buscar un aviso
        que no existe."""
        api = APIClient()
        api.force_authenticate(self.tecnico)
        r = api.get('/api/notificaciones/')
        self.assertEqual(r.data['no_leidas'], len(r.data['notificaciones']))


class LimpiarNoBorraLoAjenoTest(TestCase):
    """Un broadcast es COMPARTIDO: borrarlo se lo borra a todo el equipo."""

    def setUp(self):
        from django.core.management import call_command
        call_command('init_roles', verbosity=0)
        self.tecnico = _usuario('tecnico', 'Técnico')
        crear_notificacion('alerta', 'Cobranza', 'x', seccion='adeudos', ref='a')
        crear_notificacion('sistema', 'General', 'x', ref='b')

    def test_el_tecnico_no_puede_vaciar_lo_que_no_ve(self):
        api = APIClient()
        api.force_authenticate(self.tecnico)
        r = api.post('/api/notificaciones/limpiar/')
        self.assertIn(r.status_code, (200, 403), r.data)
        if r.status_code == 200:
            # El de cobranza sigue ahí para quien sí lo trabaja.
            self.assertTrue(Notificacion.objects.filter(ref='a').exists())
            self.assertFalse(Notificacion.objects.filter(ref='b').exists())


class PadronSoloDondeSeTrabajaTest(TestCase):
    """El módulo de Clientes: quién lo abre y quién no.

    El técnico NO. Su trabajo llega servido en "Mi jornada" (a quién le entrega
    y dónde), así que nunca busca en el padrón, y abrirle el módulo le daba
    fichas, teléfonos y estados de cuenta de todos los clientes.

    El MOSTRADOR sí, y esa es la línea fina: cajero y técnico comparten nivel,
    así que apagarlo "por nivel" habría roto el buscador del mostrador, que es
    lo que la cajera usa con el cliente esperando.
    """

    def setUp(self):
        from django.core.management import call_command
        call_command('init_roles', verbosity=0)
        self.tecnico = _usuario('tec', 'Técnico')
        self.cajera = _usuario('caj', 'Cajero')

    def _api(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api

    def test_el_tecnico_no_abre_el_padron(self):
        self.assertEqual(self._api(self.tecnico).get('/api/clientes/').status_code, 403)

    def test_el_tecnico_no_usa_el_buscador_del_mostrador(self):
        r = self._api(self.tecnico).get('/api/clientes/buscar/?telefono=6141234567')
        self.assertEqual(r.status_code, 403)

    def test_el_mostrador_conserva_el_padron(self):
        self.assertEqual(self._api(self.cajera).get('/api/clientes/').status_code, 200)

    def test_el_mostrador_conserva_su_buscador(self):
        """Lo que NO puede romperse: la cajera con el cliente enfrente."""
        r = self._api(self.cajera).get('/api/clientes/buscar/?telefono=6141234567')
        self.assertEqual(r.status_code, 200, r.data)

    def test_la_jornada_del_tecnico_sigue_completa(self):
        """Quitarle el padrón no puede quitarle su trabajo."""
        r = self._api(self.tecnico).get('/api/rentas/tareas/')
        self.assertEqual(r.status_code, 200, r.data)
