"""La hora estimada de entrega: lo único que le dice al cliente "llega a las 10".

La renta solo guardaba el DÍA, así que en "Mis rentas" el cliente veía "del 20 al
22 ago" y nada más, y su agenda de próximas entregas anclaba todo al mediodía
porque no había hora que mostrar. La cotización sí sabía guardar una hora, pero
la mitad de las rentas no nacen de una cotización.

Es un campo APARTE y opcional, no un cambio de tipo en `fecha_inicio`: esa fecha
la usan el cálculo del vencimiento, el traslape de reservas y los recordatorios.
Estas pruebas cuidan las dos cosas: que la hora llegue a donde tiene que llegar,
y que no le haya movido nada a la fecha.
"""

import datetime as _dt
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo
from renta.models import Renta


class HoraDeEntregaTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('800'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()

    def _crear(self, **extra):
        cuerpo = {
            'inventario_id': self.unidad.id, 'cliente': 'Obra Norte',
            'telefono_cliente': '6141234567', 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Calle 5', 'fecha_inicio': self.hoy.isoformat(),
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json')

    def test_la_hora_capturada_se_guarda(self):
        resp = self._crear(hora_entrega_estimada='10:30')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.hora_entrega_estimada, _dt.time(10, 30))

    def test_es_opcional(self):
        """Sin hora todo sigue como antes: la renta se levanta igual."""
        resp = self._crear()
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertIsNone(r.hora_entrega_estimada)

    def test_una_hora_ilegible_no_tumba_la_renta(self):
        """Nadie se queda sin su máquina porque el reloj venía mal escrito."""
        resp = self._crear(hora_entrega_estimada='10 y media')
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertIsNone(r.hora_entrega_estimada)

    def test_no_le_mueve_nada_a_las_fechas(self):
        """El día sigue mandando: la hora solo acompaña."""
        sin = Renta.objects.get(pk=self._crear().data['renta']['id'])
        fechas_sin = (sin.fecha_inicio, sin.fecha_fin)
        sin.delete()
        self.unidad.refresh_from_db()
        self.unidad.estado = 'disponible'
        self.unidad.save(update_fields=['estado'])
        con = Renta.objects.get(pk=self._crear(hora_entrega_estimada='07:00').data['renta']['id'])
        self.assertEqual((con.fecha_inicio, con.fecha_fin), fechas_sin)

    def test_el_cliente_la_ve_en_sus_rentas(self):
        cliente = get_user_model().objects.create_user('jazmin', password='pass12345')
        resp = self._crear(hora_entrega_estimada='09:15', usuario_id=cliente.id)
        self.assertIn(resp.status_code, (200, 201), resp.data)
        self.client.force_authenticate(cliente)
        fila = self.client.get('/api/rentas/mias/').data['rentas'][0]
        self.assertEqual(str(fila['hora_entrega_estimada']), '09:15:00')

    def test_el_tecnico_la_ve_en_su_jornada(self):
        """Sin la hora, "entregar hoy" no dice si es a las 8 o a las 6 de la tarde."""
        self._crear(hora_entrega_estimada='08:00')
        tareas = self.client.get('/api/rentas/tareas/').data['tareas']
        entrega = next(t for t in tareas if t['tipo'] == 'entregar')
        self.assertIn('08:00', entrega['etiqueta'])
        self.assertEqual(str(entrega['hora_entrega_estimada']), '08:00:00')


class HeredarDeLaCotizacionTest(TestCase):
    """Si ya se prometió la hora en la cotización, no se vuelve a capturar."""

    def setUp(self):
        from cotizaciones.models import Cotizacion, CotizacionItem
        self.admin = get_user_model().objects.create_superuser('duena2', 'd2@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('800'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()
        self.cot = Cotizacion.objects.create(
            tipo='renta', estado='aceptada',
            cliente_nombre='Obra Norte', cliente_telefono='6141234567',
            entrega_prometida=timezone.make_aware(
                _dt.datetime.combine(self.hoy, _dt.time(11, 45))),
        )
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Martillo · renta por día',
            modalidad='dia', equipo=self.equipo, cantidad=1,
            precio_unitario=Decimal('800'),
        )

    def _crear(self, **extra):
        cuerpo = {
            'inventario_id': self.unidad.id, 'cliente': 'Obra Norte',
            'telefono_cliente': '6141234567', 'modalidad': 'dia', 'duracion': 3,
            'direccion': 'Calle 5', 'fecha_inicio': self.hoy.isoformat(),
            'cotizacion_id': self.cot.id,
        }
        cuerpo.update(extra)
        return self.client.post('/api/rentas/crear/', cuerpo, format='json')

    def test_hereda_la_hora_prometida(self):
        resp = self._crear()
        self.assertIn(resp.status_code, (200, 201), resp.data)
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.hora_entrega_estimada, _dt.time(11, 45))

    def test_lo_que_se_captura_gana_sobre_lo_heredado(self):
        """Si se cambió el acuerdo, manda lo que se capturó hoy."""
        resp = self._crear(hora_entrega_estimada='16:00')
        r = Renta.objects.get(pk=resp.data['renta']['id'])
        self.assertEqual(r.hora_entrega_estimada, _dt.time(16, 0))
