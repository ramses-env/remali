"""Rellena precio_unitario / subtotal / total en rentas existentes.

Toma el precio de catálogo del equipo según la modalidad de cada renta.
Idempotente: solo toca rentas cuyo precio_unitario esté en 0.
"""
from decimal import Decimal

from django.db import migrations


def backfill(apps, schema_editor):
    Renta = apps.get_model('renta', 'Renta')
    for r in Renta.objects.select_related('inventario', 'inventario__equipo').all():
        if r.precio_unitario and r.precio_unitario != 0:
            continue
        eq = r.inventario.equipo if r.inventario_id else None
        precio = None
        if eq:
            precio = {
                'dia': eq.precio_dia,
                'semana': eq.precio_semana,
                'mes': eq.precio_mes,
            }.get(r.modalidad)
        precio = Decimal(precio) if precio is not None else Decimal('0.00')
        dur = max(r.duracion or 1, 1)
        r.precio_unitario = precio
        r.subtotal = (precio * Decimal(dur)).quantize(Decimal('0.01'))
        r.total = (r.subtotal - (r.descuento or 0) + (r.recargo or 0)).quantize(Decimal('0.01'))
        r.save(update_fields=['precio_unitario', 'subtotal', 'total'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('renta', '0004_renta_deposito_renta_descuento_renta_empresa_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
