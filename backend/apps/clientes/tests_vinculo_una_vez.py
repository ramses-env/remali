"""Una cuenta se vincula UNA vez; los duplicados se resuelven fusionando.

Cambiar la cuenta de un documento se la quita del historial a una persona y se
la cuelga a otra, sin rastro y sin que ninguna se entere. La fusión hace lo
mismo pero como operación de nivel 2: arrastra todo junto y queda anotada.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from clientes.models import Cliente, Contacto
from cotizaciones.models import Cotizacion
from inventario.models import Equipo, Inventario
from renta.models import Renta


class VincularUnaSolaVez(TestCase):
    def setUp(self):
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        self.a = User.objects.create_user('cuenta_a', first_name='Josue')
        self.b = User.objects.create_user('cuenta_b', first_name='Josue dup')
        for u in (self.a, self.b):
            u.groups.add(grupo)
        eq = Equipo.objects.create(modelo='RETRO-9', precio_dia=1000)
        unidad = Inventario.objects.create(equipo=eq, codigo='RET-09', estado='disponible')
        self.renta = Renta.objects.create(
            inventario=unidad, cliente_texto='Josue', telefono_cliente='7441772370',
            direccion='Obra', modalidad='dia', duracion=1, fecha_inicio=timezone.localdate())
        admin = User.objects.create_user('op', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient()
        self.api.force_authenticate(admin)

    def test_la_primera_vinculacion_funciona(self):
        r = self.api.post(f'/api/rentas/{self.renta.id}/vincular/', {'usuario_id': self.a.id})
        self.assertEqual(r.status_code, 200, r.data)
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.usuario, self.a)

    def test_cambiar_de_cuenta_se_rechaza(self):
        self.api.post(f'/api/rentas/{self.renta.id}/vincular/', {'usuario_id': self.a.id})
        r = self.api.post(f'/api/rentas/{self.renta.id}/vincular/', {'usuario_id': self.b.id})
        self.assertEqual(r.status_code, 409)
        self.assertIn('fusiona', r.data['detalle'])
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.usuario, self.a)   # no se movió

    def test_desvincular_tampoco(self):
        """Quitar la cuenta la borra del panel del cliente sin avisarle."""
        self.api.post(f'/api/rentas/{self.renta.id}/vincular/', {'usuario_id': self.a.id})
        r = self.api.post(f'/api/rentas/{self.renta.id}/vincular/', {})
        self.assertEqual(r.status_code, 409)
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.usuario, self.a)


class FusionArrastraLasCuentas(TestCase):
    """El caso que motiva casi toda fusión: el cliente abrió dos cuentas."""

    def setUp(self):
        grupo, _ = Group.objects.get_or_create(name='Cliente')
        self.buena = User.objects.create_user('josue', first_name='Josue', last_name='Rojas')
        self.dup = User.objects.create_user('josue2', first_name='Josue', last_name='Rojas')
        for u in (self.buena, self.dup):
            u.groups.add(grupo)

        self.destino = Cliente.objects.create(nombre='Josue Rojas', telefono='7441772370')
        Contacto.objects.create(cliente=self.destino, nombre='Josue', usuario=self.buena, principal=True)
        self.origen = Cliente.objects.create(nombre='Josue R.', telefono='7441772371')
        Contacto.objects.create(cliente=self.origen, nombre='Josue', usuario=self.dup, principal=True)

        eq = Equipo.objects.create(modelo='RETRO-10', precio_dia=1000)
        unidad = Inventario.objects.create(equipo=eq, codigo='RET-10', estado='disponible')
        # Una renta colgada de la cuenta DUPLICADA: es la que el cliente no veía.
        self.renta = Renta.objects.create(
            inventario=unidad, cliente=self.origen, usuario=self.dup,
            cliente_texto='Josue', telefono_cliente='7441772371', direccion='Obra',
            modalidad='dia', duracion=1, fecha_inicio=timezone.localdate())
        self.cot = Cotizacion.objects.create(cliente=self.origen, usuario=self.dup,
                                             cliente_nombre='Josue', cliente_telefono='7441772371')

        admin = User.objects.create_user('op2', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient()
        self.api.force_authenticate(admin)

    def test_tras_fusionar_los_documentos_apuntan_a_la_cuenta_buena(self):
        r = self.api.post(f'/api/clientes/{self.destino.id}/fusionar/',
                          {'origen_id': self.origen.id, 'motivo': 'mismo cliente, dos registros'})
        self.assertEqual(r.status_code, 200, r.data)
        self.renta.refresh_from_db(); self.cot.refresh_from_db()
        # ANTES: la ficha se veía completa en el panel y el cliente entraba con
        # su cuenta buena sin ver esta renta.
        self.assertEqual(self.renta.usuario, self.buena)
        self.assertEqual(self.cot.usuario, self.buena)
        self.assertEqual(self.renta.cliente, self.destino)

    def test_la_fusion_queda_anotada_en_la_ficha(self):
        self.api.post(f'/api/clientes/{self.destino.id}/fusionar/',
                      {'origen_id': self.origen.id, 'motivo': 'duplicado'})
        self.destino.refresh_from_db(); self.origen.refresh_from_db()
        self.assertIn('fundió aquí la ficha', self.destino.notas)
        self.assertIn('duplicado', self.destino.notas)
        self.assertFalse(self.origen.activo)
