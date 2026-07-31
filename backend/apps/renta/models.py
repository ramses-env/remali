from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.core.exceptions import ValidationError
from django.utils import timezone

from inventario.models import Inventario

# Días que representa cada modalidad (fuente única para cálculo de fechas y tarifas)
MODALIDAD_DIAS = {'dia': 1, 'semana': 7, 'mes': 30}

# IVA México. Los precios de renta son SIN IVA; el IVA se suma solo si hay factura.
IVA_RATE = Decimal('0.16')


class Renta(models.Model):
    MODALIDADES = [
        ('dia', 'Día'),
        ('semana', 'Semana'),
        ('mes', 'Mes'),
    ]

    ESTADOS = [
        ('reservada', 'Reservada'),    # agendada a futuro; aún no ocupa la unidad
        ('activa', 'Activa'),          # en curso; la unidad está rentada
        ('finalizada', 'Finalizada'),  # equipo devuelto
        ('cancelada', 'Cancelada'),
    ]

    inventario = models.ForeignKey(
        Inventario,
        on_delete=models.PROTECT,
        related_name='rentas'
    )

    # ── Cliente: empresa/obra formal, o texto libre para clientes de mostrador ──
    empresa = models.ForeignKey(
        'empresas.Empresa',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='rentas',
    )
    obra = models.ForeignKey(
        'empresas.Obra',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='rentas',
    )
    cliente = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Nombre del cliente (si no es una empresa registrada)"
    )
    telefono_cliente = models.CharField(max_length=40, blank=True, default='')
    # Cuenta del cliente (si el admin la vincula): habilita "Tus rentas" en su panel.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='rentas_cliente',
    )

    modalidad = models.CharField(max_length=10, choices=MODALIDADES)
    duracion = models.PositiveIntegerField(
        default=1,
        help_text="Número de unidades según modalidad"
    )

    fecha_inicio = models.DateField(default=timezone.localdate)
    fecha_fin = models.DateField()
    fecha_devolucion_real = models.DateField(
        null=True, blank=True,
        help_text="Fecha en que realmente se devolvió el equipo"
    )

    direccion = models.CharField(
        max_length=255,
        help_text="Dirección donde está el equipo durante la renta"
    )

    # ── 💵 Dinero (snapshot al momento de la renta) ──
    precio_unitario = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text="Precio de la modalidad al momento de rentar"
    )
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    deposito = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text="Depósito en garantía"
    )
    recargo = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text="Recargo por devolución tardía"
    )
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    aplica_iva = models.BooleanField(default=False, help_text='Suma IVA (16%) porque el cliente pedirá factura')

    estado = models.CharField(max_length=12, choices=ESTADOS, default='activa')
    observaciones = models.TextField(blank=True, null=True)

    # ── Confirmación en campo ──
    # Una renta se crea "activa", pero el equipo puede tardar en salir. Estas
    # marcas dicen si YA se entregó y si YA se recogió, y quién lo hizo: es lo
    # que administración necesita para saber en qué va, sin llamar a preguntar.
    entregada_en = models.DateTimeField(null=True, blank=True)
    entregada_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='rentas_entregadas')
    recogida_en = models.DateTimeField(null=True, blank=True)
    recogida_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='rentas_recogidas')

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rentas'
        verbose_name = 'Renta'
        verbose_name_plural = 'Rentas'
        ordering = ['-creado_en']

    # ─────────────────────────────────────────────
    #  CÁLCULOS
    # ─────────────────────────────────────────────
    def calcular_fecha_fin(self):
        dias = MODALIDAD_DIAS.get(self.modalidad, 1) * max(self.duracion or 1, 1)
        return self.fecha_inicio + timedelta(days=dias)

    def _precio_modalidad(self):
        """Precio de catálogo del equipo para la modalidad de esta renta."""
        eq = self.inventario.equipo if self.inventario_id else None
        if not eq:
            return Decimal('0.00')
        precio = eq.get_precio_por_unidad(self.modalidad)
        return Decimal(precio) if precio is not None else Decimal('0.00')

    def recalcular_montos(self):
        """precio_unitario (snapshot) → subtotal → total. Los precios son SIN IVA;
        el IVA solo se suma si la renta lleva factura (aplica_iva)."""
        if not self.precio_unitario or self.precio_unitario == 0:
            self.precio_unitario = self._precio_modalidad()
        self.subtotal = (
            self.precio_unitario * Decimal(max(self.duracion or 1, 1))
        ).quantize(Decimal('0.01'))
        base = (self.subtotal - (self.descuento or 0) + (self.recargo or 0)).quantize(Decimal('0.01'))
        if base < 0:
            base = Decimal('0.00')
        if self.aplica_iva:
            self.iva = (base * IVA_RATE).quantize(Decimal('0.01'))
            self.total = (base + self.iva).quantize(Decimal('0.01'))
        else:
            self.iva = Decimal('0.00')
            self.total = base

    def tarifa_diaria(self):
        """Tarifa por día equivalente (para calcular recargos por retraso)."""
        dias = MODALIDAD_DIAS.get(self.modalidad, 1)
        if not self.precio_unitario or dias <= 0:
            return Decimal('0.00')
        return (self.precio_unitario / Decimal(dias)).quantize(Decimal('0.01'))

    # ─────────────────────────────────────────────
    #  VALIDACIONES
    # ─────────────────────────────────────────────
    def clean(self):
        if self.fecha_inicio and self.fecha_fin and self.fecha_fin < self.fecha_inicio:
            raise ValidationError("La fecha fin no puede ser anterior a la fecha de inicio.")

        if self.estado in ('activa', 'reservada'):
            if not self.inventario_id:
                raise ValidationError("La renta necesita una unidad de inventario.")
            if self.inventario.condicion == 'nueva':
                raise ValidationError("Las unidades nuevas no se rentan, solo se venden.")
            if self.inventario.estado in ('vendido', 'mantenimiento'):
                raise ValidationError(
                    f"La unidad {self.inventario.codigo} está "
                    f"{self.inventario.get_estado_display().lower()} y no puede rentarse."
                )
            if self.estado == 'reservada' and self.fecha_inicio and self.fecha_inicio < timezone.localdate():
                raise ValidationError("Una reserva no puede iniciar en una fecha pasada.")

            # Sin traslape con otras rentas activas/reservadas de la misma unidad
            solapadas = Renta.objects.filter(
                inventario_id=self.inventario_id,
                estado__in=['activa', 'reservada'],
                fecha_inicio__lte=self.fecha_fin,
                fecha_fin__gte=self.fecha_inicio,
            )
            if self.pk:
                solapadas = solapadas.exclude(pk=self.pk)
            if solapadas.exists():
                raise ValidationError(
                    "La unidad ya tiene una renta activa o reservada que se traslapa con esas fechas."
                )

    # ─────────────────────────────────────────────
    #  PERSISTENCIA
    # ─────────────────────────────────────────────
    @transaction.atomic
    def save(self, *args, **kwargs):
        es_nueva = self.pk is None
        if not self.fecha_fin:
            self.fecha_fin = self.calcular_fecha_fin()
        self.recalcular_montos()
        self.full_clean()
        super().save(*args, **kwargs)
        # Fuente ÚNICA: solo una renta ACTIVA nueva ocupa la unidad.
        if es_nueva and self.estado == 'activa':
            self.inventario.ocupar_por_renta(self.direccion or 'Cliente (en renta)')

    # ─────────────────────────────────────────────
    #  PROPIEDADES
    # ─────────────────────────────────────────────
    @property
    def vencida(self) -> bool:
        return self.estado == 'activa' and timezone.localdate() > self.fecha_fin

    @property
    def dias_restantes(self) -> int:
        return (self.fecha_fin - timezone.localdate()).days

    @property
    def cliente_nombre(self) -> str:
        if self.empresa_id and self.empresa:
            return self.empresa.nombre
        return self.cliente or 'Cliente'

    # ─────────────────────────────────────────────
    #  TRANSICIONES DE CICLO DE VIDA
    # ─────────────────────────────────────────────
    @transaction.atomic
    def activar(self):
        """reservada -> activa (cuando llega la fecha de inicio). Ocupa la unidad."""
        if self.estado != 'reservada':
            return
        self.estado = 'activa'
        self.save(update_fields=['estado', 'actualizado_en'])
        self.inventario.ocupar_por_renta(self.direccion or 'Cliente (en renta)')

    @transaction.atomic
    def finalizar(self, fecha_devolucion=None, commit=True):
        """Devolución del equipo: registra fecha real, calcula recargo y libera la unidad."""
        if self.estado not in ('activa', 'reservada'):
            return
        hoy = fecha_devolucion or timezone.localdate()
        era_activa = self.estado == 'activa'
        self.fecha_devolucion_real = hoy
        if era_activa and hoy > self.fecha_fin:
            dias_retraso = (hoy - self.fecha_fin).days
            self.recargo = (self.tarifa_diaria() * Decimal(dias_retraso)).quantize(Decimal('0.01'))
        self.estado = 'finalizada'
        if commit:
            # 'iva' va incluido: al agregar el recargo, recalcular_montos() lo
            # recomputa; omitirlo dejaría el IVA guardado desfasado del total.
            self.save(update_fields=[
                'estado', 'fecha_devolucion_real', 'recargo',
                'subtotal', 'iva', 'total', 'actualizado_en',
            ])
        if era_activa:
            self.inventario.liberar('Bodega')

    @transaction.atomic
    def cancelar(self, motivo=''):
        """Cancela la renta (reserva o activa) y libera la unidad si estaba ocupada."""
        if self.estado in ('finalizada', 'cancelada'):
            return
        era_activa = self.estado == 'activa'
        self.estado = 'cancelada'
        if motivo:
            self.observaciones = ((self.observaciones or '') + f"\nCancelada: {motivo}").strip()
        self.save(update_fields=['estado', 'observaciones', 'actualizado_en'])
        if era_activa:
            self.inventario.liberar('Bodega')
        # Saca la renta de la bandeja "Por facturar" (no se factura algo cancelado).
        self.solicitudes_factura.filter(estado='pendiente').update(estado='cancelada')

    def __str__(self):
        return (
            f"{self.inventario.codigo} | "
            f"{self.modalidad} x {self.duracion} | "
            f"{self.estado}"
        )


