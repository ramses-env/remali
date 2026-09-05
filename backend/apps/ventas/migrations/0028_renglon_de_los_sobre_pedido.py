"""Cada SOBRE PEDIDO estrena su renglón, aunque su máquina no haya llegado.

Un sobre pedido nace sin unidad física —está en la bodega del proveedor—, y por
eso `_sembrar_renglon_inicial` lo dejaba fuera: se guardaba sin ningún renglón.
Al entregarlo, el modelo miraba sus renglones, no encontraba ninguno y contestaba
"esta venta ya no tiene máquinas por entregar". O sea: un pedido sobre pedido no
se podía entregar nunca, por más que hubiera llegado y estuviera liquidado.

Esta migración les arma el renglón que les faltó, con el equipo que se pidió y su
precio. La unidad se asigna al entregar, que es para lo que existe
`VentaMaquina.equipo`. Reversible: deshacerla borra solo estos renglones (los que
nunca tuvieron unidad), sin tocar los de las ventas con máquina.
"""

from django.db import migrations


def sembrar_renglones(apps, schema_editor):
    Venta = apps.get_model('ventas', 'Venta')
    VentaMaquina = apps.get_model('ventas', 'VentaMaquina')
    nuevos = []
    pedidos = Venta.objects.filter(inventario__isnull=True).exclude(equipo__isnull=True)
    for venta in pedidos:
        if VentaMaquina.objects.filter(venta=venta).exists():
            continue
        nuevos.append(VentaMaquina(
            venta=venta,
            inventario_id=None,
            equipo_id=venta.equipo_id,
            precio=venta.precio_maquina or 0,
            entregada_en=venta.entregada_en,
        ))
    VentaMaquina.objects.bulk_create(nuevos, batch_size=200)


def borrar_renglones(apps, schema_editor):
    apps.get_model('ventas', 'VentaMaquina').objects.filter(inventario__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [('ventas', '0027_renglon_de_las_ventas_viejas')]

    operations = [
        migrations.RunPython(sembrar_renglones, borrar_renglones),
    ]
