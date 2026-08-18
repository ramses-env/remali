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
