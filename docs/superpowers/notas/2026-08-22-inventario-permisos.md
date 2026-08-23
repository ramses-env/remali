# Inventario de imposición de permisos

Fecha: 2026-08-22 · Tarea 9 del plan
`docs/superpowers/plans/2026-08-22-permisos-configurables.md`.

Qué es esto: la lista COMPLETA de rutas de `/api/` que hoy llevan candado, con
qué lo llevan, y —para las que se gatean por NIVEL— la marca de qué hacer con
ellas en las Tareas 10 y 11. Se ejecuta desde aquí: cada renglón trae su ruta,
su `archivo:línea` y su marca.

Las tres marcas del plan:

- **`→ <capacidad>`** — se convierte a `ExigeCapacidad` en la Tarea 10/11.
- **`nivel legítimo`** — protege una sección o un acto irreversible sin una
  capacidad concreta detrás. Se queda como está, con su razón.
- **`solo pantalla`** — la capacidad no gatea endpoints, solo decide qué se ve.
- **`POR DECIDIR`** — no hay respuesta honesta con el catálogo de hoy. La duda
  está escrita; hay que resolverla ANTES de convertir esa ruta.

---

## 1. Los números reales (y por qué no son los del plan)

El plan hablaba de **58 rutas por capacidad y 102 por nivel**. No es lo que hay.
Números medidos el 2026-08-22 sobre la rama `dev`:

| Cómo se gatea | Rutas |
|---|---|
| Total de rutas bajo `/api/` | **185** |
| Por CAPACIDAD, con `permission_classes` | **32** |
| ├ subclases de `ExigeCapacidad` (lo que el recolector ve) | 13 |
| └ clases ad-hoc que preguntan `puede_de()` a mano | 19 |
| Por NIVEL, con `permission_classes` | **79** |
| Por NIVEL, escondidas en `get_permissions()` | **11** |
| **Total por nivel (79 + 11)** | **90** |
| `IsAuthenticated` a secas | 46 (35 tras descontar las 11 de arriba) |
| `AllowAny` | 28 |

### Cómo se midió (el script del Paso 1 NO alcanza)

El script del Paso 1 corrió tal cual y dio `13` por capacidad y `79` por nivel.
Se complementó con tres pasadas más, porque el script tiene tres puntos ciegos:

1. **Vistas basadas en clase**: sí las ve (`view_class`/`cls`), pero solo baja
   UN nivel de `url_patterns`. Aquí no importó —`server/urls.py` monta las 9
   apps a un solo nivel bajo `api/`— y se confirmó con un recorrido recursivo:
   las mismas 185 rutas, que además cuadran con los `path(` declarados
   (12+29+8+3+18+62+3+25+25 = 185).
2. **`get_permissions()` dinámico**: 9 vistas deciden el permiso por método HTTP
   en tiempo de ejecución. El atributo `permission_classes` de esas clases dice
   `IsAuthenticated` (el default de settings) y el script las cuenta como no
   gateadas. Son 11 rutas. Se encontraron con
   `grep -rn "def get_permissions" apps/`.
3. **Permisos dentro del cuerpo**: 8 lugares llaman `puede_de(...)` dentro de la
   vista o del serializer, sin `permission_classes`. Se encontraron con
   `grep -rn "puede_de(" apps/`. Ver §6.

También había que saber que **`PuedeUsarCaja` y `PuedeCotizar` NO heredaban de
`ExigeCapacidad`**: eran `BasePermission` que preguntaban `puede_de(...).get(...)`
a mano (`apps/maquinaria/permissions.py`). Por eso 19 rutas que SÍ se gatean por
capacidad no aparecían en el recolector, ni en la prueba nueva.

> **RESUELTO en la Tarea 10 (2026-08-22).** Las dos heredan ya de
> `ExigeCapacidad` con `capacidad = 'usar_caja'` / `capacidad = 'cotizar'`.
> Sus cuerpos eran letra por letra los de `ExigeCapacidad.has_permission`, así
> que no se aplanó ningún comportamiento; solo se conservaron sus `message`, que
> son texto para el usuario. Las 19 rutas se volvieron visibles de golpe y la
> lista de huérfanas bajó de 14 a 12 sin tocar una sola vista.

---

## 2. Rutas ya gateadas por CAPACIDAD

### 2.1 Con `ExigeCapacidad` (las que la prueba nueva ve) — 13

| Ruta | Capacidad | archivo:línea |
|---|---|---|
| `/api/clientes/` | `ver_clientes` | `apps/clientes/views.py:53` |
| `/api/clientes/<int:pk>/` | `ver_clientes` | `apps/clientes/views.py:308` |
| `/api/clientes/<int:pk>/documentos/` | `ver_clientes` | `apps/clientes/views.py:167` |
| `/api/clientes/<int:pk>/estado-cuenta/` | `ver_clientes` | `apps/clientes/views.py:384` |
| `/api/clientes/buscar/` | `ver_clientes` | `apps/clientes/views.py:400` |
| `/api/clientes/catalogo/` | `ver_clientes` | `apps/clientes/views.py:445` |
| `/api/clientes/sin-vincular/` | `ver_clientes` | `apps/clientes/views.py:209` |
| `/api/clientes/<int:pk>/contactos/` | `editar_clientes` | `apps/clientes/views.py:337` |
| `/api/clientes/<int:pk>/vincular/` | `editar_clientes` | `apps/clientes/views.py:234` |
| `/api/clientes/contactos/<int:pk>/` | `editar_clientes` | `apps/clientes/views.py:357` |
| `/api/dashboard/metricas/` | `ver_dinero` | `apps/maquinaria/views.py:1250` |
| `/api/permisos/` | `configurar_permisos` | `apps/maquinaria/views_permisos.py:51` |
| `/api/permisos/bitacora/` | `configurar_permisos` | `apps/maquinaria/views_permisos.py:111` |

