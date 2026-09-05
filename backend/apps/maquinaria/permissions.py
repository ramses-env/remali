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

from server.porpeticion import por_peticion

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

# Identidad INTERNA de cada puesto de fábrica. Es lo que manda en el código y en
# la base; los nombres de arriba son solo con lo que nacen en pantalla, y el
# dueño los puede cambiar. Preguntar por la clave —y no por el nombre— es lo que
# permite renombrar "Cajero" a "Mostrador" sin apagarle en silencio las reglas
# que lo distinguen del técnico. Ver el modelo `Rol`.
CLAVE_ADMIN = 'administrador'
CLAVE_GESTOR = 'gestor'
CLAVE_CAJERO = 'cajero'
CLAVE_TECNICO = 'tecnico'
CLAVES_FABRICA = (CLAVE_ADMIN, CLAVE_GESTOR, CLAVE_CAJERO, CLAVE_TECNICO)

#: Con qué nombre nace cada puesto, y desde qué nivel arranca.
NOMBRE_FABRICA = {
    CLAVE_ADMIN: ROL_ADMIN, CLAVE_GESTOR: ROL_GESTOR,
    CLAVE_CAJERO: ROL_CAJERO, CLAVE_TECNICO: ROL_TECNICO,
}

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


NIVEL_FABRICA = {
    CLAVE_ADMIN: NIVEL_ADMIN, CLAVE_GESTOR: NIVEL_ADMIN,
    CLAVE_CAJERO: NIVEL_TECNICO, CLAVE_TECNICO: NIVEL_TECNICO,
}

def _mapa_de_fabrica() -> dict:
    """Los cuatro puestos con su nombre original, sin tocar la base.

    Es el respaldo de cuando la tabla `rol` todavía no existe (migración a medio
    correr) o la consulta truena. Autoriza exactamente lo mismo que antes de que
    esta tabla existiera: un error de base no reparte ni quita permisos.
    """
    mapa = {NOMBRE_FABRICA[c]: {'clave': c, 'nivel': NIVEL_FABRICA[c],
                                'nombre': NOMBRE_FABRICA[c], 'protegido': True}
            for c in CLAVES_FABRICA}
    mapa[ROL_TECNICO_ANTERIOR] = dict(mapa[ROL_TECNICO], nombre=ROL_TECNICO_ANTERIOR)
    return mapa


def mapa_roles() -> dict:
    """{nombre del grupo: {clave, nivel, nombre, protegido}}.

    Cacheado LO QUE DURA UNA PETICIÓN, no en memoria del proceso. La diferencia
    importa: guardarlo en el módulo haría que el worker que renombra un puesto
    tire su copia y los DEMÁS se queden con el nombre viejo —gente que de pronto
    no entra según qué proceso le tocó—, y un permiso que depende del worker no
    es un permiso. Por petición no pasa: el renombre surte efecto en la
    siguiente, en cualquier worker, y no hay nada que invalidar.

    Lo que se ahorra es real: esto se llamaba 4 veces en cualquier endpoint y 22
    en `/usuarios/` (una por cuenta de la lista), cada una con su consulta.
    """
    return por_peticion('mapa_roles', _leer_mapa_roles)


def _leer_mapa_roles() -> dict:
    try:
        from .models import Rol
        mapa = {r.nombre: {'clave': r.clave, 'nivel': r.nivel, 'nombre': r.nombre,
                           'protegido': r.protegido} for r in Rol.objects.all()}
    except Exception:
        mapa = {}
    if not mapa:
        return _mapa_de_fabrica()
    # El grupo viejo sigue valiendo lo que valga hoy el puesto de técnico, aunque
    # lo hayan renombrado: la cuenta que quedó en 'Almacén' no se cae del panel.
    tecnico = next((v for v in mapa.values() if v['clave'] == CLAVE_TECNICO), None)
    if tecnico and ROL_TECNICO_ANTERIOR not in mapa:
        mapa[ROL_TECNICO_ANTERIOR] = dict(tecnico, nombre=ROL_TECNICO_ANTERIOR)
    return mapa


