from decimal import Decimal

from django.db import models, transaction
from django.conf import settings

# IVA México. Los precios se capturan SIN IVA (son el subtotal). El IVA (16%)
# solo se SUMA cuando el cliente pedirá factura (aplica_iva=True).
IVA_RATE = Decimal('0.16')


class Venta(models.Model):
    METODO_PAGO = [
        ('efectivo', 'Efectivo'),
        ('tarjeta', 'Tarjeta'),
        ('transferencia', 'Transferencia'),
    ]

    ESTADOS = [
        ('activa', 'Activa'),
        ('cancelada', 'Cancelada'),
    ]

    nombre_cliente = models.CharField(max_length=255, blank=True, null=True)
    telefono_cliente = models.CharField(max_length=40, blank=True, default='')
    empresa = models.ForeignKey(
        'empresas.Empresa',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='ventas',
    )

    metodo_pago = models.CharField(max_length=20, choices=METODO_PAGO, default='efectivo')
    # Pago combinado: lista [{'metodo': 'efectivo|tarjeta|transferencia', 'monto': '1234.50'}].
    # metodo_pago se conserva como principal (el de mayor monto) para compatibilidad.
    pagos = models.JSONField(default=list, blank=True)
    estado = models.CharField(max_length=12, choices=ESTADOS, default='activa')

    fecha = models.DateTimeField(auto_now_add=True)

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='ventas_pos'
    )

    # Liga de vinculación: el admin genera un enlace; el cliente, ya con sesión,
    # lo abre y la venta queda ligada a SU cuenta. Es de un solo uso (al
    # reclamarse se limpia el token) y con caducidad.
    token_vinculo = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)
    token_vinculo_expira = models.DateTimeField(null=True, blank=True, editable=False)

    # Venta de maquinaria (unidad única) + su precio como snapshot
    inventario = models.ForeignKey(
        'inventario.Inventario',
        on_delete=models.SET_NULL,
        null=True, blank=True
    )

    # Origen: si esta venta nació de una cotización aceptada.
    cotizacion = models.ForeignKey(
        'cotizaciones.Cotizacion',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='conversiones',
    )
    precio_maquina = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text="Precio de la máquina vendida (SIN IVA)"
    )

    # Regla de negocio: TODA venta lleva IVA (a diferencia de la renta, donde es
    # opcional). Se mantiene el campo por compatibilidad, pero save() lo fuerza True.
    aplica_iva = models.BooleanField(default=True, help_text='Toda venta lleva IVA (16%) incluido')

    # Montos: `subtotal` es SIN IVA; `total` = subtotal (+ IVA si aplica_iva)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        db_table = 'ventas'
        verbose_name = 'Venta'
        verbose_name_plural = 'Ventas'
        ordering = ['-fecha']

    # ─────────────────────────────────────────────
    #  MONTOS
    # ─────────────────────────────────────────────
    def recalcular_total(self):
        """El precio capturado es el SUBTOTAL (sin IVA). En ventas el IVA (16%)
        se suma SIEMPRE (save() fuerza aplica_iva=True)."""
        base = Decimal(self.precio_maquina or 0)
        # Los items solo existen si la venta ya fue guardada (tiene PK)
        if self.pk:
            for item in self.items.all():
                base += item.subtotal
        base = base.quantize(Decimal('0.01'))
        self.subtotal = base
        if self.aplica_iva:
            self.iva = (base * IVA_RATE).quantize(Decimal('0.01'))
            self.total = (base + self.iva).quantize(Decimal('0.01'))
        else:
            self.iva = Decimal('0.00')
            self.total = base

    @transaction.atomic
    def save(self, *args, **kwargs):
        es_nueva = self.pk is None

        # Invariante de negocio: toda venta lleva IVA. El flag de factura solo
        # decide si la venta va a la bandeja "Por facturar", no si se cobra IVA.
        self.aplica_iva = True

        # Validar la venta de máquina ANTES de persistir
        if es_nueva and self.inventario:
            if not self.inventario.puede_venderse():
                raise ValueError(
                    f"La unidad {self.inventario.codigo} no está disponible para venta."
                )
            if not self.precio_maquina or self.precio_maquina <= 0:
                pv = self.inventario.equipo.precio_venta if self.inventario.equipo else None
                self.precio_maquina = Decimal(pv) if pv else Decimal('0.00')

        self.recalcular_total()
        super().save(*args, **kwargs)

        # Fuente única: la venta marca la unidad como vendida
        if es_nueva and self.inventario:
            self.inventario.marcar_vendido()

    # ─────────────────────────────────────────────
    #  CANCELACIÓN (reversa)
    # ─────────────────────────────────────────────
    @transaction.atomic
    def cancelar(self, motivo=''):
        """Revierte la venta: reabastece refacciones y devuelve la máquina a disponible."""
        if self.estado == 'cancelada':
            return
        # Reabastecer refacciones vendidas
        for item in self.items.select_related('refaccion').all():
            ref = item.refaccion
            if ref:
                ref.stock = (ref.stock or 0) + item.cantidad
                ref.save(update_fields=['stock'])
        # Devolver la máquina a inventario
        if self.inventario and self.inventario.estado == 'vendido':
            self.inventario._set_estado('disponible', 'Bodega')
        self.estado = 'cancelada'
        self.save(update_fields=['estado'])
        # Saca la venta de la bandeja "Por facturar" (no se factura algo cancelado).
        self.solicitudes_factura.filter(estado='pendiente').update(estado='cancelada')

    # ─────────────────────────────────────────────
    #  TICKET 80mm
    # ─────────────────────────────────────────────
    def as_ticket_text(self):
        L = [
            "REMALI MAQUINARIA",
            "Ticket de Venta",
            f"Venta: #{self.id}",
            f"Fecha: {self.fecha.strftime('%d/%m/%Y %H:%M')}",
        ]
        if self.nombre_cliente:
            L.append(f"Cliente: {self.nombre_cliente}")
        L.append("-" * 32)

        # Línea de la máquina (antes se omitía)
        if self.inventario:
            eq = self.inventario.equipo.modelo if self.inventario.equipo else 'Maquinaria'
            L.append(f"{eq} ({self.inventario.codigo})")
            L.append(f"1 x ${self.precio_maquina}")

        for item in self.items.all():
            nombre = item.refaccion.nombre if item.refaccion else "Producto"
            L.append(f"{nombre}")
            L.append(f"{item.cantidad} x ${item.precio_unitario} = ${item.subtotal}")

        L.append("-" * 32)
        L.append(f"Subtotal: ${self.subtotal}")
        L.append(f"IVA (16%): ${self.iva}")
        L.append(f"TOTAL: ${self.total} MXN")
        L.append(f"Pago: {self.get_metodo_pago_display()}")
        if self.estado == 'cancelada':
            L.append("** VENTA CANCELADA **")
        L.append("Gracias por su compra")
        return "\n".join(L)

    def __str__(self):
        return f"Venta #{self.id} - ${self.total}"


