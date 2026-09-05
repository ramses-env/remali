"""Empresa y Obra mueren: su contenido vive en el padrón de clientes.

Una constructora es un `clientes.Cliente(tipo='moral')` y las obras cuelgan del
cliente (`clientes.Obra`). Eran la misma idea escrita dos veces.

Depende de que ventas, rentas, cotizaciones, reparaciones y facturación ya
hayan soltado sus FK: no se puede borrar una tabla que alguien todavía apunta.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('empresas', '0004_obra_cliente_alter_obra_empresa'),
        ('ventas', '0023_remove_venta_empresa'),
        ('renta', '0018_remove_renta_empresa_alter_renta_obra'),
        ('cotizaciones', '0028_remove_cotizacion_empresa'),
        ('inventario', '0018_remove_ordenreparacion_empresa'),
        ('facturacion', '0002_remove_solicitudfactura_empresa_and_more'),
    ]

    operations = [
        # Sin RemoveField ni AlterUniqueTogether: la tabla se borra entera y se
        # lleva sus columnas, sus FK y sus índices. Tocarlos antes solo daba
        # problemas —MySQL buscaba una restricción que ya no estaba—.
        # Obra va primero: apunta a Empresa.
        migrations.DeleteModel(name='Obra'),
        migrations.DeleteModel(name='Empresa'),
    ]
