# Configuración para Desplegar en Railway

Este proyecto se puede desplegar de dos formas:
1. **Opción Recomendada (Todo en Uno)**: Un solo servicio que ejecuta Backend y sirve el Frontend.
2. **Opción Avanzada (Separados)**: Dos servicios (Backend y Frontend separados).

---

## Opción 1: Despliegue Todo en Uno (Más fácil y barato)

Hemos configurado el archivo `nixpacks.toml` en la raíz para que Railway instale Python y Node.js automáticamente.

### Pasos:
1. Crea un **Nuevo Proyecto** en Railway desde GitHub.
2. Selecciona este repositorio.
3. Configura las **Variables de Entorno** (Tab *Variables*):

| Variable | Valor / Descripción |
|----------|---------------------|
| `SECRET_KEY` | Tu clave secreta de Django. |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `*` |
| `DATABASE_URL` o `MYSQL_URL` | Se configuran solas si agregas un servicio de MySQL. |
| `CLOUDINARY_...` | Tus claves de Cloudinary (ver abajo). |

4. **Base de Datos**: Agrega un servicio de MySQL (Add Service -> Database -> MySQL) y espera a que se despliegue. Railway conectará automáticamente las variables.

**Nota**: No necesitas configurar `start.sh` ni comandos de inicio. El archivo `nixpacks.toml` se encarga de todo.

---

## Opción 2: Despliegue Separado (Frontend y Backend aislados)

### 1. Backend (Django)
1. Crea un servicio con **Root Directory**: `backend`.
2. Variables: Las mismas de arriba.

### 2. Frontend (React)
1. Crea un servicio con **Root Directory**: `frontend`.
2. Variables: `VITE_API_URL` = URL de tu backend.

---

## Variables de Entorno

**La lista completa y comentada está en [`backend/.env.example`](backend/.env.example).**
Ese archivo es la única fuente de verdad: cada variable con su para qué.

> ⚠️ **Nunca pongas valores reales en este documento ni en ningún archivo del
> repositorio.** Las credenciales van en la pestaña *Variables* de Railway (y en
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
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Imágenes y respaldos. El *secret* da control total del almacenamiento. |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | SMTP para los avisos. Van en el entorno, **no** en la configuración del panel (ahí quedarían en texto plano en la base). |
| `GOOGLE_CLIENT_ID` | Entrar con Google. Es público; el *client secret* no se usa en este flujo. |

`ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` y `CORS_ALLOWED_ORIGINS` se pueden dejar
vacías: `settings.py` ya incluye `remali.mx`, `www.remali.mx`, el dominio de
Railway y localhost. Lo que pongas ahí **se suma** a esa lista.

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

### Opción A — Config as code (recomendada, ya incluida)

Se incluye `railway.cron.json` en la raíz (misma imagen Docker, start command del
comando, `cronSchedule` diario a las 12:00 UTC ≈ 6:00 am CDMX, `restartPolicyType: NEVER`).

1. En tu proyecto de Railway: **New → GitHub Repo** → el mismo repositorio.
2. En ese nuevo servicio: **Settings → Config as code → Path** = `railway.cron.json`.
3. Copia las **mismas variables de entorno** del servicio web (incluida `DATABASE_URL`/`MYSQL_URL`
   — usa "Add Reference" para apuntar a la misma base de datos MySQL).
4. Deploy. Railway lo ejecutará a diario; el servicio arranca, corre el comando y termina.

### Opción B — Solo el panel (sin archivo)

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
