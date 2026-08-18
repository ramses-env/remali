"""El taller privado del cliente.

Lo que estas pruebas cuidan no es que "funcione": es que REMALI NO se entere.
Un borrador que se cuela al panel, o un folio que se quema porque el jefe de un
cliente rechazó una versión, son exactamente los defectos que este módulo
existe para impedir.
"""
from decimal import Decimal

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