### 2.2 Con clase ad-hoc (capacidad de verdad, invisible para la prueba) — 19

`PuedeUsarCaja` → capacidad `usar_caja` · `PuedeCotizar` → capacidad `cotizar`.
**HECHO (Tarea 10): las dos heredan ya de `ExigeCapacidad`, así que estas 19
rutas dejaron de ser invisibles y pasaron a contar en §2.1.** Lo que sigue
pendiente de ellas es solo el reparto fino: las dos marcadas `→ corte_caja`.

| Ruta | Clase | archivo:línea |
|---|---|---|
| `/api/caja/devolucion/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:313` |
| `/api/caja/sesion-actual/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:139` |
| `/api/caja/sesiones/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:254` |
| `/api/caja/sesiones/<int:pk>/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:242` |
| `/api/caja/sesiones/<int:pk>/cerrar/` | `PuedeUsarCaja` → debería ser **`corte_caja`** | `apps/ventas/caja_views.py:174` |
| `/api/caja/sesiones/<int:pk>/movimiento/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:204` |
| `/api/caja/sesiones/abrir/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:147` |
| `/api/caja/ventas-recientes/` | `PuedeUsarCaja` | `apps/ventas/caja_views.py:269` |
| `/api/ventas/mostrador/` | `PuedeUsarCaja` | `apps/ventas/views.py:55` |
| `/api/ventas/corte/` | `PuedeUsarCaja` → debería ser **`corte_caja`** | `apps/ventas/views.py:138` |
| `/api/cotizaciones/` | `PuedeCotizar` | `apps/cotizaciones/views.py:458` |
| `/api/cotizaciones/<int:pk>/atender/` | `PuedeCotizar` | `apps/cotizaciones/views.py:912` |
| `/api/cotizaciones/<int:pk>/enviar/` | `PuedeCotizar` | `apps/cotizaciones/views.py:1089` |
| `/api/cotizaciones/<int:pk>/fotos/` | `PuedeCotizar` | `apps/cotizaciones/views.py:995` |
| `/api/cotizaciones/<int:pk>/fotos/<int:foto_id>/` | `PuedeCotizar` | `apps/cotizaciones/views.py:1157` |
| `/api/cotizaciones/<int:pk>/items/` | `PuedeCotizar` | `apps/cotizaciones/views.py:636` |
| `/api/cotizaciones/<int:pk>/items/<int:item_id>/` | `PuedeCotizar` | `apps/cotizaciones/views.py:938` |
| `/api/cotizaciones/<int:pk>/items/<int:item_id>/modalidad/` | `PuedeCotizar` | `apps/cotizaciones/views.py:708` |
| `/api/cotizaciones/<int:pk>/pdf/` | `PuedeCotizar` | `apps/cotizaciones/views.py:1050` |

**Ojo con `corte_caja`**: hoy NADA la exige. Abrir turno y cerrarlo piden lo
mismo (`usar_caja`), así que el interruptor `corte_caja` de la matriz no hace
nada. Es el ejemplo perfecto del interruptor decorativo que la prueba busca.

---

## 3. Rutas gateadas por NIVEL, con su marca (79)

