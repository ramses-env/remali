# Padrón único de clientes

**Fecha:** 17 de agosto de 2026
**Estado:** fase 1 implementada · fases 2 y 3 pendientes

---

## 1. El problema

Don Chuy, en un año:

| Cuándo | Qué hizo | Qué guardó el sistema |
|---|---|---|
| Mayo | Compró un filtro en mostrador | texto: `"chuy"` |
| Julio | Rentó una revolvedora, dejó $5,000 de depósito | texto: `"Jesus Ramirez"` |
| Sept. | Su hijo pidió cotización para la ferretería | texto: `"Ferretería Ramírez"` |
| Nov. | Se hizo cuenta en la página | un usuario nuevo, vacío |

Para el sistema son **cuatro desconocidos**. Nadie puede contestar "¿cuánto nos ha
comprado don Chuy?" ni, peor, "¿ya le devolvimos sus $5,000?". Y cuando abre su
cuenta en noviembre, ve una pantalla en blanco.

Hoy no existe un modelo `Cliente`. Una misma persona puede estar representada de
cuatro formas a la vez dentro de un solo documento, y ninguna es la autoridad:

| Representación | Dónde vive |
|---|---|
| Cliente con cuenta | `User` + `PerfilUsuario` (`maquinaria/models.py:205`) |
| Cliente de mostrador | texto libre: `Venta.nombre_cliente`, `Renta.cliente`, `Cotizacion.cliente_nombre` |
| Cliente empresarial | `Empresa` + `Obra` (`empresas/models.py:51`) |

El puente entre mundos es la liga de vinculación (`token_vinculo`), implementada
por separado en venta, renta y cotización.

De ahí salen cuatro problemas concretos:

1. **El historial se fragmenta por documento.** No se puede responder "¿cuánto me
   ha comprado Juan Pérez?" ni "¿le debo algo?".
2. **La vinculación es manual y documento por documento.** Si el cliente se
   registra después, sus compras previas siguen huérfanas.
3. **Empresa/obra está duplicado:** `Empresa`+`Obra` (formal) contra
   `PerfilUsuario.empresa` (texto) + `ObraCliente` (light).
4. **Sin cuenta no hay estado de cuenta.** Saldos, abonos y depósitos en estado
   `a_favor` viven por documento. Un depósito a favor es dinero que la empresa
   debe y que hoy solo recuerda el papel.

La raíz: **"cliente" y "cuenta" son la misma cosa, y quien no tiene cuenta no es
cliente — es una cadena de texto.**

---

## 2. Decisiones

| # | Decisión | Qué se eligió |
|---|---|---|
| 1 | Identidad del cliente sin cuenta | **Completa**: historial, saldos y crédito a favor aunque nunca abra cuenta |
| 2 | Persona o empresa | **Un modelo `Cliente` con tipo** física/moral, con contactos y obras |
| 3 | Dónde vive la cuenta | **En el `Contacto`**, y ese contacto ve todo lo de su cliente |
| 4 | Alta en mostrador | **Sugerir y que el vendedor confirme** |
| 5 | Cuenta nueva en la tienda | **Aviso a REMALI y vinculación manual** (corregido, ver 2.1) |
| 6 | Comprobantes | **La ficha los guarda**, con fecha de vencimiento |
| 7 | Alcance | **Por fases**, con los campos viejos de respaldo |

### 2.1 Qué se descartó y por qué

Las decisiones 5 y 6 de la tabla son la **segunda** versión. La primera resolvía
el enganche con software: auto-unión por teléfono, más una prueba de folio +
total, graduada según lo que estuviera en juego.

El dueño lo corrigió, y con razón: **el padrón es suyo y él lo cura.** Casi nunca
se le renta a personas sueltas — se le renta a constructoras, con comprobante de
por medio. La identidad se establece en el mostrador con papeles, no con un
acertijo en pantalla.

Por lo tanto se eliminan del diseño:

- la prueba de folio + total,
- los 3 intentos y el bloqueo de 24 h,
- la lógica graduada según lo que esté en juego,
- el auto-enganche por teléfono.

El teléfono pasa de ser **llave** a ser **pista**: el sistema sugiere la
coincidencia, la decisión es de una persona.

---

## 3. Modelo de datos

App nueva: `backend/apps/clientes/`.

