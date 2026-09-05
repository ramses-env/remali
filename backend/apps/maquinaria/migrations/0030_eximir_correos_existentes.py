from django.db import migrations
from django.utils import timezone


def eximir_existentes(apps, schema_editor):
    """Las cuentas creadas ANTES del candado de correo obligatorio quedan
    eximidas: marcarlas verificadas evita bloquear el lunes a clientes reales
    que se registraron cuando confirmar era opcional."""
    Perfil = apps.get_model('maquinaria', 'PerfilUsuario')
    Perfil.objects.filter(email_verificado=False).update(
        email_verificado=True, email_verificado_en=timezone.now())


class Migration(migrations.Migration):
    dependencies = [('maquinaria', '0029_remove_mensajesoporte_conversacion_and_more')]
    operations = [migrations.RunPython(eximir_existentes, migrations.RunPython.noop)]
