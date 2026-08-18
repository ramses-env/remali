# Una venta con varias máquinas — plan de implementación

> **Para quien ejecute esto:** cada tarea termina en algo probado y commiteado.
> Las casillas (`- [ ]`) marcan el avance. Prueba antes que código, siempre.

**Objetivo:** que cada máquina vendida quede ligada a su venta, se pueda
entregar por partes y se pueda quitar una sola dejando rastro.

**Arquitectura:** un renglón por máquina (`VentaMaquina`), hermano del
`ItemVenta` que ya existe para refacciones. `Venta.inventario` y
`precio_maquina` siguen vivos como espejo del primer renglón para no romper a
los 43 lectores actuales.

**Stack:** Django 5 + DRF, MySQL, React 19 + TypeScript (panel).

**Diseño:** `docs/superpowers/specs/2026-08-18-venta-varias-maquinas-design.md`

---

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/apps/ventas/models.py` | `VentaMaquina` + las reglas de `Venta` (total, crear, entregar, cancelar, quitar) |
| `backend/apps/inventario/models.py` | `liberar_venta()`: espejo público de `marcar_vendido` |
| `backend/apps/ventas/migrations/00XX_*.py` | Tabla nueva + backfill reversible de las ventas viejas |
| `backend/apps/ventas/views.py` | Serialización `maquinas`, entrega múltiple, quitar máquina |
| `backend/apps/ventas/urls.py` | Ruta de quitar máquina |
| `backend/apps/ventas/comprobante.py` | Comprobante con un renglón por máquina |
| `backend/apps/cotizaciones/views.py` | Conversión: N renglones + `select_for_update` |
| `backend/apps/inventario/views.py` | Borrar unidad con ventas: mensaje claro |
| `backend/apps/ventas/tests_venta_maquinas.py` | Pruebas del ciclo completo |
| `frontend/src/routes/Dashboard.tsx` | Ventas con detalle de máquinas; pedidos con entrega parcial |

---

### Tarea 1 · El renglón y su espejo

**Archivos:** crea `VentaMaquina` en `ventas/models.py`; `liberar_venta()` en
`inventario/models.py`; migración de esquema + datos.

- [ ] **Paso 1 — Prueba que falla.** En `ventas/tests_venta_maquinas.py`:
  una venta creada con `inventario=u` genera un renglón con ese mismo precio, y
  `venta.maquinas.count() == 1`.
- [ ] **Paso 2 — Correr y ver el fallo.** `python manage.py test ventas.tests_venta_maquinas -v 2` → error: `Venta` no tiene `maquinas`.
- [ ] **Paso 3 — Modelo.**

```python
class VentaMaquina(models.Model):
    """Una máquina dentro de una venta. Pieza única: número de serie, no cantidad."""
    venta = models.ForeignKey('ventas.Venta', on_delete=models.CASCADE, related_name='maquinas')
    inventario = models.ForeignKey('inventario.Inventario', on_delete=models.PROTECT,
                                   null=True, blank=True, related_name='renglones_venta')
    equipo = models.ForeignKey('maquinaria.Equipo', on_delete=models.SET_NULL,
                               null=True, blank=True, related_name='+')
    precio = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    entregada_en = models.DateTimeField(null=True, blank=True)
    cancelada_en = models.DateTimeField(null=True, blank=True)
    cancelada_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name='+')
    cancelada_motivo = models.CharField(max_length=200, blank=True, default='')
    creada_en = models.DateTimeField(auto_now_add=True)

    @property
    def viva(self):
        return self.cancelada_en is None
