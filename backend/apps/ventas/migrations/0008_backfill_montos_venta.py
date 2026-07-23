"""Desglosa subtotal / IVA en ventas existentes y fija precio_maquina.

Trata el `total` existente como IVA incluido (subtotal = total / 1.16).
Para ventas de máquina sin items, el total corresponde al precio de la máquina.
"""
from decimal import Decimal

from django.db import migrations

IVA = Decimal('0.16')


def backfill(apps, schema_editor):
    Venta = apps.get_model('ventas', 'Venta')
    for v in Venta.objects.all():
        total = Decimal(v.total or 0)
        if v.inventario_id and not v.items.exists():
            v.precio_maquina = total
        v.subtotal = (total / (Decimal('1.00') + IVA)).quantize(Decimal('0.01'))
        v.iva = (total - v.subtotal).quantize(Decimal('0.01'))
        if not v.estado:
            v.estado = 'activa'
        v.save(update_fields=['precio_maquina', 'subtotal', 'iva', 'estado'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('ventas', '0007_venta_empresa_venta_estado_venta_iva_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
