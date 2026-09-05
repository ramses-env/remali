# REMALI: guía para continuar el proyecto

> Documento de traspaso. Si vas a retomar este proyecto (con otra cuenta de
> Claude o después de un tiempo), **lee esto primero**. Recoge el estado real,
> las decisiones de arquitectura y lo que falta por hacer.
> Última actualización: 22 de julio de 2026.

---

## 1. Qué es REMALI

Panel de administración para un negocio de **renta y venta de maquinaria ligera**
(cortadoras, martillos, revolvedoras, etc.), más una **tienda pública** donde los
clientes ven el inventario y arman su cotización.

**Stack**
- **Backend:** Django 5.2 + Django REST Framework + SimpleJWT. Base **MySQL**.
- **Frontend:** React 19 + Vite + TypeScript + Tailwind 4.
- **Deploy:** Railway (Docker). Almacenamiento de imágenes: Cloudinary.
- **Repo git:** `origin` → `github.com/ramses-env/remali.git`. Rama de trabajo: `inventario`.

**Estructura**
```
Remali/
  backend/          Django. Apps en backend/apps/ (están en sys.path: se importan
                    con nombre pelón, ej. `from maquinaria.models import ...`)
    apps/maquinaria/   núcleo: equipos, catálogos, usuarios, config, permisos, notifs
    apps/inventario/   unidades físicas + órdenes de reparación
    apps/renta/        rentas, evidencia fotográfica, tareas del técnico
    apps/ventas/       ventas de mostrador y de maquinaria
    apps/cotizaciones/ cotizaciones (admin y públicas) + PDF
    apps/refacciones/  refacciones/insumos
    apps/empresas/     empresas y obras
    apps/facturacion/  solicitudes de factura
  frontend/         React. El grueso vive en src/routes/Dashboard.tsx (muy grande)
  env/              venv de Python (¡NO está dentro de backend/!)
  railway.cron.json config del cron diario
  CONTINUAR.md      este archivo
```

---

## 2. Cómo correr el proyecto

### venv
El venv está en `Remali/env` (hermano de `backend/`, **no** dentro). Siempre:
```bash
cd backend
../env/bin/python manage.py <lo que sea>
```

### Backend (Django)
```bash
cd backend
../env/bin/python manage.py migrate
../env/bin/python manage.py runserver 8000      # o 127.0.0.1:8000
```

### Frontend (Vite)
```bash
cd frontend
npm run dev        # levanta en :5173, ya con host:true y proxy /api → :8000
```
- `VITE_API_URL=/api` (en `frontend/.env.local`; si falta, `api.ts` cae a `/api`
  por defecto). El proxy de Vite manda `/api`, `/admin`, `/static`, `/media` a
  `localhost:8000`.

### Probar desde el celular (misma red WiFi)
Vite ya escucha en `0.0.0.0` (`host: true`). Solo saca la IP local:
```bash
ipconfig getifaddr en0
```
y en el celular entra a `http://<esa-ip>:5173`. El proxy `/api` reenvía a Django
en la misma Mac, así que no hay que tocar `ALLOWED_HOSTS` para esto. La cámara al
subir fotos de evidencia solo abre garantizada bajo **HTTPS**; por `http://` a
veces solo deja elegir de galería.

### Verificar antes de dar algo por bueno
- **Compilación real del front:** `npm run build` (usa `tsc -b`, atrapa errores
  que `tsc --noEmit` no ve). Siempre correr `build`, no solo el dev.
- **Checks de Django:** `manage.py check` y `manage.py makemigrations --check --dry-run`.
- **Patrón de prueba de API con rollback** (el que se usó toda la sesión):
  ```python
  # dentro de: ../env/bin/python manage.py shell
  from django.conf import settings; settings.ALLOWED_HOSTS = ['*']   # ¡obligatorio!
  from django.db import transaction
  from rest_framework.test import APIClient
  c = APIClient()
  r = c.post('/api/auth/login/', {'username':'...','password':'...'}, format='json')
  c.credentials(HTTP_AUTHORIZATION='Bearer '+r.data['access'])
  try:
      with transaction.atomic():
          # ... llamadas ...
          raise RuntimeError('rb')   # revierte todo
  except RuntimeError: pass
  ```
  **Gotcha:** sin `settings.ALLOWED_HOSTS=['*']` en el shell, cada request da 400
  DisallowedHost. El proyecto es **JWT** (no sesión): usa `credentials(...Bearer)`
  o `force_authenticate`, nunca `force_login`.
