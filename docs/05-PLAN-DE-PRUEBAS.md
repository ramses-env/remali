# Plan de pruebas de un día para REMALI

Objetivo: decidir hoy, con evidencia, si REMALI sale a producción.
Complementa a `04-PREPRODUCCION-CHECKLIST.md` (aquel dice *qué* debe estar en
verde; éste dice *en qué orden probarlo y cómo*).

Regla de oro del día: **cada fase se prueba con la app corriendo y con los ojos
puestos en la consola del navegador y en los logs de Django.** Un flujo que
"se ve bien" pero deja un 500 en el log no pasa.

Duración estimada: ~8 horas. Las fases van de barato a caro: si algo se rompe
temprano, te enteras antes de gastar la tarde.

---

## Cómo registrar lo que encuentres

Anota todo en la tabla del final, con severidad:

| Sev | Significado |
|-----|-------------|
| **P0** | Bloquea la salida. Se arregla hoy o no se sube. |
| **P1** | Sale a producción con el defecto anotado y se arregla esta semana. |
| **P2** | Cosmético o mejora. Backlog. |

---

## Fase 0. Arranque limpio (30 min)

Ya corrido hoy. Estado real de partida:

| Chequeo | Resultado |
|---|---|
| `manage.py check` | ✅ sin problemas |
| `manage.py makemigrations --check` | ✅ sin migraciones pendientes |
| `manage.py showmigrations` | ✅ 0 migraciones sin aplicar |
| `manage.py test --noinput` | ✅ 22 tests, OK (3.2 s) |
| `npm run build` (tsc + vite) | ✅ compila en 5.3 s |

Dos cosas que ya salieron y hay que tener presentes:

1. `ventas.SesionCaja`, warning W036: MySQL no soporta *unique constraints*
   condicionales, así que la restricción de "una sola sesión de caja abierta"
   **no existe en la base de producción**. Se prueba a mano en la Fase 4.
2. **La base de test `test_remali` quedó viva** de una corrida anterior. Corre
   siempre con `--noinput` o bórrala.

Comandos:

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py check && ../env/bin/python manage.py makemigrations --check --dry-run && ../env/bin/python manage.py test --noinput
```

- [ ] Los 5 chequeos siguen en verde después de cualquier cambio que hagas hoy

---

## Fase 1. Infraestructura local: Redis y respaldos (45 min)

Esto no es opcional: Redis sostiene caché, rate limit y WebSockets entre
workers. Sin él, en Railway con varios procesos, el rate limit y las
notificaciones en vivo se vuelven inconsistentes.

```bash
cd /Users/ramses/Developer/Remali && docker compose -f docker-compose.redis.yml up -d
```

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py check_redis --strict
```

- [ ] `check_redis --strict` responde que Redis funciona para caché **y** Channels
- [ ] Con Redis levantado, el panel sigue abriendo y las notificaciones llegan

Respaldo y, lo importante, restauración:

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py respaldar_bd --local
```

- [ ] Aparece un `.json.gz` nuevo en `backups/`
- [ ] Restauras ese archivo **en una base vacía o clonada, nunca en la real**
- [ ] Tras restaurar: usuarios, cotizaciones, rentas, ventas, catálogo, grupos y
      permisos están completos

Un respaldo que nunca se restauró no es un respaldo. Si esta casilla no se
marca hoy, es **P0**.

---

## Fase 2. Datos y cuentas de prueba (30 min)

Prueba sobre datos limpios; si no, arrastras estados viejos y no sabes si el bug
es del código o de la basura acumulada.

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py respaldar_bd --local && ../env/bin/python manage.py reset_datos_prueba --confirm --conservar-clasificacion
```

