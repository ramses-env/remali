"""Pruebas del padrón de clientes y de la migración del histórico.

Lo que se protege aquí es, sobre todo, la migración: corre una sola vez sobre
datos reales y no hay segunda oportunidad. Cada regla del comando —incluida la
de NO inventar clientes cuando no hay teléfono— tiene su prueba.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from clientes.models import Cliente, Contacto
from cotizaciones.models import Cotizacion
from empresas.models import Empresa, Obra
from inventario.models import Inventario, OrdenReparacion
from maquinaria.models import Equipo, ObraCliente, PerfilUsuario
from renta.models import Renta
from ventas.models import Venta


def _migrar(*extra):
    salida = StringIO()
    call_command('migrar_clientes', *extra, stdout=salida)
    return salida.getvalue()


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


class MigracionEmpresasTest(TestCase):
    def setUp(self):
        self.empresa = Empresa.objects.create(
            nombre='Constructora del Bajío', rfc='cbj010101aa1', contacto='Laura Méndez',
            telefono='4770000000', email='Contacto@Bajio.MX', regimen_fiscal='601',
            calle='Av. López Mateos', numero_exterior='120', colonia='Centro',
            municipio='León', entidad='Guanajuato', codigo_postal='37000',
        )
        self.obra = Obra.objects.create(empresa=self.empresa, nombre='Torre Norte')

    def test_empresa_se_vuelve_cliente_moral_con_sus_datos_fiscales(self):
        _migrar('--aplicar')

        cli = Cliente.objects.get(tipo=Cliente.MORAL)
        self.assertEqual(cli.nombre, 'Constructora del Bajío')
        self.assertEqual(cli.rfc, 'CBJ010101AA1')
        self.assertEqual(cli.regimen_fiscal, '601')
        self.assertEqual(cli.telefono, '4770000000')
        self.assertEqual(cli.email, 'contacto@bajio.mx')
        self.assertEqual(cli.municipio, 'León')
        # La persona de contacto de la empresa se vuelve su contacto principal.
        self.assertEqual(cli.contacto_principal.nombre, 'Laura Méndez')
        self.assertIsNone(cli.contacto_principal.usuario)

    def test_la_obra_cambia_de_dueno_sin_perder_su_empresa(self):
        _migrar('--aplicar')

        self.obra.refresh_from_db()
        self.assertEqual(self.obra.cliente, Cliente.objects.get(tipo=Cliente.MORAL))
        # La fase 1 conserva el vínculo viejo: por eso es reversible.
        self.assertEqual(self.obra.empresa, self.empresa)

    def test_documento_con_empresa_apunta_a_ese_cliente(self):
        venta = Venta.objects.create(empresa=self.empresa, precio_maquina=Decimal('1000'))
        _migrar('--aplicar')

        venta.refresh_from_db()
        self.assertEqual(venta.cliente.nombre, 'Constructora del Bajío')
        self.assertEqual(venta.contacto.nombre, 'Laura Méndez')


class MigracionCuentasTest(TestCase):
    def test_cuenta_de_cliente_se_vuelve_cliente_fisico_con_contacto(self):
        u = User.objects.create_user(
            username='juanp', password='pass12345', email='Juan@Correo.COM',
            first_name='juan pérez',
        )
        PerfilUsuario.objects.create(usuario=u, telefono='4772223333', fiscal_rfc='pej800101aa1')

        _migrar('--aplicar')

        contacto = Contacto.objects.get(usuario=u)
        cli = contacto.cliente
        self.assertEqual(cli.tipo, Cliente.FISICA)
        self.assertEqual(cli.nombre, 'Juan Pérez')
        self.assertEqual(cli.telefono, '4772223333')
        self.assertEqual(cli.rfc, 'PEJ800101AA1')
        self.assertTrue(contacto.principal)
        self.assertTrue(cli.tiene_cuenta)

    def test_el_equipo_interno_no_entra_al_padron(self):
        User.objects.create_user(username='admin1', password='pass12345', is_staff=True)
        tecnico = User.objects.create_user(username='tec1', password='pass12345')
        tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])

        _migrar('--aplicar')

        self.assertEqual(Cliente.objects.count(), 0)
        self.assertEqual(Contacto.objects.count(), 0)

    def test_cuenta_cuya_empresa_casa_con_el_catalogo_se_cuelga_de_esa_moral(self):
        Empresa.objects.create(nombre='Constructora del Bajío')
        u = User.objects.create_user(username='laura', password='pass12345', first_name='Laura Méndez')
        # El cliente lo escribió sin acentos y en minúsculas: da igual.
        PerfilUsuario.objects.create(usuario=u, empresa='constructora del bajio')

        _migrar('--aplicar')

        contacto = Contacto.objects.get(usuario=u)
        self.assertEqual(contacto.cliente.tipo, Cliente.MORAL)
        self.assertEqual(contacto.cliente.nombre, 'Constructora del Bajío')
        # No se creó un cliente físico duplicado para la misma persona.
        self.assertEqual(Cliente.objects.count(), 1)

    def test_empresa_escrita_que_no_existe_no_se_inventa_y_queda_marcada(self):
        u = User.objects.create_user(username='beto', password='pass12345', first_name='Beto Ruiz')
        PerfilUsuario.objects.create(usuario=u, empresa='Ferretería que no está en el catálogo')

        _migrar('--aplicar')

        cli = Contacto.objects.get(usuario=u).cliente
        self.assertEqual(cli.tipo, Cliente.FISICA)   # NO se creó una moral de la nada
        self.assertTrue(cli.requiere_revision)
        self.assertIn('Ferretería', cli.notas)

    def test_las_obras_del_panel_del_cliente_se_vuelven_obras_de_verdad(self):
        u = User.objects.create_user(username='juanp', password='pass12345', first_name='Juan Pérez')
        ObraCliente.objects.create(
            usuario=u, nombre='Casa Roma', responsable='Juan', telefono='4772223333',
            direccion='Calle 5 #10', predeterminada=True,
        )

        _migrar('--aplicar')

        obra = Obra.objects.get(nombre='Casa Roma')
        self.assertEqual(obra.cliente, Contacto.objects.get(usuario=u).cliente)
        self.assertIsNone(obra.empresa)          # una persona física no tiene empresa
        self.assertEqual(obra.ubicacion, 'Calle 5 #10')


class MigracionMostradorTest(TestCase):
    """Lo dudoso: documentos que solo traen texto."""

    def _venta(self, nombre, telefono, precio='1000'):
        return Venta.objects.create(
            nombre_cliente=nombre, telefono_cliente=telefono, precio_maquina=Decimal(precio),
        )

    def test_mismo_telefono_distinta_escritura_es_un_solo_cliente(self):
        v1 = self._venta('naomi perez', '4775558888')
        v2 = self._venta('Naomí Pérez', '477 555 8888')

        _migrar('--aplicar')

        v1.refresh_from_db(); v2.refresh_from_db()
        self.assertIsNotNone(v1.cliente)
        self.assertEqual(v1.cliente, v2.cliente)
        self.assertEqual(Cliente.objects.count(), 1)
        self.assertFalse(v1.cliente.requiere_revision)

    def test_gana_el_nombre_mas_reciente(self):
        vieja = self._venta('Naomi', '4775558888')
        Venta.objects.filter(pk=vieja.pk).update(fecha=timezone.now() - timedelta(days=400))
        self._venta('Naomí Pérez López', '4775558888')

        _migrar('--aplicar')

        self.assertEqual(Cliente.objects.get().nombre, 'Naomí Pérez López')

    def test_mismo_telefono_con_nombres_incompatibles_se_une_pero_se_marca(self):
        self._venta('Juan Pérez', '4775558888')
        self._venta('Ferretería el Roble', '4775558888')

        salida = _migrar('--aplicar')

        cli = Cliente.objects.get()
        self.assertTrue(cli.requiere_revision)
        self.assertIn('4775558888', cli.revision_motivo)
        self.assertIn('MARCADOS PARA REVISIÓN', salida)

    def test_venta_sin_telefono_se_queda_huerfana_a_proposito(self):
        v = self._venta('Cliente de paso', '')

        salida = _migrar('--aplicar')

        v.refresh_from_db()
        self.assertIsNone(v.cliente)
        self.assertEqual(v.nombre_cliente, 'Cliente de Paso')   # el texto NO se pierde
        self.assertEqual(Cliente.objects.count(), 0)
        self.assertIn('HUÉRFANAS', salida)

    def test_el_telefono_de_mostrador_engancha_con_una_cuenta_ya_existente(self):
        u = User.objects.create_user(username='juanp', password='pass12345', first_name='Juan Pérez')
        PerfilUsuario.objects.create(usuario=u, telefono='4775558888')
        v = self._venta('Juan Perez', '4775558888')

        _migrar('--aplicar')

        v.refresh_from_db()
        self.assertEqual(v.cliente, Contacto.objects.get(usuario=u).cliente)
        self.assertEqual(Cliente.objects.count(), 1)   # no se duplicó

    def test_cotizacion_de_mostrador_tambien_entra(self):
        c = Cotizacion.objects.create(cliente_nombre='Ana Torres', cliente_telefono='4774441111')

        _migrar('--aplicar')

        c.refresh_from_db()
        self.assertEqual(c.cliente.nombre, 'Ana Torres')


class MigracionReparacionesTest(TestCase):
    """La orden de reparación es el quinto documento: se pasó por alto en la
    primera vuelta y es justo donde llega quien va a reclamar una garantía."""

    def test_la_orden_de_un_cliente_entra_al_padron(self):
        o = OrdenReparacion.objects.create(
            tipo='cliente', cliente_nombre='Ana Torres', cliente_telefono='4774441111',
            equipo_descripcion='Revolvedora Marca X',
        )

        _migrar('--aplicar')

        o.refresh_from_db()
        self.assertEqual(o.cliente.nombre, 'Ana Torres')
        self.assertEqual(o.cliente_nombre, 'Ana Torres')   # el texto sigue ahí

    def test_la_orden_interna_no_es_huerfana_ni_inventa_cliente(self):
        """Una máquina propia en el taller no tiene cliente y no le falta uno."""
        equipo = Equipo.objects.create(modelo='EXC-200')
        inv = Inventario.objects.create(equipo=equipo, condicion='seminueva', estado='disponible')
        o = OrdenReparacion.objects.create(tipo='interna', unidad=inv)

        salida = _migrar('--aplicar')

        o.refresh_from_db()
        self.assertIsNone(o.cliente)
        self.assertEqual(Cliente.objects.count(), 0)
        self.assertIn('internas (máquina propia)', salida)

    def test_la_reparacion_comparte_cliente_con_la_venta_del_mismo_telefono(self):
        """El escenario real: compró aquí y viene a reclamar. Debe ser el MISMO
        cliente, o el mostrador no puede ver su historial completo."""
        Venta.objects.create(nombre_cliente='Jesús Ramírez', telefono_cliente='7441234567',
                             precio_maquina=Decimal('180000'))
        o = OrdenReparacion.objects.create(
            tipo='cliente', cliente_nombre='Jesus Ramirez', cliente_telefono='744 123 4567',
        )

        _migrar('--aplicar')

        o.refresh_from_db()
        self.assertEqual(Cliente.objects.count(), 1)
        self.assertEqual(o.cliente, Venta.objects.get().cliente)

    def test_revertir_tambien_suelta_las_reparaciones(self):
        o = OrdenReparacion.objects.create(
            tipo='cliente', cliente_nombre='Ana Torres', cliente_telefono='4774441111',
        )
        _migrar('--aplicar')
        o.refresh_from_db()
        self.assertIsNotNone(o.cliente)

        _migrar('--revertir', '--aplicar')

        o.refresh_from_db()
        self.assertIsNone(o.cliente)
        self.assertEqual(o.cliente_nombre, 'Ana Torres')


class MigracionRentaTest(TestCase):
    def setUp(self):
        equipo = Equipo.objects.create(modelo='REV-1000', precio_dia=Decimal('100'))
        self.inv = Inventario.objects.create(equipo=equipo, condicion='seminueva', estado='disponible')

    def test_la_renta_conserva_su_nombre_de_texto_y_gana_cliente(self):
        r = Renta.objects.create(
            inventario=self.inv, modalidad='dia', duracion=3,
            fecha_inicio=timezone.localdate(), direccion='Obra Centro',
            cliente_texto='Ana Torres', telefono_cliente='4774441111',
        )

        _migrar('--aplicar')

        r.refresh_from_db()
        self.assertEqual(r.cliente_texto, 'Ana Torres')    # el campo renombrado sigue ahí
        self.assertEqual(r.cliente.nombre, 'Ana Torres')
        self.assertEqual(r.cliente_nombre, 'Ana Torres')   # la propiedad ahora lee del padrón


class InformeYReversaTest(TestCase):
    def setUp(self):
        Empresa.objects.create(nombre='Constructora del Bajío', contacto='Laura')
        Venta.objects.create(nombre_cliente='Ana Torres', telefono_cliente='4774441111',
                             precio_maquina=Decimal('1000'))

    def test_el_informe_no_escribe_nada(self):
        salida = _migrar()

        self.assertIn('no se escribió nada', salida)
        self.assertEqual(Cliente.objects.count(), 0)
        self.assertEqual(Contacto.objects.count(), 0)
        self.assertIsNone(Venta.objects.get().cliente)

    def test_el_informe_cuenta_lo_mismo_que_despues_aplica(self):
        salida = _migrar()
        self.assertIn('Clientes morales (desde Empresa)', salida)

        _migrar('--aplicar')
        self.assertEqual(Cliente.objects.count(), 2)   # la moral + Ana Torres

    def test_revertir_deja_todo_como_estaba(self):
        _migrar('--aplicar')
        self.assertEqual(Cliente.objects.count(), 2)

        _migrar('--revertir', '--aplicar')

        self.assertEqual(Cliente.objects.count(), 0)
        self.assertEqual(Contacto.objects.count(), 0)
        self.assertIsNone(Venta.objects.get().cliente)
        # Lo viejo intacto: por eso se pueden conservar los campos espejo.
        self.assertEqual(Venta.objects.get().nombre_cliente, 'Ana Torres')
        self.assertEqual(Empresa.objects.count(), 1)

    def test_revertir_no_se_lleva_obras_reales_por_delante(self):
        empresa = Empresa.objects.get()
        Obra.objects.create(empresa=empresa, nombre='Torre Norte')
        _migrar('--aplicar')

        _migrar('--revertir', '--aplicar')

        obra = Obra.objects.get(nombre='Torre Norte')   # sigue viva
        self.assertIsNone(obra.cliente)
        self.assertEqual(obra.empresa, empresa)
