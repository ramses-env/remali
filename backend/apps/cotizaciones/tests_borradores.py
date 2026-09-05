"""El taller privado del cliente.

Lo que estas pruebas cuidan no es que "funcione": es que REMALI NO se entere.
Un borrador que se cuela al panel, o un folio que se quema porque el jefe de un
cliente rechazó una versión, son exactamente los defectos que este módulo
existe para impedir.
"""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from cotizaciones.models_borrador import BorradorCliente, BorradorItem
from maquinaria.models import Equipo


class BorradorPrecioTests(TestCase):
    """El borrador no trae precio firme hasta que se manda a autorizar."""

    def setUp(self):
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.eq = Equipo.objects.create(modelo='Revolvedora 1S', precio_venta=Decimal('11600'))

    def test_borrador_sin_congelar_sigue_al_catalogo(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        self.assertEqual(b.total, Decimal('11600.00'))

        self.eq.precio_venta = Decimal('12000')
        self.eq.save(update_fields=['precio_venta'])
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).total, Decimal('12000.00'))

    def test_congelar_deja_el_precio_en_piedra(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        b.congelar()
        b.estado = 'esperando'
        b.save(update_fields=['estado'])

        self.eq.precio_venta = Decimal('99000')
        self.eq.save(update_fields=['precio_venta'])
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).total, Decimal('11600.00'))

    def test_equipo_borrado_sale_del_total_y_se_avisa(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        self.eq.delete()
        b = BorradorCliente.objects.get(pk=b.pk)
        self.assertEqual(b.total, Decimal('0.00'))
        self.assertFalse(b.lineas()[0]['disponible'])

    def test_renta_multiplica_cantidad_por_periodos(self):
        eq = Equipo.objects.create(modelo='Rotomartillo', precio_dia=Decimal('300'))
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=eq, cantidad=2, duracion=4, modalidad='dia')
        # 2 máquinas × 4 días × $300, sin factura: la renta no suma IVA.
        self.assertEqual(b.total, Decimal('2400.00'))
        self.assertEqual(b.tipo, 'renta')


class DuenoUnicoTests(TestCase):
    """El invariante que sostiene la privacidad: un dueño, nunca dos."""

    def test_no_se_puede_tener_cuenta_y_espacio_a_la_vez(self):
        from django.db.utils import IntegrityError
        user = get_user_model().objects.create_user('c2', password='x')
        with self.assertRaises(IntegrityError):
            BorradorCliente.objects.create(usuario=user, espacio_token='a' * 32)

    def test_no_se_puede_quedar_sin_dueno(self):
        from django.db.utils import IntegrityError
        with self.assertRaises(IntegrityError):
            BorradorCliente.objects.create()


class CotizacionLimpiaTests(TestCase):
    """La cotización de REMALI ya no carga la etapa privada del cliente."""

    def test_ya_no_existe_el_estado_por_autorizar(self):
        from cotizaciones.models import Cotizacion
        self.assertNotIn('por_autorizar', dict(Cotizacion.ESTADOS))

    def test_ya_no_tiene_los_campos_de_autorizacion_interna(self):
        from cotizaciones.models import Cotizacion
        campos = {f.name for f in Cotizacion._meta.get_fields()}
        self.assertNotIn('token_autorizacion', campos)
        self.assertNotIn('token_lote', campos)
        self.assertNotIn('autorizacion_rechazo', campos)
        # Estos SÍ se quedan: a REMALI le sirve saber que llegó firmada.
        self.assertIn('autorizada_por', campos)
        self.assertIn('autorizada_en', campos)

    def test_el_desglose_del_modelo_sale_de_precios(self):
        from cotizaciones import precios
        from cotizaciones.models import Cotizacion, CotizacionItem
        cot = Cotizacion.objects.create(estado='enviada', aplica_iva=False)
        CotizacionItem.objects.create(cotizacion=cot, descripcion='x', cantidad=1,
                                      precio_unitario=Decimal('11600'), modalidad='venta')
        base, iva = precios.desglose(Decimal('11600'), Decimal('0'), False)
        self.assertEqual(cot.base, base)
        self.assertEqual(cot.iva, iva)


