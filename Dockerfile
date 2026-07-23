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

# Creamos los archivos estáticos
RUN python manage.py collectstatic --noinput

# Arrancamos el servidor.
#
# gunicorn por defecto levanta UN worker síncrono: una petición a la vez, y
# cualquier operación lenta (subir imagen, mandar correo) congela el sitio para
# todos. Con gthread cada worker atiende varias peticiones a la vez.
#
# WEB_CONCURRENCY y WEB_THREADS se pueden ajustar por variable de entorno sin
# reconstruir la imagen: si el plan tiene poca RAM, baja WEB_CONCURRENCY a 1.
CMD ["sh", "-c", "python manage.py migrate && PYTHONPATH=. gunicorn server.wsgi:application \
  --bind 0.0.0.0:${PORT:-8080} \
  --worker-class gthread \
  --workers ${WEB_CONCURRENCY:-2} \
  --threads ${WEB_THREADS:-4} \
  --timeout ${WEB_TIMEOUT:-60} \
  --access-logfile - --error-logfile -"]