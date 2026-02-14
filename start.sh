#!/bin/bash

# --------------------------
# ARRANCAR BACKEND DJANGO
# --------------------------
echo "Iniciando backend Django..."
cd backend
# Instalar dependencias si es necesario
pip install -r requirements.txt
# Aplicar migraciones
python manage.py migrate
# Iniciar servidor Django en todas las IPs y puerto 8000
python manage.py runserver 0.0.0.0:8000 &
cd ..

# --------------------------
# ARRANCAR FRONTEND REACT
# --------------------------
echo "Iniciando frontend React..."
cd frontend
# Instalar dependencias si es necesario
npm install
# Iniciar React en modo desarrollo
npm start