"""Cada venta que ya tenía una máquina estrena su renglón.

Sin esto, las ventas anteriores al cambio quedarían sin renglones: el total se
recalcularía en cero y la máquina vendida dejaría de aparecer en su propia
venta. Es reversible: deshacerla vacía la tabla sin tocar `Venta`.
"""

from django.db import migrations


def sembrar_renglones(apps, schema_editor):
    Venta = apps.get_model('ventas', 'Venta')
    VentaMaquina = apps.get_model('ventas', 'VentaMaquina')
    nuevos = []
    for venta in Venta.objects.exclude(inventario__isnull=True).select_related('inventario'):
        if VentaMaquina.objects.filter(venta=venta).exists():
            continue
        nuevos.append(VentaMaquina(
            venta=venta,
            inventario_id=venta.inventario_id,
            equipo_id=venta.inventario.equipo_id,
            precio=venta.precio_maquina or 0,
            entregada_en=venta.entregada_en,
        ))
    VentaMaquina.objects.bulk_create(nuevos, batch_size=200)


def borrar_renglones(apps, schema_editor):
    apps.get_model('ventas', 'VentaMaquina').objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [('ventas', '0026_ventamaquina')]

    operations = [
        migrations.RunPython(sembrar_renglones, borrar_renglones),
    ]