Cuentas por rol:

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py init_roles && ../env/bin/python manage.py crear_usuarios_prueba
```

Hueco conocido: `crear_usuarios_prueba` solo crea `admin_prueba`
(Administrador) y `tecnico_prueba` (Técnico). Los roles Gerente, Cajero y
Asesor existen en `init_roles` pero no tienen cuenta de prueba. Créalas a mano
desde *Usuarios* en el panel antes de la Fase 5, o no vas a poder probar la
matriz de permisos completa.

- [ ] Base reseteada y respaldada antes de resetear
- [ ] Existen 5 cuentas de staff (Administrador, Gerente, Técnico, Cajero, Asesor)
- [ ] Existe 1 cuenta de **cliente** registrada desde `/registro`
- [ ] Catálogo mínimo cargado: 3 productos, con unidades de inventario y precios
      de venta y de renta (día / semana / mes)

---

## Fase 3. Humo de la API (30 min)

Rápido, con la app corriendo en `:8000`. Busca 500 y respuestas raras, no
detalles de negocio.

- [ ] `POST /api/auth/login/` con credenciales buenas devuelve tokens
- [ ] `POST /api/auth/login/` con credenciales malas devuelve 401 (no 500)
- [ ] Al 11º intento fallido de login desde la misma IP responde 429 (throttle `login`: 10/min)
- [ ] `GET /api/auth/me/` sin token → 401
- [ ] `GET /api/auth/me/` con token → tu usuario y su rol
- [ ] `POST /api/auth/refresh/` renueva el token
- [ ] `GET /api/equipos/` y `GET /api/config/publica/` responden sin sesión
- [ ] `GET /api/esto-no-existe/` devuelve **404 JSON**, no el `index.html` de React
- [ ] `GET /api/dashboard/metricas/` responde para admin y **403** para cliente

Mientras tanto, en el log de Django: cero *tracebacks*.

---

## Fase 4. Flujos de dinero, de punta a punta (2 h)

El corazón del día. Si algo aquí falla, no se sube. Haz cada flujo **completo**,
sin brincarte pasos, y revisa que los números cuadren al final.

### 4.1 Cotización → autorización → conversión (40 min)

- [ ] Cliente pide cotización desde la tienda pública (`/cotizacion`)
- [ ] Llega al panel en *Cotizaciones* y genera notificación
- [ ] Agregas ítems con **modalidades mezcladas** (venta + día + semana + mes)
- [ ] El PDF se genera y **no mezcla condiciones de venta con las de renta**
- [ ] "Enviar" manda el correo al cliente
- [ ] "Mandar a autorizar" genera la liga del jefe `/autorizar/:token`
- [ ] La liga abre **sin cuenta** y autorizar/rechazar funciona en ambos sentidos
- [ ] Autorización **por lote** (`/autorizar-lote/:token`) con varias cotizaciones
- [ ] Convertir a **renta** crea la renta y aparta la unidad
- [ ] Convertir a **venta** crea la venta y descuenta inventario
- [ ] Solicitar cancelación → aprobar cancelación
- [ ] Un token ya usado o vencido **no** vuelve a autorizar

### 4.2 Renta completa (35 min)

- [ ] Crear renta desde el panel, con cliente, obra y unidad
- [ ] **Entregar** con evidencia fotográfica (foto pesada, para probar la compresión)
- [ ] Registrar **depósito** y luego **abonos** parciales
- [ ] La unidad queda como *rentada* en Inventario y en el Resumen
- [ ] **Devolver** con evidencia; la unidad vuelve a *disponible*
- [ ] Renta vencida aparece en *Adeudos* y en el recordatorio del cliente
- [ ] Comprobante y ticket PDF salen bien
- [ ] Sustituir unidad y cancelar reserva funcionan
- [ ] Exportar rentas y exportar adeudos

### 4.3 Caja / POS (30 min)

- [ ] Abrir sesión de caja con monto inicial
- [ ] Venta de mostrador (producto + refacción, con y sin cliente)
- [ ] Movimiento de entrada y de salida de efectivo
- [ ] Devolución
- [ ] Cerrar sesión: el **corte cuadra** contra lo vendido y los movimientos
- [ ] Intenta abrir una segunda sesión de caja con la primera abierta, y
      también desde otro usuario al mismo tiempo. MySQL no aplica la
      restricción condicional (warning W036), así que si la validación no está
      también en el código, se abren dos y el corte se corrompe. Si se puede
      duplicar, es P0.

### 4.4 Reparaciones e inventario (20 min)

- [ ] Crear orden de reparación sobre una unidad
- [ ] Agregar ítems / refacciones a la orden
- [ ] Liga pública de seguimiento `/seguir/reparacion/:token` abre sin cuenta
- [ ] PDF público de la reparación
- [ ] Vincular la reparación a la cuenta del cliente → aparece en *Mis reparaciones*
- [ ] Escanear el QR de la unidad → `/u/:codigo` muestra la unidad correcta
- [ ] Etiqueta/QR imprime el **código** de la unidad (no el número de serie)

### 4.5 Facturación (15 min)

- [ ] Marcar una renta y una venta como *por facturar*
- [ ] Aparecen en *Por facturar* con su solicitud
- [ ] Marcar como facturada → sale de pendientes
- [ ] Reabrir → vuelve
- [ ] Resumen y export

---

## Fase 5. Roles y permisos (45 min)

Dos revisiones por rol, y la segunda es la que importa:

1. **Vista**: entra al panel y confirma qué secciones aparecen.
2. **API a mano**: con la sesión de ese rol, pega en el navegador una URL que
   **no** debería poder ver. Ocultar el botón no es seguridad.

| Rol | Debe ver | No debe ver / no debe poder |
|---|---|---|
| Administrador | Todo el negocio | Usuarios y Configuración |
| Gerente | Nivel administración | (definir y verificar) |
| Técnico | Jornada, Inventario, Refacciones, Rentas, Reparaciones | Montos, Resumen, Ventas, Cotizaciones, Por facturar, Usuarios, Configuración |
| Cajero | Solo lectura + Caja | Alta/edición de catálogo, Usuarios, Configuración |
| Asesor | Lectura + alta | Borrar, Usuarios, Configuración |
| Cliente | Su portal | Cualquier `/dashboard` y cualquier endpoint de staff |

- [ ] Los 5 roles de staff revisados con las dos revisiones
- [ ] Un **cliente** que escribe `/dashboard` a mano es rechazado por `RequireAdmin`
- [ ] Un cliente **no puede** ver cotizaciones, rentas ni ventas de otro cliente
      (cambia el `id`/folio en la URL de `/mis-*` y confirma 403/404)

Esa última casilla es la más importante del día en términos de seguridad.

---

## Fase 6. Portal del cliente, ligas públicas y móvil (45 min)

- [ ] Registro, verificación de correo y recuperar contraseña (ciclo completo)
- [ ] Login con Google
- [ ] Onboarding / tour del primer uso, y que **no** reaparezca después
- [ ] Favoritos como invitado → al iniciar sesión se **fusionan** con la cuenta
- [ ] Mis cotizaciones, Mis rentas, Mis compras, Mis adeudos, Mis reparaciones
- [ ] `/vincular/...` para venta, renta, cotización y reparación
- [ ] Catálogo: un modelo que se vende **y** se renta muestra ambas opciones, y
      "Precio por" aparece solo en renta
- [ ] Disponible / Agotado según unidades reales
- [ ] Modo oscuro en todas las pantallas anteriores
- [ ] **Móvil (375 px)**: ficha técnica, carta de cotización y dock de tienda
- [ ] Ninguna pantalla hace scroll horizontal

---

## Fase 7. Correo, tiempo real y cron (30 min)

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py send_test_email tu-correo@ejemplo.com
```

