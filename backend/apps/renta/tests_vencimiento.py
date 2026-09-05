"""Caso del mostrador: renta de UN día, el técnico la entrega hoy a las 2 pm."""
from datetime import datetime, time, timedelta
from django.test import TestCase
from django.utils import timezone
from unittest.mock import patch

from renta.models import Renta


class VenceDesdeLaEntrega(TestCase):
    def _renta(self, **kw):
        r = Renta()
        r.estado = 'activa'
        r.modalidad = 'dia'
        r.duracion = 1
        r.fecha_inicio = timezone.localdate()
        r.fecha_fin = timezone.localdate() + timedelta(days=1)
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    def test_entregada_a_las_2pm_vence_manana_a_las_2pm(self):
        hoy = timezone.localdate()
        entrega = timezone.make_aware(datetime.combine(hoy, time(14, 0)))
        r = self._renta(entregada_en=entrega)
        esperado = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time(14, 0)))
        self.assertEqual(r.vence_en, esperado)

    def test_a_la_1pm_del_dia_siguiente_todavia_no_vence(self):
        hoy = timezone.localdate()
        r = self._renta(entregada_en=timezone.make_aware(datetime.combine(hoy, time(14, 0))))
        ahora = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time(13, 0)))
        with patch('django.utils.timezone.now', return_value=ahora):
            self.assertFalse(r.vencida)
            self.assertAlmostEqual(r.horas_restantes, 1.0, places=1)

    def test_a_las_3pm_del_dia_siguiente_ya_vencio(self):
        hoy = timezone.localdate()
        r = self._renta(entregada_en=timezone.make_aware(datetime.combine(hoy, time(14, 0))))
        ahora = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time(15, 0)))
        with patch('django.utils.timezone.now', return_value=ahora):
            self.assertTrue(r.vencida)          # ANTES: seguía "a tiempo" 9 horas más
            self.assertAlmostEqual(r.horas_restantes, -1.0, places=1)

    def test_sin_entrega_usa_la_hora_estimada(self):
        hoy = timezone.localdate()
        r = self._renta(hora_entrega_estimada=time(9, 30))
        esperado = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time(9, 30)))
        self.assertEqual(r.vence_en, esperado)

    def test_sin_ningun_dato_de_hora_se_comporta_como_antes(self):
        """Sin entrega ni hora estimada, vence al cerrar el día de fecha_fin:
        idéntico al comportamiento anterior. Nadie pierde horas por un campo
        que no capturó."""
        hoy = timezone.localdate()
        r = self._renta()
        self.assertEqual(r.vence_en.date(), hoy + timedelta(days=1))
        self.assertEqual(r.vence_en.hour, 23)
        ahora = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time(23, 0)))
        with patch('django.utils.timezone.now', return_value=ahora):
            self.assertFalse(r.vencida)


class UmbralProporcional(TestCase):
    """El aviso "por vencer" es proporcional a la renta, no dos días fijos."""

    def _renta(self, modalidad, duracion, entrega_hace_horas):
        r = Renta()
        r.estado = 'activa'
        r.modalidad = modalidad
        r.duracion = duracion
        r.entregada_en = timezone.now() - timedelta(hours=entrega_hace_horas)
        r.fecha_inicio = timezone.localdate()
        dias = {'dia': 1, 'semana': 7, 'mes': 30}[modalidad] * duracion
        r.fecha_fin = timezone.localtime(r.entregada_en).date() + timedelta(days=dias)
        return r

    def test_renta_de_un_dia_NO_nace_en_alerta(self):
        """El bug: con "≤ 2 días" salía en amarillo desde que se registraba."""
        self.assertFalse(self._renta('dia', 1, entrega_hace_horas=0).por_vencer)
        self.assertFalse(self._renta('dia', 1, entrega_hace_horas=12).por_vencer)

    def test_renta_de_un_dia_avisa_en_sus_ultimas_6_horas(self):
        self.assertTrue(self._renta('dia', 1, entrega_hace_horas=19).por_vencer)
        self.assertTrue(self._renta('dia', 1, entrega_hace_horas=23.5).por_vencer)

    def test_semanal_avisa_el_ultimo_dia_y_medio(self):
        self.assertFalse(self._renta('semana', 1, entrega_hace_horas=24 * 5).por_vencer)
        self.assertTrue(self._renta('semana', 1, entrega_hace_horas=24 * 6).por_vencer)

    def test_mensual_topa_en_dos_dias(self):
        """Un cuarto de 30 días serían 7 días de aviso: demasiado ruido."""
        self.assertFalse(self._renta('mes', 1, entrega_hace_horas=24 * 27).por_vencer)
        self.assertTrue(self._renta('mes', 1, entrega_hace_horas=24 * 28.5).por_vencer)

    def test_una_vencida_ya_no_esta_por_vencer(self):
        """Son estados distintos: la vencida tiene su propia alarma, más fuerte."""
        r = self._renta('dia', 1, entrega_hace_horas=30)
        self.assertTrue(r.vencida)
        self.assertFalse(r.por_vencer)


