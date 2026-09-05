# REMALI Admin: documentación técnica

> Panel de operación para un negocio de renta y venta de maquinaria, que también vende refacciones.
> Backend Django con DRF, frontend React/Vite, desplegado en Railway con imágenes en Cloudinary.

Última actualización: 2026-07-11

---

## 1. Visión general

REMALI Admin administra:

- El catálogo de equipos y modelos de maquinaria (`Equipo`).
- El inventario físico: cada máquina real es una unidad (`Inventario`) con estado (disponible, rentado, mantenimiento o vendido).
- Rentas de unidades por día, semana o mes.
- Ventas de maquinaria (unidad única) y de refacciones (piezas con stock).
- Empresas y obras, o sea los clientes B2B. El módulo está construido pero todavía no se conecta a rentas.
- Notificaciones internas y mensajería de soporte (chat cliente ↔ admin).

Usuarios objetivo (según `PRODUCT.md`):
- Administración (dueño y gerencia): métricas, catálogo, inventario, rentas y ventas.
- Operación (mostrador y almacén): movimientos, disponibilidad, devoluciones, mantenimiento.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Django 5.2.9, Django REST Framework 3.16, SimpleJWT |
| Base de datos | MySQL en prod (Railway) / SQLite como fallback local |
| Auth | JWT (access 12 h, refresh 7 días) |
| Imágenes | Cloudinary (`django-cloudinary-storage`) con fallback a `FileSystemStorage` |
| Estáticos | WhiteNoise (SPA + admin) |
| PDF/Etiquetas | ReportLab + `qrcode` (usados en el admin) |
| Frontend | React 19, Vite 7, TypeScript, TailwindCSS 4, MUI 7, Framer Motion, GSAP |
| Gráficas | Nivo (bar/line/pie/geo) |
| Deploy | Docker + Railway (`remali.up.railway.app`) |
| Cache | LocMem por defecto; Redis si `REDIS_URL` está definido (preparado para Celery/Channels) |

---

## 3. Estructura del repositorio

```
Remali/
├── backend/                 # Proyecto Django
│   ├── manage.py
│   ├── requirements.txt     # ojo: faltan reportlab y qrcode (ver auditoría)
│   ├── Procfile             # Arranque en Railway (gunicorn)
│   ├── server/              # Configuración del proyecto
│   │   ├── settings.py
│   │   ├── urls.py          # Ruteo raíz + catch-all SPA
│   │   ├── wsgi.py / asgi.py
│   │   └── cloudinary_client.py
│   └── apps/                # apps de negocio (añadidas a sys.path)
│       ├── maquinaria/      # Catálogo + auth + notificaciones + soporte (app "grande")
│       ├── inventario/      # Unidades físicas y su ciclo de vida
│       ├── renta/           # Rentas + señales
│       ├── ventas/          # Ventas de maquinaria y refacciones
│       ├── refacciones/     # Solo modelo (sin API todavía)
│       └── empresas/        # Empresas y obras (clientes B2B)
├── frontend/                # SPA React/Vite
│   ├── src/
│   │   ├── routes/          # Páginas propias (Home, EquiposList, Dashboard, Login, ...)
│   │   ├── scenes/          # Plantilla de admin (bar, pie, calendar, geography, ...)
│   │   ├── components/      # UI reutilizable
│   │   ├── store/           # Context providers (auth, cart, theme, toast, ...)
│   │   └── lib/api.ts       # Cliente axios con JWT
│   └── dist/                # Build servido por Django/WhiteNoise
├── env/                     # Virtualenv de Python (no debería versionarse)
├── DESIGN.md                # Sistema de diseño (tokens, motion, anti-patrones)
├── PRODUCT.md               # Propósito de producto y usuarios
├── RAILWAY_SETUP.md
└── Dockerfile
```

> Nota sobre `sys.path`: en `settings.py` se hace `sys.path.insert(0, BASE_DIR/'apps')`, por eso los imports son `from maquinaria.models import ...` en lugar de `from apps.maquinaria...`. Funciona, pero no es la convención estándar de Django (ver auditoría §2).

---

## 4. Modelo de datos (dominio)

### 4.1 Diagrama de relaciones (resumen)

