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
from typing import NamedTuple, Optional

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


# ═══════════════════════════════════════════════════════════════════
#  CATÁLOGO DE CAPACIDADES
# ═══════════════════════════════════════════════════════════════════
# Las capacidades son DATOS, no un diccionario escrito a mano dentro de una
# función. Está así a propósito: el dueño pidió una pantalla donde el admin
# encienda y apague capacidades por rol, y esa pantalla va a leer este catálogo
# para pintarse sola —con su etiqueta y su explicación— en vez de que alguien
# la mantenga sincronizada a mano cada vez que se agrega una.
#
# `nivel_minimo=None` significa "no se enciende por nivel": es un puesto, no un
# poder que cascadee hacia arriba (ver `jornada_campo`).

class Capacidad(NamedTuple):
    nombre: str
    etiqueta: str
    descripcion: str
    nivel_minimo: Optional[int]


CATALOGO = (
    Capacidad('gestionar_usuarios', 'Gestionar usuarios',
              'Dar de alta al equipo y cambiarle el rol.', NIVEL_DUENO),
    Capacidad('configurar_negocio', 'Configurar el negocio',
              'Datos del negocio, correos de aviso, códigos de seguridad.', NIVEL_DUENO),
    Capacidad('ver_dinero', 'Ver las cuentas del negocio',
              'Ingresos, métricas e historial completo. Distinto de cobrar.', NIVEL_ADMIN),
    Capacidad('ver_montos_operacion', 'Ver montos de lo que opera',
              'Cobrar lo que uno mismo atiende: el técnico en campo, el cajero en '
              'el mostrador. No incluye las cuentas del negocio.', NIVEL_TECNICO),
    Capacidad('vender', 'Vender', 'Registrar ventas de maquinaria.', NIVEL_TECNICO),
    Capacidad('rentar', 'Rentar', 'Levantar rentas y devoluciones.', NIVEL_TECNICO),
    Capacidad('cotizar', 'Cotizar', 'Hacer presupuestos y mandarlos a autorizar.', NIVEL_ADMIN),
    Capacidad('facturar', 'Facturar', 'Atender la bandeja de por facturar.', NIVEL_ADMIN),
    Capacidad('editar_catalogo', 'Editar el catálogo',
              'Equipos, marcas, precios de lista. Cambia el patrimonio.', NIVEL_ADMIN),
    Capacidad('alta_inventario', 'Dar de alta unidades',
              'Meter máquinas nuevas al inventario.', NIVEL_ADMIN),
    Capacidad('operar_inventario', 'Mover unidades',
              'Cambiar de ubicación y estado las unidades que ya existen.', NIVEL_TECNICO),
    Capacidad('reparar', 'Reparar', 'Órdenes de reparación y mantenimiento.', NIVEL_TECNICO),
    Capacidad('usar_caja', 'Usar la caja',
              'Vender refacciones en el mostrador y cobrar.', NIVEL_ADMIN),
    Capacidad('corte_caja', 'Hacer corte de caja',
              'Arqueo del turno.', NIVEL_ADMIN),
    # ── Padrón de clientes ──
    Capacidad('ver_clientes', 'Ver clientes',
              'Buscar en el padrón y abrir la ficha de un cliente. Sin esto, el '
              'buscador del mostrador no sirve.', NIVEL_TECNICO),
    Capacidad('editar_clientes', 'Editar clientes',
              'Dar de alta clientes y contactos. Los datos fiscales y fundir dos '
              'clientes siguen siendo de administración.', NIVEL_TECNICO),
    Capacidad('jornada_campo', 'Mi jornada',
              'El escritorio del técnico de campo: entregar, recoger y subir las '
              'fotos. Es un puesto, no un poder, por eso no cascadea hacia arriba.', None),
    Capacidad('ver_jornada', 'Ver la jornada del técnico',
              'Mirar el tablero de campo (qué falta entregar, qué está vencido) sin '
              'poder tocarlo. Supervisión: entregar y recoger se hace desde Rentas.',
              NIVEL_ADMIN),
)


# Ajustes por PUESTO, para los que comparten el nivel 1 y hacen trabajos
# distintos. Son VALORES POR DEFECTO, no la ley del sistema: cuando exista la
# pantalla de permisos configurables, leerá lo que el admin haya guardado y
# caerá aquí solo si no hay nada configurado.
AJUSTES_POR_PUESTO = {
    # Mostrador de refacciones: vende y cobra, no anda en campo.
    ROL_CAJERO: {'rentar': False, 'reparar': False, 'operar_inventario': False,
                 'usar_caja': True, 'corte_caja': True},
    # Mostrador de presupuestos: cotiza y manda a autorizar. No vende, no renta,
    # no repara, no toca inventario ni precios ni las cuentas.
    ROL_ASESOR: {'vender': False, 'rentar': False, 'reparar': False,
                 'operar_inventario': False, 'cotizar': True},
    # Técnico de campo puro (sin puesto especializado): suyo es Mi jornada.
    None: {'jornada_campo': True},
}


def catalogo_capacidades() -> list:
    """El catálogo como datos serializables, para que el panel lo pinte solo."""
    return [c._asdict() for c in CATALOGO]


def puede_de(user) -> dict:
    """Capacidades del usuario, para que el panel oculte lo que no aplica.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.

    El grueso sale del NIVEL (jerárquico, cascadea hacia arriba). Encima, los
    puestos que comparten el nivel 1 aplican su ajuste. Se distinguen por grupo,
    no por número, porque cajero, asesor y técnico son todos nivel 1.
    """
    n = nivel_de(user)
    caps = {c.nombre: (c.nivel_minimo is not None and n >= c.nivel_minimo)
            for c in CATALOGO}
    caps['nivel'] = n
    caps['rol'] = rol_de(user)

    if n == NIVEL_TECNICO:
        puesto = ROL_CAJERO if es_cajero(user) else (ROL_ASESOR if es_asesor(user) else None)
        caps.update(AJUSTES_POR_PUESTO[puesto])
    return caps


class ExigeCapacidad(permissions.BasePermission):
    """Base: exige una CAPACIDAD del catálogo, no un nivel ni un puesto.

    Es la forma preferida para todo lo nuevo. Preguntar por capacidad —y no por
    `if rol == 'Cajero'`— es lo que va a permitir que la pantalla de permisos
    configurables funcione sin ir cazando condicionales por las vistas.
    """
    capacidad = ''
    message = 'No tienes permisos para esta acción.'

    def has_permission(self, request, view):
        return bool(puede_de(getattr(request, 'user', None)).get(self.capacidad))


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
