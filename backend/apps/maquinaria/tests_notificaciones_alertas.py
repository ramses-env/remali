"""El buzón de notificaciones no se cae por generar sus alertas.

Leer las notificaciones dispara, de paso, la generación de alertas de rentas
vencidas o por vencer. Ese efecto secundario tumbó el buzón entero: la alerta
armaba su mensaje con `renta.folio`, un campo que la renta no tiene, así que
`/api/notificaciones/` respondía 500 en cada consulta. La campana quedó vacía
para todos y ni siquiera se veía un aviso de error, porque el panel sondea ese
endpoint en segundo plano y los errores de fondo no levantan bandera.

Se prueban las dos mitades: que la alerta se arme bien con los datos que la
renta SÍ tiene, y que una renta con datos incompletos no vuelva a llevarse el
buzón entre las patas.
"""

import datetime as _dt
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventario.models import Inventario
from maquinaria.models import Equipo, crear_notificacion
from renta.models import Renta


class AlertasDeVencimientoTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@remali.mx', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.equipo = Equipo.objects.create(modelo='Cortadora 14', precio_dia=Decimal('700'))
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='seminueva')
        self.hoy = timezone.localdate()

    def _renta_activa(self, dias_para_vencer):
        """Renta en curso que termina dentro de N días (negativo = ya vencida)."""
        renta = Renta.objects.create(
            inventario=self.unidad,
            cliente_texto='Constructora del Sur',
            telefono_cliente='7441234567',
            modalidad='dia',
            duracion=3,
            direccion='Av. Costera 120, Acapulco',
            fecha_inicio=self.hoy - _dt.timedelta(days=3),
            estado='activa',
        )
        # La fecha de fin se calcula sola al guardar; aquí se fuerza para poner
        # la renta justo en el borde que interesa probar.
        Renta.objects.filter(pk=renta.pk).update(
            fecha_fin=self.hoy + _dt.timedelta(days=dias_para_vencer),
            estado='activa',
        )
        renta.refresh_from_db()
        return renta

    def test_el_buzon_responde_con_una_renta_por_vencer(self):
        self._renta_activa(dias_para_vencer=1)
        r = self.client.get('/api/notificaciones/')
        self.assertEqual(r.status_code, 200)
        titulos = [n['titulo'] for n in r.data['notificaciones']]
        self.assertTrue(any('por vencer' in t for t in titulos), titulos)

    def test_la_alerta_identifica_la_unidad_no_un_folio_inexistente(self):
        self._renta_activa(dias_para_vencer=-2)
        r = self.client.get('/api/notificaciones/')
        self.assertEqual(r.status_code, 200)
        alerta = next(n for n in r.data['notificaciones'] if 'vencida' in n['titulo'])
        # La renta no tiene folio: se nombra por el código de la unidad, y trae
        # el id para que el panel pueda abrirla desde la notificación.
        self.assertIn(self.unidad.codigo, alerta['mensaje'])
        self.assertNotIn('None', alerta['mensaje'])
        self.assertEqual(alerta['data']['renta_id'], self._renta_id())

    def _renta_id(self):
        return Renta.objects.get().id

    def test_si_la_alerta_truena_el_buzon_sigue_abriendo(self):
        """El caso que rompió esto en producción, en su forma general.

        Da igual cuál sea el error al armar la alerta: leer el buzón no puede
        depender de poder escribir en él. Las notificaciones que ya existían
        tienen que seguir llegando.
        """
        self._renta_activa(dias_para_vencer=-1)
        crear_notificacion('sistema', 'Aviso previo', 'Ya estaba aquí', seccion='rentas')

        def truena(*a, **k):
            raise AttributeError("'Renta' object has no attribute 'folio'")

        with mock.patch('maquinaria.views.crear_notificacion', side_effect=truena):
            r = self.client.get('/api/notificaciones/')

        self.assertEqual(r.status_code, 200)
        titulos = [n['titulo'] for n in r.data['notificaciones']]
        self.assertIn('Aviso previo', titulos)

    def test_no_duplica_la_alerta_al_consultar_dos_veces(self):
        self._renta_activa(dias_para_vencer=-1)
        self.client.get('/api/notificaciones/')
        r = self.client.get('/api/notificaciones/')
        vencidas = [n for n in r.data['notificaciones'] if 'vencida' in n['titulo']]
        self.assertEqual(len(vencidas), 1)
