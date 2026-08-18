"""El inventario y las operaciones (renta/venta) cuentan la misma historia.

Cada unidad es una máquina física: o está en la bodega, o está en una obra, o la
compró alguien. Si el registro dice una cosa y el patio otra, el catálogo vende
lo que no hay y el técnico va por una máquina que no está. Estas pruebas
recorren el ciclo completo de cada operación y verifican, en cada paso, que el
estado de la unidad concuerde con lo que dicen sus rentas y sus ventas.
"""

import unittest
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from maquinaria.models import Equipo
from inventario.models import Inventario
from renta.models import Renta
from ventas.models import Venta


def _equipo(**extra):
    datos = dict(
        modelo='REV-100', precio_venta=Decimal('50000'),
        precio_dia=Decimal('500'), precio_semana=Decimal('2500'), precio_mes=Decimal('9000'),
    )
    datos.update(extra)
    return Equipo.objects.create(**datos)


def _renta(unidad, **extra):
    datos = dict(
        inventario=unidad, cliente_texto='Cliente Prueba', modalidad='dia', duracion=3,
        direccion='Obra 1', precio_unitario=Decimal('500'),
    )
    datos.update(extra)
    return Renta.objects.create(**datos)


class CicloVentaTest(TestCase):
    def setUp(self):
        self.equipo = _equipo()
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')

    def test_venta_ocupa_y_cancelacion_devuelve(self):
        venta = Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')
        venta.cancelar('prueba')
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')
        self.assertEqual(self.unidad.ubicacion_actual, 'Bodega')

    def test_no_se_vende_dos_veces(self):
        Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        with self.assertRaises(ValueError):
            Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))

    def test_apartado_reserva_y_entrega_vende(self):
        venta = Venta.objects.create(
            inventario=self.unidad, precio_maquina=Decimal('50000'), estado='apartada',
            pagos=[{'monto': '30000', 'metodo': 'efectivo'}],
        )
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'apartado')
        # Apartada y sin liquidar: no se entrega.
        with self.assertRaises(ValueError):
            venta.entregar()
        venta.pagos = [{'monto': '50000', 'metodo': 'efectivo'}]
        venta.save()
        venta.entregar()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')

    def test_cancelar_apartado_libera_la_unidad(self):
        venta = Venta.objects.create(
            inventario=self.unidad, precio_maquina=Decimal('50000'), estado='apartada',
            pagos=[{'monto': '30000', 'metodo': 'efectivo'}],
        )
        venta.cancelar('el cliente se arrepintió')
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_apartada_no_se_puede_rentar_ni_vender(self):
        Venta.objects.create(
            inventario=self.unidad, precio_maquina=Decimal('50000'), estado='apartada',
            pagos=[{'monto': '30000', 'metodo': 'efectivo'}],
        )
        self.unidad.refresh_from_db()
        self.assertFalse(self.unidad.puede_venderse())
        self.assertFalse(self.unidad.puede_rentarse())


class CicloRentaTest(TestCase):
    def setUp(self):
        self.equipo = _equipo()
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')

    def test_renta_ocupa_y_devolucion_libera(self):
        r = _renta(self.unidad)
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'rentado')
        self.assertEqual(self.unidad.ubicacion_actual, 'Obra 1')
        r.finalizar()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_cancelar_renta_libera(self):
        r = _renta(self.unidad)
        r.cancelar('prueba')
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_rentada_no_se_vende(self):
        _renta(self.unidad)
        self.unidad.refresh_from_db()
        self.assertFalse(self.unidad.puede_venderse())
        with self.assertRaises(ValueError):
            Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))

    def test_reserva_no_ocupa_pero_blinda_contra_venta(self):
        manana = timezone.localdate() + timedelta(days=10)
        _renta(self.unidad, estado='reservada', fecha_inicio=manana)
        self.unidad.refresh_from_db()
        # Sigue disponible a propósito: se puede rentar hoy y recogerla antes.
        self.assertEqual(self.unidad.estado, 'disponible')
        # Pero venderla la dejaría comprometida: debe estar prohibido.
        with self.assertRaises(ValueError):
            self.unidad.marcar_vendido()

    def test_reserva_se_activa_y_ocupa(self):
        r = _renta(self.unidad, estado='reservada',
                   fecha_inicio=timezone.localdate() + timedelta(days=2))
        r.activar()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'rentado')

    def test_nueva_no_se_renta_sin_autorizacion(self):
        nueva = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.assertFalse(nueva.puede_rentarse())
        with self.assertRaises(ValueError):
            nueva.ocupar_por_renta()
        nueva.autorizar_para_renta(motivo='demanda')
        self.assertTrue(nueva.puede_rentarse())

    def test_no_hay_dos_rentas_activas_de_la_misma_unidad(self):
        _renta(self.unidad)
        with self.assertRaises(Exception):
            _renta(self.unidad)


