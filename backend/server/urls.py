"""
URL configuration for server project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.http import HttpResponseRedirect, JsonResponse
from django.template import TemplateDoesNotExist
from django.template.loader import get_template
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView, RedirectView
from django.views.static import serve


def api_404(request, resto=''):
    """Un /api/... que no matchea ningún endpoint debe dar 404 JSON, no el
    index.html del catch-all de React: si no, una URL mal escrita en el
    frontend devuelve 200 con HTML y el error queda invisible."""
    return JsonResponse({'detail': f'Endpoint no encontrado: /api/{resto}'}, status=404)

def fuera_del_api(request):
    """Todo lo que no es /api/, /admin/ ni /media/.

    Mientras Django sirvió también el SPA, aquí se devolvía su index.html. Con
    el frontend en su PROPIO servicio esa plantilla ya no viaja en esta imagen,
    y el catch-all reventaba con TemplateDoesNotExist: la raíz de api.remali.mx
    contestaba un 500 en vez de decir algo útil, y un 500 en la portada del API
    es justo lo que enciende alarmas por nada.

    Si la plantilla está —desarrollo, o un despliegue todo-en-uno— se sigue
    sirviendo igual que siempre. Si no está, quien llegó aquí buscaba el sitio:
    se le manda al sitio. Los /api/ mal escritos NO pasan por aquí; tienen su
    propio 404 en JSON, que es lo que un cliente de API sabe leer.
    """
    try:
        get_template('index.html')
    except TemplateDoesNotExist:
        return HttpResponseRedirect(getattr(settings, 'FRONTEND_URL', '') or '/')
    return TemplateView.as_view(template_name='index.html')(request)


admin.site.site_header = "Remali Administrador"
admin.site.site_title = "Remali Administrador"
admin.site.index_title = "Panel de administración"

urlpatterns = [
    path('admin', RedirectView.as_view(url='/admin/', permanent=True)),
    path('admin/', admin.site.urls),
    path('api/', include('maquinaria.urls')),
    path('api/', include('ventas.urls')),
    path('api/', include('renta.urls')),
    path('api/', include('inventario.urls')),
    path('api/', include('refacciones.urls')),
    path('api/', include('geo.urls')),
    path('api/', include('facturacion.urls')),
    path('api/', include('cotizaciones.urls')),
    path('api/', include('clientes.urls')),
    # 404 JSON para /api/ sin match — SIEMPRE después de los include de arriba.
    re_path(r'^api/(?P<resto>.*)$', api_404),
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    # Catch-all: el SPA si vive aquí, y si no, al sitio.
    re_path(r'^.*$', fuera_del_api),
]

if settings.MEDIA_URL and settings.MEDIA_ROOT:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