### 3.1 Llaves del negocio y puerta del panel

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/config/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:339` | **`→ configurar_negocio`** |
| `/api/config/correos/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:362` | **`→ configurar_negocio`** |
| `/api/config/correos/<int:pk>/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:371` | **`→ configurar_negocio`** |
| `/api/config/correos/<int:pk>/reenviar/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:379` | **`→ configurar_negocio`** |
| `/api/auth/codigo-seguridad/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:308` | **`→ tener_codigo_propio`** — ya lo revisa en el cuerpo (`views.py:322`); solo hay que subirlo a `permission_classes` y quitar el `if`. Es del NÚCLEO, así que ningún override la abre. |
| `/api/usuarios/` | `EsDueno` | `apps/maquinaria/views_usuarios.py:108` | **`→ gestionar_usuarios`** (núcleo, nivel dueño) |
| `/api/usuarios/<int:pk>/` | `EsDueno` | `apps/maquinaria/views_usuarios.py:166` | **`→ gestionar_usuarios`** |
| `/api/usuarios/roles/` | `EsDueno` | `apps/maquinaria/views_usuarios.py:98` | **`→ gestionar_usuarios`** |
| `/api/config/validar-codigo-ajuste/` | `EsOperador` | `apps/maquinaria/views.py:297` | `nivel legítimo` — valida el NIP PROPIO de quien ya entró; es identidad, no un poder. |
| `/api/latido/` | `EsOperador` | `apps/maquinaria/views.py:1150` | `nivel legítimo` — es la puerta del panel (sellos de tema), no una acción. |
| `/api/dashboard/conteos/` | `EsOperador` | `apps/maquinaria/views.py:1204` | `nivel legítimo` — los globitos del menú; el propio código lo dice: "son conteos, no dinero". |
| `/api/notificaciones/<int:pk>/eliminar/` | `EsOperador` | `apps/maquinaria/views.py:1430` | `nivel legítimo` — buzón del panel; el filtro por rol ya está dentro (`_tipos_broadcast_por_rol`). |
| `/api/notificaciones/limpiar/` | `EsOperador` | `apps/maquinaria/views.py:1451` | `nivel legítimo` — misma razón. |

### 3.2 Catálogo e inventario

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/categorias/<int:pk>/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:236` | **`→ editar_catalogo`** · ver hueco en §5.1 |
| `/api/tipos/<int:pk>/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:242` | **`→ editar_catalogo`** · ver §5.1 |
| `/api/marcas/<int:pk>/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:248` | **`→ editar_catalogo`** · ver §5.1 |
| `/api/equipos/<int:pk>/imagenes/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:193` | **`→ editar_catalogo`** |
| `/api/equipos/<int:equipo_id>/unidades/proximo-codigo/` | `IsAdminGroupOrStaff` | `apps/inventario/views.py:89` | **`→ alta_inventario`** — es el paso previo al alta; va con el POST de `/unidades/`. |
| `/api/unidades/<int:pk>/mantenimiento/` | `EsOperador` | `apps/inventario/views.py:165` | **`→ operar_inventario`** — es exactamente "cambiar el estado de una unidad que ya existe". |
| `/api/unidades/<int:pk>/vender/` | `EsOperador` | `apps/inventario/views.py:268` | **`→ vender`** — el comentario del código ("el técnico también vende en campo") CONTRADICE el ajuste de puesto `ROL_TECNICO: vender=False`. Al convertir, el técnico deja de poder: es el comportamiento que la matriz promete. Confirmar con el dueño en la Tarea 11. |
| `/api/unidades/` | `EsOperador` | `apps/inventario/views.py:98` | `nivel legítimo` — lectura de la lista global de unidades; la necesita todo el panel (rentar, vender, reparar) y no hay una capacidad de "leer inventario". |
| `/api/equipos/<int:equipo_id>/inventario-resumen/` | `EsOperador` | `apps/inventario/views.py:148` | `nivel legítimo` — conteo por estado, sin montos. |
| `/api/refacciones/buscar/` | `EsOperador` | `apps/refacciones/views.py:47` | `nivel legítimo` — lookup por código de barras para el lector; lo usan la caja y el taller, y la acción que sigue sí lleva su capacidad. |
| `/api/cupones/<int:pk>/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:405` | **POR DECIDIR** — no hay capacidad para cupones. Candidatas: `editar_catalogo` (son parte de la oferta) o `ver_dinero` (un cupón es un descuento y quien lo emite regala margen). Emitir cupones es una vía de fuga de dinero, así que quizá merece capacidad propia. |