def roles_editables() -> tuple:
    """Las claves de los puestos que la pantalla reparte, de mayor a menor nivel.

    El Dueño no está: lo puede todo, siempre, y una casilla suya solo sería una
    forma de encerrarse fuera de su propio sistema.
    """
    vistos = {}
    for datos in mapa_roles().values():
        vistos.setdefault(datos['clave'], datos)
    return tuple(k for k, v in sorted(
        vistos.items(), key=lambda kv: (-kv[1]['nivel'], kv[1]['nombre'])))


def clave_de_grupo(nombre: str) -> str:
    """La identidad interna del puesto que se llama así, o ''.

    Es el traductor para todo lo que recibe un NOMBRE de fuera —un formulario,
    un selector, una fila vieja— y necesita preguntar por el puesto de verdad.
    Comparar el nombre contra una constante deja de funcionar en cuanto alguien
    renombra el puesto, y falla en silencio.
    """
    datos = mapa_roles().get((nombre or '').strip())
    return datos['clave'] if datos else ''


def nombre_de_rol(clave: str) -> str:
    """El nombre visible de un puesto. Si no está en la base, el de fábrica."""
    for datos in mapa_roles().values():
        if datos['clave'] == clave:
            return datos['nombre']
    return NOMBRE_FABRICA.get(clave, clave)


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
    # El nivel sale del puesto, y el puesto de la tabla: así un rol creado por el
    # dueño entra al panel sin que nadie toque este archivo. Con varios grupos
    # manda el más alto, como siempre.
    mapa = mapa_roles()
    niveles = [mapa[g]['nivel'] for g in _grupos(user) if g in mapa]
    return max(niveles) if niveles else SIN_ACCESO


def _puesto_de(user):
    """El puesto que manda cuando alguien trae varios grupos: el de más nivel, y
    a igualdad de nivel el que va primero en el orden de fábrica."""
    mapa = mapa_roles()
    suyos = [mapa[g] for g in _grupos(user) if g in mapa]
    if not suyos:
        return None
    orden = {c: i for i, c in enumerate(CLAVES_FABRICA)}
    return sorted(suyos, key=lambda d: (-d['nivel'], orden.get(d['clave'], 99), d['nombre']))[0]


def clave_de(user) -> str:
    """La identidad INTERNA del puesto. Es con la que se guardan los permisos y
    con la que el código pregunta; el nombre visible cambia, esto no."""
    if not user or not user.is_authenticated or not user.is_active or user.is_superuser:
        return ''
    puesto = _puesto_de(user)
    return puesto['clave'] if puesto else ''


def rol_de(user) -> str:
    """Etiqueta del rol para mostrar, tomada del grupo. Cajero y Técnico comparten
    nivel, así que el número no alcanza para nombrarlos."""
    if not user or not user.is_authenticated or not user.is_active:
        return ETIQUETA_NIVEL[SIN_ACCESO]
    if user.is_superuser:
        return ETIQUETA_NIVEL[NIVEL_DUENO]
    puesto = _puesto_de(user)
    if puesto:
        # El grupo viejo 'Almacén' se enseña con el nombre que tenga hoy su
        # puesto: quien lo tiene ES el técnico, aunque su grupo se llame distinto.
        return nombre_de_rol(puesto['clave'])
    # is_staff sin grupo con nombre: administración "de fábrica".
    return ETIQUETA_NIVEL[nivel_de(user)]


def es_gestor(user) -> bool:
    """Gestor puro: en el grupo 'Gestor' y sin un nivel más alto que lo eleve.

    Se distingue del Administrador por el grupo, porque comparten el número. La
    diferencia importa: al Gestor las acciones delicadas le piden el NIP del
    DUEÑO, no el suyo.
    """
    return nivel_de(user) == NIVEL_ADMIN and clave_de(user) == CLAVE_GESTOR


