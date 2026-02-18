from django.urls import path
from rest_framework import permissions
from . import views
try:
    from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
    _jwt_available = True
except Exception:
    _jwt_available = False

urlpatterns = [
    path('equipos/', views.EquipoListCreate.as_view()),
    path('equipos/<int:pk>/', views.EquipoRetrieveUpdateDestroy.as_view()),
    path('equipos/<int:pk>/imagenes/', views.upload_product_images),
    path('categorias/', views.CategoriaList.as_view()),
    path('tipos/', views.TipoList.as_view()),
    path('marcas/', views.MarcaList.as_view()),
    path('cupones/', views.CuponListCreate.as_view()),
    path('cupones/<int:pk>/', views.CuponRetrieveUpdateDestroy.as_view()),
    path('cupones/aplicar/', views.apply_coupon),
    path('ordenes/', views.create_order),
    *(
        [
            path('auth/token/', TokenObtainPairView.as_view(permission_classes=[permissions.AllowAny])),
            path('auth/refresh/', TokenRefreshView.as_view(permission_classes=[permissions.AllowAny])),
        ] if _jwt_available else []
    ),
    path('auth/login/', views.login),
    path('auth/verificar/<str:token>/', views.verify_email),
    path('auth/reenviar/', views.resend_verification),
    path('auth/me/', views.me),
    path('dashboard/metricas/', views.dashboard_metrics),
]
