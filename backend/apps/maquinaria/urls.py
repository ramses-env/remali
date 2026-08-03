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
    # Restablecer contraseña ("olvidé mi contraseña") — todo público (sin sesión)
    path('auth/password/olvide/', views.solicitar_restablecer),
    path('auth/password/restablecer/', views.restablecer_password),
    path('auth/password/restablecer/<str:uidb64>/<str:token>/', views.verificar_token_restablecer),
    path('auth/verificar-correo/<str:token>/', views.verificar_correo_usuario),  # público (link del correo)
    path('auth/reenviar-verificacion/', views.reenviar_verificacion),
    path('auth/reenviar-verificacion-publica/', views.reenviar_verificacion_publica),
    # Obras guardadas del cliente (para reusar al cotizar)
    path('obras-cliente/', views.ObrasClienteList.as_view()),
    path('obras-cliente/<int:pk>/', views.ObraClienteDetail.as_view()),
    # Búsqueda de cuentas de cliente (para vincular una renta a su panel)
    path('clientes-lookup/', views.clientes_lookup),
    path('latido/', views.latido_panel),
    path('usuarios/', views_usuarios.usuarios),
    path('usuarios/roles/', views_usuarios.roles_disponibles),
    path('usuarios/<int:pk>/', views_usuarios.usuario_detalle),

    # Notificaciones
    path('notificaciones/', views.NotificacionesList.as_view()),
    path('notificaciones/mias/', views.notificaciones_mias),
    path('notificaciones/mias/leer/', views.marcar_mias_leidas),
    path('notificaciones/mias/limpiar/', views.limpiar_mias),
    path('notificaciones/mias/<int:pk>/eliminar/', views.eliminar_mia),
    path('notificaciones/<int:pk>/leer/', views.marcar_notificacion_leida),
    path('notificaciones/leer-todas/', views.marcar_todas_leidas),


    # Dashboard
    path('dashboard/metricas/', views.dashboard_metrics),
]
