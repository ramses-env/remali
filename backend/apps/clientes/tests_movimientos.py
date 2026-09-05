"""Ver de un cliente todo lo que ha hecho: rentas, ventas, garantías.

La pregunta que llega al mostrador —"se me descompuso, ¿todavía tengo
garantía?"— no se podía contestar desde la ficha: las garantías existían en el
modelo pero no salían por ningún lado del panel.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from clientes.cuenta import estado_de_cuenta
from clientes.models import Cliente, Garantia
from inventario.models import Equipo, Inventario
from renta.models import Renta
from ventas.models import Venta


class MovimientosDelCliente(TestCase):
    def setUp(self):
        self.cli = Cliente.objects.create(nombre='Josue Rojas', telefono='7441772370')
        eq = Equipo.objects.create(modelo='RETRO-8', precio_dia=1200, precio_venta=180000)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='RET-08', estado='disponible')
        self.renta = Renta.objects.create(
            inventario=self.unidad, cliente=self.cli, cliente_texto='Josue',
            telefono_cliente='7441772370', direccion='Obra', modalidad='dia',
            duracion=2, fecha_inicio=timezone.localdate())
        self.venta = Venta.objects.create(cliente=self.cli, equipo=eq, total=180000)

    def _cuenta(self):
        return estado_de_cuenta(self.cli, con_documentos=True)

    def test_el_historial_trae_rentas_y_ventas(self):
        docs = self._cuenta()['documentos']
        tipos = {d['tipo'] for d in docs}
        self.assertIn('renta', tipos)
        self.assertIn('venta', tipos)

    def test_cada_movimiento_trae_su_fecha(self):
        """Sin fecha, "me rentó una revolvedora" no dice si fue el mes pasado
        o hace tres años."""
        for d in self._cuenta()['documentos']:
            self.assertIsNotNone(d['fecha'], d)

    def test_una_garantia_viva_sale_con_los_dias_que_le_quedan(self):
        hoy = timezone.localdate()
        Garantia.objects.create(venta=self.venta, cliente=self.cli,
                                descripcion='Retroexcavadora RET-08', inicia=hoy,
                                meses=12, vence=hoy + timedelta(days=200))
        # Ojo: la venta ya emitió la suya sola al crearse (el catálogo dice
        # cuántos meses lleva la máquina), así que se busca la de esta prueba.
        g = next(x for x in self._cuenta()['garantias'] if x['descripcion'] == 'Retroexcavadora RET-08')
        self.assertTrue(g['vigente'])
        self.assertEqual(g['dias_restantes'], 200)
        self.assertEqual(g['venta_id'], self.venta.id)

    def test_una_vencida_tambien_sale_y_lo_dice_con_el_signo(self):
        """'Venció hace cuatro meses' contesta la pregunta igual de bien que
        un 'sí'. Ocultarla dejaría al mostrador sin con qué responder."""
        hoy = timezone.localdate()
        Garantia.objects.create(venta=self.venta, cliente=self.cli,
                                descripcion='Vieja', inicia=hoy - timedelta(days=500),
                                meses=12, vence=hoy - timedelta(days=120))
        g = next(x for x in self._cuenta()['garantias'] if x['descripcion'] == 'Vieja')
        self.assertFalse(g['vigente'])
        self.assertEqual(g['dias_restantes'], -120)

    def test_una_anulada_se_distingue_de_una_vencida(self):
        hoy = timezone.localdate()
        Garantia.objects.create(venta=self.venta, cliente=self.cli, descripcion='Anulada',
                                inicia=hoy, meses=12, vence=hoy + timedelta(days=300),
                                anulada_en=timezone.now(), anulada_motivo='Uso indebido')
        g = next(x for x in self._cuenta()['garantias'] if x['descripcion'] == 'Anulada')
        self.assertTrue(g['anulada'])
        self.assertFalse(g['vigente'])
        self.assertEqual(g['anulada_motivo'], 'Uso indebido')

    def test_las_garantias_van_APARTE_del_historial(self):
        """No son un documento: no tienen folio, total ni saldo. Meterlas en la
        misma lista obligaría a inventarles un importe."""
        hoy = timezone.localdate()
        Garantia.objects.create(venta=self.venta, cliente=self.cli, descripcion='X',
                                inicia=hoy, meses=12, vence=hoy + timedelta(days=100))
        cuenta = self._cuenta()
        self.assertIn('X', {g['descripcion'] for g in cuenta['garantias']})
        self.assertNotIn('garantia', {d['tipo'] for d in cuenta['documentos']})

    def test_un_cliente_sin_garantias_devuelve_lista_vacia_no_error(self):
        # Uno sin ventas: vender emite garantía sola si la máquina la lleva.
        otro = Cliente.objects.create(nombre='Sin compras', telefono='7440000000')
        self.assertEqual(estado_de_cuenta(otro, con_documentos=True)['garantias'], [])

    def test_la_venta_emite_su_garantia_y_se_ve_en_la_ficha(self):
        """No hay que capturarla: nace con la venta si el catálogo dice que esa
        máquina lleva garantía. Que se VEA en la ficha es lo que faltaba."""
        garantias = self._cuenta()['garantias']
        self.assertTrue(any(g['venta_id'] == self.venta.id for g in garantias))


class GarantiaCanceladaConLaVenta(TestCase):
    """Cancelar la venta apaga su garantía.

    Faltaba: la venta emitía garantía sola al crearse pero nadie la apagaba al
    cancelarla. La máquina volvía al patio y su garantía seguía contándose como
    vigente; meses después alguien llegaba con esa misma máquina —revendida— y
    el mostrador le decía que sí procedía.
    """
    def setUp(self):
        self.cli = Cliente.objects.create(nombre='Josue Rojas', telefono='7441772370')
        eq = Equipo.objects.create(modelo='RETRO-9', precio_dia=1200, precio_venta=180000)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='RET-09', estado='disponible')
        self.venta = Venta.objects.create(cliente=self.cli, inventario=self.unidad,
                                          equipo=eq, total=180000)

    def test_la_venta_nace_con_su_garantia_vigente(self):
        g = self.venta.garantias.first()
        self.assertIsNotNone(g, 'la señal la emite sola')
        self.assertTrue(g.vigente)

    def test_al_cancelar_la_venta_la_garantia_se_anula(self):
        self.venta.cancelar(motivo='el cliente se arrepintió')
        g = self.venta.garantias.first()
        g.refresh_from_db()
        self.assertIsNotNone(g.anulada_en)
        self.assertFalse(g.vigente)
        self.assertIn(f'#{self.venta.id}', g.anulada_motivo)
        self.assertIn('se arrepintió', g.anulada_motivo)

    def test_no_se_borra_la_garantia_anulada(self):
        """El rastro de que existió explica una discusión posterior."""
        self.venta.cancelar()
        self.assertEqual(self.venta.garantias.count(), 1)

    def test_la_ficha_la_muestra_como_anulada(self):
        self.venta.cancelar(motivo='error de captura')
        g = next(x for x in estado_de_cuenta(self.cli, con_documentos=True)['garantias']
                 if x['venta_id'] == self.venta.id)
        self.assertTrue(g['anulada'])
        self.assertFalse(g['vigente'])

    def test_cancelar_dos_veces_no_reescribe_el_motivo(self):
        self.venta.cancelar(motivo='primera razón')
        self.venta.cancelar(motivo='segunda razón')
        g = self.venta.garantias.first()
        g.refresh_from_db()
        self.assertIn('primera razón', g.anulada_motivo)