class EntregaTardia(TestCase):
    """El cliente paga días de USO: si sale tarde, la recolección se recorre."""

    def _guardada(self, dias_tarde):
        from inventario.models import Inventario, Equipo
        eq = Equipo.objects.create(modelo='RETRO-1', precio_dia=1000)
        inv = Inventario.objects.create(equipo=eq, codigo=f'RET-{dias_tarde}', estado='disponible')
        r = Renta.objects.create(
            inventario=inv, cliente_texto='Cliente', telefono_cliente='7441772370',
            direccion='Obra', modalidad='dia', duracion=1,
            fecha_inicio=timezone.localdate() - timedelta(days=dias_tarde),
            estado='activa',
        )
        return r

    def test_entregada_un_dia_tarde_corre_la_recoleccion(self):
        r = self._guardada(dias_tarde=1)
        pactado = r.fecha_fin
        r.entregada_en = timezone.now()
        choque = r.correr_fin_por_entrega()
        r.refresh_from_db()
        self.assertEqual(r.fecha_inicio, timezone.localdate())
        self.assertEqual(r.fecha_fin, timezone.localdate() + timedelta(days=1))
        self.assertGreater(r.fecha_fin, pactado)   # ANTES: nacía ya vencida
        self.assertIsNone(choque)
        self.assertFalse(r.vencida)

    def test_entregada_a_tiempo_no_mueve_nada(self):
        r = self._guardada(dias_tarde=0)
        pactado = (r.fecha_inicio, r.fecha_fin)
        r.entregada_en = timezone.now()
        self.assertIsNone(r.correr_fin_por_entrega())
        r.refresh_from_db()
        self.assertEqual((r.fecha_inicio, r.fecha_fin), pactado)

    def test_el_traslape_se_avisa_pero_NO_frena_la_entrega(self):
        """La máquina ya está en la obra: eso pasó en el mundo real."""
        r = self._guardada(dias_tarde=2)
        # `bulk_create` salta `save()`: la reserva de otro cliente sobre esa
        # misma unidad es justo lo que la validación impide crear, y aquí hace
        # falta tenerla para comprobar que la entrega NO se frena por ella.
        otra = Renta.objects.bulk_create([Renta(
            inventario=r.inventario, cliente_texto='Otro',
            telefono_cliente='7441772371', direccion='Otra obra',
            modalidad='dia', duracion=1, total=1000, subtotal=1000,
            fecha_inicio=timezone.localdate(), fecha_fin=timezone.localdate() + timedelta(days=2),
            estado='reservada',
        )])
        # MySQL no rellena los PK en bulk_create; se recupera por su cliente.
        otra = Renta.objects.get(cliente_texto='Otro')
        r.entregada_en = timezone.now()
        choque = r.correr_fin_por_entrega()
        r.refresh_from_db()
        self.assertEqual(r.fecha_fin, timezone.localdate() + timedelta(days=1))  # se guardó igual
        self.assertEqual(choque.pk, otra.pk)                                      # y se reporta


class TopeDeRentasPorCotizacion(TestCase):
    """Una cotización de dos equipos tiene que poder salir en DOS rentas.

    El candado decía "una cotización, una renta" —correcto mientras una
    cotización fuera una máquina—. Con dos equipos, el segundo se estrellaba
    contra él: la cotización pedía tres máquinas y el sistema dejaba salir una.
    """
    def setUp(self):
        from django.contrib.auth.models import User
        from inventario.models import Equipo, Inventario
        from cotizaciones.models import Cotizacion, CotizacionItem
        from rest_framework.test import APIClient

        self.eq_a = Equipo.objects.create(modelo='APISONADOR', precio_dia=900)
        self.eq_b = Equipo.objects.create(modelo='REVOLVEDORA', precio_dia=700)
        self.u_a = Inventario.objects.create(equipo=self.eq_a, codigo='API-01', estado='disponible')
        self.u_b = Inventario.objects.create(equipo=self.eq_b, codigo='REV-01', estado='disponible')
        self.cot = Cotizacion.objects.create(cliente_nombre='Josue', cliente_telefono='7441772370',
                                             estado='aceptada', tipo='renta', folio='COT-2026-0003')
        CotizacionItem.objects.create(cotizacion=self.cot, descripcion='Apisonador · renta por día',
                                      modalidad='dia', cantidad=1, duracion=1, equipo=self.eq_a, precio_unitario=900)
        CotizacionItem.objects.create(cotizacion=self.cot, descripcion='Revolvedora · renta por día',
                                      modalidad='dia', cantidad=1, duracion=1, equipo=self.eq_b, precio_unitario=700)
        admin = User.objects.create_user('opr', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient(); self.api.force_authenticate(admin)

    def _rentar(self, unidad):
        return self.api.post('/api/rentas/crear/', {
            'inventario_id': unidad.id, 'cliente': 'Josue', 'telefono_cliente': '7441772370',
            'direccion': 'Obra centro', 'modalidad': 'dia', 'duracion': 1,
            'cotizacion_id': self.cot.id,
        }, format='json')

    def test_las_dos_maquinas_de_la_cotizacion_pueden_salir(self):
        self.assertEqual(self._rentar(self.u_a).status_code, 201, 'la primera debe salir')
        r2 = self._rentar(self.u_b)
        self.assertIn(r2.status_code, (200, 201), f'la SEGUNDA también: {r2.data}')
        self.assertEqual(Renta.objects.filter(cotizacion=self.cot).exclude(estado='cancelada').count(), 2)

    def test_una_tercera_renta_sigue_rechazada(self):
        """El freno que sí importa: no colgar rentas de más de lo cotizado."""
        from inventario.models import Inventario
        self._rentar(self.u_a); self._rentar(self.u_b)
        extra = Inventario.objects.create(equipo=self.eq_a, codigo='API-02', estado='disponible')
        r3 = self._rentar(extra)
        self.assertEqual(r3.status_code, 409)
        self.assertEqual(r3.data['codigo'], 'ya_concretada')
        self.assertIn('completa', r3.data['detalle'])
