"""Cotizaciones: presupuestos para clientes (venta o renta), con partidas libres.

Los precios se capturan SIN IVA (son el subtotal); el IVA (16%) se suma solo si
`aplica_iva`. Una cotización aceptada puede después convertirse en venta/renta.
"""
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Max
from django.utils import timezone

IVA_RATE = Decimal('0.16')


class Cotizacion(models.Model):
    # 'mixta' no se elige a mano: sale de tener partidas de venta y de renta juntas.
    TIPOS = [('venta', 'Venta'), ('renta', 'Renta'), ('mixta', 'Venta y renta')]
    ESTADOS = [
        ('borrador', 'Borrador'),
        ('enviada', 'Enviada'),
        ('aceptada', 'Aceptada'),
        ('rechazada', 'Rechazada'),
    ]

    ORIGENES = [('admin', 'Creada por el admin'), ('cliente', 'Solicitada por el cliente')]

    folio = models.CharField(max_length=20, unique=True, editable=False, blank=True)
    tipo = models.CharField(max_length=10, choices=TIPOS, default='venta')
    origen = models.CharField(max_length=8, choices=ORIGENES, default='admin')
    # Datos extra de la solicitud del cliente (empresa en texto, obra, etc.),
    # sin ensuciar el esquema formal: {'empresa': ..., 'obra': {responsable, direccion, telefono, email}}
    datos_solicitud = models.JSONField(default=dict, blank=True)

    cliente_nombre = models.CharField(max_length=200, blank=True, default='')
    cliente_telefono = models.CharField(max_length=40, blank=True, default='')
    cliente_email = models.EmailField(blank=True, default='', help_text='Correo destino para enviar la cotización')
    empresa = models.ForeignKey('empresas.Empresa', null=True, blank=True, on_delete=models.SET_NULL, related_name='cotizaciones')
    # Cliente dueño de la solicitud, si la mandó con sesión iniciada. Es lo que
    # permite mostrarle "Mis cotizaciones" en su cuenta. Anónimo => queda null.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cotizaciones_cliente',
    )

    vigencia_dias = models.PositiveIntegerField(default=15, help_text='Días de validez de la cotización')
    # Fecha de vencimiento GUARDADA (creación + vigencia). Se persiste para poder
    # filtrar/paginar "vencidas" en la base de datos, no en memoria.
    vence_el = models.DateField(null=True, blank=True, editable=False)
    # Token para el link público (compartir la cotización por WhatsApp/correo sin
    # login). No adivinable; solo expone el PDF de ESA cotización.
    token_publico = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)
    aplica_iva = models.BooleanField(default=True, help_text='Suma IVA (16%) al total')
    estado = models.CharField(max_length=10, choices=ESTADOS, default='borrador')
    notas = models.TextField(blank=True, default='')

    # ── Atención / escalamiento (solo para solicitudes de cliente) ──
    atendida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cotizaciones_atendidas',
    )
    atendida_en = models.DateTimeField(null=True, blank=True)
    # Fecha/hora prometida de entrega (se captura al aceptar; el cliente la ve
    # en su vista de estado antes de que exista la renta/venta formal).
    entrega_prometida = models.DateTimeField(null=True, blank=True)
    # Cuándo se le mandó el recordatorio de vigencia (para no repetirlo).
    recordatorio_vigencia = models.DateTimeField(null=True, blank=True)
    escalada_en = models.DateTimeField(null=True, blank=True, help_text='Cuándo se avisó a los respaldos por falta de atención')

    creada = models.DateTimeField(auto_now_add=True)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cotizaciones'
        verbose_name = 'Cotización'
        verbose_name_plural = 'Cotizaciones'
        ordering = ['-creada']

    def generar_folio(self):
        ultimo = Cotizacion.objects.filter(folio__startswith='COT-').aggregate(m=Max('folio'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                n = 1
        return f'COT-{n:04d}'

    def save(self, *args, **kwargs):
        if not self.folio:
            self.folio = self.generar_folio()
        if not self.token_publico:
            self.token_publico = secrets.token_hex(16)
        # vence_el = alta + vigencia. En el alta `creada` la pone auto_now_add en
        # este mismo save, así que si aún no hay fecha se usa hoy (mismo día).
        base = self.creada.date() if self.creada else timezone.now().date()
        self.vence_el = base + timedelta(days=self.vigencia_dias or 0)
        super().save(*args, **kwargs)

    def recalcular_tipo(self):
        """El tipo se DERIVA de las partidas, no se declara.

        Una cotización con partidas de venta y de renta es 'mixta'. Sin partidas
        se respeta lo que eligió el admin al crearla.
        """
        modalidades = {i.modalidad for i in self.items.all()}
        if not modalidades:
            return self.tipo
        hay_venta = 'venta' in modalidades
        hay_renta = bool(modalidades - {'venta'})
        nuevo = 'mixta' if (hay_venta and hay_renta) else ('venta' if hay_venta else 'renta')
        if nuevo != self.tipo:
            self.tipo = nuevo
            self.save(update_fields=['tipo', 'actualizada'])
        return nuevo

    @property
    def subtotal(self):
        return sum((i.subtotal for i in self.items.all()), Decimal('0.00'))

    @property
    def subtotal_venta(self):
        """Solo las partidas que se venden (lo que se convierte en una Venta)."""
        return sum((i.subtotal for i in self.items.all() if i.modalidad == 'venta'), Decimal('0.00'))

    @property
    def subtotal_renta(self):
        """Solo las partidas que se rentan (se concretan creando la renta)."""
        return sum((i.subtotal for i in self.items.all() if i.modalidad != 'venta'), Decimal('0.00'))

    @property
    def base(self):
        """Base gravable (sin IVA). En VENTA el precio YA incluye IVA, así que se
        desglosa (precio / 1.16); en RENTA el subtotal ya viene sin IVA."""
        base_venta = self.subtotal_venta / (Decimal('1') + IVA_RATE)
        return (base_venta + self.subtotal_renta).quantize(Decimal('0.01'))

    @property
    def iva(self):
        """VENTA: IVA incluido en el precio, se desglosa (siempre). RENTA: se suma
        solo si el cliente pidió factura (aplica_iva)."""
        iva_venta = self.subtotal_venta - self.subtotal_venta / (Decimal('1') + IVA_RATE)
        iva_renta = (self.subtotal_renta * IVA_RATE) if self.aplica_iva else Decimal('0.00')
        return (iva_venta + iva_renta).quantize(Decimal('0.01'))

    @property
    def total(self):
        return (self.base + self.iva).quantize(Decimal('0.01'))

    @property
    def cliente_display(self):
        if self.empresa_id and self.empresa:
            return self.empresa.nombre
        return self.cliente_nombre or 'Cliente'

    @property
    def vigencia_hasta(self):
        # Guardada en vence_el; si por algo falta (registro viejo sin migrar), se
        # deriva al vuelo para no romper la carta ni el PDF.
        if self.vence_el:
            return self.vence_el
        if not self.creada:
            return None
        return (self.creada.date() + timedelta(days=self.vigencia_dias or 0))

    @property
    def vencida(self) -> bool:
        """Enviada o en borrador cuya validez ya pasó (y no se cerró)."""
        v = self.vigencia_hasta
        return self.estado in ('borrador', 'enviada') and bool(v) and v < timezone.now().date()

    def __str__(self):
        return f'{self.folio} · {self.cliente_display}'


class CotizacionItem(models.Model):
    # Qué significa el precio de esta partida: una venta o una renta por unidad
    # de tiempo. Una misma cotización puede mezclar ambas.
    MODALIDADES = [
        ('venta', 'Venta'),
        ('dia', 'Renta por día'),
        ('semana', 'Renta por semana'),
        ('mes', 'Renta por mes'),
    ]
    UNIDADES_RENTA = {'dia': 'día', 'semana': 'semana', 'mes': 'mes'}

    cotizacion = models.ForeignKey(Cotizacion, on_delete=models.CASCADE, related_name='items')
    descripcion = models.CharField(max_length=255)
    cantidad = models.PositiveIntegerField(default=1)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), help_text='Precio unitario SIN IVA')
    modalidad = models.CharField(max_length=8, choices=MODALIDADES, default='venta')

    class Meta:
        db_table = 'cotizacion_items'
        ordering = ['id']

    @property
    def es_renta(self):
        return self.modalidad != 'venta'

    @property
    def modalidad_label(self):
        return dict(self.MODALIDADES).get(self.modalidad, 'Venta')

    @property
    def subtotal(self):
        return (Decimal(self.precio_unitario or 0) * self.cantidad).quantize(Decimal('0.01'))

    def __str__(self):
        return f'{self.descripcion} x{self.cantidad}'


class CotizacionFoto(models.Model):
    """Fotos que acompañan la cotización (el equipo ofertado, una referencia).

    A diferencia de la evidencia de una renta —que prueba en qué estado salió y
    volvió una máquina y por eso se congela— estas son apoyo visual: le muestran
    al cliente qué se le está cotizando. Salen en la carta y en el PDF que recibe.
    Como no prueban nada, se pueden agregar y quitar mientras la cotización exista.
    """
    cotizacion = models.ForeignKey(Cotizacion, on_delete=models.CASCADE, related_name='fotos')
    imagen = models.ImageField(upload_to='cotizaciones/fotos/')
    # El admin decide el orden en que aparecen; se rellena con el siguiente hueco
    # al subir, así el orden de captura se respeta sin que tenga que tocarlo.
    orden = models.PositiveIntegerField(default=0)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cotizacion_fotos'
        ordering = ['orden', 'id']

    def __str__(self):
        return f'{self.cotizacion_id} · foto {self.pk}'
