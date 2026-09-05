# REMALI Admin: auditoría de estructura y plan de mejoras

Complemento de `01-DOCUMENTACION.md`. Aquí va qué tan bien está la estructura frente a las convenciones de Django + DRF, los bugs detectados, las mejoras de lógica del admin que le sirven al cliente, el foco en inventario/máquinas y el apartado de refacciones a futuro.

Fecha: 2026-07-11

> Actualización (2026-07-11): se implementó el rediseño completo del flujo de renta/venta
> (dinero en la renta, fuente única de estado, reservas, IVA, cancelaciones, empresa/obra,
> mantenimiento con confirmación). Ver `03-FLUJO-RENTA-VENTA.md`. Los ítems P1-1, P1-6 y P1-7
> de abajo quedaron resueltos.

---

## 0. Semáforo general

| Área | Estado | Nota |
|------|--------|------|
| Modelado del dominio | 🟢 Bien | Separar `Equipo` (modelo) de `Inventario` (unidad) es la decisión correcta. |
| Convenciones Django/DRF | 🟡 Mixto | Estructura por apps ok; hay desviaciones (app "grande", `sys.path`, serializers manuales). |
| Seguridad de la API | 🔴 Atención | Default `AllowAny`, `CORS_ALLOW_ALL_ORIGINS`, `SECRET_KEY` con fallback. |
| Consistencia de la lógica | 🟡 Mixto | La transición de estados de inventario se hace en 3 lugares distintos. |
| Bugs concretos | 🔴 Hay P0 | Deploy (requirements), renta desde admin (typo), 500 en catálogo (`?unit`). |
| Refacciones | 🟡 Base | Modelo listo, sin API ni relación con máquinas. |

---

## 1. Auditoría: estructura vs. convenciones de Django/DRF

### Lo que está bien
- Las apps están separadas por dominio (`inventario`, `renta`, `ventas`, `empresas`, `refacciones`), cada una con su responsabilidad.
- `Equipo` (catálogo) no es `Inventario` (unidad física). Es el modelado correcto para rentar o vender la *misma* máquina varias veces y trazar cada unidad.
- El dinero va en `DecimalField`, no en floats.
- Las operaciones críticas (crear renta, vender, mantenimiento) usan transacciones atómicas y `select_for_update()`.
- `db_table`, `verbose_name` y `ordering` están definidos, así que el admin sale en español y prolijo.
- JWT con vida configurable, cache lista para Redis y storages condicionales (Cloudinary o WhiteNoise): está pensado para producción.

### Desviaciones respecto a la convención

1. App "grande" `maquinaria`. Hoy concentra catálogo, autenticación y perfil, notificaciones, soporte, cupones y dashboard. La convención Django es *una app = una responsabilidad*. Sugerido dividir a futuro:
   - `catalogo` (Equipo, Categoria, Tipo, Marca, ImagenProducto, Cupon)
   - `cuentas` (PerfilUsuario, login/me/perfil)
   - `notificaciones` (Notificacion + soporte)
   > No es urgente, pero conviene antes de que crezca más.

2. `sys.path.insert(0, apps/)` en `settings.py`. Hace que los imports sean `from inventario...` en vez de `from apps.inventario...`. Funciona pero:
   - Rompe la convención y confunde a herramientas/nuevos devs.
   - Recomendado: usar `name = 'apps.inventario'` en cada `AppConfig` e imports con prefijo `apps.`, y quitar el hack de `sys.path`.

3. Serializadores "a mano" en las vistas. `renta/views.py` y `ventas/views.py` construyen los dicts de respuesta manualmente (`_serialize_renta`). DRF ya te da `ModelSerializer`; hacerlo a mano duplica trabajo y desincroniza contratos. Recomendado: `RentaSerializer`, `VentaSerializer`.

4. Todo son function-based views con `@api_view` sueltos. Es válido, pero para CRUD con filtros lo idiomático en DRF es `ViewSet` + `Router` (menos boilerplate, rutas consistentes, paginación gratis). Ver §4.

