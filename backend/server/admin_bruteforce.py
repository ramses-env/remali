"""Freno de fuerza bruta para el login del admin de Django.

Por qué hace falta algo aparte: los throttles del proyecto son de DRF y solo
corren en las vistas del API. `/admin/login/` es un formulario de Django normal,
así que no pasa por ninguno — se le pueden tirar contraseñas sin límite. Y el
admin es la puerta más valiosa que hay: desde ahí se ve y se edita todo.

Cómo funciona:
  - Se cuentan los intentos FALLIDOS con la señal `user_login_failed`, que es la
    fuente exacta (no se adivina mirando si la respuesta fue un redirect).
  - Se cuenta por IP y también por usuario, porque son dos ataques distintos:
    una IP probando mil contraseñas, y mil IPs probando la misma cuenta.
  - Un login correcto limpia el contador de esa IP.
  - Pasado el tope, `/admin/` responde 429 durante el enfriamiento.

Decisiones deliberadas:
  - **Falla ABIERTO.** Si el cache no responde, se deja pasar. Un Redis caído no
    puede dejar al dueño fuera de su propio panel; el riesgo de bloquearse a uno
    mismo es mayor que el de una ventana sin freno.
  - **Solo el admin.** El API ya tiene su throttle de login (10/min).
  - Si algún día se quiere lockout por cuenta, historial y desbloqueo desde la
    interfaz, lo natural es cambiar esto por `django-axes`. Esto cubre el hueco
    sin sumar una dependencia ni una migración el día del despliegue.
"""
from django.contrib.auth.signals import user_logged_in, user_login_failed
from django.core.cache import cache
from django.http import HttpResponse

# Ruta del admin, tal como la monta server/urls.py.
PREFIJO_ADMIN = '/admin/'

MAX_FALLOS = 10          # intentos fallidos antes de cerrar la puerta
VENTANA_SEGUNDOS = 900   # 15 min: contador y enfriamiento

_PREFIJO_CACHE = 'admin_fallos'


def ip_de(request) -> str:
    """IP del cliente, respetando el proxy de Railway.

    Se toma la primera entrada de X-Forwarded-For (la del cliente real) y se cae
    a REMOTE_ADDR si no viene. Mismo criterio que usa DRF para sus throttles, así
    los dos frenos cuentan a la misma persona.
    """
    reenviado = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if reenviado:
        return reenviado.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or 'desconocida'


def _clave(ident: str) -> str:
    return f'{_PREFIJO_CACHE}:{ident}'


def registrar_fallo(sender, credentials=None, request=None, **kwargs):
    if request is None:
        return
    identificadores = [ip_de(request)]
    usuario = (credentials or {}).get('username')
    if usuario:
        identificadores.append(f'u:{str(usuario)[:150].lower()}')
    for ident in identificadores:
        try:
            clave = _clave(ident)
            # add() solo escribe si no existía: así la ventana empieza a correr
            # con el PRIMER fallo y no se renueva con cada intento (si no, quien
            # ataca sin parar nunca dejaría expirar el contador).
            cache.add(clave, 0, VENTANA_SEGUNDOS)
            cache.incr(clave)
        except Exception:
            pass   # falla abierto: un cache caído no bloquea a nadie


def limpiar_fallos(sender, request=None, user=None, **kwargs):
    if request is None:
        return
    try:
        cache.delete(_clave(ip_de(request)))
        if user is not None:
            cache.delete(_clave(f'u:{user.get_username().lower()}'))
    except Exception:
        pass


user_login_failed.connect(registrar_fallo, dispatch_uid='remali_admin_fallo')
user_logged_in.connect(limpiar_fallos, dispatch_uid='remali_admin_ok')


class FrenoFuerzaBrutaAdmin:
    """Corta el acceso al admin cuando una IP acumula demasiados fallos."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(PREFIJO_ADMIN) and self._bloqueado(request):
            minutos = VENTANA_SEGUNDOS // 60
            respuesta = HttpResponse(
                f'Demasiados intentos fallidos. Vuelve a intentar en {minutos} minutos.',
                status=429,
                content_type='text/plain; charset=utf-8',
            )
            respuesta['Retry-After'] = str(VENTANA_SEGUNDOS)
            return respuesta
        return self.get_response(request)

    def _bloqueado(self, request) -> bool:
        try:
            return (cache.get(_clave(ip_de(request))) or 0) >= MAX_FALLOS
        except Exception:
            return False   # falla abierto, a propósito