### 3.3 Rentas

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/rentas/crear/` | `EsOperador` | `apps/renta/views.py:616` | **`→ rentar`** |
| `/api/rentas/<int:pk>/renovar/` | `EsOperador` | `apps/renta/views.py:906` | **`→ rentar`** |
| `/api/rentas/<int:pk>/sustituir-unidad/` | `EsOperador` | `apps/renta/views.py:1192` | **`→ rentar`** |
| `/api/rentas/<int:pk>/deposito/` | `EsOperador` | `apps/renta/views.py:1120` | **`→ rentar`** — resolver el depósito es parte del ciclo de la renta. |
| `/api/rentas/` | `EsOperador` | `apps/renta/views.py:295` | **`→ ver_operacion`** — es literalmente "la lista de rentas con sus montos". |
| `/api/rentas/adeudos/` | `EsOperador` | `apps/renta/views.py:374` | **`→ ver_operacion`** — la cobranza es parte de la operación, no del Resumen. |
| `/api/rentas/alertas/` | `EsOperador` | `apps/renta/views.py:605` | **`→ ver_operacion`** — devuelve la renta COMPLETA serializada (con montos), no solo un aviso. |
| `/api/rentas/export/` | `EsOperador` | `apps/renta/views.py:216` | **`→ ver_dinero`** — "reportes exportables" es la definición literal de `ver_dinero`. Hoy nivel 1: **el técnico se puede bajar todas las rentas con montos en CSV.** |
| `/api/rentas/adeudos/export/` | `EsOperador` | `apps/renta/views.py:259` | **`→ ver_dinero`** — misma fuga, con la cartera completa. |
| `/api/rentas/<int:pk>/abonos/` | `EsOperador` | `apps/renta/views.py:445` | **`→ ver_montos_operacion`** — "cobrar lo que uno mismo atiende"; el técnico cobra en campo. |
| `/api/rentas/<int:pk>/comprobante/` | `EsOperador` | `apps/renta/views.py:1286` | **`→ ver_montos_operacion`** |
| `/api/rentas/<int:pk>/ticket/` | `EsOperador` | `apps/renta/views.py:1298` | **`→ ver_montos_operacion`** |
| `/api/rentas/<int:pk>/por-facturar/` | `EsOperador` | `apps/renta/views.py:408` | **`→ facturar`** — inconsistencia hoy: la gemela de ventas (`/api/ventas/<pk>/por-facturar/`) pide nivel 2 y esta nivel 1. Convertir las dos empareja. |
| `/api/rentas/<int:pk>/vincular/` | `EsOperador` | `apps/renta/views.py:519` | **`→ editar_clientes`** · ver §5.2 |
| `/api/rentas/<int:pk>/vinculo/` | `IsAdminGroupOrStaff` | `apps/renta/views.py:546` | **`→ editar_clientes`** · ver §5.2 |
| `/api/rentas/<int:pk>/cancelar/` | `IsAdminGroupOrStaff` | `apps/renta/views.py:1258` | `nivel legítimo` — reversa de una operación cerrada, irreversible; no hay capacidad de "cancelar" y el catálogo pone a propósito al Gestor a poder cancelar sin `ver_dinero`. |
| `/api/rentas/<int:pk>/evidencias/<int:evidencia_id>/` (DELETE) | `IsAdminGroupOrStaff` | `apps/renta/views.py:1387` | `nivel legítimo` — borrar evidencia es borrar la prueba de cómo salió la máquina: se queda arriba a propósito. |
| `/api/rentas/adeudos/fusionar/` | `EsOperador` | `apps/renta/views.py:323` | **POR DECIDIR** — funde dos "clientes" reasignando TODAS sus rentas. Su gemela `/api/clientes/<pk>/fusionar/` pide nivel 2 y esta pide nivel 1: una de las dos está mal. El catálogo dice que "fundir dos clientes sigue siendo de administración", así que `editar_clientes` (nivel 1) NO sirve. O se sube esta a nivel 2 y se marcan las dos `nivel legítimo`, o se crea una capacidad `fusionar_clientes`. |
| `/api/rentas/<int:pk>/entregar/` | ~~`EsOperador`~~ → `PuedeOperarJornada` | `apps/renta/views.py:1410` | **HECHO** — `operar_jornada`; ver §4 |
| `/api/rentas/<int:pk>/devolver/` | ~~`EsOperador`~~ → `PuedeOperarJornada` | `apps/renta/views.py:1062` | **HECHO** — `operar_jornada`; ver §4 |
| `/api/rentas/<int:pk>/evidencias/` (GET/POST) | ~~`EsOperador`~~ → `PuedeOperarJornada` | `apps/renta/views.py:1327` | **HECHO** — `operar_jornada`; ver §4 |
| `/api/rentas/tareas/` | ~~`EsOperador`~~ → `PuedeOperarJornada` | `apps/renta/views.py:1517` | **HECHO** — `operar_jornada`; ver §4 |

### 3.4 Ventas, pedidos y apartados

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/ventas/lista/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:293` | **`→ ver_operacion`** |
| `/api/ventas/pedidos/` | `EsOperador` | `apps/ventas/views.py:444` | **`→ ver_operacion`** — "…y pedidos con sus montos". |
| `/api/ventas/export/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:239` | **`→ ver_dinero`** — reporte exportable. |
| `/api/ventas/pedidos/crear/` | `EsOperador` | `apps/ventas/views.py:743` | **`→ vender`** |
| `/api/ventas/<int:pk>/entregar/` | `EsOperador` | `apps/ventas/views.py:611` | **`→ vender`** — ojo: adentro (`views.py:653`) ya exige `alta_inventario` para dar de alta la unidad que llegó; ese `if` se queda. |
| `/api/ventas/<int:pk>/pedido-fase/` | `EsOperador` | `apps/ventas/views.py:701` | **`→ vender`** |
| `/api/ventas/<int:pk>/abono/` | `EsOperador` | `apps/ventas/views.py:520` | **`→ ver_montos_operacion`** |
| `/api/ventas/<int:pk>/comprobante/` | `EsOperador` | `apps/ventas/views.py:1086` | **`→ ver_montos_operacion`** |
| `/api/ventas/<int:pk>/ticket/` | `EsOperador` | `apps/ventas/views.py:1098` | **`→ ver_montos_operacion`** |
| `/api/ventas/<int:pk>/por-facturar/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:982` | **`→ facturar`** |
| `/api/ventas/<int:pk>/vinculo/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:1019` | **`→ editar_clientes`** · ver §5.2 |
| `/api/ventas/<int:pk>/cancelar/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:910` | `nivel legítimo` — reversa irreversible; es el caso que el catálogo cita para separar `ver_operacion` de `ver_dinero` ("el Gestor tiene que poder abrir una venta para cancelarla"). |
| `/api/ventas/<int:pk>/maquinas/<int:linea_id>/quitar/` | `IsAdminGroupOrStaff` | `apps/ventas/views.py:854` | `nivel legítimo` — misma familia: corregir una venta cerrada devolviendo una máquina al inventario. |