class BorradoresAPITests(TestCase):
    """El cliente sobre sus borradores: con cuenta y sin ella."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()   # el throttle cuenta en cache: sin esto los casos se estorban
        self.eq = Equipo.objects.create(modelo='Rotomartillo', precio_venta=Decimal('5800'))
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.c = APIClient()

    def test_invitado_recibe_su_espacio_al_crear_el_primero(self):
        r = self.c.post('/api/borradores/', {'nombre': 'Opción A',
                                             'items': [{'id': self.eq.id, 'cantidad': 1}]}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.data['espacio_token']), 32)
        self.assertEqual(Decimal(r.data['borrador']['total']), Decimal('5800.00'))

    def test_el_espacio_ajeno_da_404_no_403(self):
        """404 y no 403: un 403 le confirma al curioso que el borrador existe."""
        from rest_framework.test import APIClient
        r = self.c.post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
        bid = r.data['borrador']['id']
        otro = APIClient()
        otro.credentials(HTTP_X_ESPACIO='0' * 32)
        self.assertEqual(otro.get(f'/api/borradores/{bid}/').status_code, 404)

    def test_tope_de_borradores(self):
        self.c.force_authenticate(self.user)
        for _ in range(20):
            BorradorCliente.objects.create(usuario=self.user)
        r = self.c.post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'limite_borradores')

    def test_duplicar_hace_una_version_nueva_editable(self):
        self.c.force_authenticate(self.user)
        b = BorradorCliente.objects.create(usuario=self.user, estado='rechazado',
                                           rechazo_motivo='muy caro', nombre='v1')
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=2, modalidad='venta')
        r = self.c.post(f'/api/borradores/{b.id}/duplicar/', {}, format='json')
        self.assertEqual(r.status_code, 201)
        nuevo = BorradorCliente.objects.get(pk=r.data['borrador']['id'])
        self.assertEqual(nuevo.estado, 'armando')
        self.assertEqual(nuevo.items.count(), 1)
        self.assertEqual(nuevo.rechazo_motivo, '')
        # El rechazado se queda como estaba: es el registro de lo que el jefe juzgó.
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).estado, 'rechazado')


class AutorizacionTests(TestCase):
    """La liga del jefe. Lo que se cuida aquí es que REMALI NO se entere."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()   # el throttle cuenta en cache: sin esto los casos se estorban
        self.eq = Equipo.objects.create(modelo='Revolvedora', precio_venta=Decimal('11600'))
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.c = APIClient()
        self.c.force_authenticate(self.user)

    def _borrador(self):
        b = BorradorCliente.objects.create(usuario=self.user,
                                           datos_contacto={'nombre': 'Ana', 'telefono': '3312345678'})
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        return b

    def _mandar(self, borradores, modo='lista'):
        r = self.c.post('/api/autorizaciones/',
                        {'borradores': [b.id for b in borradores], 'modo': modo}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        return r.data['token']

    def _resolver(self, token, decisiones, nombre='Ing. Pérez'):
        from rest_framework.test import APIClient
        return APIClient().post(f'/api/autorizacion/{token}/',
                                {'nombre': nombre, 'decisiones': decisiones}, format='json')

    def test_rechazar_no_deja_rastro_en_remali(self):
        from cotizaciones.models import Cotizacion
        b = self._borrador()
        token = self._mandar([b])
        self._resolver(token, [{'borrador': b.id, 'accion': 'rechazar', 'motivo': 'muy caro'}])
        self.assertEqual(Cotizacion.objects.count(), 0)
        b = BorradorCliente.objects.get(pk=b.pk)
        self.assertEqual(b.estado, 'rechazado')
        self.assertEqual(b.rechazo_motivo, 'muy caro')

    def test_tres_rechazos_no_queman_folios(self):
        """Lo que el cliente rechace internamente no gasta el consecutivo anual."""
        from cotizaciones.models import Cotizacion
        for _ in range(3):
            b = self._borrador()
            t = self._mandar([b])
            self._resolver(t, [{'borrador': b.id, 'accion': 'rechazar'}])

        b = self._borrador()
        t = self._mandar([b])
        self._resolver(t, [{'borrador': b.id, 'accion': 'autorizar'}])

        cot = Cotizacion.objects.get()
        self.assertTrue(cot.folio.endswith('-0001'), cot.folio)
        self.assertEqual(cot.estado, 'aceptada')
        self.assertEqual(cot.origen, 'cliente')
        self.assertEqual(cot.autorizada_por, 'Ing. Pérez')
        self.assertEqual(cot.total, Decimal('11600.00'))

    def test_modo_opciones_solo_deja_autorizar_una(self):
        from cotizaciones.models import Cotizacion
        a, b = self._borrador(), self._borrador()
        t = self._mandar([a, b], modo='opciones')
        r = self._resolver(t, [{'borrador': a.id, 'accion': 'autorizar'},
                               {'borrador': b.id, 'accion': 'autorizar'}])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'opciones_una_sola')
        self.assertEqual(Cotizacion.objects.count(), 0)

    def test_opciones_rechaza_sola_la_no_elegida(self):
        a, b = self._borrador(), self._borrador()
        t = self._mandar([a, b], modo='opciones')
        self._resolver(t, [{'borrador': a.id, 'accion': 'autorizar'}])
        b = BorradorCliente.objects.get(pk=b.pk)
        self.assertEqual(b.estado, 'rechazado')
        self.assertEqual(b.rechazo_motivo, 'No seleccionada')

    def test_lista_autoriza_unas_y_rechaza_otras(self):
        from cotizaciones.models import Cotizacion
        a, b, c = self._borrador(), self._borrador(), self._borrador()
        t = self._mandar([a, b, c], modo='lista')
        self._resolver(t, [{'borrador': a.id, 'accion': 'autorizar'},
                           {'borrador': b.id, 'accion': 'autorizar'},
                           {'borrador': c.id, 'accion': 'rechazar', 'motivo': 'no cabe'}])
        self.assertEqual(Cotizacion.objects.count(), 2)
        folios = sorted(Cotizacion.objects.values_list('folio', flat=True))
        self.assertTrue(folios[0].endswith('-0001') and folios[1].endswith('-0002'), folios)

    def test_paquete_vencido_no_se_autoriza(self):
        from datetime import timedelta
        from django.utils import timezone
        from cotizaciones.models_borrador import PaqueteAutorizacion
        b = self._borrador()
        t = self._mandar([b])
        PaqueteAutorizacion.objects.filter(token=t).update(
            vence_el=timezone.now().date() - timedelta(days=1))
        r = self._resolver(t, [{'borrador': b.id, 'accion': 'autorizar'}])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'paquete_vencido')

    def test_segunda_visita_del_jefe_no_es_error_ni_duplica(self):
        from cotizaciones.models import Cotizacion
        b = self._borrador()
        t = self._mandar([b])
        d = [{'borrador': b.id, 'accion': 'autorizar'}]
        self._resolver(t, d)
        r = self._resolver(t, d)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['ya_resuelto'])
        self.assertEqual(Cotizacion.objects.count(), 1)

    def test_el_precio_congelado_manda_aunque_suba_el_catalogo(self):
        from cotizaciones.models import Cotizacion
        b = self._borrador()
        t = self._mandar([b])
        self.eq.precio_venta = Decimal('99000')      # el catálogo sube mientras el jefe decide
        self.eq.save(update_fields=['precio_venta'])
        self._resolver(t, [{'borrador': b.id, 'accion': 'autorizar'}])
        self.assertEqual(Cotizacion.objects.get().total, Decimal('11600.00'))

    def test_retirar_el_paquete_devuelve_los_borradores_a_armando(self):
        b = self._borrador()
        t = self._mandar([b])
        from cotizaciones.models_borrador import PaqueteAutorizacion
        pid = PaqueteAutorizacion.objects.get(token=t).id
        r = self.c.delete(f'/api/autorizaciones/{pid}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).estado, 'armando')


class EspacioTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()   # el throttle cuenta en cache: sin esto los casos se estorban
        self.eq = Equipo.objects.create(modelo='Cortadora', precio_venta=Decimal('9000'))
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.c = APIClient()

    def test_al_iniciar_sesion_los_borradores_se_reclaman(self):
        r = self.c.post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
        token = r.data['espacio_token']
        self.c.force_authenticate(self.user)
        self.c.credentials(HTTP_X_ESPACIO=token)
        r = self.c.post('/api/espacio/reclamar/', {}, format='json')
        self.assertEqual(r.data['reclamados'], 1)
        b = BorradorCliente.objects.get()
        self.assertEqual(b.usuario_id, self.user.id)
        self.assertIsNone(b.espacio_token)   # el CheckConstraint lo exige


class BorradorVacioTests(TestCase):
    """Un borrador que no se pudo armar no debe quedar guardado a medias."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()
        self.c = APIClient()

    def test_equipos_inexistentes_no_dejan_borrador_fantasma(self):
        r = self.c.post('/api/borradores/', {'items': [{'id': 999999}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'equipo_no_disponible')
        self.assertEqual(BorradorCliente.objects.count(), 0)


class PurgaTests(TestCase):
    def test_purga_solo_los_de_invitado(self):
        from datetime import timedelta
        from django.core.management import call_command
        from django.utils import timezone

        user = get_user_model().objects.create_user('c3', password='x')
        viejo_invitado = BorradorCliente.objects.create(espacio_token='a' * 32)
        viejo_de_cuenta = BorradorCliente.objects.create(usuario=user)
        BorradorCliente.objects.filter(pk__in=[viejo_invitado.pk, viejo_de_cuenta.pk]).update(
            actualizado=timezone.now() - timedelta(days=400))

        call_command('purgar_borradores')

        self.assertFalse(BorradorCliente.objects.filter(pk=viejo_invitado.pk).exists())
        # El de cuenta nunca se purga: el cliente tiene dónde volver por él.
        self.assertTrue(BorradorCliente.objects.filter(pk=viejo_de_cuenta.pk).exists())


class PedirCambiosTests(TestCase):
    """El jefe casi nunca dice solo sí o no: dice 'sí, pero quítale el compresor'."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()
        self.eq = Equipo.objects.create(modelo='Compresor', precio_venta=Decimal('23200'))
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.c = APIClient()
        self.c.force_authenticate(self.user)

    def _borrador(self):
        b = BorradorCliente.objects.create(usuario=self.user, datos_contacto={'nombre': 'Ana'})
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        return b

    def _mandar(self, bs, modo='lista'):
        r = self.c.post('/api/autorizaciones/', {'borradores': [b.id for b in bs], 'modo': modo}, format='json')
        return r.data['token']

    def test_pedir_cambios_devuelve_el_borrador_editable(self):
        from cotizaciones.models import Cotizacion
        from rest_framework.test import APIClient
        b = self._borrador()
        t = self._mandar([b])
        r = APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'Ing. Pérez', 'decisiones': [
            {'borrador': b.id, 'accion': 'cambios', 'motivo': 'Quítale el compresor'}]}, format='json')
        self.assertEqual(r.status_code, 200)

        b = BorradorCliente.objects.get(pk=b.pk)
        # Vuelve a sus manos: editable y con el precio siguiendo al catálogo otra vez.
        self.assertEqual(b.estado, 'armando')
        self.assertFalse(b.congelado)
        self.assertIsNone(b.paquete_id)
        self.assertEqual(b.cambios_pedidos, 'Quítale el compresor')
        # Y REMALI sigue sin enterarse de nada.
        self.assertEqual(Cotizacion.objects.count(), 0)

    def test_pedir_cambios_cierra_el_paquete(self):
        """El jefe ya contestó: esa liga no debe seguir viva esperando."""
        from cotizaciones.models_borrador import PaqueteAutorizacion
        from rest_framework.test import APIClient
        b = self._borrador()
        t = self._mandar([b])
        APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': b.id, 'accion': 'cambios', 'motivo': 'muy caro'}]}, format='json')
        self.assertEqual(PaqueteAutorizacion.objects.get(token=t).estado, 'resuelto')

    def test_al_reeditar_se_limpia_lo_que_pidieron(self):
        """Si ya lo corrigió, el aviso deja de tener sentido en su pantalla."""
        b = self._borrador()
        b.cambios_pedidos = 'Quítale el compresor'
        b.save(update_fields=['cambios_pedidos'])
        r = self.c.patch(f'/api/borradores/{b.id}/', {'nombre': 'v2'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).cambios_pedidos, '')

    def test_mezclar_las_tres_decisiones(self):
        from cotizaciones.models import Cotizacion
        from rest_framework.test import APIClient
        a, b, c = self._borrador(), self._borrador(), self._borrador()
        t = self._mandar([a, b, c], modo='lista')
        APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': a.id, 'accion': 'autorizar'},
            {'borrador': b.id, 'accion': 'cambios', 'motivo': 'baja la cantidad'},
            {'borrador': c.id, 'accion': 'rechazar', 'motivo': 'no'}]}, format='json')
        self.assertEqual(Cotizacion.objects.count(), 1)          # solo la autorizada cruzó
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).estado, 'armando')
        self.assertEqual(BorradorCliente.objects.get(pk=c.pk).estado, 'rechazado')