- **Ver PDFs/diseños renderizados:** `qlmanage -t -s 1400 -o <dir> archivo.pdf`
  genera un PNG que sí se puede inspeccionar.

---

## 3. Roles y permisos (la arquitectura más importante)

Todo vive en **`backend/apps/maquinaria/permissions.py`**. Son **niveles ordenados**,
no permisos sueltos (así agregar un rol no rompe listas):

```
3 · Dueño          superusuario. Además de operar: usuarios, config del negocio, respaldos.
2 · Administrador  grupo 'Administrador' o is_staff. Todo el negocio: ventas, rentas,
                   cotizaciones, facturación, catálogo, métricas.
1 · Técnico        grupo 'Técnico'. Entrega, recoge y repara. Ve montos de lo que
                   opera (cobra en campo) pero NO da de alta inventario ni ve las
                   cuentas del negocio.
0 · Sin acceso     autenticado sin rol; no entra al panel.
```

- `nivel_de(user)` → int. **Fail-closed:** cuenta desactivada da 0 aunque tenga grupo.
- `puede_de(user)` → dict de capacidades (`ver_dinero`, `vender`, `alta_inventario`,
  `ver_montos_operacion`, etc.). Lo consume el frontend para ocultar menús.
- Clases de permiso DRF: `EsDueno`, `IsAdminGroupOrStaff` (=`EsAdministrador`, nivel 2),
  `EsOperador` (nivel 1+), `EsOperadorEditaAdmin` (lee operador, escribe admin).

**La autorización vive en el backend.** El frontend oculta lo que no aplica por
comodidad; cada endpoint declara su nivel. Si un endpoint no lo declara, no está
protegido.

**Frontend:** `frontend/src/lib/acceso.ts` centraliza "quién entra al panel"
(`entraAlPanel`, `recordarAcceso`, `olvidarAcceso`, contexto `usePuede()`). En
`Dashboard.tsx`, el mapa `REQUIERE` dice qué capacidad exige cada sección del menú.
El **técnico solo ve "Tu día" y Configuración**; los módulos de gestión están
ocultos para él (pero las APIs que usa "Tu día" siguen accesibles). La sección
"Notificaciones" se retiró (ago-2026): las notificaciones se leen en la **campana**
de la barra de arriba, que es donde siempre se leyeron.

**La caja es del mostrador.** `usar_caja` y `corte_caja` NO cascadean por nivel
(`nivel_minimo=None`): las trae el puesto de Cajero y nadie más —ni
administración, ni el Gestor, ni el dueño—. Administración sigue vendiendo desde
Ventas y Pedidos; lo que no puede es cobrar en el cajón ni colgarle un movimiento
al turno de la cajera (la bandera `desde_caja` de vender/rentar también pide
`usar_caja`). Si el negocio enciende "Levantar rentas desde la caja", hay que
encenderle además «Rentar» al puesto de Cajero en Permisos.

**`/auth/me/`** y **`/auth/perfil/`** devuelven `is_superuser` y `puede` (capacidades).

**Bug histórico ya arreglado:** ventas y rentas usaban `IsAuthenticated` → cualquier
cuenta autenticada podía crear ventas/rentas. Ya está en el nivel correcto.

---

## 4. Módulos y flujos construidos en esta sesión

### "Tu día" (experiencia del técnico), en `Dashboard.tsx` → `UbicacionesAdmin`
- Endpoint: **`GET /rentas/tareas/`** (`renta/views.py` → `mis_tareas`). Devuelve
  **solo lo accionable**: entregar / recoger / reparar. Una máquina a mitad de
  renta no aparece. Ordenado por urgencia (vencida → hoy → taller → mañana → próxima).
