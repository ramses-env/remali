"""El 5% que se le promete al cliente por completar su perfil.

Existía la promesa y no existía el cupón. El perfil decía "Todo listo — tu 5%
de bienvenida te espera", el serializer buscaba `cupones(motivo='perfil')` y el
modelo tenía hasta la bandera `recompensado`… pero NADIE lo emitía. El cliente
llenaba sus datos, veía el 100% y no había descuento por ningún lado. Una
promesa rota es peor que no haber ofrecido nada.

Va en una SEÑAL y no en la vista del perfil a propósito: el perfil se guarda
desde más de un sitio —el formulario, el registro con Google, un comando— y un
cupón que dependa de por dónde entró es un cupón que alguien va a reclamar y no
vamos a encontrar. Mismo criterio que la garantía de la venta.
"""
import secrets

from django.db.models.signals import post_save
from django.dispatch import receiver

from server.rastro import tragado

#: Lo que se regala. Un solo lugar: el texto del perfil lo lee del cupón.
DESCUENTO_BIENVENIDA = '0.05'

def perfil_esta_completo(perfil) -> bool:
    """Lo ESENCIAL, igual que la barra del perfil: nombre y teléfono.

    La empresa, las obras y el RFC quedan fuera a propósito: no todo cliente los
    tiene ni los quiere, y cobrarle el descuento por datos que no le sirven es
    justo lo que hace que abandone el formulario.
    """
    nombre = (perfil.usuario.first_name or '').strip()
    digitos = ''.join(c for c in (perfil.telefono or '') if c.isdigit())
    return bool(nombre) and len(digitos) == 10


def emitir_si_toca(perfil):
    """Le da su cupón si ya completó y todavía no lo tiene. Devuelve el cupón o None.

    `recompensado` es el candado de "una sola vez": sin él, borrar el teléfono y
    volver a escribirlo emitiría uno nuevo cada vez.
    """
    from .models import Cupon

    if perfil.recompensado or not perfil_esta_completo(perfil):
        return None

    # El modelo ya tenía `Cupon.otorgar_bienvenida()`, idempotente y sin usar por
    # nadie. Esta señal empezó creando el cupón por su cuenta y quedaron DOS
    # caminos para el mismo descuento: si el otro llegaba primero, `recompensado`
    # seguía en falso y aquí se emitía un segundo cupón al mismo cliente.
    #
    # Ahora manda el del modelo, que busca por (usuario, motivo='perfil') antes
    # de crear: aunque la bandera se desincronice, no salen dos.
    cupon = Cupon.otorgar_bienvenida(perfil.usuario)
    if cupon is None:
        return None

    # `update` y no `save()`: esto corre DENTRO del post_save del propio perfil y
    # volver a guardarlo dispararía la señal otra vez.
    type(perfil).objects.filter(pk=perfil.pk).update(recompensado=True)
    perfil.recompensado = True

    try:
        from .models import crear_notificacion
        crear_notificacion(
            'sistema', '¡Ganaste tu 5% de bienvenida!',
            f'Ya completaste tu perfil. Usa el código {cupon.codigo} en tu próxima '
            f'compra o renta; es de un solo uso.',
            seccion='perfil', ref=f'cupon-perfil-{perfil.usuario_id}',
            usuario=perfil.usuario,
        )
    except Exception:
        # Un aviso que falla no puede impedir que el cupón exista.
        tragado()
    return cupon


def conectar():
    from .models import PerfilUsuario

    # `weak=False` NO es adorno: `_al_guardar_perfil` se define aquí dentro, así
    # que en cuanto `conectar()` termina nadie la referencia y el recolector se
    # la lleva. Django guarda los receptores por referencia DÉBIL, de modo que
    # la señal seguía registrada pero sin nadie que la atendiera: el cliente
    # completaba su perfil y el cupón no salía por ningún lado, sin un error a
    # la vista. Latido y normalizacion ya lo hacían así.
    @receiver(post_save, sender=PerfilUsuario, dispatch_uid='cupon_bienvenida', weak=False)
    def _al_guardar_perfil(sender, instance, **kwargs):
        try:
            emitir_si_toca(instance)
        except Exception:
            # Nunca tumba el guardado del perfil: el cliente vino a corregir su
            # teléfono, no a que le fallara la pantalla por un cupón.
            tragado()