class MantenimientoTest(TestCase):
    def setUp(self):
        self.equipo = _equipo()
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')

    def test_en_taller_no_se_renta_ni_se_vende(self):
        self.unidad.enviar_mantenimiento()
        self.assertFalse(self.unidad.puede_rentarse())
        self.assertFalse(self.unidad.puede_venderse())
        self.unidad.salir_mantenimiento()
        self.assertTrue(self.unidad.puede_rentarse())

    def test_devolver_renta_de_unidad_en_taller_no_la_saca_del_taller(self):
        """La máquina se fue al taller a media renta; al cerrar la renta debe
        seguir en el taller, no volver a bodega como si estuviera lista."""
        r = _renta(self.unidad)
        self.unidad.refresh_from_db()
        self.unidad.enviar_mantenimiento()
        r.finalizar()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'mantenimiento')


class CatalogoCoincideTest(TestCase):
    """Lo que el catálogo publica tiene que existir en el patio."""

    def setUp(self):
        self.equipo = _equipo()

    def test_venta_publica_solo_cuenta_unidades_nuevas_libres(self):
        nueva = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.equipo.refresh_from_db()
        self.assertTrue(self.equipo.venta_disponible_catalogo)
        Venta.objects.create(inventario=nueva, precio_maquina=Decimal('50000'))
        self.equipo.refresh_from_db()
        self.assertFalse(self.equipo.venta_disponible_catalogo)
        self.assertEqual(self.equipo.estado_venta_catalogo, 'sobre_pedido')

    def test_renta_agotada_cuando_la_unica_seminueva_esta_rentada(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.equipo.refresh_from_db()
        self.assertEqual(self.equipo.renta_estado, 'disponible')
        _renta(u)
        self.equipo.refresh_from_db()
        self.assertEqual(self.equipo.renta_estado, 'agotado')

    def test_unidad_en_taller_no_cuenta_como_stock(self):
        u = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        u.enviar_mantenimiento()
        self.equipo.refresh_from_db()
        self.assertEqual(self.equipo.renta_estado, 'agotado')
        self.assertFalse(self.equipo.renta_disponible_catalogo)


class CotizacionMultiUnidadTest(TestCase):
    """Una cotización de VARIAS máquinas: ¿queda cada unidad amarrada a su venta?"""

    def setUp(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient
        from cotizaciones.models import Cotizacion, CotizacionItem
        self.equipo = _equipo()
        self.u1 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u2 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        admin = get_user_model().objects.create_superuser('jefe', 'jefe@x.com', 'x')
        self.client = APIClient()
        self.client.force_authenticate(admin)
        self.cot = Cotizacion.objects.create(estado='aceptada', cliente_nombre='Constructora X')
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Revolvedora', cantidad=2,
            precio_unitario=Decimal('50000'), modalidad='venta', equipo=self.equipo,
        )
        self.cot.refresh_from_db()

    # FALLA A PROPÓSITO (defecto conocido, pendiente de decisión):
    # `Venta` guarda UNA sola unidad (`inventario` es FK, no lista), pero
    # `convertir_cotizacion` marca vendidas TODAS las elegidas. De la segunda en
    # adelante, la máquina sale del patio sin una venta que la respalde.
    @unittest.expectedFailure
    def test_cada_unidad_vendida_queda_ligada_a_una_venta(self):
        resp = self.client.post(
            f'/api/cotizaciones/{self.cot.id}/convertir/',
            {'metodo_pago': 'efectivo', 'unidad_ids': [self.u1.id, self.u2.id]}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.u1.refresh_from_db(); self.u2.refresh_from_db()
        self.assertEqual((self.u1.estado, self.u2.estado), ('vendido', 'vendido'))

        huerfanas = [u.codigo for u in (self.u1, self.u2)
                     if not Venta.objects.filter(inventario=u).exists()]
        self.assertEqual(huerfanas, [], f'unidades vendidas sin venta que las respalde: {huerfanas}')

    # FALLA A PROPÓSITO (misma causa): al cancelar solo regresa la unidad ligada;
    # las demás quedan 'vendido' para siempre, sin camino de vuelta.
    @unittest.expectedFailure
    def test_cancelar_la_venta_devuelve_TODAS_las_unidades(self):
        resp = self.client.post(
            f'/api/cotizaciones/{self.cot.id}/convertir/',
            {'metodo_pago': 'efectivo', 'unidad_ids': [self.u1.id, self.u2.id]}, format='json',
        )
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        venta.cancelar('el cliente se echó para atrás')
        self.u1.refresh_from_db(); self.u2.refresh_from_db()
        self.assertEqual(
            (self.u1.estado, self.u2.estado), ('disponible', 'disponible'),
            'una venta cancelada dejó máquinas marcadas como vendidas',
        )
