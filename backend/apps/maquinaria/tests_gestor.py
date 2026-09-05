"""El Gestor: administración delegada con autorización del dueño.

Todo este rol existe por una frase del dueño: "lo importante aquí es que no
pueda hacer él sus trampas para robar dinero". Cada prueba cubre una vía de robo
concreta, y varias llaman el endpoint DIRECTO a propósito: un candado que solo
esconde el botón no es un candado.
"""
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import CambioPrecioLista, ConfiguracionSitio, Equipo
from maquinaria.permissions import NIVEL_ADMIN, es_gestor, nivel_de, puede_de, rol_de
from maquinaria.seguridad import definir_codigo, etiqueta_autorizacion, verificar_codigo


def _usuario(username, grupo=None, sup=False):
    u = User.objects.create_user(username=username, password='pass12345',
                                 is_staff=sup, is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class MatrizDelGestorTest(TestCase):
    def setUp(self):
        self.gestor = _usuario('gestor1', 'Gestor')

    def test_comparte_nivel_con_el_administrador(self):
        """No es un escalón nuevo: eso obligaría a revisar cada clase de permiso."""
        self.assertEqual(nivel_de(self.gestor), NIVEL_ADMIN)
        self.assertEqual(rol_de(self.gestor), 'Gestor')
        self.assertTrue(es_gestor(self.gestor))

    def test_lo_que_puede(self):
        caps = puede_de(self.gestor)
        for c in ('cotizar', 'editar_catalogo', 'alta_inventario', 'operar_inventario',
                  'ver_operacion', 'facturar', 'reparar',
                  'gestionar_reparaciones', 'ver_clientes', 'editar_clientes',
                  'ver_montos_operacion', 'ver_jornada', 'configurar_negocio'):
            self.assertTrue(caps.get(c), f'el Gestor debería poder «{c}»')

    def test_lo_que_no_puede_ni_con_codigo(self):
        caps = puede_de(self.gestor)
        for c in ('ver_dinero', 'gestionar_usuarios', 'borrar_catalogo',
                  'editar_datos_bancarios',
                  # La caja es del mostrador: no cascadea por nivel a nadie.
                  'usar_caja', 'corte_caja'):
            self.assertFalse(caps.get(c), f'el Gestor NO debería poder «{c}»')

    def test_opera_sin_ver_las_metricas(self):
        """La distinción que hace posible el rol: puede abrir una venta para
        cancelarla sin ver cuánto ganó el negocio este mes."""
        caps = puede_de(self.gestor)
        self.assertTrue(caps['ver_operacion'])
        self.assertFalse(caps['ver_dinero'])

    def test_el_administrador_no_se_ve_afectado(self):
        """No hay regresión: el Administrador conserva todo lo suyo."""
        caps = puede_de(_usuario('admin1', 'Administrador'))
        self.assertTrue(caps['ver_dinero'])
        self.assertTrue(caps['ver_operacion'])
        self.assertFalse(caps['borrar_catalogo'])      # borrar sigue siendo del dueño


class AutorizacionConNipDelDuenoTest(TestCase):
    """El corazón antifraude: el Gestor no se autoriza solo."""

    def setUp(self):
        self.dueno = _usuario('dueno', sup=True)
        self.gestor = _usuario('gestor2', 'Gestor')
        self.admin = _usuario('admin2', 'Administrador')

    def test_el_nip_del_dueno_autoriza_al_gestor(self):
        definir_codigo(self.dueno, '135790')

        ok, detalle, _st, _c = verificar_codigo(self.gestor, '135790')

        self.assertTrue(ok, detalle)

    def test_su_propio_nip_no_lo_autoriza(self):
        """Aunque alguien se lo ponga a mano en la base, no sirve."""
        definir_codigo(self.dueno, '135790')
        definir_codigo(self.gestor, '999999')

        ok, _d, _st, cod = verificar_codigo(self.gestor, '999999')

        self.assertFalse(ok)
        self.assertEqual(cod, 'incorrecto')

    def test_sin_nip_del_dueno_no_puede_autorizar_nada(self):
        """Fail-closed, y con un mensaje que diga qué hacer."""
        ok, detalle, status, cod = verificar_codigo(self.gestor, '135790')

        self.assertFalse(ok)
        self.assertEqual(cod, 'dueno_sin_codigo')
        self.assertEqual(status, 403)
        self.assertIn('dueño', detalle.lower())

    def test_el_administrador_sigue_usando_el_suyo(self):
        """No se aprieta al Administrador: es la decisión que se tomó."""
        definir_codigo(self.admin, '246800')

        ok, detalle, _st, _c = verificar_codigo(self.admin, '246800')

        self.assertTrue(ok, detalle)

    def test_el_rastro_dice_que_autorizo_el_dueno(self):
        self.assertEqual(etiqueta_autorizacion(self.gestor), 'gestor2 (autorizó el dueño)')
        self.assertEqual(etiqueta_autorizacion(self.admin), 'admin2')


class GestorNoDefineNipTest(TestCase):
    def test_el_endpoint_lo_rechaza(self):
        """Llamado DIRECTO: si solo se escondiera el bloque en el panel, se
        pondría un NIP por API y se quedaría con la llave."""
        gestor = _usuario('gestor3', 'Gestor')
        api = APIClient()
        api.force_authenticate(user=gestor)

        r = api.post('/api/auth/codigo-seguridad/',
                     {'password': 'pass12345', 'codigo': '111111'}, format='json')

        # El 403 lo da ahora la clase de permiso (`PuedeTenerCodigoPropio`), no
        # una revisión dentro del cuerpo: la capacidad se reparte desde la
        # pantalla, así que el candado tenía que vivir donde se pesa el permiso.
        self.assertEqual(r.status_code, 403, r.data)

    def test_el_administrador_si_puede(self):
        admin = _usuario('admin3', 'Administrador')
        api = APIClient()
        api.force_authenticate(user=admin)

        r = api.post('/api/auth/codigo-seguridad/',
                     {'password': 'pass12345', 'codigo': '111111'}, format='json')

        self.assertEqual(r.status_code, 200, r.data)

    def test_sin_la_contrasena_correcta_falla(self):
        admin = _usuario('admin4', 'Administrador')
        api = APIClient()
        api.force_authenticate(user=admin)

        r = api.post('/api/auth/codigo-seguridad/',
                     {'password': 'equivocada', 'codigo': '111111'}, format='json')

        self.assertEqual(r.status_code, 403, r.data)


class BorrarDelCatalogoTest(TestCase):
    def setUp(self):
        self.equipo = Equipo.objects.create(modelo='BORRA-1')

    def _borrar(self, user):
        api = APIClient()
        api.force_authenticate(user=user)
        return api.delete(f'/api/equipos/{self.equipo.id}/')

    def test_el_gestor_no_puede_borrar(self):
        r = self._borrar(_usuario('gestor4', 'Gestor'))

        self.assertEqual(r.status_code, 403, r.data)
        self.assertEqual(r.data.get('codigo'), 'sin_permiso_borrar')
        self.assertTrue(Equipo.objects.filter(id=self.equipo.id).exists())

    def test_el_administrador_tampoco(self):
        """Borrar es del dueño: es como se encubre una máquina que falta."""
        r = self._borrar(_usuario('admin5', 'Administrador'))
        self.assertEqual(r.status_code, 403, r.data)

    def test_el_dueno_si(self):
        r = self._borrar(_usuario('dueno2', sup=True))
        self.assertEqual(r.status_code, 204, getattr(r, 'data', r))
        self.assertFalse(Equipo.objects.filter(id=self.equipo.id).exists())


class DatosBancariosTest(TestCase):
    def setUp(self):
        cfg = ConfiguracionSitio.get_solo()
        cfg.datos_bancarios = 'CLABE original del negocio'
        cfg.save()

    def _patch(self, user, cuerpo):
        api = APIClient()
        api.force_authenticate(user=user)
        return api.patch('/api/config/', cuerpo, format='json')

    def test_el_gestor_no_puede_cambiar_la_clabe(self):
        """La vía de robo más limpia del sistema: los datos bancarios se imprimen
        en cada cotización, así que cambiarlos desvía los pagos."""
        r = self._patch(_usuario('gestor5', 'Gestor'),
                        {'datos_bancarios': 'CLABE del ladrón'})

        self.assertEqual(r.status_code, 400, r.data)
        self.assertEqual(ConfiguracionSitio.get_solo().datos_bancarios,
                         'CLABE original del negocio')

    def test_el_gestor_si_puede_cambiar_lo_demas(self):
        """El resto de la configuración sí es su trabajo."""
        r = self._patch(_usuario('gestor6', 'Gestor'),
                        {'negocio_telefono': '7443737201'})

        self.assertEqual(r.status_code, 200, r.data)

    def test_guardar_sin_tocar_la_clabe_no_estorba(self):
        """Reenviar el mismo valor (lo que hace un formulario completo) pasa."""
        r = self._patch(_usuario('gestor7', 'Gestor'),
                        {'datos_bancarios': 'CLABE original del negocio',
                         'negocio_nombre': 'REMALI'})

        self.assertEqual(r.status_code, 200, r.data)

    def test_el_dueno_si_puede(self):
        r = self._patch(_usuario('dueno3', sup=True), {'datos_bancarios': 'Nueva CLABE'})

        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(ConfiguracionSitio.get_solo().datos_bancarios, 'Nueva CLABE')


class RastroDePreciosTest(TestCase):
    def test_bajar_el_precio_de_lista_deja_huella(self):
        """No se bloquea —cambiar precios es trabajo legítimo— pero se ve."""
        equipo = Equipo.objects.create(modelo='PRE-1', precio_venta=Decimal('16500.00'))
        gestor = _usuario('gestor8', 'Gestor')
        api = APIClient()
        api.force_authenticate(user=gestor)

        r = api.patch(f'/api/equipos/{equipo.id}/', {'precio_venta': '9000.00'}, format='json')

        self.assertEqual(r.status_code, 200, r.data)
        rastro = CambioPrecioLista.objects.get(equipo=equipo, campo='precio_venta')
        self.assertEqual(rastro.anterior, Decimal('16500.00'))
        self.assertEqual(rastro.nuevo, Decimal('9000.00'))
        self.assertEqual(rastro.usuario, gestor)
        self.assertEqual(rastro.rol, 'Gestor')

    def test_guardar_sin_cambiar_precio_no_ensucia_el_rastro(self):
        equipo = Equipo.objects.create(modelo='PRE-2', precio_venta=Decimal('16500.00'))
        api = APIClient()
        api.force_authenticate(user=_usuario('gestor9', 'Gestor'))

        api.patch(f'/api/equipos/{equipo.id}/', {'modelo': 'PRE-2 renombrado'}, format='json')

        self.assertFalse(CambioPrecioLista.objects.filter(equipo=equipo).exists())
