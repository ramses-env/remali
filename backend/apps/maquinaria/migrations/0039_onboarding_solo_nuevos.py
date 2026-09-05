from django.db import migrations


def marcar_existentes_como_completado(apps, schema_editor):
    """La guía de primer uso es SOLO para cuentas nuevas.

    Los clientes que ya existían cuando se implementó no deben verla de golpe al
    entrar, así que su onboarding se marca como completado. A partir de aquí, solo
    quien se registre (por correo o Google) arranca con onboarding pendiente y ve
    la guía una vez.
    """
    from django.utils import timezone
    PerfilUsuario = apps.get_model('maquinaria', 'PerfilUsuario')
    (PerfilUsuario.objects
        .filter(onboarding_completado=False)
        .update(onboarding_completado=True, onboarding_finalizado_en=timezone.now()))


def revertir(apps, schema_editor):
    # No se puede reconstruir quiénes eran "nuevos" antes de esto; al revertir
    # no tocamos nada (dejar el estado como quedó es lo seguro).
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('maquinaria', '0038_onboarding_guia_primer_uso'),
    ]

    operations = [
        migrations.RunPython(marcar_existentes_como_completado, revertir),
    ]