class EvidenciaRenta(models.Model):
    """Fotos del estado del equipo al entregarlo y al recibirlo de vuelta.

    En renta de maquinaria la discusión típica es "así te la entregué" contra
    "así me la devolviste", y de ahí depende si se retiene el depósito. Sin
    fotos fechadas esa conversación no se puede ganar. Cada foto queda amarrada
    a la renta, al momento y a quien la subió.
    """
    MOMENTOS = [('entrega', 'Al entregar'), ('devolucion', 'Al recibir de vuelta')]

    renta = models.ForeignKey(Renta, on_delete=models.CASCADE, related_name='evidencias')
    momento = models.CharField(max_length=10, choices=MOMENTOS)
    imagen = models.ImageField(upload_to='rentas/evidencias/')
    nota = models.CharField(max_length=200, blank=True, default='', help_text='Ej. "Rayón en la tapa"')
    subida_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='evidencias_renta',
    )
    # Fecha que la cámara grabó en la foto (EXIF). Se guarda como dato, no como
    # regla: muchos teléfonos la borran al comprimir, así que su ausencia no
    # significa nada. Solo sirve para que admin note un desfase evidente.
    tomada_en = models.DateTimeField(null=True, blank=True)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'renta_evidencias'
        verbose_name = 'Evidencia de renta'
        verbose_name_plural = 'Evidencias de renta'
        ordering = ['momento', 'id']

    def __str__(self):
        return f'{self.renta_id} · {self.get_momento_display()}'
