from django.urls import path

from . import views

urlpatterns = [
    path('asistente/preguntar/', views.preguntar),
    path('asistente/estado/', views.estado),
]
