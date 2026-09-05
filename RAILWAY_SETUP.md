# Desplegar REMALI en Railway

Un solo servicio sirve el backend **y** el frontend: el `Dockerfile` de la raíz
construye el front con Vite, lo copia dentro y arranca Django por ASGI (uvicorn),
que atiende HTTP y los WebSockets de las notificaciones.

> El `nixpacks.toml` y el `Procfile` que mencionaban las versiones viejas de este
> documento ya no existen: todo pasa por el `Dockerfile`.

Servicios en el proyecto de Railway:

| Servicio | Para qué | ¿Obligatorio? |
|---|---|---|
| `remali` | La aplicación. Imagen del `Dockerfile`. | Sí |
| `MySQL` | La base. Railway conecta `MYSQL_URL` solo. | Sí |
| `Redis` | Caché y capa de WebSockets **compartida entre workers**. | Sí con más de un worker (ver abajo) |
| `cron` | Respaldos y recordatorios diarios. Misma imagen, `railway.cron.json`. | Sí, si quieres respaldos |

---

## Antes de abrir al público: la revisión de despegue

```bash
railway run python manage.py revisar_produccion
```

Corre **dentro** del entorno real y revisa DEBUG, `SECRET_KEY`, los hosts, la
base, las migraciones, las cuentas de prueba, Cloudinary, el correo, los
estáticos, Redis, HTTPS y el CSP. Nunca imprime el valor de una variable —solo
si está o no—, así que la salida se puede pegar en un chat sin filtrar nada.

Sale con código 1 si encuentra algo que impida salir a producción. Mientras diga
`BLOQUEA`, no abras.

---

## Las tres que más muerden

**`ALLOWED_HOSTS` no se pone en `*`.** Con `*`, cualquiera puede mandar un `Host:`
falso y envenenar los enlaces de "restablecer contraseña" que salen por correo.
`settings.py` ya trae `remali.mx`, `www.remali.mx` y `localhost` por defecto: si
el dominio no cambia, no hace falta definir la variable.

**`FRONTEND_URL` y `BACKEND_URL` sí hay que definirlas.** Su valor por defecto es
`https://remali.up.railway.app`, un dominio que este proyecto ya no tiene (hoy
sirve en `remali.mx`). Ahí van los enlaces de verificar correo, restablecer
contraseña y los QR de las máquinas: si apuntan a un dominio muerto, el cliente
recibe un correo con una liga que no abre. Pon las dos en `https://remali.mx`.

**`token_blacklist` tiene que estar migrada.** Sin sus tablas, emitir el JWT
truena y el login lo devuelve como "credenciales inválidas" —con la contraseña
correcta—. El `migrate` del arranque la aplica; si alguna vez NADIE puede entrar,
esto es lo primero que hay que mirar.

---

## Variables de entorno

La lista completa y comentada está en [`backend/.env.example`](backend/.env.example).
Ese archivo es la única fuente de verdad: cada variable con su para qué.

> Nunca pongas valores reales en este documento ni en ningún archivo del
> repositorio. Las credenciales van en la pestaña *Variables* de Railway (y en
> un `.env` local, que está ignorado por git). Un secreto commiteado sigue en el
> historial aunque después se borre del archivo: hay que rotarlo.

Para trabajar en local:

```bash
cp backend/.env.example backend/.env
```

Lo mínimo indispensable para que arranque en Railway:

| Variable | Para qué |
|----------|----------|
| `SECRET_KEY` | Clave de Django. Larga y aleatoria. |
| `DEBUG` | `False` en producción, siempre. |
| `MYSQL_URL` / `DATABASE_URL` | Las inyecta solo Railway al agregar el servicio MySQL. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Imágenes (solo imágenes: los respaldos de la base NO van a Cloudinary). El *secret* da control total del almacenamiento. |
| `BACKUP_LOCAL_DIR` | Dónde escribe los respaldos el cron. En Railway tiene que apuntar a un **volumen montado** (`/data/backups`); si no, se pierden en cada despliegue. |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | SMTP para los avisos. Van en el entorno, **no** en la configuración del panel (ahí quedarían en texto plano en la base). |
| `GOOGLE_CLIENT_ID` | Entrar con Google. Es público; el *client secret* no se usa en este flujo. |

`ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` y `CORS_ALLOWED_ORIGINS` se pueden dejar
vacías: `settings.py` ya incluye `remali.mx`, `www.remali.mx`, el dominio de
Railway y localhost. Lo que pongas ahí **se suma** a esa lista.

---

## Redis: prueba local primero

Para producción conviene habilitar Redis por dos motivos:

1. el cache deja de vivir por proceso y se vuelve **compartido**;
2. los WebSockets de Channels sí cruzan entre workers, que es lo que importa en Railway.

### Levantar Redis en local

Con Docker:

```bash
docker compose -f docker-compose.redis.yml up -d
```

Luego en `backend/.env.dev`:

```env
REDIS_URL=redis://127.0.0.1:6379/1
```

Reinicia Django y valida con:

```bash
cd backend
../env/bin/python manage.py check_redis --strict
```

Si todo está bien verás que cache y Channels pasan la prueba sobre Redis.

