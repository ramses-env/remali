"""El 5% de bienvenida se puede RECLAMAR.

Existía la promesa, existía el cupón, existía hasta el campo `Cotizacion.cupon`
que le restaba el descuento al total… y no había dónde teclear el código: el
armador no lo mandaba y la vista pública no lo leía. Estas pruebas cubren el
eslabón que faltaba, de punta a punta.
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase

from cotizaciones.models import Cotizacion
from maquinaria.models import Cupon, Equipo, PerfilUsuario


class CuponEnCotizacion(APITestCase):
    def setUp(self):
        self.eq = Equipo.objects.create(modelo='ROTO-100', precio_venta=Decimal('10000'),
                                        precio_dia=Decimal('500'))
        self.user = User.objects.create_user('cliente', 'cliente@x.com', 'x', first_name='Ana')
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.user)
        perfil.telefono = '5512345678'
        perfil.save()          # ← dispara la señal que emite el cupón

    def _enviar(self, codigo='', unit='venta'):
        return self.client.post('/api/tienda/cotizacion/', {
            'items': [{'equipo_id': self.eq.id, 'cantidad': 1, 'duracion': 1, 'unit': unit}],
            'cliente': {'nombre': 'Ana', 'telefono': '5512345678', 'email': 'cliente@x.com'},
            'obra': {'direccion': 'Calle 1'},
            'codigo_cupon': codigo,
        }, format='json')

    def test_completar_el_perfil_emite_el_cupon(self):
        self.assertTrue(Cupon.objects.filter(usuario=self.user, motivo='perfil').exists())

    def test_el_codigo_baja_el_total(self):
        cupon = Cupon.objects.get(usuario=self.user, motivo='perfil')
        self.client.force_authenticate(self.user)
        r = self._enviar(cupon.codigo)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['cupon_aplicado'], cupon.codigo)
        cot = Cotizacion.objects.get(pk=r.data['id'])
        self.assertEqual(cot.cupon_id, cupon.id)
        self.assertEqual(cot.descuento_cupon, Decimal('500.00'))   # 5% de 10,000
        self.assertEqual(cot.total, Decimal('9500.00'))

    def test_de_un_solo_uso(self):
        """La segunda cotización con el mismo código ya no lleva descuento."""
        cupon = Cupon.objects.get(usuario=self.user, motivo='perfil')
        self.client.force_authenticate(self.user)
        self._enviar(cupon.codigo)
        cupon.refresh_from_db()
        self.assertTrue(cupon.usado)
        r = self._enviar(cupon.codigo)
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.data['cupon_aplicado'])
        self.assertEqual(Cotizacion.objects.get(pk=r.data['id']).total, Decimal('10000.00'))

    def test_el_cupon_personal_es_de_su_dueno(self):
        """Otro cliente con el código en la mano no puede gastarlo."""
        cupon = Cupon.objects.get(usuario=self.user, motivo='perfil')
        otro = User.objects.create_user('otro', 'otro@x.com', 'x')
        self.client.force_authenticate(otro)
        r = self._enviar(cupon.codigo)
        self.assertEqual(r.status_code, 201)          # la solicitud NO se pierde
        self.assertIsNone(r.data['cupon_aplicado'])
        self.assertEqual(r.data['cupon_error'], 'Cupón inválido.')
        cupon.refresh_from_db()
        self.assertFalse(cupon.usado)

    def test_un_codigo_mal_escrito_no_tumba_la_solicitud(self):
        self.client.force_authenticate(self.user)
        r = self._enviar('NOEXISTE')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['cupon_error'], 'Cupón inválido.')
        self.assertEqual(Cotizacion.objects.get(pk=r.data['id']).total, Decimal('10000.00'))

    def test_el_perfil_lo_publica_en_auth_me(self):
        """El armador lo ofrece de un toque porque /auth/me/ ya lo trae."""
        self.client.force_authenticate(self.user)
        r = self.client.get('/api/auth/me/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['cupon']['codigo'],
                         Cupon.objects.get(usuario=self.user, motivo='perfil').codigo)
        self.assertFalse(r.data['cupon']['usado'])


class CuponAlConvertir(APITestCase):
    """El descuento tiene que llegar a la VENTA, no quedarse en la hoja."""

    def setUp(self):
        from maquinaria.models import Cupon as C
        self.eq = Equipo.objects.create(modelo='ROTO-100', precio_venta=Decimal('10000'))
        self.user = User.objects.create_user('cliente', 'c@x.com', 'x', first_name='Ana')
        p, _ = PerfilUsuario.objects.get_or_create(usuario=self.user)
        p.telefono = '5512345678'
        p.save()
        self.cupon = C.objects.get(usuario=self.user, motivo='perfil')
        self.admin = User.objects.create_superuser('jefe', 'j@x.com', 'x')

    def test_la_venta_cobra_el_precio_con_descuento(self):
        self.client.force_authenticate(self.user)
        r = self.client.post('/api/tienda/cotizacion/', {
            'items': [{'equipo_id': self.eq.id, 'cantidad': 1, 'duracion': 1, 'unit': 'venta'}],
            'cliente': {'nombre': 'Ana', 'telefono': '5512345678', 'email': 'c@x.com'},
            'obra': {'direccion': 'Calle 1'},
            'codigo_cupon': self.cupon.codigo,
        }, format='json')
        cot = Cotizacion.objects.get(pk=r.data['id'])
        self.assertEqual(cot.total, Decimal('9500.00'))

        Cotizacion.objects.filter(pk=cot.id).update(estado='aceptada')
        self.client.force_authenticate(self.admin)
        rv = self.client.post(f'/api/cotizaciones/{cot.id}/convertir/',
                              {'metodo_pago': 'efectivo'}, format='json')
        self.assertEqual(rv.status_code, 201, rv.data)
        from ventas.models import Venta
        venta = Venta.objects.get(pk=rv.data['venta_id'])
        self.assertEqual(venta.precio_maquina, Decimal('9500.00'))


class VigenciaDelCupon(APITestCase):
    """El 5% de bienvenida dura 3 meses."""

    def setUp(self):
        self.eq = Equipo.objects.create(modelo='ROTO-100', precio_venta=Decimal('10000'))
        self.user = User.objects.create_user('cliente', 'c@x.com', 'x', first_name='Ana')
        p, _ = PerfilUsuario.objects.get_or_create(usuario=self.user)
        p.telefono = '5512345678'
        p.save()
        self.cupon = Cupon.objects.get(usuario=self.user, motivo='perfil')

    def _enviar(self, codigo):
        return self.client.post('/api/tienda/cotizacion/', {
            'items': [{'equipo_id': self.eq.id, 'cantidad': 1, 'duracion': 1, 'unit': 'venta'}],
            'cliente': {'nombre': 'Ana', 'telefono': '5512345678', 'email': 'c@x.com'},
            'obra': {'direccion': 'Calle 1'},
            'codigo_cupon': codigo,
        }, format='json')

    def test_nace_con_fecha_a_tres_meses(self):
        from django.utils import timezone
        from server.periodos import mas_meses
        self.assertIsNotNone(self.cupon.expira)
        esperado = mas_meses(timezone.now(), 3)
        self.assertLess(abs((self.cupon.expira - esperado).total_seconds()), 120)
        self.assertFalse(self.cupon.vencido)

    def test_vencido_no_se_aplica_y_dice_cuando(self):
        from django.utils import timezone
        self.cupon.expira = timezone.now() - timezone.timedelta(days=1)
        self.cupon.save(update_fields=['expira'])
        self.client.force_authenticate(self.user)
        r = self.client.post('/api/cupones/aplicar/', {'code': self.cupon.codigo}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('venció el', r.data['detail'])

    def test_vencido_tampoco_entra_por_la_cotizacion(self):
        from django.utils import timezone
        self.cupon.expira = timezone.now() - timezone.timedelta(days=1)
        self.cupon.save(update_fields=['expira'])
        self.client.force_authenticate(self.user)
        r = self._enviar(self.cupon.codigo)
        self.assertEqual(r.status_code, 201)          # la solicitud NO se pierde
        self.assertIsNone(r.data['cupon_aplicado'])
        self.assertIn('venció', r.data['cupon_error'])
        self.assertEqual(Cotizacion.objects.get(pk=r.data['id']).total, Decimal('10000.00'))

    def test_lo_que_ya_se_aplico_no_se_le_quita_al_vencer(self):
        """Vence DESPUÉS de cotizar: la cotización conserva su descuento."""
        from django.utils import timezone
        self.client.force_authenticate(self.user)
        r = self._enviar(self.cupon.codigo)
        cot = Cotizacion.objects.get(pk=r.data['id'])
        self.assertEqual(cot.total, Decimal('9500.00'))
        self.cupon.expira = timezone.now() - timezone.timedelta(days=1)
        self.cupon.save(update_fields=['expira'])
        cot.refresh_from_db()
        self.assertEqual(cot.total, Decimal('9500.00'))

    def test_el_generico_del_admin_no_vence_solo(self):
        c = Cupon.objects.create(codigo='VERANO2026', descuento=Decimal('0.10'), activo=True)
        self.assertIsNone(c.expira)
        self.assertFalse(c.vencido)

    def test_la_fecha_viaja_al_perfil(self):
        self.client.force_authenticate(self.user)
        r = self.client.get('/api/auth/me/')
        self.assertIsNotNone(r.data['cupon']['expira'])
        self.assertFalse(r.data['cupon']['vencido'])
