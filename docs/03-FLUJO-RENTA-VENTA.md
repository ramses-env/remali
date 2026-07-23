# REMALI Admin — Flujo de Renta y Venta de maquinaria

Documenta el proceso **rediseñado** de renta y venta desde el módulo de inventario, ya con
dinero, reservas, cancelaciones y una **fuente única de verdad** para el estado de la unidad.

Fecha: 2026-07-11 · Estado: **implementado y probado** (16/16 tests).

---

## 1. Conceptos

| Entidad | Qué es |
|---------|--------|
| `Equipo` | El *modelo* del catálogo (define precios: día/semana/mes/venta). |
| `Inventario` | La *unidad física* concreta. Tiene el `estado` operativo. |
| `Renta` | Contrato de renta de **una** unidad, con su dinero (snapshot). |
| `Venta` | Venta de una máquina y/o refacciones, con IVA desglosado. |

**Regla de oro:** el `estado` de la unidad **solo** se cambia a través de los métodos de
`Inventario` (`ocupar_por_renta`, `liberar`, `marcar_vendido`, `enviar/salir_mantenimiento`).
Ni las vistas ni las señales lo escriben directamente.

---

## 2. Máquina de estados de la unidad

```
                    crear renta (hoy)            devolver / cancelar
      ┌──────────────────────────────┐   ┌──────────────────────────────┐
      ▼                              │   ▼                              │
  disponible ──ocupar_por_renta──▶ rentado ──liberar──▶ disponible
      │  ▲                                                     ▲
      │  └──────────── salir_mantenimiento ───────────────────┘
      │
      ├──── enviar_mantenimiento ──▶ mantenimiento
      │
      └──── vender ──────────────▶ vendido ──cancelar venta──▶ disponible
```

- Una **reserva** (renta con fecha futura) **NO** ocupa la unidad hasta que llega su fecha
  (comando `procesar_rentas` o `Renta.activar()`).
- `vendido` deja de ser terminal: **se puede revertir** cancelando la venta.

## 3. Ciclo de vida de la Renta

```
                       fecha_inicio > hoy
   crear ───────────────────────────────────▶ reservada ──activar()──▶ activa
     │                                                                    │
     │ fecha_inicio = hoy                                                 │ devolver
     └──────────────────────────────────────▶ activa ───────────────────▶ finalizada
                                                  │
                                                  └── cancelar ──▶ cancelada
```

| Estado | ¿Ocupa la unidad? | Descripción |
|--------|:---:|-------------|
| `reservada` | ❌ | Agendada a futuro. Bloquea esas fechas (anti-traslape) pero no ocupa. |
| `activa` | ✅ | En curso. La unidad está `rentado`. |
| `finalizada` | ❌ | Equipo devuelto. Registra `fecha_devolucion_real` y recargo si hubo retraso. |
| `cancelada` | ❌ | Anulada. Libera la unidad si estaba ocupada. |

---

## 4. Dinero de la Renta 💵

Al crear la renta se toma un **snapshot** del precio del catálogo (no se recalcula si el
precio cambia después):

```
precio_unitario = Equipo.get_precio_por_unidad(modalidad)   # snapshot
subtotal        = precio_unitario × duracion
total           = subtotal − descuento + recargo
```

- **`recargo`** se calcula automáticamente en la devolución si `fecha_devolucion_real > fecha_fin`:
  `recargo = tarifa_diaria × días_de_retraso` (la tarifa diaria se deriva de la modalidad).
- **`deposito`** (garantía) se guarda como referencia.
- Campos: `precio_unitario`, `descuento`, `deposito`, `recargo`, `subtotal`, `total`.

---

## 5. Dinero de la Venta 💵

Los precios se capturan **con IVA incluido**; el sistema desglosa:

```
total    = precio_maquina + Σ items(refacciones)      (IVA incluido)
subtotal = total / 1.16
iva      = total − subtotal
```

- No se permite vender en **$0** (valida `precio > 0`).
- El **ticket** ahora incluye la línea de la máquina + el desglose de IVA.
- **Cancelar** una venta reabastece el stock de refacciones y devuelve la máquina a `disponible`.

---

## 6. Endpoints

### Renta (`/api/`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `rentas/crear/` | Crea renta o **reserva** (según `fecha_inicio`). Acepta `empresa_id`, `obra_id`, `descuento`, `deposito`. |
| GET | `rentas/?estado=` | Lista (`reservada`/`activa`/`finalizada`/`cancelada`) con dinero. |
| POST | `rentas/<id>/devolver/` | Devolución. Acepta `fecha_devolucion` (calcula recargo). |
| POST | `rentas/<id>/cancelar/` | Cancela y libera la unidad. |
| GET | `rentas/<id>/ticket/` | **Comprobante de renta en PDF (58mm).** |
| GET | `rentas/alertas/` | Rentas vencidas. |

