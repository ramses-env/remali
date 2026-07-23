from django.urls import path

from . import views

urlpatterns = [
    path('address/search/', views.address_search),
]
