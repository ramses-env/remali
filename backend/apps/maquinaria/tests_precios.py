"""Ninguna máquina se vende ni se renta en $0.

Un precio en cero no es un precio: es una máquina que sale del patio gratis sin
que nadie lo note. La venta ya lo bloqueaba (`vender_unidad`, `crear_pedido`),
pero el catálogo dejaba guardar equipos sin ningún precio y la renta caía a
$0.00 en silencio cuando el equipo no tenía tarifa capturada — se levantaba la
renta, el cliente se llevaba el equipo y el saldo nacía en cero.

Vacío NO es cero: un equipo sin precio de renta es uno que no se renta, y eso
tiene que seguir siendo válido.
"""

import datetime as _dt
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo


class PreciosDelCatalogoTest(TestCase):
    """La regla en el modelo: la puerta que usan el admin de Django y los scripts."""

    def test_un_equipo_solo_de_venta_es_valido(self):
        eq = Equipo(modelo='VIB-500', precio_venta=Decimal('12350'))
        self.assertEqual(eq.errores_de_precio(), [])

    def test_un_equipo_solo_de_renta_es_valido(self):
        """Vacío significa 'no se ofrece así', y eso no es un error."""
        eq = Equipo(modelo='MAR-20', precio_dia=Decimal('800'))
        self.assertEqual(eq.errores_de_precio(), [])

    def test_un_equipo_sin_ningun_precio_no_pasa(self):
        eq = Equipo(modelo='FANTASMA')
        errores = eq.errores_de_precio()
        self.assertEqual(len(errores), 1)
        self.assertIn('al menos un precio', errores[0])
        with self.assertRaises(ValidationError):
            eq.clean()

    def test_un_precio_en_cero_no_pasa(self):
        eq = Equipo(modelo='REV-100', precio_venta=Decimal('0'))
        errores = eq.errores_de_precio()
        self.assertEqual(len(errores), 1)
        self.assertIn('precio de venta', errores[0])
        self.assertIn('vacío', errores[0])   # dice cómo arreglarlo

    def test_un_precio_negativo_no_pasa(self):
        eq = Equipo(modelo='REV-100', precio_venta=Decimal('50000'), precio_dia=Decimal('-100'))
        errores = eq.errores_de_precio()
        self.assertEqual(len(errores), 1)
        self.assertIn('precio por día', errores[0])

    def test_el_error_nombra_cada_precio_malo(self):
        eq = Equipo(modelo='REV-100', precio_dia=Decimal('0'), precio_mes=Decimal('0'))
        errores = eq.errores_de_precio()
        self.assertEqual(len(errores), 2)
        self.assertTrue(any('día' in e for e in errores))
        self.assertTrue(any('mes' in e for e in errores))


