"""La matriz de roles y capacidades.

Existe porque los permisos se rompen en silencio: nadie nota que un rol perdió
una capacidad hasta que alguien no puede trabajar, ni que ganó una hasta que ve
algo que no debía. Cada rol tiene aquí su fila completa —lo que puede Y lo que
no— para que cualquier cambio futuro tenga que declararse a propósito.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from maquinaria.permissions import (
    NIVEL_ADMIN, NIVEL_DUENO, NIVEL_TECNICO, SIN_ACCESO,
    nivel_de, puede_de, rol_de,
)


def _con_rol(username, grupo=None, staff=False, sup=False):
    u = User.objects.create_user(username=username, password='pass12345',
                                 is_staff=staff, is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class MatrizDeRolesTest(TestCase):
    """Lo que cada rol PUEDE y lo que NO. Si algo de esto cambia, que se vea."""

    def _assert_matriz(self, user, puede, no_puede):
        caps = puede_de(user)
        for c in puede:
            self.assertTrue(caps.get(c), f'{rol_de(user)} debería poder «{c}» y no puede')
        for c in no_puede:
            self.assertFalse(caps.get(c), f'{rol_de(user)} NO debería poder «{c}» y sí puede')

    def test_dueno_puede_todo(self):
        u = _con_rol('dueno', staff=True, sup=True)
        self.assertEqual(nivel_de(u), NIVEL_DUENO)
        caps = puede_de(u)
        # jornada_campo es un PUESTO, no un poder: no cascadea hacia arriba.
        for c, v in caps.items():
            if c in ('nivel', 'rol', 'jornada_campo'):
                continue
            self.assertTrue(v, f'el dueño debería poder «{c}»')

    def test_administrador(self):
        u = _con_rol('admin1', 'Administrador')
        self.assertEqual(nivel_de(u), NIVEL_ADMIN)
        self._assert_matriz(
            u,
            puede=['ver_dinero', 'ver_montos_operacion', 'vender', 'rentar', 'cotizar',
                   'facturar', 'editar_catalogo', 'alta_inventario', 'operar_inventario',
                   'reparar', 'gestionar_reparaciones', 'usar_caja', 'corte_caja',
                   'ver_clientes', 'editar_clientes', 'ver_jornada'],
            # Dar de alta gente y cambiar los datos del negocio son del dueño.
            no_puede=['gestionar_usuarios', 'configurar_negocio', 'jornada_campo'],
        )

    def test_cajero(self):
        """Mostrador: cobra en la caja, no anda en campo ni ve las cuentas."""
        u = _con_rol('cajero1', 'Cajero')
        self.assertEqual(nivel_de(u), NIVEL_TECNICO)
        self._assert_matriz(
            u,
            puede=['usar_caja', 'corte_caja', 'vender', 'ver_montos_operacion',
                   'ver_clientes', 'editar_clientes'],
            no_puede=['rentar', 'reparar', 'gestionar_reparaciones', 'operar_inventario',
                      'jornada_campo', 'ver_dinero', 'editar_catalogo', 'cotizar',
                      'facturar', 'alta_inventario', 'gestionar_usuarios',
                      'configurar_negocio'],
        )

    def test_tecnico(self):
        """Campo: repara, entrega, recoge y cobra lo que él atiende.

        NO vende ni renta: eso se levanta en el mostrador o en administración.
        Antes las tenía encendidas por nivel y el panel no le mostraba ni una
        pantalla para hacerlas.
        """
        u = _con_rol('tecnico1', 'Técnico')
        self.assertEqual(nivel_de(u), NIVEL_TECNICO)
        self._assert_matriz(
            u,
            puede=['reparar', 'operar_inventario', 'jornada_campo',
                   'ver_montos_operacion', 'ver_clientes', 'editar_clientes'],
            no_puede=['vender', 'rentar', 'ver_dinero', 'usar_caja', 'corte_caja',
                      'editar_catalogo', 'alta_inventario', 'cotizar', 'facturar',
                      'ver_jornada', 'gestionar_usuarios', 'configurar_negocio',
                      # Lleva el taller es de administración; él lo TRABAJA.
                      'gestionar_reparaciones'],
        )

    def test_el_tecnico_repara_pero_no_lleva_el_taller(self):
        """La distinción que quita la sección duplicada: hacer el trabajo no es
        lo mismo que administrar el taller. El técnico recibe la máquina y la
        trabaja desde Mi jornada, que ya le trae sus órdenes abiertas; la
        sección Reparaciones —historial, costos, entrega al cliente— no le toca."""
        u = _con_rol('tecnico3', 'Técnico')
        caps = puede_de(u)
        self.assertTrue(caps['reparar'], 'debe poder recibir y trabajar órdenes')
        self.assertFalse(caps['gestionar_reparaciones'], 'la sección no le toca')

    def test_solo_el_mostrador_configura_la_impresora(self):
        """La impresora térmica imprime tickets de caja. El técnico imprime
        órdenes en PDF desde el navegador y no usa nada de esto."""
        self.assertTrue(puede_de(_con_rol('caj9', 'Cajero'))['usar_caja'])
        self.assertFalse(puede_de(_con_rol('tec9', 'Técnico'))['usar_caja'])

    def test_el_tecnico_cobra_pero_no_ve_las_cuentas(self):
        """La distinción que sostiene todo el diseño: cobrar lo que uno entrega
        no es lo mismo que ver los ingresos del negocio."""
        u = _con_rol('tecnico2', 'Técnico')
        caps = puede_de(u)
        self.assertTrue(caps['ver_montos_operacion'])
        self.assertFalse(caps['ver_dinero'])


class RolesRetiradosTest(TestCase):
    """'Gerente' y 'Asesor' se retiraron. Quien quede en un grupo con ese nombre
    NO debe heredar nada: el grupo ya no significa un rol del sistema."""

    def test_gerente_ya_no_da_acceso(self):
        u = _con_rol('exgerente', 'Gerente')
        self.assertEqual(nivel_de(u), SIN_ACCESO)
        self.assertFalse(puede_de(u).get('ver_dinero'))

    def test_asesor_ya_no_da_acceso(self):
        u = _con_rol('exasesor', 'Asesor')
        self.assertEqual(nivel_de(u), SIN_ACCESO)
        self.assertFalse(puede_de(u).get('cotizar'))

    def test_init_roles_borra_los_grupos_retirados(self):
        from django.core.management import call_command
        Group.objects.get_or_create(name='Gerente')
        Group.objects.get_or_create(name='Asesor')

        call_command('init_roles', verbosity=0)

        self.assertFalse(Group.objects.filter(name__in=['Gerente', 'Asesor']).exists())
        for vigente in ('Administrador', 'Cajero', 'Técnico'):
            self.assertTrue(Group.objects.filter(name=vigente).exists(), vigente)


class CuentaInactivaTest(TestCase):
    def test_una_cuenta_desactivada_no_conserva_nada(self):
        """Fail-closed: si le quitaron el acceso, un token vivo no debe servir."""
        u = _con_rol('inactivo', 'Administrador')
        u.is_active = False
        u.save()

        self.assertEqual(nivel_de(u), SIN_ACCESO)
        self.assertFalse(puede_de(u).get('ver_dinero'))
