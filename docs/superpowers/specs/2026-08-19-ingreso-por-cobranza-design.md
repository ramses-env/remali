# El ingreso sigue al dinero, no a la venta

**Fecha:** 2026-08-19
**Estado:** implementado — 2026-08-19

## Problema

El Resumen cuenta el **total completo de una venta el día que se registra**, sin
importar cuándo entró el dinero ni cuándo se entregó la máquina.

`dashboard_metrics` (`maquinaria/views.py:1150`) es un cascarón: devuelve
`{'products': N, 'orders': 0, 'revenue': 0.0}`. El panel nunca recibe la cifra
del servidor y siempre cae a su cálculo de respaldo, que suma `v.total` agrupando
por `v.fecha` — la fecha de creación (`Dashboard.tsx:1446` y `1455`).

Con un apartado real, el pedido `VEN-2026-0004`: $12,350 con anticipo de $10,000
y liquidación semanas después. Hoy los $12,350 completos se contaron el día que
se registró el pedido. Los $2,350 que entraron después no movieron ninguna cifra,
porque el sistema ya había dado por recibido todo.

Y del otro lado, el dinero real no queda registrado en ningún lado:

1. **Los abonos no tocan la caja.** `registrar_abono_venta`
   (`ventas/views.py`) solo agrega una línea a `Venta.pagos` y guarda. Lo mismo
   `renta.registrar_abono` (`renta/views.py:411`). Si alguien deja $10,000 en
   efectivo en el mostrador, ese billete está en el cajón y el corte del turno no
   lo espera: el arqueo no puede cuadrar.
2. **La fecha del abono de venta se ignora.** El panel manda la fecha que captura
   el operador (`Dashboard.tsx`, `abonar`) y el backend la tira: sella
   `timezone.now()`. El abono de RENTA sí la respeta y valida que no sea futura
   (`renta/views.py:440`). Hoy la diferencia es cosmética; en cuanto el ingreso
   siga a los pagos se vuelve un error de dinero — un anticipo recibido el
   viernes y capturado el lunes contaría el lunes.

## Decisiones tomadas

1. **Un ingreso es un pago recibido, en la fecha en que se recibió.** Ni el total
   de la venta, ni el día que se registró, ni el día que se entregó. Una venta de
   contado no se mueve (su pago cae el mismo día); un apartado reparte su dinero
   entre las fechas en que de verdad entró.
2. **Aplica a ventas Y a rentas.** El Resumen mezcla las dos en la misma cifra;
   arreglar solo una dejaría la gráfica sumando con dos criterios distintos, que
   es peor que el problema actual. Las rentas guardan sus pagos con la misma
   forma, así que es la misma regla aplicada dos veces.
3. **Al corte va lo que pasa por el cajón.** Si quien registra el abono tiene
   turno de caja abierto, el abono genera su movimiento; si lo recibe el dueño o
   un administrador sin turno, solo se registra que el dinero entró. El criterio
   lo dio el negocio: *"si se le entrega al cajero tiene que ir en el corte, pero
   si lo recibe directo el dueño o un administrador, que solo registre el sistema
   que entró el dinero"*.
4. **No se abre turno al vuelo en un abono.** `venta_mostrador` sí lo hace,
   porque ahí el cobro es del mostrador por definición. Abrir un turno solo
   porque el dueño recibió un anticipo lo metería en un corte que no es suyo y
   ensuciaría el arqueo de quien sí está en la ventanilla.
5. **Se leen los `pagos` que ya existen; no se normalizan a una tabla.** Un abono
   sigue siendo una línea del JSON. Con el volumen actual (5 ventas en el año)
   recorrerlos es instantáneo. La alternativa —una tabla `Pago` con identidad
   propia— es mejor arquitectura, pero su ventaja se cobra al corregir un abono
   capturado mal o con miles de ventas al año, y ninguna de las dos es hoy. Si
   mañana lo es, la tabla se siembra desde estos mismos JSON, igual que se hizo
   con `VentaMaquina`.
6. **Que el mostrador cobre abonos es un switch del negocio, apagado.** Se suma a
   la familia que ya existe (`caja_vende_maquinaria`, `caja_renta_maquinaria`,
   `maquinaria/models.py:869`): nace apagado, se valida en el servidor y vive en
   la misma pantalla de Configuración. Mientras esté apagado, la Caja sigue
   cobrando solo refacciones.
7. **La pantalla que ese switch habilita NO se construye en esta entrega.**
   Construir un buscador de "Cobrar a cuenta" que nadie va a encender todavía es
   trabajo especulativo. Se hace el día que se vaya a usar.

## Lo que se construye

### 1 · Métricas de verdad

`dashboard_metrics` deja de ser cascarón y devuelve, calculado en el servidor:

- `ingresos_hoy`: suma de los pagos —de ventas y de rentas— fechados hoy en la
  zona horaria del proyecto (la misma que usa `server/periodos.py`).
- `ingresos_por_mes`: el mes en curso y los cinco anteriores, misma regla, con la
  etiqueta corta del mes. Son seis puntos, el orden que ya pinta la gráfica.

