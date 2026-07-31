from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views, views_usuarios

urlpatterns = [
    # Equipos (catálogo)
    path('equipos/', views.EquipoListCreate.as_view()),
    path('equipos/<int:pk>/', views.EquipoRetrieveUpdateDestroy.as_view()),
    path('equipos/<int:pk>/imagenes/', views.upload_product_images),

    # Catálogos
    path('categorias/', views.CategoriaList.as_view()),
    path('categorias/<int:pk>/', views.CategoriaDetail.as_view()),
    path('tipos/', views.TipoList.as_view()),
    path('tipos/<int:pk>/', views.TipoDetail.as_view()),
    path('marcas/', views.MarcaList.as_view()),
    path('marcas/<int:pk>/', views.MarcaDetail.as_view()),

    # Cupones
    # Configuración del sitio (WhatsApp, negocio, correos de aviso)
    path('config/publica/', views.configuracion_publica),                 # público (tienda)
    path('config/', views.ConfiguracionDetail.as_view()),                 # admin
    path('config/correos/verificar/', views.verificar_correo_aviso),      # público (link del correo)
    path('config/correos/', views.CorreosAvisoList.as_view()),
    path('config/correos/<int:pk>/', views.correo_aviso_eliminar),
    path('config/correos/<int:pk>/reenviar/', views.correo_aviso_reenviar),
    path('cupones/', views.CuponListCreate.as_view()),
    path('cupones/<int:pk>/', views.CuponRetrieveUpdateDestroy.as_view()),
    path('cupones/aplicar/', views.apply_coupon),

    # Autenticación / perfil
    path('auth/token/', TokenObtainPairView.as_view()),
    path('auth/refresh/', TokenRefreshView.as_view()),
    path('auth/login/', views.login),
    path('auth/registro/', views.registro),
    path('auth/google/', views.google_login),
    path('auth/me/', views.me),
    path('auth/perfil/', views.PerfilDetail.as_view()),
    path('auth/password/', views.cambiar_password),
    path('auth/verificar-correo/<str:token>/', views.verificar_correo_usuario),  # público (link del correo)
    path('auth/reenviar-verificacion/', views.reenviar_verificacion),
    # Obras guardadas del cliente (para reusar al cotizar)
    path('obras-cliente/', views.ObrasClienteList.as_view()),
    path('obras-cliente/<int:pk>/', views.ObraClienteDetail.as_view()),
    # Búsqueda de cuentas de cliente (para vincular una renta a su panel)
    path('clientes-lookup/', views.clientes_lookup),
    path('usuarios/', views_usuarios.usuarios),
    path('usuarios/roles/', views_usuarios.roles_disponibles),
    path('usuarios/<int:pk>/', views_usuarios.usuario_detalle),

    # Notificaciones
    path('notificaciones/', views.NotificacionesList.as_view()),
    path('notificaciones/<int:pk>/leer/', views.marcar_notificacion_leida),
    path('notificaciones/leer-todas/', views.marcar_todas_leidas),

    path('mensajeria/contacto/', views.crear_contacto_soporte),
    path('mensajeria/conversaciones/', views.ConversacionesSoporteList.as_view()),
    path('mensajeria/conversaciones/<int:pk>/', views.ConversacionSoporteDetail.as_view()),
    path('mensajeria/conversaciones/<int:pk>/responder/', views.responder_soporte),
    path('mensajeria/conversaciones/<int:pk>/cerrar/', views.cerrar_conversacion_soporte),
    path('mensajeria/conversaciones/<int:pk>/abrir/', views.abrir_conversacion_soporte),

    # Dashboard
    path('dashboard/metricas/', views.dashboard_metrics),
]
