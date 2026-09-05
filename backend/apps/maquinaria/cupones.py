"""La regla de "¿este cupón sirve para este cliente?", en un solo lugar.

Vive en su propio módulo y no dentro de `views.py` porque quien más la necesita
es la app de cotizaciones, y jalar todo `maquinaria.views` desde allá arrastra
media aplicación (y un import circular en cuanto views vuelva a mirar hacia
cotizaciones).
"""
from django.utils import timezone

from .models import Cupon


def cupon_valido_para(codigo, user):
    """El cupón que ese código representa para ESE usuario, o `(None, motivo)`.

    Vive aquí y no dentro de la vista porque hay DOS momentos que preguntan lo
    mismo: la tienda al teclear el código (para enseñar el descuento antes de
    enviar) y la creación de la cotización (para aplicarlo de verdad). Con la
    regla copiada en los dos, el día que cambie una se queda mintiendo la otra:
    el cliente vería su 5% en pantalla y le llegaría la cotización sin él.

    NUNCA marca el cupón como usado. Eso pasa cuando la venta o la renta se
    concreta, no cuando alguien lo teclea.
    """
    codigo = (codigo or '').strip()
    if not codigo:
        return None, 'Código requerido.'
    cupon = Cupon.objects.filter(codigo=codigo, activo=True).first()
    # El mismo mensaje para "no existe", "inactivo" y "ya usado": distinguirlos
    # convierte el campo en un adivinador de códigos ajenos.
    if cupon is None or (cupon.personal and cupon.usado):
        return None, 'Cupón inválido.'
    # El vencido SÍ se nombra, y con su fecha. Aquí no hay nada que adivinar
    # —quien lo teclea ya tenía el código— y "Cupón inválido" a secas manda a
    # llamar por teléfono a alguien que solo necesitaba saber que se le pasó.
    if cupon.vencido:
        cuando = timezone.localtime(cupon.expira).strftime('%d/%m/%Y')
        return None, f'Ese cupón venció el {cuando}.'
    if cupon.personal and cupon.usuario_id is not None:
        if not getattr(user, 'is_authenticated', False):
            return None, 'Inicia sesión para usar este cupón.'
        if cupon.usuario_id != user.id:
            return None, 'Cupón inválido.'
    return cupon, None


def cupon_personal(user):
    """El cupón de bienvenida de ese cliente tal como lo pinta la tienda, o None.

    Lo leen el perfil (para enseñar el código) y el armador de la cotización
    (para ofrecerlo con un toque). Una sola forma: si el perfil dijera `usado` y
    el armador no, el cliente vería ofrecido un cupón ya gastado.
    """
    if not getattr(user, 'is_authenticated', False):
        return None
    c = user.cupones.filter(motivo='perfil', activo=True).order_by('-id').first()
    if not c:
        return None
    return {'codigo': c.codigo, 'descuento': float(c.descuento),
            'usado': bool(c.usado), 'usado_en': c.usado_en,
            # La tienda y el perfil pintan la fecha: un cupón con caducidad que
            # no dice cuándo caduca es peor que uno sin caducidad, porque el
            # cliente se entera el día que ya no le sirve.
            'expira': c.expira, 'vencido': c.vencido}