El panel ya espera exactamente esos nombres (`Dashboard.tsx:176`) y ya tiene el
respaldo del navegador, así que el Resumen empieza a usar la cifra buena sin
rediseñar la pantalla. El respaldo del navegador se corrige a la misma regla,
para que no diga una cosa distinta durante la carga.

Las ventas y rentas en estado `cancelada` no aportan ingresos, como ya pasa hoy
con el cálculo del navegador. Una renta `reservada`, `activa` o `finalizada` sí
aporta lo que haya cobrado: el estado describe dónde va el equipo, no si el
dinero entró.

Los pagos con fecha ilegible (formatos viejos, capturas raras) se **toleran y se
dejan fuera del conteo**: una métrica no puede tumbar la pantalla de inicio por
un dato sucio de hace meses.

### 2 · El abono toca la caja cuando corresponde

`registrar_abono_venta` y `renta.registrar_abono` preguntan por
`sesion_abierta_de(request.user)` —el helper que ya existe
(`ventas/caja_views.py:29`)—:

- **Con turno abierto:** se crea un `MovimientoCaja` ligado a esa venta o renta,
  con su método. El efectivo mueve el arqueo (`afecta_efectivo=True`); la tarjeta
  y la transferencia entran al corte del turno pero no al conteo del cajón —
  mismo criterio que la venta de refacciones.
- **Sin turno abierto:** solo se registra el abono, como hoy.

Se usa `sesion_abierta_de`, **no** `asegurar_sesion_abierta`, para no abrir turno
al vuelo (decisión 4). Si la venta se cancela después, sus movimientos se
reversan por la vía que ya existe: `cancelar_venta` genera el movimiento inverso
y `MovimientoCaja.venta` los encuentra.

### 3 · La fecha del abono de venta se respeta

`registrar_abono_venta` acepta `fecha` en formato `AAAA-MM-DD` y la rechaza si es
futura — la misma validación que ya tiene el abono de renta
(`renta/views.py:440`). Sin `fecha`, sella el momento actual, como hoy. Es lo que
hace que la decisión 1 sea cierta y no una buena intención.

### 4 · El switch `caja_cobra_abonos`

Campo booleano en `ConfiguracionSitio`, `default=False`, junto a los otros dos de
la caja y con el mismo texto de ayuda en el mismo tono. Se expone en `/config/` y
se pinta como tercer interruptor en la pantalla de Configuración, junto a
"vender maquinaria" y "levantar rentas".

En esta entrega el switch **no habilita ninguna pantalla todavía** (decisión 7).
Viene ahora porque el negocio lo pidió explícitamente y porque es donde queda
declarada la intención: el día que se construya el cobro desde el mostrador, ese
código solo tiene que consultarlo. Queda creado, apagado y visible.

La regla del corte (sección 2) es **independiente del switch**: hoy solo puede
dispararse con admin o gestor, porque son los únicos que alcanzan Pedidos y
Rentas (`pedidos: 'ver_operacion'`, `Dashboard.tsx:718`, y el cajero es nivel 1
con esa capacidad apagada). El día que el switch se encienda y el mostrador
reciba abonos, la misma regla cubre al cajero sin tocar nada más.

## Consecuencia que hay que declarar

**Las cifras históricas del Resumen van a cambiar** en cuanto esto entre. No se
pierde ningún dato: se cuentan bien. Un mes en que solo se cobraron anticipos
dejará de salir en cero, y un mes en que se registró un pedido grande dejará de
mostrar dinero que todavía no había entrado.

## Pruebas

- Un apartado con anticipo en un mes y liquidación en otro reparte su dinero
  entre los dos meses, y ninguno de los dos ve el total completo.
- Una venta de contado cuenta igual que antes: el cambio no mueve lo que ya
  estaba bien.
- Una venta cancelada y una renta cancelada no aportan ingresos.
- Los pagos de renta cuentan junto a los de venta en la misma cifra.
- Abono con turno de caja abierto genera movimiento; en efectivo mueve el arqueo,
  por transferencia no.
- Abono sin turno abierto no genera movimiento, y el abono sí queda registrado.
- La fecha capturada se respeta; una fecha futura se rechaza con 400.
- Un pago con fecha ilegible no tumba las métricas: se ignora y el resto suma.
- `caja_cobra_abonos` nace en `False` y viaja en `/config/`.

## Archivos

- `backend/apps/maquinaria/views.py` — `dashboard_metrics` de verdad
- `backend/apps/maquinaria/models.py` + migración — `caja_cobra_abonos`
- `backend/apps/maquinaria/serializers.py` — el switch en `/config/`
- `backend/apps/ventas/views.py` — fecha del abono + movimiento de caja
- `backend/apps/renta/views.py` — movimiento de caja en el abono de renta
- `frontend/src/routes/Dashboard.tsx` — cálculo de respaldo + el interruptor en
  Configuración
- Pruebas en `apps/maquinaria`, `apps/ventas` y `apps/renta`

## Fuera de alcance

- La pantalla de "Cobrar a cuenta" del mostrador (decisión 7).
- Normalizar los pagos a una tabla `Pago` (decisión 5).
- Corregir o cancelar un abono ya capturado: hoy no se puede y sigue sin poderse.
- Los reportes exportables y el archivado por ejercicio, que van por su propio
  camino.
