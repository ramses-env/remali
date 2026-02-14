FROM python:3.11-slim

# 1. Variables de entorno
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# 2. INSTALAR DEPENDENCIAS DEL SISTEMA (Esto arregla tu error de mysqlclient)
RUN apt-get update && apt-get install -y \
    pkg-config \
    default-libmysqlclient-dev \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 3. Instalar dependencias de Python
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copiar el resto del código
COPY . .

# 5. Entrar a la carpeta de Django
WORKDIR /app/backend

# 6. Recolectar estáticos (Arregla el primer error que tuviste)
RUN python manage.py collectstatic --noinput

# 7. Comando de arranque
# Usamos el puerto dinámico de Railway
CMD ["sh", "-c", "python manage.py migrate && PYTHONPATH=. gunicorn server.wsgi:application --bind 0.0.0.0:${PORT:-8080}"]