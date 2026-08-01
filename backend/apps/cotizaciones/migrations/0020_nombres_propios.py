from django.db import migrations


def _np(texto):
    conectores = {'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von'}
    out = []
    for i, p in enumerate((texto or '').strip().split()):
        if p.isupper() and p.isalpha() and len(p) <= 3:
            out.append(p); continue
        pl = p.lower()
        out.append(pl if (i > 0 and pl in conectores) else (pl[:1].upper() + pl[1:]))
    return ' '.join(out)


def normalizar(apps, schema_editor):
    """Los nombres capturados antes de la regla (JAZMIN.../jazmin...) quedan
    como nombre propio; las siglas cortas (CSI, MG, SA) se respetan."""
    for etiqueta, campo in (('cotizaciones.Cotizacion', 'cliente_nombre'),
                            ('renta.Renta', 'cliente'),
                            ('ventas.Venta', 'nombre_cliente')):
        M = apps.get_model(etiqueta)
        for obj in M.objects.exclude(**{campo: ''}).exclude(**{f'{campo}__isnull': True}):
            v = getattr(obj, campo)
            n = _np(v)
            if n != v:
                setattr(obj, campo, n)
                obj.save(update_fields=[campo])


class Migration(migrations.Migration):
    dependencies = [
        ('cotizaciones', '0019_cotizacionitem_precio_lista_alter_cotizacion_folio'),
        ('renta', '0014_renta_pagos'),
        ('ventas', '0015_venta_ventas_estado_8766e5_idx'),
    ]
    operations = [migrations.RunPython(normalizar, migrations.RunPython.noop)]