```
Categoria ─┐
Tipo ──────┤            ┌── ImagenProducto (N)
Marca ─────┴─< Equipo >─┤
                │       └── Inventario (N)  ── unidad física
                │             │
                │             ├──< Renta (N)      (una activa a la vez)
                │             └──< Venta (N)      (Venta.inventario, nullable)
                │
Venta >──< ItemVenta >── Refaccion          (venta de piezas con stock)

Empresa >──< Obra                            (NO conectado a Renta todavía)

User 1──1 PerfilUsuario
Cupon · Notificacion · ConversacionSoporte 1──< MensajeSoporte   (viven en `maquinaria`)
```

### 4.2 `maquinaria`: catálogo y utilidades

- `Equipo`: el *modelo o producto* del catálogo, no la máquina física.
  - Campos: `modelo`, `descripcion`, `imagen`, `categoria`, `tipo`, `marca`, `precio_venta`, `precio_dia`, `precio_semana`, `precio_mes`, `fecha_creacion`.
  - Propiedad `estado_resumen`: deriva "Disponible/Rentado/Vendido/Sin stock" mirando sus unidades.
- `Categoria`, `Tipo` y `Marca`: catálogos simples de nombre único.
- `ImagenProducto`: galería de imágenes por equipo.
- `Cupon`: código y `descuento` (fracción de 0 a 1, por ejemplo `0.15` = 15 %).
- `Notificacion`: feed interno (`tipo`, `titulo`, `mensaje`, `seccion`, `leida`, `ref` anti-duplicado, `data` JSON). Helper `crear_notificacion(...)`.
- `PerfilUsuario`: uno a uno con el `User` de Django (avatar, teléfono, puesto, bio).
- `ConversacionSoporte` y `MensajeSoporte`: el chat de soporte entre cliente y admin.

### 4.3 `inventario`: unidades físicas

`Inventario` es una máquina real concreta.

| Campo | Descripción |
|-------|-------------|
| `equipo` (FK) | A qué modelo pertenece |
| `codigo` | Identificador interno automático (ej. `TAL-0001`), único, no editable |
| `numero_serie` | Serial del fabricante (opcional) |
| `condicion` | `nueva` \| `seminueva` |
| `estado` | `disponible` \| `rentado` \| `mantenimiento` \| `vendido` |
| `ubicacion_actual` | "Bodega", "Taller", dirección de renta… |

Reglas de negocio (métodos del modelo):
- `disponible_para_venta` → `estado == 'disponible'`.
- `disponible_para_renta` → `condicion == 'seminueva'` y `estado == 'disponible'`. Las nuevas no se rentan, solo se venden.
- `enviar_mantenimiento()` y `salir_mantenimiento()` cambian estado y ubicación.
- `marcar_vendido()`, `marcar_rentado()`.
- `generar_codigo()` arma el prefijo de 3 letras del modelo más el consecutivo (`PREF-0001`).

Máquina de estados de `estado`:

```
                 crear renta            devolver / finalizar
   disponible ───────────────► rentado ─────────────────► disponible
       │  ▲                                                    ▲
       │  └───────────── salir_mantenimiento ─────────────────┘
       │
       ├──── enviar_mantenimiento ──► mantenimiento
       │
       └──── vender ──────────────► vendido   (estado terminal)
```

### 4.4 `renta`: rentas

> El detalle del flujo (estados, dinero, reservas, cancelación) está en `03-FLUJO-RENTA-VENTA.md`.

`Renta` (FK a `Inventario`):
- `modalidad` (`dia`/`semana`/`mes`), `duracion`, `fecha_inicio`, `fecha_fin` (autocalculada), `fecha_devolucion_real`.
- Cliente: `empresa`/`obra` (FK opcional a `empresas`), o `cliente`/`telefono_cliente` (texto libre); `direccion`.
- Dinero: `precio_unitario` (snapshot), `descuento`, `deposito`, `recargo`, `subtotal`, `total`.
- `estado`: `reservada` / `activa` / `finalizada` / `cancelada`.
- `clean()` valida que la unidad sea rentable (seminueva, ni vendida ni en mantenimiento) y que no haya traslape de fechas.
- `save()` (atómico): calcula `fecha_fin`, monta los importes, `full_clean()` y ocupa la unidad si es nueva y activa, vía `Inventario.ocupar_por_renta`, que es la fuente única.
- Métodos: `activar()` (reserva→activa), `finalizar()` (cobra recargo por retraso y libera la unidad) y `cancelar()`.
- `signals.py` quedó vacío a propósito: la sincronización de estado vive ahora en el modelo.

