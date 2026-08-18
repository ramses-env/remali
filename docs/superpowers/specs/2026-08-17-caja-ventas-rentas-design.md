# La caja como punto de cobro del mostrador

**Fecha:** 2026-08-17
**Estado:** diseño aprobado

## Problema

`src/routes/CajaPOS.tsx` existe desde hace tiempo —986 líneas con catálogo,
ticket, cobro, corte y devoluciones— y **no está montada en ninguna ruta**. La
capacidad `usar_caja` está declarada en el catálogo de permisos y no se consulta
en ningún componente. El módulo pensado para la persona que más usa el panel es
inalcanzable desde el panel.

Además, hoy la caja solo vende refacciones. El negocio quiere poder vender
maquinaria y levantar rentas desde el mostrador, pero no siempre: quiere un
interruptor para encenderlo cuando le convenga.

## Decisiones tomadas

1. **Todo lo que pasa por caja cuenta en el corte.** Si se cobra una máquina en
   efectivo en el mostrador, ese billete está en el cajón y el arqueo debe
   esperarlo.
2. **La caja levanta rentas completas**, a cliente ya registrado o nuevo, y
   también vende. No una versión corta.
3. **El control es un switch del negocio**, no una capacidad nueva por rol. Se
   piensa para más adelante, así que nace apagado.
4. **Sin turno abierto, el turno se abre solo** con fondo $0 al primer cobro, en
   vez de dejar movimientos pendientes de asignar.

### Por qué el turno automático y no "pendiente de asignar"

`MovimientoCaja.sesion` es una llave obligatoria (`on_delete=PROTECT`), así que
lo pendiente exigiría hacerla opcional. Pero el problema real es el arqueo: una
venta de $16,500 en efectivo cobrada sin turno deja ese billete en el cajón hoy
y lo contabiliza mañana. El corte dejaría de responder "¿lo que hay en el cajón
es lo que debería haber?", que es lo único para lo que sirve. Abrir el turno al
vuelo da la misma comodidad —el mostrador nunca se detiene— sin el hueco.

## Lo que ya existe y no hay que construir

- **El arqueo del turno ya es agnóstico al origen.** `SesionCaja.totales_por_metodo()`
  suma `MovimientoCaja` de tipo VENTA sin filtrar por qué se vendió. En cuanto
  una venta de maquinaria cree su movimiento, entra sola al arqueo.
- **`MovimientoCaja` ya distingue efectivo** con `afecta_efectivo`, y ya enlaza a
  `Venta`.
- **`abrir_sesion`** ya crea la "Caja principal" al vuelo si el negocio no tiene
  ninguna.
- **`vender_unidad` y los endpoints de renta exigen `EsOperador`** (nivel técnico
  o superior), no la capacidad fina. Como `usar_caja` es nivel admin, cualquiera
  que alcance la caja ya pasa el permiso del backend: el switch no necesita
  tocar permisos ni abre huecos.

## Alcance

La caja deja de ser "el POS de refacciones" y pasa a ser el punto de cobro del
mostrador. Lo vendido ahí no cambia de naturaleza: una máquina vendida desde la
caja sigue siendo una `Venta` normal, con su folio y su lugar en la sección
Ventas. Lo único que se agrega es que deja rastro en el turno.

No se inventa una segunda forma de vender ni de rentar: la caja abre **las
mismas hojas** (`SellModal`, `RentModal`) que usa Inventario, así que el IVA, el
depósito, la factura y el padrón se comportan idéntico en los dos lados.

## Backend

### Configuración
`ConfiguracionSitio` gana dos booleanos, ambos `default=False`:
- `caja_vende_maquinaria`
- `caja_renta_maquinaria`

Migración y exposición en el serializer, siguiendo el patrón de
`anticipo_minimo_pct`.

### Sesión
Helper `asegurar_sesion_abierta(user)` en `apps/ventas/caja_views.py`: devuelve
la sesión abierta del usuario o crea una con fondo `$0`, reusando la lógica de
`abrir_sesion`. Devuelve también si la abrió, para que la interfaz lo avise.

### Endpoints
`vender_unidad` (`apps/inventario/views.py:266`) y el de crear renta
(`apps/renta/views.py`) aceptan `desde_caja: true` opcional. Cuando viene:

1. Valida que el switch correspondiente esté encendido; si no, 400 con mensaje
   claro. **La validación va en el backend, no solo escondiendo el botón**, o
   apagar el switch sería decorativo.
2. `asegurar_sesion_abierta(request.user)`.
3. Crea el `MovimientoCaja` con `afecta_efectivo = (metodo == 'efectivo')`, igual
   que hace hoy `venta_mostrador`.

Sin `desde_caja` se comportan exactamente como hoy: Inventario no se entera.

### Modelo
`MovimientoCaja` gana `renta` (FK nullable a `renta.Renta`). Hoy solo tiene
`venta`; una renta cobrada en caja necesita a qué colgarse para que el corte la
desglose y para que una cancelación futura genere su movimiento inverso.

### Reporte del día
`corte_caja` (`apps/ventas/views.py:115`) deja de filtrar
`inventario__isnull=True` y pasa a leer los `MovimientoCaja` del día, agrupando
por origen: refacciones / maquinaria / rentas.

## Frontend

### Montar la sección
Los 5 puntos de `Dashboard.tsx`: `Section`, `SECTION_META`, `navGroupsTodos`,
`REQUIERE.caja = 'usar_caja'` y el render. Queda en `/dashboard/caja`.

### Extraer las hojas
`SellModal` y `RentModal` salen de `Dashboard.tsx` a un módulo propio. No es
refactor gratuito: es la única forma de no duplicar las hojas, y saca ~400
líneas de un archivo de 9,500.

### En la caja
Junto al catálogo de refacciones, dos botones que solo aparecen si su switch
está encendido: "Vender máquina" y "Rentar". Ambos piden primero la unidad
**reusando el escáner que la caja ya tiene**: se apunta al QR pegado en la
máquina. Buscar por código a mano queda como respaldo.

Cuando el backend abre el turno solo, la caja lo avisa: "Se abrió tu turno para
registrar este cobro (fondo inicial $0). Ajusta el fondo en el corte."

### Ajustes
Panel "Caja" con los dos switches, con el patrón `<Ajuste titulo= desc=>` que ya
usa esa pantalla.

## Pruebas

Backend, con tests:
- switch apagado rechaza `desde_caja`
- switch encendido y sin turno abierto abre uno con fondo 0
- el movimiento queda con `afecta_efectivo` correcto según método de pago
- el reporte del día desglosa los tres orígenes
- sin `desde_caja`, los endpoints no crean ningún movimiento (no hay regresión
  para Inventario)

Frontend: verificación manual de los dos flujos. No hay navegador automatizado
en esta sesión.

## Fuera de alcance

- Cobrar saldos de rentas o ventas existentes desde la caja (se evaluó y se
  descartó para esta entrega).
- Renta rápida con campos reducidos: se usa la hoja completa.
- Capacidades nuevas por rol para la caja.
