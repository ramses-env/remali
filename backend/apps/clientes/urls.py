from django.urls import path

from . import views

urlpatterns = [
    path('clientes/', views.clientes, name='clientes-lista'),
    path('clientes/buscar/', views.buscar, name='clientes-buscar'),
    path('clientes/catalogo/', views.catalogo, name='clientes-catalogo'),
    path('clientes/<int:pk>/', views.cliente_detalle, name='clientes-detalle'),
    path('clientes/<int:pk>/contactos/', views.contactos, name='clientes-contactos'),
    path('clientes/contactos/<int:pk>/', views.contacto_detalle, name='clientes-contacto-detalle'),
]
