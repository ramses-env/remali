# Plan de implementación · Fase 2 del padrón de clientes

**Diseño:** [`2026-08-17-padron-clientes-design.md`](2026-08-17-padron-clientes-design.md)
**Punto de partida:** fase 1 y 1b hechas — el modelo existe, los cinco documentos
tienen su FK, la migración corre y está probada. Nada de esto se ve todavía.

---

## Cómo está partida

La fase 2 es grande y no debe salir de un solo empujón. Se parte en **cinco
entregas**, cada una desplegable por su cuenta y con algo que el negocio puede
usar el día que se sube.

| | Entrega | Qué gana el negocio al terminarla |
|---|---|---|
| **A** | El padrón visible | El dueño da de alta y consulta clientes desde el panel |
| **B** | El mostrador lo usa | Vender y rentar ya asignan cliente de verdad |
| **C** | El dinero y la historia | Antes de vender se ve qué debe y qué se le debe |
| **D** | Cuentas y comprobantes | Llega el aviso de cuenta nueva y se vincula; la ficha guarda papeles |
| **E** | Garantías | El mostrador contesta "¿sigue en garantía?" |

**A y B son el orden obligatorio.** Sin A el padrón no existe para nadie; sin B
no se llena con datos nuevos y se queda congelado en lo que migró. De C en
adelante el orden se puede mover según urgencia — **D** si lo que aprieta es la
gente registrándose, **E** si lo que aprieta son las reclamaciones.

---

## Reglas que aplican a las cinco

1. **Cada entrega incluye backend y panel.** Si algo solo se puede hacer desde
   `/admin/`, la entrega no está terminada.
2. **Los campos viejos se siguen escribiendo.** `nombre_cliente`,
   `telefono_cliente`, `empresa`, `cliente_usuario`, `cliente_texto` — todos
   siguen llenándose en paralelo. La reversión tiene que seguir siendo posible
   hasta la fase 3.
3. **Nunca preguntar por el nombre del puesto.** `puede['ver_clientes']`, jamás
   `if rol == 'Cajero'`. Es lo que va a permitir el selector de permisos.
4. **Nada de dinero ni de vigencia guardado.** Saldos y garantías se calculan.
5. **Cada entrega trae sus pruebas** y deja la suite en verde antes de subirse.

---

## Entrega A · El padrón visible

Que el dueño pueda abrir el panel, ver su padrón y dar de alta un cliente.

### Backend

**A1 · Catálogo de capacidades** — `apps/maquinaria/permissions.py`

Antes de agregar capacidades sueltas, hacer el catálogo que pide §9.1 del diseño:
una estructura con `nombre`, `etiqueta`, `descripcion` y `nivel_minimo`, de la que
`puede_de()` derive su diccionario. Es lo que después va a leer el selector de
permisos para pintarse solo.

Capacidades nuevas: `ver_clientes` (nivel 1) y `editar_clientes` (nivel 1).

> Llega gratis al frontend: `/me` ya devuelve `puede_de(u)` y el Dashboard lee
> `me.puede`.

**A2 · API del padrón** — `apps/clientes/serializers.py`, `views.py`, `urls.py` nuevos;
registrar `path('api/', include('clientes.urls'))` en `server/urls.py`

| Endpoint | Permiso |
|---|---|
| `GET /api/clientes/` — lista con búsqueda y filtros | `ver_clientes` |
| `GET /api/clientes/<id>/` — ficha con contactos y obras | `ver_clientes` |
| `POST /api/clientes/` · `PATCH /api/clientes/<id>/` | `editar_clientes` |
| `POST /api/clientes/<id>/contactos/` · `PATCH` · `DELETE` | `editar_clientes` |
| Campos fiscales en el `PATCH` | nivel 2 — se rechaza si viene de nivel 1 |

La lista filtra por `q` (nombre, teléfono, RFC), `tipo` y `requiere_revision`, y
pagina. **No devolver el padrón entero sin paginar**: es la tabla que va a crecer
más rápido del sistema.

### Panel

**A3 · Sección Clientes** — `frontend/src/routes/Dashboard.tsx`, cinco puntos:

