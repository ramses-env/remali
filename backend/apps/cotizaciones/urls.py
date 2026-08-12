from django.urls import path

from . import views

urlpatterns = [
    # Público: la tienda envía la solicitud del cliente (secure-by-default lo cubre con AllowAny explícito).
    path('tienda/cotizacion/', views.crear_cotizacion_publica),
    # Público (con sesión): manda VARIOS borradores como un lote a autorizar.
    path('tienda/cotizacion/lote/', views.crear_lote_autorizacion),
    path('cotizaciones/', views.CotizacionListCreate.as_view()),
    path('cotizaciones/stats/', views.cotizacion_stats),
    # Cliente autenticado: sus propias solicitudes ("Mis cotizaciones").
    path('cotizaciones/latido/', views.latido_cotizaciones),
    path('cotizaciones/mias/', views.cotizaciones_mias),
    # Público (sin login): el cliente abre su cotización por el token compartido.
    path('cotizaciones/publica/<str:token>/pdf/', views.cotizacion_publica_pdf),
    path('cotizaciones/<int:pk>/', views.CotizacionDetail.as_view()),
    path('cotizaciones/<int:pk>/solicitar-cancelacion/', views.solicitar_cancelacion),
    path('cotizaciones/<int:pk>/aprobar-cancelacion/', views.aprobar_cancelacion),
    path('cotizaciones/<int:pk>/vincular/', views.vincular_cuenta_cotizacion),
    path('cotizaciones/<int:pk>/vinculo/', views.generar_vinculo_cotizacion),
    path('vinculo/cotizacion/<str:token>/', views.vinculo_cotizacion),
    path('autorizacion/<str:token>/', views.autorizacion_cotizacion),
    # Público (sin login): la liga del jefe para autorizar un LOTE completo.
    path('autorizacion-lote/<str:token>/', views.autorizacion_lote),
    path('cotizaciones/<int:pk>/items/', views.cotizacion_agregar_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/', views.cotizacion_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/modalidad/', views.cotizacion_item_modalidad),
    path('cotizaciones/<int:pk>/fotos/', views.cotizacion_fotos),
    path('cotizaciones/<int:pk>/fotos/<int:foto_id>/', views.cotizacion_foto_eliminar),
    path('cotizaciones/<int:pk>/pdf/', views.cotizacion_pdf),
    path('cotizaciones/<int:pk>/enviar/', views.cotizacion_enviar),
    path('cotizaciones/<int:pk>/convertir/', views.convertir_cotizacion),
    path('cotizaciones/<int:pk>/atender/', views.atender_cotizacion),
    path('cotizaciones/<int:pk>/mandar-autorizar/', views.mandar_a_autorizar),
]