- [ ] Llega el correo de prueba y **no** cae en spam
- [ ] Con dos navegadores abiertos, una acción en uno se refleja en el otro
      (latido / WebSocket)
- [ ] Notificaciones: marcar leída, eliminar y limpiar todas, en admin y en cliente

Los tres comandos del cron, a mano:

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py procesar_rentas && ../env/bin/python manage.py recordar_reparaciones && ../env/bin/python manage.py respaldar_bd --local
```

- [ ] Los tres corren sin error
- [ ] Revisar: `railway.cron.json` corre `procesar_rentas`,
      `recordar_reparaciones` y `respaldar_bd`, pero **no**
      `recordar_vigencia` (cotizaciones). Si los recordatorios de vigencia
      deben salir, ese comando falta en el cron.

---

## Fase 8. Modo producción, en local (30 min)

Antes de subir, corre la app como corre en Railway. Ojo con la trampa:
`settings.py` carga `.env.dev` con `override=True`, así que poner `DEBUG=False`
en la línea de comandos no sirve, porque el archivo lo pisa. Renombra `.env.dev`
temporalmente:

```bash
cd /Users/ramses/Developer/Remali/backend && mv .env.dev .env.dev.off && DEBUG=False ../env/bin/python manage.py check --deploy; mv .env.dev.off .env.dev
```

- [ ] `check --deploy` con `DEBUG=False` sale **sin warnings de seguridad**
      (HSTS, SSL redirect, cookies seguras se activan solas cuando `DEBUG=False`)
- [ ] `SECRET_KEY` real, no la `django-insecure-...` del código
- [ ] `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS` limitados a tus dominios
- [ ] No hay secretos commiteados; claves expuestas alguna vez ya rotadas
- [ ] `npm run build` y sirves el `dist` real (no el dev server)

Y lo administrativo, que es lo que más deploys rompe:

- [ ] **Commitear**. Hoy hay ~144 archivos sin commitear (migraciones nuevas,
      `caja_views.py`, rutas nuevas del front, señales). Railway despliega desde
      git: lo que no esté commiteado, no se sube, y el deploy va a fallar por
      migraciones o imports faltantes.

---

## Fase 9. Deploy y humo en Railway (45 min)

Sigue la sección 3 de `04-PREPRODUCCION-CHECKLIST.md` para las variables de
entorno (web y cron), y luego prueba **en el dominio real**:

- [ ] El servicio web arranca; el servicio cron arranca
- [ ] Dominio y HTTPS funcionan; `http://` redirige a `https://`
- [ ] Migraciones aplicadas en la base de producción
- [ ] Archivos estáticos y las imágenes de Cloudinary cargan
- [ ] `check_redis --strict` pasa **en producción**
- [ ] Login normal y login con Google
- [ ] Correo de prueba sale desde producción
- [ ] **Una cotización, una renta y una venta reales**, de punta a punta
- [ ] Un PDF público y una liga de autorización abiertos **desde el celular, con
      datos móviles** (no wifi de la oficina)
