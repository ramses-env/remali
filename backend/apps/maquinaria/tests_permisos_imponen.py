"""Toda capacidad que la pantalla enciende tiene que mandar en algún endpoint.

Sin esto, agregar una capacidad al catálogo y olvidarse de imponerla produce lo
peor: un interruptor que el dueño mueve creyendo que hizo algo.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import get_resolver
from rest_framework.test import APIClient

from maquinaria.models import PermisoRol
from maquinaria.permissions import (
    CATALOGO, NUCLEO, SOLO_PANTALLA, ExigeCapacidad,
)


def _capacidades_impuestas() -> set:
    """Las capacidades que alguna ruta exige de verdad."""
    vistas = set()
    for padre in get_resolver().url_patterns:
        for ruta in getattr(padre, 'url_patterns', [padre]):
            vista = getattr(ruta, 'callback', None)
            cls = getattr(vista, 'cls', None) or getattr(vista, 'view_class', None)
            for perm in getattr(cls, 'permission_classes', []) if cls else []:
                if isinstance(perm, type) and issubclass(perm, ExigeCapacidad) and perm.capacidad:
                    vistas.add(perm.capacidad)
    return vistas


class TodaCapacidadSeImponeTest(TestCase):

    def test_ninguna_capacidad_configurable_es_decorativa(self):
        configurables = {c.nombre for c in CATALOGO} - NUCLEO - SOLO_PANTALLA
        huerfanas = sorted(configurables - _capacidades_impuestas())
        self.assertEqual(huerfanas, [], (
            'Estas capacidades se pueden encender en la pantalla y ningún endpoint '
            'las exige: o se gatean, o se declaran en SOLO_PANTALLA con su razón.'))

    def test_solo_pantalla_esta_justificada(self):
        """Que nadie use SOLO_PANTALLA como basurero: solo capacidades que
        existen para decidir qué se VE, no qué se puede hacer."""
        self.assertEqual(SOLO_PANTALLA, frozenset({'jornada_campo', 'ver_jornada'}))


class LaPantallaNoMienteTest(TestCase):
    """Encender `cotizar` para el Cajero tiene que dejarlo cotizar DE VERDAD."""

    def setUp(self):
        self.cajero = User.objects.create_user('cajero', 'c@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.cajero)

    def _crear(self):
        return self.api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'Karla Santana',
            'cliente_telefono': '7441772370',
        }, format='json')

    def test_sin_el_override_no_puede(self):
        self.assertEqual(self._crear().status_code, 403)

    def test_con_el_override_cotiza(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertEqual(self._crear().status_code, 201)

    def test_y_apagarselo_al_administrador_lo_detiene(self):
        admin = User.objects.create_user('admin', 'a@x.com', 'pass12345')
        admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        PermisoRol.objects.create(rol='Administrador', capacidad='cotizar', permitido=False)
        api = APIClient(); api.force_authenticate(admin)
        r = api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'X', 'cliente_telefono': '7441772370',
        }, format='json')
        self.assertEqual(r.status_code, 403)

    def test_los_kpis_de_la_seccion_tambien_obedecen_al_override(self):
        """`/api/cotizaciones/stats/` es la sección, no un nivel: con `cotizar`
        encendido se abre, con sus conteos y sus pestañas."""
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        r = self.api.get('/api/cotizaciones/stats/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('abiertas', r.data)

    def test_pero_el_monto_agregado_sigue_pidiendo_ver_dinero(self):
        """Se filtra el CAMPO, no la pantalla: `monto_aceptado` suma TODAS las
        aceptadas del periodo, y eso ya son las cuentas del negocio. Va omitido,
        no en cero, para que el panel no pinte un total falso."""
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertNotIn('monto_aceptado', self.api.get('/api/cotizaciones/stats/').data)
        PermisoRol.objects.create(rol='Cajero', capacidad='ver_dinero', permitido=True)
        self.assertIn('monto_aceptado', self.api.get('/api/cotizaciones/stats/').data)


class LaJornadaSeImponeTest(TestCase):
    """`operar_jornada`: entregar, recoger y subir las fotos.

    Es un trabajo distinto de LEVANTAR la renta (`rentar`, que el técnico tiene
    apagada a propósito), y hasta ahora no tenía nombre: las cuatro rutas de
    campo pedían solo nivel, así que el Cajero —que nunca sale al campo— leía el
    tablero completo con sus adeudos.
    """

    def setUp(self):
        self.cajero = User.objects.create_user('caja', 'caja@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.tecnico = User.objects.create_user('tec', 'tec@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_cajero = APIClient(); self.api_cajero.force_authenticate(self.cajero)
        self.api_tecnico = APIClient(); self.api_tecnico.force_authenticate(self.tecnico)

    def test_el_cajero_no_lee_el_tablero_de_campo(self):
        self.assertEqual(self.api_cajero.get('/api/rentas/tareas/').status_code, 403)

    def test_el_tecnico_si_lo_lee(self):
        self.assertEqual(self.api_tecnico.get('/api/rentas/tareas/').status_code, 200)

    def test_el_override_se_lo_enciende_al_cajero(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='operar_jornada', permitido=True)
        self.assertEqual(self.api_cajero.get('/api/rentas/tareas/').status_code, 200)

    def test_entregar_recoger_y_evidencias_piden_la_capacidad(self):
        """Al cajero lo para el permiso (403); al técnico lo para la renta que no
        existe (404), que es la prueba de que la capacidad sí lo dejó pasar."""
        for llamada in (
            lambda api: api.post('/api/rentas/999/entregar/', {'entregado': True}, format='json'),
            lambda api: api.post('/api/rentas/999/devolver/', {}, format='json'),
            lambda api: api.get('/api/rentas/999/evidencias/'),
            lambda api: api.post('/api/rentas/999/evidencias/', {'momento': 'entrega'}, format='json'),
        ):
            self.assertEqual(llamada(self.api_cajero).status_code, 403)
            self.assertEqual(llamada(self.api_tecnico).status_code, 404)

    def test_administracion_tambien_entrega_desde_rentas(self):
        """`jornada_campo` no servía para gatear esto: no cascadea hacia arriba y
        habría dejado al administrador sin poder entregar desde Rentas."""
        admin = User.objects.create_user('adm', 'adm@x.com', 'pass12345')
        admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        api = APIClient(); api.force_authenticate(admin)
        self.assertEqual(api.get('/api/rentas/tareas/').status_code, 200)


class LosCuponesSeImponenTest(TestCase):
    """`emitir_cupones`: un cupón es margen que se regala, y se apaga aparte."""

    def setUp(self):
        self.tecnico = User.objects.create_user('tec2', 'tec2@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.admin = User.objects.create_user('adm2', 'adm2@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)

    def test_el_tecnico_no_emite_cupones(self):
        self.assertEqual(self.api_tec.get('/api/cupones/').status_code, 403)
        self.assertEqual(self.api_tec.get('/api/cupones/999/').status_code, 403)

    def test_administracion_si(self):
        self.assertEqual(self.api_adm.get('/api/cupones/').status_code, 200)
        self.assertEqual(self.api_adm.get('/api/cupones/999/').status_code, 404)

    def test_apagarselo_a_administracion_lo_detiene(self):
        PermisoRol.objects.create(rol='Administrador', capacidad='emitir_cupones', permitido=False)
        self.assertEqual(self.api_adm.get('/api/cupones/').status_code, 403)


class LaConfiguracionDelNegocioSeImponeTest(TestCase):
    """`configurar_negocio`: los datos del negocio y los correos de aviso.

    Aquí el nivel y la capacidad decían cosas distintas y la pantalla ya le
    hacía caso a la capacidad: la pestaña "Negocio y contacto" solo aparece con
    `configurar_negocio` (nivel dueño, encendida de fábrica para el Gestor),
    mientras la API la abría a cualquier administración por nivel. El Gestor
    entraba porque la pantalla se lo dejaba ver, no porque el endpoint lo
    exigiera; y el Administrador podía cambiar el nombre del negocio por API
    aunque no tuviera la pestaña.
    """

    def setUp(self):
        self.gestor = User.objects.create_user('gest', 'g@x.com', 'pass12345')
        self.gestor.groups.add(Group.objects.get_or_create(name='Gestor')[0])
        self.admin = User.objects.create_user('admc', 'ac@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.api_gestor = APIClient(); self.api_gestor.force_authenticate(self.gestor)
        self.api_admin = APIClient(); self.api_admin.force_authenticate(self.admin)

    def test_el_gestor_configura_porque_su_puesto_lo_trae_encendido(self):
        self.assertEqual(self.api_gestor.get('/api/config/').status_code, 200)
        self.assertEqual(self.api_gestor.get('/api/config/correos/').status_code, 200)

    def test_el_administrador_no_configura_el_negocio(self):
        """La pestaña nunca fue suya; ahora la API tampoco."""
        self.assertEqual(self.api_admin.get('/api/config/').status_code, 403)

    def test_el_override_se_lo_enciende(self):
        PermisoRol.objects.create(rol='Administrador', capacidad='configurar_negocio',
                                  permitido=True)
        self.assertEqual(self.api_admin.get('/api/config/').status_code, 200)


class ElCorteDeCajaSeImponeTest(TestCase):
    """`corte_caja`: cerrar el turno y leer el arqueo.

    Era el interruptor decorativo de manual: abrir la caja y cerrarla pedían lo
    mismo (`usar_caja`), así que apagarle "Hacer corte de caja" a un cajero no le
    quitaba nada. Separarlas es lo que permite lo que el dueño quería: que
    alguien cobre en el mostrador todo el día y que el cierre lo haga otro.
    """

    def setUp(self):
        self.cajero = User.objects.create_user('caj3', 'caj3@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient(); self.api.force_authenticate(self.cajero)

    def test_el_cajero_hace_su_corte(self):
        self.assertEqual(self.api.get('/api/ventas/corte/').status_code, 200)

    def test_apagarle_el_corte_no_le_quita_el_mostrador(self):
        """La prueba de que las dos capacidades ya no son la misma: sin corte
        sigue cobrando, y eso es justo el reparto que la matriz promete."""
        PermisoRol.objects.create(rol='Cajero', capacidad='corte_caja', permitido=False)
        self.assertEqual(self.api.get('/api/ventas/corte/').status_code, 403)
        r = self.api.post('/api/ventas/mostrador/', {'items': []}, format='json')
        self.assertNotEqual(r.status_code, 403)

    def test_cerrar_el_turno_tambien_pide_el_corte(self):
        """Al cajero con corte lo para la sesión que no existe (404); sin corte
        lo para el permiso antes de tocar la base."""
        self.assertEqual(
            self.api.post('/api/caja/sesiones/999/cerrar/', {}, format='json').status_code, 404)
        PermisoRol.objects.create(rol='Cajero', capacidad='corte_caja', permitido=False)
        self.assertEqual(
            self.api.post('/api/caja/sesiones/999/cerrar/', {}, format='json').status_code, 403)


class LaFacturacionSeImponeTest(TestCase):
    """`facturar`: la bandeja de por facturar, de punta a punta.

    Las dos puertas de entrada a la bandeja no se ponían de acuerdo: mandar una
    VENTA a facturar pedía nivel de administración y mandar una RENTA pedía nivel
    de técnico, de modo que el técnico de campo llenaba la bandeja del contador
    sin tener la sección. Ahora las dos —y las siete de la bandeja— piden la
    misma capacidad.
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm3', 'adm3@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.tecnico = User.objects.create_user('tec3', 'tec3@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)

    def test_administracion_atiende_la_bandeja(self):
        self.assertEqual(self.api_adm.get('/api/facturacion/solicitudes/').status_code, 200)
        self.assertEqual(self.api_adm.get('/api/facturacion/resumen/').status_code, 200)

    def test_apagarsela_a_administracion_cierra_la_bandeja(self):
        PermisoRol.objects.create(rol='Administrador', capacidad='facturar', permitido=False)
        self.assertEqual(self.api_adm.get('/api/facturacion/solicitudes/').status_code, 403)
        self.assertEqual(self.api_adm.get('/api/facturacion/export/').status_code, 403)

    def test_el_tecnico_ya_no_manda_rentas_a_facturar(self):
        """Era la inconsistencia: la gemela de ventas siempre pidió nivel 2."""
        self.assertEqual(
            self.api_tec.post('/api/rentas/999/por-facturar/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/ventas/999/por-facturar/', {}, format='json').status_code, 403)

    def test_y_administracion_si_las_manda(self):
        """Al admin lo para el registro que no existe (404): el permiso lo dejó pasar."""
        self.assertEqual(
            self.api_adm.post('/api/rentas/999/por-facturar/', {}, format='json').status_code, 404)
        self.assertEqual(
            self.api_adm.post('/api/ventas/999/por-facturar/', {}, format='json').status_code, 404)
