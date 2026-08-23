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

# Tres roles con nombre, más el Dueño (superusuario), que no es un grupo.
# 'Gerente' y 'Asesor' se retiraron: Gerente era idéntico a Administrador y
# Asesor no lo usaba nadie. Si vuelve a hacer falta un puesto intermedio se
# creará con sus propias especificaciones, no reviviendo un duplicado.
ROL_ADMIN = 'Administrador'
# Administración DELEGADA: alguien contratado que opera el sistema por el dueño.
# Comparte el nivel del Administrador —no es un escalón nuevo en la jerarquía—
# y se diferencia por ajustes de puesto. Ver el diseño en
# docs/superpowers/specs/2026-08-19-rol-gestor-design.md
ROL_GESTOR = 'Gestor'
ROL_CAJERO = 'Cajero'
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
    if ROL_ADMIN in grupos or ROL_GESTOR in grupos:
        return NIVEL_ADMIN
    # Cajero y Técnico comparten el nivel para entrar al panel; qué puede hacer
    # cada uno dentro lo decide puede_de, no el número.
    if (ROL_CAJERO in grupos
            or ROL_TECNICO in grupos or ROL_TECNICO_ANTERIOR in grupos):
        return NIVEL_TECNICO
    return SIN_ACCESO


def rol_de(user) -> str:
    """Etiqueta del rol para mostrar, tomada del grupo. Cajero y Técnico comparten
    nivel, así que el número no alcanza para nombrarlos."""
    if not user or not user.is_authenticated or not user.is_active:
        return ETIQUETA_NIVEL[SIN_ACCESO]
    if user.is_superuser:
        return ETIQUETA_NIVEL[NIVEL_DUENO]
    grupos = _grupos(user)
    for rol in (ROL_ADMIN, ROL_GESTOR, ROL_CAJERO, ROL_TECNICO):
        if rol in grupos:
            return rol
    if ROL_TECNICO_ANTERIOR in grupos:
        return ROL_TECNICO
    # is_staff sin grupo con nombre: administración "de fábrica".
    return ETIQUETA_NIVEL[nivel_de(user)]


def es_gestor(user) -> bool:
    """Gestor puro: en el grupo 'Gestor' y sin un nivel más alto que lo eleve.

    Se distingue del Administrador por el grupo, porque comparten el número. La
    diferencia importa: al Gestor las acciones delicadas le piden el NIP del
    DUEÑO, no el suyo.
    """
    return nivel_de(user) == NIVEL_ADMIN and ROL_GESTOR in _grupos(user)


def es_cajero(user) -> bool:
    """Cajero puro: en el grupo 'Cajero' y sin un nivel más alto que lo eleve. Se
    distingue del técnico por el grupo, porque comparten el número."""
    return nivel_de(user) == NIVEL_TECNICO and ROL_CAJERO in _grupos(user)


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
#
# El `area` agrupa la matriz de la pantalla para que se lea de corrido —"esto es
# dinero, esto es mostrador"— y nada más: es TEMÁTICA. Que una capacidad viva en
# 'Llaves del negocio' no la protege; lo que lleva candado lo decide `NUCLEO`.

class Capacidad(NamedTuple):
    nombre: str
    etiqueta: str
    descripcion: str
    nivel_minimo: Optional[int]
    area: str


