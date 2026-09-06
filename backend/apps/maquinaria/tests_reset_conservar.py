"""`--conservar` deja UNA cuenta y borra las demás — o no borra nada.

Quedarse sin la cuenta del dueño no se deshace, así que la resolución del
nombre falla en ruidoso (cero o varias coincidencias) en vez de adivinar.
"""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

User = get_user_model()


def cuenta(usuario, nombre='', apellido='', correo=''):
    return User.objects.create_user(username=usuario, email=correo or f'{usuario}@remali.mx',
                                    password='Contrasena.1', first_name=nombre, last_name=apellido)


class ConservarTests(TestCase):
    def setUp(self):
        self.merced = cuenta('merced', 'Merced', 'Mendoza', 'merced@remali.mx')
        cuenta('tecnico', 'Juan', 'Pérez')
        cuenta('cajera', 'Ana', 'Ruiz')

    def corre(self, *args):
        salida = StringIO()
        call_command('reset_datos_prueba', *args, stdout=salida, stderr=salida)
        return salida.getvalue()

    def test_por_nombre_completo(self):
        self.corre('--confirm', '--conservar', 'Merced Mendoza')
        self.assertEqual([u.username for u in User.objects.all()], ['merced'])

    def test_por_nombre_parcial(self):
        self.corre('--confirm', '--conservar', 'merced')
        self.assertEqual(User.objects.count(), 1)

    def test_por_correo(self):
        self.corre('--confirm', '--conservar', 'MERCED@remali.mx')
        self.assertEqual(User.objects.count(), 1)

    def test_sin_confirm_no_borra_a_nadie(self):
        salida = self.corre('--conservar', 'merced')
        self.assertEqual(User.objects.count(), 3)
        self.assertIn('simulación', salida)

    def test_si_no_existe_no_borra_nada(self):
        with self.assertRaises(CommandError):
            self.corre('--confirm', '--conservar', 'nadie-asi')
        self.assertEqual(User.objects.count(), 3)

    def test_una_coincidencia_exacta_gana_aunque_haya_parecidos(self):
        """`merced` es el usuario EXACTO de una cuenta: eso no es ambiguo por
        mucho que otra se llame también Merced."""
        cuenta('merced2', 'Merced', 'Otra')
        self.corre('--confirm', '--conservar', 'merced')
        self.assertEqual([u.username for u in User.objects.all()], ['merced'])

    def test_si_hay_varias_coincidencias_no_borra_nada(self):
        """Sin coincidencia exacta, `mendoza` toca dos cuentas: se aborta."""
        cuenta('otro', 'Rosa', 'Mendoza')
        with self.assertRaises(CommandError):
            self.corre('--confirm', '--conservar', 'mendoza')
        self.assertEqual(User.objects.count(), 4)
