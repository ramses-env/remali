"""El cupón de bienvenida deja de ser eterno: vale 3 meses.

Los que ya se emitieron llevaban sin fecha, y dejarlos así crearía dos reglas
conviviendo —unos vencen y otros no— que nadie podría explicarle a un cliente
por teléfono. Se les cuenta la vigencia desde el día en que se emitieron, que
es lo que el cliente entendió cuando se lo prometimos.

Solo se toca 'perfil'. Los genéricos que el admin creó a mano (VERANO2026 y
compañía) siguen sin fecha: los apaga él con `activo`, y ponerles un
vencimiento que nunca pactó sería cambiarle una promoción viva por la espalda.
"""
from django.db import migrations, models


def fechar_los_de_bienvenida(apps, schema_editor):
    from server.periodos import mas_meses

    Cupon = apps.get_model('maquinaria', 'Cupon')
    for c in Cupon.objects.filter(motivo='perfil', expira__isnull=True).iterator():
        # `creado` es null=True de origen: sin él no hay desde cuándo contar y
        # el cupón se queda como estaba (mejor eterno que vencido de golpe).
        if c.creado:
            c.expira = mas_meses(c.creado, 3)
            c.save(update_fields=['expira'])


def sin_vuelta(apps, schema_editor):
    """Al revés solo se borra la columna; no hay nada que restaurar."""


class Migration(migrations.Migration):

    dependencies = [
        ('maquinaria', '0063_bienvenida_enviada'),
    ]

    operations = [
        migrations.AddField(
            model_name='cupon',
            name='expira',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(fechar_los_de_bienvenida, sin_vuelta),
    ]
