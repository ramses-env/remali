from django.contrib import admin
from .models import Empresa, Obra


class ObraInline(admin.TabularInline):
    model = Obra
    extra = 1
    fields = ('nombre', 'ubicacion', 'responsable', 'telefono', 'estado')


@admin.register(Empresa)
class EmpresaAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'contacto', 'telefono', 'activa', 'creada')
    search_fields = ('nombre', 'rfc', 'contacto', 'email')
    list_filter = ('activa',)
    inlines = [ObraInline]


@admin.register(Obra)
class ObraAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'empresa', 'estado', 'responsable')
    search_fields = ('nombre', 'empresa__nombre', 'responsable')
    list_filter = ('estado',)
