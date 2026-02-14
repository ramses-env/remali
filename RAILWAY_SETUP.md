# Configuración para Desplegar en Railway

Este proyecto está configurado como un monorepo con un Backend (Django) y un Frontend (React/Vite).

## 1. Configuración del Backend (Django)

Sigue estos pasos para desplegar el backend en Railway:

1. Crea un nuevo servicio en Railway desde tu repositorio de GitHub.
2. Configura el **Root Directory** del servicio a `backend`.
3. Railway detectará automáticamente el archivo `Procfile` y usará el comando de inicio:
   ```bash
   gunicorn server.wsgi --log-file -
   ```
4. Agrega las siguientes **Variables de Entorno** en la pestaña *Variables* del servicio backend:

| Variable | Valor / Descripción |
|----------|---------------------|
| `PYTHON_VERSION` | `3.12.1` (Opcional, definido en runtime.txt) |
| `SECRET_KEY` | Genera una clave segura y pégala aquí. |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `*` (o el dominio que Railway te asigne, ej: `web-production.up.railway.app`) |
| `CSRF_TRUSTED_ORIGINS` | `https://*.railway.app,https://*.up.railway.app` (ya configurado por defecto, pero puedes especificar tu dominio exacto) |
| `CORS_ALLOW_ALL_ORIGINS` | `True` (o `False` si configuras `CORS_ALLOWED_ORIGINS`) |
| `CLOUDINARY_CLOUD_NAME` | Tu Cloud Name de Cloudinary |
| `CLOUDINARY_API_KEY` | Tu API Key de Cloudinary |
| `CLOUDINARY_API_SECRET` | Tu API Secret de Cloudinary |

5. **Base de Datos (MySQL)**:
   - Crea un servicio de MySQL en Railway.
   - Railway proporcionará automáticamente las variables `MYSQL_URL`, `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` a tu servicio backend si los conectas.
   - El código ya está configurado para usar `MYSQL_URL` automáticamente.

6. **Migraciones**:
   - Una vez desplegado, ve a la pestaña *Settings* -> *Deploy* -> *Build Command* y asegúrate de que sea:
     ```bash
     pip install -r requirements.txt && python manage.py collectstatic --noinput && python manage.py migrate
     ```
   - O puedes ejecutar las migraciones manualmente usando la CLI de Railway o conectándote a la base de datos.
   - Nota: Railway a veces ejecuta `collectstatic` automáticamente. Si es así, solo necesitas `python manage.py migrate`.

## 2. Configuración del Frontend (React/Vite)

1. Crea otro servicio en Railway desde el mismo repositorio.
2. Configura el **Root Directory** a `frontend`.
3. Railway detectará que es un proyecto Vite y usará:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run preview` (o servirá la carpeta `dist` estáticamente si eliges "Static Site").
4. Agrega las siguientes **Variables de Entorno**:

| Variable | Valor |
|----------|-------|
| `VITE_API_URL` | La URL de tu servicio backend desplegado (ej: `https://backend-production.up.railway.app`) |

## 3. Conexión

- Asegúrate de que el Frontend apunte a la URL correcta del Backend mediante `VITE_API_URL`.
- Si tienes problemas de CORS, verifica que `CORS_ALLOW_ALL_ORIGINS` esté en `True` en el backend, o configura `CORS_ALLOWED_ORIGINS` con la URL de tu frontend.