### 4.5 `ventas`: ventas

- `Venta`: `nombre_cliente`, `telefono_cliente`, `empresa` (FK opcional), `metodo_pago`, `estado` (`activa` o `cancelada`), `fecha`, `usuario`, `inventario` (FK nullable, la venta de una máquina) y `precio_maquina`.
  - Dinero: `subtotal`, `iva`, `total`. Los precios se capturan con IVA incluido y el sistema los desglosa.
  - `save()` atómico: valida `puede_venderse()` y precio > 0, calcula IVA y marca la unidad `vendido` (vía `Inventario.marcar_vendido`).
  - `recalcular_total()` suma la máquina y los `ItemVenta`. `cancelar()` repone stock y devuelve la máquina. `as_ticket_text()` incluye la línea de la máquina y el desglose de IVA.
- `ItemVenta`: `venta`, `refaccion` (FK), `cantidad`, `precio_unitario`, `subtotal`.
  - `save()` toma el precio de la refacción, valida y descuenta stock, y recalcula el total de la venta.

### 4.6 `refacciones`: piezas (base para el futuro)

`Refaccion`: `nombre`, `descripcion`, `precio_venta`, `stock`, `codigo_barras` (EAN/UPC único).
- No tiene API pública, y su `urls.py` lo dice explícitamente. Solo se administra por el admin de Django y se vende vía `ItemVenta`.
- No está ligada a `Equipo` ni a `Marca`, así que no se sabe qué pieza sirve para qué máquina. Ver roadmap en la auditoría §6.

### 4.7 `empresas`: clientes B2B

- `Empresa`: `nombre`, `rfc`, `contacto`, `telefono`, `email`, `direccion`, `notas`, `activa`.
- `Obra`: pertenece a una empresa; `nombre`, `ubicacion`, `responsable`, `estado` (`activa`, `pausada` o `finalizada`).
- API CRUD solo para admin. Todavía no se enlaza con `Renta`, que guarda `cliente` como texto.

---

## 5. API REST

Base: todas las rutas cuelgan de `/api/`. Autenticación por `Authorization: Bearer <access_token>`.

### 5.1 Autenticación (`maquinaria`)

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| POST | `/api/auth/refresh/` | público | Refrescar access token (lee el refresh de la cookie httpOnly) |
| POST | `/api/auth/login/` | público | Login flexible por username o por email. Única puerta de entrada: freno de 10/min por IP, refresh en cookie httpOnly y candado de correo confirmado para clientes (403 `correo_sin_verificar`) |
| GET | `/api/auth/me/` | autenticado | Datos del usuario actual |
| GET/PUT/PATCH | `/api/auth/perfil/` | autenticado | Ver/editar perfil (avatar incluido) |

### 5.2 Catálogo (`maquinaria`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/equipos/` | público (lectura). Filtros: `uso`, `category`, `brand`, `type`, `price_min/max`, `last_days`, `search`, `unit` |
| POST | `/api/equipos/` | admin |
| GET | `/api/equipos/<id>/` | público |
| PUT/PATCH/DELETE | `/api/equipos/<id>/` | admin |
| POST | `/api/equipos/<id>/imagenes/` | admin (multipart) |
| GET/POST | `/api/categorias/`, `/api/tipos/`, `/api/marcas/` | lectura pública / escritura admin |
| GET/PUT/DELETE | `/api/{categorias,tipos,marcas}/<id>/` | admin |
| GET/POST | `/api/cupones/` | list autenticado / crear admin |
| POST | `/api/cupones/aplicar/` | público, body `{code}` |

### 5.3 Inventario (`inventario`)

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| GET | `/api/unidades/` | admin | Todas las unidades con filtros `estado`, `condicion`, `equipo`, `search` |
| GET/POST | `/api/equipos/<equipo_id>/unidades/` | admin | Unidades de un equipo / alta |
| GET | `/api/equipos/<equipo_id>/inventario-resumen/` | admin | Conteo por estado |
| GET/PUT/PATCH/DELETE | `/api/unidades/<pk>/` | admin | Detalle (no borra si está rentada o tiene historial) |
| POST | `/api/unidades/<pk>/vender/` | admin | Registrar venta de la unidad |
| POST | `/api/unidades/<pk>/mantenimiento/` | admin | `{accion: 'entrar'\|'salir', nota?}` |