- Cada tarea es un card con una acción. Mobile-first (los técnicos usan celular).
- **Entregar/Recoger** abre una "sábana" (bottom sheet) que **captura fotos primero**
  (`<input capture="environment">` abre la cámara) y luego marca la entrega. El botón
  principal exige ≥1 foto; "sin fotos" es un escape explícito con advertencia.

### Confirmación de entrega y recolección, en `renta/models.py` y `renta/views.py`
- Campos en `Renta`: `entregada_en/por`, `recogida_en/por`.
- Endpoints: `POST /rentas/<id>/entregar/` y `.../devolver/`.
- **Avisa a administración por notificación** (`crear_notificacion`), que el panel
  ya refresca cada ~5s → el admin se entera sin recargar ni llamar. (Esto reemplaza
  la necesidad de WebSockets para este caso.)

### Evidencia fotográfica, en `renta/evidencia.py` (reglas) y `renta/views.py`
- `EvidenciaRenta`: foto, momento (entrega/devolución), nota, quién, cuándo, `tomada_en` (EXIF).
- **Endurecida:** valida que sea imagen real con Pillow (no confía en extensión/mimetype;
  antes se colaba un script `.jpg`), solo JPG/PNG/WEBP, máx 10 MB, tope 12 por momento,
  nombre generado por el server, límite 200/hora por cuenta (`SubidaEvidenciaThrottle`).
- **Reglas de negocio:** no se documenta entrega de algo ya devuelto, ni devolución de
  algo no salido; la evidencia se **congela** al cerrar la renta (ni el admin la borra).
- **EXIF advisory:** guarda la fecha de la foto y avisa si difiere >1 día de la subida.
  No bloquea (muchos teléfonos borran EXIF).

### Reparaciones: flujo de proceso, no instantáneo
- `Dashboard.tsx` → `TallerTrabajoModal`. Estados: **recibida → en proceso → terminada**.
- En "recibida" solo aparece "Empezar reparación". En "en proceso" toma refacciones
  del inventario (descuenta stock vía `POST /reparaciones/<id>/items/`), escribe
  "¿Qué le hiciste?" (autosave), y "Marcar terminada" exige la descripción, así que no
  se cierra en segundos. "Seguir después" la deja abierta (dura días).
- El admin ve todo en su módulo **Reparaciones** (`ReparacionesAdmin`), agrega
  **mano de obra** y notas, e imprime la **orden carta** (`OrdenCartaModal`), que ya
  incluye refacciones usadas + costos + total + firmas. Las refacciones se cargan al
  precio de venta; el admin solo pone la mano de obra.
- **Recordatorios:** comando `recordar_reparaciones` (en el cron diario) avisa de
  órdenes estancadas: recibida >1 día sin empezar, o en proceso >2 días sin avance.
  Un aviso por orden por día (dedup por ref con fecha).

### Usuarios, en `apps/maquinaria/views_usuarios.py` y `Dashboard.tsx` → `UsuariosAdmin`
- Solo el **Dueño** gestiona usuarios (`EsDueno`). CRUD + cambiar contraseña + activar/desactivar.
- **No se borran, se desactivan** (todas las FK a User son SET_NULL: borrar perdería
  el rastro). Protecciones: no quitarte tu propio admin, no dejar el sistema sin ningún admin.
- Tabla estilo comp: badge de rol bajo el nombre, menú "…" en portal. Rol negro para
  Dueño, amarillo para los demás.

### Configuración del negocio, en `apps/maquinaria` (ConfiguracionSitio, CorreoAviso)
- Solo Dueño. WhatsApp (principal + respaldos), datos del negocio (nombre, dirección,
  RFC, pie de ticket), y **correos de aviso con verificación por token**.
- `GET /config/publica/` (sin sesión, para la tienda) vs `GET/PATCH /config/` (Dueño).
- Los datos del negocio salían de `localStorage` (por navegador) → ahora del servidor.

