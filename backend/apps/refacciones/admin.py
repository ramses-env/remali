from django.contrib import admin
from django.http import HttpResponse
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.graphics.barcode import code128, eanbc
from reportlab.lib.units import mm
from .models import Refaccion

@admin.register(Refaccion)
class RefaccionAdmin(admin.ModelAdmin):
    list_display = (
        'nombre',
        'codigo_barras',
        'precio_venta',
        'stock',
        'fecha_creacion',
    )

    search_fields = (
        'nombre',
        'codigo_barras',  # 🔥 CLAVE para lector de código de barras
    )

    list_filter = (
        'fecha_creacion',
    )

    readonly_fields = ('fecha_creacion',)

    ordering = ('nombre',)
    actions = ['descargar_codigo_barras_pdf']

    def descargar_codigo_barras_pdf(self, request, queryset):
        resp = HttpResponse(content_type='application/pdf')
        resp['Content-Disposition'] = 'attachment; filename=codigos_barras_refacciones.pdf'
        c = canvas.Canvas(resp, pagesize=letter)
        width, height = letter
        x = 20 * mm
        y = height - 30 * mm
        for ref in queryset:
            codigo = ref.codigo_barras or ''
            c.setFont("Helvetica-Bold", 12)
            c.drawString(x, y, f"{ref.nombre} ({codigo})")
            # Usar EAN13 si el código es de 12-13 dígitos, si no, Code128
            try:
                if codigo and len(codigo) in (12, 13) and codigo.isdigit():
                    barcode = eanbc.Ean13BarcodeWidget(codigo[:12])
                else:
                    barcode = code128.Code128(codigo or ref.nombre[:12])
                from reportlab.graphics.shapes import Drawing
                from reportlab.graphics import renderPDF
                d = Drawing(80*mm, 20*mm)
                barcode.barWidth = 0.4 * mm
                barcode.barHeight = 15 * mm
                d.add(barcode)
                renderPDF.draw(d, c, x, y - 22 * mm)
            except Exception:
                c.setFont("Helvetica", 10)
                c.drawString(x, y - 10 * mm, "No se pudo generar el código de barras")
            y -= 40 * mm
            if y < 40 * mm:
                c.showPage()
                y = height - 30 * mm
        c.showPage()
        c.save()
        return resp
    descargar_codigo_barras_pdf.short_description = "Descargar códigos de barras (PDF)"
