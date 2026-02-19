from django.contrib import admin
from django.http import HttpResponse
from django.utils.html import format_html
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import mm
from io import BytesIO
from .models import Inventario
import qrcode
import base64
from io import BytesIO


@admin.register(Inventario)
class InventarioAdmin(admin.ModelAdmin):
    list_display = (
        'numero_serie',
        'equipo',
        'estado',
        'ubicacion_actual',
        'ver_qr',
        'imprimir_etiqueta_btn'
    )

    list_filter = ('estado', 'equipo__tipo', 'equipo__marca')
    search_fields = ('numero_serie', 'equipo__modelo', 'equipo__tipo__nombre')
    readonly_fields = ('numero_serie', 'qr_grande', 'fecha_creacion', 'fecha_actualizacion')

    fieldsets = (
        ("Unidad Física", {
            'fields': (
                'equipo',
                'numero_serie',
                'estado',
                'ubicacion_actual'
            )
        }),
        ("QR (Solo para administración)", {
            'fields': ('qr_grande',)
        }),
        ("Sistema", {
            'fields': ('fecha_creacion', 'fecha_actualizacion')
        }),
    )

    # 🔳 QR solo visible para admin (no para etiqueta)
    def qr_grande(self, obj):
        if not obj.numero_serie:
            return "Guarda primero la unidad"

        qr = qrcode.make(obj.numero_serie)
        buffer = BytesIO()
        qr.save(buffer, format="PNG")
        img_base64 = base64.b64encode(buffer.getvalue()).decode()

        return format_html(
            '<img src="data:image/png;base64,{}" width="180" height="180" />',
            img_base64
        )

    qr_grande.short_description = "QR interno"

    def ver_qr(self, obj):
        if not obj.numero_serie:
            return "-"
        return "QR generado"

    ver_qr.short_description = "QR"

    # 🖨️ BOTÓN IMPRIMIR ETIQUETA (LO QUE TÚ NECESITAS)
    def imprimir_etiqueta_btn(self, obj):
        return format_html(
            '<a class="button" href="imprimir-etiqueta/{}/" target="_blank">🖨️ Imprimir Serie</a>',
            obj.id
        )

    imprimir_etiqueta_btn.short_description = "Etiqueta"

    # URL personalizada dentro del admin
    def get_urls(self):
        from django.urls import path
        urls = super().get_urls()
        custom_urls = [
            path(
                'imprimir-etiqueta/<int:inventario_id>/',
                self.admin_site.admin_view(self.imprimir_etiqueta_pdf),
                name='imprimir_etiqueta',
            ),
        ]
        return custom_urls + urls

    # 📄 GENERADOR DE ETIQUETA PDF (SERIE GRANDE PARA PEGAR)
    def imprimir_etiqueta_pdf(self, request, inventario_id):
        unidad = Inventario.objects.get(id=inventario_id)

        buffer = BytesIO()
        
        # Tamaño etiqueta: 80mm x 50mm (ideal para maquinaria)
        p = canvas.Canvas(buffer, pagesize=(80 * mm, 50 * mm))

        tipo = unidad.equipo.tipo.nombre if unidad.equipo.tipo else "Equipo"
        modelo = unidad.equipo.modelo if unidad.equipo.modelo else ""

        # TÍTULO
        p.setFont("Helvetica-Bold", 10)
        p.drawString(10, 120, "IDENTIFICACIÓN DE MAQUINARIA")

        # TIPO
        p.setFont("Helvetica", 9)
        p.drawString(10, 100, f"Tipo: {tipo}")

        # MODELO
        p.drawString(10, 85, f"Modelo: {modelo}")

        # NUMERO DE SERIE GRANDE (LO IMPORTANTE)
        p.setFont("Helvetica-Bold", 22)
        p.drawString(10, 50, unidad.numero_serie)

        # Pie
        p.setFont("Helvetica", 7)
        p.drawString(10, 20, "Remali")

        p.showPage()
        p.save()

        buffer.seek(0)
        return HttpResponse(buffer, content_type='application/pdf')