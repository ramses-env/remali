from django.db import models
from django.db.models import Max
from maquinaria.models import Equipo


class Inventario(models.Model):

    # ============================
    # CONSTANTES
    # ============================

    CONDICIONES = [
        ('nueva', 'Nueva'),
        ('seminueva', 'Seminueva'),
    ]

    ESTADOS = [
        ('disponible', 'Disponible'),
        ('rentado', 'Rentado'),
        ('mantenimiento', 'Mantenimiento'),
        ('vendido', 'Vendido'),
    ]

    # ============================
    # CAMPOS PRINCIPALES
    # ============================

    equipo = models.ForeignKey(
        Equipo,
        on_delete=models.PROTECT,
        related_name='unidades'
    )

    # 👉 CÓDIGO INTERNO AUTOMÁTICO (IDENTIFICADOR REAL)
    codigo = models.CharField(
    max_length=20,
    unique=True,
    editable=False
)    # 👈 agregar


    # 👉 SERIAL DEL FABRICANTE (OPCIONAL)
    numero_serie = models.CharField(
        max_length=100,
        blank=True,
        null=True
    )

    condicion = models.CharField(
        max_length=12,
        choices=CONDICIONES,
        default='seminueva'
    )

    estado = models.CharField(
        max_length=15,
        choices=ESTADOS,
        default='disponible'
    )

    ubicacion_actual = models.CharField(
        max_length=255,
        default="Bodega"
    )

    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    # ============================
    # GENERADOR DE CÓDIGO
    # ============================

    def generar_codigo(self):
        """
        Genera un código/etiqueta automático a partir del modelo.
        Ejemplo: Taladro -> TAL-0001, HM-1810 -> HM1-0001
        """
        import re

        # Prefijo: primeros 3 caracteres alfanuméricos del modelo, en mayúsculas
        limpio = re.sub(r'[^A-Za-z0-9]', '', self.equipo.modelo or '')
        prefijo = (limpio[:3] or 'EQ').upper()

        ultimo = Inventario.objects.filter(
            codigo__startswith=f'{prefijo}-'
        ).aggregate(Max('codigo'))
        ultimo_codigo = ultimo['codigo__max']

        if ultimo_codigo:
            try:
                numero = int(ultimo_codigo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                numero = 1
        else:
            numero = 1

        return f"{prefijo}-{numero:04d}"

    # ============================
    # SAVE OVERRIDE
    # ============================

    def save(self, *args, **kwargs):

        # Genera código solo si es nuevo
        if not self.codigo:
            self.codigo = self.generar_codigo()

        # Evita guardar "" como serial
        if self.numero_serie == "":
            self.numero_serie = None

        super().save(*args, **kwargs)

    # ============================
    # LÓGICA DE NEGOCIO
    # ============================

    @property
    def disponible_para_venta(self):
        return self.estado == 'disponible'

    @property
    def disponible_para_renta(self):
        if self.condicion == 'nueva':
            return False
        return self.estado == 'disponible'

    # Métodos usados por las vistas de renta/venta
    def puede_venderse(self):
        return self.disponible_para_venta

    def puede_rentarse(self):
        return self.disponible_para_renta

    # ============================
    # TRANSICIONES DE ESTADO
    # ⭐ Fuente ÚNICA de verdad del estado de la unidad.
    #    Renta y Venta deben pasar SIEMPRE por estos métodos,
    #    nunca escribir `estado` directamente.
    # ============================

    def _set_estado(self, nuevo_estado, ubicacion=None):
        """Cambia el estado (y opcionalmente la ubicación) de forma atómica y mínima."""
        campos = []
        if self.estado != nuevo_estado:
            self.estado = nuevo_estado
            campos.append('estado')
        if ubicacion is not None and self.ubicacion_actual != ubicacion:
            self.ubicacion_actual = ubicacion
            campos.append('ubicacion_actual')
        if campos:
            campos.append('fecha_actualizacion')
            self.save(update_fields=campos)

    def ocupar_por_renta(self, ubicacion='Cliente (en renta)'):
        """disponible -> rentado. Única vía para ocupar la unidad por una renta."""
        if self.estado != 'disponible':
            raise ValueError(
                f"La unidad {self.codigo} no está disponible (estado actual: {self.estado})."
            )
        self._set_estado('rentado', ubicacion)

    def liberar(self, ubicacion='Bodega'):
        """rentado -> disponible (al devolver o cancelar una renta)."""
        if self.estado == 'rentado':
            self._set_estado('disponible', ubicacion)

    def enviar_mantenimiento(self):
        self._set_estado('mantenimiento', 'Taller')

    def salir_mantenimiento(self):
        self._set_estado('disponible', 'Bodega')

    def marcar_vendido(self):
        if self.estado == 'vendido':
            return
        self._set_estado('vendido')

    def marcar_rentado(self):
        """Compatibilidad hacia atrás: delega en la vía central."""
        self.ocupar_por_renta()

    def __str__(self):
        return f"{self.codigo} | {self.equipo.modelo}"


class Mantenimiento(models.Model):
    """Registro de un servicio de mantenimiento a una unidad, con las refacciones usadas."""
    ESTADOS = [('abierto', 'Abierto'), ('cerrado', 'Cerrado')]

    unidad = models.ForeignKey(Inventario, on_delete=models.CASCADE, related_name='mantenimientos')
    descripcion = models.TextField(blank=True, default='')
    costo_mano_obra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    estado = models.CharField(max_length=10, choices=ESTADOS, default='abierto')
    fecha_entrada = models.DateTimeField(auto_now_add=True)
    fecha_salida = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'mantenimientos'
        verbose_name = 'Mantenimiento'
        verbose_name_plural = 'Mantenimientos'
        ordering = ['-fecha_entrada']

    @property
    def total_refacciones(self):
        return sum((i.subtotal for i in self.refacciones_usadas.all()), 0)

    @property
    def costo_total(self):
        return (self.costo_mano_obra or 0) + self.total_refacciones

    def __str__(self):
        return f"Mantenimiento {self.unidad.codigo} ({self.estado})"


class MantenimientoRefaccion(models.Model):
    """Refacción consumida en un mantenimiento (descuenta stock al registrarse)."""
    mantenimiento = models.ForeignKey(Mantenimiento, on_delete=models.CASCADE, related_name='refacciones_usadas')
    refaccion = models.ForeignKey('refacciones.Refaccion', on_delete=models.PROTECT, related_name='usos_mantenimiento')
    cantidad = models.PositiveIntegerField(default=1)
    costo_unitario = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = 'mantenimiento_refacciones'
        verbose_name = 'Refacción usada'
        verbose_name_plural = 'Refacciones usadas'

    @property
    def subtotal(self):
        return (self.costo_unitario or 0) * self.cantidad

    def __str__(self):
        return f"{self.refaccion.nombre} x{self.cantidad}"


class OrdenReparacion(models.Model):
    """Orden de reparación/servicio: para el equipo de un cliente o para una máquina propia."""
    TIPOS = [('cliente', 'Equipo de cliente'), ('interna', 'Máquina propia')]
    ESTADOS = [
        ('recibida', 'Recibida'),
        ('proceso', 'En proceso'),
        ('terminada', 'Terminada'),
        ('entregada', 'Entregada'),
    ]

    folio = models.CharField(max_length=20, unique=True, editable=False, blank=True)
    tipo = models.CharField(max_length=10, choices=TIPOS, default='cliente')

    # Cliente
    cliente_nombre = models.CharField(max_length=200, blank=True, default='')
    cliente_telefono = models.CharField(max_length=40, blank=True, default='')
    empresa = models.ForeignKey('empresas.Empresa', null=True, blank=True, on_delete=models.SET_NULL, related_name='ordenes_reparacion')

    # Equipo: propio (unidad) o del cliente (descripción libre)
    unidad = models.ForeignKey(Inventario, null=True, blank=True, on_delete=models.SET_NULL, related_name='ordenes_reparacion')
    equipo_descripcion = models.CharField(max_length=255, blank=True, default='', help_text='Marca/modelo del equipo del cliente')
    numero_serie = models.CharField(max_length=120, blank=True, default='')

    # Trabajo
    diagnostico = models.TextField(blank=True, default='', help_text='Falla reportada / diagnóstico')
    trabajo_realizado = models.TextField(blank=True, default='', help_text='Trabajo realizado')
    costo_mano_obra = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    estado = models.CharField(max_length=12, choices=ESTADOS, default='recibida')
    notas = models.TextField(blank=True, default='')

    fecha_recibida = models.DateTimeField(auto_now_add=True)
    fecha_entrega = models.DateTimeField(null=True, blank=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ordenes_reparacion'
        verbose_name = 'Orden de reparación'
        verbose_name_plural = 'Órdenes de reparación'
        ordering = ['-fecha_recibida']

    def generar_folio(self):
        ultimo = OrdenReparacion.objects.filter(folio__startswith='OR-').aggregate(m=Max('folio'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                n = 1
        return f'OR-{n:04d}'

    def save(self, *args, **kwargs):
        if not self.folio:
            self.folio = self.generar_folio()
        super().save(*args, **kwargs)

    @property
    def total_refacciones(self):
        return sum((i.subtotal for i in self.items.all()), 0)

    @property
    def total(self):
        return (self.costo_mano_obra or 0) + self.total_refacciones

    @property
    def cliente_display(self):
        if self.empresa_id and self.empresa:
            return self.empresa.nombre
        return self.cliente_nombre or 'Cliente'

    @property
    def equipo_display(self):
        if self.unidad_id and self.unidad:
            modelo = self.unidad.equipo.modelo if self.unidad.equipo else 'Equipo'
            return f'{modelo} ({self.unidad.codigo})'
        return self.equipo_descripcion or 'Equipo'

    def __str__(self):
        return f'{self.folio} · {self.cliente_display}'


class OrdenReparacionItem(models.Model):
    """Refacción/insumo usado en una orden: del inventario (descuenta stock) o comprada aparte."""
    ORIGENES = [('stock', 'De inventario'), ('externa', 'Comprada/pedida aparte')]

    orden = models.ForeignKey(OrdenReparacion, on_delete=models.CASCADE, related_name='items')
    origen = models.CharField(max_length=10, choices=ORIGENES, default='stock')
    refaccion = models.ForeignKey('refacciones.Refaccion', null=True, blank=True, on_delete=models.SET_NULL, related_name='usos_reparacion')
    nombre = models.CharField(max_length=200, default='')
    cantidad = models.PositiveIntegerField(default=1)
    costo_unitario = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = 'orden_reparacion_items'
        ordering = ['id']

    @property
    def subtotal(self):
        return (self.costo_unitario or 0) * self.cantidad

    def __str__(self):
        return f'{self.nombre} x{self.cantidad}'