```
type Section (~221)         | 'clientes'
capacidad   (~617)          clientes: 'ver_clientes'      ← nivel 1, NO ver_dinero
navegación  (~654)          ícono + badge con el total
render      (~1078)         {section === 'clientes' && <ClientesAdmin … />}
buscador ⌘K (~320)          los clientes entran al buscador global
```

**A4 · Componente `ClientesAdmin`** — archivo propio, no dentro de `Dashboard.tsx`
(ya tiene 9,898 líneas)

- Lista con buscador, filtro por tipo y pestaña "Requieren revisión" con su badge.
- Botón **Nuevo cliente** con el formulario completo: tipo, nombre, teléfono,
  correo, fiscales, domicilio.
- Ficha: datos, contactos (marcando quién tiene cuenta) y obras.

### Hecho cuando

El dueño da de alta una constructora con dos contactos y una obra, la encuentra
buscando por teléfono, y un usuario Cajero ve la sección (a diferencia de
Empresas, que hoy no puede ver).

---

## Entrega B · El mostrador lo usa

### Backend

**B1 · Búsqueda de mostrador** — `GET /api/clientes/buscar/?telefono=` · `?q=`,
permiso `ver_clientes`

Busca contra `Cliente.telefono` **y** `Contacto.telefono` (ya está resuelto en
`Cliente.buscar_por_telefono`). Devuelve el cliente, sus contactos y un `resumen`
con contadores. El dinero del resumen llega en la entrega C — aquí van los
contadores de documentos.

**B2 · Los cuatro flujos aceptan `cliente_id`** — `ventas/views.py`,
`renta/views.py`, `cotizaciones/views.py`, `ventas/caja_views.py`

- Si viene `cliente_id`, se usa y se resuelve `contacto_id`.
- Si no viene, se crea un cliente nuevo con lo que se capturó.
- **Nunca unir por teléfono sin confirmación.** Si al crear resulta que el
  teléfono ya existe, se marca `requiere_revision` con el motivo.
- Los campos viejos se siguen llenando igual.
- En caja el cliente es **opcional**: sin él la venta se guarda como hoy.

### Panel

**B3 · `<BuscadorCliente>`** — componente compartido

Input de teléfono con debounce → coincidencias con su resumen → *"¿Es Juan
Pérez?"* con **Sí, es él** / **No, es otro**. Emite `{cliente_id, contacto_id}` o
`{nuevo: {nombre, telefono}}`.

**B4 · Montarlo** en venta de maquinaria, renta, cotización y caja. En renta, el
selector de obra se filtra por el cliente elegido.

### Hecho cuando

Se vende dos veces al mismo teléfono, la segunda ofrece confirmarlo, y las dos
ventas quedan en la misma ficha.

---

## Entrega C · El dinero y la historia

### Backend

**C1 · Cálculo del estado de cuenta** — `apps/clientes/cuenta.py` nuevo

Una sola función que suma `Renta.saldo_pendiente`, `Venta.saldo_pendiente` y el
`deposito_reembolso` de los depósitos en `por_devolver` / `a_favor`. **Un solo
lugar**: de aquí comen el endpoint, la ficha y el resumen del buscador.

**C2 · `GET /api/clientes/<id>/estado-cuenta/`** — `ver_clientes` (es
`ver_montos_operacion`, que ya es nivel 1)

Devuelve `saldo`, `credito_a_favor`, `neto` y los documentos ordenados por fecha.

**C3 · ~~La lista con anotaciones~~ — NO SE HACE.**

La columna de saldo en la lista del padrón no se puede resolver con un agregado
SQL: los abonos viven en un campo JSON (`Renta.pagos`, `Venta.pagos`), así que
sumarlos exige recorrerlos en Python. Con 500 clientes eso es una consulta por
renglón — exactamente lo que se evitó al paginar la lista.

El saldo vive donde se decide: **la ficha del cliente y el buscador de
mostrador**. Si algún día hace falta en la lista, el arreglo correcto es mover
los abonos a su propia tabla, no meter un bucle aquí.

