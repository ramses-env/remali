"""Los puestos se crean, se renombran y se borran desde la pantalla.

Lo que estas pruebas cuidan no es el CRUD, es la promesa que lo hace seguro:
renombrar un puesto no mueve un solo permiso ni saca a nadie de su lugar, porque
la identidad interna (`Rol.clave`) no cambia nunca. Si eso se rompe, se rompe en
silencio: nadie ve un error, simplemente al Gestor deja de pedírsele el NIP del
dueño y al Cajero se le enciende rentar.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import CambioPermisoRol, PermisoRol, Rol
from maquinaria.permissions import (
    NIVEL_TECNICO, SIN_ACCESO, capacidades_fabrica, clave_de, es_cajero,
    nivel_de, puede_de, rol_de,
)
from maquinaria.seguridad import definir_codigo


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class CrearRolTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        self.api = APIClient(); self.api.force_authenticate(self.duena)

    def test_nace_en_blanco(self):
        """Un puesto nuevo entra al panel y no puede NADA más. Heredarle las
        capacidades de un puesto parecido sería cómodo y sería el error: el
        dueño se llevaría permisos que nunca revisó."""
        r = self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)

        rol = Rol.objects.get(nombre='Almacenista')
        self.assertEqual(rol.clave, 'almacenista')
        self.assertEqual(rol.nivel, NIVEL_TECNICO)
        self.assertFalse(rol.protegido)
        self.assertFalse(any(capacidades_fabrica('almacenista').values()))

    def test_el_grupo_se_crea_para_poder_asignarlo(self):
        """Sin grupo, el puesto existiría sin que nadie lo pueda tener."""
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        self.assertTrue(Group.objects.filter(name='Almacenista').exists())

    def test_quien_lo_tiene_entra_al_panel_y_nada_mas(self):
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        u = _usuario('bodega', 'Almacenista')

        self.assertEqual(nivel_de(u), NIVEL_TECNICO)
        self.assertEqual(rol_de(u), 'Almacenista')
        caps = puede_de(u)
        self.assertFalse(caps['vender'])
        self.assertFalse(caps['ver_dinero'])
        self.assertFalse(caps['operar_inventario'])

    def test_y_se_le_encienden_capacidades_como_a_cualquiera(self):
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        u = _usuario('bodega2', 'Almacenista')
        PermisoRol.objects.create(rol='almacenista', capacidad='operar_inventario', permitido=True)

        self.assertTrue(puede_de(u)['operar_inventario'])

    def test_aparece_en_la_foto_de_la_pantalla(self):
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        r = self.api.get('/api/permisos/')
        fila = next(x for x in r.data['roles'] if x['clave'] == 'almacenista')
        self.assertFalse(fila['protegido'])
        self.assertEqual(fila['usuarios'], 0)
        self.assertIn('almacenista', r.data['fabrica'])

    def test_nombres_que_no_se_aceptan(self):
        for nombre in ('', '  ', 'Al', 'Cliente', 'Dueño', 'x' * 61):
            r = self.api.post('/api/roles/', {'nombre': nombre}, format='json')
            self.assertEqual(r.status_code, 400, f'{nombre!r} se aceptó y no debería')

    def test_no_se_repite_el_nombre_ni_cambiando_mayusculas(self):
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        r = self.api.post('/api/roles/', {'nombre': 'almacenista'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_solo_el_dueno(self):
        admin = _usuario('adm', 'Administrador')
        api = APIClient(); api.force_authenticate(admin)
        self.assertEqual(api.post('/api/roles/', {'nombre': 'Otro'}, format='json').status_code, 403)

    def test_queda_en_la_bitacora(self):
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')
        fila = CambioPermisoRol.objects.get(rol='almacenista')
        self.assertEqual(fila.capacidad, '')
        self.assertIn('Almacenista', fila.detalle)


class RenombrarRolTest(TestCase):
    """La prueba que sostiene todo el diseño: el nombre es de pantalla."""

    def setUp(self):
        self.duena = _usuario('duena2', sup=True)
        self.api = APIClient(); self.api.force_authenticate(self.duena)

    def test_los_permisos_no_se_mueven(self):
        PermisoRol.objects.create(rol='cajero', capacidad='cotizar', permitido=True)
        cajero = _usuario('caj', 'Cajero')
        self.assertTrue(puede_de(cajero)['cotizar'])

        r = self.api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

        cajero.refresh_from_db()
        self.assertEqual(rol_de(cajero), 'Mostrador')
        self.assertTrue(puede_de(cajero)['cotizar'])
        self.assertEqual(PermisoRol.objects.get(capacidad='cotizar').rol, 'cajero')

    def test_nadie_pierde_su_puesto(self):
        """Es el MISMO grupo, solo con otro nombre: si se creara uno nuevo, la
        gente se quedaría en el viejo y sin acceso."""
        cajero = _usuario('caj2', 'Cajero')
        self.api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')

        self.assertEqual(nivel_de(cajero), NIVEL_TECNICO)
        self.assertEqual({g.name for g in cajero.groups.all()}, {'Mostrador'})
        self.assertFalse(Group.objects.filter(name='Cajero').exists())

    def test_las_reglas_del_puesto_siguen_siendo_suyas(self):
        """Al cajero le apagan rentar de fábrica y sus reglas lo distinguen del
        técnico. Si eso dependiera del nombre, renombrarlo lo apagaría todo."""
        cajero = _usuario('caj3', 'Cajero')
        self.api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')

        self.assertEqual(clave_de(cajero), 'cajero')
        self.assertTrue(es_cajero(cajero))
        caps = puede_de(cajero)
        self.assertTrue(caps['usar_caja'])
        self.assertFalse(caps['rentar'])

    def test_el_nombre_repetido_se_rechaza(self):
        r = self.api.patch('/api/roles/cajero/', {'nombre': 'Técnico'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Rol.objects.get(clave='cajero').nombre, 'Cajero')

    def test_ponerle_el_mismo_nombre_no_es_un_error(self):
        r = self.api.patch('/api/roles/cajero/', {'nombre': 'Cajero'}, format='json')
        self.assertEqual(r.status_code, 200)

    def test_un_puesto_que_no_existe(self):
        self.assertEqual(
            self.api.patch('/api/roles/inventado/', {'nombre': 'X'}, format='json').status_code, 404)

    def test_queda_en_la_bitacora(self):
        self.api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')
        fila = CambioPermisoRol.objects.filter(rol='cajero', capacidad='').first()
        self.assertIn('Cajero', fila.detalle)
        self.assertIn('Mostrador', fila.detalle)


class BorrarRolTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena3', sup=True)
        definir_codigo(self.duena, '135790')
        self.api = APIClient(); self.api.force_authenticate(self.duena)
        self.api.post('/api/roles/', {'nombre': 'Almacenista'}, format='json')

    def _borrar(self, clave='almacenista', codigo='135790'):
        return self.api.delete(f'/api/roles/{clave}/', {'codigo': codigo}, format='json')

    def test_los_puestos_base_no_se_borran(self):
        r = self._borrar('cajero')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo_error'], 'rol_protegido')
        self.assertTrue(Rol.objects.filter(clave='cajero').exists())

    def test_pide_el_codigo(self):
        r = self._borrar(codigo='000000')
        self.assertNotEqual(r.status_code, 200)
        self.assertTrue(Rol.objects.filter(clave='almacenista').exists())

    def test_se_borra_con_su_grupo_y_sus_permisos(self):
        PermisoRol.objects.create(rol='almacenista', capacidad='cotizar', permitido=True)
        r = self._borrar()

        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(Rol.objects.filter(clave='almacenista').exists())
        self.assertFalse(Group.objects.filter(name='Almacenista').exists())
        self.assertFalse(PermisoRol.objects.filter(rol='almacenista').exists())

    def test_quien_lo_tenia_se_queda_sin_acceso(self):
        """Lo pidió el dueño así: se borra y quien lo tenga pierde el panel. Por
        eso la respuesta dice a cuántos les pasó, para que no sea una sorpresa."""
        u = _usuario('bodega3', 'Almacenista')
        r = self._borrar()

        self.assertEqual(r.data['sin_acceso'], 1)
        u.refresh_from_db()
        self.assertEqual(nivel_de(u), SIN_ACCESO)

    def test_queda_en_la_bitacora(self):
        _usuario('bodega4', 'Almacenista')
        self._borrar()
        fila = CambioPermisoRol.objects.filter(rol='almacenista', capacidad='').first()
        self.assertIn('borrado', fila.detalle.lower())
        self.assertIn('1 sin acceso', fila.detalle)


class InitRolesRespetaLosNombresTest(TestCase):
    """El comando de despliegue no puede revivir el nombre viejo.

    `init_roles` corre en cada despliegue y creaba los grupos por su nombre
    escrito. Con los puestos renombrables eso significaba un "Cajero" vacío al
    lado del "Mostrador" del dueño, saliendo en el selector de rol como si fuera
    un puesto de verdad.
    """

    def test_no_revive_el_grupo_con_el_nombre_de_fabrica(self):
        from django.core.management import call_command
        from io import StringIO

        duena = _usuario('duena4', sup=True)
        api = APIClient(); api.force_authenticate(duena)
        api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')

        call_command('init_roles', stdout=StringIO())

        self.assertTrue(Group.objects.filter(name='Mostrador').exists())
        self.assertFalse(Group.objects.filter(name='Cajero').exists())


class LaAutoridadNoDependeDelNombreTest(TestCase):
    """Al Administrador se le exige PIN por ser autoridad, no por llamarse así.

    El alta de cuentas comparaba el rol elegido contra el texto 'Administrador'.
    En cuanto el dueño renombra ese puesto, la comparación falla en silencio: se
    crean administradores SIN código de seguridad, o sea gente con nivel de
    autorización que no puede autorizar nada.
    """

    def setUp(self):
        self.duena = _usuario('duena5', sup=True)
        self.api = APIClient(); self.api.force_authenticate(self.duena)
        self.api.patch('/api/roles/administrador/', {'nombre': 'Dirección'}, format='json')

    def _alta(self, **extra):
        datos = {'username': 'nuevo', 'password': 'clave-larga-1', 'rol': 'Dirección'}
        datos.update(extra)
        return self.api.post('/api/usuarios/', datos, format='json')

    def test_sin_codigo_no_se_crea_aunque_el_puesto_se_llame_distinto(self):
        r = self._alta()
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn('código de seguridad', r.data['detalle'])

    def test_con_codigo_si(self):
        r = self._alta(codigo_seguridad='246810')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(User.objects.get(username='nuevo').perfil.codigo_seguridad)


class RolesParaAsignarTest(TestCase):
    """El selector de puesto de una cuenta de trabajo.

    Viaja con la CLAVE además del nombre porque la pantalla necesita preguntar
    "¿este es el administrador?" —para pedirle su PIN— y preguntarlo por el texto
    deja de funcionar el día que el dueño lo renombra.
    """

    def setUp(self):
        self.duena = _usuario('duena6', sup=True)
        self.api = APIClient(); self.api.force_authenticate(self.duena)

    def test_cada_puesto_trae_su_clave(self):
        r = self.api.get('/api/usuarios/roles/')

        self.assertEqual(r.status_code, 200)
        por_clave = {x['clave']: x for x in r.data['roles']}
        self.assertEqual(por_clave['administrador']['nombre'], 'Administrador')
        self.assertEqual(por_clave['cajero']['nivel'], NIVEL_TECNICO)

    def test_el_cliente_no_se_asigna_desde_el_panel(self):
        Group.objects.get_or_create(name='Cliente')

        nombres = [x['nombre'] for x in self.api.get('/api/usuarios/roles/').data['roles']]

        self.assertNotIn('Cliente', nombres)

    def test_renombrarlo_no_lo_duplica(self):
        """El grupo es el mismo; si saliera dos veces, el dueño vería su puesto
        viejo al lado del nuevo y no sabría cuál escoger."""
        self.api.patch('/api/roles/cajero/', {'nombre': 'Mostrador'}, format='json')

        filas = self.api.get('/api/usuarios/roles/').data['roles']

        nombres = [x['nombre'] for x in filas]
        self.assertIn('Mostrador', nombres)
        self.assertNotIn('Cajero', nombres)
        self.assertEqual(len([x for x in filas if x['clave'] == 'cajero']), 1)