### 5.4 Rentas (`renta`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/rentas/` | autenticado, `?estado=activa\|finalizada\|cancelada` |
| POST | `/api/rentas/crear/` | autenticado |
| POST/PATCH | `/api/rentas/<pk>/devolver/` | autenticado |
| GET | `/api/rentas/alertas/` | autenticado, rentas vencidas |

### 5.5 Ventas (`ventas`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/ventas/lista/` | autenticado, `?maquinaria=1` para filtrar solo máquinas |

### 5.6 Empresas / obras (`empresas`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET/POST | `/api/empresas/` | admin |
| GET/PUT/DELETE | `/api/empresas/<pk>/` | admin |
| GET/POST | `/api/empresas/<empresa_id>/obras/` | admin |
| GET/PUT/DELETE | `/api/obras/<pk>/` | admin |

### 5.7 Notificaciones y soporte (`maquinaria`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/notificaciones/` | autenticado (recalcula alertas de vencimiento al vuelo) |
| POST | `/api/notificaciones/<pk>/leer/` · `/api/notificaciones/leer-todas/` | autenticado |
| POST | `/api/mensajeria/contacto/` | público (formulario de contacto) |
| GET | `/api/mensajeria/conversaciones/` · `/<pk>/` | admin |
| POST | `/api/mensajeria/conversaciones/<pk>/{responder,cerrar,abrir}/` | admin |
| GET | `/api/dashboard/metricas/` | público. Hoy devuelve valores fijos (ver auditoría) |

---

## 6. Autorización

Todo vive en `backend/apps/maquinaria/permissions.py`. La autorización real está
ahí, no en el frontend: el panel oculta lo que no aplica por cortesía, pero
cualquiera puede llamar la API directamente.

### 6.1 Niveles

Tres niveles ordenados (`nivel_de`), donde cada uno incluye al anterior:

| Nivel | Quién | Qué es |
|---|---|---|
| 3 | Dueño | superusuario. Lo puede todo, siempre. |
| 2 | Administrador · **Gestor** | opera el negocio. El Gestor es administración DELEGADA: mismo nivel, ajustes propios. |
| 1 | Técnico · **Cajero** | comparten número y hacen trabajos distintos: el campo y el mostrador. |
| 0 | Sin acceso | tiene cuenta, no entra al panel (es un cliente de la tienda). |

Los pares que comparten nivel se distinguen por su GRUPO, no por el número: qué
puede cada uno dentro lo decide la capacidad, no la jerarquía.

### 6.2 Capacidades

El `CATALOGO` de `permissions.py` es la lista de lo que se puede hacer, con su
etiqueta, su explicación y su área. Es DATOS, no un diccionario a mano: la
pantalla de permisos se pinta sola a partir de él.

Un permiso se resuelve en tres capas, y la última manda:

```
nivel (jerarquía)  →  ajuste por puesto (fábrica)  →  override guardado (el dueño)
```

- `AJUSTES_POR_PUESTO` son VALORES DE FÁBRICA (el cajero no renta, el técnico no
  vende), no la ley.
- Los overrides viven en la tabla `PermisoRol` y **solo se guarda lo que difiere
  de fábrica**: volver algo a su valor original borra la fila.
- **Fail-closed**: si esa consulta truena (base a medio migrar), se cae a fábrica
  y se sigue trabajando. Un error nunca reparte permisos.

Cómo se impone en las vistas: `permission_classes = [PuedeLoQueSea]`, con una
subclase de `ExigeCapacidad`. La regla que hace que la pantalla no mienta es que
**si la matriz deja encender X para un rol, todos los endpoints que ejecutan X
tienen que pedir X**; los gates que quedan por nivel son los que protegen una
sección entera o un acto irreversible sin una capacidad concreta detrás. Hay una
prueba que lo vigila: `maquinaria/tests_permisos_imponen.py` recorre el catálogo
y falla si una capacidad configurable no tiene ni un gate real detrás.

El inventario ruta por ruta —con la razón de cada decisión— está en
`docs/superpowers/notas/2026-08-22-inventario-permisos.md`.

### 6.2.1 Los puestos: nombre visible ≠ identidad interna

