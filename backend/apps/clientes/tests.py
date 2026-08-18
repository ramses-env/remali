"""Pruebas del padrón de clientes.

Las pruebas de la migración del histórico se fueron con el comando: al eliminar
`Empresa` y arrancar con base limpia dejó de haber histórico que migrar.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase, override_settings

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


class EstadoDeCuentaTest(TestCase):
    """Lo que debe, lo que se le debe, y que las dos pantallas digan lo mismo."""

    def setUp(self):
        from decimal import Decimal
        from rest_framework.test import APIClient
        from inventario.models import Inventario
        from maquinaria.models import Equipo

        u = User.objects.create_user(username='cajero1', password='pass12345')
        u.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(user=u)

        self.cli = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Jesús Ramírez',
                                          telefono='7441234567')
        self.equipo = Equipo.objects.create(modelo='EXC-200', precio_dia=Decimal('100'))
        self.inv = Inventario.objects.create(equipo=self.equipo, condicion='seminueva',
                                             estado='disponible')

    def _renta(self, **extra):
        from django.utils import timezone
        from renta.models import Renta
        return Renta.objects.create(
            inventario=self.inv, cliente=self.cli, modalidad='dia', duracion=3,
            fecha_inicio=timezone.localdate(), direccion='Obra Centro', **extra)

    def test_una_renta_sin_abonos_es_saldo_a_favor_de_remali(self):
        self._renta()

        r = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')

        self.assertEqual(r.data['saldo'], '300.00')       # 100 x 3 días
        self.assertEqual(r.data['credito_a_favor'], '0.00')
        self.assertEqual(r.data['neto'], '300.00')
        self.assertTrue(r.data['tiene_adeudo'])

    def test_un_deposito_por_devolver_es_dinero_que_REMALI_debe(self):
        from decimal import Decimal
        renta = self._renta(deposito=Decimal('5000'))
        renta.pagos = [{'monto': '300', 'metodo': 'efectivo'}]
        renta.deposito_estado = 'por_devolver'
        renta.deposito_reembolso = Decimal('5000')
        renta.save()

        r = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')

        self.assertEqual(r.data['saldo'], '0.00')
        self.assertEqual(r.data['credito_a_favor'], '5000.00')
        self.assertEqual(r.data['neto'], '-5000.00')      # negativo: se le debe
        self.assertTrue(r.data['tiene_credito'])

    def test_un_deposito_ya_devuelto_no_cuenta_como_credito_vivo(self):
        from decimal import Decimal
        renta = self._renta(deposito=Decimal('5000'))
        renta.deposito_estado = 'devuelto'
        renta.deposito_reembolso = Decimal('5000')
        renta.save()

        r = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')

        self.assertEqual(r.data['credito_a_favor'], '0.00')

    def test_una_renta_cancelada_no_suma_deuda(self):
        renta = self._renta()
        renta.estado = 'cancelada'
        renta.save(update_fields=['estado'])

        r = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')

        self.assertEqual(r.data['saldo'], '0.00')

    def test_el_historial_junta_todo_de_lo_mas_nuevo_a_lo_mas_viejo(self):
        from decimal import Decimal
        from ventas.models import Venta
        self._renta()
        Venta.objects.create(cliente=self.cli, precio_maquina=Decimal('1000'))

        r = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')

        tipos = [d['tipo'] for d in r.data['documentos']]
        self.assertEqual(len(tipos), 2)
        self.assertIn('renta', tipos)
        self.assertIn('venta', tipos)

    def test_el_mostrador_ve_EXACTAMENTE_la_misma_cifra_que_la_ficha(self):
        """La regla de la entrega C: un solo cálculo, dos pantallas."""
        self._renta()

        ficha = self.api.get(f'/api/clientes/{self.cli.pk}/estado-cuenta/')
        mostrador = self.api.get('/api/clientes/buscar/?telefono=7441234567')

        self.assertEqual(mostrador.data['clientes'][0]['resumen']['saldo'], ficha.data['saldo'])


class CuentaNuevaTest(TestCase):
    """Registrarse en la tienda NO ensucia el padrón: crea un contacto suelto
    y le avisa a REMALI para que lo vincule a mano."""

    def setUp(self):
        from rest_framework.test import APIClient
        self.publico = APIClient()
        admin = User.objects.create_user(username='admin1', password='pass12345', is_staff=True)
        self.api = APIClient()
        self.api.force_authenticate(user=admin)

    def _registrar(self, email='laura@bajio.mx', telefono='4771111111'):
        return self.publico.post('/api/auth/registro/', {
            'email': email, 'password': 'Remali-2026-clave', 'nombre': 'Laura Méndez',
            'telefono': telefono,
        }, format='json')

    def test_el_registro_no_crea_un_cliente(self):
        r = self._registrar()

        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Cliente.objects.count(), 0)      # el padrón sigue limpio
        self.assertEqual(Contacto.sin_vincular().count(), 1)

    def test_avisa_al_equipo_con_la_pista_del_telefono(self):
        from maquinaria.models import Notificacion
        Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío',
                               telefono='4771111111')

        self._registrar()

        aviso = Notificacion.objects.filter(titulo__startswith='Cuenta nueva').first()
        self.assertIsNotNone(aviso)
        self.assertIn('Constructora del Bajío', aviso.mensaje)   # la pista
        self.assertEqual(Contacto.sin_vincular().count(), 1)     # NO se unió sola

    def test_la_bandeja_muestra_la_pista_sin_aplicarla(self):
        cli = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío',
                                     telefono='4771111111')
        self._registrar()

        r = self.api.get('/api/clientes/sin-vincular/')

        self.assertEqual(r.data['total'], 1)
        self.assertEqual(r.data['contactos'][0]['pista']['id'], cli.pk)

    def test_vincular_le_pone_su_cliente_y_deja_rastro(self):
        cli = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        self._registrar()
        contacto = Contacto.sin_vincular().first()

        r = self.api.post(f'/api/clientes/{cli.pk}/vincular/',
                          {'contacto_id': contacto.pk}, format='json')

        self.assertEqual(r.status_code, 200, r.data)
        contacto.refresh_from_db(); cli.refresh_from_db()
        self.assertEqual(contacto.cliente, cli)
        self.assertFalse(Contacto.sin_vincular().exists())
        self.assertIn('admin1', cli.notas)          # quién lo hizo
        self.assertIn('Laura', cli.notas)

    def test_no_se_vincula_un_contacto_que_ya_tiene_dueno(self):
        a = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora A')
        b = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora B')
        c = Contacto.objects.create(cliente=a, nombre='Laura')

        r = self.api.post(f'/api/clientes/{b.pk}/vincular/', {'contacto_id': c.pk}, format='json')

        self.assertEqual(r.status_code, 400)
        self.assertIn('Constructora A', r.data['detalle'])


class FusionarTest(TestCase):
    def setUp(self):
        from decimal import Decimal
        from rest_framework.test import APIClient
        from ventas.models import Venta

        self.admin = User.objects.create_user(username='admin1', password='pass12345', is_staff=True)
        self.api = APIClient()
        self.api.force_authenticate(user=self.admin)

        self.origen = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Naomi')
        self.destino = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Naomí Pérez')
        Venta.objects.create(cliente=self.origen, precio_maquina=Decimal('1000'))
        Contacto.objects.create(cliente=self.origen, nombre='Naomi', principal=True)

    def test_todo_se_mueve_al_destino_y_el_origen_se_desactiva(self):
        r = self.api.post(f'/api/clientes/{self.destino.pk}/fusionar/',
                          {'origen_id': self.origen.pk, 'motivo': 'mismo teléfono'}, format='json')

        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['movidos']['ventas'], 1)
        self.origen.refresh_from_db(); self.destino.refresh_from_db()
        self.assertEqual(self.destino.ventas.count(), 1)
        # El origen NO se borra: sin él no hay forma de entender una fusión mala.
        self.assertTrue(Cliente.objects.filter(pk=self.origen.pk).exists())
        self.assertFalse(self.origen.activo)

    def test_deja_rastro_de_quien_cuando_y_por_que(self):
        self.api.post(f'/api/clientes/{self.destino.pk}/fusionar/',
                      {'origen_id': self.origen.pk, 'motivo': 'mismo teléfono'}, format='json')

        self.destino.refresh_from_db()
        self.assertIn('admin1', self.destino.notas)
        self.assertIn('Naomi', self.destino.notas)
        self.assertIn('mismo teléfono', self.destino.notas)

    def test_el_contacto_movido_pierde_el_principal(self):
        """Dos contactos principales en la misma ficha es un estado inválido."""
        Contacto.objects.create(cliente=self.destino, nombre='Naomí', principal=True)

        self.api.post(f'/api/clientes/{self.destino.pk}/fusionar/',
                      {'origen_id': self.origen.pk}, format='json')

        principales = self.destino.contactos.filter(principal=True).count()
        self.assertEqual(principales, 1)

    def test_no_se_funde_un_cliente_consigo_mismo(self):
        r = self.api.post(f'/api/clientes/{self.destino.pk}/fusionar/',
                          {'origen_id': self.destino.pk}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_el_mostrador_no_puede_fundir(self):
        from rest_framework.test import APIClient
        cajero = User.objects.create_user(username='cajero1', password='pass12345')
        cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        api = APIClient(); api.force_authenticate(user=cajero)

        r = api.post(f'/api/clientes/{self.destino.pk}/fusionar/',
                     {'origen_id': self.origen.pk}, format='json')

        self.assertEqual(r.status_code, 403)


# Sin esto las pruebas suben archivos a Cloudinary DE VERDAD: lentas, con red
# de por medio, y ensuciando la cuenta con basura de cada corrida.
@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class ComprobantesTest(TestCase):
    def setUp(self):
        from rest_framework.test import APIClient
        self.cli = Cliente.objects.create(tipo=Cliente.MORAL, nombre='Constructora del Bajío')
        self.admin = User.objects.create_user(username='admin1', password='pass12345', is_staff=True)
        self.cajero = User.objects.create_user(username='cajero1', password='pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()

    def _documento(self, vence=None):
        from clientes.models import DocumentoCliente
        from django.core.files.uploadedfile import SimpleUploadedFile
        return DocumentoCliente.objects.create(
            cliente=self.cli, tipo='domicilio', vence=vence,
            archivo=SimpleUploadedFile('recibo.pdf', b'%PDF-1.4 x'),
        )

    def test_la_vigencia_se_calcula_contra_hoy(self):
        from datetime import timedelta
        from django.utils import timezone
        vigente = self._documento(vence=timezone.localdate() + timedelta(days=30))
        vencido = self._documento(vence=timezone.localdate() - timedelta(days=1))
        sin_fecha = self._documento()

        self.assertTrue(vigente.vigente)
        self.assertFalse(vencido.vigente)
        self.assertTrue(sin_fecha.vigente)      # sin fecha = no caduca

    def test_el_mostrador_ve_que_existen_pero_NO_el_archivo(self):
        self._documento()
        self.api.force_authenticate(user=self.cajero)

        r = self.api.get(f'/api/clientes/{self.cli.pk}/documentos/')

        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data['documentos']), 1)
        self.assertIn('vigente', r.data['documentos'][0])
        self.assertNotIn('archivo', r.data['documentos'][0])   # adentro hay INEs

    def test_administracion_si_recibe_la_liga_del_archivo(self):
        self._documento()
        self.api.force_authenticate(user=self.admin)

        r = self.api.get(f'/api/clientes/{self.cli.pk}/documentos/')

        self.assertIn('archivo', r.data['documentos'][0])

    def test_el_mostrador_no_sube_comprobantes(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.api.force_authenticate(user=self.cajero)

        r = self.api.post(f'/api/clientes/{self.cli.pk}/documentos/',
                          {'tipo': 'ine', 'archivo': SimpleUploadedFile('ine.jpg', b'x')},
                          format='multipart')

        self.assertEqual(r.status_code, 403)

    def test_la_ficha_avisa_cuantos_estan_vencidos(self):
        from datetime import timedelta
        from django.utils import timezone
        self._documento(vence=timezone.localdate() - timedelta(days=1))
        self._documento()
        self.api.force_authenticate(user=self.cajero)

        r = self.api.get(f'/api/clientes/{self.cli.pk}/')

        self.assertEqual(r.data['documentos_vencidos'], 1)


class GarantiaTest(TestCase):
    """La pregunta que llega al mostrador: "¿todavía está en garantía?"."""

    def setUp(self):
        from decimal import Decimal
        from rest_framework.test import APIClient
        from inventario.models import Inventario
        from maquinaria.models import Equipo

        u = User.objects.create_user(username='cajero1', password='pass12345')
        u.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(user=u)

        self.cli = Cliente.objects.create(tipo=Cliente.FISICA, nombre='Jesús Ramírez',
                                          telefono='7441234567')
        self.equipo = Equipo.objects.create(modelo='EXC-200', precio_venta=Decimal('180000'))
        self.inv = Inventario.objects.create(equipo=self.equipo, condicion='nueva',
                                             estado='disponible', numero_serie='4471')

    def _vender(self, **extra):
        from decimal import Decimal
        from ventas.models import Venta
        return Venta.objects.create(cliente=self.cli, inventario=self.inv,
                                    precio_maquina=Decimal('180000'), **extra)

    def test_una_venta_nace_con_su_garantia_de_3_meses(self):
        from clientes.models import Garantia
        self.assertEqual(self.equipo.garantia_meses, 3)   # el default acordado

        venta = self._vender()

        g = Garantia.objects.get(venta=venta)
        self.assertEqual(g.meses, 3)
        self.assertTrue(g.vigente)
        self.assertIn('EXC-200', g.descripcion)
        self.assertIn('4471', g.descripcion)              # snapshot con la serie

    def test_una_maquina_sin_garantia_no_emite_nada(self):
        """Mejor ninguna garantía que una de cero días que alguien interprete."""
        from clientes.models import Garantia
        self.equipo.garantia_meses = 0
        self.equipo.save(update_fields=['garantia_meses'])

        venta = self._vender()

        self.assertFalse(Garantia.objects.filter(venta=venta).exists())

    def test_los_meses_son_por_maquina_no_una_regla_global(self):
        from clientes.models import Garantia
        self.equipo.garantia_meses = 12
        self.equipo.save(update_fields=['garantia_meses'])

        venta = self._vender()

        self.assertEqual(Garantia.objects.get(venta=venta).meses, 12)

    def test_la_vigencia_se_calcula_contra_hoy_no_se_guarda(self):
        from datetime import timedelta
        from django.utils import timezone
        from clientes.models import Garantia
        venta = self._vender()
        g = Garantia.objects.get(venta=venta)

        g.vence = timezone.localdate() - timedelta(days=1)
        g.save(update_fields=['vence'])

        self.assertFalse(g.vigente)      # nadie tuvo que marcarla como vencida

    def test_una_garantia_anulada_deja_de_valer_aunque_no_haya_vencido(self):
        from django.utils import timezone
        from clientes.models import Garantia
        g = Garantia.objects.get(venta=self._vender())

        g.anulada_en = timezone.now()
        g.anulada_motivo = 'uso indebido'
        g.save()

        self.assertFalse(g.vigente)

    def test_el_mostrador_la_ve_al_buscar_por_telefono(self):
        self._vender()

        r = self.api.get('/api/clientes/buscar/?telefono=7441234567')

        vigentes = r.data['clientes'][0]['resumen']['garantias_vigentes']
        self.assertEqual(len(vigentes), 1)
        self.assertIn('EXC-200', vigentes[0]['descripcion'])
        self.assertGreater(vigentes[0]['dias_restantes'], 0)

    def test_una_venta_cancelada_no_emite_garantia(self):
        from clientes.models import Garantia
        venta = self._vender(estado='cancelada')
        self.assertFalse(Garantia.objects.filter(venta=venta).exists())

    def test_sumar_meses_no_se_rompe_a_fin_de_mes(self):
        """31 de enero + 1 mes debe ser 28/29 de febrero, no reventar."""
        from datetime import date
        from clientes.models import Garantia
        venta = self._vender()
        Garantia.objects.filter(venta=venta).delete()

        g = Garantia.emitir(venta, meses=1, inicia=date(2026, 1, 31))

        self.assertEqual(g.vence, date(2026, 2, 28))