```
Cliente                          ← la autoridad, con o sin cuenta
  tipo            fisica | moral
  nombre          física: nombre completo · moral: nombre comercial
  razon_social · rfc · regimen_fiscal · uso_cfdi · cp_fiscal · email_fiscal
  telefono        10 dígitos normalizados · ÍNDICE de búsqueda
  email · domicilio (DomicilioMixin) · notas · activo · creado
  requiere_revision · revision_motivo

Contacto                         ← las personas del cliente
  cliente     FK → Cliente (OPCIONAL, ver 3.2)
  nombre · telefono · email · puesto
  usuario     OneToOne → User (null)   ← AQUÍ vive la cuenta
  principal   bool

Obra                             ← ya existía; cambia de dueño
  cliente     FK → Cliente   (antes: empresa FK → Empresa)

DocumentoCliente                 ← comprobantes (fase 2)
  cliente · tipo · archivo · vence · subido_por · subido_en
```

### 3.1 Qué pasa con lo existente

- `Empresa` → se vuelve `Cliente(tipo='moral')`. Sobrevive la fase 1, muere en la 3.
- `ObraCliente` (la versión light colgada del `User`) → se fusiona en `Obra`.
- `PerfilUsuario` se parte por dueño: lo **del cliente** (`empresa`,
  `obra_direccion`, `obra_responsable`, `fiscal_*`) migra a `Cliente`; lo **de la
  cuenta** (avatar, bio, onboarding, código de seguridad, `email_verificado`)
  se queda donde está.
- Los documentos ganan `cliente` y `contacto` FK. Sus campos actuales quedan como
  espejo de solo lectura hasta la fase 3.

### 3.2 `Contacto.cliente` es opcional

Una cuenta recién registrada en la tienda es un **contacto sin cliente**: existe
la persona, todavía no se sabe de quién es. Crear un `Cliente` automático para
cada registro ensuciaría justamente el padrón que el dueño cura.

Consecuencia: la regla de "un solo contacto principal" debe ignorar los contactos
sin cliente, o los agruparía a todos entre sí.

### 3.3 Decisiones de esquema con motivo

| Decisión | Por qué |
|---|---|
| `telefono` indexado pero **no único** | dos personas comparten conmutador; un dígito mal tecleado no debe tumbar una venta. La unicidad la resuelve una persona confirmando, no el esquema |
| `Renta.cliente` (texto) renombrado a `cliente_texto` | libera el nombre para el FK desde el principio; la fase 3 solo borra, no vuelve a renombrar |
| `Obra.empresa` pasa a opcional | una obra de persona física nunca tuvo empresa |
| `Obra.cliente` con `SET_NULL`, no `CASCADE` | con `CASCADE`, revertir la migración (que borra todos los `Cliente`) se llevaría obras reales. Pasa a `CASCADE` en la fase 3 |
| Nombre normalizado solo en personas físicas | "CFE" o "GRUPO ADO" no son errores de captura |

---

## 4. Migración del histórico

Comando `migrar_clientes`, con `--informe` (default), `--aplicar` y `--revertir`.

El informe corre **exactamente el mismo código** que la aplicación, dentro de una
transacción que se revierte al final. Lo que muestra es lo que va a pasar, no una
estimación aparte que puede mentir.

| Origen | Se convierte en | Confianza |
|---|---|---|
| Cada `Empresa` | `Cliente(moral)` con su RFC y domicilio; su `contacto` → `Contacto` principal | total, es 1:1 |
| Cada `User` con rol Cliente | `Cliente(fisica)` + `Contacto(principal, usuario=…)` | total |
| Documento con `empresa` FK | apunta a ese cliente moral | total |
| Documento con cuenta ligada | apunta al cliente de ese contacto | total |
| Documentos de solo texto | se agrupan **por teléfono normalizado**; gana el nombre más reciente | alta |
| Documentos sin teléfono | **nada**: se quedan huérfanos, conservando su texto | no hay con qué |

La última fila es deliberada: **es preferible dejar ventas sin dueño que inventar
clientes falsos** que después alguien tiene que limpiar a mano.

Dos casos van a revisión en vez de resolverse solos:

- `PerfilUsuario.empresa` es texto libre. Si casa (normalizado) con una `Empresa`,
  el contacto se cuelga de esa moral. Si no casa, se queda física y el texto va a
  sus notas — no se inventan constructoras a partir de un campo sin validar.
- Mismo teléfono con nombres incompatibles (`Juan Pérez` vs `Ferretería el Roble`):
  se une al candidato más probable y se marca `requiere_revision`.

**Reversibilidad:** la fase 1 no borra ni pisa nada. Si el informe sale mal, se
vacían las tablas nuevas, se sueltan los FK y todo queda como estaba.

---

## 5. Flujos de mostrador

"Mostrador" no es una pantalla: son cuatro flujos con tres roles distintos.

| Flujo | Endpoint | Quién |
|---|---|---|
| Caja de refacciones | `POST /api/ventas/mostrador/` | Cajero |
| Venta de maquinaria | `POST /api/unidades/<id>/vender/` | Técnico↑ (no Asesor) |
| Renta | `POST /api/rentas/` | Técnico↑ (no Cajero) |
| Cotización | cotizaciones | Asesor o Admin↑ |

