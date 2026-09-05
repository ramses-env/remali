from django.contrib import admin
from .models import Venta, ItemVenta


class ItemVentaInline(admin.TabularInline):
    model = ItemVenta
    extra = 1
    autocomplete_fields = ['refaccion']
    readonly_fields = ('precio_unitario', 'subtotal')
    fields = ('refaccion', 'cantidad', 'precio_unitario', 'subtotal')


@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'fecha', 'nombre_cliente', 'items_count',
        'subtotal', 'iva', 'total', 'metodo_pago', 'estado', 'usuario',
    )
    list_filter = ('estado', 'fecha', 'metodo_pago', 'usuario')
    search_fields = ('id', 'nombre_cliente', 'items__refaccion__nombre', 'items__refaccion__codigo_barras')
    readonly_fields = ('subtotal', 'iva', 'total', 'fecha', 'usuario')
    date_hierarchy = 'fecha'
    list_per_page = 50
    actions = ['accion_cancelar']

    inlines = [ItemVentaInline]

    fieldsets = (
        ("Información de la Venta", {
            'fields': ('nombre_cliente', 'telefono_cliente', 'cliente', 'metodo_pago', 'estado', 'usuario')
        }),
        ("Venta de Maquinaria (Opcional)", {
            'fields': ('inventario', 'precio_maquina'),
            'description': 'Usar SOLO si se vende una máquina única (IVA incluido en el precio).'
        }),
        ("Totales", {
            'fields': ('subtotal', 'iva', 'total', 'fecha')
        }),
    )

    def save_model(self, request, obj, form, change):
        if not obj.pk:
            obj.usuario = request.user
        super().save_model(request, obj, form, change)

    def items_count(self, obj):
        return obj.items.count()
    items_count.short_description = 'Items'

    @admin.action(description='Cancelar ventas seleccionadas (revierte stock/máquina)')
    def accion_cancelar(self, request, queryset):
        n = 0
        for v in queryset.exclude(estado='cancelada'):
            v.cancelar(motivo='Cancelada desde el admin')
            n += 1
        self.message_user(request, f'{n} venta(s) cancelada(s).')

    class Media:
        js = ['ventas/admin_ventas.js']