5. Sin paginación global. `listar_ventas` corta a `[:200]`, `notificaciones` a `[:100]`, inventario/equipos no paginan. En DRF se resuelve con `DEFAULT_PAGINATION_CLASS`. Hoy, con catálogos grandes, se devuelve todo.

6. Sin `django-filter` real. Está en `requirements.txt` pero los filtros se hacen a mano leyendo `query_params`. Migrar a `DjangoFilterBackend` + `FilterSet` reduce código y errores.

7. Tests vacíos. `tests.py` existe en cada app pero sin pruebas. Para la lógica de estados (que es el corazón del negocio) faltan tests, que es justo donde más ayudan.

---

## 2. Bugs confirmados (P0, arreglar ya)

### P0-1. El deploy a Railway se rompe: faltan dependencias
`apps/inventario/admin.py`, `apps/refacciones/admin.py` y `apps/ventas/utils.py` importan `reportlab` y `qrcode`, pero no están en `requirements.txt` (sí en tu venv local: `reportlab==4.4.10`, `qrcode==8.2`).
- Efecto: en Railway (que instala desde `requirements.txt`) Django falla al cargar el admin → `ModuleNotFoundError`.
- Fix: agregar a `requirements.txt`:
  ```
  reportlab==4.4.10
  qrcode==8.2
  ```

### P0-2. Inconsistencia `seminuevo` vs `seminueva` (no se pueden crear rentas)
El modelo canónico usa femenino `('nueva', 'seminueva')` y la BD real ya está en femenino, pero había código en masculino (`'seminuevo'`/`'nuevo'`) que nunca matchea:
- `apps/renta/admin.py` filtraba `condicion='seminuevo'` → el desplegable de `inventario` en el form de Renta siempre salía vacío → imposible registrar rentas desde el admin.
- Seeds (`seed_maquinaria.py`, `seed_demo.py`) creaban unidades con `condicion='seminuevo'` (valor inválido).
- Tests (`maquinaria/tests.py`, `renta/tests.py`) usaban `'seminuevo'`.
- Frontend legacy no ruteado (`FilterSidebar.tsx`, `AdminDashboard.tsx`, `EquipoDetail.tsx`) usaba `'nuevo'`/`'seminuevo'` como valor.
- Fix: alinear todo a los valores del modelo (`nueva`/`seminueva`). El dashboard real (`Dashboard.tsx`) ya estaba correcto. Las migraciones históricas se dejan intactas.

### P0-3. 500 al pedir el catálogo con `?unit=`
`apps/maquinaria/serializers.py:200` llama `obj.get_precio_por_unidad(unidad)`, pero el modelo `Equipo` no tiene ese método.
- Efecto: cualquier request a `/api/equipos/?unit=dia` (o semana/mes) revienta con `AttributeError` → 500.
- Fix: implementar en `Equipo`:
  ```python
  def get_precio_por_unidad(self, unidad):
      return {'dia': self.precio_dia, 'semana': self.precio_semana, 'mes': self.precio_mes}.get(unidad)
  ```

### P0-4. Código muerto que crashea si se invoca
`apps/ventas/utils.py::generar_pdf_venta_carta` usa campos que ya no existen (`venta.items_maquinaria`, `item.modelo`, `venta.subtotal`, `venta.iva`, `venta.telefono_cliente`) y depende de `reportlab`.
- Efecto: es de un modelo de datos viejo; si algún día se conecta a una URL, da 500.
- Fix: borrar el archivo o reescribirlo contra el modelo actual (`Venta`/`ItemVenta`).

### P0-5. La etiqueta QR usa el campo equivocado
`apps/inventario/admin.py` genera el QR y la etiqueta a partir de `numero_serie` (opcional, puede ser `None`), no del `codigo` (el identificador real, siempre presente y único).
- Efecto: unidades sin serial muestran "Guarda primero" y no imprimen etiqueta, aunque tengan `codigo` válido. Además `numero_serie` está en `readonly_fields`, así que ni se puede capturar desde el admin.
- Fix: usar `obj.codigo` para el QR/etiqueta y sacar `numero_serie` de `readonly_fields` (o hacerlo editable).

