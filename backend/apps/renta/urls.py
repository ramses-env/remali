from django.urls import path
from . import views

urlpatterns = [
    path('rentas/', views.listar_rentas, name='listar_rentas'),
    path('rentas/crear/', views.crear_renta, name='crear_renta'),
    path('rentas/mias/', views.rentas_mias, name='rentas_mias'),   # cliente: sus rentas
    path('rentas/<int:pk>/entregar/', views.confirmar_entrega, name='confirmar_entrega'),
    path('rentas/<int:pk>/devolver/', views.devolver_renta, name='devolver_renta'),
    path('rentas/<int:pk>/cancelar/', views.cancelar_renta, name='cancelar_renta'),
    path('rentas/<int:pk>/comprobante/', views.comprobante_renta, name='comprobante_renta'),
    path('rentas/<int:pk>/ticket/', views.ticket_renta, name='ticket_renta'),
    path('rentas/<int:pk>/vincular/', views.vincular_cuenta, name='vincular_cuenta'),
    path('rentas/alertas/', views.alertas_renta, name='alertas_renta'),
    path('rentas/tareas/', views.mis_tareas, name='mis_tareas'),
    path('rentas/<int:pk>/evidencias/', views.evidencias_renta, name='evidencias_renta'),
    path('rentas/<int:pk>/evidencias/<int:evidencia_id>/', views.evidencia_renta_eliminar, name='evidencia_renta_eliminar'),
]
