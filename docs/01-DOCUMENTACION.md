# REMALI Admin — Documentación técnica

> Panel de operación para un negocio de **renta y venta de maquinaria** (y venta de refacciones).
> Backend Django + DRF, frontend React/Vite, desplegado en Railway con imágenes en Cloudinary.

Última actualización: 2026-07-11

---

## 1. Visión general

**REMALI Admin** administra:

- **Catálogo** de equipos/modelos de maquinaria (`Equipo`).
- **Inventario** físico: cada máquina real es una **unidad** (`Inventario`) con estado (disponible / rentado / mantenimiento / vendido).
- **Rentas** de unidades por día/semana/mes.
- **Ventas** de maquinaria (unidad única) y de **refacciones** (piezas con stock).
- **Empresas y obras** (clientes B2B) — *módulo construido pero aún no conectado a rentas*.
- **Notificaciones** internas y **mensajería de soporte** (chat cliente ↔ admin).

Usuarios objetivo (según `PRODUCT.md`):
- **Administración** (dueño/gerencia): métricas, catálogo, inventario, rentas y ventas.
- **Operación** (mostrador/almacén): movimientos, disponibilidad, devoluciones, mantenimiento.

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
│   ├── requirements.txt     # ⚠️ faltan reportlab y qrcode (ver auditoría)
│   ├── Procfile             # Arranque en Railway (gunicorn)
│   ├── server/              # Configuración del proyecto
│   │   ├── settings.py
│   │   ├── urls.py          # Ruteo raíz + catch-all SPA
│   │   ├── wsgi.py / asgi.py
│   │   └── cloudinary_client.py
│   └── apps/                # ⭐ Apps de negocio (añadidas a sys.path)
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

> **Nota sobre `sys.path`:** en `settings.py` se hace `sys.path.insert(0, BASE_DIR/'apps')`, por eso los imports son `from maquinaria.models import ...` en lugar de `from apps.maquinaria...`. Funciona, pero no es la convención estándar de Django (ver auditoría §2).

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

Empresa >──< Obra                            (⚠ NO conectado a Renta todavía)

