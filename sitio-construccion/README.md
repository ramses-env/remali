# Sitio en construcción — versión estática

`index.html` es una copia **generada** de la página que sirve el backend
(`backend/templates/construccion.html` + `backend/server/construccion.py`).

## Para qué existe

Es un solo archivo autocontenido (CSS en línea, sin imágenes ni JavaScript), así
que se puede publicar en cualquier hosting de archivos —Cloudflare Pages, Netlify,
un bucket— **sin Django, sin base de datos y sin servidor**. Sirve para tener el
dominio con algo presentable mientras el despliegue real no está listo.

## Cuál es la fuente de verdad

La plantilla del backend. Este archivo es una foto de ella: si cambias textos,
teléfono o dirección, cámbialos **allá** y vuelve a generar esta copia:

```bash
cd backend
MODO_CONSTRUCCION=True ../env/bin/python -c "
import os, django, pathlib
os.environ.setdefault('DJANGO_SETTINGS_MODULE','server.settings'); django.setup()
from django.conf import settings; settings.ALLOWED_HOSTS=['*']
from django.test import Client
pathlib.Path('../sitio-construccion/index.html').write_text(Client().get('/').content.decode())
"
```

## Cuando el sitio real esté listo

Esta carpeta deja de usarse. En el backend basta con poner `MODO_CONSTRUCCION=False`
y volver a desplegar.