```

- [ ] **Paso 4 — Puente en `Venta.save()`:** si llega con `inventario` y sin
  renglones, crear el renglón; si llega con renglones, sellar el espejo
  `inventario`/`precio_maquina` desde el primero vivo.
- [ ] **Paso 5 — `Inventario.liberar_venta(ubicacion='Bodega')`:** de
  `vendido`/`apartado` a `disponible`, vía `_set_estado`.
- [ ] **Paso 6 — Migraciones.** `makemigrations ventas` + migración de datos
  reversible que crea un renglón por cada venta con `inventario`.
- [ ] **Paso 7 — Correr y ver verde.** Suite de ventas completa.
- [ ] **Paso 8 — Commit.** `Venta: una máquina por renglón`

---

### Tarea 2 · Total, cancelar y crear con varias

- [ ] **Paso 1 — Pruebas que fallan:** venta de 3 máquinas → 3 unidades
  vendidas y total = suma de los 3 precios (+ refacciones); cancelar → las 3
  vuelven a `disponible`.
- [ ] **Paso 2 — Correr y ver el fallo.**
- [ ] **Paso 3 — Implementar:** `recalcular_total()` suma renglones vivos;
  `save()` transiciona cada unidad (`apartar` si apartada, `marcar_vendido` si
  no); `cancelar()` recorre los renglones vivos y usa `liberar_venta()`.
- [ ] **Paso 4 — Verde.**
- [ ] **Paso 5 — Commit.** `Venta: el total y la cancelación cuentan todas las máquinas`

---

### Tarea 3 · Entrega parcial

- [ ] **Paso 1 — Pruebas que fallan:** apartado de 3, liquidado, `entregar` de
  2 → esas 2 vendidas, venta sigue `apartada`; entregar la tercera → `activa`.
  Entregar sin liquidar → `ValueError` con el saldo.
- [ ] **Paso 2 — Correr y ver el fallo.**
- [ ] **Paso 3 — Implementar** `entregar(unidades=None, user=None)` según el
  spec (saldo 0, sella `entregada_en`, asigna unidad a renglones sobre pedido,
  pasa a `activa` solo cuando no falta ninguna).
- [ ] **Paso 4 — Verde.**
- [ ] **Paso 5 — Commit.** `Pedidos: entregar las máquinas que ya llegaron`

---

### Tarea 4 · Quitar una máquina (acción sensible)

- [ ] **Paso 1 — Pruebas que fallan:** con código válido → unidad libre, total
  abajo, renglón sellado con quién y por qué; sin código → 403 y nada cambia;
  quitar el último renglón de una venta de solo máquinas → error.
- [ ] **Paso 2 — Correr y ver el fallo.**
- [ ] **Paso 3 — Implementar** `quitar_maquina()` en el modelo y el endpoint
  `POST /api/ventas/<id>/maquinas/<linea_id>/quitar/` usando
  `maquinaria.seguridad.verificar_codigo`.
- [ ] **Paso 4 — Verde.**
- [ ] **Paso 5 — Commit.** `Ventas: quitar una máquina con código y motivo`

---

### Tarea 5 · Conversión de cotización

- [ ] **Paso 1 — Prueba:** quitar `@unittest.expectedFailure` de las dos de
  `inventario/tests_consistencia.py`; deben pasar. Sumar: cada renglón lleva el
  precio de su partida y el total de la venta iguala `cot.subtotal_venta`.
- [ ] **Paso 2 — Correr y ver el fallo.**
- [ ] **Paso 3 — Implementar:** crear la venta con sus N renglones dentro de la
  transacción, con `select_for_update` sobre las unidades y revalidando el
  estado ya con el lock puesto.
- [ ] **Paso 4 — Verde.**
- [ ] **Paso 5 — Commit.** `Cotizaciones: cada máquina convertida queda en la venta`

---

### Tarea 6 · API y comprobantes

- [ ] **Paso 1 — Prueba:** `GET /api/ventas/lista/` de una venta de 2 máquinas
  trae `maquinas` con 2 renglones y conserva `unidad`; el ticket nombra las dos.
- [ ] **Paso 2 — Correr y ver el fallo.**
- [ ] **Paso 3 — Implementar** en `listar_ventas`, `ventas_mias`,
  `_serialize_pedido`, `as_ticket_text`, `comprobante.py` y el CSV; `entregar`
  acepta `unidad_ids`; borrar unidad con ventas responde 400 con mensaje.
- [ ] **Paso 4 — Verde.**
- [ ] **Paso 5 — Commit.** `API de ventas: renglones de máquina en las respuestas`

---

### Tarea 7 · Panel

- [ ] **Paso 1 —** Ventas: la fila muestra "N máquinas" y despliega código,
  serie, precio y si ya se entregó; una sola máquina se ve igual que hoy.
- [ ] **Paso 2 —** Pedidos: al entregar, elegir cuáles llegaron.
- [ ] **Paso 3 —** `npx tsc --noEmit` limpio y prueba en navegador real.
- [ ] **Paso 4 — Commit.** `Panel: ventas y pedidos con varias máquinas`

---

### Tarea 8 · Cierre

- [ ] **Paso 1 —** Suite completa de Django en verde, sin `expectedFailure`.
- [ ] **Paso 2 —** `python manage.py revisar_inventario` en cero desajustes.
- [ ] **Paso 3 —** Prueba en navegador: convertir una cotización de 2 máquinas,
  ver las dos en Ventas, cancelar y confirmar que las dos vuelven al inventario.
- [ ] **Paso 4 — Commit.** `Inventario: la venta de varias máquinas cuadra`
