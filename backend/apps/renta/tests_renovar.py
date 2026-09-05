"""Renovar una renta: "me la quedo otra semana".

El endpoint existía completo y NADIE lo llamaba — no había botón en el panel ni
una sola prueba. Estas son las primeras: mueve dinero (traslada el depósito y
cierra un periodo para abrir otro) y nunca había corrido.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Equipo, Inventario
from renta.models import Renta


class RenovarUnaRentaActiva(TestCase):
    """El cliente tiene la máquina en la obra y quiere más tiempo."""

    def setUp(self):
        self.eq = Equipo.objects.create(modelo='REVOLVEDORA', precio_dia=500,
                                        precio_semana=2800, precio_mes=9000)
        self.unidad = Inventario.objects.create(equipo=self.eq, codigo='REV-01',
                                                condicion='seminueva', estado='disponible')
        self.cliente = User.objects.create_user('josue', first_name='Josue')
        self.renta = Renta.objects.create(
            inventario=self.unidad, usuario=self.cliente, cliente_texto='Josue',
            telefono_cliente='7441772370', direccion='Obra centro',
            modalidad='dia', duracion=3, deposito=Decimal('1500'),
            fecha_inicio=timezone.localdate())
        admin = User.objects.create_user('op', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient(); self.api.force_authenticate(admin)

    def _renovar(self, **datos):
        cuerpo = {'modalidad': 'semana', 'duracion': 1}
        cuerpo.update(datos)
        return self.api.post(f'/api/rentas/{self.renta.id}/renovar/', cuerpo, format='json')

    def test_nace_un_periodo_nuevo_ligado_al_anterior(self):
        r = self._renovar()
        self.assertEqual(r.status_code, 201, r.data)
        nueva = Renta.objects.get(pk=r.data['renta']['id'])
        self.assertEqual(nueva.renta_origen_id, self.renta.id)
        self.assertEqual(r.data['origen_id'], self.renta.id)

    def test_el_periodo_anterior_se_cierra(self):
        self._renovar()
        self.renta.refresh_from_db()
        self.assertEqual(self.renta.estado, 'finalizada')
        self.assertIn('Renovada el', self.renta.observaciones)

    def test_la_unidad_sigue_ocupada_sin_pasar_por_bodega(self):
        """La máquina no se movió: está en la obra del cliente todo el tiempo."""
        self._renovar()
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'rentado')

    def test_el_deposito_se_TRASLADA_no_se_vuelve_a_pedir(self):
        r = self._renovar()
        self.renta.refresh_from_db()
        nueva = Renta.objects.get(pk=r.data['renta']['id'])
        self.assertEqual(self.renta.deposito_estado, 'a_favor')
        self.assertEqual(self.renta.deposito_reembolso, Decimal('1500.00'))
        self.assertIn('Trasladado', self.renta.deposito_nota)
        self.assertEqual(nueva.deposito, Decimal('1500.00'))

    def test_el_admin_puede_fijar_otro_deposito(self):
        r = self._renovar(deposito='2000')
        self.assertEqual(Renta.objects.get(pk=r.data['renta']['id']).deposito, Decimal('2000.00'))

    def test_cambia_de_modalidad_y_recalcula_el_total(self):
        """De días a semana: el precio sale del catálogo de la semana."""
        r = self._renovar(modalidad='semana', duracion=2)
        nueva = Renta.objects.get(pk=r.data['renta']['id'])
        self.assertEqual(nueva.modalidad, 'semana')
        self.assertEqual(nueva.duracion, 2)
        self.assertEqual(nueva.fecha_fin, nueva.fecha_inicio + timedelta(days=14))

    def test_tambien_por_mes(self):
        nueva = Renta.objects.get(pk=self._renovar(modalidad='mes', duracion=1).data['renta']['id'])
        self.assertEqual(nueva.fecha_fin, nueva.fecha_inicio + timedelta(days=30))

    def test_el_cliente_sigue_viendola_en_su_panel(self):
        nueva = Renta.objects.get(pk=self._renovar().data['renta']['id'])
        self.assertEqual(nueva.usuario, self.cliente)

    def test_hereda_obra_direccion_y_telefono(self):
        nueva = Renta.objects.get(pk=self._renovar().data['renta']['id'])
        self.assertEqual(nueva.direccion, 'Obra centro')
        self.assertEqual(nueva.telefono_cliente, '7441772370')

    def test_puede_cobrarse_un_abono_del_periodo_nuevo(self):
        r = self._renovar(pagos=[{'monto': '1000', 'metodo': 'efectivo'}])
        nueva = Renta.objects.get(pk=r.data['renta']['id'])
        self.assertEqual(len(nueva.pagos), 1)
        self.assertEqual(nueva.pagos[0]['metodo'], 'efectivo')

    def test_una_modalidad_inventada_se_rechaza(self):
        self.assertEqual(self._renovar(modalidad='quincena').status_code, 400)

    def test_una_renta_cancelada_no_se_renueva(self):
        self.renta.estado = 'cancelada'
        self.renta.save(update_fields=['estado'])
        r = self._renovar()
        self.assertEqual(r.status_code, 400)
        self.assertIn('cancelada', r.data['detalle'])

    def test_una_reserva_se_edita_no_se_renueva(self):
        """Todavía no empieza: renovar un periodo que no ocurrió no significa nada."""
        self.renta.estado = 'reservada'
        self.renta.save(update_fields=['estado'])
        self.assertEqual(self._renovar().status_code, 400)


class RevivirUnaRentaFinalizada(TestCase):
    """Volvió por la misma máquina semanas después."""

    def setUp(self):
        eq = Equipo.objects.create(modelo='APISONADOR', precio_dia=400)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='API-01',
                                                condicion='seminueva', estado='disponible')
        self.renta = Renta.objects.create(
            inventario=self.unidad, cliente_texto='Josue', telefono_cliente='7441772370',
            direccion='Obra', modalidad='dia', duracion=2, fecha_inicio=timezone.localdate())
        self.renta.finalizar()
        admin = User.objects.create_user('op2', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient(); self.api.force_authenticate(admin)

    def test_con_la_unidad_libre_se_revive(self):
        r = self.api.post(f'/api/rentas/{self.renta.id}/renovar/',
                          {'modalidad': 'dia', 'duracion': 2}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'rentado')

    def test_si_la_maquina_ya_se_la_llevo_otro_lo_dice(self):
        """Y lo dice con el motivo: 'no se pudo' a secas manda a adivinar."""
        self.unidad.estado = 'mantenimiento'
        self.unidad.save(update_fields=['estado'])
        r = self.api.post(f'/api/rentas/{self.renta.id}/renovar/',
                          {'modalidad': 'dia', 'duracion': 2}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('disponible', r.data['detalle'])

    def test_arrancar_a_futuro_queda_como_reserva(self):
        manana = (timezone.localdate() + timedelta(days=3)).isoformat()
        r = self.api.post(f'/api/rentas/{self.renta.id}/renovar/',
                          {'modalidad': 'dia', 'duracion': 2, 'fecha_inicio': manana}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Renta.objects.get(pk=r.data['renta']['id']).estado, 'reservada')