Por eso: **un endpoint y un componente, no cuatro.**

```
GET /api/clientes/buscar/?telefono=4771234567
GET /api/clientes/buscar/?q=naomi

→ [{ id, nombre, tipo, telefono,
     contactos: [{id, nombre, telefono}],
     resumen: { compras, rentas_activas, saldo, credito_a_favor } }]
```

`<BuscadorCliente>` se monta en las cuatro pantallas. Devuelve
`{cliente_id, contacto_id}` o `{nuevo: {nombre, telefono}}`.

### 5.1 La regla dura

**El backend nunca une por teléfono sin confirmación.** Recibe `cliente_id` y lo
usa, o crea uno nuevo. Unir es siempre decisión de una persona.

Si el backend crea un cliente cuyo teléfono ya existe, lo marca
`requiere_revision` con el motivo. El duplicado se hace visible en vez de
esconderse.

### 5.2 La caja no se frena

En refacciones el cliente es **opcional**: se captura si es del padrón o si pide
factura; si es alguien que pasó por un filtro de $300, se vende como hoy.

### 5.3 Obras en renta

El selector de obra se filtra por el cliente elegido. Persona física sin obras:
dirección libre, como hoy.

---

## 6. El padrón lo lleva REMALI

### 6.1 Alta manual

La sección Clientes abre con "Nuevo cliente" y su formulario completo: persona o
constructora, fiscales, contactos, obras. **El padrón se llena porque el dueño lo
llena**, no porque el sistema lo deduzca de las ventas.

### 6.2 Comprobantes

`DocumentoCliente` sigue el patrón de `EvidenciaRenta` (archivo en Cloudinary,
rastro de quién subió y cuándo). Tipos: acta constitutiva, INE, comprobante de
domicilio, orden de compra, otro.

`vence` es lo que le da valor: un comprobante de domicilio de hace tres años no
sirve, y la ficha avisa **"comprobante vencido"** antes de entregar una máquina
cara.

**Acceso:** nivel 1 ve **que existen y si están vigentes** — es lo que necesita
para decidir si entrega. **Abrirlos o descargarlos es nivel 2**: ahí adentro hay
INEs.

### 6.3 Registro → aviso → vinculación manual

```
Alguien se registra en la tienda
        ↓
  crear_notificacion('Cuenta nueva: Laura Méndez')   ← solo llega a staff
        ↓
  Panel · Clientes · pestaña "Cuentas sin vincular"
        ↓
  Se muestra la coincidencia de teléfono como PISTA:
  "Ese teléfono ya es de Constructora del Bajío (14 documentos)"
        ↓
  [Vincular a este]   [Buscar otro]   [Dejar sin vincular]
```

Vincular = ponerle su `cliente` al contacto, con rastro de quién y cuándo.

La liga de vinculación existente (`token_vinculo`) sigue viva para el caso
puntual; lo único que cambia es que ahora liga el documento al `Cliente`.

---

## 7. Estado de cuenta

Tres cifras y una lista:

```
  Le debe a REMALI          $ 42,300.00     ← rentas con saldo + apartados
  REMALI le debe            $  5,000.00     ← depósito de garantía a favor
  Neto                      $ 37,300.00
  Historial: 14 documentos (ventas, rentas, cotizaciones)
```

**Se calcula al vuelo, no se guarda.** No hay campo `Cliente.saldo` actualizado
por señales: un saldo guardado se desincroniza —un abono que no disparó la señal,
una cancelación, un `bulk_update`— y un número de dinero equivocado es peor que
no tener el número. Las piezas ya existen: `Renta.saldo_pendiente`,
`Venta.saldo_pendiente` y `deposito_reembolso` cuando el depósito quedó en
`por_devolver` o `a_favor`. La lista de clientes usa anotaciones agregadas, no un
bucle que pregunte cliente por cliente.

```
GET /api/clientes/<id>/estado-cuenta/
→ { saldo, credito_a_favor, neto, documentos: [...] }
```

**No se hace:** aplicar el crédito a favor automáticamente a una renta nueva. Se
**muestra** al momento de rentar y una persona decide. Aplicarlo solo es una
decisión contable con efectos en el corte de caja.

---

## 8. Roles y permisos

**No se crea un rol nuevo.** `Cajero` ya es el rol de mostrador con caja; un rol
"Mostrador" que se solape con él dejaría a la gente sin saber cuál asignar. Si en
el mostrador también se levantan rentas, lo correcto es abrirle `rentar` al
Cajero, no duplicar el rol.

