from django.urls import path

from . import views

urlpatterns = [
    path('clientes/', views.clientes, name='clientes-lista'),
    path('clientes/buscar/', views.buscar, name='clientes-buscar'),
    path('clientes/sin-vincular/', views.sin_vincular, name='clientes-sin-vincular'),
    path('clientes/catalogo/', views.catalogo, name='clientes-catalogo'),
    path('clientes/<int:pk>/', views.cliente_detalle, name='clientes-detalle'),
    path('clientes/<int:pk>/estado-cuenta/', views.estado_cuenta, name='clientes-estado-cuenta'),
    path('clientes/<int:pk>/vincular/', views.vincular_contacto, name='clientes-vincular'),
    path('clientes/<int:pk>/fusionar/', views.fusionar, name='clientes-fusionar'),
    path('clientes/<int:pk>/contactos/', views.contactos, name='clientes-contactos'),
    path('clientes/<int:pk>/documentos/', views.documentos, name='clientes-documentos'),
    path('clientes/documentos/<int:pk>/', views.documento_borrar, name='clientes-documento-borrar'),
    path('clientes/contactos/<int:pk>/', views.contacto_detalle, name='clientes-contacto-detalle'),
]
