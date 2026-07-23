from django.contrib import admin
from django import forms
from django.utils import timezone

from .models import Renta
from inventario.models import Inventario


class RentaAdminForm(forms.ModelForm):
    class Meta:
        model = Renta
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Solo unidades realmente rentables: disponibles, seminuevas y sin renta activa/reservada
        qs = Inventario.objects.filter(
            estado='disponible',
            condicion='seminueva',
        ).exclude(
            rentas__estado__in=['activa', 'reservada'],
        ).select_related('equipo', 'equipo__tipo')
        self.fields['inventario'].queryset = qs

    def clean(self):
        cleaned = super().clean()
        fi = cleaned.get('fecha_inicio')
        ff = cleaned.get('fecha_fin')
        if fi and ff and ff < fi:
            self.add_error('fecha_fin', "La fecha fin no puede ser anterior a la fecha de inicio.")
        return cleaned


@admin.register(Renta)
class RentaAdmin(admin.ModelAdmin):
    form = RentaAdminForm

    list_display = (
        'id', 'inventario', 'cliente_col', 'modalidad', 'duracion',
        'fecha_inicio', 'fecha_fin', 'total', 'estado', 'vencida',
    )
    list_filter = ('estado', 'modalidad')
    search_fields = (
        'inventario__codigo', 'inventario__numero_serie',
        'inventario__equipo__modelo', 'cliente', 'empresa__nombre', 'direccion',
    )
    readonly_fields = (
        'precio_unitario', 'subtotal', 'total', 'recargo',
        'fecha_devolucion_real', 'creado_en', 'actualizado_en',
    )
    actions = ['accion_finalizar', 'accion_cancelar']

    def cliente_col(self, obj):
        return obj.cliente_nombre
    cliente_col.short_description = 'Cliente'

    @admin.action(description='Finalizar (devolver) rentas seleccionadas')
    def accion_finalizar(self, request, queryset):
        n = 0
        for r in queryset.filter(estado='activa'):
            r.finalizar(commit=True)
            n += 1
        self.message_user(request, f'{n} renta(s) finalizada(s).')

    @admin.action(description='Cancelar rentas seleccionadas')
    def accion_cancelar(self, request, queryset):
        n = 0
        for r in queryset.exclude(estado__in=['finalizada', 'cancelada']):
            r.cancelar(motivo='Cancelada desde el admin')
            n += 1
        self.message_user(request, f'{n} renta(s) cancelada(s).')

    class Media:
        js = ['renta/admin_renta.js']