User 1──1 PerfilUsuario
Cupon · Notificacion · ConversacionSoporte 1──< MensajeSoporte   (viven en `maquinaria`)
```

### 4.2 `maquinaria` — catálogo y utilidades

- **`Equipo`** — el *modelo/producto* del catálogo (no la máquina física).
  - Campos: `modelo`, `descripcion`, `imagen`, `categoria`, `tipo`, `marca`, `precio_venta`, `precio_dia`, `precio_semana`, `precio_mes`, `fecha_creacion`.
  - Propiedad `estado_resumen`: deriva "Disponible/Rentado/Vendido/Sin stock" mirando sus unidades.
- **`Categoria`**, **`Tipo`**, **`Marca`** — catálogos simples (nombre único).
- **`ImagenProducto`** — galería de imágenes por equipo.
- **`Cupon`** — código + `descuento` (fracción 0–1, ej. `0.15` = 15 %).
- **`Notificacion`** — feed interno (`tipo`, `titulo`, `mensaje`, `seccion`, `leida`, `ref` anti-duplicado, `data` JSON). Helper `crear_notificacion(...)`.
- **`PerfilUsuario`** — 1–1 con el `User` de Django (avatar, teléfono, puesto, bio).
- **`ConversacionSoporte`** + **`MensajeSoporte`** — chat de soporte cliente/admin.

### 4.3 `inventario` — unidades físicas ⭐

**`Inventario`** = una máquina real concreta.

| Campo | Descripción |
|-------|-------------|
| `equipo` (FK) | A qué modelo pertenece |
| `codigo` | **Identificador interno automático** (ej. `TAL-0001`), único, no editable |
| `numero_serie` | Serial del fabricante (opcional) |
| `condicion` | `nueva` \| `seminueva` |
| `estado` | `disponible` \| `rentado` \| `mantenimiento` \| `vendido` |
| `ubicacion_actual` | "Bodega", "Taller", dirección de renta… |

**Reglas de negocio (métodos del modelo):**
- `disponible_para_venta` → `estado == 'disponible'`.
- `disponible_para_renta` → `condicion == 'seminueva'` **y** `estado == 'disponible'`. Las **nuevas no se rentan** (solo se venden).
- `enviar_mantenimiento()` / `salir_mantenimiento()` — cambian estado y ubicación.
- `marcar_vendido()`, `marcar_rentado()`.
- `generar_codigo()` — prefijo de 3 letras del modelo + consecutivo (`PREF-0001`).

**Máquina de estados de `estado`:**

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

### 4.4 `renta` — rentas

> El detalle del flujo (estados, dinero, reservas, cancelación) está en **`03-FLUJO-RENTA-VENTA.md`**.

**`Renta`** (FK a `Inventario`):
- `modalidad` (`dia`/`semana`/`mes`), `duracion`, `fecha_inicio`, `fecha_fin` (autocalculada), `fecha_devolucion_real`.
- Cliente: `empresa`/`obra` (FK opcional a `empresas`), o `cliente`/`telefono_cliente` (texto libre); `direccion`.
- **Dinero:** `precio_unitario` (snapshot), `descuento`, `deposito`, `recargo`, `subtotal`, `total`.
- `estado`: `reservada` / `activa` / `finalizada` / `cancelada`.
- `clean()` valida: unidad rentable (seminueva, no vendida/mantenimiento) y **sin traslape** de fechas.
- `save()` (atómico): calcula `fecha_fin`, monta los importes, `full_clean()` y ocupa la unidad si es nueva y activa (vía `Inventario.ocupar_por_renta`, **fuente única**).
- Métodos: `activar()` (reserva→activa), `finalizar()` (recargo por retraso + libera), `cancelar()`.
- **`signals.py`** quedó **vacío a propósito** (la sincronización de estado vive ahora en el modelo).

### 4.5 `ventas` — ventas

- **`Venta`**: `nombre_cliente`, `telefono_cliente`, `empresa` (FK opcional), `metodo_pago`, `estado` (`activa`/`cancelada`), `fecha`, `usuario`, **`inventario`** (FK nullable → venta de una máquina) + `precio_maquina`.
  - **Dinero:** `subtotal`, `iva`, `total` (los precios se capturan **con IVA incluido** y se desglosan).
  - `save()` atómico: valida `puede_venderse()` y precio > 0, calcula IVA y marca la unidad `vendido` (vía `Inventario.marcar_vendido`).
  - `recalcular_total()` suma máquina + `ItemVenta`. `cancelar()` repone stock y devuelve la máquina. `as_ticket_text()` incluye la máquina + desglose de IVA.
- **`ItemVenta`**: `venta`, `refaccion` (FK), `cantidad`, `precio_unitario`, `subtotal`.
  - `save()`: toma el precio de la refacción, **valida y descuenta stock**, recalcula el total de la venta.

### 4.6 `refacciones` — piezas (base para el futuro)

**`Refaccion`**: `nombre`, `descripcion`, `precio_venta`, `stock`, `codigo_barras` (EAN/UPC único).
- **Sin API pública** (su `urls.py` lo dice explícitamente). Solo se administra por el admin de Django y se vende vía `ItemVenta`.
- **No está ligada a `Equipo`/`Marca`** (no se sabe qué pieza sirve para qué máquina). Ver roadmap en la auditoría §6.

### 4.7 `empresas` — clientes B2B

- **`Empresa`**: `nombre`, `rfc`, `contacto`, `telefono`, `email`, `direccion`, `notas`, `activa`.
- **`Obra`**: pertenece a una empresa; `nombre`, `ubicacion`, `responsable`, `estado` (`activa`/`pausada`/`finalizada`).
- API CRUD solo-admin. **Aún no se enlaza con `Renta`** (la renta guarda `cliente` como texto).

---

## 5. API REST

Base: todas las rutas cuelgan de `/api/`. Autenticación por `Authorization: Bearer <access_token>`.

### 5.1 Autenticación (`maquinaria`)

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| POST | `/api/auth/refresh/` | público | Refrescar access token (lee el refresh de la cookie httpOnly) |
| POST | `/api/auth/login/` | público | Login flexible por username **o** email. Única puerta de entrada: freno de 10/min por IP, refresh en cookie httpOnly y candado de correo confirmado para clientes (403 `correo_sin_verificar`) |
| GET | `/api/auth/me/` | autenticado | Datos del usuario actual |
| GET/PUT/PATCH | `/api/auth/perfil/` | autenticado | Ver/editar perfil (avatar incluido) |

### 5.2 Catálogo (`maquinaria`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/equipos/` | público (lectura) — filtros: `uso`, `category`, `brand`, `type`, `price_min/max`, `last_days`, `search`, `unit` |
| POST | `/api/equipos/` | admin |
| GET | `/api/equipos/<id>/` | público |
| PUT/PATCH/DELETE | `/api/equipos/<id>/` | admin |
| POST | `/api/equipos/<id>/imagenes/` | admin (multipart) |
| GET/POST | `/api/categorias/`, `/api/tipos/`, `/api/marcas/` | lectura pública / escritura admin |
| GET/PUT/DELETE | `/api/{categorias,tipos,marcas}/<id>/` | admin |
| GET/POST | `/api/cupones/` | list autenticado / crear admin |
| POST | `/api/cupones/aplicar/` | público — body `{code}` |

