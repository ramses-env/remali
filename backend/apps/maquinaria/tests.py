from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from maquinaria.models import Equipo, PerfilUsuario
from inventario.models import Inventario


class EquipoPrecioTest(TestCase):
    def setUp(self):
        self.equipo = Equipo.objects.create(
            modelo='CMP-50',
            precio_dia=Decimal('100'),
            precio_semana=Decimal('600'),
            precio_mes=Decimal('2000'),
        )

    def test_get_precio_por_unidad(self):
        self.assertEqual(self.equipo.get_precio_por_unidad('dia'), Decimal('100'))
        self.assertEqual(self.equipo.get_precio_por_unidad('semana'), Decimal('600'))
        self.assertEqual(self.equipo.get_precio_por_unidad('mes'), Decimal('2000'))
        self.assertIsNone(self.equipo.get_precio_por_unidad('inexistente'))

    def test_estado_resumen_sin_unidades(self):
        self.assertEqual(self.equipo.estado_resumen, 'Sin stock')


class EquipoCatalogoInventarioTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.mixto = Equipo.objects.create(
            modelo='APS-200',
            precio_venta=Decimal('24500'),
            precio_dia=Decimal('850'),
        )
        Inventario.objects.create(equipo=self.mixto, condicion='nueva', estado='disponible')
        Inventario.objects.create(equipo=self.mixto, condicion='seminueva', estado='disponible')

        self.solo_renta = Equipo.objects.create(
            modelo='ROD-90',
            precio_dia=Decimal('650'),
        )
        Inventario.objects.create(equipo=self.solo_renta, condicion='seminueva', estado='disponible')

    def test_helpers_de_catalogo_salen_del_inventario(self):
        self.assertEqual(self.mixto.condiciones_catalogo, ['nueva', 'seminueva'])
        self.assertEqual(self.mixto.modos_catalogo, ['venta', 'renta'])
        self.assertTrue(self.mixto.ofrece_venta_catalogo)
        self.assertTrue(self.mixto.ofrece_renta_catalogo)
        self.assertTrue(self.mixto.venta_disponible_catalogo)
        self.assertTrue(self.mixto.renta_disponible_catalogo)

    def test_filtro_publico_venta_sale_por_precio_de_venta(self):
        resp = self.client.get('/api/equipos/?uso=venta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertNotIn('ROD-90', modelos)

    def test_filtro_publico_renta_exige_tarifa_y_unidad_seminueva(self):
        resp = self.client.get('/api/equipos/?uso=renta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertIn('ROD-90', modelos)


class VerificarCorreoTest(TestCase):
    """La liga del correo confirma la cuenta Y abre sesión.

    Se prueba aquí porque es la única puerta del sistema que no pide contraseña:
    lo que la sostiene es que el token sea de un solo uso y caduque.
    """

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username='cliente', email='cliente@ejemplo.com', password='Contra5egura!',
            first_name='Ramsés',
        )
        self.perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.user)
        self.perfil.email_token = 'tok-bueno'
        self.perfil.email_token_creado = timezone.now()
        self.perfil.save()

    def test_liga_valida_verifica_y_devuelve_sesion(self):
        resp = self.client.post('/api/auth/verificar-correo/', {'token': 'tok-bueno'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get('access'))
        self.assertEqual(resp.data.get('nombre'), 'Ramsés')
        self.perfil.refresh_from_db()
        self.assertTrue(self.perfil.email_verificado)
        self.assertEqual(self.perfil.email_token, '')

    def test_liga_reusada_ya_no_sirve(self):
        self.client.post('/api/auth/verificar-correo/', {'token': 'tok-bueno'}, format='json')
        resp = self.client.post('/api/auth/verificar-correo/', {'token': 'tok-bueno'}, format='json')
        self.assertEqual(resp.status_code, 404, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'invalido')

    def test_liga_vencida_no_abre_sesion(self):
        self.perfil.email_token_creado = timezone.now() - timedelta(hours=49)
        self.perfil.save(update_fields=['email_token_creado'])
        resp = self.client.post('/api/auth/verificar-correo/', {'token': 'tok-bueno'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'vencido')
        self.perfil.refresh_from_db()
        # Ni verifica ni quema el token: la liga vencida no cambia nada, así el
        # usuario puede pedir una nueva sin quedarse con la cuenta a medias.
        self.assertFalse(self.perfil.email_verificado)
        self.assertEqual(self.perfil.email_token, 'tok-bueno')