### Bus de invalidación en tiempo real, en `frontend/src/lib/realtime.ts`
- Enganchado al interceptor de axios: toda mutación (POST/PATCH/DELETE) exitosa publica
  su "tema" y quien esté suscrito (`useRecurso`) refetchea. Resuelve el "tengo que
  recargar para ver cambios" **sin Redis ni WebSockets**. Ver decisión en §7.

### Panel del Dueño en negro, en `frontend/src/index.css` (`.tema-dueno`) y el botón `.btn-acento`
- El acento del panel es negro para el superusuario (amarillo para los demás), con
  glow. Se aplica en `<html>` **antes de montar React** (script en `index.html` + flag
  en localStorage) para que no parpadee de dorado a negro al recargar.

### Otros arreglos de la sesión
- **Gráficas del dashboard** usaban colores hardcodeados → ahora tokens (siguen el tema);
  la dona se reparte por estado (verde/azul/ámbar), antes pintaba "disponibles" de dorado.
- **Botones azules** de rentar pasaron de `bg-blue-500` (3.68:1, no pasaba AA) a `.btn-renta`
  con `--c-renta` (6.28:1).
- **Correos fuera del request:** `apps/maquinaria/correo.py` (`enviar_async`) manda en un
  hilo; antes un SMTP lento congelaba al único worker.
- gunicorn con `gthread`, 2 workers × 4 threads (Procfile y Dockerfile). Antes era 1
  petición a la vez.
- **Throttling** en endpoints públicos (`SolicitudPublicaThrottle`, `anon_publico`).
- **Acuse al cliente** al cotizar en la tienda: correo con folio + PDF (`cotizaciones/pdf.py`).
- **Respaldo de BD:** comandos `respaldar_bd` / `restaurar_bd` (sube a Cloudinary; ojo
  con ContentTypes huérfanos de la app vieja 'shop'; ver el comando).
- **`init_roles`** estaba roto (importaba modelos de 'shop'); reescrito, con `--limpiar`.

---

## 5. Credenciales de prueba

Creadas con `python manage.py crear_usuarios_prueba` (se niega a correr con `DEBUG=False`
salvo `--forzar`; son de **desarrollo**, contraseñas públicas):

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador | `admin_prueba` | `remali-admin-2026` |
| Técnico | `tecnico_prueba` | `remali-tecnico-2026` |
| Dueño | `admin` | *(la del usuario; no la conozco)* |

**Bórralas antes de producción:** `python manage.py crear_usuarios_prueba --borrar`.
Grupos existentes: `Administrador`, `Técnico`, `Cliente`.

---

## 6. Pendientes / lo que falta

- **Fase 4 de la tienda:** convertir una cotización de **renta** del cliente en una
  Renta real (elegir unidad + fechas). Convertir a **venta** ya funciona
  (`cotizaciones/views.py` → `convertir_cotizacion`).
- **Permisos huérfanos:** del renombre de app `shop`→`maquinaria` quedaron ContentTypes
  y permisos apuntando a modelos que ya no existen. No rompen nada hoy (el acceso usa
  grupos, no permisos finos), pero límpialos con `init_roles --limpiar` si algún día
  usas permisos individuales.
- **Login sin límite de intentos:** falta throttling en `/auth/login/` (2 líneas).
- Idea futura no hecha: registrar **qué técnico** trabajó cada orden de reparación
  (hoy no se guarda).

---

## 7. Decisiones de arquitectura (por qué, no solo qué)

- **Tiempo real sin Channels/Redis:** se eligió un bus de invalidación en el cliente
  (`realtime.ts`) sobre WebSockets. El backend corre `gunicorn wsgi` (síncrono) y el
  panel lo usan 2–3 personas; el problema real era invalidación de caché, no transporte.
  Los avisos entre usuarios (ej. "el técnico entregó") van por **notificación** que el
  panel ya sondea cada 5s. Si algún día entran muchos usuarios en paralelo, el salto a
  Channels es fácil: el mensaje del WS solo tiene que llamar a `invalidar('<tema>')`.