### 3.5 Cotizaciones

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/cotizaciones/stats/` | ~~`IsAdminGroupOrStaff`~~ → `PuedeCotizar` + `PuedeVerDinero` | `apps/cotizaciones/views.py:576` | **HECHO (Tarea 10)** — son los KPIs y las pestañas de la propia sección, pero devuelve `monto_aceptado` (la suma de TODAS las aceptadas del periodo), que es dinero agregado del negocio. Por la regla del Paso 3 se conservó `ver_dinero` junto a la capacidad. **Consecuencia a revisar con el dueño: el Gestor tiene `cotizar` por nivel pero `ver_dinero` apagado a propósito, así que pierde los KPIs y los conteos de las pestañas de Cotizaciones (`cotizaciones.tsx` pinta el banner rojo de fallo, `Dashboard.tsx:382` se traga el 403 y deja el globito en 0).** A cambio se cierra el hueco de hoy: con nivel 2 el Gestor ya veía `monto_aceptado`. La salida limpia, si el dueño la quiere, es dejar la ruta en `PuedeCotizar` y omitir `monto_aceptado` a quien no tenga `ver_dinero`. |
| `/api/cotizaciones/<int:pk>/convertir/` | `IsAdminGroupOrStaff` | `apps/cotizaciones/views.py:752` | **`→ vender`** — lo dice el docstring de `PuedeCotizar`: "cotizar NO es convertir a venta". |
| `/api/cotizaciones/<int:pk>/vincular/` | `EsOperador` | `apps/cotizaciones/views.py:260` | **`→ editar_clientes`** · ver §5.2 |
| `/api/cotizaciones/<int:pk>/vinculo/` | `EsOperador` | `apps/cotizaciones/views.py:301` | **`→ editar_clientes`** · ver §5.2 |
| `/api/cotizaciones/<int:pk>/aprobar-cancelacion/` | `IsAdminGroupOrStaff` | `apps/cotizaciones/views.py:229` | **POR DECIDIR** — dos lecturas defendibles y opuestas: (a) `cotizar`, porque es trabajo de la sección; (b) `ver_dinero`, para igualar la regla que YA está escrita dentro del PATCH de estado (`views.py:537`: aceptar o rechazar exige `ver_dinero`). Si se elige (a), este endpoint se vuelve la puerta de atrás para cerrar una cotización sin `ver_dinero`. |

### 3.6 Facturación (todas `IsAdminGroupOrStaff`)

| Ruta | archivo:línea | Marca |
|---|---|---|
| `/api/facturacion/solicitudes/` | `apps/facturacion/views.py:31` | **`→ facturar`** |
| `/api/facturacion/solicitudes/<int:pk>/` | `apps/facturacion/views.py:52` | **`→ facturar`** |
| `/api/facturacion/solicitudes/<int:pk>/factura/` | `apps/facturacion/views.py:95` | **`→ facturar`** |
| `/api/facturacion/solicitudes/<int:pk>/reabrir/` | `apps/facturacion/views.py:75` | **`→ facturar`** |
| `/api/facturacion/facturas/<int:pk>/cancelar/` | `apps/facturacion/views.py:190` | **`→ facturar`** |
| `/api/facturacion/resumen/` | `apps/facturacion/views.py:38` | **`→ facturar`** — son los conteos de la bandeja, no las cuentas del negocio. |
| `/api/facturacion/export/` | `apps/facturacion/views.py:232` | **`→ facturar`** — el CSV es para el PAC/contador y sale de la bandeja; si algún día lleva montos acumulados, revisar si toca `ver_dinero`. |

### 3.7 Reparaciones (todas `EsOperador`)

| Ruta | archivo:línea | Marca |
|---|---|---|
| `/api/reparaciones/<int:pk>/` (GET/PATCH) | `apps/inventario/views.py:597` | **`→ reparar`** — es lo que Mi jornada usa para trabajar la orden (`frontend/src/routes/dashboard/jornada.tsx:515,534,552,561`). El DELETE debería pedir `gestionar_reparaciones`. |
| `/api/reparaciones/<int:pk>/items/` | `apps/inventario/views.py:634` | **`→ reparar`** — poner refacciones en la orden es hacer el trabajo. |
| `/api/reparaciones/<int:pk>/items/<int:item_id>/` | `apps/inventario/views.py:682` | **`→ reparar`** |
| `/api/reparaciones/` | `apps/inventario/views.py:575` | **`→ gestionar_reparaciones` (GET) / `reparar` (POST)** — parte por método: el GET es la SECCIÓN Reparaciones (historial y costos) y el POST es recibir una máquina en taller. Es la separación literal que describe el catálogo. |
| `/api/reparaciones/<int:pk>/vinculo/` | `apps/inventario/views.py:699` | **`→ editar_clientes`** · ver §5.2 |

### 3.8 Clientes (padrón)

| Ruta | Gate hoy | archivo:línea | Marca |
|---|---|---|---|
| `/api/clientes-lookup/` | `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:1129` | **`→ ver_clientes`** — es el buscador de CUENTAS para vincular; hoy pide nivel 2 mientras el resto del padrón ya pide `ver_clientes` (nivel 1). Convertirlo empareja la sección. |
| `/api/clientes/<int:pk>/fusionar/` | `EsAdministracion` | `apps/clientes/views.py:259` | `nivel legítimo` — el catálogo lo dice explícito en `editar_clientes`: "fundir dos clientes sigue siendo de administración". El docstring de la vista lo repite. |
| `/api/clientes/documentos/<int:pk>/` (DELETE) | `EsAdministracion` | `apps/clientes/views.py:196` | `nivel legítimo` — borrar el expediente del cliente; misma familia que fusionar. `editar_clientes` es nivel 1 y abriría el borrado al técnico. |

---

## 4. El hueco de Mi jornada (4 rutas POR DECIDIR)

`/api/rentas/tareas/`, `/api/rentas/<pk>/entregar/`, `/api/rentas/<pk>/devolver/`
y `/api/rentas/<pk>/evidencias/`.

El plan dice que lo que se hace DESDE el escritorio del técnico ("entregar,
recoger, subir fotos") sí se impone por su capacidad. **Con el catálogo de hoy
no hay ninguna capacidad que sirva**, y es un hallazgo, no un descuido de este
inventario:

- `rentar` no sirve: `AJUSTES_POR_PUESTO[None]` apaga `rentar` para el técnico
  (`permissions.py`), y el técnico es justo quien entrega y recoge desde
  `frontend/src/routes/dashboard/jornada.tsx:375`. Gatear con `rentar` deja al
  técnico sin poder hacer su trabajo.
- `jornada_campo` no sirve: `nivel_minimo=None`, así que administración NO la
  tiene; gatear con ella deja al admin sin poder entregar desde Rentas. Además
  el Paso 4 la declara `SOLO_PANTALLA`.
- `operar_inventario` alcanzaría por niveles (técnico sí, cajero no), pero
  entregar y devolver cierran dinero y ciclo de renta, no solo mueven una
  unidad. Sería mentirle al nombre.

Y hay un detalle que contradice de frente el `SOLO_PANTALLA` del Paso 4:
**`/api/rentas/tareas/` ES el endpoint de Mi jornada**, la pantalla que reparten
`jornada_campo` y `ver_jornada` (`frontend/src/routes/Dashboard.tsx:560`). Hoy
pide solo `EsOperador`, así que **el Cajero —que no tiene ninguna de las dos—
puede leer el tablero de campo completo, con adeudos, aunque el menú se lo
esconda.** Si `jornada_campo`/`ver_jornada` se quedan como "solo pantalla",
ese hueco se queda abierto a propósito y hay que decirlo.

Salidas posibles, para que el dueño elija en la Tarea 11:

1. Partir `rentar` en dos: `rentar` (levantar/renovar/cancelar, nivel 2) y
   `operar_renta` (entregar, recoger, evidencias, nivel 1, encendido al técnico).
   Es lo que la realidad ya hace; solo falta el nombre.
2. Encender `rentar` al técnico y gatear todo el ciclo con ella. Más simple,
   pero le devuelve al técnico el botón de "levantar renta" que se le quitó a
   propósito.
3. Sacar `jornada_campo` de `SOLO_PANTALLA`, subirle un `nivel_minimo` y gatear
   con ella + `ver_jornada` para la lectura. Rompe la prueba
   `test_solo_pantalla_esta_justificada` tal como está escrita en el plan.

### RESUELTO (2026-08-22): capacidad nueva `operar_jornada`

El dueño eligió la salida 1, con nombre propio. `operar_jornada` entra al
`CATALOGO` en 'Campo y taller' con `nivel_minimo = NIVEL_TECNICO`, así que la
tienen el técnico y administración hacia arriba —el admin sigue pudiendo
entregar desde Rentas, que era lo que `jornada_campo` rompía— y en
`AJUSTES_POR_PUESTO` el **Cajero la lleva apagada**: su lugar es el mostrador,
no el campo. Con eso se cierra el hueco de `/api/rentas/tareas/`, que hoy le
dejaba leer el tablero de campo completo, con adeudos.

`rentar` se queda como está: LEVANTAR una renta y TRABAJARLA son dos trabajos, y
el técnico solo hace el segundo. Las cuatro rutas pasaron a
`PuedeOperarJornada` (`apps/maquinaria/permissions.py`), subclase de
`ExigeCapacidad` con el mismo molde que `PuedeCotizar`.

`jornada_campo` y `ver_jornada` se quedan en `SOLO_PANTALLA`: siguen decidiendo
qué escritorio se ve, y lo que se HACE desde él ya tiene su capacidad.

---

## 5. Huecos encontrados de paso

### 5.1 `borrar_catalogo` no cubre categorías, tipos ni marcas

El candado de borrar vive en `ProtectedDestroyMixin.destroy`
(`apps/maquinaria/views.py:54-74`) y solo lo usan tres vistas:
`EquipoRetrieveUpdateDestroy` (`views.py:156`), `UnidadDetail`
(`apps/inventario/views.py:126`) y `RefaccionDetail`
(`apps/refacciones/views.py:33`). `CategoriaDetail`, `TipoDetail` y `MarcaDetail`
(`views.py:236/242/248`) heredan de `generics.RetrieveUpdateDestroyAPIView` a
secas: **cualquier administración borra una categoría, un tipo o una marca sin
pasar por `borrar_catalogo`.** Arreglo: meterles el mixin.

### 5.2 Los cuatro `vincular` / `vinculo` no se ponen de acuerdo

Ligar un registro a la cuenta de un cliente aparece en renta, venta, cotización y
orden de reparación, con dos gates distintos sin razón:

| Ruta | Gate hoy |
|---|---|
| `/api/rentas/<pk>/vincular/` | `EsOperador` |
| `/api/rentas/<pk>/vinculo/` | `IsAdminGroupOrStaff` |
| `/api/ventas/<pk>/vinculo/` | `IsAdminGroupOrStaff` |
| `/api/cotizaciones/<pk>/vincular/` | `EsOperador` |
| `/api/cotizaciones/<pk>/vinculo/` | `EsOperador` |
| `/api/reparaciones/<pk>/vinculo/` | `EsOperador` |

Todas se marcan **`→ editar_clientes`** (nivel 1, es trabajo de padrón: atar un
registro a una ficha). Convertirlas en bloque también arregla la inconsistencia.

### 5.3 11 rutas con el candado escondido en `get_permissions()`

Estas NO salen en el recolector (su `permission_classes` dice `IsAuthenticated`)
y aun así llevan gate por nivel. Van con su marca:

| Ruta | Gate real | archivo:línea | Marca |
|---|---|---|---|
| `/api/equipos/` | POST `IsAdminGroupOrStaff`, resto `AllowAny` | `apps/maquinaria/views.py:98` | **`→ editar_catalogo`** (solo POST) |
| `/api/equipos/<int:pk>/` | PUT/PATCH/DELETE `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:163` | **`→ editar_catalogo`**; el DELETE ya pasa además por `borrar_catalogo` |
| `/api/categorias/` | POST `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:215` | **`→ editar_catalogo`** |
| `/api/tipos/` | POST `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:215` | **`→ editar_catalogo`** |
| `/api/marcas/` | POST `IsAdminGroupOrStaff` | `apps/maquinaria/views.py:215` | **`→ editar_catalogo`** |
| `/api/cupones/` | `IsAdminGroupOrStaff` siempre | `apps/maquinaria/views.py:397` | **POR DECIDIR** — misma duda que `/api/cupones/<pk>/` (§3.2) |
| `/api/equipos/<int:equipo_id>/unidades/` | POST `IsAdminGroupOrStaff`, resto `EsOperador` | `apps/inventario/views.py:49` | **`→ alta_inventario`** (POST); GET `nivel legítimo` |
| `/api/unidades/<int:pk>/` | DELETE `IsAdminGroupOrStaff`, resto `EsOperador` | `apps/inventario/views.py:131` | **`→ operar_inventario`** (PUT/PATCH); DELETE ya pasa por `borrar_catalogo`; GET `nivel legítimo` |
| `/api/refacciones/` | POST `IsAdminGroupOrStaff`, resto `EsOperador` | `apps/refacciones/views.py:15` | **`→ alta_inventario`** (POST); GET `nivel legítimo` (el taller y la caja las consultan) |
| `/api/refacciones/<int:pk>/` | GET `EsOperador`, escritura `IsAdminGroupOrStaff` | `apps/refacciones/views.py:37` | **`→ editar_catalogo`** (escritura); GET `nivel legítimo` |
| `/api/cotizaciones/<int:pk>/` | DELETE `IsAdminGroupOrStaff`, resto `PuedeCotizar` | `apps/cotizaciones/views.py:513` | `nivel legítimo` (DELETE) — "el asesor propone, no destruye", ya escrito en el código |

**Consecuencia para la prueba nueva**: si en la Tarea 11 alguna capacidad queda
impuesta ÚNICAMENTE dentro de un `get_permissions()`, el recolector no la va a
ver y la prueba la seguirá reportando como huérfana. Para esas vistas hay que
poner además `permission_classes = [LaCapacidad]` como piso, y usar
`get_permissions()` solo para ENDURECER por método.

### 5.4 Permisos que viven dentro del cuerpo (8 lugares)

No son un problema —imponen de verdad—, pero son invisibles para cualquier
auditoría por `permission_classes`. Quedan anotados:

| archivo:línea | Capacidad | Qué protege |
|---|---|---|
| `apps/maquinaria/views.py:69` | `borrar_catalogo` | `ProtectedDestroyMixin.destroy` (3 vistas, §5.1) |
| `apps/maquinaria/views.py:322` | `tener_codigo_propio` | fijar el NIP propio |
| `apps/maquinaria/serializers.py:355` | `editar_datos_bancarios` | los campos bancarios de `/api/config/` |
| `apps/ventas/views.py:174` | `ver_dinero` | corte de caja: ver el de otros o solo el propio |
| `apps/ventas/views.py:653` | `alta_inventario` | dar de alta la unidad al entregar un pedido |
| `apps/ventas/caja_views.py:182,213,219,249,258,299,308` | `ver_dinero` | turnos de otros, ajustes de caja y el arqueo |
| `apps/cotizaciones/views.py:537` | `ver_dinero` | aceptar o rechazar una cotización |
| `apps/maquinaria/serializers.py:160` | `nivel > 0` | campos solo para el panel |

---

## 6. Capacidades huérfanas

Salida de `cd backend && python manage.py test maquinaria.tests_permisos_imponen -v 2`
el 2026-08-22. La prueba **falla a propósito**: cada nombre de esta lista es una
casilla que el dueño puede mover en la matriz sin que ningún endpoint le haga
caso. Es el trabajo exacto de las Tareas 10 y 11.

```
$ python manage.py test maquinaria.tests_permisos_imponen -v 2

