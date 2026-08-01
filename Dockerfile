# Build frontend
FROM node:20-alpine as frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Build backend
FROM python:3.11-slim

# Esto instala lo que MySQL necesita para no dar error
RUN apt-get update && apt-get install -y \
    pkg-config \
    default-libmysqlclient-dev \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos las librerías desde tu carpeta backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos todo tu código
COPY . .

# Copiamos el build del frontend
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Entramos a la carpeta de Django para ejecutarlo
WORKDIR /app/backend

# Creamos los archivos estáticos.
#
# --skip-checks es obligatorio aquí, no un adorno: los checks de Django con MySQL
# se conectan a la base para deducir tipos de columna, y esto corre en tiempo de
# BUILD, cuando la red privada de Railway (*.railway.internal) todavía no existe.
# Sin esto el build muere con "Unknown server host 'mysql.railway.internal'".
# collectstatic en sí no necesita la base para nada.
RUN python manage.py collectstatic --noinput --skip-checks

# Arrancamos el servidor.
#
# gunicorn por defecto levanta UN worker síncrono: una petición a la vez, y
# cualquier operación lenta (subir imagen, mandar correo) congela el sitio para
# todos. Con gthread cada worker atiende varias peticiones a la vez.
#
# WEB_CONCURRENCY y WEB_THREADS se pueden ajustar por variable de entorno sin
# reconstruir la imagen: si el plan tiene poca RAM, baja WEB_CONCURRENCY a 1.
# El migrate NO tumba el arranque si falla. Antes iba con `&&`: si la base no
# respondía, gunicorn nunca arrancaba y el dominio no mostraba absolutamente
# nada. La página de "en construcción" está hecha para funcionar sin base, así
# que es mejor servir algo y dejar el error a la vista en los logs que dejar el
# sitio caído. Cuando se apague el modo construcción, una base rota se nota de
# inmediato porque todo responde error.
# ASGI (uvicorn) en vez de gunicorn WSGI: sirve HTTP *y* WebSockets (Channels),
# necesarios para las notificaciones en tiempo real. WEB_CONCURRENCY sigue
# controlando el número de procesos. Nota Railway: para que un push cruce entre
# procesos, añade un servicio Redis y define REDIS_URL; sin él cada proceso solo
# empuja a los clientes conectados a él (no tumba nada, solo no comparte).
CMD ["sh", "-c", "python manage.py migrate --skip-checks || echo '>>> AVISO: migrate falló (¿base no disponible?). Arranco igual: la página de construcción no necesita base.'; PYTHONPATH=. uvicorn server.asgi:application \
  --host 0.0.0.0 --port ${PORT:-8080} \
  --workers ${WEB_CONCURRENCY:-2}"]