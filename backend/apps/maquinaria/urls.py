from django.urls import path

from . import views, views_permisos, views_usuarios

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
    path('config/validar-codigo-ajuste/', views.validar_codigo_ajuste),   # verifica el PIN personal del operador
    path('auth/codigo-seguridad/', views.definir_codigo_seguridad),       # el operador fija/cambia su propio PIN
    path('config/', views.ConfiguracionDetail.as_view()),                 # admin
    path('config/correos/verificar/', views.verificar_correo_aviso),      # público (link del correo)
    path('config/correos/', views.CorreosAvisoList.as_view()),
    path('config/correos/<int:pk>/', views.correo_aviso_eliminar),
    path('config/correos/<int:pk>/reenviar/', views.correo_aviso_reenviar),
    path('cupones/', views.CuponListCreate.as_view()),
    path('cupones/<int:pk>/', views.CuponRetrieveUpdateDestroy.as_view()),
    path('cupones/aplicar/', views.apply_coupon),

    # Autenticación / perfil
    # Login flexible: acepta correo O usuario (resuelve el correo al username),
    # deja el refresh en cookie httpOnly y aplica el freno de intentos y el
    # candado de correo confirmado.
    #
    # Ya NO se expone el /auth/token/ de SimpleJWT: era una segunda puerta sin
    # freno de intentos que devolvía el refresh en el body, decía si la cuenta
    # existe ("No active account found") y se saltaba el candado del correo. Nadie
    # la usaba (el front entra por aquí); si algún día hace falta para un cliente
    # externo, que pase por esta misma vista.
    path('auth/login/', views.login),
    # Renueva el access leyendo el refresh de la cookie httpOnly (no del body).
    path('auth/refresh/', views.refrescar_token),
    path('auth/logout/', views.logout),
    path('auth/registro/', views.registro),
    path('auth/google/', views.google_login),
    path('auth/me/', views.me),
    path('auth/perfil/', views.PerfilDetail.as_view()),
    path('auth/password/', views.cambiar_password),
    # Restablecer contraseña ("olvidé mi contraseña") — todo público (sin sesión)
    path('auth/password/olvide/', views.solicitar_restablecer),
    path('auth/password/restablecer/', views.restablecer_password),
    path('auth/password/restablecer/<str:uidb64>/<str:token>/', views.verificar_token_restablecer),
    # Confirmar el correo: lo consume la página del front (/verificar/:token), que
    # con la sesión que devuelve entra sola. El GET de abajo es el puente para las
    # ligas viejas que aún apuntan al backend: solo redirige al front.
    path('auth/verificar-correo/', views.verificar_correo),
    path('auth/verificar-correo/<str:token>/', views.verificar_correo_usuario),  # público (link viejo)
    path('auth/reenviar-verificacion/', views.reenviar_verificacion),
    path('auth/reenviar-verificacion-publica/', views.reenviar_verificacion_publica),
    # Onboarding — guía interactiva de primer uso
    path('auth/onboarding/estado/', views.onboarding_estado),
    path('auth/onboarding/paso/', views.onboarding_registrar_paso),
    path('auth/onboarding/completar/', views.onboarding_completar),
    path('auth/onboarding/reiniciar/', views.onboarding_reiniciar),
    # Favoritos
    path('favoritos/', views.favoritos_listar),
    path('favoritos/toggle/', views.favoritos_toggle),
    path('favoritos/fusionar/', views.favoritos_fusionar),
    # Obras guardadas del cliente (para reusar al cotizar)
    path('obras-cliente/', views.ObrasClienteList.as_view()),
    path('obras-cliente/<int:pk>/', views.ObraClienteDetail.as_view()),
    # Búsqueda de cuentas de cliente (para vincular una renta a su panel)
    path('clientes-lookup/', views.clientes_lookup),
    path('latido/', views.latido_panel),
    path('permisos/', views_permisos.permisos),
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
    path('notificaciones/<int:pk>/eliminar/', views.eliminar_notificacion),
    path('notificaciones/leer-todas/', views.marcar_todas_leidas),
    path('notificaciones/limpiar/', views.limpiar_notificaciones),


    # Dashboard
    path('dashboard/metricas/', views.dashboard_metrics),
    path('dashboard/conteos/', views.dashboard_conteos),
]
