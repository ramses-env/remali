"""Convertir una cotización deja una venta que dice la verdad.

En el panel del cliente apareció una compra en $0.00 cuya cotización era de
$2,000: la venta se guardó con `total = 0`, sin unidad en el espejo, y la
máquina se quedó marcada como DISPONIBLE en el patio aunque ya se había
vendido. El renglón sí traía su precio; lo que no cuadraba era la venta.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


class ConversionDeCotizacionTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='GEN-100', precio_venta=Decimal('2000'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        self.cot = Cotizacion.objects.create(
            tipo='venta', estado='aceptada',
            cliente_nombre='Jazmín Mendoza', cliente_telefono='6141234567',
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Generador de luz · venta',
            modalidad='venta', equipo=self.equipo, cantidad=1,
            precio_unitario=Decimal('2000'),
        )
        self.cot.refresh_from_db()

    def _convertir(self, **extra):
        cuerpo = {'unidad_ids': [self.unidad.id], 'metodo_pago': 'transferencia'}
        cuerpo.update(extra)
        return self.client.post(f'/api/cotizaciones/{self.cot.id}/convertir/', cuerpo, format='json')

    def test_la_venta_vale_lo_que_valia_la_cotizacion(self):
        resp = self._convertir()
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(venta.total, Decimal('2000.00'))
        self.assertEqual(venta.maquinas.first().precio, Decimal('2000.00'))

    def test_el_espejo_apunta_a_la_maquina_vendida(self):
        """`venta.inventario` lo leen el ticket, el historial y 'Mis compras'."""
        resp = self._convertir()
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(venta.inventario_id, self.unidad.id)
        self.assertEqual(venta.precio_maquina, Decimal('2000.00'))

    def test_la_maquina_sale_del_patio(self):
        """Si sigue 'disponible', el catálogo la ofrece y alguien la vende dos veces."""
        self._convertir()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')


class ConversionQueFallaNoDejaRastroTest(TestCase):
    """Una conversión que falla no puede dejar media venta guardada.

    Fue el bug real: la unidad tenía una renta RESERVADA, así que al marcarla
    vendida el inventario se plantó con razón. Pero el `return` del manejador
    estaba DENTRO del `transaction.atomic()`, y salir con `return` no revierte:
    el bloque termina sin excepción y commitea. Quedó la venta con total $0, su
    renglón vivo con los $2,000, la máquina todavía disponible en el patio, y la
    cotización marcada como convertida — imposible de rehacer.
    """

    def setUp(self):
        from datetime import timedelta
        from django.utils import timezone
        from renta.models import Renta
        self.admin = get_user_model().objects.create_superuser('duena2', 'd2@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='GEN-100', precio_venta=Decimal('2000'),
                                            precio_dia=Decimal('500'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        hoy = timezone.localdate()
        # La misma máquina ya está apalabrada para una renta de mañana.
        Renta.objects.create(
            inventario=self.unidad, cliente_texto='Obra Sur', modalidad='dia', duracion=1,
            direccion='Calle 8', fecha_inicio=hoy + timedelta(days=1), estado='reservada',
        )
        self.cot = Cotizacion.objects.create(
            tipo='venta', estado='aceptada',
            cliente_nombre='Jazmín Mendoza', cliente_telefono='6141234567',
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Generador de luz · venta',
            modalidad='venta', equipo=self.equipo, cantidad=1,
            precio_unitario=Decimal('2000'),
        )
        self.cot.refresh_from_db()

    def _convertir(self):
        return self.client.post(f'/api/cotizaciones/{self.cot.id}/convertir/',
                                {'unidad_ids': [self.unidad.id], 'metodo_pago': 'transferencia'},
                                format='json')

    def test_se_explica_el_motivo(self):
        resp = self._convertir()
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('reservada', resp.data['detalle'])

    def test_no_queda_ninguna_venta_fantasma(self):
        self._convertir()
        self.assertEqual(Venta.objects.count(), 0)

    def test_no_queda_ningun_renglon_suelto(self):
        from ventas.models import VentaMaquina
        self._convertir()
        self.assertEqual(VentaMaquina.objects.count(), 0)

    def test_la_cotizacion_se_puede_volver_a_convertir(self):
        """Si quedara marcada como convertida, el cliente se queda sin su compra."""
        self._convertir()
        self.cot.refresh_from_db()
        self.assertEqual(self.cot.conversiones.count(), 0)
        # Con otra unidad libre, ahora sí entra.
        libre = Inventario.objects.create(equipo=self.equipo, condicion='nueva')
        resp = self.client.post(f'/api/cotizaciones/{self.cot.id}/convertir/',
                                {'unidad_ids': [libre.id], 'metodo_pago': 'transferencia'},
                                format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Venta.objects.get(pk=resp.data['venta_id']).total, Decimal('2000.00'))
