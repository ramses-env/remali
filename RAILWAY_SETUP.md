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
