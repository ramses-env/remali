"""Renta suelta la Empresa y la Obra VIEJAS.

Se quita `obra` en vez de re-apuntarla: `clientes.Obra` usa la misma tabla
(`obras`) que la vieja, así que no pueden coexistir. El orden obligado es
soltar → borrar la vieja → crear la nueva → volver a apuntar (renta 0019).
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('renta', '0017_renta_padron_clientes'),
    ]

    operations = [
        migrations.RemoveField(model_name='renta', name='empresa'),
        migrations.RemoveField(model_name='renta', name='obra'),
    ]
