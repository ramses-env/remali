# Checklist de Preproduccion

Este documento es la guia corta para decidir si REMALI ya esta listo para salir a produccion en Railway con datos reales de clientes.

## 1. Criterio de salida

No subir a produccion hasta que todo esto este en verde:

- [ ] `../env/bin/python manage.py check` no reporta errores
- [ ] `../env/bin/python manage.py check_redis --strict` pasa con Redis activo
- [ ] `../env/bin/python manage.py respaldar_bd --local` genera respaldo local
- [ ] se hizo una prueba real de restauracion en una base separada
- [ ] el servicio web arranca en Railway
- [ ] el servicio cron arranca en Railway
- [ ] el dominio y HTTPS funcionan
- [ ] login normal y login con Google funcionan
- [ ] correos de prueba funcionan
- [ ] una cotizacion, una renta y una venta de prueba funcionan de punta a punta

## 2. Pruebas locales obligatorias

### Redis local

Levantar Redis:

```bash
docker compose -f docker-compose.redis.yml up -d
```

Validar Redis en Django:

```bash
cd backend
../env/bin/python manage.py check_redis --strict
```

Apagar Redis:

```bash
docker compose -f docker-compose.redis.yml down
```

### Backup local

Generar respaldo:

```bash
cd backend
../env/bin/python manage.py respaldar_bd --local
```

Confirmar que aparezca un archivo `.json.gz` en `backups/`.

### Restauracion de prueba

La restauracion no se debe probar sobre la base real. Hazla en una base vacia o clonada:

```bash
cd backend
../env/bin/python manage.py migrate
../env/bin/python manage.py restaurar_bd ../backups/<archivo>.json.gz --si
```

Validar despues:

- [ ] usuarios cargados
- [ ] cotizaciones visibles
- [ ] rentas visibles
- [ ] ventas visibles
- [ ] catalogo visible
- [ ] permisos y grupos correctos

## 3. Variables de Railway

## Web

- [ ] `SECRET_KEY`
- [ ] `DEBUG=False`
- [ ] `MYSQL_URL` o referencia a la base MySQL de Railway
- [ ] `REDIS_URL` o referencia al servicio Redis de Railway
- [ ] `FRONTEND_URL`
- [ ] `BACKEND_URL`
- [ ] `ALLOWED_HOSTS` si hace falta algun host extra
- [ ] `CSRF_TRUSTED_ORIGINS` si hace falta algun origen extra
- [ ] `CORS_ALLOWED_ORIGINS` si hace falta algun origen extra
- [ ] `CLOUDINARY_CLOUD_NAME`
- [ ] `CLOUDINARY_API_KEY`
- [ ] `CLOUDINARY_API_SECRET`
- [ ] `EMAIL_HOST`
- [ ] `EMAIL_PORT`
- [ ] `EMAIL_HOST_USER`
- [ ] `EMAIL_HOST_PASSWORD`
- [ ] `EMAIL_USE_TLS`
- [ ] `DEFAULT_FROM_EMAIL`
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_MAPS_API_KEY` si usas Google Places
- [ ] `ESCALACION_EMAILS`

## Cron

El cron debe tener las mismas variables criticas que el servicio web:

- [ ] `MYSQL_URL`
- [ ] `REDIS_URL`
- [ ] `CLOUDINARY_*`
- [ ] `EMAIL_*`
- [ ] `DEFAULT_FROM_EMAIL`
- [ ] `FRONTEND_URL`
- [ ] `BACKEND_URL`

## 4. Seguridad minima aceptable

- [ ] no hay secretos commiteados en el repo
- [ ] claves antiguas ya fueron rotadas si alguna vez se expusieron
- [ ] `DEBUG=False` en produccion
- [ ] HTTPS activo en el dominio real
- [ ] cookies seguras en produccion
- [ ] HSTS habilitado
- [ ] redirect a HTTPS habilitado
- [ ] CORS restringido a tus dominios
- [ ] solo endpoints publicos necesarios tienen `AllowAny`
- [ ] throttling activo para login, registro y reset
- [ ] cuentas admin revisadas y sin usuarios sobrantes
- [ ] contrasenas temporales cambiadas
- [ ] accesos de exempleados o pruebas eliminados

## 5. Redis: que debe quedar cierto en produccion

Redis en este proyecto no es decorativo. Debe quedar activo para:

- cache compartido entre procesos
- rate limit consistente
- Channels / WebSockets entre workers

Verificacion:

```bash
python manage.py check_redis --strict
```

Esperado:

- [ ] `Redis esta habilitado y funcionando para cache + Channels`

## 6. Backups: politica recomendada

Minimo recomendado para una microempresa:

- [ ] respaldo logico diario con `respaldar_bd`
- [ ] servicio cron en Railway funcionando diario
- [ ] retencion minima de 7, 30 y 90 dias
- [ ] al menos una restauracion probada al mes
- [ ] respaldo del storage de evidencias o confirmacion de retencion en Cloudinary
- [ ] acceso a respaldos limitado a duenio o admin de confianza

## 7. Flujo real de salida a Railway

1. Subir cambios al repo.
2. Crear o revisar servicio MySQL en Railway.
3. Crear o revisar servicio Redis en Railway.
4. Configurar variables del servicio web.
5. Configurar variables del servicio cron.
6. Deploy del servicio web.
7. Deploy del servicio cron.
8. Probar dominio, login, correos, Redis y una operacion real.

## 8. Pruebas funcionales antes de abrir al cliente

- [ ] abrir home publica
- [ ] abrir panel admin
- [ ] login con correo y password
- [ ] login con Google
- [ ] registro de cliente
- [ ] recuperar password
- [ ] crear cotizacion
- [ ] autorizar cotizacion por link
- [ ] convertir cotizacion a renta o venta
- [ ] subir evidencia
- [ ] descargar PDF publico
- [ ] revisar notificaciones
- [ ] revisar que correos salgan

## 9. Monitoreo minimo

- [ ] revisar logs del web
- [ ] revisar logs del cron
- [ ] definir quien revisa fallas
- [ ] definir quien restaura si hay incidente
- [ ] documentar donde estan MySQL, Redis, Cloudinary, SMTP y dominio

## 10. Go / No-Go final

### GO

Puedes salir si:

- Redis ya esta validado
- backups ya generan y restauran
- cron ya corre
- dominio y HTTPS ya estan bien
- login, correo y flujo principal ya pasaron

### NO-GO

No salgas todavia si pasa cualquiera de estas:

- `check_redis --strict` falla
- no has probado una restauracion real
- el cron no existe o no corre
- hay secretos expuestos sin rotar
- el flujo de cotizacion/renta/venta no ha sido probado completo

## 11. Comandos de referencia

```bash
cd backend
../env/bin/python manage.py check
../env/bin/python manage.py check_redis --strict
../env/bin/python manage.py respaldar_bd --local
../env/bin/python manage.py migrate
../env/bin/python manage.py restaurar_bd ../backups/<archivo>.json.gz --si
```
