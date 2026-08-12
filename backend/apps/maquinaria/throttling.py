"""Límites de tasa para lo que se expone sin sesión.

Solo se aplican donde la vista los declara: el panel autenticado no se toca.

Nota sobre el conteo: DRF lleva la cuenta en el cache de Django, que hoy es
LocMemCache — memoria de cada proceso. Con varios workers el techo efectivo se
multiplica por el número de workers (2 workers × 10/h ≈ 20/h). Sigue siendo un
techo, y es muchísimo mejor que ninguno. Cuando exista un cache compartido
(Redis), el límite pasa a ser exacto sin cambiar este archivo.
"""
from rest_framework.throttling import AnonRateThrottle


class SolicitudPublicaThrottle(AnonRateThrottle):
    """Para formularios públicos que disparan trabajo real (correos, registros).

    Un cliente honesto manda una o dos cotizaciones; diez por hora desde la
    misma IP ya es abuso.
    """
    scope = 'solicitud_publica'


class SubidaEvidenciaThrottle(AnonRateThrottle):
    """Tope a la subida de fotos.

    Un técnico documenta unas cuantas máquinas al día. Este límite no le estorba
    y sí acota el daño si un token se filtra: sin él, quien lo tenga puede llenar
    el almacenamiento y la factura.
    """
    scope = 'subida_evidencia'

    def get_cache_key(self, request, view):
        # Por cuenta, no por IP: los técnicos comparten la red de la oficina.
        if request.user and request.user.is_authenticated:
            return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}
        return None   # sin sesión no llega aquí; lo frena el permiso


class RegistroThrottle(AnonRateThrottle):
    """Alta de cuentas de cliente desde la tienda.

    Sin tope, un script crea miles de cuentas en minutos y ensucia la base de
    clientes. Cinco por hora por IP es holgado hasta para una familia que
    comparte internet, y ridículo para un bot.
    """
    scope = 'registro'


class CambioPasswordThrottle(AnonRateThrottle):
    """Freno al cambio de contraseña propia.

    El endpoint pide la contraseña ACTUAL, así que sin tope se convierte en un
    oráculo para adivinarla desde una sesión robada. Va por cuenta y no por IP:
    aquí ya sabemos quién es, y la oficina comparte salida a internet.
    """
    scope = 'cambio_password'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}
        return None   # sin sesión no llega aquí; lo frena el permiso


class LoginThrottle(AnonRateThrottle):
    """Freno al login por IP: acota fuerza bruta y credential stuffing.

    El login es sin sesión, así que se cuenta por IP. El rate es por minuto (no
    por hora) para que un usuario legítimo que teclea mal su clave se recupere en
    segundos, no en una hora. Ojo NAT: en una oficina varios comparten IP, por eso
    el tope es holgado para el uso normal y aun así frena el barrido automatizado.
    """
    scope = 'login'


class RestablecerThrottle(AnonRateThrottle):
    """Freno a la solicitud de restablecer contraseña, por IP.

    El formulario dispara un correo a la dirección que le escriban: sin tope se
    convierte en una herramienta para bombardear de correos a un tercero (y para
    gastar la cuota de envío). Cinco por hora por IP es de sobra para quien de
    verdad olvidó su clave, y ridículo para un bot.
    """
    scope = 'restablecer'


class GoogleLoginThrottle(AnonRateThrottle):
    """Freno al inicio de sesión con Google, por IP (igual que el login normal:
    acota fuerza bruta y credential stuffing con el token de Google)."""
    scope = 'google_login'


class CuponThrottle(AnonRateThrottle):
    """Freno a validar/aplicar cupón, por cuenta: sin tope, una sesión podría
    probar códigos de cupón a fuerza bruta."""
    scope = 'cupon'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}
        return None   # sin sesión no llega aquí; lo frena el permiso


class TokenPublicoThrottle(AnonRateThrottle):
    """Freno al acceso por LIGA/TOKEN público (QR de unidad, PDF público, ligas de
    seguimiento), por IP: la liga es de un solo dato pero adivinable a fuerza bruta
    sin tope. Holgado para el uso real, ridículo para un barrido automatizado."""
    scope = 'token_publico'
