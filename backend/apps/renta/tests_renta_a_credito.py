"""La renta que sale sin estar pagada, y se va abonando en el camino.

Así se renta de verdad aquí: la máquina se sube al camión con lo que el cliente
trae ese día —a veces el total, a veces la mitad, a veces nada— y el resto entra
durante la semana. El sistema no sabía hacer eso: al levantar la renta daba el
total por cobrado si nadie capturaba un monto, así que TODA renta nacía liquidada
y la cobranza (Adeudos en el panel, "Mis adeudos" del cliente) nunca veía una.

El relleno viejo ya no existe: se cobra lo que alguien capturó, y lo que nadie
capturó se queda debiendo. Por el otro extremo hay un piso, no un muro: para
recoger la máquina el cliente tiene que llevar abonado al menos el porcentaje
configurado del total (75% de fábrica) y el resto se va a cobranza. Por debajo
del piso hace falta el código de autorización de un administrador.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo, Notificacion
from renta.models import Renta


class RentaACreditoTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.cliente = get_user_model().objects.create_user('clienta', 'c@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()

    def _crear(self, **extra):
        cuerpo = {
            'inventario_id': self.unidad.id, 'cliente': 'Obra Norte',
            'telefono_cliente': '6141234567', 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Calle 5', 'fecha_inicio': self.hoy.isoformat(),
            'usuario_id': self.cliente.id,
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json')

    # ── al levantarla ────────────────────────────────────────────────────────
    def test_un_anticipo_deja_saldo_vivo(self):
        resp = self._crear(monto_pago='1200')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.total, Decimal('3000'))
        self.assertEqual(len(r.pagos), 1)
        self.assertEqual(r.saldo_pendiente(), Decimal('1800'))

    def test_sin_un_peso_la_maquina_sale_igual(self):
        """`monto_pago: 0` es 'no dejó nada', no 'no se capturó'."""
        resp = self._crear(monto_pago='0')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.pagos, [])
        self.assertEqual(r.saldo_pendiente(), Decimal('3000'))
        self.assertEqual(r.estado, 'activa')   # entregada aunque deba

    def test_quien_no_captura_nada_no_cobro_nada(self):
        """Sin `monto_pago`, la renta nace debiendo: nadie cobra por omisión."""
        resp = self._crear()
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.pagos, [])
        self.assertEqual(r.saldo_pendiente(), Decimal('3000'))

    def test_cobrar_de_mas_no_pasa_y_no_deja_renta_a_medias(self):
        resp = self._crear(monto_pago='5000')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(Renta.objects.count(), 0)
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'disponible')

    def test_el_pago_dividido_puede_sumar_menos_que_el_total(self):
        """Mitad efectivo, mitad tarjeta… y aún así queda debiendo."""
        resp = self._crear(pagos=[{'metodo': 'efectivo', 'monto': '500'},
                                  {'metodo': 'tarjeta', 'monto': '500'}])
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.saldo_pendiente(), Decimal('2000'))

    # ── el carril del dinero ─────────────────────────────────────────────────
    def test_la_renta_con_saldo_cae_en_cobranza_y_en_mis_adeudos(self):
        rid = self._crear(monto_pago='1000').data['renta']['id']

        adeudos = self.client.get('/api/rentas/adeudos/')
        self.assertEqual(adeudos.status_code, 200)
        self.assertEqual([f['id'] for f in adeudos.data['rentas']], [rid])
        self.assertEqual(adeudos.data['total'], '2000.00')

        cliente = APIClient()
        cliente.force_authenticate(self.cliente)
        mias = cliente.get('/api/rentas/mias/')
        self.assertEqual(mias.status_code, 200)
        fila = mias.data['rentas'][0]
        self.assertEqual(Decimal(fila['saldo']), Decimal('2000'))
        self.assertEqual(Decimal(fila['pagado']), Decimal('1000'))

    def test_los_abonos_del_camino_liquidan_la_renta(self):
        rid = self._crear(monto_pago='1000').data['renta']['id']
        for monto in ('800', '1200'):
            resp = self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': monto}, format='json')
            self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.saldo_pendiente(), Decimal('0'))
        self.assertEqual(len(r.pagos), 3)
        # Ya sin saldo, sale de la cobranza sola.
        self.assertEqual(self.client.get('/api/rentas/adeudos/').data['rentas'], [])

    def test_nadie_abona_mas_de_lo_que_debe(self):
        rid = self._crear(monto_pago='1000').data['renta']['id']
        resp = self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': '2500'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_cada_abono_se_le_avisa_al_cliente(self):
        rid = self._crear(monto_pago='1000').data['renta']['id']
        self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': '500'}, format='json')
        aviso = Notificacion.objects.filter(usuario=self.cliente, seccion='mis-adeudos').first()
        self.assertIsNotNone(aviso)
        self.assertIn('1500', aviso.mensaje)   # el saldo que le queda
        self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': '1500'}, format='json')
        ultimo = Notificacion.objects.filter(usuario=self.cliente, seccion='mis-adeudos').order_by('-id').first()
        self.assertEqual(ultimo.titulo, 'Quedaste al corriente')

    # ── al recogerla ─────────────────────────────────────────────────────────
    def test_la_maquina_se_recoge_aunque_no_llegue_al_piso(self):
        """Con 1000 de 3000 (33%) NO llega al 75%, y aun así la máquina vuelve.

        El dinero no retiene la máquina: al final de una renta la empresa quiere
        su equipo de vuelta. Lo que falta se va a cobranza.
        """
        rid = self._crear(monto_pago='1000').data['renta']['id']
        resp = self.client.post(f'/api/rentas/{rid}/devolver/', {}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.estado, 'finalizada')
        self.assertIsNotNone(r.recogida_en)
        self.assertEqual(r.saldo_pendiente(), Decimal('2000'))
        self.assertIn('mínimo 75%', r.liquidacion_nota)

    def test_liquidando_en_la_puerta_si_cierra(self):
        """Liquidar sigue cerrando, claro: el piso es un mínimo, no un tope."""
        rid = self._crear(monto_pago='1000').data['renta']['id']
        self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': '2000'}, format='json')
        resp = self.client.post(f'/api/rentas/{rid}/devolver/', {}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Renta.objects.get(pk=rid).estado, 'finalizada')

    def test_la_renta_pagada_de_golpe_se_devuelve_como_siempre(self):
        rid = self._crear(monto_pago='3000').data['renta']['id']
        resp = self.client.post(f'/api/rentas/{rid}/devolver/', {}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_la_garantia_puede_pagar_lo_que_falta(self):
        """El depósito se resuelve ANTES de medir el saldo, o no serviría de nada."""
        rid = self._crear(monto_pago='2000', deposito='1500').data['renta']['id']
        resp = self.client.post(f'/api/rentas/{rid}/devolver/',
                                {'deposito': {'aplicar_deuda': '1000', 'reembolso_tipo': 'devuelto'}},
                                format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.estado, 'finalizada')
        self.assertEqual(r.saldo_pendiente(), Decimal('0'))
        self.assertEqual(r.deposito_reembolso, Decimal('500'))

    def test_devolver_tarde_no_inventa_deuda(self):
        """REMALI no cobra recargos: traerla tarde no cambia lo que se debe.

        Aquí se calculaban solos (`tarifa_diaria × días`) y nadie los pidió: una
        renta de $1,200 devuelta nueve días tarde generaba $10,800 de deuda
        inventada. Lo que sustituye al recargo son los recordatorios.
        """
        rid = self._crear(monto_pago='3000').data['renta']['id']   # liquidada
        tarde = Renta.objects.get(pk=rid).fecha_fin + timezone.timedelta(days=9)
        resp = self.client.post(f'/api/rentas/{rid}/devolver/',
                                {'fecha_devolucion': tarde.isoformat()}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.estado, 'finalizada')
        self.assertEqual(r.recargo, Decimal('0'))
        self.assertEqual(r.total, Decimal('3000'))
        self.assertEqual(r.saldo_pendiente(), Decimal('0'))   # no debe nada




class PisoDeLiquidacionTest(TestCase):
    """El 75%: una META de cobranza, no un candado.

    Nació como candado —la máquina no se recogía sin llegar al piso— y duró poco,
    porque en campo se rompe por dos lados:

    1. El recargo. `finalizar()` cobra `tarifa_diaria × días de retraso` y ese
       recargo entra en `total`, que es la base del piso. NO recoger subía el
       piso al día siguiente: el faltante crecía más rápido que el cobro.
    2. Al final de una renta la empresa QUIERE su máquina. Negarse a recogerla
       deja el equipo en la obra, sin poder rentarlo y con el riesgo encima.

    Y había un tercer problema, peor: un atorón. Ver
    `test_el_recargo_no_puede_atorar_la_devolucion`.
    """

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()

    def _crear(self, **extra):
        """Renta de 3 días a $1000 = total $3000. El 75% son $2250."""
        cuerpo = {
            'inventario_id': self.unidad.id, 'cliente': 'Obra Norte',
            'telefono_cliente': '6141234567', 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Calle 5', 'fecha_inicio': self.hoy.isoformat(),
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json').data['renta']['id']

    def _devolver(self, rid, **cuerpo):
        return self.client.post(f'/api/rentas/{rid}/devolver/', cuerpo, format='json')

    # ── el piso no frena ─────────────────────────────────────────────────────
    def test_por_debajo_del_piso_se_recoge_y_queda_el_rastro(self):
        rid = self._crear(monto_pago='1000')
        self.assertEqual(self._devolver(rid).status_code, 200)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.estado, 'finalizada')
        self.assertEqual(r.saldo_pendiente(), Decimal('2000'))
        self.assertIn('33.3%', r.liquidacion_nota)
        self.assertIn('mínimo 75%', r.liquidacion_nota)
        self.unidad.refresh_from_db()
        self.assertNotEqual(self.unidad.estado, 'rentado')   # la máquina volvió

    def test_administracion_recibe_el_aviso_con_las_cifras(self):
        """El control es por revisión: nadie autoriza en la obra, pero nadie se entera tarde."""
        from maquinaria.models import Notificacion
        rid = self._crear(monto_pago='1000')
        self.assertEqual(self._devolver(rid, nota='Dijo que pasa el viernes').status_code, 200)
        aviso = Notificacion.objects.filter(ref=f'bajo-piso-renta-{rid}').first()
        self.assertIsNotNone(aviso)
        self.assertIn('2000', aviso.titulo)
        self.assertIn('Obra Norte', aviso.mensaje)
        self.assertIn('viernes', aviso.mensaje)          # la nota del técnico viaja
        self.assertEqual(aviso.seccion, 'adeudos')
        self.assertIsNone(aviso.usuario)                 # broadcast a todo el equipo

    def test_llegando_al_piso_no_hay_nota_ni_aviso(self):
        from maquinaria.models import Notificacion
        rid = self._crear(monto_pago='2250')             # 75% exacto
        self.assertEqual(self._devolver(rid).status_code, 200)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.liquidacion_nota, '')
        self.assertEqual(r.saldo_pendiente(), Decimal('750'))   # el resto NO se perdona
        self.assertFalse(Notificacion.objects.filter(ref=f'bajo-piso-renta-{rid}').exists())

    def test_la_deuda_que_queda_aparece_en_cobranza(self):
        rid = self._crear(monto_pago='1000')
        self.assertEqual(self._devolver(rid).status_code, 200)
        adeudos = self.client.get('/api/rentas/adeudos/')
        self.assertIn(rid, [f['id'] for f in adeudos.data['rentas']])
        self.assertEqual(Decimal(adeudos.data['total']), Decimal('2000'))

    # ── el atorón que motivó todo esto ───────────────────────────────────────
    def test_devolver_tarde_no_deja_saldo_ni_nota(self):
        """Regresión del atorón, ahora por la vía corta: sin recargo no hay atorón.

        El bug era: el recargo nacía al cerrar la devolución; si la devolución se
        rechazaba por ese saldo, el rollback lo borraba, y entonces la pantalla
        pedía cobrar $10,800 mientras el endpoint de abonos contestaba "el abono
        es mayor al saldo ($0.00)". Se arregló por los dos lados —la recolección
        ya no se frena, y el recargo ya no existe— así que esta prueba vigila que
        devolver tarde una renta pagada no genere absolutamente nada.
        """
        from maquinaria.models import Notificacion
        rid = self._crear(monto_pago='3000')             # liquidada
        tarde = Renta.objects.get(pk=rid).fecha_fin + timezone.timedelta(days=9)
        resp = self._devolver(rid, fecha_devolucion=tarde.isoformat())
        self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.recargo, Decimal('0'))
        self.assertEqual(r.saldo_pendiente(), Decimal('0'))
        self.assertEqual(r.liquidacion_nota, '')
        self.assertFalse(Notificacion.objects.filter(ref=f'bajo-piso-renta-{rid}').exists())

    # ── casos de borde ───────────────────────────────────────────────────────
    def test_la_garantia_aplicada_cuenta_para_alcanzar_el_piso(self):
        rid = self._crear(monto_pago='1500', deposito='1000')
        resp = self._devolver(rid, deposito={'aplicar_deuda': '750', 'reembolso_tipo': 'devuelto'})
        self.assertEqual(resp.status_code, 200, resp.data)
        r = Renta.objects.get(pk=rid)
        self.assertEqual(r.pagado(), Decimal('2250'))    # 1500 + 750 de la garantía
        self.assertEqual(r.liquidacion_nota, '')         # llegó al piso: sin nota

    def test_el_piso_es_configurable(self):
        from maquinaria.models import ConfiguracionSitio
        cfg = ConfiguracionSitio.get_solo()
        cfg.renta_liquidacion_minima_pct = 50
        cfg.save(update_fields=['renta_liquidacion_minima_pct'])
        rid = self._crear(monto_pago='1500')             # 50% exacto
        self.assertEqual(self._devolver(rid).status_code, 200)
        self.assertEqual(Renta.objects.get(pk=rid).liquidacion_nota, '')

    def test_en_cero_la_empresa_fia_sin_condiciones(self):
        from maquinaria.models import ConfiguracionSitio
        cfg = ConfiguracionSitio.get_solo()
        cfg.renta_liquidacion_minima_pct = 0
        cfg.save(update_fields=['renta_liquidacion_minima_pct'])
        rid = self._crear(monto_pago='0')
        self.assertEqual(self._devolver(rid).status_code, 200)
        self.assertEqual(Renta.objects.get(pk=rid).liquidacion_nota, '')

    def test_falta_liquidar_se_publica_para_la_hoja_del_tecnico(self):
        """Informativo, no bloqueante: el técnico sabe cuánto pedir."""
        rid = self._crear(monto_pago='1000')
        detalle = self.client.get('/api/rentas/?estado=todas').data['rentas']
        fila = next(f for f in detalle if f['id'] == rid)
        self.assertEqual(Decimal(fila['falta_liquidar']), Decimal('1250'))
        self.assertEqual(Decimal(fila['saldo']), Decimal('2000'))


class AdeudoFrenaNuevaRentaTest(TestCase):
    """La palanca de cobro: quien debe de una renta TERMINADA no se lleva otra.

    Va al LEVANTAR la renta y no al entregarla, y la diferencia es de operación:
    el mostrador tiene al cliente enfrente y a un administrador a la mano; la
    entrega la hace el técnico en la obra, con la máquina en el camión y sin
    nadie a quien pedirle permiso. Aquí el candado sí presiona, porque el
    cliente quiere llevarse algo nuestro.
    """

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        self.u1 = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.u2 = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()

    def _crear(self, unidad, cliente='Obra Norte', **extra):
        cuerpo = {
            'inventario_id': unidad.id, 'cliente': cliente,
            'telefono_cliente': '6141234567', 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Calle 5', 'fecha_inicio': self.hoy.isoformat(),
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json')

    def _dejar_adeudo(self):
        """Una renta terminada con $2000 sin pagar, a nombre de Obra Norte."""
        rid = self._crear(self.u1, monto_pago='1000').data['renta']['id']
        self.client.post(f'/api/rentas/{rid}/devolver/', {}, format='json')
        return rid

    def test_con_adeudo_vencido_no_se_levanta_otra_renta(self):
        self._dejar_adeudo()
        resp = self._crear(self.u2, monto_pago='3000')
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertEqual(resp.data['codigo'], 'cliente_con_adeudo')
        self.assertEqual(Decimal(resp.data['adeudo']), Decimal('2000'))
        self.assertEqual(resp.data['rentas'], 1)

    def test_un_administrador_puede_autorizarla_y_queda_el_rastro(self):
        from maquinaria.seguridad import definir_codigo
        definir_codigo(self.admin, '123456')
        self._dejar_adeudo()
        resp = self._crear(self.u2, monto_pago='3000', codigo_ajuste='123456')
        self.assertEqual(resp.status_code, 201, resp.data)
        nueva = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertIn('adeudo vencido', nueva.liquidacion_nota)
        self.assertIn('autorizada por', nueva.liquidacion_nota)

    def test_el_codigo_equivocado_no_abre_la_puerta(self):
        from maquinaria.seguridad import definir_codigo
        definir_codigo(self.admin, '123456')
        self._dejar_adeudo()
        resp = self._crear(self.u2, monto_pago='3000', codigo_ajuste='999999')
        self.assertNotIn(resp.status_code, (200, 201))

    def test_una_renta_VIVA_con_saldo_no_frena_nada(self):
        """Todavía la está usando y todavía está en tiempo de abonar."""
        self._crear(self.u1, monto_pago='0')             # activa, debiendo 3000
        resp = self._crear(self.u2, monto_pago='3000')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_al_ponerse_al_corriente_puede_rentar_otra_vez(self):
        rid = self._dejar_adeudo()
        self.client.post(f'/api/rentas/{rid}/abonos/', {'monto': '2000'}, format='json')
        resp = self._crear(self.u2, monto_pago='3000')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_el_adeudo_de_otro_cliente_no_lo_frena(self):
        self._dejar_adeudo()                             # Obra Norte debe
        resp = self._crear(self.u2, cliente='Constructora Sur', monto_pago='3000')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_sin_nombre_no_se_le_cobra_el_pasado_a_nadie(self):
        """Mejor dejar pasar que frenar al cliente equivocado."""
        self._dejar_adeudo()
        resp = self._crear(self.u2, cliente='', monto_pago='3000')
        self.assertEqual(resp.status_code, 201, resp.data)
