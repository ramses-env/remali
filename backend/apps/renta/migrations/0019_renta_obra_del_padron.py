"""La renta vuelve a tener obra, ahora la del padrón de clientes."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('renta', '0018_remove_renta_empresa_alter_renta_obra'),
        ('clientes', '0003_obra'),
    ]

    operations = [
        migrations.AddField(
            model_name='renta',
            name='obra',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='rentas', to='clientes.obra',
            ),
        ),
    ]