def es_cajero(user) -> bool:
    """Cajero puro: en el grupo 'Cajero' y sin un nivel más alto que lo eleve. Se
    distingue del técnico por el grupo, porque comparten el número."""
    return nivel_de(user) == NIVEL_TECNICO and clave_de(user) == CLAVE_CAJERO


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
    # LEVANTAR una renta y TRABAJARLA son dos cosas distintas, y hasta ahora la
    # segunda no tenía nombre. `rentar` viene apagada para el técnico a propósito
    # (la renta se levanta en el mostrador o en administración) y `jornada_campo`
    # no cascadea hacia arriba, así que las rutas de campo se quedaban gateadas
    # por NIVEL: el cajero, que nunca sale, leía el tablero completo con adeudos.
    Capacidad('operar_jornada', 'Operar la jornada de campo',
              'Entregar, recoger y subir las fotos de una renta que ya existe. '
              'Distinto de rentar, que es LEVANTARLA: el técnico opera lo que '
              'otro levantó.', NIVEL_TECNICO,
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
    # Un cupón no es "editar el catálogo": es margen que se regala, y de los
    # reutilizables basta uno para que se cosechen. Por eso se apaga aparte de
    # tocar precios, aunque las dos vivan en el mismo bloque de la pantalla.
    Capacidad('emitir_cupones', 'Emitir cupones',
              'Crear y cambiar los cupones de descuento. Cada uno es margen que '
              'se regala, así que se enciende aparte de editar el catálogo.', NIVEL_ADMIN,
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
    # La caja es del MOSTRADOR, no de la jerarquía: `nivel_minimo=None` para que
    # NO cascadee hacia arriba. Lo pidió el dueño y además es lo que hace que el
    # arqueo signifique algo: el corte responde "¿lo que hay en el cajón es lo
    # que debería haber?" para el turno de quien lo abrió, y eso se deshace en
    # cuanto media oficina puede cobrar en el mismo cajón. Se reparte por PUESTO
    # (ver `AJUSTES_POR_PUESTO`); si mañana hace falta que alguien más cobre, el
    # dueño se la enciende a ese puesto desde Permisos.
    Capacidad('usar_caja', 'Usar la caja',
              'Cobrar en el mostrador: refacciones y, si están encendidas, '
              'maquinaria y rentas. Es del puesto de mostrador: no se enciende '
              'por nivel, ni para administración ni para el dueño.', None, 'Mostrador'),
    Capacidad('corte_caja', 'Hacer corte de caja',
              'Arqueo del turno. Va con la caja: tampoco cascadea por nivel.',
              None, 'Mostrador'),
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


#: Capacidades que ninguna pantalla reparte. HOY NO HAY NINGUNA.
#:
#: Estas cinco vivían aquí con candado —gestionar usuarios, datos bancarios,
#: borrar del catálogo, tener NIP propio y configurar los permisos—, y el dueño
#: pidió abrirlas (ago-2026): él decide a quién se las da. Es una decisión suya y
#: con consecuencias, así que queda escrita en vez de perderse en un diff:
#:
#:   · `configurar_permisos` es la llave que reparte las demás. A quien la
#:     reciba se le puede conceder TODO lo otro, incluida ella misma. El único
#:     freno que queda es el código de 6 dígitos al guardar —y para el Gestor,
#:     que ese código es el del DUEÑO (ver `seguridad.verificar_codigo`).
#:   · `tener_codigo_propio` decide quién se autoriza a sí mismo las excepciones
#:     —ajustar el precio al vender, entre otras—, que es la vía discreta de
#:     sacar dinero que documenta `CambioPrecioLista`.
#:
#: El conjunto se queda vacío y no se borra: el mecanismo sigue en pie por si
#: mañana hay que volver a cerrar alguna.
NUCLEO: frozenset = frozenset()

#: Capacidades que SÍ mandan, pero no desde `permission_classes` de una ruta.
#: La prueba que vigila que ninguna casilla sea decorativa no puede verlas, así
#: que van aquí con el lugar exacto donde se imponen. Cualquier agregado necesita
#: su renglón: esto es una excepción documentada, no un basurero.
IMPUESTAS_EN_EL_CUERPO = {
    # `ProtectedDestroyMixin.destroy` las pesa antes de borrar. Va en el mixin y
    # no en cada vista para que agregar una vista nueva no abra el hueco por
    # olvido (ver `maquinaria/views.py`).
    'borrar_catalogo': 'ProtectedDestroyMixin.destroy',
    # No es una ruta: es un FILTRO DE CAMPOS. Los datos bancarios viajan dentro
    # de la configuración del negocio, y lo que se protege es que no salgan ni
    # entren por ahí (ver `ConfiguracionSitioSerializer`).
    'editar_datos_bancarios': 'ConfiguracionSitioSerializer',
}

#: Capacidades que NO gatean endpoints porque no describen una acción, sino un
#: escritorio: qué pantalla ve alguien al entrar. Lo que se hace DESDE esos
#: escritorios (entregar, recoger, subir fotos) sí se impone por su capacidad.
#: Cualquier agregado aquí necesita su renglón de por qué; ver
#: docs/superpowers/notas/2026-08-22-inventario-permisos.md
SOLO_PANTALLA = frozenset({'jornada_campo', 'ver_jornada'})

#: Qué nivel trae cada puesto de fábrica. Los que crea el dueño traen el suyo
#: guardado en la tabla; `nivel_de_rol` los resuelve a los dos.
NIVEL_POR_ROL = dict(NIVEL_FABRICA)


def nivel_de_rol(clave: str) -> int:
    """El piso de un puesto. Los creados desde la pantalla nacen en operación."""
    for datos in mapa_roles().values():
        if datos['clave'] == clave:
            return datos['nivel']
    return NIVEL_FABRICA.get(clave, SIN_ACCESO)


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
    CLAVE_GESTOR: {'ver_dinero': False, 'configurar_negocio': True,
                   'tener_codigo_propio': False},
    # Mostrador: vende y cobra en la caja, no anda en campo. Desde que la caja
    # dejó de cascadear por nivel, estas dos líneas son la ÚNICA vía de fábrica
    # para `usar_caja` y `corte_caja`: el puesto ES la llave del cajón.
    CLAVE_CAJERO: {'rentar': False, 'reparar': False, 'operar_inventario': False,
                   'operar_jornada': False,
                   'usar_caja': True, 'corte_caja': True},
    # Técnico de campo: REPARA, ENTREGA, RECOGE y COBRA lo que él atiende.
    # No vende ni renta —eso se levanta en el mostrador o en administración—,
    # así que esas dos se apagan aunque su nivel las encendería. Sin esto el
    # panel le prometía dos cosas que no le tocan y que además no tenía dónde
    # hacer, porque Ventas y Rentas piden `ver_dinero`.
    #
    # El PADRÓN también se le apaga. Cascadeaba por nivel y le abría el módulo
    # de Clientes entero: fichas, datos de contacto, estados de cuenta y los
    # avisos de "Cuenta nueva" con el correo de quien se registró. Su trabajo
    # llega servido en "Mi jornada" —a quién le entrega y dónde va en cada
    # tarea—, así que nunca necesita buscar en el padrón.
    #
    # Ojo: se le apaga AL TÉCNICO, no al nivel. El MOSTRADOR sí lo necesita, con
    # el cliente enfrente y el cobro a medias, y el cajero comparte nivel con él.
    CLAVE_TECNICO: {'jornada_campo': True, 'vender': False, 'rentar': False,
                    'ver_clientes': False, 'editar_clientes': False},
}


def capacidades_fabrica(clave: str) -> dict:
    """Lo que un puesto puede ANTES de que el dueño configure nada.

    Es la misma cuenta que hacía `puede_de` —nivel, más el ajuste del puesto—,
    pero indexada por PUESTO en vez de por usuario: la pantalla necesita saber
    qué trae de fábrica sin tener a nadie de ese puesto enfrente.

    Un puesto CREADO desde la pantalla no tiene fábrica que heredar: nace con
    todo apagado y entra al panel, y nada más. Es lo contrario de lo cómodo y lo
    correcto para lo que esto es: quien inventa un puesto le enciende a mano lo
    que le toca, en vez de descubrir por accidente lo que se le coló.
    """
    if clave not in CLAVES_FABRICA:
        return {c.nombre: False for c in CATALOGO}
    nivel = NIVEL_FABRICA[clave]
    caps = {c.nombre: (c.nivel_minimo is not None and nivel >= c.nivel_minimo)
            for c in CATALOGO}
    caps.update(AJUSTES_POR_PUESTO.get(clave, {}))
    return caps


def catalogo_capacidades() -> list:
    """El catálogo como datos serializables, para que el panel pinte la matriz
    sola: etiqueta, explicación, área y si lleva candado."""
    return [{**c._asdict(), 'nucleo': c.nombre in NUCLEO} for c in CATALOGO]


def overrides_de_rol(clave: str) -> dict:
    """Lo que el dueño configuró para ese puesto.

    `NUCLEO` se sigue filtrando aunque hoy esté vacío: es el mecanismo por si
    mañana hay que volver a cerrar una capacidad, y así una fila que llegara por
    otra vía —un respaldo viejo, el /admin/ de Django— tampoco la abriría.

    Fail-closed: si la consulta truena —base a medio migrar, por ejemplo—,
    devuelve vacío y manda la fábrica. Un error no reparte permisos.
    """
    if clave not in roles_editables():
        return {}
    try:
        from .models import PermisoRol
        filas = PermisoRol.objects.filter(rol=clave).values_list('capacidad', 'permitido')
        return {cap: bool(val) for cap, val in filas if cap not in NUCLEO}
    except Exception:
        return {}


def puede_de(user) -> dict:
    """Capacidades del usuario, para que el panel oculte lo que no aplica.

    Tres capas, y la última manda:
        nivel (jerarquía) → ajuste por puesto (fábrica) → override del dueño.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.
    """
    n = nivel_de(user)
    rol = rol_de(user)
    clave = clave_de(user)
    editables = roles_editables()
    if n == SIN_ACCESO:
        caps = {c.nombre: False for c in CATALOGO}
    else:
        caps = capacidades_fabrica(clave) if clave in editables else {
            c.nombre: (c.nivel_minimo is not None and n >= c.nivel_minimo) for c in CATALOGO
        }
        # `is_staff` con un grupo de nivel 1 (cajero, técnico) vale nivel
        # ADMINISTRACIÓN aunque su grupo diga otra cosa: `nivel_de` lo eleva y las
        # clases por nivel lo dejan pasar. Si aquí lo tratáramos solo como cajero,
        # el panel le escondería lo que la API sí le permite —y ese desfase es el
        # que produce botones que responden 403 y funciones invisibles que sí
        # existen—. El nivel sigue siendo el piso; el puesto solo ajusta ENCIMA.
        if clave in editables and n > nivel_de_rol(clave):
            for c in CATALOGO:
                if c.nivel_minimo is not None and n >= c.nivel_minimo:
                    caps[c.nombre] = True
        caps.update(overrides_de_rol(clave))
    caps['nivel'] = n
    caps['rol'] = rol
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


class NoEsDelNegocio(permissions.BasePermission):
    """Los caminos del CLIENTE: invitado o cuenta de cliente, nunca el equipo.

    Decisión del dueño (sep 2026): una cuenta del negocio entra al panel a hacer
    lo de su puesto y nada más. Si alguien del equipo quiere pedir una cotización
    como cliente, se hace su cuenta de cliente.

    El motivo no es celo: es que las dos cosas se ven IGUAL en la base y después
    no se distinguen. Una cotización pedida desde la tienda por el cajero entra
    al mismo buzón que la de un cliente real, dispara los mismos correos y
    aparece en los mismos conteos —"solicitudes de esta semana"— sin que nadie
    pueda saber cuáles eran clientes. Lo mismo con los borradores y las obras
    guardadas: son el taller personal de un cliente, no del mostrador.

    Ojo con quién pasa: el ANÓNIMO sí. La tienda es pública y un visitante sin
    cuenta tiene que poder pedir su cotización; ese es el camino que da clientes
    nuevos. Lo que se corta es la cuenta con acceso al panel.

    Lo del panel NO se toca: levantar una renta, registrar una venta o cotizar
    desde Cotizaciones sigue siendo el trabajo del equipo. Aquello es el negocio
    registrando; esto es alguien pidiendo.
    """
    message = ('Tu cuenta es del equipo de REMALI y esto es del cliente. Si necesitas '
               'pedirlo como cliente, crea una cuenta de cliente; si es para el '
               'negocio, hazlo desde el panel.')

    def has_permission(self, request, view):
        u = getattr(request, 'user', None)
        if not u or not u.is_authenticated:
            return True          # invitado de la tienda: su camino de siempre
        return nivel_de(u) <= SIN_ACCESO


class PuedeVerDinero(ExigeCapacidad):
    """Las cuentas del negocio: el Resumen y sus métricas.

    Existe desde que el Resumen dejó de ser un cascarón. Mientras devolvía ceros
    daba igual quién lo llamara; ahora dice cuánto entró cada día y cada mes, que
    es justo lo que el Gestor NO debe ver aunque opere el negocio completo.
    """
    capacidad = 'ver_dinero'
    message = 'No tienes acceso a las cuentas del negocio.'


class PuedeConfigurarPermisos(ExigeCapacidad):
    """La pantalla de permisos. Solo el Dueño: `configurar_permisos` es del
    núcleo y su nivel mínimo es NIVEL_DUENO, así que ningún override la abre."""
    capacidad = 'configurar_permisos'
    message = 'Solo el dueño configura los permisos.'


class PuedeConfigurarNegocio(ExigeCapacidad):
    """Los datos del negocio y los correos de aviso.

    Antes pedía nivel de administración, y eso decía lo contrario que la
    pantalla: la pestaña "Negocio y contacto" se reparte por `configurar_negocio`
    —nivel dueño, encendida de fábrica para el Gestor porque es escritorio
    delegado—, así que el Administrador podía cambiar el nombre y los correos del
    negocio por API desde una pestaña que nunca vio. Los datos BANCARIOS siguen
    aparte, filtrados en el serializer por `editar_datos_bancarios`.
    """
    capacidad = 'configurar_negocio'
    message = 'No puedes configurar el negocio.'


class PuedeUsarCaja(ExigeCapacidad):
    """La caja (POS del mostrador). No es un nivel, y desde ago-2026 tampoco
    cascadea: el cajero la usa aunque comparta número con el técnico, y NADIE
    más la trae de fábrica —ni administración, ni el gestor, ni el dueño—.
    Cobrar en el cajón es el puesto de mostrador; lo demás se vende desde
    Ventas, Pedidos o Rentas, que tienen sus propias capacidades."""
    capacidad = 'usar_caja'
    message = 'No tienes acceso a la caja.'


class PuedeHacerCorteCaja(ExigeCapacidad):
    """Cerrar el turno y leer el arqueo del día.

    Iba pegada a `usar_caja` —abrir la caja y cerrarla pedían lo mismo—, así que
    la casilla "Hacer corte de caja" de la matriz no le quitaba nada a nadie. No
    exige ADEMÁS `usar_caja` a propósito: el reparto que hace falta es al revés,
    que alguien cobre todo el día y que el cierre lo haga otro.
    """
    capacidad = 'corte_caja'
    message = 'No puedes hacer el corte de caja.'


class PuedeCotizar(ExigeCapacidad):
    """Cotizaciones. No es un nivel: el asesor cotiza aunque comparta número con
    el técnico (que no cotiza), y de administración para arriba también. Por eso
    pregunta por la capacidad. Ojo: cotizar NO es convertir a venta ni facturar;
    esos siguen pidiendo su propia capacidad (vender / ver_dinero / admin)."""
    capacidad = 'cotizar'
    message = 'No puedes gestionar cotizaciones.'


class PuedeFacturar(ExigeCapacidad):
    """La bandeja de por facturar y lo que entra a ella.

    Las dos puertas de la bandeja pedían cosas distintas sin razón: mandar una
    VENTA a facturar era de administración y mandar una RENTA le bastaba al
    técnico de campo, que ni siquiera tiene la sección donde ver el resultado.
    """
    capacidad = 'facturar'
    message = 'No tienes acceso a la facturación.'


class PuedeOperarJornada(ExigeCapacidad):
    """El ciclo de campo de una renta que ya existe: entregar, recoger, evidencias.

    No es un nivel: el técnico —que NO levanta rentas— es justo quien lo hace, y
    el cajero, que comparte su número, no sale al campo. Tampoco es `rentar`
    (levantar es otro trabajo) ni `jornada_campo` (es una pantalla y no cascadea,
    así que administración se quedaría sin poder entregar desde Rentas).
    """
    capacidad = 'operar_jornada'
    message = 'No puedes operar las entregas y devoluciones de campo.'


class PuedeReparar(ExigeCapacidad):
    """Hacer el trabajo del taller: recibir la máquina y trabajar la orden.

    Es lo que el técnico hace desde Mi jornada, y pedía solo nivel: el cajero,
    que comparte su número y no pisa el taller, podía abrir cualquier orden y
    consumirle refacciones. No es `gestionar_reparaciones`, que es la SECCIÓN
    —historial, costos, entrega al cliente— y vive un nivel más arriba.
    """
    capacidad = 'reparar'
    message = 'No puedes trabajar órdenes de reparación.'


class PuedeGestionarUsuarios(ExigeCapacidad):
    """Dar de alta al equipo, cambiarle el puesto y quitarle el acceso.

    Era de nivel dueño y ahora se reparte: quien la reciba puede crear cuentas y
    asignarles puesto, o sea repartir acceso al panel. El dueño no se puede
    quedar fuera —su nivel se la enciende siempre y los overrides no lo tocan—,
    así que no hay forma de encerrarlo fuera de su propio sistema.
    """
    capacidad = 'gestionar_usuarios'
    message = 'No puedes gestionar las cuentas del equipo.'


class PuedeTenerCodigoPropio(ExigeCapacidad):
    """Fijarse un NIP propio, el que autoriza las acciones delicadas.

    Quien lo tiene se autoriza SOLO sus propias excepciones —ajustar un precio,
    un anticipo bajo el mínimo—, y por eso el Gestor no lo trae de fábrica: las
    suyas las aprueba el dueño con el de él, que es una persona distinta de la
    que ejecuta.
    """
    capacidad = 'tener_codigo_propio'
    message = ('Tu puesto no usa código propio: las acciones que lo requieren '
               'las autoriza el dueño con el suyo.')


class PuedeVender(ExigeCapacidad):
    """Registrar la venta de una máquina: apartados, pedidos y entregas.

    Viene apagada de fábrica para el técnico —la venta se levanta en el
    mostrador o en administración—, y ese apagado vivía solo en la pantalla
    porque las rutas pedían NIVEL. Cobrar refacciones en el mostrador es otra
    cosa (`usar_caja`): esto mueve una máquina del patrimonio.
    """
    capacidad = 'vender'
    message = 'No puedes registrar ventas.'


class PuedeRentar(ExigeCapacidad):
    """LEVANTAR una renta: crearla, renovarla, sustituirle la unidad, resolver
    el depósito.

    Distinto de operarla (`operar_jornada`), que es entregar y recoger lo que
    otro levantó. Ni el técnico ni el cajero rentan de fábrica, y las dos rutas
    de campo estaban gateadas por nivel, así que los dos podían.
    """
    capacidad = 'rentar'
    message = 'No puedes levantar rentas.'


class PuedeVerOperacion(ExigeCapacidad):
    """Las listas del negocio: ventas, rentas, adeudos y pedidos con sus montos.

    Es la mitad que se separó de `ver_dinero` para que alguien trabaje la
    operación sin ver las cuentas del negocio (hay que poder abrir una venta
    para cancelarla). La separación estaba escrita en el catálogo y no en las
    rutas.
    """
    capacidad = 'ver_operacion'
    message = 'No puedes ver la operación comercial.'


class PuedeVerMontosOperacion(ExigeCapacidad):
    """Cobrar y comprobar lo que uno mismo atiende: abonos, comprobantes, tickets.

    El técnico cobra en campo y el cajero en el mostrador. Es la casilla que se
    apaga cuando alguien tiene que entregar sin manejar dinero, y no incluye las
    listas del negocio (`ver_operacion`) ni las cuentas (`ver_dinero`).
    """
    capacidad = 'ver_montos_operacion'
    message = 'No puedes ver ni mover los montos de esta operación.'


class PuedeEditarCatalogo(ExigeCapacidad):
    """Equipos, marcas, categorías, tipos, imágenes y precios de lista.

    Es el patrimonio y el precio con el que se cotiza todo, así que arranca en
    administración. Como casilla sirve para lo contrario de lo de siempre:
    dejarle a alguien el negocio entero y congelarle los precios. BORRAR del
    catálogo no vive aquí —es del dueño, por `borrar_catalogo`— porque es la
    forma de encubrir una máquina que falta. La LECTURA tampoco: la tienda
    pública se sirve del mismo catálogo y nadie la puede dejar en blanco.
    """
    capacidad = 'editar_catalogo'
    message = 'No puedes editar el catálogo.'


class PuedeDarAltaInventario(ExigeCapacidad):
    """Meter unidades y refacciones NUEVAS al inventario.

    Distinto de editar el catálogo (qué modelos existen y a cuánto) y de mover
    unidades (dónde está lo que ya hay): esto AUMENTA lo que la casa dice tener.
    Se separa para que el dueño pueda dejarle el almacén a alguien sin subirlo a
    administración, que era la única forma de darle el alta.
    """
    capacidad = 'alta_inventario'
    message = 'No puedes dar de alta unidades ni refacciones.'


class PuedeOperarInventario(ExigeCapacidad):
    """Mover de estado y ubicación las unidades que ya existen.

    Es el trabajo de patio del técnico: mandar una máquina a taller y regresarla
    a disponible. El cajero comparte su nivel y su ajuste de puesto ya la traía
    apagada, pero como la ruta pedía NIVEL ese apagado se quedaba en la pantalla.
    """
    capacidad = 'operar_inventario'
    message = 'No puedes mover unidades del inventario.'


class PuedeGestionarReparaciones(ExigeCapacidad):
    """Llevar el taller: la sección Reparaciones completa.

    Es el otro lado de `reparar`. Aquí vive el historial de las cuatro etapas,
    los costos y la entrega al cliente; el técnico no la necesita porque sus
    órdenes abiertas ya le llegan por Mi jornada, y abrírsela era duplicarle su
    propio día en otra pantalla. BORRAR la orden va aquí por la misma razón que
    borrar del catálogo va con el dueño: reintegra el stock consumido y borra el
    rastro de un trabajo que ya se hizo.
    """
    capacidad = 'gestionar_reparaciones'
    message = 'No puedes administrar las órdenes de reparación.'


class PuedeEmitirCupones(ExigeCapacidad):
    """Los cupones de descuento. Aparte de `editar_catalogo` porque emitir uno
    no cambia el precio de lista: regala margen sobre el que ya está, y listar
    los reutilizables es cosecharlos."""
    capacidad = 'emitir_cupones'
    message = 'No puedes emitir cupones.'


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