---

## 3. Problemas de diseño / lógica (P1)

### P1-1. La transición de estado del inventario está en 3 lugares (resuelto)
> Centralizado en `Inventario` (`ocupar_por_renta`/`liberar`/`marcar_vendido`). Señales vaciadas y vistas ya no escriben `estado`. Ver `03-FLUJO-RENTA-VENTA.md`.

Al crear una renta, la unidad se marca `rentado` en:
1. `Renta.save()` (`renta/models.py`),
2. `renta/signals.py` (`post_save`),
3. `renta/views.py::crear_renta` (a mano, otra vez).

Es redundante y frágil (tres caminos que pueden divergir). Recomendado: una sola fuente de verdad. Lo más limpio: métodos de dominio en `Inventario` (`marcar_rentado`, `liberar`) y que solo las señales (o solo el `save`) los llamen. Elegir uno y borrar los otros dos.

### P1-2. Seguridad por defecto abierta
- `REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] = ['AllowAny']` → cualquier endpoint sin permiso explícito queda público. Para un panel administrativo el default debería ser `IsAuthenticated`.
- `CORS_ALLOW_ALL_ORIGINS = True` → cámbialo por `CORS_ALLOWED_ORIGINS` con tus dominios.
- `SECRET_KEY` tiene fallback embebido → en prod debe venir solo de entorno, y si no está, que falle.

### P1-3. El estado `mantenimiento` no se cuenta en ningún lado
`resumen_inventario` y `UnidadesGlobal` (inventario/views.py) cuentan/filtran `disponible/rentado/vendido` pero omiten `mantenimiento`. Los totales no cuadran cuando hay unidades en taller. `estado_color` del admin tampoco tiene color para `mantenimiento`.

### P1-4. Las alertas de vencimiento se recalculan en cada lectura
`NotificacionesList.list` llama `_sync_alertas_vencimiento()` en cada GET de notificaciones, recorriendo todas las rentas activas y creando notificaciones. Si el front hace polling, es un escaneo repetido innecesario. Recomendado: moverlo a un management command corrido por cron (o Celery, ya está preparado con Redis).

### P1-5. N+1 en el catálogo de equipos
`EquipoSerializer` calcula 6 agregados por equipo (`disponible_venta`, `stock_disponible`, `unidades_total`, `unidades_rentadas`, `condiciones`, `disponible_renta`) con una query cada uno, y `EquipoListCreate` no hace `prefetch_related('unidades')`. Con N equipos → ~6N queries. Fix: `prefetch_related('unidades', 'imagenes')` + calcular los conteos con `Count(..., filter=Q(...))` anotado en el queryset.

### P1-6. `Renta.cliente` es texto libre y las empresas quedan huérfanas (resuelto)
> `Renta` ahora tiene FK opcional a `Empresa` y `Obra` (con fallback a texto). Igual `Venta.empresa`.

Existe todo el módulo `empresas`/`obras` (con API) pero la renta guarda `cliente` como string. No hay historial por cliente ni por obra. Recomendado: `Renta.empresa = FK(Empresa, null=True)` y opcional `obra = FK(Obra, null=True)`, dejando `cliente` como fallback para walk-ins.

### P1-7. Venta "mixta" (máquina + refacciones) inconsistente (resuelto)
> `recalcular_total()` ahora incluye la máquina, desglosa IVA, valida precio > 0, el ticket muestra la máquina y `Venta.cancelar()` repone stock/devuelve la unidad.