Un puesto es una fila de `Rol` (`clave`, `nombre`, `nivel`, `protegido`) más el
GRUPO de Django del mismo nombre, que es lo que liga a la gente con su puesto.

- **`clave`** es la identidad interna y no cambia nunca. Los permisos guardados
  (`PermisoRol.rol`) y las reglas del código (`es_gestor`, `es_cajero`, los
  ajustes por puesto) preguntan por ella.
- **`nombre`** es solo lo que se lee. Renombrar un puesto no mueve un permiso ni
  saca a nadie de su lugar: es el MISMO grupo, con otro nombre.

Los cuatro base (`administrador`, `gestor`, `cajero`, `tecnico`) vienen con
`protegido=True`: se renombran, no se borran, porque el código los nombra por
escrito y borrarlos apagaría esas reglas en silencio.

El dueño crea los que quiera desde la pantalla. **Un puesto nuevo nace en
blanco**: nivel de operación (entra al panel) y TODAS las capacidades apagadas.
Heredarle las de un puesto parecido sería cómodo y sería el error —se colarían
permisos que nadie revisó—, así que lo que pueda hacer es exactamente lo que
alguien le encendió a mano. Borrarlo pide el código de 6 dígitos y deja **sin
acceso al panel** a quien lo tuviera, cosa que la pantalla advierte con el
número de personas enfrente.

`mapa_roles()` lee esa tabla en cada petición, sin caché en memoria: el panel
corre en varios procesos y una copia vieja significaría gente que entra o no
según qué worker le tocó.

### 6.2.2 Equipo y Clientes: por qué son dos secciones y no tres

El panel separa a las personas por **para qué sirve su cuenta**, no por si la
tienen:

- **Equipo** — las cuentas de trabajo: quién entra al panel y con qué puesto.
- **Clientes** — el padrón: a quién le vendemos o rentamos, **con cuenta o sin
  ella**. Si un contacto tiene cuenta, eso se ve DENTRO de su renglón (con qué
  correo entra, si confirmó, cuándo entró) y ahí mismo se le quita o se le
  devuelve el acceso.

