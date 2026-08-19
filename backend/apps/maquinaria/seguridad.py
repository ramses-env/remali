"""Código de seguridad PERSONAL por operador (PIN de 6 dígitos).

Cada persona del equipo tiene el suyo (se define al crear su cuenta). Autoriza
acciones sensibles —cancelar venta/renta, ajustar precio a mano, anticipo bajo
el mínimo, resolver depósito— y el rastro registra QUIÉN autorizó, cuándo y por
qué. Se guarda HASHEADO (nunca en texto), igual que una contraseña.

Anti-fuerza-bruta: un PIN de 6 dígitos son 1,000,000 de combinaciones; sin
límite es adivinable. Tras `MAX_INTENTOS` fallos se bloquea `BLOQUEO_MINUTOS`.
"""
import re
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

MAX_INTENTOS = 5
BLOQUEO_MINUTOS = 15
_RE_PIN = re.compile(r'^\d{6}$')


def formato_valido(codigo) -> bool:
    """El PIN debe ser EXACTAMENTE 6 dígitos."""
    return bool(_RE_PIN.fullmatch(str(codigo or '').strip()))


def hash_codigo(codigo: str) -> str:
    return make_password(str(codigo).strip())


def _perfil_de(user):
    from .models import PerfilUsuario
    perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
    return perfil


def tiene_codigo(user) -> bool:
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    return bool(_perfil_de(user).codigo_seguridad)


def definir_codigo(user, codigo: str):
    """Fija (o cambia) el PIN del usuario. Resetea intentos/bloqueo."""
    perfil = _perfil_de(user)
    perfil.codigo_seguridad = hash_codigo(codigo)
    perfil.codigo_intentos = 0
    perfil.codigo_bloqueado_hasta = None
    perfil.save(update_fields=['codigo_seguridad', 'codigo_intentos', 'codigo_bloqueado_hasta'])


def _perfiles_autorizantes(user):
    """Contra QUÉ perfil(es) se valida el código que se está tecleando.

    Para casi todos es el suyo. Para el GESTOR es el del DUEÑO, y ahí está el
    corazón antifraude de su rol: el Gestor es gente contratada que opera el
    negocio, así que validar su propio NIP sería dejarlo autorizarse solo —
    exactamente lo que el mecanismo debería impedir. Al pedirle el NIP del dueño,
    la excepción la aprueba una persona distinta de la que la ejecuta.

    Devuelve (perfiles, error) donde `error` es None o (detalle, status, codigo).
    Con varios dueños vale el NIP de cualquiera; en la práctica hay uno.
    """
    from django.contrib.auth import get_user_model
    from .permissions import es_gestor

    if not es_gestor(user):
        return [_perfil_de(user)], None

    dueños = get_user_model().objects.filter(is_superuser=True, is_active=True).order_by('id')
    perfiles = [pf for pf in (_perfil_de(d) for d in dueños) if pf.codigo_seguridad]
    if not perfiles:
        return [], ('El dueño todavía no configura su código de autorización, así que '
                    'esta acción no se puede autorizar. Pídele que lo defina en '
                    'Configuración → Seguridad.', 403, 'dueno_sin_codigo')
    return perfiles, None


def verificar_codigo(user, codigo):
    """Valida el código que autoriza una acción sensible.

    Para el Administrador y el Dueño es SU PROPIO NIP: son quienes mandan, y
    tecleárselo es confirmar que son ellos. Para el GESTOR es el NIP del DUEÑO
    (ver `_perfiles_autorizantes`).

    Devuelve (ok: bool, error: str|None, status: int, codigo_error: str|None).
    Aplica bloqueo por intentos fallidos. En éxito, resetea el contador.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False, 'Sesión no válida.', 401, 'sin_sesion'
    # 🔐 Solo el nivel de AUTORIDAD autoriza acciones sensibles. Un operador
    # (cajero, técnico) NO puede auto-autorizarse con su propio PIN: eso vaciaría
    # la autorización. Se corta AQUÍ (choke point único) para que ninguna ruta se
    # escape.
    from .permissions import nivel_de, NIVEL_ADMIN
    if nivel_de(user) < NIVEL_ADMIN:
        return (False, 'Tu rol no puede autorizar esta acción; pídele a un administrador que la autorice.',
                403, 'sin_permiso')

    perfiles, err = _perfiles_autorizantes(user)
    if err:
        return (False, err[0], err[1], err[2])
    if not any(pf.codigo_seguridad for pf in perfiles):
        return (False, 'No tienes un código de seguridad configurado. Defínelo en '
                'Configuración → Seguridad para poder autorizar esta acción.', 403, 'sin_codigo')

    ahora = timezone.now()
    vivos = [pf for pf in perfiles
             if not (pf.codigo_bloqueado_hasta and pf.codigo_bloqueado_hasta > ahora)]
    if not vivos:
        falta = min(pf.codigo_bloqueado_hasta for pf in perfiles) - ahora
        restante = int(falta.total_seconds() // 60) + 1
        return (False, f'Código bloqueado por demasiados intentos. Vuelve a intentar en {restante} min.',
                429, 'bloqueado')

    codigo = str(codigo or '').strip()
    for perfil in vivos:
        if codigo and check_password(codigo, perfil.codigo_seguridad):
            if perfil.codigo_intentos or perfil.codigo_bloqueado_hasta:
                perfil.codigo_intentos = 0
                perfil.codigo_bloqueado_hasta = None
                perfil.save(update_fields=['codigo_intentos', 'codigo_bloqueado_hasta'])
            return True, None, 200, None

    # Fallo: cuenta el intento en cada perfil candidato y bloquea al llegar al
    # tope. Bloquear al dueño por los intentos de un Gestor es intencional: es una
    # alarma, no un estorbo —quien anda adivinando NIPs ajenos deja rastro.
    bloqueado = False
    restantes = MAX_INTENTOS
    for perfil in vivos:
        perfil.codigo_intentos = (perfil.codigo_intentos or 0) + 1
        campos = ['codigo_intentos']
        if perfil.codigo_intentos >= MAX_INTENTOS:
            perfil.codigo_bloqueado_hasta = ahora + timedelta(minutes=BLOQUEO_MINUTOS)
            perfil.codigo_intentos = 0
            campos.append('codigo_bloqueado_hasta')
            bloqueado = True
        perfil.save(update_fields=campos)
        restantes = min(restantes, MAX_INTENTOS - (perfil.codigo_intentos or 0))
    if bloqueado:
        return (False, f'Código incorrecto. Se bloqueó {BLOQUEO_MINUTOS} min por demasiados intentos.',
                403, 'bloqueado')
    extra = f' Te quedan {restantes} intento{"s" if restantes != 1 else ""}.' if restantes <= 2 else ''
    return False, f'Código de seguridad incorrecto.{extra}', 403, 'incorrecto'


def etiqueta_autorizacion(user) -> str:
    """Cómo se nombra en el rastro a quien autorizó.

    Para el Gestor deja constancia de que la excepción la aprobó el dueño, no él:
    "carol-2025 (autorizó el dueño)". Sin esto, el registro diría solo su nombre y
    parecería que se lo aprobó a sí mismo.
    """
    from .permissions import es_gestor
    quien = getattr(user, 'username', '') or 's/d'
    return f'{quien} (autorizó el dueño)' if es_gestor(user) else quien