`recalcular_total()` solo suma `ItemVenta` (refacciones); si la venta es de máquina, el total se pasa a mano y `as_ticket_text()` no incluye la línea de la máquina. Cancelar una venta tampoco **devuelve** el stock descontado. Recomendado: modelar la línea de máquina como otro tipo de ítem (o separar `VentaMaquinaria` de `VentaMostrador`) y reponer stock al cancelar.

### P1-8. Carrera al generar `codigo` de inventario
`generar_codigo()` usa `Max(codigo)` fuera de un lock: dos altas simultáneas pueden chocar (aunque `unique=True` lo evita a nivel BD, tira error). Además el "max" es lexicográfico (ok con 4 dígitos, se rompe al pasar de 9999). Recomendado: generar dentro de `transaction` con `select_for_update` sobre un contador, o usar un campo secuencial por prefijo.

---

## 4. Mejoras de la lógica del admin (lo que ayuda al cliente)

El Django admin ya es la herramienta operativa, y con pocos cambios rinde mucho más para mostrador y almacén:

1. Acciones masivas (`admin actions`) en `Inventario`, para mover varias unidades de golpe: "Enviar a mantenimiento", "Sacar de mantenimiento", "Marcar disponible".
2. Filtro y color para `mantenimiento` (hoy falta), más filtros por `condicion` y por `ubicacion_actual`.
3. `list_select_related` en los admins (`Inventario`, `Renta`, `Venta`) para evitar N+1 al pintar la lista.
4. Inline de `Inventario` dentro de `Equipo`, para ver y crear unidades desde la ficha del modelo.
5. Cablear el dashboard a datos reales (`/api/dashboard/metricas/` hoy devuelve `orders: 0, revenue: 0`): ingresos por rentas activas y ventas del mes, unidades por estado, rentas por vencer y vencidas, y los equipos más rentados. Eso es justo lo que el dueño quiere ver al abrir el panel.
6. Semáforo de rentas vencidas en el `list_display` de `Renta`. Ya tienes `vencida`; falta pintarlo como badge de color.
7. Validación de precios ≥ 0, porque hoy se pueden capturar negativos: `MinValueValidator(0)` en los `DecimalField` de precio.
8. Auditoría: registrar quién cambió el estado de una unidad y cuándo, con `django-simple-history` o un modelo `MovimientoInventario`. Da la trazabilidad que pide el propio `PRODUCT.md`.

---

## 5. Inventario y máquinas: recomendaciones de lógica

Tu prioridad. El modelado base es sólido; estas mejoras lo llevan a nivel operativo real:

1. Historial de mantenimiento como modelo, no solo un estado. Hoy `mantenimiento` es un flag sin registro. Crear:
   ```python
   class Mantenimiento(models.Model):
       unidad = FK(Inventario, related_name='mantenimientos')
       tipo = choices('preventivo', 'correctivo')
       descripcion = TextField()
       costo = DecimalField(...)
       fecha_entrada = DateField(); fecha_salida = DateField(null=True)
       responsable = CharField(...)
   ```
   Con eso se puede saber el costo acumulado por máquina, cuánto tiempo estuvo fuera de servicio, y programar preventivos por horas de uso.

2. Medir uso: `horas_uso` o `contador` en `Inventario`, actualizado al devolver una renta, para disparar preventivos ("cada 250 h, servicio").

3. Costo y rentabilidad por unidad: agregar `precio_compra` y `fecha_adquisicion`. Con eso el dashboard calcula el ROI por máquina (cuánto ha generado en rentas contra lo que costó). Con ese número se decide qué reponer y qué dar de baja.

4. Estados adicionales realistas: `baja`/`fuera_de_servicio` (máquina siniestrada o retirada) como estado terminal distinto de `vendido`.

5. Disponibilidad por fechas (reservas): hoy una unidad solo es "disponible" o "rentado" en el presente. Para agendar rentas futuras conviene validar solapamiento por rango de fechas (`fecha_inicio`/`fecha_fin`) en vez de solo el flag `estado`. Encaja con el `FullCalendar` que ya trae el frontend.

