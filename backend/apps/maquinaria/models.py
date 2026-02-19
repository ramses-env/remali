from django.db import models

class Categoria(models.Model):
    nombre = models.CharField(max_length=120, unique=True)

    class Meta:
        db_table = 'categorias'
        verbose_name = 'Categoría'
        verbose_name_plural = 'Categorías'

    def __str__(self):
        return self.nombre

class Tipo(models.Model):
    nombre = models.CharField(max_length=30, unique=True)
    
    class Meta:
        db_table = 'tipos'
        verbose_name = 'Tipo'
        verbose_name_plural = 'Tipos'

    def __str__(self):
        return self.nombre

class Marca(models.Model):
    nombre = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'marcas'
        verbose_name = 'Marca'
        verbose_name_plural = 'Marcas'

    def __str__(self):
        return self.nombre

class Equipo(models.Model):
    modelo = models.CharField(max_length=20, default='')
    descripcion = models.TextField(blank=True)
    imagen = models.ImageField(upload_to='products/', blank=True, null=True)
    categoria = models.ForeignKey(Categoria, null=True, blank=True, on_delete=models.PROTECT, related_name='equipos')
    tipo = models.ForeignKey(Tipo, null=True, blank=True, on_delete=models.PROTECT, related_name='equipos')
    marca = models.ForeignKey(Marca, null=True, blank=True, on_delete=models.PROTECT, related_name='equipos')
    precio_dia = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    precio_semana = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    precio_mes = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    disponible_venta = models.BooleanField(default=True)
    disponible_renta = models.BooleanField(default=False)
    condicion = models.CharField(
        max_length=10,
        choices=[('nuevo', 'Nuevo'), ('seminuevo', 'Seminuevo')],
        default='seminuevo'
    )
    estado = models.CharField(
        max_length=10,
        choices=[('disponible', 'Disponible'), ('rentado', 'Rentado'), ('vendido', 'Vendido')],
        default='disponible'
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.modelo
    
    def get_precio_por_unidad(self, unidad: str):
        """
        Devuelve el precio según la unidad solicitada.
        unidad: 'dia' | 'semana' | 'mes'
        Si la unidad es inválida o el precio específico es None,
        se retorna el primer precio disponible en el orden: día → semana → mes.
        Si no hay ningún precio cargado, retorna Decimal('0.00').
        """
        from decimal import Decimal
        unidad = (unidad or '').strip().lower()
        mapa = {
            'dia': self.precio_dia,
            'semana': self.precio_semana,
            'mes': self.precio_mes,
        }
        if unidad in mapa and mapa[unidad] is not None:
            return mapa[unidad]
        for k in ('dia', 'semana', 'mes'):
            val = mapa[k]
            if val is not None:
                return val
        return Decimal('0.00')
    
    def _aplicar_disponibilidad_por_condicion(self):
        if self.condicion == 'nuevo':
            self.disponible_venta = True
            self.disponible_renta = False
        elif self.condicion == 'seminuevo':
            self.disponible_venta = True
            self.disponible_renta = True

    def save(self, *args, **kwargs):
        self._aplicar_disponibilidad_por_condicion()
        super().save(*args, **kwargs)
    
    class Meta:
        db_table = 'equipos'
        verbose_name = 'Equipo'
        verbose_name_plural = 'Equipos'

class ImagenProducto(models.Model):
    equipo = models.ForeignKey(Equipo, related_name='imagenes', on_delete=models.CASCADE)
    imagen = models.ImageField(upload_to='products/', blank=False, null=False)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'imagenes_producto'
        verbose_name = 'Imagen de Producto'
        verbose_name_plural = 'Imágenes de Producto'
        ordering = ['id']

    def __str__(self):
        return f"{self.equipo.modelo} #{self.id}"

class Cupon(models.Model):
    codigo = models.CharField(max_length=50, unique=True)
    descuento = models.DecimalField(max_digits=4, decimal_places=2, help_text="Porcentaje de descuento (0-1)")
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'cupones'
        verbose_name = 'Cupón'
        verbose_name_plural = 'Cupones'

    def __str__(self):
        return self.codigo

class VerificacionEmail(models.Model):
    usuario = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    token = models.CharField(max_length=64, unique=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    usado = models.BooleanField(default=False)

    class Meta:
        db_table = 'verificaciones_email'
        verbose_name = 'Verificación de Email'
        verbose_name_plural = 'Verificaciones de Email'

class Orden(models.Model):
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    cupon = models.ForeignKey(Cupon, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        db_table = 'ordenes'
        verbose_name = 'Orden'
        verbose_name_plural = 'Órdenes'

class ItemOrden(models.Model):
    orden = models.ForeignKey(Orden, related_name='items', on_delete=models.CASCADE)
    equipo = models.ForeignKey(Equipo, on_delete=models.PROTECT)
    precio = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = 'items_orden'
        verbose_name = 'Item de Orden'
        verbose_name_plural = 'Items de Orden'