- **El técnico ve montos de su operación pero no las cuentas del negocio:** separadas
  como `ver_montos_operacion` (nivel 1) vs `ver_dinero` (nivel 2). Cobra en campo, pero
  no ve ingresos/métricas.
- **Dar de alta inventario ≠ mover inventario:** el técnico consume unidades/refacciones
  que ya existen, pero crear productos/unidades/refacciones es de administración
  (`alta_inventario`, `editar_catalogo`).
- **Reparar es un proceso:** el flujo modela recibida→proceso→terminada y exige describir
  el trabajo para terminar, porque una máquina no se repara en segundos.
- **El usuario (Ramsés) prefiere lo simple:** cuando pide "piensa como ingeniero
  profesional" quiere calidad, no complejidad. Propón primero lo directo; no rediseñes
  lo que no pidió. (Rechazó un cron de escalamiento en favor de aviso inmediato, y pidió
  revertir un rediseño de la cotización.)

---

## 8. Ops que debe hacer el usuario (fuera del código)

- **Desplegar** para que tomen efecto: workers de gunicorn (Procfile/Dockerfile), el
  cron nuevo, y todo lo de esta sesión.
- **Crear el servicio cron en Railway** apuntando a `railway.cron.json`. Corre:
  `procesar_rentas; recordar_reparaciones; respaldar_bd` (12:00 diario). Hasta que exista
  ese servicio, **los respaldos y recordatorios NO corren solos.**
- **Variables de entorno en producción:** SMTP (para correos), Cloudinary
  (`CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`), MySQL. Las credenciales SMTP van en env,
  **no** en la config del panel (quedarían en texto plano).
- **Restaurar un respaldo:** `python manage.py migrate && python manage.py restaurar_bd <archivo.json.gz>`.
- **Borrar cuentas de prueba** antes de producción (§5).

---

## 9. Estado al momento del traspaso

- `manage.py check`: limpio. `makemigrations --check`: sin cambios pendientes.
- `npm run build`: verde.
- Última migración renta: `0009_evidenciarenta_tomada_en`. Maquinaria: `0015_rol_tecnico`.
- Probado en navegador (móvil y escritorio) y por API con rollback: roles, "Tu día",
  entrega con fotos, flujo de reparación, orden imprimible, recordatorios.
