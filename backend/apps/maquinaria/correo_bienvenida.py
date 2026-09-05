"""El correo de bienvenida: la primera cosa que Remali le dice a un cliente nuevo.

Va en una SEÑAL, y no dentro de la vista de registro, por la misma razón que el
cupón de [cupon_bienvenida]: darse de alta no ocurre en un solo sitio. Está el
registro con contraseña, está entrar con Google (que también crea la cuenta) y
está confirmar el correo por código —tres caminos, cinco puntos del código donde
`email_verificado` pasa a True—. Un saludo colgado de uno solo de ellos es un
saludo que la mitad de los clientes nunca recibe.

Y no se manda al crear la cuenta, sino al CONFIRMAR el correo, por dos razones:
en ese momento el registro compite con el código de verificación (dos correos
en el mismo segundo, y el importante es el del código), y una cuenta sin
confirmar todavía no es un cliente —darle la bienvenida gasta cuota del plan en
buzones que quizá ni existen—. Para quien entra con Google las dos cosas pasan
a la vez, así que recibe su bienvenida de inmediato.

El diseño vive en Brevo (BREVO_BIENVENIDA_TEMPLATE_ID) para que la empresa lo
edite sin tocar código. Sin esa variable NO se manda nada: mejor callar que
mandar a nombre de Remali un correo que nadie diseñó.
"""
import os

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from server.rastro import tragado


def _plantilla():
    return (os.environ.get('BREVO_BIENVENIDA_TEMPLATE_ID') or '').strip()


def toca_bienvenida(perfil) -> bool:
    """¿Este perfil merece el saludo, ahora mismo?

    Solo CLIENTES: al equipo lo da de alta el panel y ya sabe qué es Remali.
    """
    from .permissions import nivel_de

    if perfil.bienvenida_enviada or not perfil.email_verificado:
        return False
    usuario = perfil.usuario
    if not usuario or not usuario.email:
        return False
    return nivel_de(usuario) <= 0


def enviar_si_toca(perfil):
    """Manda la bienvenida una vez. Devuelve True si se encoló."""
    from .correo import enviar_plantilla_brevo

    if not toca_bienvenida(perfil):
        return False
    plantilla = _plantilla()
    if not plantilla:
        return False

    usuario = perfil.usuario
    nombre = (usuario.first_name or '').strip() or usuario.username
    frontend = os.environ.get('FRONTEND_URL', '').strip()

    encolado = enviar_plantilla_brevo(plantilla, usuario.email, nombre, {
        'nombre': nombre,
        'correo': usuario.email,
        'link': frontend,
    })
    if not encolado:
        return False

    # `update` y no `save()`: esto corre dentro del post_save del propio perfil.
    type(perfil).objects.filter(pk=perfil.pk).update(bienvenida_enviada=True)
    perfil.bienvenida_enviada = True
    return True


def conectar():
    from .models import PerfilUsuario

    # `weak=False`: la función se define aquí dentro y Django guarda los
    # receptores por referencia débil; sin esto el recolector se la lleva en
    # cuanto `conectar()` termina y la señal queda registrada pero muda.
    @receiver(post_save, sender=PerfilUsuario, dispatch_uid='correo_bienvenida', weak=False)
    def _al_guardar_perfil(sender, instance, **kwargs):
        if not toca_bienvenida(instance):
            return

        # `on_commit` porque el alta con Google guarda el perfil DENTRO de una
        # transacción: si algo la revierte después, no queremos haber saludado a
        # una cuenta que nunca existió. Fuera de transacción corre al instante.
        def _mandar():
            try:
                enviar_si_toca(instance)
            except Exception:
                # Un correo que falla no puede tumbar el guardado del perfil: el
                # cliente vino a confirmar su cuenta, no a que se le cayera la
                # pantalla por un saludo.
                tragado()

        transaction.on_commit(_mandar)
