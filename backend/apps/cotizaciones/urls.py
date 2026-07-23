from django.urls import path

from . import views

urlpatterns = [
    # Público: la tienda envía la solicitud del cliente (secure-by-default lo cubre con AllowAny explícito).
    path('tienda/cotizacion/', views.crear_cotizacion_publica),
    path('cotizaciones/', views.CotizacionListCreate.as_view()),
    path('cotizaciones/<int:pk>/', views.CotizacionDetail.as_view()),
    path('cotizaciones/<int:pk>/items/', views.cotizacion_agregar_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/', views.cotizacion_eliminar_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/modalidad/', views.cotizacion_item_modalidad),
    path('cotizaciones/<int:pk>/convertir/', views.convertir_cotizacion),
    path('cotizaciones/<int:pk>/atender/', views.atender_cotizacion),
]
