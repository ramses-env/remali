from django.db import models
from django.db.models import Max


class Refaccion(models.Model):
    nombre = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True, null=True)
    precio_venta = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    stock = models.PositiveIntegerField(default=0, help_text="Cantidad disponible en el taller")
    stock_minimo = models.PositiveIntegerField(default=0, help_text="Umbral para alertar reorden (0 = sin alerta)")
    para_venta = models.BooleanField(
        default=False,
        help_text="Además de mantenimiento, esta refacción también se vende al público"
    )
    ubicacion = models.CharField(max_length=120, blank=True, default='', help_text="Ubicación en el taller (estante/caja)")
    codigo_barras = models.CharField(
        max_length=20,
        unique=True,
        blank=True,
        help_text="Código de barras: si la refacción ya lo trae, escríbelo; si no, el sistema genera uno."
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Refacción'
        verbose_name_plural = 'Refacciones'
        ordering = ['nombre']

    def generar_codigo_barras(self):
        """Genera un código interno único tipo RF0000000001 (compatible con Code128)."""
        ultimo = Refaccion.objects.filter(codigo_barras__startswith='RF').aggregate(m=Max('codigo_barras'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.replace('RF', '')) + 1
            except (ValueError, TypeError):
                n = 1
        return f'RF{n:010d}'

    def save(self, *args, **kwargs):
        # Si no trae código de barras, el sistema le genera uno único.
        if not (self.codigo_barras or '').strip():
            self.codigo_barras = self.generar_codigo_barras()
        super().save(*args, **kwargs)

    @property
    def bajo_stock(self):
        return self.stock_minimo > 0 and self.stock <= self.stock_minimo

    def __str__(self):
        return self.nombre