La tentación es partir por "tiene cuenta / no tiene cuenta", y es justo la línea
equivocada: **es la única que la misma persona cruza sola**. Juan te renta tres
años en mostrador, un día se registra en la tienda, y sin que cambie nada de
quién es ni de lo que te debe se mudaría de pantalla. Eso es exactamente lo que
la app `clientes` vino a terminar (ver el encabezado de su `models.py`: "el mismo
señor podía existir de cuatro formas a la vez").

Por eso no hay una sección de "usuarios con cuenta". Existió, mezclaba los dos
mundos en pestañas, y su mitad de clientes ofrecía botones que la API rechaza
(la contraseña la recupera el cliente, la verificación la hace él).

**Pendiente de la fase 2:** `rentas_mias` filtra por `Renta.usuario`, y vincular
un contacto al padrón NO rellena ese campo en los documentos viejos. Un cliente
que rentó sin cuenta y luego se registra sigue sin ver esas rentas en la app; hoy
se ligan una por una. Falta ofrecer "traerle su historial" al vincular.

### 6.3 Las llaves del negocio (ya sin candado)

Cinco capacidades vivían con candado y ninguna configuración las repartía:
`gestionar_usuarios`, `editar_datos_bancarios`, `borrar_catalogo`,
`tener_codigo_propio` y `configurar_permisos`.

**El dueño las abrió (ago-2026):** él decide a quién se las da. `NUCLEO` quedó
vacío —el mecanismo sigue escrito por si mañana hay que volver a cerrar alguna—
y la pantalla ya no muestra candados.

Lo que eso implica, escrito para que no se descubra tarde:

- **`configurar_permisos` es la llave que reparte las demás.** A quien la reciba
  se le puede conceder todo lo otro, incluida ella misma. El único freno que
  queda es el código de 6 dígitos al guardar; y para el **Gestor** ese código es
  el del **dueño** (`seguridad.verificar_codigo`), así que él no se autoriza solo.
  Para un Administrador con la llave, en cambio, basta su propio NIP.
- **Al dueño no se le puede cerrar ninguna.** Su nivel se las enciende y los
  overrides solo aplican a puestos: no hay forma de encerrarlo fuera de su
  sistema. Lo vigila `LasLlavesDelNegocioSeRepartenTest`.
- Dos de ellas no se imponen desde `permission_classes` de una ruta:
  `borrar_catalogo` vive en `ProtectedDestroyMixin.destroy` y
  `editar_datos_bancarios` es un filtro de CAMPOS del serializer de
  configuración. Van declaradas en `IMPUESTAS_EN_EL_CUERPO` con su lugar exacto,
  para que la prueba que persigue interruptores decorativos no las cuente como
  huérfanas ni se vuelva un colador.

### 6.4 La pantalla (Dashboard → Permisos)

Sección gateada por `configurar_permisos`, o sea solo el dueño. Dos vistas del
mismo dato: **por puesto** (la lista, con su hoja de capacidades por áreas
plegables) y **comparar puestos** (la matriz de capacidades × puestos, con cruz
de lectura y contador vivo). En las dos, el punto dorado marca lo que difiere de
fábrica.

- `POST /api/roles/` — crea un puesto con el nombre que se le dé.
- `PATCH /api/roles/<clave>/` — le cambia el nombre.
- `DELETE /api/roles/<clave>/` — lo borra (pide código; los base se rechazan).

- `GET /api/permisos/` — catálogo, roles, fábrica, efectivo y overrides.
- `POST /api/permisos/` — recibe EL LOTE (`{cambios: [...], codigo}`) y lo aplica
  en una transacción: o entran todos o ninguno. Exige el código de 6 dígitos,
  rechaza con 400 cualquier intento sobre el núcleo, y escribe bitácora.
- `GET /api/permisos/bitacora/` — el rastro (`CambioPermisoRol`, append-only:
  quién, cuándo, de qué a qué).

Al guardar se toca el sello `permisos` del latido, así que los paneles abiertos
vuelven a preguntar qué pueden y se reacomodan solos en un par de segundos, sin
cerrarle la sesión a nadie.

El diseño completo, con lo que se decidió y lo que quedó fuera, está en
`docs/superpowers/specs/2026-08-22-permisos-configurables-design.md`.

- Comando `init_roles` (management command) crea los grupos/roles base.

---

## 7. Configuración y despliegue

- Variables de entorno (`.env.dev` en local, Railway en prod): `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `MYSQL_URL`/`DB_*`, `CLOUDINARY_*`, `EMAIL_*`, `REDIS_URL`, `FRONTEND_URL`, `BACKEND_URL`.
- Base de datos: usa `MYSQL_URL` → `DB_NAME` → `MYSQLDATABASE` → SQLite, en ese orden.
- Media: Cloudinary si hay credenciales; si no, `media/` local.
- Frontend: Django sirve `frontend/dist/index.html` como catch-all de la SPA. El build se genera con `npm run build`.
- Comandos de management (`maquinaria/management/commands/`): `init_roles`, `seed_demo`, `seed_maquinaria`, `purge_products`, `send_test_email`.

### 7.1 Correr en local

```bash
# Backend
cd backend
source ../env/bin/activate         # o tu venv
pip install -r requirements.txt    # instala también reportlab y qrcode (ver auditoría)
python manage.py migrate
python manage.py runserver          # http://localhost:8000  (admin en /admin/)

# Frontend
cd ../frontend
npm install
npm run dev                         # http://localhost:5173
```

---

## 8. Frontend (resumen)

- Cliente API en `src/lib/api.ts`: axios con `baseURL = VITE_API_URL || /api`, inyecta el JWT desde `localStorage`, y ante `401` limpia sesión y manda a `/login`.
- Ruteo (`App.tsx`): público (`/`, `/equipos`) con Navbar/Footer; `/login` y `/dashboard` "bare"; `/dashboard` protegido por `RequireAdmin`.
- Base de plantilla: `src/scenes/*`, `theme.js` y `mockData.js` vienen de una plantilla de admin de React. Varias páginas propias (`Cart`, `Checkout`, `Cotizacion`, `EquipoDetail`, `Profile`, `AdminDashboard`) existen pero no están enganchadas en `App.tsx`, así que conviene limpiarlas o cablearlas (ver auditoría §5).
- Estado global por Context: `auth`, `cart`, `priceUnit`, `profile`, `theme`, `toast`.

---

Ver `02-AUDITORIA-Y-MEJORAS.md` para el estado de la estructura frente a las convenciones de Django/DRF, los bugs detectados y el plan de mejoras (admin, inventario y refacciones).