### 5.3 Inventario (`inventario`) ⭐

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
| GET | `/api/rentas/` | autenticado — `?estado=activa\|finalizada\|cancelada` |
| POST | `/api/rentas/crear/` | autenticado |
| POST/PATCH | `/api/rentas/<pk>/devolver/` | autenticado |
| GET | `/api/rentas/alertas/` | autenticado — rentas vencidas |

### 5.5 Ventas (`ventas`)

| Método | Ruta | Permiso |
|--------|------|---------|
| GET | `/api/ventas/lista/` | autenticado — `?maquinaria=1` para filtrar solo máquinas |

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
| GET | `/api/dashboard/metricas/` | público — **hoy devuelve valores fijos (ver auditoría)** |

---

## 6. Autorización

- **Default global:** `AllowAny` (¡todo abierto salvo que la vista lo restrinja!). Ver auditoría §1.
- **`IsAdminGroupOrStaff`** (`maquinaria/permissions.py`): `is_staff` **o** pertenecer al grupo `Administrador`.
- Convención mixta: inventario/empresas usan admin; rentas/ventas usan `IsAuthenticated`; catálogo es lectura pública + escritura admin.
- Comando `init_roles` (management command) crea el grupo/roles base.

---

## 7. Configuración y despliegue

- **Variables de entorno** (`.env.dev` local, Railway en prod): `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `MYSQL_URL`/`DB_*`, `CLOUDINARY_*`, `EMAIL_*`, `REDIS_URL`, `FRONTEND_URL`, `BACKEND_URL`.
- **Base de datos:** usa `MYSQL_URL` → `DB_NAME` → `MYSQLDATABASE` → SQLite (en ese orden).
- **Media:** Cloudinary si hay credenciales; si no, `media/` local.
- **Frontend:** Django sirve `frontend/dist/index.html` como catch-all (SPA). El build se genera con `npm run build`.
- **Comandos de management** (`maquinaria/management/commands/`): `init_roles`, `seed_demo`, `seed_maquinaria`, `purge_products`, `send_test_email`.

### 7.1 Correr en local

```bash
# Backend
cd backend
source ../env/bin/activate         # o tu venv
pip install -r requirements.txt    # ⚠ instala también reportlab y qrcode (ver auditoría)
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
- **Base de plantilla:** `src/scenes/*` y `theme.js`/`mockData.js` provienen de una plantilla de admin de React. Varias páginas propias (`Cart`, `Checkout`, `Cotizacion`, `EquipoDetail`, `Profile`, `AdminDashboard`) existen pero **no están enganchadas** en `App.tsx` → conviene limpiar o cablear (ver auditoría §5).
- Estado global por Context: `auth`, `cart`, `priceUnit`, `profile`, `theme`, `toast`.

---

Ver **`02-AUDITORIA-Y-MEJORAS.md`** para el estado de la estructura frente a las convenciones de Django/DRF, bugs detectados, y el plan de mejoras (admin, inventario/máquinas y refacciones).