CATALOGO = (
    Capacidad('gestionar_usuarios', 'Gestionar usuarios',
              'Dar de alta al equipo y cambiarle el rol.', NIVEL_DUENO,
              'Llaves del negocio'),
    Capacidad('configurar_negocio', 'Configurar el negocio',
              'Datos del negocio, correos de aviso, códigos de seguridad.', NIVEL_DUENO,
              'Llaves del negocio'),
    # `ver_dinero` y `ver_operacion` estaban revueltas en una sola. Separarlas es
    # lo que permite que alguien opere el negocio sin saber cuánto gana el
    # negocio: el Gestor tiene que poder abrir una venta para cancelarla, y no
    # tiene por qué ver los ingresos del mes.
    Capacidad('ver_dinero', 'Ver las cuentas del negocio',
              'El Resumen, los ingresos del día/mes/año, las gráficas y los reportes '
              'exportables. Distinto de ver la operación y de cobrar.', NIVEL_ADMIN,
              'Dinero y cuentas'),
    Capacidad('ver_operacion', 'Ver la operación comercial',
              'La lista de ventas, rentas, adeudos y pedidos con sus montos, para '
              'poder trabajarlos. No incluye las métricas del negocio.', NIVEL_ADMIN,
              'Dinero y cuentas'),
    Capacidad('borrar_catalogo', 'Borrar del catálogo',
              'Eliminar productos, unidades y refacciones. Agregar es de administración; '
              'BORRAR es del dueño: es como se encubre una máquina que falta.', NIVEL_DUENO,
              'Catálogo e inventario'),
    Capacidad('tener_codigo_propio', 'Tener código de autorización propio',
              'Fijar un NIP propio que autoriza acciones delicadas. El Gestor NO lo '
              'tiene: las suyas las autoriza el dueño con el de él.', NIVEL_ADMIN,
              'Llaves del negocio'),
    Capacidad('editar_datos_bancarios', 'Editar los datos bancarios',
              'El titular, banco, cuenta y CLABE que se imprimen en cada cotización. '
              'Cambiarlos desvía los pagos de los clientes.', NIVEL_DUENO,
              'Llaves del negocio'),
    Capacidad('ver_montos_operacion', 'Ver montos de lo que opera',
              'Cobrar lo que uno mismo atiende: el técnico en campo, el cajero en '
              'el mostrador. No incluye las cuentas del negocio.', NIVEL_TECNICO,
              'Dinero y cuentas'),
    Capacidad('vender', 'Vender', 'Registrar ventas de maquinaria.', NIVEL_TECNICO,
              'Mostrador'),
    Capacidad('rentar', 'Rentar', 'Levantar rentas y devoluciones.', NIVEL_TECNICO,
              'Campo y taller'),
    Capacidad('cotizar', 'Cotizar', 'Hacer presupuestos y mandarlos a autorizar.', NIVEL_ADMIN,
              'Mostrador'),
    Capacidad('facturar', 'Facturar', 'Atender la bandeja de por facturar.', NIVEL_ADMIN,
              'Mostrador'),
    Capacidad('editar_catalogo', 'Editar el catálogo',
              'Equipos, marcas, precios de lista. Cambia el patrimonio.', NIVEL_ADMIN,
              'Catálogo e inventario'),
    Capacidad('alta_inventario', 'Dar de alta unidades',
              'Meter máquinas nuevas al inventario.', NIVEL_ADMIN,
              'Catálogo e inventario'),
    Capacidad('operar_inventario', 'Mover unidades',
              'Cambiar de ubicación y estado las unidades que ya existen.', NIVEL_TECNICO,
              'Campo y taller'),
    # `reparar` y `gestionar_reparaciones` son dos trabajos distintos que antes se
    # confundían en uno. REPARAR es hacer el trabajo: recibir la máquina,
    # trabajarla y terminarla; el técnico lo hace todo desde "Mi jornada", que ya
    # le trae sus órdenes abiertas sin importar cuántos días lleven. GESTIONAR es
    # llevar el taller: el historial completo, las cuatro etapas, los costos y
    # entregarle la máquina al cliente. Abrirle al técnico la sección completa era
    # duplicarle su propio día en otra pantalla.
    Capacidad('reparar', 'Reparar',
              'Recibir máquinas en taller y trabajar las órdenes desde Mi jornada.', NIVEL_TECNICO,
              'Campo y taller'),
    Capacidad('gestionar_reparaciones', 'Llevar el taller',
              'La sección Reparaciones: historial, costos y entrega al cliente. '
              'Distinto de reparar, que es hacer el trabajo.', NIVEL_ADMIN,
              'Campo y taller'),
    Capacidad('usar_caja', 'Usar la caja',
              'Vender refacciones en el mostrador y cobrar.', NIVEL_ADMIN, 'Mostrador'),
    Capacidad('corte_caja', 'Hacer corte de caja',
              'Arqueo del turno.', NIVEL_ADMIN, 'Mostrador'),
    # ── Padrón de clientes ──
    Capacidad('ver_clientes', 'Ver clientes',
              'Buscar en el padrón y abrir la ficha de un cliente. Sin esto, el '
              'buscador del mostrador no sirve.', NIVEL_TECNICO, 'Clientes'),
    Capacidad('editar_clientes', 'Editar clientes',
              'Dar de alta clientes y contactos. Los datos fiscales y fundir dos '
              'clientes siguen siendo de administración.', NIVEL_TECNICO, 'Clientes'),
    Capacidad('jornada_campo', 'Mi jornada',
              'El escritorio del técnico de campo: entregar, recoger y subir las '
              'fotos. Es un puesto, no un poder, por eso no cascadea hacia arriba.', None,
              'Campo y taller'),
    Capacidad('ver_jornada', 'Ver la jornada del técnico',
              'Mirar el tablero de campo (qué falta entregar, qué está vencido) sin '
              'poder tocarlo. Supervisión: entregar y recoger se hace desde Rentas.',
              NIVEL_ADMIN, 'Campo y taller'),
    Capacidad('configurar_permisos', 'Configurar los permisos',
              'Encender y apagar capacidades por rol. Solo el Dueño: quien tenga '
              'esta pantalla se puede conceder todo lo demás.', NIVEL_DUENO,
              'Llaves del negocio'),
)


#: Capacidades que NINGUNA pantalla reparte. Que estén aquí no significa que
#: nadie las tenga: significa que su valor es el de fábrica y ahí se queda.
#: `tener_codigo_propio` entra porque quien tiene NIP se autoriza a sí mismo las
#: excepciones —ajustar el precio al vender, entre otras—, que es la vía discreta
#: de sacar dinero que documenta `CambioPrecioLista`.
NUCLEO = frozenset({
    'gestionar_usuarios', 'editar_datos_bancarios', 'borrar_catalogo',
    'tener_codigo_propio', 'configurar_permisos',
})