- [ ] Respaldo generado en producción y **descargado** a otro lado
- [ ] Logs del web y del cron sin *tracebacks*

---

## Fase 10. Go / No-Go

**GO** si todo lo anterior está en verde y no queda ningún P0.

**NO-GO** si pasa cualquiera de estas:

- No probaste una restauración real de respaldo
- Se pueden abrir dos sesiones de caja a la vez (Fase 4.3)
- Un cliente puede ver datos de otro cliente (Fase 5)
- `check_redis --strict` falla en producción
- El cron no existe o no corre
- Hay secretos expuestos sin rotar
- El flujo cotización → renta/venta no pasó completo en el dominio real

Antes de abrir a clientes reales: borra las cuentas de prueba.

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py crear_usuarios_prueba --borrar
```

---

## Bitácora de hallazgos

| # | Fase | Qué pasó | Sev | Estado |
|---|------|----------|-----|--------|
| 1 | 0 | `SesionCaja` W036: MySQL ignora el unique condicional; validar en código | P0 si se reproduce | Por probar (4.3) |
| 2 | 2 | No hay cuentas de prueba para Gerente, Cajero ni Asesor | P1 | Crear a mano |
| 3 | 7 | `recordar_vigencia` no está en `railway.cron.json` | Por confirmar | Revisar |
| 4 | 8 | ~144 archivos sin commitear | P0 para deploy | Pendiente |
| 5 | - | `DashboardLayout.jsx` + `scenes/*` es plantilla muerta y sigue en el bundle | P2 | Backlog |
| 6 | 0 | Falta migración: `PerfilUsuario.codigo_seguridad`, `codigo_intentos` y `codigo_bloqueado_hasta` están en el modelo pero no en la BD (`makemigrations` pide la 0047). Cualquier consulta que toque esas columnas revienta con `OperationalError 1054` | P0 para deploy | Pendiente |
| 7 | - | Avatares: fotos viejas apuntan a Cloudinary pero el archivo solo existe en `backend/media/` → 404 | P1 | UI arreglada; falta migrar los archivos |
| 8 | - | La sección "Perfil" del menú de usuario renderiza una página vacía (`SECTION_META.perfil` existe, pero no hay `section === 'perfil'` que pinte nada) | P1 | Pendiente |
| 9 | - | En local, `.env` trae credenciales de Cloudinary de **producción**: las fotos de prueba se suben al Cloudinary real | P1 | Pendiente |
| 10 | 1 | `respaldar_bd` (el comando EXACTO del cron de Railway) tronaba: Cloudinary rechazaba el `.json.gz` con "Invalid image file". **No había ni un respaldo** | P0 | Arreglado: escribe a `BACKUP_LOCAL_DIR`; falta montar el volumen en Railway |
| 11 | 1 | La restauración fallaba por 3 causas distintas: sellos del latido, señales que no respetaban `raw` de `loaddata`, y filas sembradas por migraciones (Caja principal) | P0 | Arreglado y verificado (ciclo completo, 13 modelos idénticos) |
| 12 | 1 | Sin política de retención: nada borraba respaldos viejos | P1 | Arreglado: conserva 30, `--retener N` |
| 13 | 5 | `/admin/` de Django no tenía freno de fuerza bruta (los throttles de DRF no lo cubren) | P1 | Arreglado: `server/admin_bruteforce.py`, 10 fallos / 15 min |
| 14 | 1 | El rate limit depende de Redis: con LocMemCache cada worker lleva su propia cuenta y el techo se multiplica por N | P1 | Verificar en prod |
| 15 | - | El avatar y la imagen del equipo no validaban peso ni tipo (los demás puntos de subida sí) | P1 | Arreglado: usan `validacion_archivos.validar_imagen` |
| 16 | - | CVEs: Django 5.2.9 (14), `pyjwt`, `pillow`, `cryptography`, `urllib3`, `requests`, `idna`, `filelock`, `python-dotenv` | P1 | Arreglado: actualizadas y fijadas |
| 17 | - | La key de Google Maps es `VITE_*`: viaja al bundle por diseño. Necesita restricción por referrer y por API en Google Cloud | P2 | Pendiente (es en la consola de Google) |
| 18 | - | Avatar del dueño: `_rol_de_usuario` usaba el grupo y `rol_de` el nivel, así que el chip decía DUEÑO junto a la foto de técnico | P2 | Arreglado |
| 19 | 7 | `recordar_vigencia` no corría en el cron | P1 | **Arreglado** en `railway.cron.json` |
| 20 | - | Un respaldo fallido no avisaba a nadie | P1 | Arreglado: notificación en el panel + salida con error |
