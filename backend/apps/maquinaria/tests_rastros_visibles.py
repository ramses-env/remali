"""Rastro que se guarda y que además SE PUEDE LEER.

Cuatro acciones dejaban constancia de quién, cuándo y por qué… y ninguna salía
en una respuesta de la API. Para consultarlas había que entrar a la base de
datos. Un rastro que nadie puede leer no protege de nada — y la regla de la casa
es que las acciones sensibles se bloquean o dejan rastro.
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from cotizaciones.models import Cotizacion
from cotizaciones.serializers import CotizacionSerializer
from inventario.models import Equipo, Inventario
from inventario.serializers import InventarioSerializer
from maquinaria.models import Cupon, PerfilUsuario
from maquinaria.serializers import PerfilUsuarioSerializer


class AutorizarUnaMaquinaNuevaParaRenta(TestCase):
    """Sacar una máquina NUEVA a renta es una excepción que alguien decidió."""

    def setUp(self):
        self.jefe = User.objects.create_user('carol', first_name='Carol', last_name='Ruiz')
        eq = Equipo.objects.create(modelo='RETRO-N', precio_dia=1500)
        self.unidad = Inventario.objects.create(equipo=eq, codigo='RET-N1',
                                                condicion='nueva', estado='disponible')

    def _datos(self):
        return InventarioSerializer(Inventario.objects.get(pk=self.unidad.pk)).data

    def test_sin_autorizar_no_hay_rastro_que_enseñar(self):
        self.assertIsNone(self._datos()['autorizacion_renta'])

    def test_al_autorizar_se_puede_leer_quien_cuando_y_por_que(self):
        self.unidad.autorizar_para_renta(usuario=self.jefe, motivo='Sustitución: se dañó la seminueva')
        rastro = self._datos()['autorizacion_renta']
        self.assertIsNotNone(rastro, 'se guardaba y no salía por ningún lado')
        self.assertEqual(rastro['por'], 'Carol Ruiz')
        self.assertIn('Sustitución', rastro['nota'])
        self.assertIsNotNone(rastro['en'])

    def test_una_autorizacion_vieja_sin_rastro_no_inventa_uno(self):
        """Decir "autorizada por nadie" sería inventar un dato que no existe."""
        Inventario.objects.filter(pk=self.unidad.pk).update(autorizada_para_renta=True)
        self.assertIsNone(self._datos()['autorizacion_renta'])


class CuandoAceptaronLaCotizacion(TestCase):
    def test_el_sello_de_aceptacion_sale_en_la_respuesta(self):
        """Sin él no se sabe si aceptaron antes o después de que venciera."""
        c = Cotizacion.objects.create(cliente_nombre='Josue', cliente_telefono='7441772370')
        self.assertIsNone(CotizacionSerializer(c).data['aceptada_en'])
        c.estado = 'aceptada'
        c.save()
        c.refresh_from_db()
        self.assertIsNotNone(CotizacionSerializer(c).data['aceptada_en'])


class CuandoSeGastoElCupon(TestCase):
    def test_la_fecha_de_uso_llega_al_perfil(self):
        """"Ya lo usaste" sin fecha es una afirmación sin respaldo."""
        u = User.objects.create_user('jazmin', first_name='Jazmin')
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=u)
        cupon = Cupon.objects.create(codigo='BIENV-TEST1', descuento='0.05',
                                     motivo='perfil', usuario=u)
        cupon.usado = True
        cupon.usado_en = timezone.now() - timedelta(days=3)
        cupon.save(update_fields=['usado', 'usado_en'])

        datos = PerfilUsuarioSerializer(perfil).data['cupon']
        self.assertTrue(datos['usado'])
        self.assertIsNotNone(datos['usado_en'])
