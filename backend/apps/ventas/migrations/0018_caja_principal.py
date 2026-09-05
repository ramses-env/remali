"""Siembra la caja principal, para que el POS tenga a dónde abrir sesión sin
configurar nada. Se pueden crear más cajas después."""
from django.db import migrations


def crear(apps, schema_editor):
    Caja = apps.get_model('ventas', 'Caja')
    Caja.objects.get_or_create(nombre='Caja principal', defaults={'activa': True})


def borrar(apps, schema_editor):
    # Solo si no tiene sesiones: deshacer no debe romper el historial.
    Caja = apps.get_model('ventas', 'Caja')
    c = Caja.objects.filter(nombre='Caja principal').first()
    if c and not c.sesiones.exists():
        c.delete()


class Migration(migrations.Migration):
    dependencies = [('ventas', '0017_caja_sesioncaja_movimientocaja_and_more')]
    operations = [migrations.RunPython(crear, borrar)]
