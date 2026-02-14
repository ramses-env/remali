# Usa Python 3.11 (o la versión que uses)
FROM python:3.11-slim

# Evita archivos basura de Python y permite ver logs
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# 1. Copiamos el requirements que está dentro de la carpeta backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. Copiamos todo el contenido del proyecto
COPY . .

# 3. Entramos a la carpeta de Django para los comandos
WORKDIR /app/backend

# 4. Recolectar estáticos (esto crea la carpeta 'staticfiles' que faltaba)
RUN python manage.py collectstatic --noinput

# 5. Comando de arranque
# Nota: Como estamos dentro de /app/backend, el PYTHONPATH ayuda a encontrar 'server'
CMD ["sh", "-c", "python manage.py migrate && PYTHONPATH=. gunicorn server.wsgi:application --bind 0.0.0.0:${PORT:-8080}"]