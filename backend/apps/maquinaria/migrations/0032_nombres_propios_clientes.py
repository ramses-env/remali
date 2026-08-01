from django.db import migrations


def _nombre_propio(texto):
    conectores = {'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von'}
    palabras = (texto or '').strip().split()
    out = []
    for i, p in enumerate(palabras):
        pl = p.lower()
        out.append(pl if (i > 0 and pl in conectores) else (pl[:1].upper() + pl[1:]))
    return ' '.join(out)


def normalizar(apps, schema_editor):
    """Los clientes ya registrados con "jazmin mendoza" quedan "Jazmin Mendoza";
    de aquí en adelante lo garantiza nombre_propio() en cada entrada."""
    User = apps.get_model('auth', 'User')
    for u in User.objects.filter(groups__name='Cliente'):
        fn, ln = _nombre_propio(u.first_name), _nombre_propio(u.last_name)
        if fn != u.first_name or ln != u.last_name:
            u.first_name, u.last_name = fn, ln
            u.save(update_fields=['first_name', 'last_name'])


class Migration(migrations.Migration):
    dependencies = [('maquinaria', '0031_notificacion_usuario')]
    operations = [migrations.RunPython(normalizar, migrations.RunPython.noop)]
