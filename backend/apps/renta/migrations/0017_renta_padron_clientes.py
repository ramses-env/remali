"""Renta entra al padrón de clientes.

ESCRITA A MANO a propósito. El campo `cliente` pasa de CharField a ForeignKey,
y el autodetector de Django no puede distinguir eso de un "borra la columna y
crea otra": vería el CharField desaparecer y un FK aparecer con el mismo nombre,
y generaría un DROP COLUMN que se lleva los nombres de todas las rentas de
mostrador.

El orden importa: primero se RENOMBRA (la columna y sus datos sobreviven, solo
cambia de nombre), y solo entonces se agrega el FK con el nombre ya libre.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('renta', '0016_renta_renta_origen'),
        ('clientes', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1) Libera el nombre `cliente` conservando los datos.
        migrations.RenameField(
            model_name='renta',
            old_name='cliente',
            new_name='cliente_texto',
        ),
        # 2) Ya con el nombre libre, entra la identidad nueva.
        migrations.AddField(
            model_name='renta',
            name='cliente',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='rentas',
                to='clientes.cliente',
            ),
        ),
        migrations.AddField(
            model_name='renta',
            name='contacto',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='rentas',
                to='clientes.contacto',
            ),
        ),
    ]
