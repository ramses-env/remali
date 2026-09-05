"""El saludo al cliente nuevo sale una vez, por cualquiera de los caminos de alta.

`captureOnCommitCallbacks` en todos lados a propósito: el envío está colgado de
`transaction.on_commit` (ver correo_bienvenida) y dentro de un TestCase la
transacción se revierte, así que sin esto los callbacks nunca corren y las
pruebas dirían que no se manda nada.
"""
import os
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from maquinaria.correo_bienvenida import enviar_si_toca, toca_bienvenida
from maquinaria.models import PerfilUsuario

User = get_user_model()

RUTA = 'maquinaria.correo.enviar_plantilla_brevo'


def cliente(correo='ana@correo.com', nombre='Ana'):
    u = User.objects.create_user(username=correo.split('@')[0], email=correo,
                                 password='Contrasena.1', first_name=nombre)
    u.groups.add(Group.objects.get_or_create(name='Cliente')[0])
    # El perfil no nace solo: lo crean las vistas con get_or_create.
    PerfilUsuario.objects.get_or_create(usuario=u)
    return u


class BaseBienvenida(TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'BREVO_BIENVENIDA_TEMPLATE_ID': '8'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def guardar(self, perfil, **campos):
        """Guarda el perfil y deja correr los callbacks de on_commit."""
        with self.captureOnCommitCallbacks(execute=True):
            for k, v in campos.items():
                setattr(perfil, k, v)
            perfil.save()

    def verificar(self, perfil):
        self.guardar(perfil, email_verificado=True, email_verificado_en=timezone.now())


class BienvenidaTests(BaseBienvenida):
    def test_no_se_manda_antes_de_confirmar_el_correo(self):
        u = cliente()
        perfil = PerfilUsuario.objects.get(usuario=u)
        self.assertFalse(toca_bienvenida(perfil))
        with patch(RUTA, return_value=True) as env:
            enviar_si_toca(perfil)
        env.assert_not_called()

    def test_se_manda_al_confirmar_el_correo(self):
        u = cliente()
        perfil = PerfilUsuario.objects.get(usuario=u)
        with patch(RUTA, return_value=True) as env:
            self.verificar(perfil)
        env.assert_called_once()
        plantilla, correo, nombre, params = env.call_args[0]
        self.assertEqual(plantilla, '8')
        self.assertEqual(correo, 'ana@correo.com')
        self.assertEqual(nombre, 'Ana')
        self.assertEqual(params['nombre'], 'Ana')
        self.assertTrue(PerfilUsuario.objects.get(usuario=u).bienvenida_enviada)

    def test_no_se_repite_aunque_el_perfil_se_guarde_otra_vez(self):
        u = cliente()
        perfil = PerfilUsuario.objects.get(usuario=u)
        with patch(RUTA, return_value=True) as env:
            self.verificar(perfil)
            self.guardar(perfil, telefono='7441234567')
            self.guardar(perfil)
        self.assertEqual(env.call_count, 1)

    def test_el_equipo_no_recibe_bienvenida(self):
        u = User.objects.create_user(username='jefa', email='jefa@remali.mx',
                                     password='Contrasena.1', is_staff=True)
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=u)
        with patch(RUTA, return_value=True) as env:
            self.verificar(perfil)
        env.assert_not_called()

    def test_sin_plantilla_no_se_manda_nada(self):
        u = cliente()
        perfil = PerfilUsuario.objects.get(usuario=u)
        with patch.dict(os.environ, {'BREVO_BIENVENIDA_TEMPLATE_ID': ''}):
            with patch(RUTA, return_value=True) as env:
                self.verificar(perfil)
            env.assert_not_called()
        # Y la bandera NO se quema: cuando haya plantilla, el saludo sale.
        self.assertFalse(PerfilUsuario.objects.get(usuario=u).bienvenida_enviada)

    def test_si_brevo_rechaza_la_bandera_no_se_marca(self):
        u = cliente()
        perfil = PerfilUsuario.objects.get(usuario=u)
        with patch(RUTA, return_value=False):
            self.verificar(perfil)
        self.assertFalse(PerfilUsuario.objects.get(usuario=u).bienvenida_enviada)


class BienvenidaPorLasVistasTests(BaseBienvenida):
    """El camino real: registrarse y luego confirmar el correo."""

    def test_registro_no_saluda_hasta_confirmar(self):
        with patch(RUTA, return_value=True) as env:
            with self.captureOnCommitCallbacks(execute=True):
                r = self.client.post('/api/auth/registro/', {
                    'email': 'nuevo@correo.com', 'password': 'Contrasena.1',
                    'nombre': 'Rosa', 'telefono': '7441234567',
                }, content_type='application/json', secure=True)
        self.assertEqual(r.status_code, 201, r.content)
        env.assert_not_called()

        perfil = PerfilUsuario.objects.get(usuario__email='nuevo@correo.com')
        with patch(RUTA, return_value=True) as env:
            self.verificar(perfil)
        env.assert_called_once()
        self.assertEqual(env.call_args[0][1], 'nuevo@correo.com')
