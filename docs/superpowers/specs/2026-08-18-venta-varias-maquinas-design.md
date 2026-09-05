# Una venta, varias máquinas: cada unidad ligada a su venta

**Fecha:** 2026-08-18
**Estado:** diseño aprobado — listo para implementar

## Problema

`Venta` guarda **una sola** máquina: `inventario` es una FK y `precio_maquina`
un solo importe (`ventas/models.py:110`). Pero `convertir_cotizacion` marca
vendidas **todas** las unidades que el operador eligió
(`cotizaciones/views.py:1271`), y el panel permite elegir varias
(`Dashboard.tsx:7095`, `multiple: true`).

Vender dos revolvedoras en una cotización deja el sistema mintiendo:

1. **Máquinas fuera del patio sin venta que las respalde.** De la segunda en
   adelante quedan en estado `vendido` sin ninguna fila de `Venta` que las
   nombre: no salen en el historial, ni en un ticket, ni en un reporte.
2. **Cancelar no las devuelve.** `Venta.cancelar()` solo libera
   `self.inventario`; las demás quedan marcadas como vendidas para siempre, sin
   camino de vuelta ni desde el panel ni desde el admin.
3. **El historial cuenta mal.** Una fila dice que se vendió una máquina cuando
   salieron dos, con el precio de ambas en una sola línea.

Reproducido con dos pruebas contra el endpoint real, hoy marcadas
`@unittest.expectedFailure` en `apps/inventario/tests_consistencia.py`:
`test_cada_unidad_vendida_queda_ligada_a_una_venta` y
`test_cancelar_la_venta_devuelve_TODAS_las_unidades`.

El resto del inventario está sano: ninguna parte del backend escribe `estado` a
mano, y 17 pruebas cubren venta, apartado, renta, reserva, mantenimiento y
catálogo sin un solo fallo.

## Decisiones tomadas

1. **Una venta = una operación comercial; las máquinas son renglones.** Un
   folio, un ticket, un total, un cliente. Adentro, un renglón por máquina con
   su código, su serie y su precio. Es el mismo patrón que `ItemVenta` ya usa
   para refacciones, así que el sistema queda parejo y escala igual para 3 que
   para 30.
2. **Se puede mover una sola máquina.** Quitar una máquina de la venta la
   devuelve al inventario y baja el total; en un pedido se entregan las que
   llegaron y la venta sigue apartada por las que faltan.
3. **La regla de cobro no cambia: no sale ninguna máquina hasta liquidar.** La
   entrega parcial sirve para lo que de verdad pasa (llegó parte del pedido),
   sin inventar reparto de abonos por renglón.
4. **Quitar una máquina es acción sensible.** Código de 6 dígitos + motivo, el
   mismo control que ajustar precio al vender. Nunca se borra el renglón: se
   marca cancelado con quién y por qué.
5. **`Venta.inventario` y `precio_maquina` sobreviven como espejo.** 43 puntos
   del backend y el panel los leen hoy. Se mantienen apuntando al primer
   renglón y se actualizan solos; el código nuevo lee `venta.maquinas`. Se
   eliminan cuando ya nadie los lea.

## El modelo

`VentaMaquina`, en `apps/ventas/models.py`, hermano de `ItemVenta`:

| Campo | Tipo | Para qué |
|---|---|---|
| `venta` | FK `Venta`, `related_name='maquinas'`, CASCADE | La operación a la que pertenece |
| `inventario` | FK `Inventario`, `PROTECT`, null | La máquina física. PROTECT: una unidad con venta ya no se borra del inventario |
| `equipo` | FK `Equipo`, `SET_NULL`, null | Qué se pidió cuando la unidad aún no llega (sobre pedido) |
| `precio` | Decimal(12,2) | Precio de **esa** máquina, IVA incluido. Foto del momento: si sube la lista, la venta vieja no cambia |
| `entregada_en` | DateTime null | Permite entregar las que ya llegaron |
| `cancelada_en` | DateTime null | Renglón quitado de la venta (la unidad volvió al patio) |
| `cancelada_por` | FK usuario, null | Quién lo autorizó |
| `cancelada_motivo` | Char(200) | Por qué |
| `creada_en` | DateTime auto | Orden estable de los renglones |

Invariante: un renglón **vivo** (`cancelada_en is None`) con `inventario` no
nulo significa que esa unidad está comprometida por esta venta.

`Venta.precio_maquina` conserva el nombre pero corrige su `help_text`: hoy dice
"SIN IVA" y `recalcular_total()` lo trata como precio con IVA incluido.

## Las reglas

**Total.** `recalcular_total()` suma los renglones vivos de máquina más los
`ItemVenta` de refacciones. El IVA se sigue desglosando del total
(`total / 1.16`), nunca se suma encima.

**Compatibilidad al crear.** `Venta.save()` es el puente entre las dos formas:
si la venta llega con `inventario` y sin renglones (como hoy hacen
`vender_unidad`, la caja y el admin), crea el renglón por su cuenta con
`precio = precio_maquina`. Si llega con renglones, el espejo `inventario` /
`precio_maquina` se sella desde el primero. Ningún llamador existente se toca, y
los dos caminos terminan en la misma tabla.

