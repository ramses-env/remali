from django.db import migrations


def sembrar(apps, schema_editor):
    """La obra del perfil viejo se vuelve una ObraCliente predeterminada, y
    quien ya tenía obras guardadas recibe una predeterminada (la primera)."""
    User = apps.get_model('auth', 'User')
    Obra = apps.get_model('maquinaria', 'ObraCliente')
    Perfil = apps.get_model('maquinaria', 'PerfilUsuario')
    for u in User.objects.all():
        obras = list(Obra.objects.filter(usuario=u).order_by('nombre'))
        if not obras:
            p = Perfil.objects.filter(usuario=u).first()
            if p and (p.obra_direccion or '').strip():
                Obra.objects.create(
                    usuario=u, nombre='Obra principal',
                    direccion=p.obra_direccion.strip(),
                    responsable=(p.obra_responsable or '').strip(),
                    predeterminada=True,
                )
            continue
        if not any(o.predeterminada for o in obras):
            obras[0].predeterminada = True
            obras[0].save(update_fields=['predeterminada'])


class Migration(migrations.Migration):
    dependencies = [
        ('maquinaria', '0034_obracliente_predeterminada'),
    ]
    operations = [
        migrations.RunPython(sembrar, migrations.RunPython.noop),
    ]
