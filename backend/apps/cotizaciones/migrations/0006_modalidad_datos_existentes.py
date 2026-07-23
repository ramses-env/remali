"""Rellena `modalidad` en las partidas que ya existían.

Antes la modalidad no se guardaba: la tienda la dejaba escrita en la descripción
("… · renta por semana") y el resto se asumía venta. Aquí la recuperamos de ahí,
y si no hay pista usamos el tipo de la cotización.
"""
from django.db import migrations

PISTAS = [('renta por día', 'dia'), ('renta por semana', 'semana'), ('renta por mes', 'mes')]


def poblar(apps, schema_editor):
    CotizacionItem = apps.get_model('cotizaciones', 'CotizacionItem')
    for item in CotizacionItem.objects.select_related('cotizacion').all():
        desc = (item.descripcion or '').lower()
        modalidad = next((m for pista, m in PISTAS if pista in desc), None)
        if modalidad is None:
            modalidad = 'dia' if item.cotizacion.tipo == 'renta' else 'venta'
        if item.modalidad != modalidad:
            item.modalidad = modalidad
            item.save(update_fields=['modalidad'])


class Migration(migrations.Migration):
    dependencies = [('cotizaciones', '0005_cotizacionitem_modalidad_alter_cotizacion_tipo')]

    # Sin reversa: al quitar la columna la información se pierde igual.
    operations = [migrations.RunPython(poblar, migrations.RunPython.noop)]
