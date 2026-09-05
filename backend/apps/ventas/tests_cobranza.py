"""El ingreso sigue al dinero, no a la venta.

Un ingreso es un PAGO recibido, en la fecha en que se recibió. Antes el Resumen
contaba el total completo el día que se registraba la venta: un apartado de
$12,350 con anticipo de $10,000 ya se había dado por cobrado entero antes de que
llegaran los $2,350 que faltaban, y los meses en que solo se recibieron
anticipos salían en cero.

Y del otro lado, el dinero real no quedaba en ningún lado: los abonos no tocaban
la caja, así que un anticipo en efectivo estaba en el cajón sin que el arqueo lo
esperara.
"""

import datetime as _dt
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import MovimientoCaja, SesionCaja, Venta


def _equipo(modelo='VIB-500', **extra):
    datos = dict(modelo=modelo, precio_venta=Decimal('12350'))
    datos.update(extra)
    return Equipo.objects.create(**datos)


class FechaDelAbonoTest(TestCase):
    """La fecha que captura el operador manda, en ventas igual que en rentas.

    El panel siempre mandó la fecha; el backend de VENTA la tiraba y sellaba el
    momento del registro. Mientras el ingreso se contaba por la fecha de la
    venta eso era cosmético; ahora es la diferencia entre contar el dinero el día
    que entró o el día que alguien se acordó de capturarlo.
    """

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.venta = Venta.objects.create(
            nombre_cliente='Carol Sofía', equipo=_equipo(), sobre_pedido=True,
            estado='apartada', inventario=None, precio_maquina=Decimal('12350'),
        )

    def _abonar(self, **cuerpo):
        cuerpo.setdefault('monto', '1000')
        cuerpo.setdefault('metodo', 'efectivo')
        return self.client.post(f'/api/ventas/{self.venta.id}/abono/', cuerpo, format='json')

    def test_la_fecha_capturada_se_respeta(self):
        ayer = (timezone.localdate() - _dt.timedelta(days=3)).isoformat()
        resp = self._abonar(fecha=ayer)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.pagos[0]['fecha'], ayer)

    def test_sin_fecha_se_sella_el_momento(self):
        """Sin fecha capturada, el abono cuenta HOY en la zona del negocio.

        Se comprueba con el mismo lector que usan las métricas y no comparando
        texto: el sello es un instante en UTC, y de las 6 de la tarde en adelante
        su fecha en UTC ya es la de mañana. Comparar cadenas hacía que la prueba
        pasara en la mañana y fallara en la tarde.
        """
        from server.cobranza import fecha_de_pago
        resp = self._abonar()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.venta.refresh_from_db()
        self.assertEqual(fecha_de_pago(self.venta.pagos[0]), timezone.localdate())

    def test_una_fecha_futura_se_rechaza(self):
        """Un ingreso con fecha futura es dinero que todavía no existe."""
        manana = (timezone.localdate() + _dt.timedelta(days=1)).isoformat()
        resp = self._abonar(fecha=manana)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('futura', resp.data['detalle'])
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.pagos, [])

    def test_una_fecha_ilegible_se_rechaza(self):
        resp = self._abonar(fecha='19/08/2026')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.pagos, [])


