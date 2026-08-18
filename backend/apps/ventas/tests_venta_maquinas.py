"""Una venta puede llevarse varias máquinas, y cada una queda amarrada a ella.

Una máquina es una pieza única con número de serie: no se cuenta por cantidad
como un filtro, se nombra. Por eso cada una vive en su propio renglón, con su
precio y su entrega. Estas pruebas cuidan que ningún renglón salga del patio sin
venta que lo respalde, ni se quede marcado como vendido cuando ya volvió.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


def _equipo(modelo='REV-100', **extra):
    datos = dict(modelo=modelo, precio_venta=Decimal('50000'))
    datos.update(extra)
    return Equipo.objects.create(**datos)


class RenglonDeMaquinaTest(TestCase):
    """El puente con la forma vieja: `Venta(inventario=u)` sigue funcionando."""

    def setUp(self):
        self.equipo = _equipo()
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')

    def test_venta_de_una_maquina_genera_su_renglon(self):
        venta = Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        self.assertEqual(venta.maquinas.count(), 1)
        renglon = venta.maquinas.first()
        self.assertEqual(renglon.inventario_id, self.unidad.id)
        self.assertEqual(renglon.precio, Decimal('50000'))
        self.assertEqual(venta.total, Decimal('50000'))
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')

    def test_el_espejo_apunta_al_primer_renglon(self):
        """`venta.inventario` y `precio_maquina` siguen sirviendo a quien ya los lee."""
        venta = Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        venta.refresh_from_db()
        self.assertEqual(venta.inventario_id, self.unidad.id)
        self.assertEqual(venta.precio_maquina, Decimal('50000'))


class VentaDeVariasMaquinasTest(TestCase):
    """Tres máquinas en una sola operación: un folio, tres renglones."""

    def setUp(self):
        self.equipo = _equipo()
        self.u1 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u2 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u3 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')

    def _venta_de_tres(self, estado='activa'):
        from ventas.models import VentaMaquina
        venta = Venta.objects.create(nombre_cliente='Constructora X', estado=estado)
        for unidad, precio in ((self.u1, '50000'), (self.u2, '50000'), (self.u3, '48000')):
            VentaMaquina.objects.create(venta=venta, inventario=unidad, precio=Decimal(precio))
        venta.refresh_from_db()
        return venta

    def test_cada_maquina_queda_vendida_y_el_total_las_suma(self):
        venta = self._venta_de_tres()
        self.assertEqual(venta.maquinas.count(), 3)
        self.assertEqual(venta.total, Decimal('148000'))
        for u in (self.u1, self.u2, self.u3):
            u.refresh_from_db()
            self.assertEqual(u.estado, 'vendido', f'{u.codigo} no quedó vendida')

    def test_el_iva_se_desglosa_del_total_no_se_suma(self):
        venta = self._venta_de_tres()
        self.assertEqual(venta.subtotal + venta.iva, venta.total)
        self.assertEqual(venta.subtotal, (Decimal('148000') / Decimal('1.16')).quantize(Decimal('0.01')))

    def test_cancelar_devuelve_las_tres_al_patio(self):
        venta = self._venta_de_tres()
        venta.cancelar('el cliente se echó para atrás')
        for u in (self.u1, self.u2, self.u3):
            u.refresh_from_db()
            self.assertEqual(u.estado, 'disponible', f'{u.codigo} se quedó fuera del inventario')

    def test_apartado_de_varias_aparta_todas(self):
        venta = self._venta_de_tres(estado='apartada')
        for u in (self.u1, self.u2, self.u3):
            u.refresh_from_db()
            self.assertEqual(u.estado, 'apartado')
        self.assertEqual(venta.total, Decimal('148000'))

    def test_no_se_puede_meter_una_maquina_que_no_esta_disponible(self):
        from ventas.models import VentaMaquina
        Venta.objects.create(inventario=self.u1, precio_maquina=Decimal('50000'))
        otra = Venta.objects.create(nombre_cliente='Otro')
        with self.assertRaises(ValueError):
            VentaMaquina.objects.create(venta=otra, inventario=self.u1, precio=Decimal('50000'))

    def test_maquinas_y_refacciones_en_la_misma_venta(self):
        from refacciones.models import Refaccion
        from ventas.models import ItemVenta
        venta = self._venta_de_tres()
        ref = Refaccion.objects.create(nombre='Filtro', precio_venta=Decimal('600'), stock=10)
        ItemVenta.objects.create(venta=venta, refaccion=ref, cantidad=2, precio_unitario=Decimal('600'))
        venta.refresh_from_db()
        self.assertEqual(venta.total, Decimal('149200'))


class EntregaParcialTest(TestCase):
    """Llegaron 2 de 3: se entregan las que están, la venta espera por la otra."""

    def setUp(self):
        from ventas.models import VentaMaquina
        self.equipo = _equipo()
        self.u1 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u2 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u3 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.venta = Venta.objects.create(nombre_cliente='Constructora X', estado='apartada')
        for u in (self.u1, self.u2, self.u3):
            VentaMaquina.objects.create(venta=self.venta, inventario=u, precio=Decimal('50000'))
        self.venta.refresh_from_db()

    def _liquidar(self):
        self.venta.pagos = [{'monto': '150000', 'metodo': 'efectivo'}]
        self.venta.save()

    def test_no_sale_ninguna_maquina_sin_liquidar(self):
        with self.assertRaises(ValueError) as e:
            self.venta.entregar()
        self.assertIn('saldo', str(e.exception).lower())
        self.u1.refresh_from_db()
        self.assertEqual(self.u1.estado, 'apartado')

    def test_entrega_de_dos_deja_la_venta_esperando_la_tercera(self):
        self._liquidar()
        self.venta.entregar(unidades=[self.u1, self.u2])
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.estado, 'apartada', 'la venta se cerró con una máquina pendiente')
        self.u1.refresh_from_db(); self.u2.refresh_from_db(); self.u3.refresh_from_db()
        self.assertEqual((self.u1.estado, self.u2.estado), ('vendido', 'vendido'))
        self.assertEqual(self.u3.estado, 'apartado', 'la que no ha llegado no debe salir del apartado')

    def test_al_entregar_la_ultima_la_venta_se_cierra(self):
        self._liquidar()
        self.venta.entregar(unidades=[self.u1, self.u2])
        self.venta.entregar(unidades=[self.u3])
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.estado, 'activa')
        self.assertIsNotNone(self.venta.entregada_en)
        self.assertEqual(self.venta.maquinas.filter(entregada_en__isnull=True).count(), 0)

    def test_entregar_sin_decir_cuales_entrega_todas(self):
        self._liquidar()
        self.venta.entregar()
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.estado, 'activa')
        for u in (self.u1, self.u2, self.u3):
            u.refresh_from_db()
            self.assertEqual(u.estado, 'vendido')


class QuitarMaquinaTest(TestCase):
    """Sacar una máquina de una venta ya hecha: se puede, pero deja rastro."""

    def setUp(self):
        from rest_framework.test import APIClient
        from maquinaria.seguridad import definir_codigo
        from ventas.models import VentaMaquina
        self.equipo = _equipo()
        self.u1 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.u2 = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.admin = get_user_model().objects.create_superuser('jefa', 'jefa@x.com', 'pass12345')
        definir_codigo(self.admin, '123456')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.venta = Venta.objects.create(nombre_cliente='Constructora X')
        for u in (self.u1, self.u2):
            VentaMaquina.objects.create(venta=self.venta, inventario=u, precio=Decimal('50000'))
        self.venta.refresh_from_db()
        self.renglon2 = self.venta.maquinas.filter(inventario=self.u2).first()

    def _quitar(self, **extra):
        cuerpo = {'motivo': 'salió con falla de fábrica', 'codigo_seguridad': '123456'}
        cuerpo.update(extra)
        return self.client.post(
            f'/api/ventas/{self.venta.id}/maquinas/{self.renglon2.id}/quitar/', cuerpo, format='json')

    def test_con_codigo_la_maquina_vuelve_al_patio_y_el_total_baja(self):
        resp = self._quitar()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.u2.refresh_from_db(); self.venta.refresh_from_db(); self.renglon2.refresh_from_db()
        self.assertEqual(self.u2.estado, 'disponible')
        self.assertEqual(self.venta.total, Decimal('50000'))
        self.assertIsNotNone(self.renglon2.cancelada_en)
        self.assertEqual(self.renglon2.cancelada_por_id, self.admin.id)
        self.assertIn('falla de fábrica', self.renglon2.cancelada_motivo)

    def test_sin_codigo_no_pasa_nada(self):
        resp = self._quitar(codigo_seguridad='')
        self.assertEqual(resp.status_code, 403, resp.data)
        self.u2.refresh_from_db(); self.venta.refresh_from_db()
        self.assertEqual(self.u2.estado, 'vendido')
        self.assertEqual(self.venta.total, Decimal('100000'))

    def test_sin_motivo_no_pasa(self):
        resp = self._quitar(motivo='')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.u2.refresh_from_db()
        self.assertEqual(self.u2.estado, 'vendido')

    def test_no_se_quita_la_ultima_maquina(self):
        self._quitar()
        renglon1 = self.venta.maquinas.filter(inventario=self.u1).first()
        resp = self.client.post(
            f'/api/ventas/{self.venta.id}/maquinas/{renglon1.id}/quitar/',
            {'motivo': 'ya no la quiso', 'codigo_seguridad': '123456'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.u1.refresh_from_db()
        self.assertEqual(self.u1.estado, 'vendido')

    def test_el_espejo_sigue_apuntando_a_una_maquina_viva(self):
        """Quitar la PRIMERA no puede dejar `venta.inventario` apuntando a la que ya volvió."""
        renglon1 = self.venta.maquinas.filter(inventario=self.u1).first()
        resp = self.client.post(
            f'/api/ventas/{self.venta.id}/maquinas/{renglon1.id}/quitar/',
            {'motivo': 'se dañó en el traslado', 'codigo_seguridad': '123456'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.venta.refresh_from_db()
        self.assertEqual(self.venta.inventario_id, self.u2.id)