#: Los roles que la pantalla configura. El Dueño no está: lo puede todo, siempre,
#: y una casilla suya solo sería una forma de encerrarse fuera de su sistema.
ROLES_EDITABLES = (ROL_GESTOR, ROL_ADMIN, ROL_CAJERO, ROL_TECNICO)

#: Nivel de partida de cada rol editable.
NIVEL_POR_ROL = {
    ROL_GESTOR: NIVEL_ADMIN, ROL_ADMIN: NIVEL_ADMIN,
    ROL_CAJERO: NIVEL_TECNICO, ROL_TECNICO: NIVEL_TECNICO,
}


# Ajustes por PUESTO, para los que comparten el nivel 1 y hacen trabajos
# distintos. Son VALORES POR DEFECTO, no la ley del sistema: cuando exista la
# pantalla de permisos configurables, leerá lo que el admin haya guardado y
# caerá aquí solo si no hay nada configurado.
AJUSTES_POR_PUESTO = {
    # Administración DELEGADA. Opera el negocio por el dueño, pero es gente
    # contratada: el diseño entero existe para que no pueda robar sin que se vea.
    #  · `ver_dinero` apagado: no ve el Resumen ni las métricas del mes o del año.
    #    Sí ve la operación (`ver_operacion`, que le llega por nivel), porque para
    #    cancelar una venta hay que poder abrirla.
    #  · `configurar_negocio` encendido: es trabajo de escritorio que el dueño
    #    delega. Los DATOS BANCARIOS se le bloquean aparte, con su propia
    #    capacidad de nivel dueño.
    #  · Borrar del catálogo y dar de alta gente le quedan fuera por nivel.
    ROL_GESTOR: {'ver_dinero': False, 'configurar_negocio': True,
                 'tener_codigo_propio': False},
    # Mostrador: vende y cobra en la caja, no anda en campo.
    ROL_CAJERO: {'rentar': False, 'reparar': False, 'operar_inventario': False,
                 'usar_caja': True, 'corte_caja': True},
    # Técnico de campo: REPARA, ENTREGA, RECOGE y COBRA lo que él atiende.
    # No vende ni renta —eso se levanta en el mostrador o en administración—,
    # así que esas dos se apagan aunque su nivel las encendería. Sin esto el
    # panel le prometía dos cosas que no le tocan y que además no tenía dónde
    # hacer, porque Ventas y Rentas piden `ver_dinero`.
    None: {'jornada_campo': True, 'vender': False, 'rentar': False},
}


def capacidades_fabrica(rol: str) -> dict:
    """Lo que un rol puede ANTES de que el dueño configure nada.

    Es la misma cuenta que hacía `puede_de` —nivel, más el ajuste del puesto—,
    pero indexada por ROL en vez de por usuario: la pantalla necesita saber qué
    trae de fábrica un puesto sin tener a nadie de ese puesto enfrente.
    """
    nivel = NIVEL_POR_ROL.get(rol, SIN_ACCESO)
    caps = {c.nombre: (c.nivel_minimo is not None and nivel >= c.nivel_minimo)
            for c in CATALOGO}
    if rol == ROL_GESTOR:
        caps.update(AJUSTES_POR_PUESTO[ROL_GESTOR])
    elif rol == ROL_CAJERO:
        caps.update(AJUSTES_POR_PUESTO[ROL_CAJERO])
    elif rol == ROL_TECNICO:
        caps.update(AJUSTES_POR_PUESTO[None])
    return caps


def catalogo_capacidades() -> list:
    """El catálogo como datos serializables, para que el panel pinte la matriz
    sola: etiqueta, explicación, área y si lleva candado."""
    return [{**c._asdict(), 'nucleo': c.nombre in NUCLEO} for c in CATALOGO]


def puede_de(user) -> dict:
    """Capacidades del usuario, para que el panel oculte lo que no aplica.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.

    El grueso sale del NIVEL (jerárquico, cascadea hacia arriba). Encima, los
    puestos que COMPARTEN un nivel aplican su ajuste. Se distinguen por grupo, no
    por número: cajero y técnico son ambos nivel 1, y administrador y gestor son
    ambos nivel 2.
    """
    n = nivel_de(user)
    caps = {c.nombre: (c.nivel_minimo is not None and n >= c.nivel_minimo)
            for c in CATALOGO}
    caps['nivel'] = n
    caps['rol'] = rol_de(user)

    if n == NIVEL_TECNICO:
        puesto = ROL_CAJERO if es_cajero(user) else None
        caps.update(AJUSTES_POR_PUESTO[puesto])
    elif n == NIVEL_ADMIN and es_gestor(user):
        caps.update(AJUSTES_POR_PUESTO[ROL_GESTOR])
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


class PuedeVerDinero(ExigeCapacidad):
    """Las cuentas del negocio: el Resumen y sus métricas.

    Existe desde que el Resumen dejó de ser un cascarón. Mientras devolvía ceros
    daba igual quién lo llamara; ahora dice cuánto entró cada día y cada mes, que
    es justo lo que el Gestor NO debe ver aunque opere el negocio completo.
    """
    capacidad = 'ver_dinero'
    message = 'No tienes acceso a las cuentas del negocio.'


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
