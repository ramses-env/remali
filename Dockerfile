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

# Arrancamos el servidor
CMD ["sh", "-c", "python manage.py migrate && PYTHONPATH=. gunicorn server.wsgi:application --bind 0.0.0.0:${PORT:-8080}"]