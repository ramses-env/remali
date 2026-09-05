from django.urls import path
from . import views

urlpatterns = [
    path('unidades/', views.UnidadesGlobal.as_view()),
    path('equipos/<int:equipo_id>/unidades/', views.UnidadesPorEquipo.as_view()),
    path('equipos/<int:equipo_id>/unidades/proximo-codigo/', views.proximo_codigo_unidad),
    path('equipos/<int:equipo_id>/inventario-resumen/', views.resumen_inventario),
    path('unidades/qr/<str:codigo>/', views.unidad_qr),
    path('unidades/<int:pk>/', views.UnidadDetail.as_view()),
    path('unidades/<int:pk>/vender/', views.vender_unidad),
    path('unidades/<int:pk>/mantenimiento/', views.mantenimiento_unidad),
    path('reparaciones/', views.OrdenReparacionListCreate.as_view()),
    path('reparaciones/mias/', views.reparaciones_mias),
    path('reparaciones/mias/<int:pk>/pdf/', views.orden_reparacion_pdf_mia),
    path('reparaciones/<int:pk>/', views.OrdenReparacionDetail.as_view()),
    path('reparaciones/<int:pk>/pdf/', views.orden_reparacion_pdf),
    path('reparaciones/<int:pk>/items/', views.orden_agregar_item),
    path('reparaciones/<int:pk>/items/<int:item_id>/', views.orden_eliminar_item),
    path('reparaciones/<int:pk>/vinculo/', views.generar_vinculo_orden),
    path('vinculo/reparacion/<str:token>/', views.vinculo_orden),
    path('seguir/reparacion/<str:token>/', views.seguimiento_orden),
    path('seguir/reparacion/<str:token>/pdf/', views.orden_reparacion_pdf_publico),
]