6. Máquina de estados centralizada: unificar las transiciones (ver P1-1) en `Inventario` con un único método `cambiar_estado(nuevo, motivo, usuario)` que valide transiciones legales y deje registro. Evita estados inconsistentes.

7. Consistencia de conteos: incluir `mantenimiento` en todos los resúmenes (P1-3) para que "total = suma de estados" siempre cuadre.

---

## 6. Refacciones: apartado a futuro

Hoy `Refaccion` es solo un modelo (con `stock`, `precio_venta`, `codigo_barras`) que se vende vía `ItemVenta` y se administra por el admin. Roadmap para convertirlo en un módulo completo:

### Fase A. Datos y relaciones
- Ligar refacciones a máquinas con una tabla de compatibilidad `RefaccionEquipo` (o M2M `Refaccion.equipos_compatibles = M2M(Equipo)` / por `Marca`). Así, desde una máquina se ven "sus" refacciones.
- Umbral de reorden: `stock_minimo` en `Refaccion` → alerta automática de "reordenar" cuando `stock <= stock_minimo` (reutiliza el sistema de `Notificacion` que ya existe).
- Proveedor (`Proveedor` y `costo_compra`) para calcular margen y saber a quién comprar.
- Ubicación en almacén (`ubicacion`, pasillo y estante) para el mostrador.

### Fase B. API y flujo
- Exponer la API (`refacciones/urls.py` hoy está deshabilitado a propósito): CRUD, `search` por `codigo_barras` para el lector, y un endpoint de "bajo stock".
- Movimientos de stock como modelo (`MovimientoRefaccion`: entrada/salida/ajuste) en vez de mutar `stock` directo. Da trazabilidad e historial (igual que se recomienda para inventario).
- Reponer stock al cancelar o devolver una venta, que hoy no ocurre.

### Fase C. Operación
- Vista de punto de venta (POS) de refacciones con lector de código de barras (ya generas etiquetas Code128/EAN13 en `refacciones/admin.py`).
- Reporte de refacciones más vendidas y valor del inventario de piezas (stock × costo) en el dashboard.
- Vincular una refacción a un `Mantenimiento` (qué piezas se usaron en cada servicio). Con eso se cierra el ciclo con §5.

---

## 7. Limpieza recomendada

- Backend: borrar `ventas/utils.py` (muerto), quitar el doble `import os` en `settings.py`, corregir `DEFAULT_FROM_EMAIL` (`'no-reply@shoping-fal.local'` es de otro proyecto).
- Frontend: decidir sobre rutas no enganchadas (`Cart`, `Checkout`, `Cotizacion`, `EquipoDetail`, `Profile`, `AdminDashboard`) y sobre la plantilla `scenes/*` con `mockData.js`: o se cablean, o se borran.
- Repo: `env/` (virtualenv) y `test.txt` no deberían estar versionados; añadir a `.gitignore`.

---

## 8. Plan sugerido por fases

| Fase | Objetivo | Incluye |
|------|----------|---------|
| 0 · Hotfix | Que no se rompa | P0-1 (requirements), P0-2 (typo renta), P0-3 (`?unit`), P0-5 (QR con `codigo`) |
| 1 · Solidez | Consistencia y seguridad | P1-1 (unificar estados), P1-2 (permisos/CORS/secret), P1-3 (mantenimiento en conteos), tests de estados |
| 2 · Valor al cliente | Que el dueño *vea* el negocio | Dashboard real (§4.5), acciones masivas admin, semáforo de vencidas, `Renta`↔`Empresa/Obra` |
| 3 · Máquinas pro | Trazabilidad y rentabilidad | Historial de `Mantenimiento`, costo/ROI por unidad, reservas por fechas |
| 4 · Refacciones | Módulo completo | Compatibilidad, stock mínimo + alertas, API, POS con código de barras |

> Regla práctica: la fase 0 va antes de cualquier deploy nuevo. Lo demás se prioriza según lo que más duela en la operación diaria.
