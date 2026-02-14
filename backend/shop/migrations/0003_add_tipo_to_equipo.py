from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):

    dependencies = [
        ('shop', '0002_rename_coupon_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='equipo',
            name='tipo',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='equipos', to='shop.tipo'),
        ),
    ]
