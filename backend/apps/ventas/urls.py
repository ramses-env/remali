from django.urls import path
from . import views

urlpatterns = [
    path('ventas/lista/', views.listar_ventas, name='ventas-lista'),
    path('ventas/mostrador/', views.venta_mostrador, name='ventas-mostrador'),
    path('ventas/<int:pk>/cancelar/', views.cancelar_venta, name='ventas-cancelar'),
    path('ventas/<int:pk>/comprobante/', views.comprobante_venta, name='ventas-comprobante'),
    path('ventas/<int:pk>/ticket/', views.ticket_venta, name='ventas-ticket'),
]
