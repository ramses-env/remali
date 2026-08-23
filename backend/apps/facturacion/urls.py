from django.urls import path

from . import views

urlpatterns = [
    path('facturacion/solicitudes/', views.listar_solicitudes),
    path('facturacion/mias/', views.facturas_mias),
    path('facturacion/resumen/', views.resumen),
    path('facturacion/export/', views.exportar_csv),
    path('facturacion/solicitudes/<int:pk>/', views.actualizar_solicitud),
    path('facturacion/solicitudes/<int:pk>/reabrir/', views.reabrir_solicitud),
    path('facturacion/solicitudes/<int:pk>/factura/', views.subir_factura),
    path('facturacion/facturas/<int:pk>/xml/', views.descargar_xml),
    path('facturacion/facturas/<int:pk>/pdf/', views.descargar_pdf),
    path('facturacion/facturas/<int:pk>/cancelar/', views.cancelar_factura),
    path('facturacion/facturas/<int:pk>/reenviar/', views.reenviar_factura),
]
