"""La cuenta del cliente deja de ser un trámite aparte.

Dos huecos que se cerraban a mano —o no se cerraban—:
  1. Quien abría cuenta en la tienda quedaba en un limbo "sin vincular": sin
     ficha, sin historial y sin poder recibir una renta.
  2. Una renta o venta capturada en el mostrador para alguien CON cuenta se
     guardaba en su ficha pero no en su panel. El cliente entraba y no veía la
     máquina que tenía en la obra.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from clientes.models import Cliente, Contacto
from clientes.resolucion import cuenta_de, registrar_cuenta_nueva, resolver_cliente
from inventario.models import Equipo, Inventario
from maquinaria.models import PerfilUsuario
from renta.models import Renta


class CuentaNuevaNaceConFicha(TestCase):
    def _registrar(self, username, telefono=''):
        u = User.objects.create_user(username, email=f'{username}@correo.com', first_name='Josue', last_name='Rojas')
        PerfilUsuario.objects.update_or_create(usuario=u, defaults={'telefono': telefono})
        registrar_cuenta_nueva(u)
        return u

    def test_se_le_crea_su_ficha_en_el_padron(self):
        u = self._registrar('josue', '7441772370')
        contacto = Contacto.objects.get(usuario=u)
        self.assertIsNotNone(contacto.cliente, 'antes nacía sin ficha: "sin vincular"')
        self.assertEqual(contacto.cliente.nombre, 'Josue Rojas')
        self.assertTrue(contacto.principal)

    def test_la_ficha_nueva_no_pide_revision_si_nadie_choca(self):
        u = self._registrar('josue', '7441772370')
        self.assertFalse(Contacto.objects.get(usuario=u).cliente.requiere_revision)

    def test_si_el_telefono_ya_era_de_otro_la_marca_para_fusionar(self):
        """La regla de la casa: se señala, NUNCA se une sola por teléfono."""
        viejo = Cliente.objects.create(nombre='Constructora Rojas', telefono='7441772370')
        u = self._registrar('josue', '7441772370')
        ficha = Contacto.objects.get(usuario=u).cliente
        self.assertNotEqual(ficha.pk, viejo.pk, 'no se fusiona sola')
        self.assertTrue(ficha.requiere_revision)
        self.assertIn('Constructora Rojas', ficha.revision_motivo)
        self.assertIn('fusiona', ficha.revision_motivo)


class ElMostradorGuardaEnLaCuenta(TestCase):
    def setUp(self):
        self.cuenta = User.objects.create_user('josue', first_name='Josue', last_name='Rojas')
        self.ficha = Cliente.objects.create(nombre='Josue Rojas', telefono='7441772370')
        Contacto.objects.create(cliente=self.ficha, nombre='Josue', usuario=self.cuenta, principal=True)
        eq = Equipo.objects.create(modelo='RETRO-7', precio_dia=1200)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='RET-07', estado='disponible')
        admin = User.objects.create_user('op', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient(); self.api.force_authenticate(admin)

    def test_encuentra_la_cuenta_de_una_ficha(self):
        self.assertEqual(cuenta_de(self.ficha), self.cuenta)

    def test_una_ficha_sin_cuenta_no_inventa_ninguna(self):
        suelta = Cliente.objects.create(nombre='Cliente de mostrador', telefono='7449998877')
        self.assertIsNone(cuenta_de(suelta))

    def test_la_renta_manual_aparece_en_su_panel(self):
        r = self.api.post('/api/rentas/crear/', {
            'inventario_id': self.unidad.id, 'cliente_id': self.ficha.id,
            'cliente': 'Josue Rojas', 'telefono_cliente': '7441772370',
            'direccion': 'Obra centro', 'modalidad': 'dia', 'duracion': 1,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        renta = Renta.objects.get(pk=r.data['renta']['id'])
        self.assertEqual(renta.cliente, self.ficha)
        self.assertEqual(renta.usuario, self.cuenta)   # ANTES: None

    def test_no_pisa_la_cuenta_que_ya_venia_en_la_peticion(self):
        """Concretar una cotización trae su propia cuenta; manda esa."""
        otra = User.objects.create_user('otro')
        r = self.api.post('/api/rentas/crear/', {
            'inventario_id': self.unidad.id, 'cliente_id': self.ficha.id,
            'cliente': 'Josue Rojas', 'telefono_cliente': '7441772370',
            'direccion': 'Obra', 'modalidad': 'dia', 'duracion': 1,
            'usuario_id': otra.id,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Renta.objects.get(pk=r.data['renta']['id']).usuario, otra)

    def test_un_cliente_de_mostrador_sin_cuenta_sigue_funcionando(self):
        """El flujo tipo AutoZone: das nombre y teléfono, y ya."""
        cli, contacto = resolver_cliente(nombre='Señora del taller', telefono='7441110000')
        self.assertIsNotNone(cli)
        self.assertIsNone(cuenta_de(cli, contacto))
