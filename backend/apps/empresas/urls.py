from django.urls import path
from . import views

urlpatterns = [
    path('empresas/', views.EmpresaListCreate.as_view()),
    path('empresas/<int:pk>/', views.EmpresaDetail.as_view()),
    path('empresas/<int:empresa_id>/obras/', views.ObrasPorEmpresa.as_view()),
    path('obras/<int:pk>/', views.ObraDetail.as_view()),
]