**Al crear.** Una venta `activa` marca vendida cada unidad de sus renglones;
una `apartada` las aparta todas. Sigue pasando por las transiciones públicas
del modelo `Inventario` (`marcar_vendido`, `apartar`), nunca por `_set_estado`.

**Entregar** — `Venta.entregar(unidades=None, user=None)`:
- Exige `saldo_pendiente() == 0` (regla actual, sin cambios).
- Marca `entregada_en` en los renglones indicados; sin argumento, en todos.
- Un renglón sobre pedido sin unidad recibe la que llegó, validando que sea del
  equipo pedido y que `puede_venderse()`.
- La venta pasa a `activa` solo cuando **ningún** renglón vivo queda sin
  entregar. Mientras falte uno, sigue `apartada`.

**Cancelar.** Todos los renglones vivos devuelven su unidad al patio. Aquí se
cierra el agujero que hoy deja máquinas colgadas.

**Quitar una máquina** — `Venta.quitar_maquina(renglon, motivo, user)`:
- Exige código de 6 dígitos (`maquinaria.seguridad.verificar_codigo`) y motivo.
- Devuelve la unidad a `disponible` y sella `cancelada_en/por/motivo`.
- Recalcula el total. Si lo pagado excede el total nuevo, el saldo a favor queda
  visible en la venta; el reembolso sigue siendo una acción humana.
- No se puede quitar el último renglón vivo de una venta de solo máquinas: para
  eso está cancelar la venta.

**Liberar la unidad.** Se añade `Inventario.liberar_venta(ubicacion='Bodega')`
como espejo público de `marcar_vendido`, y `Venta.cancelar()` deja de llamar al
privado `_set_estado`.

**Migración de datos.** Cada venta existente con `inventario` genera su renglón
con `precio = precio_maquina` y `entregada_en = entregada_en` de la venta. Es
reversible: la migración inversa vacía la tabla sin tocar `Venta`.

## API y panel

**Respuestas** (`listar_ventas`, `ventas_mias`, `_serialize_pedido`,
`comprobante`, `ticket`, CSV): se agrega

```json
"maquinas": [
  {"id": 12, "unidad_id": 3, "codigo": "REV-0001", "numero_serie": "8891",
   "equipo": "Revolvedora 1S", "precio": "50000.00", "entregada": true}
]
```

y se conserva `unidad` apuntando al primer renglón vivo, para no romper a nadie.

**Endpoints:**
- `POST /api/ventas/<id>/entregar/` acepta `unidad_ids: []` (varias) además del
  `unidad_id` de hoy.
- `POST /api/ventas/<id>/maquinas/<linea_id>/quitar/` con `{motivo, codigo}`.
- `POST /api/cotizaciones/<id>/convertir/` crea N renglones, uno por unidad,
  cada uno con el `precio_unitario` de su partida (sin dividir ni redondear), y
  bloquea las unidades con `select_for_update` dentro de la transacción. Hoy las
  lee fuera, así que dos conversiones simultáneas podían vender la misma máquina
  dos veces.

**Panel** (`Dashboard.tsx`):
- Ventas: la fila muestra "3 máquinas" y despliega el detalle (código, serie,
  precio, entregada).
- Pedidos: entregar permite elegir las unidades que llegaron.
- Ticket y comprobante listan cada máquina con su serie.
- Borrar una unidad con ventas responde con un mensaje claro en vez de un error
  de base de datos.

## Errores y casos límite

| Situación | Respuesta |
|---|---|
| Unidad repetida en la misma venta | 400, "la unidad viene repetida" |
| Unidad no disponible al convertir | 400 con el estado real ("está rentada") |
| Dos conversiones simultáneas sobre la misma unidad | La segunda espera el lock y sale con 400 |
| Entregar sin liquidar | 400 con el saldo exacto |
| Quitar máquina sin código | 403 (mismo camino que ajustar precio) |
| Quitar el último renglón | 400, "cancela la venta" |
| Borrar del inventario una unidad vendida | 400, no `ProtectedError` crudo |

## Pruebas

Las dos `expectedFailure` pierden la marca y quedan como red de seguridad. Se
suman, en `apps/ventas/tests_venta_maquinas.py`:

- Venta de 3 máquinas: 3 renglones, 3 unidades vendidas, total correcto.
- Cancelar devuelve las 3.
- Entrega parcial: 2 entregadas, la venta sigue apartada; al entregar la tercera
  pasa a activa.
- Entregar sin liquidar falla con el saldo.
- Quitar una máquina con código: unidad libre, total abajo, renglón sellado.
- Quitar sin código: 403 y nada cambia.
- Total con máquinas + refacciones, con el IVA desglosado.
- La migración conserva las ventas viejas y su unidad.
- `revisar_inventario` sigue en cero desajustes después de todo lo anterior.

## Fuera de alcance

Repartir abonos máquina por máquina, notas de crédito, reembolsos automáticos y
entrega contra pago proporcional. El modelo queda listo para abrirlos sin
volver a migrar.
