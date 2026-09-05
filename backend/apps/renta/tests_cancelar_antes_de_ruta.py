"""El cliente cancela mientras la máquina no se haya movido.

El caso real: Josué Ramsés reserva para HOY a las 12:00. A las 7 de la mañana
quiere cancelar y la máquina sigue en el patio. Antes no podía —el candado
miraba el calendario— y el chofer salía cargado para nada.
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Equipo, Inventario
from renta.models import Renta


class CancelarAntesDeQueSalgaLaCamioneta(TestCase):
    def setUp(self):
        self.cliente = User.objects.create_user('josue', password='x')
        eq = Equipo.objects.create(modelo='RETRO-04', precio_dia=1500)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='RET-04', estado='disponible')
        self.api = APIClient()
        self.api.force_authenticate(self.cliente)

    def _renta(self, dias_adelante=0):
        return Renta.objects.create(
            inventario=self.unidad, usuario=self.cliente, cliente_texto='Josue Ramses',
            telefono_cliente='7441772370', direccion='Obra centro',
            modalidad='dia', duracion=1,
            fecha_inicio=timezone.localdate() + timedelta(days=dias_adelante),
        )

    # ── La fase: qué se le enseña ───────────────────────────────────────────
    def test_programada_para_hoy_dice_POR_ENTREGAR_no_activa(self):
        r = self._renta(dias_adelante=0)
        self.assertEqual(r.estado, 'activa')          # la unidad sí está comprometida
        self.assertEqual(r.fase, 'por_entregar')      # pero NO está en manos del cliente
        self.assertEqual(r.fase_label, 'Por entregar')

    def test_cuando_sale_el_chofer_dice_EN_CAMINO(self):
        r = self._renta()
        r.salida_ruta_en = timezone.now()
        self.assertEqual(r.fase, 'en_camino')

    def test_ya_entregada_dice_EN_OBRA(self):
        r = self._renta()
        r.entregada_en = timezone.now()
        self.assertEqual(r.fase, 'activa')
        self.assertEqual(r.fase_label, 'En obra')

    # ── El candado ──────────────────────────────────────────────────────────
    def test_puede_cancelar_EL_MISMO_DIA_si_la_maquina_no_se_ha_movido(self):
        """El bug: antes respondía 'Ya llegó el día de tu reserva'."""
        r = self._renta(dias_adelante=0)
        self.assertTrue(r.cancelable_por_cliente)
        resp = self.api.post(f'/api/rentas/{r.id}/cancelar-reserva/', {'motivo': 'ya no la necesito'})
        self.assertEqual(resp.status_code, 200, resp.data)
        r.refresh_from_db()
        self.assertEqual(r.estado, 'cancelada')

    def test_NO_puede_cancelar_si_el_chofer_ya_salio(self):
        r = self._renta(dias_adelante=0)
        r.salida_ruta_en = timezone.now()
        r.save(update_fields=['salida_ruta_en'])
        self.assertFalse(r.cancelable_por_cliente)
        resp = self.api.post(f'/api/rentas/{r.id}/cancelar-reserva/', {})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('en camino', resp.data['detalle'])

    def test_NO_puede_cancelar_si_ya_se_la_entregaron(self):
        r = self._renta(dias_adelante=0)
        r.entregada_en = timezone.now()
        r.save(update_fields=['entregada_en'])
        resp = self.api.post(f'/api/rentas/{r.id}/cancelar-reserva/', {})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('entregado', resp.data['detalle'])

    def test_una_reserva_a_futuro_sigue_siendo_cancelable(self):
        """No se rompe lo que ya funcionaba."""
        self.assertTrue(self._renta(dias_adelante=3).cancelable_por_cliente)


class TecnicoMarcaLaSalida(TestCase):
    def setUp(self):
        self.tecnico = User.objects.create_user('tecnico', password='x', is_staff=True)
        self.cliente = User.objects.create_user('josue2', password='x')
        eq = Equipo.objects.create(modelo='RETRO-05', precio_dia=1500)
        unidad = Inventario.objects.create(equipo=eq, codigo='RET-05', estado='disponible')
        self.renta = Renta.objects.create(
            inventario=unidad, usuario=self.cliente, cliente_texto='Josue Ramses',
            telefono_cliente='7441772370', direccion='Obra centro',
            modalidad='dia', duracion=1, fecha_inicio=timezone.localdate(),
        )
        self.api = APIClient()
        self.api.force_authenticate(self.tecnico)

    def test_marcar_en_camino_cierra_la_cancelacion_y_avisa_al_cliente(self):
        resp = self.api.post(f'/api/rentas/{self.renta.id}/en-camino/', {})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.renta.refresh_from_db()
        self.assertIsNotNone(self.renta.salida_ruta_en)
        self.assertEqual(self.renta.salida_ruta_por, self.tecnico)
        self.assertFalse(self.renta.cancelable_por_cliente)
        from maquinaria.models import Notificacion
        self.assertTrue(Notificacion.objects.filter(ref=f'en-camino-{self.renta.id}').exists())

    def test_se_puede_deshacer_si_el_tecnico_se_equivoco(self):
        self.api.post(f'/api/rentas/{self.renta.id}/en-camino/', {})
        resp = self.api.post(f'/api/rentas/{self.renta.id}/en-camino/', {'en_camino': False})
        self.assertEqual(resp.status_code, 200)
        self.renta.refresh_from_db()
        self.assertIsNone(self.renta.salida_ruta_en)
        self.assertTrue(self.renta.cancelable_por_cliente)   # vuelve a poder cancelar