class ItemVenta(models.Model):
    venta = models.ForeignKey(
        'ventas.Venta',
        on_delete=models.CASCADE,
        related_name='items'
    )

    refaccion = models.ForeignKey(
        'refacciones.Refaccion',
        on_delete=models.PROTECT,
        related_name='items_vendidos'
    )

    cantidad = models.PositiveIntegerField(
        default=1,
        help_text="Cantidad de piezas vendidas"
    )

    precio_unitario = models.DecimalField(
        max_digits=10, decimal_places=2, blank=True
    )

    subtotal = models.DecimalField(
        max_digits=12, decimal_places=2, editable=False
    )

    def save(self, *args, **kwargs):
        if not self.refaccion:
            raise ValueError("Debe seleccionar una refacción")

        self.precio_unitario = self.refaccion.precio_venta

        # Validar y descontar stock solo al crear
        if not self.pk:
            if self.refaccion.stock < self.cantidad:
                raise ValueError(
                    f"Stock insuficiente para '{self.refaccion.nombre}'. "
                    f"Disponible: {self.refaccion.stock}"
                )
            self.refaccion.stock -= self.cantidad
            self.refaccion.save(update_fields=['stock'])

        self.subtotal = (
            Decimal(self.cantidad) * self.precio_unitario
        ).quantize(Decimal('0.01'))

        super().save(*args, **kwargs)

        if self.venta_id:
            self.venta.recalcular_total()
            self.venta.save(update_fields=['subtotal', 'iva', 'total'])

    def __str__(self):
        nombre = self.refaccion.nombre if self.refaccion else "Producto"
        return f"{nombre} x{self.cantidad}"

    class Meta:
        db_table = 'items_venta'
        verbose_name = 'Detalle de venta'
        verbose_name_plural = 'Detalles de venta'
        ordering = ['id']
