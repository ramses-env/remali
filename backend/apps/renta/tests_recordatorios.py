"""Recordatorios de devolución: lo que sustituyó al recargo por retraso.

REMALI no cobra por tardarse. Así que lo que trae la máquina de vuelta no es un
cargo —que solo infla una deuda incobrable— sino insistir a tiempo. Aquí se
prueban las dos mitades: el aviso dentro de la app (para quien tiene cuenta) y
la lista del panel (para el resto, que es la mayoría).
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo, Notificacion
from renta.models import Renta
from renta.management.commands.recordar_rentas import clave_recordatorio


class CalendarioDeRecordatoriosTest(TestCase):
    """El calendario, sin base de datos de por medio."""

    def test_avisa_la_vispera_y_el_dia(self):
        self.assertEqual(clave_recordatorio(1), 'previo')
        self.assertEqual(clave_recordatorio(0), 'hoy')

    def test_no_avisa_con_la_renta_en_curso(self):
        for dias in (2, 3, 7, 30):
            self.assertIsNone(clave_recordatorio(dias), dias)

    def test_insiste_cada_dos_dias_de_retraso(self):
        self.assertEqual(clave_recordatorio(-2), 'retraso-2')
        self.assertEqual(clave_recordatorio(-4), 'retraso-4')
        self.assertEqual(clave_recordatorio(-10), 'retraso-10')

    def test_el_dia_siguiente_se_salta(self):
        """Avisar el día que vence y otra vez al siguiente se lee como regaño,
        y enseña a ignorar la campana."""
        self.assertIsNone(clave_recordatorio(-1))
        self.assertIsNone(clave_recordatorio(-3))


class RecordatoriosAlClienteTest(TestCase):

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.cliente = User.objects.create_user('clienta', 'c@x.com', 'pass12345')
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        self.hoy = timezone.localdate()

    def _renta(self, vence_en_dias, con_cuenta=True):
        unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        return Renta.objects.create(
            inventario=unidad, modalidad='dia', duracion=3, estado='activa',
            cliente_texto='Obra Norte', telefono_cliente='6141234567',
            direccion='Calle 5',
            # El inicio se aleja lo suficiente para que un vencimiento muy
            # atrasado no quede ANTES del inicio (el modelo lo rechaza).
            fecha_inicio=self.hoy - timedelta(days=abs(vence_en_dias) + 3),
            fecha_fin=self.hoy + timedelta(days=vence_en_dias),
            usuario=self.cliente if con_cuenta else None,
        )

    def _avisos(self, r):
        return Notificacion.objects.filter(ref__startswith=f'recordatorio-renta-{r.id}')

    def test_le_avisa_la_vispera(self):
        r = self._renta(1)
        call_command('recordar_rentas')
        aviso = self._avisos(r).first()
        self.assertIsNotNone(aviso)
        self.assertEqual(aviso.titulo, 'Tu renta vence mañana')
        self.assertEqual(aviso.usuario_id, self.cliente.id)   # PERSONAL, no broadcast
        self.assertEqual(aviso.seccion, 'mis-rentas')

    def test_le_avisa_el_dia_que_vence(self):
        r = self._renta(0)
        call_command('recordar_rentas')
        self.assertEqual(self._avisos(r).first().titulo, 'Tu renta vence hoy')

    def test_le_insiste_estando_vencida(self):
        r = self._renta(-4)
        call_command('recordar_rentas')
        aviso = self._avisos(r).first()
        self.assertEqual(aviso.titulo, 'Tu renta ya venció')
        self.assertIn('4 días', aviso.mensaje)

    def test_correr_el_cron_dos_veces_no_manda_el_aviso_doble(self):
        """Un reintento o un redeploy no puede duplicar la campana."""
        r = self._renta(0)
        call_command('recordar_rentas')
        call_command('recordar_rentas')
        self.assertEqual(self._avisos(r).count(), 1)

    def test_una_renta_en_curso_no_molesta_a_nadie(self):
        r = self._renta(5)
        call_command('recordar_rentas')
        self.assertEqual(self._avisos(r).count(), 0)

    def test_sin_cuenta_no_hay_a_donde_mandarlo(self):
        """Ese cliente lo atiende la lista del panel, con su teléfono."""
        r = self._renta(0, con_cuenta=False)
        call_command('recordar_rentas')
        self.assertEqual(self._avisos(r).count(), 0)

    def test_una_renta_ya_devuelta_deja_de_recordarse(self):
        r = self._renta(-4)
        r.estado = 'finalizada'
        r.save(update_fields=['estado'])
        call_command('recordar_rentas')
        self.assertEqual(self._avisos(r).count(), 0)

    def test_dry_run_no_crea_nada(self):
        r = self._renta(0)
        call_command('recordar_rentas', '--dry-run')
        self.assertEqual(self._avisos(r).count(), 0)


class ListaParaInsistirTest(TestCase):
    """`rentas/recordatorios/`: a quién hay que llamarle hoy."""

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.cliente = User.objects.create_user('clienta', 'c@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='MAR-20', precio_dia=Decimal('1000'))
        self.hoy = timezone.localdate()

    def _renta(self, vence_en_dias, cliente='Obra Norte', con_cuenta=False):
        unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        return Renta.objects.create(
            inventario=unidad, modalidad='dia', duracion=3, estado='activa',
            cliente_texto=cliente, telefono_cliente='6141234567', direccion='Calle 5',
            # El inicio se aleja lo suficiente para que un vencimiento muy
            # atrasado no quede ANTES del inicio (el modelo lo rechaza).
            fecha_inicio=self.hoy - timedelta(days=abs(vence_en_dias) + 3),
            fecha_fin=self.hoy + timedelta(days=vence_en_dias),
            usuario=self.cliente if con_cuenta else None,
        )

    def test_separa_vencidas_de_por_vencer(self):
        self._renta(-3)
        self._renta(0)
        self._renta(1)
        self._renta(9)              # en curso: no aparece
        r = self.client.get('/api/rentas/recordatorios/')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data['vencidas']), 1)
        self.assertEqual(len(r.data['por_vencer']), 2)
        self.assertEqual(r.data['total'], 3)

    def test_la_mas_atrasada_va_primero(self):
        self._renta(-1, cliente='Apenas ayer')
        self._renta(-9, cliente='Nueve dias')
        r = self.client.get('/api/rentas/recordatorios/')
        # El nombre viaja normalizado a mayúscula inicial (`nombre_propio`).
        self.assertEqual(r.data['vencidas'][0]['cliente'], 'Nueve Dias')
        self.assertEqual(r.data['vencidas'][0]['dias'], -9)

    def test_trae_el_telefono_para_poder_insistir(self):
        """Sin teléfono la lista no sirve para nada: es su razón de ser."""
        self._renta(-2)
        fila = self.client.get('/api/rentas/recordatorios/').data['vencidas'][0]
        self.assertEqual(fila['telefono'], '6141234567')
        self.assertEqual(fila['dias'], -2)
        self.assertFalse(fila['tiene_cuenta'])

    def test_distingue_a_quien_ya_recibio_aviso_en_la_app(self):
        """Para no gastar llamadas en quien ya está enterado."""
        self._renta(-2, con_cuenta=True)
        fila = self.client.get('/api/rentas/recordatorios/').data['vencidas'][0]
        self.assertTrue(fila['tiene_cuenta'])

    def test_una_renta_devuelta_sale_de_la_lista(self):
        r = self._renta(-5)
        r.estado = 'finalizada'
        r.save(update_fields=['estado'])
        self.assertEqual(self.client.get('/api/rentas/recordatorios/').data['total'], 0)
