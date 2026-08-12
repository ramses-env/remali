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

Dos roles comparten nivel con otro pero hacen un trabajo distinto, así que se
distinguen por su grupo, no solo por el número:

    Gerente  comparte el nivel 2. Es el encargado de piso: opera como
             administración, con la misma línea frente al dueño (no toca
             usuarios ni configuración). Nombre aparte para no confundir al
             gerente de sucursal con el dueño del negocio.
    Cajero   comparte el nivel 1 con el técnico, pero su lugar es el mostrador,
             no el campo: usa la caja (vende refacciones, hace su corte) y NO
             renta, repara ni mueve el inventario de equipos.

Por qué niveles y no permisos sueltos: las reglas del negocio son jerárquicas
("de administrador para arriba"), y compararlas con >= evita la clase de bug en
la que se agrega un rol y alguien olvida incluirlo en una lista. Los dos roles
de arriba son la excepción medida: una rama por grupo, no un permiso suelto.

La autorización vive AQUÍ, no en el frontend. El panel oculta lo que no aplica
por comodidad, pero cualquiera puede llamar la API directamente: si un endpoint
no declara su nivel, no está protegido.
"""
from rest_framework import permissions

ROL_ADMIN = 'Administrador'
ROL_GERENTE = 'Gerente'
ROL_CAJERO = 'Cajero'
ROL_ASESOR = 'Asesor'
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


def _grupos(user) -> set:
    """Nombres de los grupos del usuario. Vacío si la cuenta no cuenta (anónima o
    inactiva): así 'sin grupos' y 'sin acceso' se tratan igual, fail-closed."""
    if not user or not user.is_authenticated or not user.is_active:
        return set()
    return {g.name for g in user.groups.all()}


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
    grupos = _grupos(user)
    # Gerente opera al nivel de administración (encargado de piso); el número es
    # el mismo, el nombre no.
    if ROL_ADMIN in grupos or ROL_GERENTE in grupos:
        return NIVEL_ADMIN
    # Cajero y Asesor comparten el nivel del técnico para entrar al panel; qué
    # puede hacer cada uno dentro lo decide puede_de, no el número.
    if (ROL_CAJERO in grupos or ROL_ASESOR in grupos
            or ROL_TECNICO in grupos or ROL_TECNICO_ANTERIOR in grupos):
        return NIVEL_TECNICO
    return SIN_ACCESO


def rol_de(user) -> str:
    """Etiqueta del rol para mostrar, tomada del grupo. Cajero y Técnico comparten
    nivel; Gerente y Administrador también. El número no alcanza para nombrarlos."""
    if not user or not user.is_authenticated or not user.is_active:
        return ETIQUETA_NIVEL[SIN_ACCESO]
    if user.is_superuser:
        return ETIQUETA_NIVEL[NIVEL_DUENO]
    grupos = _grupos(user)
    for rol in (ROL_ADMIN, ROL_GERENTE, ROL_CAJERO, ROL_ASESOR, ROL_TECNICO):
        if rol in grupos:
            return rol
    if ROL_TECNICO_ANTERIOR in grupos:
        return ROL_TECNICO
    # is_staff sin grupo con nombre: administración "de fábrica".
    return ETIQUETA_NIVEL[nivel_de(user)]


def es_cajero(user) -> bool:
    """Cajero puro: en el grupo 'Cajero' y sin un nivel más alto que lo eleve. Se
    distingue del técnico por el grupo, porque comparten el número."""
    return nivel_de(user) == NIVEL_TECNICO and ROL_CAJERO in _grupos(user)


def es_asesor(user) -> bool:
    """Asesor puro: en el grupo 'Asesor' y sin un nivel más alto. Atiende
    cotizaciones y las manda a autorizar; comparte nivel con el técnico, pero su
    trabajo es el mostrador de presupuestos, no el campo."""
    return nivel_de(user) == NIVEL_TECNICO and ROL_ASESOR in _grupos(user)


def puede_de(user) -> dict:
    """Capacidades derivadas del nivel, para que el panel oculte lo que no aplica.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.

    El grueso sale del nivel (jerárquico, cascadea hacia arriba). Los puestos
    especializados que comparten el nivel 1 —cajero, asesor— hacen un trabajo
    acotado: se parte del cálculo por nivel y luego cada puesto enciende su cajón
    y apaga lo que no le toca. Se distinguen por grupo, no por número.
    """
    n = nivel_de(user)
    caps = {
        'nivel': n,
        'rol': rol_de(user),
        'gestionar_usuarios': n >= NIVEL_DUENO,
        'configurar_negocio': n >= NIVEL_DUENO,
        # Cuentas del negocio (ingresos, métricas, historial completo).
        'ver_dinero': n >= NIVEL_ADMIN,
        # Cobrar lo que uno mismo opera: el técnico entrega y cobra en campo, el
        # cajero cobra en el mostrador. Distinto de ver las cuentas del negocio.
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
        # La caja (POS de refacciones): el cajero y de administración para arriba.
        'usar_caja': n >= NIVEL_ADMIN,
        'corte_caja': n >= NIVEL_ADMIN,
        # "Mi jornada": el escritorio del técnico de campo. No es poder que suba,
        # es un puesto; administración supervisa desde Rentas y Reparaciones.
        'jornada_campo': False,
    }
    # Puestos especializados de nivel 1: comparten el número con el técnico, pero
    # su trabajo es otro. Se les enciende su cajón y se apaga lo que no les toca.
    if n == NIVEL_TECNICO:
        if es_cajero(user):
            # Mostrador de refacciones: vende y cobra, no anda en campo.
            caps.update(rentar=False, reparar=False, operar_inventario=False,
                        usar_caja=True, corte_caja=True)
        elif es_asesor(user):
            # Mostrador de presupuestos: cotiza y manda a autorizar. No vende, no
            # renta, no repara, no toca inventario ni precios ni las cuentas.
            caps.update(vender=False, rentar=False, reparar=False,
                        operar_inventario=False, cotizar=True)
        else:
            # Técnico de campo puro: suyo es Mi jornada.
            caps['jornada_campo'] = True
    return caps


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


class PuedeUsarCaja(permissions.BasePermission):
    """La caja (POS de refacciones). No es un nivel: el cajero la usa aunque
    comparta número con el técnico, y el técnico de campo no, aunque lo comparta
    con el cajero. Por eso pregunta por la capacidad, no por el nivel."""
    message = 'No tienes acceso a la caja.'

    def has_permission(self, request, view):
        return bool(puede_de(getattr(request, 'user', None)).get('usar_caja'))


class PuedeCotizar(permissions.BasePermission):
    """Cotizaciones. No es un nivel: el asesor cotiza aunque comparta número con
    el técnico (que no cotiza), y de administración para arriba también. Por eso
    pregunta por la capacidad. Ojo: cotizar NO es convertir a venta ni facturar;
    esos siguen pidiendo su propia capacidad (vender / ver_dinero / admin)."""
    message = 'No puedes gestionar cotizaciones.'

    def has_permission(self, request, view):
        return bool(puede_de(getattr(request, 'user', None)).get('cotizar'))


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
