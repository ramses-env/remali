from django.contrib import admin

from .models import Cliente, Contacto


class ContactoInline(admin.TabularInline):
    model = Contacto
    extra = 0
    fields = ('nombre', 'telefono', 'email', 'puesto', 'usuario', 'principal')
    autocomplete_fields = ('usuario',)


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'tipo', 'telefono', 'rfc', 'activo', 'requiere_revision')
    list_filter = ('tipo', 'activo', 'requiere_revision')
    search_fields = ('nombre', 'razon_social', 'telefono', 'rfc', 'email', 'contactos__nombre', 'contactos__telefono')
    inlines = [ContactoInline]


@admin.register(Contacto)
class ContactoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'cliente', 'telefono', 'usuario', 'principal')
    list_filter = ('principal',)
    search_fields = ('nombre', 'telefono', 'email', 'cliente__nombre')
    autocomplete_fields = ('cliente', 'usuario')
