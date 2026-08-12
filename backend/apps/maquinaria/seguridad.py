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


def verificar_codigo(user, codigo):
    """Valida el PIN del USUARIO QUE EJECUTA la acción (no uno compartido).

    Devuelve (ok: bool, error: str|None, status: int, codigo_error: str|None).
    Aplica bloqueo por intentos fallidos. En éxito, resetea el contador.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False, 'Sesión no válida.', 401, 'sin_sesion'
    # 🔐 Solo los roles de AUTORIDAD (Administrador / Gerente) autorizan acciones
    # sensibles. Un operador (cajero, asesor, técnico) NO puede auto-autorizarse
    # con su propio PIN: eso vaciaría la autorización —el punto es que un superior
    # apruebe la excepción, no quien la ejecuta—. Su PIN, si lo tuviera, jamás
    # autoriza. Se corta AQUÍ (choke point único) para que ninguna ruta se escape.
    from .permissions import nivel_de, NIVEL_ADMIN
    if nivel_de(user) < NIVEL_ADMIN:
        return (False, 'Tu rol no puede autorizar esta acción; pídele a un administrador o gerente que la autorice.',
                403, 'sin_permiso')
    perfil = _perfil_de(user)
    if not perfil.codigo_seguridad:
        return (False, 'No tienes un código de seguridad configurado. Defínelo en tu perfil '
                'para poder autorizar esta acción.', 403, 'sin_codigo')

    ahora = timezone.now()
    if perfil.codigo_bloqueado_hasta and perfil.codigo_bloqueado_hasta > ahora:
        restante = int((perfil.codigo_bloqueado_hasta - ahora).total_seconds() // 60) + 1
        return (False, f'Código bloqueado por demasiados intentos. Vuelve a intentar en {restante} min.',
                429, 'bloqueado')

    codigo = str(codigo or '').strip()
    if codigo and check_password(codigo, perfil.codigo_seguridad):
        if perfil.codigo_intentos or perfil.codigo_bloqueado_hasta:
            perfil.codigo_intentos = 0
            perfil.codigo_bloqueado_hasta = None
            perfil.save(update_fields=['codigo_intentos', 'codigo_bloqueado_hasta'])
        return True, None, 200, None

    # Fallo: cuenta el intento y bloquea si llegó al tope.
    perfil.codigo_intentos = (perfil.codigo_intentos or 0) + 1
    campos = ['codigo_intentos']
    if perfil.codigo_intentos >= MAX_INTENTOS:
        perfil.codigo_bloqueado_hasta = ahora + timedelta(minutes=BLOQUEO_MINUTOS)
        perfil.codigo_intentos = 0
        campos.append('codigo_bloqueado_hasta')
        perfil.save(update_fields=campos)
        return (False, f'Código incorrecto. Se bloqueó {BLOQUEO_MINUTOS} min por demasiados intentos.',
                403, 'bloqueado')
    perfil.save(update_fields=campos)
    restantes = MAX_INTENTOS - perfil.codigo_intentos
    extra = f' Te quedan {restantes} intento{"s" if restantes != 1 else ""}.' if restantes <= 2 else ''
    return False, f'Código de seguridad incorrecto.{extra}', 403, 'incorrecto'
