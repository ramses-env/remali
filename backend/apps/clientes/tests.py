"""Pruebas del padrón de clientes.

Las pruebas de la migración del histórico se fueron con el comando: al eliminar
`Empresa` y arrancar con base limpia dejó de haber histórico que migrar.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from clientes.models import Cliente, Contacto


class ApiPadronTest(TestCase):
    """La API que usa la sección Clientes del panel."""

    def setUp(self):
        from rest_framework.test import APIClient
        # Cajero: nivel 1. Es la prueba que importa — el mostrador DEBE poder
        # ver el padrón, a diferencia de Empresas, que hoy no puede.
        self.cajero = User.objects.create_user(username='cajero1', password='pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.admin = User.objects.create_user(username='admin1', password='pass12345', is_staff=True)
        self.api = APIClient()
        self.api.force_authenticate(user=self.cajero)

    def test_el_cajero_ve_el_padron(self):
        Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')

        r = self.api.get('/api/clientes/')

        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['clientes'][0]['nombre'], 'Constructora del Bajío')

    def test_un_cliente_sin_acceso_no_ve_nada(self):
        from rest_framework.test import APIClient
        fuera = APIClient()
        fuera.force_authenticate(user=User.objects.create_user(username='juanp', password='pass12345'))

        self.assertEqual(fuera.get('/api/clientes/').status_code, 403)

    def test_alta_crea_su_contacto_principal(self):
        r = self.api.post('/api/clientes/', {
            'tipo': 'fisica', 'nombre': 'juan PEREZ', 'telefono': '(477) 123-45-67',
        }, format='json')

        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['nombre'], 'Juan Perez')
        self.assertEqual(r.data['telefono'], '4771234567')
        # Toda ficha nace con contacto principal, así el resto del sistema
        # nunca pregunta si es física o moral.
        self.assertEqual(len(r.data['contactos']), 1)
        self.assertTrue(r.data['contactos'][0]['principal'])

    def test_alta_sin_nombre_se_rechaza(self):
        r = self.api.post('/api/clientes/', {'nombre': '   '}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Cliente.objects.count(), 0)

    def test_alta_con_telefono_repetido_se_crea_y_se_marca(self):
        """No se une por teléfono sin confirmación: se crea y se hace visible."""
        Cliente.objects.create(tipo=Cliente.FISICA, nombre='Juan Pérez', telefono='4771234567')

        r = self.api.post('/api/clientes/', {'nombre': 'Otro Juan', 'telefono': '4771234567'},
                          format='json')

        self.assertEqual(r.status_code, 201)
        self.assertEqual(Cliente.objects.count(), 2)      # NO se fundieron
        self.assertTrue(r.data['requiere_revision'])
        self.assertIn('Juan Pérez', r.data['revision_motivo'])

    def test_el_nivel_1_no_puede_capturar_ni_editar_fiscales(self):
        # Al dar de alta se ignoran…
        r = self.api.post('/api/clientes/', {'nombre': 'Ana Torres', 'rfc': 'TOAA800101AA1'},
                          format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['rfc'], '')

        # …y al editar se rechaza con un motivo, no en silencio.
        r2 = self.api.patch(f'/api/clientes/{r.data["id"]}/', {'rfc': 'TOAA800101AA1'}, format='json')
        self.assertEqual(r2.status_code, 403)
        self.assertIn('factura', r2.data['detalle'])

    def test_administracion_si_captura_fiscales(self):
        self.api.force_authenticate(user=self.admin)

        r = self.api.post('/api/clientes/', {
            'tipo': 'moral', 'nombre': 'Constructora del Bajío', 'rfc': 'cbj010101aa1',
        }, format='json')

        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['rfc'], 'CBJ010101AA1')

    def test_busqueda_por_telefono_aunque_venga_con_guiones(self):
        Cliente.objects.create(tipo=Cliente.FISICA, nombre='Ana Torres', telefono='4774441111')

        r = self.api.get('/api/clientes/?q=477 444')

        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['clientes'][0]['nombre'], 'Ana Torres')

    def test_busqueda_encuentra_por_el_nombre_de_un_contacto(self):
        c = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        Contacto.objects.create(cliente=c, nombre='Laura Méndez')

        r = self.api.get('/api/clientes/?q=laura')

        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['clientes'][0]['nombre'], 'Constructora del Bajío')

    def test_la_lista_pagina_y_no_se_deja_pedir_todo(self):
        for i in range(30):
            Cliente.objects.create(tipo=Cliente.FISICA, nombre=f'Cliente {i:02d}')

        r = self.api.get('/api/clientes/?limite=9999')

        self.assertEqual(r.data['total'], 30)
        self.assertEqual(r.data['limite'], 100)          # techo duro
        self.assertEqual(len(r.data['clientes']), 30)

    def test_filtro_de_revision_y_su_contador(self):
        Cliente.objects.create(tipo=Cliente.FISICA, nombre='Limpio')
        Cliente.objects.create(tipo=Cliente.FISICA, nombre='Dudoso',
                               requiere_revision=True, revision_motivo='teléfono repetido')

        r = self.api.get('/api/clientes/?revision=1')

        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['en_revision'], 1)
        self.assertEqual(r.data['clientes'][0]['nombre'], 'Dudoso')

    def test_la_ficha_dice_que_contacto_tiene_cuenta(self):
        c = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        u = User.objects.create_user(username='laura', password='pass12345', email='laura@bajio.mx')
        Contacto.objects.create(cliente=c, nombre='Laura', usuario=u)
        Contacto.objects.create(cliente=c, nombre='Chuy')

        r = self.api.get(f'/api/clientes/{c.pk}/')

        por_nombre = {x['nombre']: x for x in r.data['contactos']}
        self.assertTrue(por_nombre['Laura']['tiene_cuenta'])
        self.assertEqual(por_nombre['Laura']['cuenta_correo'], 'laura@bajio.mx')
        self.assertFalse(por_nombre['Chuy']['tiene_cuenta'])
        self.assertTrue(r.data['tiene_cuenta'])

    def test_no_se_borra_un_contacto_con_cuenta(self):
        c = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        u = User.objects.create_user(username='laura', password='pass12345')
        ct = Contacto.objects.create(cliente=c, nombre='Laura', usuario=u)

        r = self.api.delete(f'/api/clientes/contactos/{ct.pk}/')

        self.assertEqual(r.status_code, 400)
        self.assertIn('Desvincúlala', r.data['detalle'])
        self.assertTrue(Contacto.objects.filter(pk=ct.pk).exists())

    def test_un_campo_no_editable_no_se_cuela_en_el_patch(self):
        c = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Ana')

        self.api.patch(f'/api/clientes/{c.pk}/',
                       {'nombre': 'Ana Torres', 'requiere_revision': True}, format='json')

        c.refresh_from_db()
        self.assertEqual(c.nombre, 'Ana Torres')
        self.assertFalse(c.requiere_revision)   # lista blanca: no entró


class ModeloClienteTest(TestCase):
    def test_persona_fisica_normaliza_el_nombre_la_moral_no(self):
        persona = Cliente.objects.create(tipo=Cliente.FISICA, nombre='juan PEREZ de la cruz')
        self.assertEqual(persona.nombre, 'Juan Perez de la Cruz')

        # "CFE" no es un error de captura: a las morales no se les toca el nombre.
        moral = Cliente.objects.create(tipo=Cliente.MORAL, nombre='CFE')
        self.assertEqual(moral.nombre, 'CFE')

    def test_telefono_y_rfc_quedan_normalizados(self):
        c = Cliente.objects.create(
            tipo=Cliente.FISICA, nombre='Ana', telefono='(477) 123-45-67', rfc=' peaj800101ab1 ',
        )
        self.assertEqual(c.telefono, '4771234567')   # la señal global deja 10 dígitos
        self.assertEqual(c.rfc, 'PEAJ800101AB1')

    def test_buscar_por_telefono_encuentra_por_cliente_y_por_contacto(self):
        constructora = Cliente.objects.create(
            tipo=Cliente.MORAL, nombre='Constructora del Bajío', telefono='4770000000',
        )
        Contacto.objects.create(cliente=constructora, nombre='Laura', telefono='4771111111')

        # El conmutador.
        self.assertEqual(list(Cliente.buscar_por_telefono('477 000 0000')), [constructora])
        # El celular de la residente: mismo cliente.
        self.assertEqual(list(Cliente.buscar_por_telefono('4771111111')), [constructora])
        # Un número que no es de nadie.
        self.assertFalse(Cliente.buscar_por_telefono('4779999999').exists())
        # Sin dígitos no se devuelve el padrón entero.
        self.assertFalse(Cliente.buscar_por_telefono('').exists())

    def test_solo_un_contacto_principal_por_cliente(self):
        c = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Obras SA')
        primero = Contacto.objects.create(cliente=c, nombre='Beto', principal=True)
        segundo = Contacto.objects.create(cliente=c, nombre='Laura', principal=True)

        primero.refresh_from_db()
        self.assertFalse(primero.principal)
        self.assertTrue(segundo.principal)
        self.assertEqual(c.contacto_principal, segundo)

    def test_una_cuenta_recien_registrada_es_un_contacto_sin_cliente(self):
        """El registro en la tienda NO debe crear un Cliente: el padrón lo cura
        REMALI a mano. La cuenta queda esperando a que alguien la vincule."""
        u = User.objects.create_user(username='laura', password='pass12345')
        suelto = Contacto.objects.create(nombre='Laura Méndez', usuario=u, telefono='4771111111')

        self.assertIsNone(suelto.cliente)
        self.assertEqual(Cliente.objects.count(), 0)   # el padrón sigue limpio
        self.assertIn(suelto, Contacto.sin_vincular())
        self.assertEqual(str(suelto), 'Laura Méndez (sin vincular)')

    def test_los_contactos_sin_vincular_no_se_apagan_entre_si(self):
        """Con cliente nulo, la regla de "un solo principal" agruparía a TODOS
        los sueltos como si fueran del mismo cliente."""
        a = Contacto.objects.create(nombre='Laura', principal=True)
        b = Contacto.objects.create(nombre='Beto', principal=True)

        a.refresh_from_db()
        self.assertTrue(a.principal)   # el de Beto no apagó el de Laura
        self.assertTrue(b.principal)

    def test_vincular_es_ponerle_su_cliente(self):
        constructora = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        u = User.objects.create_user(username='laura', password='pass12345')
        suelto = Contacto.objects.create(nombre='Laura Méndez', usuario=u)

        suelto.cliente = constructora
        suelto.save()

        self.assertFalse(Contacto.sin_vincular().exists())
        self.assertTrue(constructora.tiene_cuenta)

    def test_tiene_cuenta_solo_si_algun_contacto_tiene_usuario(self):
        c = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Obras SA')
        Contacto.objects.create(cliente=c, nombre='Chuy')
        self.assertFalse(c.tiene_cuenta)

        u = User.objects.create_user(username='chuy', password='pass12345')
        Contacto.objects.create(cliente=c, nombre='Laura', usuario=u)
        self.assertTrue(c.tiene_cuenta)


class BuscadorMostradorTest(TestCase):
    """El buscador que usa quien atiende, con el cliente enfrente."""

    def setUp(self):
        from rest_framework.test import APIClient
        u = User.objects.create_user(username='cajero1', password='pass12345')
        u.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(user=u)

        self.constructora = Cliente.objects.create(
            tipo=Cliente.MORAL, nombre='Constructora del Bajío', telefono='4770000000')
        Contacto.objects.create(cliente=self.constructora, nombre='Laura', telefono='4771111111')

    def test_encuentra_por_el_conmutador_y_por_el_celular_del_residente(self):
        por_conmutador = self.api.get('/api/clientes/buscar/?telefono=477 000 0000')
        por_celular = self.api.get('/api/clientes/buscar/?telefono=4771111111')

        for r in (por_conmutador, por_celular):
            self.assertEqual(len(r.data['clientes']), 1, r.data)
            self.assertEqual(r.data['clientes'][0]['nombre'], 'Constructora del Bajío')

    def test_trae_el_resumen_para_decidir_antes_de_vender(self):
        r = self.api.get('/api/clientes/buscar/?telefono=4770000000')

        resumen = r.data['clientes'][0]['resumen']
        self.assertEqual(resumen['compras'], 0)
        self.assertEqual(resumen['rentas_activas'], 0)
        self.assertIn('cotizaciones', resumen)

    def test_con_menos_de_dos_letras_no_devuelve_el_padron_entero(self):
        r = self.api.get('/api/clientes/buscar/?q=c')
        self.assertEqual(r.data['clientes'], [])

    def test_un_cliente_inactivo_no_se_ofrece_en_mostrador(self):
        self.constructora.activo = False
        self.constructora.save()

        r = self.api.get('/api/clientes/buscar/?telefono=4770000000')

        self.assertEqual(r.data['clientes'], [])


class ResolverClienteTest(TestCase):
    """La regla que sostiene todo: nunca unir sin que una persona confirme."""

    def test_con_cliente_id_se_usa_ese_y_no_se_crea_nada(self):
        from clientes.resolucion import resolver_cliente
        existente = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Ana Torres')

        cli, contacto = resolver_cliente(cliente_id=existente.pk, nombre='Otro Nombre')

        self.assertEqual(cli, existente)
        self.assertEqual(Cliente.objects.count(), 1)

    def test_sin_cliente_id_se_crea_uno_nuevo_con_su_contacto(self):
        from clientes.resolucion import resolver_cliente

        cli, contacto = resolver_cliente(nombre='jesús ramírez', telefono='744 123 4567')

        self.assertEqual(cli.nombre, 'Jesús Ramírez')
        self.assertEqual(cli.telefono, '7441234567')
        self.assertTrue(contacto.principal)

    def test_un_telefono_repetido_NO_funde_los_clientes(self):
        from clientes.resolucion import resolver_cliente
        Cliente.objects.create(tipo=Cliente.FISICA, nombre='Jesús Ramírez', telefono='7441234567')

        cli, _ = resolver_cliente(nombre='Otra Persona', telefono='7441234567')

        self.assertEqual(Cliente.objects.count(), 2)     # dos, no uno
        self.assertTrue(cli.requiere_revision)
        self.assertIn('Jesús Ramírez', cli.revision_motivo)

    def test_sin_nombre_ni_telefono_no_inventa_un_cliente(self):
        """La caja vende un filtro de $300 sin preguntar nada, y está bien."""
        from clientes.resolucion import resolver_cliente

        cli, contacto = resolver_cliente()

        self.assertIsNone(cli)
        self.assertIsNone(contacto)
        self.assertEqual(Cliente.objects.count(), 0)

    def test_un_cliente_id_que_no_existe_no_tumba_la_venta(self):
        from clientes.resolucion import resolver_cliente

        cli, contacto = resolver_cliente(cliente_id=99999, nombre='Ana')

        self.assertIsNone(cli)      # la venta se guarda sin cliente, no revienta
