"""El 5% por completar el perfil: que exista de verdad.

La promesa estaba en pantalla desde el principio —"Todo listo, tu 5% te
espera"—, el serializer lo buscaba y el modelo tenía hasta la bandera. Pero
nadie lo emitía: el cliente llenaba todo, veía el 100% y no había descuento.
"""
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase

from maquinaria.models import Cupon, Notificacion, PerfilUsuario


class CuponAlCompletarElPerfil(TestCase):
    def _perfil(self, nombre='Jazmin', telefono='7441772370'):
        u = User.objects.create_user('jazmin', email='jazmin@correo.com', first_name=nombre)
        p, _ = PerfilUsuario.objects.get_or_create(usuario=u)
        p.telefono = telefono
        p.save()
        p.refresh_from_db()
        return u, p

    def _cupones(self, u):
        return Cupon.objects.filter(usuario=u, motivo='perfil')

    def test_con_nombre_y_telefono_nace_el_cupon(self):
        u, p = self._perfil()
        self.assertEqual(self._cupones(u).count(), 1)
        self.assertTrue(p.recompensado)

    def test_el_descuento_es_del_5_por_ciento(self):
        u, _ = self._perfil()
        self.assertEqual(str(self._cupones(u).first().descuento), '0.05')

    def test_el_codigo_evita_las_letras_que_se_confunden(self):
        """Lo teclea el cliente mirando su pantalla: I/O/0/1 se confunden."""
        u, _ = self._perfil()
        sufijo = self._cupones(u).first().codigo.replace('BIENV-', '')
        self.assertFalse(set(sufijo) & set('IO01'), sufijo)

    def test_sin_telefono_todavia_no_hay_cupon(self):
        u, _ = self._perfil(telefono='')
        self.assertEqual(self._cupones(u).count(), 0)

    def test_un_telefono_a_medias_tampoco_cuenta(self):
        u, _ = self._perfil(telefono='744177')
        self.assertEqual(self._cupones(u).count(), 0)

    def test_sin_nombre_tampoco(self):
        u, _ = self._perfil(nombre='', telefono='7441772370')
        self.assertEqual(self._cupones(u).count(), 0)

    def test_al_completarlo_despues_se_emite(self):
        """Entra sin teléfono, luego lo agrega: ahí gana su cupón."""
        u, p = self._perfil(telefono='')
        p.telefono = '7441772370'
        p.save()
        self.assertEqual(self._cupones(u).count(), 1)

    def test_guardar_mil_veces_no_da_mil_cupones(self):
        u, p = self._perfil()
        for _ in range(3):
            p.telefono = '7441772371'
            p.save()
        self.assertEqual(self._cupones(u).count(), 1)

    def test_borrar_el_telefono_y_reponerlo_no_da_otro(self):
        """`recompensado` es el candado de una sola vez."""
        u, p = self._perfil()
        p.telefono = ''
        p.save()
        p.telefono = '7441772370'
        p.save()
        self.assertEqual(self._cupones(u).count(), 1)

    def test_se_le_avisa_al_cliente(self):
        u, _ = self._perfil()
        aviso = Notificacion.objects.filter(ref=f'cupon-perfil-{u.id}').first()
        self.assertIsNotNone(aviso)
        self.assertIn(self._cupones(u).first().codigo, aviso.mensaje)


class RezagadosDelCupon(TestCase):
    """Quienes completaron su perfil antes de que existiera este código."""

    def setUp(self):
        self.u = User.objects.create_user('jazmin2', email='j2@correo.com', first_name='Jazmin')
        p, _ = PerfilUsuario.objects.get_or_create(usuario=self.u)
        # Como quedaron en la base: perfil completo y sin recompensa.
        PerfilUsuario.objects.filter(pk=p.pk).update(telefono='7441772370', recompensado=False)
        Cupon.objects.filter(usuario=self.u).delete()

    def test_sin_aplicar_solo_los_lista(self):
        call_command('emitir_cupones_pendientes')
        self.assertEqual(Cupon.objects.filter(usuario=self.u).count(), 0)

    def test_con_aplicar_les_emite_el_suyo(self):
        call_command('emitir_cupones_pendientes', '--aplicar')
        self.assertEqual(Cupon.objects.filter(usuario=self.u, motivo='perfil').count(), 1)

    def test_correrlo_dos_veces_no_duplica(self):
        call_command('emitir_cupones_pendientes', '--aplicar')
        call_command('emitir_cupones_pendientes', '--aplicar')
        self.assertEqual(Cupon.objects.filter(usuario=self.u, motivo='perfil').count(), 1)
