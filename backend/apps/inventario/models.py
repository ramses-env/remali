from django.db import models
from maquinaria.models import Equipo


class Inventario(models.Model):
    ESTADOS = [
        ('disponible', 'Disponible'),
        ('rentado', 'Rentado'),
        ('vendido', 'Vendido'),
        ('mantenimiento', 'Mantenimiento'),
    ]

    equipo = models.ForeignKey(
        Equipo,
        on_delete=models.CASCADE,
        related_name='unidades'
    )

    numero_serie = models.CharField(
        max_length=100,
        unique=True,
        blank=True,
        editable=False
    )

    estado = models.CharField(
        max_length=20,
        choices=ESTADOS,
        default='disponible'
    )

    ubicacion_actual = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Ej: Bodega, Cliente Juan, Taller"
    )

    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    # 🔥 Prefijo automático por TIPO (usa el nombre del tipo)
    def _generar_prefijo_tipo(self):
        if self.equipo and self.equipo.tipo and self.equipo.tipo.nombre:
            return self.equipo.tipo.nombre.upper()[:3]
        return "GEN"

    # 🔥 Generar serie tipo REV-0001
    def _generar_numero_serie(self):
        prefijo = self._generar_prefijo_tipo()

        total = Inventario.objects.filter(
            equipo__tipo=self.equipo.tipo,
            numero_serie__startswith=prefijo
        ).count() + 1

        consecutivo = str(total).zfill(4)
        return f"{prefijo}-{consecutivo}"

    # 🚀 Lógica automática empresarial
    def save(self, *args, **kwargs):
        # Generar número de serie automático
        if not self.numero_serie and self.equipo:
            self.numero_serie = self._generar_numero_serie()

        # Ubicación inteligente
        if self.estado == 'disponible' and not self.ubicacion_actual:
            self.ubicacion_actual = "Bodega"

        if self.estado == 'rentado':
            if not self.ubicacion_actual:
                self.ubicacion_actual = "Cliente (En renta)"

        if self.estado == 'vendido':
            self.ubicacion_actual = "Entregado / Vendido"

        super().save(*args, **kwargs)

    def __str__(self):
        tipo = self.equipo.tipo.nombre if self.equipo.tipo else "Equipo"
        return f"{tipo} - {self.numero_serie}"