class PreciosDesdeElPanelTest(TestCase):
    """La misma regla por la puerta del panel, que es por donde entra la gente."""

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _crear(self, **extra):
        # Las características las exige otra regla que ya existía para los
        # equipos de venta; se mandan para que lo único a prueba sea el precio.
        datos = {'modelo': 'NUEVO-1', 'especificaciones': [{'etiqueta': 'Motor', 'valor': '5 HP'}]}
        datos.update(extra)
        return self.client.post('/api/equipos/', datos, format='json')

    def test_no_se_crea_un_producto_sin_precio(self):
        resp = self._crear()
        self.assertEqual(resp.status_code, 400, resp.data)
        # El mensaje llega limpio, sin prefijo de campo, para pintarlo tal cual.
        self.assertIn('al menos un precio', str(resp.data))
        self.assertFalse(Equipo.objects.filter(modelo='NUEVO-1').exists())

    def test_no_se_crea_un_producto_en_cero(self):
        resp = self._crear(precio_venta='0')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertFalse(Equipo.objects.filter(modelo='NUEVO-1').exists())

    def test_con_un_precio_bueno_se_crea(self):
        resp = self._crear(precio_venta='12350')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_no_se_puede_editar_un_precio_a_cero(self):
        eq = Equipo.objects.create(modelo='VIB-500', precio_venta=Decimal('12350'))
        resp = self.client.patch(f'/api/equipos/{eq.id}/', {'precio_venta': '0'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        eq.refresh_from_db()
        self.assertEqual(eq.precio_venta, Decimal('12350'))

    def test_editar_solo_la_tarifa_de_renta_no_exige_repetir_la_de_venta(self):
        """Una edición parcial no puede pedir campos que no se están tocando."""
        eq = Equipo.objects.create(modelo='VIB-500', precio_venta=Decimal('12350'))
        resp = self.client.patch(f'/api/equipos/{eq.id}/', {'precio_dia': '900'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        eq.refresh_from_db()
        self.assertEqual(eq.precio_dia, Decimal('900'))
        self.assertEqual(eq.precio_venta, Decimal('12350'))

    def test_se_puede_vaciar_un_precio_si_queda_otro(self):
        """Quitar la tarifa de renta = dejar de rentarlo. Sigue siendo válido."""
        eq = Equipo.objects.create(modelo='VIB-500', precio_venta=Decimal('12350'),
                                   precio_dia=Decimal('900'))
        resp = self.client.patch(f'/api/equipos/{eq.id}/', {'precio_dia': None}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        eq.refresh_from_db()
        self.assertIsNone(eq.precio_dia)


class RentaNoNaceEnCeroTest(TestCase):
    """Una renta sin tarifa se detiene con un mensaje que dice qué hacer."""

    def setUp(self):
        self.hoy = timezone.localdate()

    def _renta(self, equipo, **extra):
        from renta.models import Renta
        unidad = Inventario.objects.create(equipo=equipo, condicion='seminueva')
        datos = dict(inventario=unidad, cliente_texto='Obra Norte', modalidad='dia',
                     duracion=3, direccion='Calle 5', fecha_inicio=self.hoy)
        datos.update(extra)
        return Renta.objects.create(**datos)

    def test_sin_tarifa_en_el_catalogo_la_renta_no_se_levanta(self):
        equipo = Equipo.objects.create(modelo='MAR-20', precio_venta=Decimal('30000'))
        with self.assertRaises(ValidationError) as caja:
            self._renta(equipo)
        mensaje = str(caja.exception)
        self.assertIn('MAR-20', mensaje)
        self.assertIn('día', mensaje)
        self.assertIn('$0', mensaje)

    def test_con_tarifa_en_el_catalogo_se_levanta_y_cobra(self):
        equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('800'))
        r = self._renta(equipo)
        self.assertEqual(r.precio_unitario, Decimal('800'))
        self.assertEqual(r.total, Decimal('2400'))   # 3 días

    def test_un_precio_a_mano_alcanza_aunque_el_catalogo_no_lo_tenga(self):
        """El mostrador puede pactar una tarifa que no está en la lista."""
        equipo = Equipo.objects.create(modelo='MAR-20', precio_venta=Decimal('30000'))
        r = self._renta(equipo, precio_unitario=Decimal('750'))
        self.assertEqual(r.total, Decimal('2250'))

    def test_registrar_un_pago_en_una_renta_vieja_no_se_traba(self):
        """La regla es al CREAR: una renta ya levantada se sigue pudiendo guardar."""
        equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('800'))
        r = self._renta(equipo)
        r.pagos = [{'fecha': self.hoy.isoformat(), 'monto': '800', 'metodo': 'efectivo'}]
        r.save(update_fields=['pagos'])
        r.refresh_from_db()
        self.assertEqual(len(r.pagos), 1)

    def test_una_renta_de_semana_dice_su_modalidad_en_el_error(self):
        equipo = Equipo.objects.create(modelo='APS-90', precio_dia=Decimal('500'))
        with self.assertRaises(ValidationError) as caja:
            self._renta(equipo, modalidad='semana',
                        fecha_inicio=self.hoy, duracion=2)
        self.assertIn('semana', str(caja.exception))


class ElCatalogoDeHoySigueSiendoValidoTest(TestCase):
    """Ningún equipo que ya existe puede quedar fuera de la ley nueva."""

    def test_los_equipos_reales_pasan_la_regla(self):
        for eq in Equipo.objects.all():
            self.assertEqual(eq.errores_de_precio(), [], f'{eq.modelo} quedaría inválido')


def _dias(n):
    return _dt.timedelta(days=n)


class RentaDesdeElPanelTest(TestCase):
    """El panel tiene que ver un mensaje que le diga qué hacer, no un 500."""

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena2', 'd2@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.hoy = timezone.localdate()

    def _levantar(self, equipo, **extra):
        unidad = Inventario.objects.create(equipo=equipo, condicion='seminueva')
        cuerpo = {
            'inventario_id': unidad.id, 'cliente': 'Obra Norte', 'telefono_cliente': '6141234567',
            'modalidad': 'dia', 'duracion': 3, 'direccion': 'Calle 5',
            'fecha_inicio': self.hoy.isoformat(),
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json')

    def test_sin_tarifa_el_panel_recibe_un_400_que_explica(self):
        equipo = Equipo.objects.create(modelo='MAR-20', precio_venta=Decimal('30000'))
        resp = self._levantar(equipo)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('MAR-20', resp.data['detalle'])
        self.assertIn('$0', resp.data['detalle'])

    def test_con_tarifa_la_renta_se_levanta(self):
        equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('800'))
        resp = self._levantar(equipo)
        self.assertIn(resp.status_code, (200, 201), resp.data)
