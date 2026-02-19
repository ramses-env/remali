from django.db import migrations

class Migration(migrations.Migration):

    dependencies = [
        ('maquinaria', '0001_initial'),
    ]

    operations = [
        migrations.RenameModel(
            old_name='Coupon',
            new_name='Cupon',
        ),
        migrations.RenameField(
            model_name='cupon',
            old_name='code',
            new_name='codigo',
        ),
        migrations.RenameField(
            model_name='cupon',
            old_name='discount',
            new_name='descuento',
        ),
        migrations.RenameField(
            model_name='cupon',
            old_name='active',
            new_name='activo',
        ),
    ]
