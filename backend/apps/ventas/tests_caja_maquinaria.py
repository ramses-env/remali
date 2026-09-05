"""La caja como punto de cobro del mostrador.

Cubre lo que el diseño prometió y lo que se puede romper sin que nadie lo note:
que el switch apagado de verdad bloquee (y no solo esconda el botón), que el
turno se abra solo en vez de rechazar el cobro, que el depósito en garantía
cuente en el cajón sin contarse como venta, y —lo más importante— que nada de
esto se active cuando la venta NO viene de la caja.
"""
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import ConfiguracionSitio, Equipo
from ventas.models import MovimientoCaja, SesionCaja


def _cajera(username='caja_mostrador'):
    """Quien cobra en el cajón. La caja es del PUESTO de mostrador: administración
    y el dueño ya no la traen, así que estas pruebas se hacen con quien de verdad
    la opera (ver `permissions.usar_caja`)."""
    u = User.objects.create_user(username=username, password='pass12345')
    u.groups.add(Group.objects.get_or_create(name='Cajero')[0])
    return u


def _que_tambien_rente(cajera):
    """Levantar rentas NO viene de fábrica con el mostrador: el puesto trae
    `rentar` apagado. Si el negocio enciende "la caja renta maquinaria", el dueño
    tiene que encenderle también «Rentar» al puesto desde Permisos —es la misma
    palanca que usa esta prueba—."""
    from maquinaria.models import PermisoRol
    PermisoRol.objects.get_or_create(rol='cajero', capacidad='rentar',
                                     defaults={'permitido': True})
    return cajera