test_ninguna_capacidad_configurable_es_decorativa ... FAIL
test_solo_pantalla_esta_justificada ... ok

AssertionError: Lists differ: ['alta_inventario', 'configurar_negocio', [182 chars]ion'] != []

First list contains 14 additional elements.

- ['alta_inventario',
-  'configurar_negocio',
-  'corte_caja',
-  'cotizar',
-  'editar_catalogo',
-  'facturar',
-  'gestionar_reparaciones',
-  'operar_inventario',
-  'rentar',
-  'reparar',
-  'usar_caja',
-  'vender',
-  'ver_montos_operacion',
-  'ver_operacion'] : Estas capacidades se pueden encender en la pantalla y ningún
 endpoint las exige: o se gatean, o se declaran en SOLO_PANTALLA con su razón.

Ran 2 tests in 0.003s
FAILED (failures=1)
```

Son **14 de las 17 configurables** (`CATALOGO` tiene 24; menos las 5 del `NUCLEO`
y las 2 de `SOLO_PANTALLA` quedan 17). Las 3 que sí se imponen hoy son
`ver_clientes`, `editar_clientes` y `ver_dinero`.

Dónde aterriza cada una, según las marcas de arriba:

| Huérfana | Rutas destino |
|---|---|
| `alta_inventario` | `/api/equipos/<id>/unidades/` (POST), `/api/equipos/<id>/unidades/proximo-codigo/`, `/api/refacciones/` (POST) |
| `configurar_negocio` | `/api/config/` y las 3 de `/api/config/correos/` |
| `corte_caja` | `/api/ventas/corte/`, `/api/caja/sesiones/<pk>/cerrar/` (hoy piden `usar_caja`) |
| `cotizar` | `/api/cotizaciones/stats/` + las 9 que ya usan `PuedeCotizar` (§2.2) |
| `editar_catalogo` | `/api/categorias|tipos|marcas/` y `/<pk>/`, `/api/equipos/` y `/<pk>/`, `/api/equipos/<pk>/imagenes/`, `/api/refacciones/<pk>/` (escritura) |
| `facturar` | las 7 de `/api/facturacion/` + `/api/ventas/<pk>/por-facturar/` + `/api/rentas/<pk>/por-facturar/` |
| `gestionar_reparaciones` | `/api/reparaciones/` (GET), `/api/reparaciones/<pk>/` (DELETE) |
| `operar_inventario` | `/api/unidades/<pk>/mantenimiento/`, `/api/unidades/<pk>/` (PUT/PATCH) |
| `rentar` | `/api/rentas/crear/`, `/renovar/`, `/sustituir-unidad/`, `/deposito/` |
| `reparar` | `/api/reparaciones/` (POST), `/api/reparaciones/<pk>/` (GET/PATCH), `/items/`, `/items/<id>/` |
| `usar_caja` | las 8 de `/api/caja/` + `/api/ventas/mostrador/` (hoy con `PuedeUsarCaja`) |
| `vender` | `/api/unidades/<pk>/vender/`, `/api/ventas/pedidos/crear/`, `/api/ventas/<pk>/entregar/`, `/pedido-fase/`, `/api/cotizaciones/<pk>/convertir/` |
| `ver_montos_operacion` | abonos, comprobantes y tickets de renta y venta (6 rutas) |
| `ver_operacion` | `/api/rentas/`, `/api/rentas/adeudos/`, `/api/rentas/alertas/`, `/api/ventas/lista/`, `/api/ventas/pedidos/` |

Las 14 tienen destino. Ninguna se va a `SOLO_PANTALLA`.

### Después de la Tarea 10: quedan 12

`cotizar` y `usar_caja` salieron de la lista sin convertir una sola ruta: solo
había que hacer que sus clases de permiso heredaran de `ExigeCapacidad` (§1).
`cotizar` además ganó su ruta que faltaba (`/api/cotizaciones/stats/`, §3.5).

```
- ['alta_inventario', 'configurar_negocio', 'corte_caja', 'editar_catalogo',
-  'facturar', 'gestionar_reparaciones', 'operar_inventario', 'rentar',
-  'reparar', 'vender', 'ver_montos_operacion', 'ver_operacion']
```

Suite completa el 2026-08-22: **398 pruebas, 1 fallo** — este mismo, que es el
marcador de lo que le queda a la Tarea 11.

---

## 7. Cómo se cierra

Cuando las Tareas 10 y 11 terminen, `test_ninguna_capacidad_configurable_es_decorativa`
pasa en verde y esta nota deja de ser una lista de pendientes para volverse el
registro de por qué cada ruta quedó donde quedó. Lo único que NO se cierra solo
son los `POR DECIDIR`: esos necesitan una respuesta del dueño antes de tocar
código.