### Respaldos: el volumen NO es opcional

El respaldo se guarda en un directorio del disco, no en Cloudinary. Antes intentaba
subirlo a Cloudinary y **tronaba todos los días**: Cloudinary lo recibe por el
storage de imágenes y lo rechaza con "Invalid image file". Y aunque se arreglara
mandándolo como archivo "raw", tampoco debe ir ahí: los assets de Cloudinary se
sirven por URL pública y el volcado lleva hashes de contraseñas y datos de clientes.

En local:

```bash
cd backend && ../env/bin/python manage.py respaldar_bd
```

En Railway hace falta un **volumen**, porque el disco del contenedor se borra en
cada despliegue, justo cuando más falta haría el respaldo:

1. En el servicio **cron**: *Settings → Volumes → New Volume*, punto de montaje `/data`.
2. En ese mismo servicio, variable `BACKUP_LOCAL_DIR=/data/backups`.
3. Desplegar y revisar los logs: debe decir `Respaldo listo: /data/backups/remali-….json.gz`.

Si el destino no parece un volumen, el comando lo advierte en los logs. Y si el
respaldo falla, además de salir con error deja una notificación en el panel
(*Configuración*), para que un cron roto se note sin ir a leer logs.

Retención: conserva los 30 más recientes y poda el resto. Se ajusta con
`--retener N` en el start command del cron.

**Copia fuera de Railway.** Un volumen en el mismo proveedor no protege contra
perder la cuenta. Bájate un respaldo a mano de vez en cuando, o manda una copia a
otro lado. Mínimo: una vez al mes, y probar que restaura.

### Pasarlo luego a Railway

1. Agrega un servicio **Redis** en Railway.
2. Copia su URL a la variable `REDIS_URL` del servicio web.
3. Pon la misma `REDIS_URL` también en el servicio cron.
4. Despliega y valida otra vez con:

```bash
python manage.py check_redis --strict
```

---

## Dominio propio (remali.mx)

1. Railway → servicio web → **Settings → Networking → Custom Domain** → `remali.mx`.
2. Railway devuelve un destino DNS. En **Cloudflare** crea el registro que indique
   **con la nube gris (DNS only)**, no naranja: con el proxy activado desde el
   inicio, Railway no puede validar el dominio y se queda sin emitir el certificado.
3. Cuando el certificado ya esté emitido, si quieres el proxy de Cloudflare,
   actívalo y pon SSL en **Full (strict)**.
4. Agrega `https://remali.mx` a los **orígenes autorizados de JavaScript** del
   cliente OAuth en Google Cloud, o el botón de Google fallará en producción.

Al ser dominio con HTTPS real, la **cámara** para las fotos de evidencia abre
correctamente en el celular de los técnicos (por `http://` muchos navegadores
solo permiten elegir de la galería).

---

## Tarea programada (Cron): activar reservas de renta

El comando `python manage.py procesar_rentas` pasa las rentas **reservadas** a
**activas** cuando llega su fecha de inicio (y ocupa la unidad). Es **idempotente**
y seguro de correr a diario: si la unidad no está disponible, lo registra y sigue.

Debe correr **una vez al día**. En Railway se hace con un **servicio de cron aparte**
(NO se pone el `cronSchedule` en el servicio web, porque apagaría el servidor).

### Opción A: config as code (la recomendada, ya incluida)

Se incluye `railway.cron.json` en la raíz (misma imagen Docker, start command del
comando, `cronSchedule` diario a las 12:00 UTC ≈ 6:00 am CDMX, `restartPolicyType: NEVER`).

1. En tu proyecto de Railway: **New → GitHub Repo** → el mismo repositorio.
2. En ese nuevo servicio: **Settings → Config as code → Path** = `railway.cron.json`.
3. Copia las **mismas variables de entorno** del servicio web (incluida `DATABASE_URL`/`MYSQL_URL`
   usando "Add Reference" para apuntar a la misma base de datos MySQL).
4. Deploy. Railway lo ejecutará a diario; el servicio arranca, corre el comando y termina.

### Opción B: solo el panel, sin archivo

1. **New → GitHub Repo** (mismo repo) o **Empty Service** con la misma imagen.
2. **Settings → Deploy → Custom Start Command**: `python manage.py procesar_rentas`
3. **Settings → Cron Schedule**: `0 12 * * *`  (diario, 12:00 UTC)
4. **Settings → Restart Policy**: `Never`.
5. Mismas variables de entorno + referencia a la base de datos.

### Horario

`0 12 * * *` = todos los días a las **12:00 UTC** (≈ 6:00 am hora CDMX, UTC-6).
Cámbialo si prefieres otra hora (formato cron estándar, en UTC).

### Alternativa: servidor propio / VPS (crontab)

Si no fuera Railway sino una VM, en la crontab del sistema:

```cron
# Activar reservas de renta, diario 6:00 am
0 6 * * * cd /ruta/al/repo/backend && /ruta/al/venv/bin/python manage.py procesar_rentas >> /var/log/remali_cron.log 2>&1
```

### Verificar que funcionó

Revisa los **Deploy Logs** del servicio cron: verás algo como
`N reserva(s) activada(s) de M pendiente(s).`
