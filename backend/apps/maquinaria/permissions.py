"""Niveles de acceso del panel.

Tres niveles, ordenados. Cada uno incluye lo que puede el anterior:

    3 · Dueño          superusuario. Además de operar, gestiona usuarios,
                       la configuración del negocio y los respaldos.
    2 · Administrador  grupo 'Administrador' o is_staff. Opera todo el negocio:
                       ventas, rentas, cotizaciones, facturación, catálogo.
                       No toca usuarios ni configuración.
    1 · Técnico        grupo 'Técnico'. Anda con las máquinas: entrega, recoge
                       y repara, y cierra la renta o la venta ahí mismo. Ve los
                       montos de lo que opera, porque tiene que cobrar.
                       No da de alta equipo ni ve las cuentas del negocio.
    0 · Sin acceso     autenticado pero sin rol; no entra al panel.

Por qué niveles y no permisos sueltos: las reglas del negocio son jerárquicas
("de administrador para arriba"), y compararlas con >= evita la clase de bug en
la que se agrega un rol y alguien olvida incluirlo en una lista.

La autorización vive AQUÍ, no en el frontend. El panel oculta lo que no aplica
por comodidad, pero cualquiera puede llamar la API directamente: si un endpoint
no declara su nivel, no está protegido.
"""
from rest_framework import permissions

ROL_ADMIN = 'Administrador'
ROL_TECNICO = 'Técnico'
# El rol se llamaba 'Almacén'. Se sigue aceptando para que una cuenta vieja no
# se quede fuera si la migración no corrió todavía.
ROL_TECNICO_ANTERIOR = 'Almacén'

SIN_ACCESO = 0
NIVEL_TECNICO = 1
NIVEL_ADMIN = 2
NIVEL_DUENO = 3

ETIQUETA_NIVEL = {
    SIN_ACCESO: 'Sin acceso',
    NIVEL_TECNICO: 'Técnico',
    NIVEL_ADMIN: 'Administrador',
    NIVEL_DUENO: 'Dueño',
}


def nivel_de(user) -> int:
    """Nivel efectivo del usuario. Fail-closed: ante la duda, 0.

    Una cuenta desactivada da 0 aunque conserve su grupo: si le quitaron el
    acceso, un token que siga vivo no debe servir.
    """
    if not user or not user.is_authenticated or not user.is_active:
        return SIN_ACCESO
    if user.is_superuser:
        return NIVEL_DUENO
    if user.is_staff:
        return NIVEL_ADMIN
    grupos = {g.name for g in user.groups.all()}
    if ROL_ADMIN in grupos:
        return NIVEL_ADMIN
    if ROL_TECNICO in grupos or ROL_TECNICO_ANTERIOR in grupos:
        return NIVEL_TECNICO
    return SIN_ACCESO


def puede_de(user) -> dict:
    """Capacidades derivadas del nivel, para que el panel oculte lo que no aplica.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.
    """
    n = nivel_de(user)
    return {
        'nivel': n,
        'rol': ETIQUETA_NIVEL[n],
        'gestionar_usuarios': n >= NIVEL_DUENO,
        'configurar_negocio': n >= NIVEL_DUENO,
        # Cuentas del negocio (ingresos, métricas, historial completo).
        'ver_dinero': n >= NIVEL_ADMIN,
        # Cobrar lo que uno mismo opera: el técnico entrega y cobra en campo,
        # así que ve el precio y el depósito de esa renta. Distinto de arriba.
        'ver_montos_operacion': n >= NIVEL_TECNICO,
        'vender': n >= NIVEL_TECNICO,
        'rentar': n >= NIVEL_TECNICO,
        'cotizar': n >= NIVEL_ADMIN,
        'facturar': n >= NIVEL_ADMIN,
        # Dar de alta equipo o tocar el catálogo cambia el patrimonio: solo
        # administración. El técnico mueve las unidades que ya existen.
        'editar_catalogo': n >= NIVEL_ADMIN,
        'alta_inventario': n >= NIVEL_ADMIN,
        'operar_inventario': n >= NIVEL_TECNICO,
        'reparar': n >= NIVEL_TECNICO,
    }


class _NivelMinimo(permissions.BasePermission):
    """Base: exige un nivel mínimo. Las subclases solo fijan el número."""
    nivel_requerido = NIVEL_ADMIN
    message = 'No tienes permisos para esta acción.'

    def has_permission(self, request, view):
        return nivel_de(getattr(request, 'user', None)) >= self.nivel_requerido


class EsDueno(_NivelMinimo):
    """Usuarios, configuración del negocio, respaldos."""
    nivel_requerido = NIVEL_DUENO
    message = 'Solo el dueño puede hacer esto.'


class IsAdminGroupOrStaff(_NivelMinimo):
    """Operación comercial. Nombre heredado: lo usan decenas de vistas."""
    nivel_requerido = NIVEL_ADMIN
    message = 'Necesitas permisos de administrador.'


# Alias legible para código nuevo; misma regla que IsAdminGroupOrStaff.
EsAdministrador = IsAdminGroupOrStaff


class EsOperador(_NivelMinimo):
    """Técnico hacia arriba: quien entrega, recoge y repara."""
    nivel_requerido = NIVEL_TECNICO
    message = 'Necesitas acceso al panel.'


class EsOperadorEditaAdmin(permissions.BasePermission):
    """Técnico lee, administración escribe.

    Para lo que el técnico necesita consultar pero no debe modificar: el catálogo
    de equipos, la lista de rentas activas.
    """
    message = 'Solo administración puede modificar esto.'

    def has_permission(self, request, view):
        n = nivel_de(getattr(request, 'user', None))
        if n < NIVEL_TECNICO:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return n >= NIVEL_ADMIN