class VenderMaquinariaDesdeCajaTest(TestCase):
    def setUp(self):
        self.user = _cajera()
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.equipo = Equipo.objects.create(modelo='REV-9', precio_venta=Decimal('16500.00'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva', estado='disponible')
        self.cfg = ConfiguracionSitio.get_solo()

    def _vender(self, **extra):
        cuerpo = {'nombre_cliente': 'Ramírez', 'metodo_pago': 'efectivo', 'total': '16500.00'}
        cuerpo.update(extra)
        return self.api.post(f'/api/unidades/{self.unidad.id}/vender/', cuerpo, format='json')

    def test_switch_apagado_rechaza_la_venta_desde_caja(self):
        """Apagado es apagado también en el servidor: si solo escondiera el
        botón, cualquiera podría llamar al endpoint igual."""
        self.cfg.caja_vende_maquinaria = False
        self.cfg.save()

        r = self._vender(desde_caja=True)

        self.assertEqual(r.status_code, 400, r.data)
        self.assertEqual(r.data.get('codigo'), 'caja_venta_apagada')
        self.assertFalse(MovimientoCaja.objects.exists())
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_sin_turno_abierto_se_abre_uno_con_fondo_cero(self):
        self.cfg.caja_vende_maquinaria = True
        self.cfg.save()
        self.assertFalse(SesionCaja.objects.exists())

        r = self._vender(desde_caja=True)

        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data.get('turno_abierto'))
        sesion = SesionCaja.objects.get()
        self.assertEqual(sesion.usuario, self.user)
        self.assertEqual(sesion.monto_inicial, Decimal('0'))
        # Apertura + venta: la apertura queda registrada aunque sea de $0, para
        # que el turno tenga principio auditable.
        self.assertEqual(sesion.movimientos.count(), 2)

    def test_el_efectivo_entra_al_arqueo_y_la_tarjeta_no(self):
        self.cfg.caja_vende_maquinaria = True
        self.cfg.save()

        self._vender(desde_caja=True, metodo_pago='efectivo')
        sesion = SesionCaja.objects.get()
        self.assertEqual(sesion.efectivo_esperado(), Decimal('16500.00'))

        # Otra unidad, ahora con tarjeta: cuenta para el corte pero no es billete.
        otra = Inventario.objects.create(equipo=self.equipo, condicion='nueva', estado='disponible')
        self.api.post(f'/api/unidades/{otra.id}/vender/',
                      {'nombre_cliente': 'Ramírez', 'metodo_pago': 'tarjeta',
                       'total': '16500.00', 'desde_caja': True}, format='json')

        sesion.refresh_from_db()
        self.assertEqual(sesion.efectivo_esperado(), Decimal('16500.00'))
        self.assertEqual(sesion.totales_por_metodo().get('tarjeta'), Decimal('16500.00'))

    def test_venta_normal_no_toca_la_caja(self):
        """La regresión que más importa: vender desde Inventario o en campo debe
        seguir sin crear turnos ni movimientos."""
        self.cfg.caja_vende_maquinaria = True
        self.cfg.save()

        r = self._vender()   # sin desde_caja

        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(r.data.get('turno_abierto'))
        self.assertFalse(SesionCaja.objects.exists())
        self.assertFalse(MovimientoCaja.objects.exists())

    def test_el_movimiento_queda_ligado_a_la_venta(self):
        self.cfg.caja_vende_maquinaria = True
        self.cfg.save()

        r = self._vender(desde_caja=True)

        mov = MovimientoCaja.objects.get(tipo=MovimientoCaja.VENTA)
        self.assertEqual(mov.venta_id, r.data['venta']['id'])
        self.assertIsNone(mov.renta_id)
        self.assertIn(self.unidad.codigo, mov.concepto)


class RentarDesdeCajaTest(TestCase):
    def setUp(self):
        self.user = _que_tambien_rente(_cajera('caja_renta'))
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.equipo = Equipo.objects.create(modelo='COM-2', precio_dia=Decimal('500.00'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva', estado='disponible')
        self.cfg = ConfiguracionSitio.get_solo()

    def _rentar(self, **extra):
        cuerpo = {
            'inventario_id': self.unidad.id, 'modalidad': 'dia', 'duracion': 2,
            'direccion': 'Obra Centro', 'cliente': 'Ramírez', 'metodo_pago': 'efectivo',
        }
        cuerpo.update(extra)
        return self.api.post('/api/rentas/crear/', cuerpo, format='json')

    def test_switch_apagado_rechaza_la_renta_desde_caja(self):
        self.cfg.caja_renta_maquinaria = False
        self.cfg.save()

        r = self._rentar(desde_caja=True)

        self.assertEqual(r.status_code, 400, r.data)
        self.assertEqual(r.data.get('codigo'), 'caja_renta_apagada')
        self.assertFalse(SesionCaja.objects.exists())

    def test_el_deposito_cuenta_en_el_cajon_pero_no_como_venta(self):
        """El depósito es dinero del cliente que el negocio retiene: el arqueo lo
        tiene que esperar, pero no es ingreso y no debe inflar las ventas."""
        self.cfg.caja_renta_maquinaria = True
        self.cfg.save()

        # El cobro va explícito: una renta que nadie captura ya no se da por
        # pagada sola, y aquí lo que importa es qué entra al cajón cuando SÍ pagan.
        r = self._rentar(desde_caja=True, deposito='2000.00', monto_pago='1000.00')

        self.assertEqual(r.status_code, 201, r.data)
        sesion = SesionCaja.objects.get()
        renta_cobrada = Decimal('1000.00')      # 2 días × $500
        self.assertEqual(sesion.efectivo_esperado(), renta_cobrada + Decimal('2000.00'))
        self.assertEqual(sesion.totales_por_metodo().get('efectivo'), renta_cobrada)
        self.assertEqual(
            MovimientoCaja.objects.filter(tipo=MovimientoCaja.ENTRADA, renta__isnull=False).count(), 1)

    def test_renta_normal_no_toca_la_caja(self):
        self.cfg.caja_renta_maquinaria = True
        self.cfg.save()

        r = self._rentar(deposito='2000.00')   # sin desde_caja

        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(SesionCaja.objects.exists())
        self.assertFalse(MovimientoCaja.objects.exists())


class CorteDelDiaPorOrigenTest(TestCase):
    def test_desglosa_refacciones_maquinaria_rentas_y_depositos(self):
        user = _que_tambien_rente(_cajera('caja_corte'))
        api = APIClient()
        api.force_authenticate(user=user)
        cfg = ConfiguracionSitio.get_solo()
        cfg.caja_vende_maquinaria = True
        cfg.caja_renta_maquinaria = True
        cfg.save()

        equipo = Equipo.objects.create(modelo='MIX-3', precio_venta=Decimal('9000.00'), precio_dia=Decimal('300.00'))
        vender = Inventario.objects.create(equipo=equipo, condicion='nueva', estado='disponible')
        rentar = Inventario.objects.create(equipo=equipo, condicion='seminueva', estado='disponible')

        api.post(f'/api/unidades/{vender.id}/vender/',
                 {'nombre_cliente': 'A', 'metodo_pago': 'efectivo', 'total': '9000.00', 'desde_caja': True},
                 format='json')
        api.post('/api/rentas/crear/',
                 {'inventario_id': rentar.id, 'modalidad': 'dia', 'duracion': 1, 'direccion': 'Obra',
                  'cliente': 'B', 'metodo_pago': 'efectivo', 'monto_pago': '300.00',
                  'deposito': '500.00', 'desde_caja': True},
                 format='json')

        r = api.get('/api/ventas/corte/')

        self.assertEqual(r.status_code, 200, r.data)
        origen = r.data['por_origen']
        self.assertEqual(origen['maquinaria']['total'], '9000.00')
        self.assertEqual(origen['rentas']['total'], '300.00')
        self.assertEqual(origen['depositos']['total'], '500.00')
        self.assertNotIn('refacciones', origen)   # no hubo ninguna hoy


class LaCajaEsDelMostradorTest(TestCase):
    """El cajón tiene un dueño, y no es la jerarquía.

    Ago-2026 el dueño lo pidió así: la caja es de la cajera. Administración
    registra ventas desde Ventas y Pedidos, pero no cobra en el mostrador —y
    sobre todo, no mete dinero al turno de alguien más—. Es lo que hace que el
    corte siga respondiendo "¿lo que hay en el cajón es lo que debería haber?".
    """

    def setUp(self):
        self.admin = User.objects.create_user('adm_caja', password='pass12345', is_staff=True)
        self.admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        cfg = ConfiguracionSitio.get_solo()
        cfg.caja_vende_maquinaria = True
        cfg.caja_renta_maquinaria = True
        cfg.save()
        self.equipo = Equipo.objects.create(modelo='BAN-1', precio_venta=Decimal('5000.00'),
                                            precio_dia=Decimal('300.00'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva',
                                                estado='disponible')

    def test_administracion_no_entra_al_mostrador(self):
        self.assertEqual(self.api.post('/api/ventas/mostrador/', {'items': []},
                                       format='json').status_code, 403)
        self.assertEqual(self.api.post('/api/caja/sesiones/abrir/', {'monto_inicial': '0'},
                                       format='json').status_code, 403)
        self.assertEqual(self.api.get('/api/ventas/corte/').status_code, 403)

    def test_la_bandera_desde_caja_no_es_un_atajo(self):
        """`desde_caja` viaja en el CUERPO: sin esta puerta bastaba mandarla a
        mano para colgar el cobro del arqueo del mostrador."""
        r = self.api.post(f'/api/unidades/{self.unidad.id}/vender/',
                          {'nombre_cliente': 'Ramírez', 'metodo_pago': 'efectivo',
                           'total': '5000.00', 'desde_caja': True}, format='json')
        self.assertEqual(r.status_code, 403, r.data)
        self.assertEqual(r.data.get('codigo'), 'sin_caja')
        self.assertFalse(SesionCaja.objects.exists())
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_ni_para_levantar_la_renta(self):
        r = self.api.post('/api/rentas/crear/',
                          {'inventario_id': self.unidad.id, 'modalidad': 'dia', 'duracion': 2,
                           'direccion': 'Obra Centro', 'cliente': 'Ramírez',
                           'metodo_pago': 'efectivo', 'desde_caja': True}, format='json')
        self.assertEqual(r.status_code, 403, r.data)
        self.assertEqual(r.data.get('codigo'), 'sin_caja')
        self.assertFalse(SesionCaja.objects.exists())

    def test_pero_vender_por_su_cuenta_sigue_igual(self):
        """La regresión que importa: quitarle la caja a administración no le
        quita vender. Solo deja de tocar el cajón."""
        r = self.api.post(f'/api/unidades/{self.unidad.id}/vender/',
                          {'nombre_cliente': 'Ramírez', 'metodo_pago': 'efectivo',
                           'total': '5000.00'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(MovimientoCaja.objects.exists())
        self.assertFalse(SesionCaja.objects.exists())
