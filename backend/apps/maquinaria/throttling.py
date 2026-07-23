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


class LoginThrottle(AnonRateThrottle):
    """Freno al login por IP: acota fuerza bruta y credential stuffing.

    El login es sin sesión, así que se cuenta por IP. El rate es por minuto (no
    por hora) para que un usuario legítimo que teclea mal su clave se recupere en
    segundos, no en una hora. Ojo NAT: en una oficina varios comparten IP, por eso
    el tope es holgado para el uso normal y aun así frena el barrido automatizado.
    """
    scope = 'login'
