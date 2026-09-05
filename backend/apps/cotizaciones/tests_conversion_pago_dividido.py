"""Convertir una cotización cobrando con dos métodos.

El pago dividido existía en la conversión desde el backend, pero en el panel
estaba escondido detrás de una cadena de ventanitas: método, "¿pago
combinado?", monto, método del resto. Ahora la hoja de venta lo pone como una
casilla y calcula el resto sola, así que este camino se usa de verdad y toca
tener red debajo: que los dos montos entren tal cual, que definan el método
principal, y que un reparto que no cuadra se rechace en vez de dejar una venta
con pagos que no suman lo cobrado.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from cotizaciones.models import Cotizacion, CotizacionItem
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


class ConversionConPagoDivididoTest(TestCase):

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
        cuerpo = {'unidad_ids': [self.unidad.id], 'metodo_pago': 'efectivo'}
        cuerpo.update(extra)
        return self.client.post(f'/api/cotizaciones/{self.cot.id}/convertir/', cuerpo, format='json')

    def test_los_dos_montos_quedan_guardados(self):
        """Es lo que manda la hoja: el capturado y el resto que ella calculó."""
        resp = self._convertir(pagos=[
            {'metodo': 'efectivo', 'monto': 500},
            {'metodo': 'tarjeta', 'monto': 1500},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(len(venta.pagos), 2)
        self.assertEqual(
            sum(Decimal(p['monto']) for p in venta.pagos),
            Decimal('2000.00'),
        )

    def test_el_metodo_principal_es_el_del_monto_mayor(self):
        """Aunque la hoja mande 'efectivo' arriba, manda quien puso más dinero:
        es lo que se lee en la lista de ventas y en el corte."""
        resp = self._convertir(pagos=[
            {'metodo': 'efectivo', 'monto': 500},
            {'metodo': 'tarjeta', 'monto': 1500},
        ])
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(venta.metodo_pago, 'tarjeta')

    def test_un_reparto_que_no_cuadra_se_rechaza(self):
        resp = self._convertir(pagos=[
            {'metodo': 'efectivo', 'monto': 500},
            {'metodo': 'tarjeta', 'monto': 900},
        ])
        self.assertEqual(resp.status_code, 400)
        self.assertIn('total', resp.data['detalle'].lower())
        self.assertFalse(Venta.objects.exists())

    def test_un_monto_en_cero_no_pasa(self):
        resp = self._convertir(pagos=[
            {'metodo': 'efectivo', 'monto': 0},
            {'metodo': 'tarjeta', 'monto': 2000},
        ])
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Venta.objects.exists())

    def test_sin_pagos_sigue_funcionando_como_siempre(self):
        """La hoja solo manda `pagos` si marcaste la casilla."""
        resp = self._convertir()
        self.assertEqual(resp.status_code, 201, resp.data)
        venta = Venta.objects.get(pk=resp.data['venta_id'])
        self.assertEqual(venta.metodo_pago, 'efectivo')
        self.assertEqual(venta.total, Decimal('2000.00'))
