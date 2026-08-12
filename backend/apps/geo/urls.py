from django.urls import path

from . import views

urlpatterns = [
    # Flujo de dos pasos (recomendado): autocomplete (sugerencias en vivo) +
    # details (resolver la elegida a dirección completa).
    path('address/autocomplete/', views.address_autocomplete),
    path('address/details/', views.address_details),
    # Un solo paso (Text Search): se mantiene por compatibilidad y como respaldo.
    path('address/search/', views.address_search),
]