**C4 · El resumen del buscador** gana las cifras (B1 las dejó pendientes).

### Panel

**C5** · Las tres cifras y el historial en la ficha; el saldo en el resumen del
`<BuscadorCliente>`; la sección **Adeudos** deja de contar clientes con la
heurística de texto de `renta/views.py:356` y cuenta clientes de verdad.

### Hecho cuando

Un cliente con una renta con saldo y un depósito a favor muestra las tres cifras
correctas, y al buscarlo en mostrador aparece lo que debe **antes** de venderle.

---

## Entrega D · Cuentas y comprobantes

### Backend

**D1 · Registrarse crea un contacto suelto** — `maquinaria/views.py:585` (`registro`)

Crea `Contacto(usuario=u, cliente=None)`. **No crear `Cliente`**: eso ensuciaría
el padrón que el dueño cura.

**D2 · Aviso al equipo** — `crear_notificacion('sistema', 'Cuenta nueva: …',
seccion='clientes', ref=f'cuenta-{u.id}')`. Ya solo alerta a staff.

**D3 · Vincular** — `POST /api/clientes/<id>/vincular-contacto/`,
`editar_clientes`. Le pone su `cliente` al contacto y deja rastro. Devuelve la
coincidencia de teléfono como **pista**, nunca la aplica sola.

**D4 · Fusionar** — `POST /api/clientes/<id>/fusionar/`, **nivel 2**. Mueve
ventas, rentas, cotizaciones, reparaciones, obras y contactos; desactiva el
origen; deja quién, cuándo y por qué. Reemplaza a `fusionar_cliente_adeudos`.

**D5 · `DocumentoCliente`** — modelo + migración + endpoints. Patrón de
`EvidenciaRenta` (Cloudinary + rastro). **Nivel 1 ve que existen y si están
vigentes; abrir o descargar el archivo es nivel 2.**

### Panel

**D6** · Pestaña "Cuentas sin vincular" con su badge; comprobantes en la ficha,
con aviso de **vencido**; el botón de fusionar solo visible en nivel 2.

### Hecho cuando

Alguien se registra, llega el aviso, el dueño lo vincula a la constructora
correcta y esa persona ve el historial completo de su empresa al entrar.

---

## Entrega E · Garantías

### Backend

**E1 · Meses en el catálogo** — `Equipo.garantia_meses` (default **3**, decidido
con el dueño: es lo normal, y se ajusta por máquina) y `Refaccion.garantia_meses`
(default `0`).

**E2 · Garantía del proveedor** — `Venta.garantia_proveedor_meses` y
`garantia_proveedor_nota`, capturables al levantar un pedido sobre pedido. Dato
de referencia: no dispara nada.

**E3 · Modelo `Garantia`** — según §8.2 del diseño. `vigente` es propiedad
calculada, `descripcion` es snapshot.

**E4 · Se crea sola al vender** si el equipo trae meses, ajustable en la venta.

**E5 · En el resumen del buscador y en `GET /api/unidades/<codigo>/`** (la página
del QR).

### Panel

**E6** · Garantías en la ficha del cliente con su estado; en el buscador de
mostrador; en la página del QR de la unidad. En el catálogo del equipo, el campo
de meses.

### Hecho cuando

Se vende una máquina con 12 meses, y al buscar a ese cliente el mostrador ve
"Excavadora EX-200 · garantía vigente hasta 15/03/2027".

---

## Riesgos

| Riesgo | Cómo se atiende |
|---|---|
| `Dashboard.tsx` ya tiene 9,898 líneas | `ClientesAdmin` va en archivo propio desde el principio |
| La lista de clientes crece más que ninguna | Paginada y con agregados desde A2 |
| Cuatro flujos escribiendo cliente = cuatro formas de hacerlo mal | Un helper compartido en backend, un componente en front |
| Duplicados por captura a mano | `requiere_revision` + su pestaña, desde B2 |
| Meses de garantía por defecto | Resuelto: **3**, ajustable por máquina |

## Nada pendiente de decidir

`Equipo.garantia_meses` quedó en **3 meses**, ajustable por máquina.
