from django.contrib import admin
from django import forms
from .models import (
    Equipo, Categoria, Marca, Tipo, ImagenProducto,
    Cupon
)

class CuponAdminForm(forms.ModelForm):
    descuento_percent = forms.IntegerField(min_value=0, max_value=100, label='Descuento (%)')

    class Meta:
        model = Cupon
        fields = ['codigo', 'descuento_percent', 'activo']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if getattr(self, 'instance', None) and getattr(self.instance, 'pk', None):
            self.fields['descuento_percent'].initial = int(round((self.instance.descuento or 0) * 100))

    def save(self, commit=True):
        obj = super().save(commit=False)
        percent = int(self.cleaned_data.get('descuento_percent') or 0)
        obj.descuento = percent / 100
        if commit:
            obj.save()
        return obj

try:
    admin.site.unregister(Equipo)
except Exception:
    pass

class EquipoAdmin(admin.ModelAdmin):
    list_display = ('id', 'modelo', 'categoria', 'tipo', 'marca', 'precio_dia', 'precio_semana', 'precio_mes', 'disponible_venta', 'disponible_renta', 'condicion', 'estado')
    list_filter = ('categoria', 'tipo', 'marca', 'condicion', 'estado',)
    search_fields = ('modelo', 'descripcion', 'categoria__nombre', 'tipo__nombre', 'marca__nombre')
    list_editable = ('estado',)
    readonly_fields = ('disponible_venta', 'disponible_renta')
    class EquipoForm(forms.ModelForm):
        class Meta:
            model = Equipo
            fields = '__all__'
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            # Mantener requeridos por defecto definidos en el modelo; no forzar todos
            # Asegurar que 'modelo' sea requerido
            if 'modelo' in self.fields:
                self.fields['modelo'].required = True
    form = EquipoForm
try:
    admin.site.register(Equipo, EquipoAdmin)
except Exception:
    pass

@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre')
    search_fields = ('nombre',)

@admin.register(Marca)
class MarcaAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre')
    search_fields = ('nombre',)

@admin.register(Tipo)
class TipoAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre')
    search_fields = ('nombre',)

@admin.register(ImagenProducto)
class ImagenProductoAdmin(admin.ModelAdmin):
    list_display = ('id', 'equipo', 'fecha_creacion')

@admin.register(Cupon)
class CuponAdmin(admin.ModelAdmin):
    list_display = ('id', 'codigo', 'descuento_percent_display', 'activo')
    list_editable = ('activo',)
    form = CuponAdminForm
    exclude = ('descuento',)

    def descuento_percent_display(self, obj):
        return f"{int(round((obj.descuento or 0) * 100))}%"
    descuento_percent_display.short_description = 'Descuento'
