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


class ElTrabajoDeTallerSeImponeTest(TestCase):
    """`reparar`: recibir la máquina y trabajar la orden desde Mi jornada.

    Es lo que el técnico hace todo el día y pedía solo nivel, así que el cajero
    —que no pisa el taller— podía abrir cualquier orden y consumirle refacciones.
    """

    def setUp(self):
        self.tecnico = User.objects.create_user('tec4', 'tec4@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.cajero = User.objects.create_user('caj4', 'caj4@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)
        self.api_caj = APIClient(); self.api_caj.force_authenticate(self.cajero)

    def test_el_cajero_no_trabaja_ordenes(self):
        self.assertEqual(self.api_caj.get('/api/reparaciones/999/').status_code, 403)
        self.assertEqual(
            self.api_caj.post('/api/reparaciones/999/items/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_caj.delete('/api/reparaciones/999/items/1/').status_code, 403)

    def test_el_tecnico_si(self):
        """Al técnico lo para la orden que no existe (404): pasó el permiso."""
        self.assertEqual(self.api_tec.get('/api/reparaciones/999/').status_code, 404)
        self.assertEqual(
            self.api_tec.post('/api/reparaciones/999/items/', {}, format='json').status_code, 404)

    def test_recibir_una_maquina_en_taller_es_reparar(self):
        """El POST de la sección NO es la sección: es el técnico recibiendo una
        máquina. Al cajero lo para el permiso; al técnico, la orden incompleta."""
        self.assertEqual(self.api_caj.post('/api/reparaciones/', {}, format='json').status_code, 403)
        self.assertNotEqual(
            self.api_tec.post('/api/reparaciones/', {}, format='json').status_code, 403)

    def test_apagarsela_al_tecnico_lo_saca_del_taller(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='reparar', permitido=False)
        self.assertEqual(self.api_tec.get('/api/reparaciones/999/').status_code, 403)
        self.assertEqual(self.api_tec.post('/api/reparaciones/', {}, format='json').status_code, 403)


class LaSeccionDeTallerSeImponeTest(TestCase):
    """`gestionar_reparaciones`: llevar el taller, que no es repararlo.

    La sección trae el historial completo, las cuatro etapas y los costos, y
    abrírsela al técnico era duplicarle su propio día en otra pantalla: lo suyo
    ya le llega por Mi jornada. Borrar la orden va aquí por lo mismo: reintegra
    el stock consumido y borra el rastro del trabajo.
    """

    def setUp(self):
        self.tecnico = User.objects.create_user('tec5', 'tec5@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.admin = User.objects.create_user('adm5', 'adm5@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)

    def test_el_tecnico_repara_pero_no_lleva_el_taller(self):
        self.assertEqual(self.api_tec.get('/api/reparaciones/999/').status_code, 404)
        self.assertEqual(self.api_tec.get('/api/reparaciones/').status_code, 403)
        self.assertEqual(self.api_tec.delete('/api/reparaciones/999/').status_code, 403)

    def test_administracion_si_lo_lleva(self):
        self.assertEqual(self.api_adm.get('/api/reparaciones/').status_code, 200)
        self.assertEqual(self.api_adm.delete('/api/reparaciones/999/').status_code, 404)

    def test_el_override_se_la_enciende_al_tecnico(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='gestionar_reparaciones',
                                  permitido=True)
        self.assertEqual(self.api_tec.get('/api/reparaciones/').status_code, 200)


class ElAltaDeInventarioSeImponeTest(TestCase):
    """`alta_inventario`: meter máquinas y refacciones nuevas al inventario.

    Es la capacidad que aumenta el patrimonio de la casa, y pedía nivel: el
    técnico no la tenía porque su nivel no alcanza, no porque alguien lo haya
    decidido. Ahora es una casilla, y el dueño puede dársela al encargado de
    almacén sin subirlo a administración.
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm6', 'adm6@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.tecnico = User.objects.create_user('tec6', 'tec6@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)

    def test_el_tecnico_no_da_de_alta(self):
        self.assertEqual(
            self.api_tec.post('/api/equipos/999/unidades/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.get('/api/equipos/999/unidades/proximo-codigo/').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/refacciones/', {}, format='json').status_code, 403)

    def test_pero_si_consulta_el_inventario(self):
        """Apagar el alta no puede dejarlo sin ver lo que hay: lo consulta todos
        los días para saber qué máquina agarra."""
        self.assertNotEqual(self.api_tec.get('/api/refacciones/').status_code, 403)

    def test_administracion_si_da_de_alta(self):
        self.assertNotEqual(
            self.api_adm.post('/api/refacciones/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_adm.get('/api/equipos/999/unidades/proximo-codigo/').status_code, 404)

    def test_el_override_se_la_enciende_al_tecnico(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='alta_inventario', permitido=True)
        self.assertNotEqual(
            self.api_tec.post('/api/refacciones/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.get('/api/equipos/999/unidades/proximo-codigo/').status_code, 404)


class ElMovimientoDeUnidadesSeImponeTest(TestCase):
    """`operar_inventario`: mover de estado y ubicación lo que ya existe.

    El técnico manda una máquina a taller y la regresa a disponible; el cajero
    —que trae el mismo nivel— no pisa el patio, y su ajuste de puesto ya la
    traía apagada. Pedía nivel, así que ese apagado no llegaba a la API.
    """

    def setUp(self):
        self.tecnico = User.objects.create_user('tec7', 'tec7@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.cajero = User.objects.create_user('caj7', 'caj7@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)
        self.api_caj = APIClient(); self.api_caj.force_authenticate(self.cajero)

    def test_el_tecnico_mueve_unidades(self):
        """Lo para la unidad que no existe (404): el permiso lo dejó pasar."""
        self.assertEqual(
            self.api_tec.patch('/api/unidades/999/', {'estado': 'disponible'},
                               format='json').status_code, 404)
        self.assertEqual(
            self.api_tec.post('/api/unidades/999/mantenimiento/', {}, format='json').status_code, 404)

    def test_el_cajero_no(self):
        self.assertEqual(
            self.api_caj.patch('/api/unidades/999/', {'estado': 'disponible'},
                               format='json').status_code, 403)
        self.assertEqual(
            self.api_caj.post('/api/unidades/999/mantenimiento/', {}, format='json').status_code, 403)

    def test_pero_el_cajero_sigue_consultando_la_unidad(self):
        """Cobrar en el mostrador pide poder abrir la ficha de una máquina."""
        self.assertEqual(self.api_caj.get('/api/unidades/999/').status_code, 404)


class LaEdicionDelCatalogoSeImponeTest(TestCase):
    """`editar_catalogo`: equipos, marcas y precios de lista.

    Cambia el patrimonio y los precios con los que se cotiza, así que vive en
    administración; pero es la casilla que el dueño quiere poder apagarle a un
    administrador de confianza mediana sin quitarle el resto del negocio.
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm8', 'adm8@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.tecnico = User.objects.create_user('tec8', 'tec8@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)

    def test_el_tecnico_no_toca_el_catalogo(self):
        self.assertEqual(
            self.api_tec.post('/api/equipos/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/marcas/', {'nombre': 'Honda'}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.patch('/api/refacciones/999/', {'precio_venta': '1'},
                               format='json').status_code, 403)

    def test_administracion_si(self):
        self.assertNotEqual(
            self.api_adm.post('/api/equipos/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_adm.post('/api/marcas/', {'nombre': 'Honda'}, format='json').status_code, 201)

    def test_apagarsela_al_administrador_le_congela_los_precios(self):
        """La razón de existir de la casilla: sigue vendiendo y rentando, pero
        ya no cambia el precio de lista."""
        PermisoRol.objects.create(rol='Administrador', capacidad='editar_catalogo',
                                  permitido=False)
        self.assertEqual(
            self.api_adm.patch('/api/equipos/999/', {'precio_dia': '1'},
                               format='json').status_code, 403)
        self.assertEqual(
            self.api_adm.post('/api/marcas/', {'nombre': 'Honda'}, format='json').status_code, 403)

    def test_la_tienda_publica_sigue_leyendo_el_catalogo(self):
        """El candado es de escritura: nadie deja sin catálogo a la tienda."""
        publico = APIClient()
        self.assertEqual(publico.get('/api/equipos/').status_code, 200)
        self.assertEqual(publico.get('/api/marcas/').status_code, 200)


class LaVentaSeImponeTest(TestCase):
    """`vender`: registrar la venta de una máquina, de punta a punta.

    Venía apagada de fábrica para el técnico —la venta se levanta en el
    mostrador o en administración— y ese apagado se quedaba en la pantalla:
    las rutas pedían NIVEL, así que desde el celular podía vender igual.
    """

    def setUp(self):
        self.cajero = User.objects.create_user('caj9', 'caj9@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.tecnico = User.objects.create_user('tec9', 'tec9@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_caj = APIClient(); self.api_caj.force_authenticate(self.cajero)
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)

    def test_el_tecnico_no_vende(self):
        self.assertEqual(
            self.api_tec.post('/api/unidades/999/vender/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/ventas/pedidos/crear/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/ventas/999/entregar/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/cotizaciones/999/convertir/', {}, format='json').status_code, 403)

    def test_el_mostrador_si(self):
        self.assertEqual(
            self.api_caj.post('/api/unidades/999/vender/', {}, format='json').status_code, 404)
        self.assertNotEqual(
            self.api_caj.post('/api/ventas/pedidos/crear/', {}, format='json').status_code, 403)

    def test_el_override_se_la_enciende_al_tecnico(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='vender', permitido=True)
        self.assertEqual(
            self.api_tec.post('/api/unidades/999/vender/', {}, format='json').status_code, 404)

    def test_apagarsela_al_mostrador_no_le_quita_la_caja(self):
        """Vender una MÁQUINA y cobrar refacciones en el mostrador son cosas
        distintas: la segunda es `usar_caja`."""
        PermisoRol.objects.create(rol='Cajero', capacidad='vender', permitido=False)
        self.assertEqual(
            self.api_caj.post('/api/unidades/999/vender/', {}, format='json').status_code, 403)
        self.assertNotEqual(
            self.api_caj.post('/api/ventas/mostrador/', {'items': []}, format='json').status_code, 403)


class LaRentaSeImponeTest(TestCase):
    """`rentar`: LEVANTAR la renta, que no es operarla.

    El cajero no renta (su ajuste de puesto la trae apagada) y el técnico
    tampoco: él entrega y recoge lo que otro levantó, y eso ya tiene su propia
    capacidad (`operar_jornada`). Las dos venían apagadas en la pantalla y
    encendidas en la API.
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm10', 'adm10@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.cajero = User.objects.create_user('caj10', 'caj10@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_caj = APIClient(); self.api_caj.force_authenticate(self.cajero)

    def test_el_cajero_no_levanta_rentas(self):
        self.assertEqual(
            self.api_caj.post('/api/rentas/crear/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_caj.post('/api/rentas/999/renovar/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_caj.post('/api/rentas/999/sustituir-unidad/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_caj.post('/api/rentas/999/deposito/', {}, format='json').status_code, 403)

    def test_administracion_si(self):
        self.assertNotEqual(
            self.api_adm.post('/api/rentas/crear/', {}, format='json').status_code, 403)
        self.assertNotEqual(
            self.api_adm.post('/api/rentas/999/renovar/', {}, format='json').status_code, 403)

    def test_el_override_se_la_enciende_al_cajero(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='rentar', permitido=True)
        self.assertNotEqual(
            self.api_caj.post('/api/rentas/crear/', {}, format='json').status_code, 403)


class LaOperacionComercialSeImponeTest(TestCase):
    """`ver_operacion`: las listas de ventas, rentas, adeudos y pedidos.

    Es la mitad que se separó de `ver_dinero` para que alguien pueda trabajar la
    operación sin ver las cuentas del negocio. La separación existía en el
    catálogo y no en las rutas: pedían nivel, así que apagarle la operación a un
    Gestor no le cerraba una sola lista.
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm11', 'adm11@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.tecnico = User.objects.create_user('tec11', 'tec11@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)

    LISTAS = ('/api/rentas/', '/api/rentas/adeudos/', '/api/rentas/alertas/',
              '/api/ventas/lista/', '/api/ventas/pedidos/')

    def test_administracion_ve_la_operacion(self):
        for ruta in self.LISTAS:
            self.assertEqual(self.api_adm.get(ruta).status_code, 200, ruta)

    def test_el_tecnico_no_lee_el_negocio_completo(self):
        """Lo suyo le llega por Mi jornada, que sigue abierta."""
        for ruta in self.LISTAS:
            self.assertEqual(self.api_tec.get(ruta).status_code, 403, ruta)
        self.assertEqual(self.api_tec.get('/api/rentas/tareas/').status_code, 200)

    def test_apagarsela_a_administracion_cierra_las_listas(self):
        PermisoRol.objects.create(rol='Administrador', capacidad='ver_operacion',
                                  permitido=False)
        for ruta in self.LISTAS:
            self.assertEqual(self.api_adm.get(ruta).status_code, 403, ruta)


class LosMontosDeLoQueSeAtiendeSeImponenTest(TestCase):
    """`ver_montos_operacion`: cobrar y comprobar lo que uno mismo atiende.

    El técnico cobra en campo y el cajero en el mostrador: abonos, comprobantes
    y tickets. Es la capacidad que el dueño apaga cuando quiere que alguien
    entregue sin manejar dinero, y hasta ahora esa casilla no hacía nada.
    """

    def setUp(self):
        self.tecnico = User.objects.create_user('tec12', 'tec12@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api = APIClient(); self.api.force_authenticate(self.tecnico)

    RUTAS = ('/api/rentas/999/comprobante/', '/api/rentas/999/ticket/',
             '/api/ventas/999/comprobante/', '/api/ventas/999/ticket/')

    def test_el_tecnico_cobra_lo_que_atiende(self):
        for ruta in self.RUTAS:
            self.assertEqual(self.api.get(ruta).status_code, 404, ruta)
        self.assertEqual(
            self.api.post('/api/rentas/999/abonos/', {}, format='json').status_code, 404)
        self.assertEqual(
            self.api.post('/api/ventas/999/abono/', {}, format='json').status_code, 404)

    def test_apagarsela_lo_deja_entregar_sin_manejar_dinero(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='ver_montos_operacion',
                                  permitido=False)
        for ruta in self.RUTAS:
            self.assertEqual(self.api.get(ruta).status_code, 403, ruta)
        self.assertEqual(
            self.api.post('/api/rentas/999/abonos/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api.post('/api/ventas/999/abono/', {}, format='json').status_code, 403)


class BorrarDelCatalogoChicoSeImponeTest(TestCase):
    """El hueco §5.1 de la nota: categorías, tipos y marcas se borraban sin candado.

    `borrar_catalogo` es del dueño y vive en `ProtectedDestroyMixin`, que solo
    envolvía equipos, unidades y refacciones. Los tres catálogos chicos heredaban
    de la vista pelona, así que cualquier administración borraba una marca entera
    —y con ella la referencia de todo lo que la usaba— sin pasar por ahí.
    """

    def setUp(self):
        from maquinaria.models import Categoria, Marca, Tipo
        self.admin = User.objects.create_user('adm13', 'adm13@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.dueno = User.objects.create_superuser('due13', 'due13@x.com', 'pass12345')
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_due = APIClient(); self.api_due.force_authenticate(self.dueno)
        self.marca = Marca.objects.create(nombre='Makita')
        self.categoria = Categoria.objects.create(nombre='Cortadoras')
        self.tipo = Tipo.objects.create(nombre='Disco')

    def test_administracion_no_borra_un_catalogo(self):
        for ruta in (f'/api/marcas/{self.marca.id}/',
                     f'/api/categorias/{self.categoria.id}/',
                     f'/api/tipos/{self.tipo.id}/'):
            r = self.api_adm.delete(ruta)
            self.assertEqual(r.status_code, 403, ruta)
            self.assertEqual(r.data.get('codigo'), 'sin_permiso_borrar')

    def test_pero_si_los_edita(self):
        self.assertEqual(
            self.api_adm.patch(f'/api/marcas/{self.marca.id}/', {'nombre': 'Makita MX'},
                               format='json').status_code, 200)

    def test_el_dueno_si_borra(self):
        self.assertEqual(self.api_due.delete(f'/api/marcas/{self.marca.id}/').status_code, 204)


class LasDosDudasDelInventarioTest(TestCase):
    """Los dos `POR DECIDIR` que quedaban de la nota, ya resueltos por el dueño.

    Uno era una incoherencia entre gemelas: fundir dos clientes desde adeudos
    pedía nivel de técnico y desde el padrón, de administración. El otro era una
    puerta de atrás: aprobar la cancelación de una cotización CIERRA la
    cotización igual que aceptarla o rechazarla, que ya exigen `ver_dinero`.
    """

    def setUp(self):
        self.tecnico = User.objects.create_user('tec14', 'tec14@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.admin = User.objects.create_user('adm14', 'adm14@x.com', 'pass12345')
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.gestor = User.objects.create_user('ges14', 'ges14@x.com', 'pass12345')
        self.gestor.groups.add(Group.objects.get_or_create(name='Gestor')[0])
        self.api_tec = APIClient(); self.api_tec.force_authenticate(self.tecnico)
        self.api_adm = APIClient(); self.api_adm.force_authenticate(self.admin)
        self.api_ges = APIClient(); self.api_ges.force_authenticate(self.gestor)

    def test_fundir_clientes_es_de_administracion_por_los_dos_lados(self):
        self.assertEqual(
            self.api_tec.post('/api/rentas/adeudos/fusionar/', {}, format='json').status_code, 403)
        self.assertEqual(
            self.api_tec.post('/api/clientes/999/fusionar/', {}, format='json').status_code, 403)
        self.assertNotEqual(
            self.api_adm.post('/api/rentas/adeudos/fusionar/', {}, format='json').status_code, 403)

    def test_aprobar_la_cancelacion_pide_ver_dinero(self):
        """El Gestor opera el negocio sin ver sus cuentas, y por eso tampoco
        cierra cotizaciones: es la misma regla del PATCH de estado."""
        self.assertEqual(
            self.api_ges.post('/api/cotizaciones/999/aprobar-cancelacion/', {},
                              format='json').status_code, 403)
        self.assertEqual(
            self.api_adm.post('/api/cotizaciones/999/aprobar-cancelacion/', {},
                              format='json').status_code, 404)
