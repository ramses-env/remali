from django.contrib import admin
from django import forms
from django.utils.html import format_html
from django.templatetags.static import static
from .models import (
    Equipo, Categoria, Marca, Tipo,
    ImagenProducto, Cupon
)


# ===============================
# CUPONES
# ===============================

class CuponAdminForm(forms.ModelForm):
    descuento_percent = forms.IntegerField(
        min_value=0,
        max_value=100,
        label='Descuento (%)'
    )

    class Meta:
        model = Cupon
        fields = ['codigo', 'descuento_percent', 'activo']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields['descuento_percent'].initial = int(
                round((self.instance.descuento or 0) * 100)
            )

    def save(self, commit=True):
        obj = super().save(commit=False)
        percent = int(self.cleaned_data.get('descuento_percent') or 0)
        obj.descuento = percent / 100
        if commit:
            obj.save()
        return obj


# ===============================
# EQUIPOS
# ===============================

@admin.register(Equipo)
class EquipoAdmin(admin.ModelAdmin):

    readonly_fields = ('fecha_creacion', 'resumen_disponibilidad')

    list_display = (
        'id',
        'modelo',
        'marca',
        'tipo',
        'categoria',
        'precio_venta',
        'precio_dia',
        'unidades_totales',
        'unidades_disponibles',
        'puede_venderse',
        'puede_rentarse',
    )

    list_filter = (
        'marca',
        'tipo',
        'categoria',
    )

    search_fields = (
        'modelo',
        'marca__nombre',
        'tipo__nombre'
    )

    fieldsets = (
        ("Información del Equipo", {
            'fields': (
                'modelo',
                'descripcion',
                'imagen',
                'marca',
                'tipo',
                'categoria',
                'resumen_disponibilidad'
            )
        }),
        ("💰 Configuración de Venta", {
            'fields': ('precio_venta',)
        }),
        ("🏗️ Configuración de Renta", {
            'fields': (
                'precio_dia',
                'precio_semana',
                'precio_mes'
            )
        }),
        ("Sistema", {
            'fields': ('fecha_creacion',)
        }),
    )

    # ===============================
    # MÉTODOS VISUALES
    # ===============================

    def unidades_totales(self, obj):
        return obj.unidades.count()
    unidades_totales.short_description = "Total Unidades"

    def unidades_disponibles(self, obj):
        return obj.unidades.filter(estado='disponible').count()
    unidades_disponibles.short_description = "Disponibles"

    def puede_venderse(self, obj):
        return obj.unidades.filter(estado='disponible').exists()
    puede_venderse.boolean = True
    puede_venderse.short_description = "Venta"

    def puede_rentarse(self, obj):
        return obj.unidades.filter(estado='disponible').exists()
    puede_rentarse.boolean = True
    puede_rentarse.short_description = "Renta"

    def resumen_disponibilidad(self, obj):
        total = obj.unidades.count()
        disponibles = obj.unidades.filter(estado='disponible').count()

        return format_html(
            "<strong>Total:</strong> {} &nbsp;&nbsp; "
            "<strong>Disponibles:</strong> {}",
            total,
            disponibles
        )

    resumen_disponibilidad.short_description = "Inventario"


# ===============================
# CATÁLOGOS
# ===============================

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