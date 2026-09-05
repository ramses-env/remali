"""Las dos cifras nuevas del Resumen: QUÉ produce el dinero y CUÁNTA máquina trabaja.

Las gráficas se equivocan en silencio: una barra de más alto no truena nada y
nadie la audita. Por eso cada regla de agrupación tiene aquí su prueba —qué se
cuenta, qué no, y a nombre de quién—.
"""
import datetime as _dt
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo
from maquinaria.views import SIN_MAQUINA, _ingresos_por_equipo, _ocupacion_por_dia
from renta.models import Renta
from ventas.models import Venta

HOY = timezone.localdate()


def _pago(monto, dia):
    return {'fecha': dia.isoformat(), 'monto': str(monto), 'metodo': 'efectivo', 'por': 'test'}


class TopEquiposTest(TestCase):
    """El ranking del Resumen: qué modelo trajo más dinero en el tramo."""

    def setUp(self):
        self.mixer = Equipo.objects.create(modelo='MIX-3', precio_venta=Decimal('9000'),
                                           precio_dia=Decimal('300'))
        self.rev = Equipo.objects.create(modelo='REV-9', precio_venta=Decimal('16500'),
                                         precio_dia=Decimal('500'))
        self.u_mixer = Inventario.objects.create(equipo=self.mixer, condicion='seminueva')
        self.u_rev = Inventario.objects.create(equipo=self.rev, condicion='nueva')
        self.desde = HOY - _dt.timedelta(days=29)

    def _top(self):
        return _ingresos_por_equipo(self.desde, HOY)

    def test_agrupa_por_modelo_y_separa_renta_de_venta(self):
        Venta.objects.create(nombre_cliente='A', inventario=self.u_rev,
                             pagos=[_pago('16500', HOY)])
        Renta.objects.create(inventario=self.u_mixer, cliente_texto='B', modalidad='dia',
                             duracion=2, direccion='Obra', fecha_inicio=HOY,
                             fecha_fin=HOY + _dt.timedelta(days=1),
                             pagos=[_pago('600', HOY)])
        top = self._top()

        self.assertEqual([f['modelo'] for f in top], ['REV-9', 'MIX-3'])
        self.assertEqual(top[0]['ventas'], 16500.0)
        self.assertEqual(top[0]['rentas'], 0.0)
        self.assertEqual(top[1]['rentas'], 600.0)
        self.assertEqual(top[1]['total'], 600.0)

    def test_un_modelo_suma_todas_sus_unidades(self):
        """El ranking es de MODELOS, no de unidades: dos revolvedoras iguales
        son el mismo renglón, o el dato no contesta qué conviene comprar."""
        otra = Inventario.objects.create(equipo=self.rev, condicion='nueva')
        Venta.objects.create(nombre_cliente='A', inventario=self.u_rev, pagos=[_pago('10000', HOY)])
        Venta.objects.create(nombre_cliente='B', inventario=otra, pagos=[_pago('6500', HOY)])

        top = self._top()
        self.assertEqual(len(top), 1)
        self.assertEqual(top[0]['total'], 16500.0)

    def test_la_venta_de_mostrador_tiene_su_renglon(self):
        """Una venta de refacciones no trae unidad ni equipo. Sin este renglón
        ese dinero desaparecía del ranking y no cuadraba con el total."""
        Venta.objects.create(nombre_cliente='A', pagos=[_pago('750', HOY)])
        self.assertEqual(self._top(), [
            {'modelo': SIN_MAQUINA, 'ventas': 750.0, 'rentas': 0.0, 'total': 750.0}])

    def test_el_apartado_cuenta_a_nombre_del_equipo_pedido(self):
        """Sobre pedido todavía no hay unidad, pero sí se sabe qué se pidió."""
        Venta.objects.create(nombre_cliente='A', equipo=self.mixer, sobre_pedido=True,
                             estado='apartada', pagos=[_pago('5000', HOY)])
        self.assertEqual([f['modelo'] for f in self._top()], ['MIX-3'])

    def test_lo_cancelado_y_lo_de_fuera_del_tramo_no_cuentan(self):
        Venta.objects.create(nombre_cliente='A', inventario=self.u_rev, estado='cancelada',
                             pagos=[_pago('16500', HOY)])
        Venta.objects.create(nombre_cliente='B', inventario=self.u_mixer,
                             pagos=[_pago('9000', self.desde - _dt.timedelta(days=1))])
        self.assertEqual(self._top(), [])

    def test_solo_los_seis_primeros(self):
        for i in range(8):
            eq = Equipo.objects.create(modelo=f'EQ-{i}', precio_venta=Decimal('1000'))
            u = Inventario.objects.create(equipo=eq, condicion='nueva')
            Venta.objects.create(nombre_cliente='x', inventario=u, pagos=[_pago(str(100 + i), HOY)])
        top = self._top()
        self.assertEqual(len(top), 6)
        self.assertEqual(top[0]['modelo'], 'EQ-7')   # el de más dinero primero


