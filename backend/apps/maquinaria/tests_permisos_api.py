"""La API de permisos: quién la abre, qué devuelve y qué rechaza."""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import CambioPermisoRol, PermisoRol
from maquinaria.seguridad import definir_codigo


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class LeerPermisosTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def test_devuelve_todo_lo_que_la_matriz_necesita(self):
        r = self.api.get('/api/permisos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual({x['nombre'] for x in r.data['roles']},
                         {'Administrador', 'Gestor', 'Cajero', 'Técnico'})
        # Cada puesto viaja con su identidad interna y con si se puede borrar:
        # la pantalla las necesita para guardar permisos y para el menú.
        cajero = next(x for x in r.data['roles'] if x['nombre'] == 'Cajero')
        self.assertEqual(cajero['clave'], 'cajero')
        self.assertTrue(cajero['protegido'])
        cotizar = next(c for c in r.data['catalogo'] if c['nombre'] == 'cotizar')
        self.assertEqual(cotizar['etiqueta'], 'Cotizar')
        self.assertEqual(cotizar['area'], 'Mostrador')
        self.assertFalse(cotizar['nucleo'])
        self.assertFalse(r.data['fabrica']['cajero']['cotizar'])
        self.assertFalse(r.data['efectivo']['cajero']['cotizar'])
        self.assertEqual(r.data['overrides'], [])

    def test_el_efectivo_refleja_lo_configurado_y_la_fabrica_no(self):
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        r = self.api.get('/api/permisos/')
        self.assertTrue(r.data['efectivo']['cajero']['cotizar'])
        self.assertFalse(r.data['fabrica']['cajero']['cotizar'])
        self.assertEqual(len(r.data['overrides']), 1)

    def test_un_gestor_no_la_abre(self):
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)

    def test_un_administrador_tampoco(self):
        api = APIClient()
        api.force_authenticate(_usuario('admin', 'Administrador'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)


class GuardarPermisosTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        definir_codigo(self.duena, '135790')
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def _post(self, cambios, codigo='135790'):
        return self.api.post('/api/permisos/',
                             {'cambios': cambios, 'codigo': codigo}, format='json')

    def test_guarda_el_lote_completo(self):
        r = self._post([
            {'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True},
            {'rol': 'tecnico', 'capacidad': 'vender', 'permitido': True},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PermisoRol.objects.count(), 2)
        self.assertTrue(r.data['efectivo']['cajero']['cotizar'])

    def test_volver_al_valor_de_fabrica_borra_la_fila(self):
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        r = self._post([{'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': False}])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PermisoRol.objects.count(), 0)     # fábrica del Cajero: False

    def test_escribe_la_bitacora_con_anterior_y_nuevo(self):
        self._post([{'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True}])
        fila = CambioPermisoRol.objects.get()
        self.assertEqual((fila.rol, fila.capacidad), ('cajero', 'cotizar'))
        self.assertFalse(fila.anterior)
        self.assertTrue(fila.nuevo)
        self.assertEqual(fila.usuario, self.duena)
        self.assertEqual(fila.rol_usuario, 'Dueño')

    def test_lo_que_estaba_bajo_candado_ya_se_guarda(self):
        """Las cinco llaves del negocio se rechazaban aquí. El dueño las abrió:
        ahora entran como cualquier otra capacidad, con su código y su bitácora."""
        r = self._post([
            {'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True},
            {'rol': 'cajero', 'capacidad': 'gestionar_usuarios', 'permitido': True},
        ])
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(PermisoRol.objects.filter(
            rol='cajero', capacidad='gestionar_usuarios', permitido=True).exists())

    def test_capacidad_o_rol_inventados(self):
        self.assertEqual(self._post([{'rol': 'cajero', 'capacidad': 'volar', 'permitido': True}]).status_code, 400)
        self.assertEqual(self._post([{'rol': 'Pirata', 'capacidad': 'cotizar', 'permitido': True}]).status_code, 400)
        self.assertEqual(PermisoRol.objects.count(), 0)

    def test_codigo_invalido_no_cambia_nada(self):
        r = self._post([{'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True}], codigo='000000')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(PermisoRol.objects.count(), 0)
        self.assertEqual(CambioPermisoRol.objects.count(), 0)

    def test_sin_cambios_no_escribe_bitacora(self):
        r = self._post([])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(CambioPermisoRol.objects.count(), 0)

    def test_un_gestor_no_guarda_aunque_sepa_un_codigo_bueno(self):
        """El candado es la capacidad, no el código: sin `configurar_permisos`
        no entra ni con el NIP del dueño en la mano."""
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        r = api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True}]}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(PermisoRol.objects.count(), 0)


class BitacoraTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        definir_codigo(self.duena, '135790')
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def test_lista_los_cambios_del_mas_nuevo_al_mas_viejo(self):
        self.api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'cajero', 'capacidad': 'cotizar', 'permitido': True}]}, format='json')
        self.api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'tecnico', 'capacidad': 'vender', 'permitido': True}]}, format='json')

        r = self.api.get('/api/permisos/bitacora/')

        self.assertEqual(r.status_code, 200)
        self.assertEqual([f['capacidad'] for f in r.data['cambios']], ['vender', 'cotizar'])
        self.assertEqual(r.data['cambios'][0]['quien'], 'duena')
        self.assertEqual(r.data['cambios'][0]['etiqueta'], 'Vender')

    def test_un_gestor_no_la_lee(self):
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        self.assertEqual(api.get('/api/permisos/bitacora/').status_code, 403)