Capacidades nuevas (`apps/maquinaria/permissions.py:puede_de`):

| Capacidad | Nivel | Por qué |
|---|---|---|
| `ver_clientes` — buscar y ver ficha | 1 | sin esto el buscador de mostrador no sirve |
| `editar_clientes` — alta y datos de contacto | 1 | dar de alta es parte de atender |
| Datos fiscales · fusionar · abrir comprobantes | 2 | tocan facturación, historial ajeno e INEs |

La fusión de dos clientes reemplaza a `fusionar_cliente_adeudos` (que hoy vive en
renta, solo funde rentas y agrupa por texto): mueve ventas, rentas, cotizaciones,
obras y contactos, desactiva el origen y deja quién/cuándo/motivo.

### 8.1 Preparar el terreno para permisos configurables

El dueño pidió, para más adelante, **una pantalla donde el administrador encienda
o apague capacidades por rol** sin que nadie toque código. Eso no se construye
aquí, pero cambia cómo se declaran las capacidades nuevas.

Hoy `puede_de()` calcula todo en Python: un diccionario derivado del nivel, más
overrides fijos por puesto (`Cajero` con `rentar=False`, `Asesor` con
`vender=False`). Cuando llegue el selector, esos overrides tienen que poder
leerse de la base y caer en estos valores cuando no haya nada configurado.

Por eso, dos reglas para la fase 2:

1. **Las capacidades nuevas se declaran en un catálogo**, no sueltas: nombre
   estable, etiqueta legible y nivel mínimo. Es exactamente lo que la pantalla
   del selector necesitará para pintarse sola, y cuesta lo mismo hacerlo bien
   desde ahora.
2. **Nada de `if rol == 'Cajero'` disperso por las vistas.** La pregunta se le
   hace siempre a la capacidad (`puede['ver_clientes']`), nunca al nombre del
   puesto. Si el permiso se vuelve configurable, el código que pregunta por
   capacidades sigue funcionando sin tocarse; el que pregunta por rol, no.

Los overrides actuales de `Cajero` y `Asesor` quedan documentados como **valores
por defecto**, no como la ley del sistema.

---

## 9. El panel de React, siempre

**Nada se queda solo en el admin de Django.** Cada fase entrega backend **y**
panel; si algo solo se puede hacer desde `/admin/`, la fase no está terminada.

La sección Clientes toca cinco puntos de `Dashboard.tsx`:

| Dónde | Qué |
|---|---|
| `type Section` (~221) | `\| 'clientes'` |
| Mapa de capacidad (~617) | `clientes: 'ver_clientes'` — **nivel 1** |
| Navegación (~654) | ícono + badge con el total del padrón |
| Render (~1078) | `{section === 'clientes' && <ClientesAdmin … />}` |
| Buscador global (~320) | los clientes entran al `⌘K` |

Detalle importante: **Empresas hoy está gateada por `ver_dinero` (nivel 2)**, o
sea que ni el Cajero ni el Asesor la ven. Clientes no puede heredar eso — el
mostrador es quien más la necesita.

`ClientesAdmin` trae: lista con búsqueda por nombre/teléfono/RFC, filtros por
tipo y por "requiere revisión", ficha con contactos (marcando quién tiene
cuenta), obras, comprobantes e historial. La bandeja de revisión y las cuentas
sin vincular son pestañas de esa misma sección.

---

## 10. Fases

| | Qué | Estado |
|---|---|---|
| **Fase 1** | App `clientes`, FK en los documentos, comando de migración, `Contacto.cliente` opcional, 27 pruebas | ✅ hecha |
| **Fase 2** | Sección Clientes (alta manual, ficha, comprobantes, cuentas sin vincular), `<BuscadorCliente>` en los 4 flujos, estado de cuenta, aviso de cuenta nueva, capacidades nuevas | pendiente |
| **Fase 3** | Se borran los campos espejo, `Empresa` muere, la sección Empresas desaparece, `Obra.cliente` pasa a `CASCADE` | pendiente |

La fase 1 es deliberadamente **invisible**: si al abrir el panel algo se ve
distinto, es un error de implementación, no del diseño.

En la fase 2, los campos viejos se siguen escribiendo en paralelo: la reversión
debe seguir siendo posible hasta que llegue la fase 3.

---

## 11. Lo que deliberadamente no se hace

- **Aplicar el crédito a favor automáticamente.** Se muestra; decide una persona.
- **Inventar clientes** para documentos sin teléfono. Se quedan huérfanos.
- **Crear clientes morales** a partir del texto libre de `PerfilUsuario.empresa`.
- **Unir historiales sin que una persona lo confirme**, en ningún flujo.
- **Un rol "Mostrador"** que se solape con Cajero.
