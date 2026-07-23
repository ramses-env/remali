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

## Variables de Entorno Comunes (Copiar y Pegar)

```env
# Django
SECRET_KEY=tu_clave_secreta_aqui
DEBUG=False
ALLOWED_HOSTS=*

# Cloudinary (Imagenes)
CLOUDINARY_CLOUD_NAME=dmfeqx8gt
CLOUDINARY_API_KEY=575199477538695
CLOUDINARY_API_SECRET=9kqfc-N_yb2qPR7IYtwbfeZEAS0
CLOUDINARY_UPLOAD_PRESET=remali-upload
```

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
