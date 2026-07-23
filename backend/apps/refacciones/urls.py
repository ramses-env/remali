from django.urls import path
from . import views

urlpatterns = [
    path('refacciones/', views.RefaccionListCreate.as_view(), name='refacciones-list'),
    path('refacciones/buscar/', views.buscar_por_codigo, name='refacciones-buscar'),
    path('refacciones/<int:pk>/', views.RefaccionDetail.as_view(), name='refacciones-detail'),
]
