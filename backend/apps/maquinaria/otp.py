"""Código de verificación del correo: emitirlo y comprobarlo.

Reemplazó a la liga de confirmación. Dos razones, y la segunda es la que se veía
en producción:

1. Un código se teclea; una liga se puede abrir sola. Los escáneres de correo
   (SafeLinks, antivirus corporativos) siguen los enlaces para inspeccionarlos y
   quemaban el token antes de que el usuario llegara — está anotado en el propio
   `_enviar_correo_verificacion`, que ya había tenido que dejar de usar GET por
   eso mismo.
2. Un solo camino que mantener y que probar.

Lo que sostiene la seguridad de seis dígitos —un millón de combinaciones, que a
mano no es nada— son tres cosas juntas, y quitar cualquiera lo rompe:

  · **Ventana corta.** 15 minutos, no las 48 horas que duraba la liga. La liga
    aguantaba tanto porque traía 24 bytes de entropía; el código no.
  · **Intentos limitados.** 5 y se bloquea 15 minutos.
  · **Por cuenta.** Se comprueba contra el correo que se está verificando, no
    buscando el código en toda la tabla: si no, un mismo código valdría para
    cualquiera y se podría barrer a ciegas.

La forma es la misma que `seguridad.py` (hash + intentos + bloqueo) a propósito:
dos mecanismos de código que se comportan distinto son dos que revisar.
"""
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

LARGO = 6
VIGENCIA = timedelta(minutes=15)
MAX_INTENTOS = 5
BLOQUEO_MINUTOS = 15


def generar_codigo():
    """Seis dígitos, con ceros a la izquierda si tocan.

    `secrets` y no `random`: el segundo es predecible si alguien conoce el
    estado del generador, y esto es una llave de cuenta.
    """
    return f'{secrets.randbelow(10 ** LARGO):0{LARGO}d}'


def emitir(perfil):
    """Genera un código nuevo, lo guarda hasheado y devuelve el código EN CLARO.

    El claro solo existe aquí y en el correo; en la base queda el hash. Emitir
    uno nuevo invalida el anterior y limpia los intentos: pedir un código de
    nuevo es la salida legítima de quien se equivocó, no un castigo.
    """
    codigo = generar_codigo()
    perfil.email_otp = make_password(codigo)
    perfil.email_otp_creado = timezone.now()
    perfil.email_otp_intentos = 0
    perfil.email_otp_bloqueado_hasta = None
    return codigo


CAMPOS = ['email_otp', 'email_otp_creado', 'email_otp_intentos', 'email_otp_bloqueado_hasta']


def comprobar(perfil, codigo):
    """¿Es el código de este perfil, está vivo y quedan intentos?

    Devuelve `(ok, detalle, status, codigo_error)`, igual que
    `seguridad.verificar_codigo`, para que las vistas los traten igual.

    Al acertar, el código se consume: es de un solo uso. Mientras vive, es la
    llave de la cuenta.
    """
    ahora = timezone.now()

    if perfil.email_otp_bloqueado_hasta and perfil.email_otp_bloqueado_hasta > ahora:
        falta = perfil.email_otp_bloqueado_hasta - ahora
        minutos = int(falta.total_seconds() // 60) + 1
        return (False, f'Demasiados intentos. Espera {minutos} min y pide un código nuevo.',
                429, 'bloqueado')

    if not perfil.email_otp or not perfil.email_otp_creado:
        return False, 'Pide un código nuevo.', 400, 'sin_codigo'

    if ahora - perfil.email_otp_creado > VIGENCIA:
        return False, 'Ese código ya venció. Pide uno nuevo.', 400, 'vencido'

    codigo = ''.join(ch for ch in str(codigo or '') if ch.isdigit())
    if len(codigo) != LARGO:
        # No cuenta como intento: es un dedazo, no un ataque. Gastarle intentos
        # a quien tecleó de más deja bloqueada a gente que sí es la dueña.
        return False, f'El código son {LARGO} dígitos.', 400, 'formato'

    if check_password(codigo, perfil.email_otp):
        perfil.email_otp = ''
        perfil.email_otp_creado = None
        perfil.email_otp_intentos = 0
        perfil.email_otp_bloqueado_hasta = None
        perfil.save(update_fields=CAMPOS)
        return True, None, 200, None

    perfil.email_otp_intentos = (perfil.email_otp_intentos or 0) + 1
    campos = ['email_otp_intentos']
    if perfil.email_otp_intentos >= MAX_INTENTOS:
        perfil.email_otp_bloqueado_hasta = ahora + timedelta(minutes=BLOQUEO_MINUTOS)
        perfil.email_otp_intentos = 0
        campos.append('email_otp_bloqueado_hasta')
        perfil.save(update_fields=campos)
        return (False, f'Demasiados intentos. Espera {BLOQUEO_MINUTOS} min y pide un código nuevo.',
                429, 'bloqueado')

    perfil.save(update_fields=campos)
    restantes = MAX_INTENTOS - perfil.email_otp_intentos
    # Decir cuántos quedan es honesto y evita que alguien siga picando a ciegas
    # hasta quedar bloqueado sin entender por qué.
    return (False, f'Código incorrecto. Te quedan {restantes} intento{"s" if restantes != 1 else ""}.',
            400, 'incorrecto')
