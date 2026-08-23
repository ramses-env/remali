from django.urls import path

from . import views

urlpatterns = [
    path('facturacion/solicitudes/', views.listar_solicitudes),
    path('facturacion/resumen/', views.resumen),
    path('facturacion/export/', views.exportar_csv),
    path('facturacion/solicitudes/<int:pk>/', views.actualizar_solicitud),
    path('facturacion/solicitudes/<int:pk>/facturada/', views.marcar_facturada),
    path('facturacion/solicitudes/<int:pk>/reabrir/', views.reabrir_solicitud),
    path('facturacion/solicitudes/<int:pk>/factura/', views.subir_factura),
]