class OcupacionPorDiaTest(TestCase):
    """Cuánta máquina estuvo trabajando cada día."""

    def setUp(self):
        self.equipo = Equipo.objects.create(modelo='COM-2', precio_dia=Decimal('500'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.desde = HOY - _dt.timedelta(days=6)

    def _serie(self):
        return {f['fecha']: f for f in _ocupacion_por_dia(self.desde, HOY)}

    def test_una_renta_ocupa_todos_sus_dias_no_solo_el_de_alta(self):
        """La prueba que sostiene la gráfica: contar altas diría 'un día
        ocupada' de una renta de tres semanas."""
        inicio = HOY - _dt.timedelta(days=3)
        Renta.objects.create(inventario=self.unidad, cliente_texto='A', modalidad='dia',
                             duracion=4, direccion='Obra', fecha_inicio=inicio,
                             fecha_fin=HOY)
        serie = self._serie()
        for i in range(4):
            dia = (inicio + _dt.timedelta(days=i)).isoformat()
            self.assertEqual(serie[dia]['rentadas'], 1, dia)
        self.assertEqual(serie[(inicio - _dt.timedelta(days=1)).isoformat()]['rentadas'], 0)

    def test_la_devolucion_real_manda_sobre_la_pactada(self):
        """Si volvió antes, la máquina dejó de estar ocupada antes."""
        inicio = HOY - _dt.timedelta(days=5)
        Renta.objects.create(inventario=self.unidad, cliente_texto='A', modalidad='dia',
                             duracion=6, direccion='Obra', fecha_inicio=inicio, fecha_fin=HOY,
                             fecha_devolucion_real=inicio + _dt.timedelta(days=1),
                             estado='finalizada')
        serie = self._serie()
        self.assertEqual(serie[(inicio + _dt.timedelta(days=1)).isoformat()]['rentadas'], 1)
        self.assertEqual(serie[(inicio + _dt.timedelta(days=2)).isoformat()]['rentadas'], 0)

    def test_una_vencida_sin_recoger_sigue_ocupando(self):
        """La fecha pactada ya pasó y nadie la recogió: la máquina está en la
        obra del cliente, no en la bodega. Cerrar en la fecha pactada la
        liberaría sola en la gráfica y prometería flota que no existe."""
        inicio = HOY - _dt.timedelta(days=5)
        Renta.objects.create(inventario=self.unidad, cliente_texto='A', modalidad='dia',
                             duracion=2, direccion='Obra', fecha_inicio=inicio,
                             fecha_fin=inicio + _dt.timedelta(days=1), estado='activa')
        self.assertEqual(self._serie()[HOY.isoformat()]['rentadas'], 1)

    def test_pero_una_finalizada_sin_fecha_de_vuelta_no_se_estira(self):
        """Ya se cerró: aunque le falte el sello de devolución, la máquina
        volvió. Se respeta la fecha pactada y no se inventa ocupación."""
        inicio = HOY - _dt.timedelta(days=5)
        Renta.objects.create(inventario=self.unidad, cliente_texto='A', modalidad='dia',
                             duracion=2, direccion='Obra', fecha_inicio=inicio,
                             fecha_fin=inicio + _dt.timedelta(days=1), estado='finalizada')
        self.assertEqual(self._serie()[HOY.isoformat()]['rentadas'], 0)

    def test_la_cancelada_no_ocupa_nada(self):
        Renta.objects.create(inventario=self.unidad, cliente_texto='A', modalidad='dia',
                             duracion=3, direccion='Obra', fecha_inicio=self.desde,
                             fecha_fin=HOY, estado='cancelada')
        self.assertTrue(all(f['rentadas'] == 0 for f in _ocupacion_por_dia(self.desde, HOY)))

    def test_la_flota_es_la_que_habia_ese_dia(self):
        """La unidad se dio de alta hoy: no puede haber estado en la flota la
        semana pasada. Si el techo fuera la flota de HOY, un mes viejo se leería
        con menos ocupación de la que tuvo."""
        serie = self._serie()
        self.assertEqual(serie[HOY.isoformat()]['flota'], 1)
        self.assertEqual(serie[self.desde.isoformat()]['flota'], 0)


class MetricasTraenLasGraficasTest(TestCase):
    """El endpoint las entrega juntas: una sola llamada pinta el Resumen."""

    def test_el_resumen_trae_top_y_ocupacion(self):
        duena = get_user_model().objects.create_superuser('duena_g', 'g@x.com', 'pass12345')
        api = APIClient()
        api.force_authenticate(duena)

        r = api.get('/api/dashboard/metricas/')

        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn('top_equipos', r.data)
        self.assertIn('ocupacion_por_dia', r.data)
        # La ocupación cubre el MISMO tramo que la serie diaria: si no, el
        # bloque de gráficas estaría hablando de dos periodos distintos.
        self.assertEqual(len(r.data['ocupacion_por_dia']), len(r.data['ingresos_por_dia']))