@patch('maquinaria.correo.enviar_async', return_value=True)
class RecordatorioTests(TestCase):
    """Una liga que nadie contesta es una venta enfriándose.

    El aviso va al CLIENTE, nunca a REMALI: el negocio no tiene por qué saber
    que el jefe de alguien no ha contestado.
    """

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()
        self.eq = Equipo.objects.create(modelo='Planta', precio_venta=Decimal('11600'))
        self.user = get_user_model().objects.create_user('cliente', password='x', email='ana@obra.mx')
        self.c = APIClient()
        self.c.force_authenticate(self.user)

    def _paquete_de(self, dias):
        from datetime import timedelta
        from django.utils import timezone
        from cotizaciones.models_borrador import PaqueteAutorizacion
        b = BorradorCliente.objects.create(usuario=self.user, datos_contacto={'nombre': 'Ana', 'email': 'ana@obra.mx'})
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        t = self.c.post('/api/autorizaciones/', {'borradores': [b.id]}, format='json').data['token']
        p = PaqueteAutorizacion.objects.get(token=t)
        PaqueteAutorizacion.objects.filter(pk=p.pk).update(congelado_en=timezone.now() - timedelta(days=dias))
        return PaqueteAutorizacion.objects.get(pk=p.pk)

    def test_avisa_al_cliente_y_no_a_remali(self, _correo):
        from django.core.management import call_command
        from maquinaria.models import Notificacion
        p = self._paquete_de(6)
        call_command('recordar_autorizaciones')

        mias = Notificacion.objects.filter(usuario=self.user)
        self.assertEqual(mias.count(), 1)
        self.assertIn('no ha', mias.first().titulo.lower())
        # Nada para el panel: una notificación sin usuario es de REMALI.
        self.assertEqual(Notificacion.objects.filter(usuario__isnull=True).count(), 0)
        from cotizaciones.models_borrador import PaqueteAutorizacion
        self.assertIsNotNone(PaqueteAutorizacion.objects.get(pk=p.pk).recordatorio_en)

    def test_no_avisa_antes_de_tiempo(self, _correo):
        from django.core.management import call_command
        from maquinaria.models import Notificacion
        self._paquete_de(2)
        call_command('recordar_autorizaciones')
        self.assertEqual(Notificacion.objects.count(), 0)

    def test_no_repite_el_aviso(self, _correo):
        from django.core.management import call_command
        from maquinaria.models import Notificacion
        self._paquete_de(9)
        call_command('recordar_autorizaciones')
        call_command('recordar_autorizaciones')
        self.assertEqual(Notificacion.objects.filter(usuario=self.user).count(), 1)

    def test_no_avisa_de_lo_ya_resuelto(self, _correo):
        from django.core.management import call_command
        from maquinaria.models import Notificacion
        from cotizaciones.models_borrador import PaqueteAutorizacion
        p = self._paquete_de(8)
        PaqueteAutorizacion.objects.filter(pk=p.pk).update(estado='resuelto')
        call_command('recordar_autorizaciones')
        self.assertEqual(Notificacion.objects.count(), 0)
