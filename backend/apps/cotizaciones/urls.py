from django.urls import path

from . import views, views_borrador

urlpatterns = [
    # ── El taller privado del cliente. REMALI no ve nada de aquí. ──
    # El invitado se identifica con el encabezado X-Espacio, no con la URL.
    path('borradores/', views_borrador.borradores),
    path('borradores/<int:pk>/', views_borrador.borrador_detalle),
    path('borradores/<int:pk>/duplicar/', views_borrador.borrador_duplicar),
    path('borradores/<int:pk>/enviar/', views_borrador.borrador_enviar),
    path('autorizaciones/', views_borrador.autorizaciones),
    path('autorizaciones/<int:pk>/', views_borrador.autorizacion_retirar),
    path('espacio/reclamar/', views_borrador.reclamar_espacio),
    # Público (sin cuenta): la liga de quien autoriza. Sirve para 1 y para N.
    path('autorizacion/<str:token>/', views_borrador.autorizacion),

    # Público: la tienda envía la solicitud del cliente (secure-by-default lo cubre con AllowAny explícito).
    path('tienda/cotizacion/', views.crear_cotizacion_publica),
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
    path('cotizaciones/<int:pk>/items/', views.cotizacion_agregar_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/', views.cotizacion_item),
    path('cotizaciones/<int:pk>/items/<int:item_id>/modalidad/', views.cotizacion_item_modalidad),
    path('cotizaciones/<int:pk>/fotos/', views.cotizacion_fotos),
    path('cotizaciones/<int:pk>/fotos/<int:foto_id>/', views.cotizacion_foto_eliminar),
    path('cotizaciones/<int:pk>/pdf/', views.cotizacion_pdf),
    path('cotizaciones/<int:pk>/enviar/', views.cotizacion_enviar),
    path('cotizaciones/<int:pk>/convertir/', views.convertir_cotizacion),
    path('cotizaciones/<int:pk>/atender/', views.atender_cotizacion),
]