class AbonoYCajaTest(TestCase):
    """Al corte va lo que pasa por el cajón, y solo eso.

    Regla del negocio: si el dinero se le entrega al mostrador tiene que estar en
    el corte —está físicamente en el cajón y un arqueo que no lo espera no
    cuadra—; si lo recibe directo el dueño, basta con dejar registrado que entró.
    """

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena2', 'd2@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        # El cajón es del MOSTRADOR: el turno lo abre y lo trabaja la cajera, no
        # el dueño (ver `permissions.usar_caja`). Cobrar el abono sí lo puede
        # hacer cualquiera de los dos —es `ver_montos_operacion`—, y eso es justo
        # lo que estas pruebas separan: el dinero que pasa por el cajón contra el
        # que se recibe en la oficina.
        self.cajera = get_user_model().objects.create_user('caja_abonos', password='pass12345')
        self.cajera.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.mostrador = APIClient()
        self.mostrador.force_authenticate(self.cajera)
        self.venta = Venta.objects.create(
            nombre_cliente='Poli', equipo=_equipo('APS-90'), sobre_pedido=True,
            estado='apartada', inventario=None, precio_maquina=Decimal('15000'),
        )

    def _abrir_turno(self):
        resp = self.mostrador.post('/api/caja/sesiones/abrir/', {'monto_inicial': '500'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        return SesionCaja.objects.get(usuario=self.cajera, estado=SesionCaja.ABIERTA)

    def _abonar(self, monto='3000', metodo='efectivo', cliente=None):
        return (cliente or self.client).post(f'/api/ventas/{self.venta.id}/abono/',
                                             {'monto': monto, 'metodo': metodo}, format='json')

    def test_sin_turno_abierto_el_abono_no_toca_la_caja(self):
        """El dueño cobra un anticipo en su oficina: se registra, no entra a un corte."""
        resp = self._abonar()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertNotIn('caja', resp.data)
        self.assertEqual(MovimientoCaja.objects.count(), 0)
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.pagado(), Decimal('3000'))

    def test_no_se_abre_turno_al_vuelo(self):
        """La venta de mostrador sí lo hace; un abono no puede meter al dueño a un corte."""
        self._abonar()
        self.assertFalse(SesionCaja.objects.exists())

    def test_con_turno_abierto_el_efectivo_mueve_el_arqueo(self):
        sesion = self._abrir_turno()
        resp = self._abonar(monto='3000', metodo='efectivo', cliente=self.mostrador)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data['caja']['en_corte'])
        mov = sesion.movimientos.filter(venta=self.venta).get()
        self.assertTrue(mov.afecta_efectivo)
        self.assertEqual(mov.monto, Decimal('3000'))
        # 500 de fondo + 3000 del abono
        self.assertEqual(sesion.efectivo_esperado(), Decimal('3500'))

    def test_con_turno_abierto_la_transferencia_entra_al_corte_pero_no_al_cajon(self):
        sesion = self._abrir_turno()
        resp = self._abonar(monto='3000', metodo='transferencia', cliente=self.mostrador)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data['caja']['afecta_efectivo'])
        mov = sesion.movimientos.filter(venta=self.venta).get()
        self.assertFalse(mov.afecta_efectivo)
        self.assertEqual(sesion.efectivo_esperado(), Decimal('500'))   # solo el fondo
        self.assertEqual(sesion.totales_por_metodo().get('transferencia'), Decimal('3000'))

    def test_un_abono_rechazado_no_deja_movimiento(self):
        """Si el abono no se guarda, la caja no puede haber visto ese dinero."""
        self._abrir_turno()
        resp = self.mostrador.post(f'/api/ventas/{self.venta.id}/abono/',
                                   {'monto': '99999', 'metodo': 'efectivo'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MovimientoCaja.objects.filter(venta=self.venta).count(), 0)


class IngresosDelResumenTest(TestCase):
    """Las métricas del Resumen: qué entró de verdad, y cuándo."""

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena3', 'd3@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = _equipo('REV-100')
        self.hoy = timezone.localdate()

    def _venta_con_pagos(self, pagos, estado='apartada', total='12350'):
        v = Venta.objects.create(
            nombre_cliente='Cliente', equipo=self.equipo, sobre_pedido=True,
            estado=estado, inventario=None, precio_maquina=Decimal(total),
        )
        v.pagos = pagos
        v.save(update_fields=['pagos'])
        return v

    def _metricas(self):
        r = self.client.get('/api/dashboard/metricas/')
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def test_un_apartado_reparte_su_dinero_entre_los_meses_en_que_entro(self):
        """El caso que destapó todo: nadie cobró $12,350 en un solo día."""
        hace_dos_meses = (self.hoy.replace(day=1) - _dt.timedelta(days=45))
        self._venta_con_pagos([
            {'fecha': hace_dos_meses.isoformat(), 'monto': '10000', 'metodo': 'efectivo'},
            {'fecha': self.hoy.isoformat(), 'monto': '2350', 'metodo': 'efectivo'},
        ])
        datos = self._metricas()
        self.assertEqual(datos['ingresos_hoy'], 2350.0)
        por_mes = {(m['label']): m['total'] for m in datos['ingresos_por_mes']}
        from maquinaria.views import MESES_CORTOS
        self.assertEqual(por_mes[MESES_CORTOS[self.hoy.month - 1]], 2350.0)
        self.assertEqual(por_mes[MESES_CORTOS[hace_dos_meses.month - 1]], 10000.0)

    def test_una_venta_de_contado_cuenta_igual_que_antes(self):
        """El cambio no puede mover lo que ya estaba bien."""
        unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        v = Venta.objects.create(inventario=unidad, precio_maquina=Decimal('50000'))
        v.pagos = [{'fecha': self.hoy.isoformat(), 'monto': '50000', 'metodo': 'efectivo'}]
        v.save(update_fields=['pagos'])
        self.assertEqual(self._metricas()['ingresos_hoy'], 50000.0)

    def test_la_serie_diaria_trae_30_dias_seguidos_con_los_ceros_dentro(self):
        """Un día sin un peso vale CERO, no vale nada: sin él la gráfica dibuja
        30 días como si fueran menos, y el mes se ve más corto de lo que fue."""
        from maquinaria.views import DIAS_SERIE
        hace_tres = self.hoy - _dt.timedelta(days=3)
        self._venta_con_pagos([
            {'fecha': hace_tres.isoformat(), 'monto': '4000', 'metodo': 'efectivo'},
        ])
        datos = self._metricas()
        dias = datos['ingresos_por_dia']
        self.assertEqual(len(dias), DIAS_SERIE)
        self.assertEqual(dias[-1]['fecha'], self.hoy.isoformat())
        # Sin huecos: cada fecha es la anterior más un día.
        for antes, despues in zip(dias, dias[1:]):
            self.assertEqual(
                _dt.date.fromisoformat(despues['fecha']) - _dt.date.fromisoformat(antes['fecha']),
                _dt.timedelta(days=1))
        por_fecha = {d['fecha']: d for d in dias}
        self.assertEqual(por_fecha[hace_tres.isoformat()]['ventas'], 4000.0)
        self.assertEqual(por_fecha[self.hoy.isoformat()]['total'], 0.0)

    def test_el_tramo_previo_no_se_traslapa_con_el_que_se_grafica(self):
        """Si el comparativo incluyera días de la propia gráfica, la comparación
        se estaría midiendo contra sí misma."""
        from maquinaria.views import DIAS_SERIE
        dentro = self.hoy - _dt.timedelta(days=DIAS_SERIE - 1)   # primer día graficado
        antes = dentro - _dt.timedelta(days=1)                    # último del tramo previo
        self._venta_con_pagos([{'fecha': dentro.isoformat(), 'monto': '900', 'metodo': 'efectivo'}])
        self._venta_con_pagos([{'fecha': antes.isoformat(), 'monto': '700', 'metodo': 'efectivo'}])
        datos = self._metricas()
        self.assertEqual(datos['ingresos_periodo_previo'], 700.0)
        self.assertEqual(sum(d['total'] for d in datos['ingresos_por_dia']), 900.0)

    def test_una_venta_cancelada_no_aporta(self):
        self._venta_con_pagos(
            [{'fecha': self.hoy.isoformat(), 'monto': '5000', 'metodo': 'efectivo'}],
            estado='cancelada')
        self.assertEqual(self._metricas()['ingresos_hoy'], 0.0)

    def test_los_pagos_de_renta_cuentan_junto_a_los_de_venta(self):
        from renta.models import Renta
        equipo = _equipo('MAR-30', precio_dia=Decimal('1000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='seminueva')
        r = Renta.objects.create(inventario=unidad, cliente_texto='Obra Sur',
                                 modalidad='dia', duracion=4, direccion='Obra Sur s/n',
                                 fecha_inicio=self.hoy, fecha_fin=self.hoy + _dt.timedelta(days=3))
        r.pagos = [{'fecha': self.hoy.isoformat(), 'monto': '4000', 'metodo': 'efectivo'}]
        r.save(update_fields=['pagos'])
        self._venta_con_pagos([{'fecha': self.hoy.isoformat(), 'monto': '1000', 'metodo': 'efectivo'}])
        datos = self._metricas()
        self.assertEqual(datos['ingresos_hoy'], 5000.0)
        self.assertEqual(datos['ingresos_mes']['ventas'], 1000.0)
        self.assertEqual(datos['ingresos_mes']['rentas'], 4000.0)

    def test_un_pago_con_fecha_ilegible_no_tumba_las_metricas(self):
        """Hay datos viejos sucios; una métrica no puede reventar la pantalla de inicio."""
        self._venta_con_pagos([
            {'fecha': '19/08/2026', 'monto': '9999', 'metodo': 'efectivo'},
            {'fecha': None, 'monto': '5555', 'metodo': 'efectivo'},
            {'fecha': self.hoy.isoformat(), 'monto': '700', 'metodo': 'efectivo'},
        ])
        self.assertEqual(self._metricas()['ingresos_hoy'], 700.0)

    def test_un_instante_con_zona_horaria_cae_en_el_dia_local(self):
        """Un cobro de la tarde no puede contarse al día siguiente."""
        ahora = timezone.now()
        self._venta_con_pagos([{'fecha': ahora.isoformat(), 'monto': '800', 'metodo': 'efectivo'}])
        self.assertEqual(self._metricas()['ingresos_hoy'], 800.0)

    def test_el_gestor_no_ve_las_cuentas_del_negocio(self):
        """Opera el negocio completo, pero no sabe cuánto gana."""
        gestor = get_user_model().objects.create_user('gestora', password='pass12345')
        gestor.groups.add(Group.objects.get_or_create(name='Gestor')[0])
        self.client.force_authenticate(gestor)
        self.assertEqual(self.client.get('/api/dashboard/metricas/').status_code, 403)


class AbonoDeRentaTest(TestCase):
    """La renta sella y cobra con la misma regla que la venta.

    Si cada una lo hiciera a su manera, el mismo dinero contaría en días
    distintos según de dónde viniera, y el corte del turno solo vería la mitad.
    """

    def setUp(self):
        from renta.models import Renta
        self.admin = get_user_model().objects.create_superuser('duena4', 'd4@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        # El turno es del mostrador; cobrar el abono lo puede hacer cualquiera de
        # los dos. Ver `AbonoYCajaTest`.
        self.cajera = get_user_model().objects.create_user('caja_rentas', password='pass12345')
        self.cajera.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.mostrador = APIClient()
        self.mostrador.force_authenticate(self.cajera)
        equipo = _equipo('MAR-20', precio_dia=Decimal('2000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='seminueva')
        hoy = timezone.localdate()
        # El total lo calcula la renta sola (precio × duración): 3 días × $2,000.
        self.renta = Renta.objects.create(
            inventario=unidad, cliente_texto='Obra Norte', modalidad='dia', duracion=3,
            direccion='Calle 5', fecha_inicio=hoy, fecha_fin=hoy + _dt.timedelta(days=2),
        )
        self.assertEqual(self.renta.total, Decimal('6000'))

    def _abonar(self, cliente=None, **cuerpo):
        cuerpo.setdefault('monto', '2000')
        cuerpo.setdefault('metodo', 'efectivo')
        return (cliente or self.client).post(
            f'/api/rentas/{self.renta.id}/abonos/', cuerpo, format='json')

    def test_la_fecha_capturada_se_respeta(self):
        ayer = (timezone.localdate() - _dt.timedelta(days=2)).isoformat()
        resp = self._abonar(fecha=ayer)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.pagos[0]['fecha'], ayer)

    def test_una_fecha_futura_se_rechaza(self):
        manana = (timezone.localdate() + _dt.timedelta(days=1)).isoformat()
        self.assertEqual(self._abonar(fecha=manana).status_code, 400)
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.pagos, [])

    def test_con_turno_abierto_el_abono_de_renta_entra_al_corte(self):
        self.mostrador.post('/api/caja/sesiones/abrir/', {'monto_inicial': '0'}, format='json')
        sesion = SesionCaja.objects.get(usuario=self.cajera, estado=SesionCaja.ABIERTA)
        resp = self._abonar(cliente=self.mostrador, monto='2000', metodo='efectivo')
        self.assertEqual(resp.status_code, 200, resp.data)
        mov = sesion.movimientos.filter(renta=self.renta).get()
        self.assertTrue(mov.afecta_efectivo)
        self.assertEqual(sesion.efectivo_esperado(), Decimal('2000'))

    def test_sin_turno_abierto_no_toca_la_caja(self):
        self.assertEqual(self._abonar().status_code, 200)
        self.assertEqual(MovimientoCaja.objects.count(), 0)


class SwitchDeCajaTest(TestCase):
    """El interruptor nace apagado: la caja sigue cobrando solo refacciones."""

    def test_nace_apagado_y_viaja_en_la_configuracion(self):
        from maquinaria.models import ConfiguracionSitio
        self.assertFalse(ConfiguracionSitio.get_solo().caja_cobra_abonos)
        admin = get_user_model().objects.create_superuser('duena5', 'd5@x.com', 'pass12345')
        c = APIClient()
        c.force_authenticate(admin)
        resp = c.get('/api/config/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('caja_cobra_abonos', resp.data)
        self.assertFalse(resp.data['caja_cobra_abonos'])