```

### Gráficas del Resumen (ago-2026)

El panel no usaba ninguna librería: cada gráfica era JSX a mano y la dona un
`conic-gradient`. Ahora hay un kit propio en `frontend/src/components/charts/`,
copiado y adaptado de **Rosen Charts** (MIT, copy-paste, `d3-scale` +
`d3-shape`): `barras-apiladas`, `dona`, `barras-ranking`, `area`, más `tooltip`
y `formato`. Cuatro reglas de la casa que el kit conserva y ninguna librería
trae: recorrido con **flechas** (una parada de tabulador, no treinta), tabla
`sr-only` con las mismas cifras, techo de eje con escalera fina (`techo`) y los
colores desde los tokens `--chart-*`.

Pase visual (lo que hace que no se vean "de tablero"): degradado vertical en
cada barra con filo de luz arriba, tramos de dona con degradado + bisel y
sombra, área con halo y barrido de izquierda a derecha, entradas escalonadas
—todas apagadas bajo `prefers-reduced-motion`—, y la rejilla a media tinta con
la línea del cero entera. Los keyframes viven en `index.css` (`barra-sube`,
`barra-crece`, `revela-derecha`, `dona-entra`) porque llevan variables por
elemento. Ojo: el barrido del área NO usa `stroke-dasharray` —con
`vectorEffect="non-scaling-stroke"` la línea se corta a la mitad—, usa
`clip-path`.

En la columna derecha, **"Inventario por estado" se retiró**: repetía las tres
cifras de la dona de arriba con otro dibujo. En su lugar va **"Dinero por
cobrar"**, la cartera por antigüedad (al corriente / vencido ≤30 / vencido +30)
con el desglose rentas vs. apartados. Se calcula en el navegador con lo que el
Resumen ya baja (`/rentas/adeudos/` y `/ventas/pedidos/`); vencido = pasó la
fecha de fin de la renta o la fecha estimada de entrega del apartado.

`/api/dashboard/metricas/` agrega `top_equipos` (los 6 modelos que más
cobraron en 30 días, con su mezcla renta/venta) y `ocupacion_por_dia` (unidades
rentadas por día contra la flota de ESE día). Reglas probadas en
`maquinaria/tests_metricas_graficas.py`: la ocupación se cuenta por RANGO de la
renta —no por la fecha de alta—, una vencida sin recoger sigue ocupando, y la
flota histórica no descuenta lo que se vendió después.

### Paginación de las tablas (ago-2026)

Una lista sin paginar crece para siempre: a los dos años, "Por facturar" o
"Reparaciones" son mil renglones que el navegador pinta enteros. El pie de
tabla es una sola pieza —`components/ui/paginador.tsx` (dibujo) y
`usar-paginado.ts` (el corte y el salto a la cabecera)—, con dos formas de uso:

- **El servidor ya pagina** → se le pasan `pagina/paginas/total` y `onIr` pide
  la página nueva: **Cotizaciones** (`CotizacionPagination`, 25),
  **Ventas** (`/ventas/lista/`, 50) y **Clientes** (`desde`/`limite`, 25).
- **La lista viene completa** → `usePaginado(filtradas, porPagina, [filtros])`
  corta el arreglo YA FILTRADO: **Por facturar**, **Reparaciones**,
  **Inventario**, **Productos**, **Refacciones**, **Pedidos**, **Adeudos**
  (por CLIENTE, no por renta: cortar a la mitad la deuda de alguien sería
  enseñarla incompleta) y **Equipo**.

Dos reglas que no se pueden perder al tocar esto: los KPIs de arriba siguen
contando sobre el TOTAL (no sobre la página), y la página se reinicia al
cambiar un FILTRO —nunca al cambiar el número de renglones, o una orden nueva
que llega por el latido te sacaría de la página que estás leyendo—.

Pendiente si algún día el volumen lo pide: las de la segunda lista siguen
BAJANDO todo y paginando en el navegador. Pasarlas al servidor exige mover
antes sus cifras al backend, como se hizo con Ventas.

### El parpadeo al cambiar de módulo (ago-2026)

Eran DOS cosas, no una:

1. **El overlay de pantalla completa** (`CargaGlobal` → `Loader`) se enciende
   con cualquier petición que pase de 350 ms. Cambiar de módulo dispara entre
   dos y seis peticiones a la vez, así que la pantalla entera se cubría y se
   destapaba en cada cambio. Solución: **todas las listas del panel van con
   `fondo: true`** (la opción ya existía; ahora está tipada en `api.ts`, sin
   `as never`). El overlay se queda para lo que el usuario dispara a propósito
   —guardar, timbrar, generar un PDF—, donde tapar la pantalla sí comunica algo.
2. **Los carteles de vacío mentían mientras cargaba.** Al quitar el overlay,
   entrar a un módulo enseñaba "Aún no hay órdenes" antes de que llegara la
   lista. El Dashboard ahora lleva `cargados` (qué recurso ya contestó, marcado
   al ASENTARSE: si falló, el vacío es lo honesto) y pasa `cargando` a los nueve
   módulos que se alimentan del padre; su cartel dice "Cargando…" hasta que hay
   respuesta.

Y aparte, el que más se notaba: **Clientes** cambiaba la tabla entera por un
renglón de "Cargando…" en CADA recarga —teclear en el buscador, pasar de
página, volver de dar de alta a alguien—, así que la tarjeta se desplomaba de
800 px a 60 y volvía a crecer. Ahora la tabla se queda, apenas atenuada
(`aria-busy`), y el cartel de carga es solo para cuando todavía no hay nada.

Regla para lo que venga: **una lista que se recarga no se borra**; se atenúa. El
cartel de carga es para la primera vez.
