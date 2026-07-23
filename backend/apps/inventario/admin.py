from django.contrib import admin
from django.http import HttpResponse
from django.utils.html import format_html
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from io import BytesIO
from .models import Inventario

import qrcode
import base64


@admin.register(Inventario)
class InventarioAdmin(admin.ModelAdmin):

    list_display = (
        'codigo',
        'equipo',
        'numero_serie',
        'estado_color',
        'ubicacion_actual',
        'ver_qr',
        'imprimir_etiqueta_btn',
    )

    list_filter = (
        'estado',
        'equipo__tipo',
        'equipo__marca',
    )

    search_fields = (
        'numero_serie',
        'equipo__modelo',
        'equipo__tipo__nombre',
    )

    readonly_fields = (
        'codigo',
        'qr_grande',
        'fecha_creacion',
        'fecha_actualizacion',
    )

    fieldsets = (
        ("Unidad Física", {
            'fields': (
                'equipo',
                'codigo',
                'numero_serie',
                'condicion',
                'estado',
                'ubicacion_actual',
            )
        }),
        ("QR", {
            'fields': ('qr_grande',)
        }),
        ("Sistema", {
            'fields': (
                'fecha_creacion',
                'fecha_actualizacion',
            )
        }),
    )

    def estado_color(self, obj):
        colores = {
            "disponible": "green",
            "rentado": "orange",
            "mantenimiento": "#2563eb",
            "vendido": "red",
        }

        color = colores.get(obj.estado, "black")

        return format_html(
            '<strong style="color:{};">{}</strong>',
            color,
            obj.get_estado_display().upper()
        )

    estado_color.short_description = "Estado"

    def qr_grande(self, obj):
        if not obj.codigo:
            return "Guarda primero"

        qr = qrcode.QRCode(box_size=10, border=1)
        qr.add_data(obj.codigo)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        buffer = BytesIO()
        img.save(buffer, format="PNG")

        img_base64 = base64.b64encode(buffer.getvalue()).decode()

        return format_html(
            '<img src="data:image/png;base64,{}" width="180" />',
            img_base64
        )

    qr_grande.short_description = "QR"

    def ver_qr(self, obj):
        return "✅" if obj.codigo else "-"

    ver_qr.short_description = "QR"

    def imprimir_etiqueta_btn(self, obj):
        return format_html(
            '<a class="button" href="imprimir-etiqueta/{}/" target="_blank">🖨️ Imprimir</a>',
            obj.id
        )

    imprimir_etiqueta_btn.short_description = "Etiqueta"

    def get_urls(self):
        from django.urls import path

        urls = super().get_urls()

        custom = [
            path(
                'imprimir-etiqueta/<int:inventario_id>/',
                self.admin_site.admin_view(self.imprimir_etiqueta_pdf),
                name='imprimir_etiqueta',
            ),
        ]

        return custom + urls

    def imprimir_etiqueta_pdf(self, request, inventario_id):
        unidad = Inventario.objects.get(id=inventario_id)

        buffer = BytesIO()
        p = canvas.Canvas(buffer, pagesize=(80 * mm, 50 * mm))

        tipo = unidad.equipo.tipo.nombre if unidad.equipo.tipo else "Maquinaria"
        modelo = unidad.equipo.modelo if unidad.equipo.modelo else "N/A"

        p.setFont("Helvetica-Bold", 11)
        p.drawCentredString(40 * mm, 45 * mm, "IDENTIFICACIÓN")

        p.setFont("Helvetica", 9)
        p.drawString(5 * mm, 35 * mm, f"Tipo: {tipo}")
        p.drawString(5 * mm, 30 * mm, f"Modelo: {modelo}")
        if unidad.numero_serie:
            p.drawString(5 * mm, 25 * mm, f"Serie: {unidad.numero_serie}")

        p.setFont("Helvetica-Bold", 18)
        p.drawCentredString(40 * mm, 18 * mm, unidad.codigo)

        p.showPage()
        p.save()

        buffer.seek(0)

        return HttpResponse(buffer, content_type='application/pdf')