### Venta / Inventario (`/api/`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `unidades/<id>/vender/` | Vende la unidad. Valida precio > 0 y que no tenga renta activa/reservada. |
| POST | `unidades/<id>/mantenimiento/` | `entrar`/`salir`. Si está rentada exige `forzar: true` (ya no corta la renta en silencio). |
| GET | `ventas/lista/?estado=` | Lista de ventas con desglose. |
| POST | `ventas/<id>/cancelar/` | Cancela: reabastece stock y devuelve la máquina. |
| GET | `ventas/<id>/ticket/` | **Ticket de venta en PDF (58mm).** |

---

## 7. Reservas automáticas (cron)

```bash
python manage.py procesar_rentas   # reservada -> activa cuando llega su fecha
```
Correr una vez al día (cron / tarea de Railway). Cuando la reserva se activa, ocupa la unidad.

---

## 9. Tickets / comprobantes (impresión) 🧾

Al **registrar** una renta o venta se muestra el comprobante **dentro del sistema** (modal, sin abrir
otra pestaña). También se **reimprime después** con el botón **🖨 Ticket** en las listas de rentas y ventas.

**Fuente única de contenido:** `apps/renta/comprobante.py` y `apps/ventas/comprobante.py`
(`datos_comprobante_*`) producen un JSON que alimenta **tanto el modal como el PDF**.

- **Contenido renta:** equipo/unidad, cliente/empresa/obra, periodo, y desglose de dinero
  (precio, subtotal, descuento, recargo, total, depósito).
- **Contenido venta:** máquina y/o refacciones, subtotal, **IVA (16%)** y total, método de pago.

**Endpoints:**
| Método | Ruta | Devuelve |
|--------|------|----------|
| GET | `rentas/<id>/comprobante/`, `ventas/<id>/comprobante/` | **JSON** (lo usa el modal) |
| GET | `rentas/<id>/ticket/`, `ventas/<id>/ticket/` | **PDF** térmico (descarga alterna) |

**Impresión térmica 58mm (clave):** el modal (`src/components/TicketModal.tsx`) se monta con un
**portal** en `document.body`. Al imprimir, el CSS oculta la app (`body > #root { display:none }`) y
deja **solo el ticket**, con:

```css
@media print { @page { size: 58mm auto; margin: 0; } }
```

Así el navegador usa el ancho de rollo de **58mm** (no Letter) y la térmica imprime correcto.
El ancho del PDF también es configurable en el backend: `Ticket(width_mm=58|80)`.

---

## 8. Qué cambió respecto al diseño anterior

| Problema (antes) | Ahora |
|------------------|-------|
| La renta **no guardaba dinero** | `precio_unitario`, `subtotal`, `total`, `recargo`, `deposito`. |
| El estado se escribía en **3 lugares** | **Fuente única** en `Inventario`; señales vaciadas; vistas no tocan `estado`. |
| No había **reservas** ni validación de fechas | Estado `reservada` + anti-traslape por rango de fechas. |
| Venta en **$0**, ticket sin la máquina, sin IVA | Valida precio > 0, ticket con máquina, IVA desglosado. |
| **No se podía revertir** una venta ni registrar devolución real | `Venta.cancelar()`, `fecha_devolucion_real`, recargo por retraso. |
| Cliente solo **texto libre** | Ligado opcional a `Empresa` / `Obra` (con fallback a texto). |
| Mantenimiento **cortaba la renta en silencio** | Exige `forzar: true` explícito. |

Todo cubierto por tests en `apps/{inventario,renta,ventas,maquinaria}/tests.py`.

---

## 10. UI (dashboard) — ya expone todo el backend

El frontend (`src/routes/Dashboard.tsx`) ya usa las capacidades nuevas:

- **RentModal:** empresa/obra (selects que cargan de `/empresas/`), **fecha de inicio** (si es futura se
  guarda como *reserva*), **descuento** y **depósito**; el título/botón cambian a "Reservar".
- **SellModal:** empresa, teléfono y **vista previa de subtotal/IVA/total**.
- **RentasAdmin:** filtro de 4 estados (**Activas / Reservas / Finalizadas / Canceladas**), muestra
  empresa y total, y botones **Devolver** y **Cancelar** según el estado.
- **VentasAdmin:** muestra **IVA** y estado, con botón **Cancelar** (revierte stock/máquina).
- **MaintModal:** envía `forzar` al mandar a taller una unidad rentada (evita el 409).
