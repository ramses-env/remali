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

from . import precios

from .precios import IVA_RATE  # noqa: E402  (re-export: la tasa vive en precios.py)


class Cotizacion(models.Model):
    # 'mixta' no se elige a mano: sale de tener partidas de venta y de renta juntas.
    TIPOS = [('venta', 'Venta'), ('renta', 'Renta'), ('mixta', 'Venta y renta')]
    ESTADOS = [
        ('borrador', 'Borrador'),
        ('enviada', 'Enviada'),
        ('aceptada', 'Aceptada'),
        ('rechazada', 'Rechazada'),
        # Cancelación pedida por el cliente y APROBADA por administración.
        ('cancelada', 'Cancelada'),
    ]

    ORIGENES = [('admin', 'Creada por el admin'), ('cliente', 'Solicitada por el cliente')]

    folio = models.CharField(max_length=20, unique=True, editable=False, blank=True, null=True)
    tipo = models.CharField(max_length=10, choices=TIPOS, default='venta')
    origen = models.CharField(max_length=8, choices=ORIGENES, default='admin')
    # Datos extra de la solicitud del cliente (empresa en texto, obra, etc.),
    # sin ensuciar el esquema formal: {'empresa': ..., 'obra': {responsable, direccion, telefono, email}}
    datos_solicitud = models.JSONField(default=dict, blank=True)

    # ── Cliente ──
    # `cliente`/`contacto` son la identidad NUEVA (padrón único). Los campos
    # cliente_nombre / cliente_telefono / cliente_email / empresa / usuario son
    # la forma vieja: espejo de solo lectura en la fase 1, se van en la fase 3.
    cliente = models.ForeignKey(
        'clientes.Cliente',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='cotizaciones',
    )
    contacto = models.ForeignKey(
        'clientes.Contacto',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='cotizaciones',
    )

    cliente_nombre = models.CharField(max_length=200, blank=True, default='')
    cliente_telefono = models.CharField(max_length=40, blank=True, default='')
    cliente_email = models.EmailField(blank=True, default='', help_text='Correo destino para enviar la cotización')
    # Cliente dueño de la solicitud, si la mandó con sesión iniciada. Es lo que
    # permite mostrarle "Mis cotizaciones" en su cuenta. Anónimo => queda null.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cotizaciones_cliente',
    )
    # Cupón que el cliente aplicó a ESTA cotización (p.ej. su 5% de bienvenida).
    # Se guarda aquí para poder "gastarlo" recién cuando la cotización se
    # concreta en venta/renta, no antes: si nunca prospera, el cliente no lo
    # pierde. SET_NULL para no romper el historial si el cupón se borra.
    cupon = models.ForeignKey(
        'maquinaria.Cupon', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cotizaciones',
    )

    vigencia_dias = models.PositiveIntegerField(default=15, help_text='Días de validez de la cotización')
    # Fecha de vencimiento GUARDADA (creación + vigencia). Se persiste para poder
    # filtrar/paginar "vencidas" en la base de datos, no en memoria.
    vence_el = models.DateField(null=True, blank=True, editable=False)
    # Cuándo quedó aceptada/autorizada: arranca el reloj de "sin respuesta del
    # cliente en 15 días, no se hace" (el cierre lo aplica recordar_vigencia).
    aceptada_en = models.DateTimeField(null=True, blank=True)
    # Token para el link público (compartir la cotización por WhatsApp/correo sin
    # login). No adivinable; solo expone el PDF de ESA cotización.
    token_publico = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)
    aplica_iva = models.BooleanField(default=True, help_text='Suma IVA (16%) al total')
    estado = models.CharField(max_length=15, choices=ESTADOS, default='borrador')
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
    # Liga de vinculación de un solo uso: el cliente la abre con su sesión y la
    # cotización queda en SU cuenta (mismo mecanismo que ventas/rentas — con
    # cientos de clientes, buscar en un selector no escala).
    token_vinculo = models.CharField(max_length=64, null=True, blank=True, unique=True)
    token_vinculo_expira = models.DateTimeField(null=True, blank=True)
    # Si vino firmada por el autorizador del cliente: quién y cuándo. La liga,
    # el rechazo y el lote viven en el borrador (models_borrador.py) — a REMALI
    # solo le llega el resultado, no el forcejeo interno del cliente.
    autorizada_por = models.CharField(max_length=120, blank=True, default='')
    autorizada_en = models.DateTimeField(null=True, blank=True)
    # El cliente pidió cancelarla (REMALI decide): cuándo y por qué.
    cancelacion_solicitada = models.DateTimeField(null=True, blank=True)
    cancelacion_motivo = models.TextField(blank=True, default='')
    escalada_en = models.DateTimeField(null=True, blank=True, help_text='Cuándo se avisó a los respaldos por falta de atención')

    creada = models.DateTimeField(auto_now_add=True)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cotizaciones'
        verbose_name = 'Cotización'
        verbose_name_plural = 'Cotizaciones'
        ordering = ['-creada']
        # Los listados filtran por estado y ordenan por fecha; el índice evita
        # el filesort y el escaneo completo conforme crece el historial.
        indexes = [
            models.Index(fields=['estado', '-creada']),
            # Filtro por periodo (año/mes/rango) sobre la fecha de alta.
            models.Index(fields=['creada']),
        ]

    def generar_folio(self):
        # Folio por ejercicio: COT-AAAA-NNNN, el consecutivo reinicia cada año.
        # Se filtra por el prefijo del año, así el Max() (comparación de texto)
        # coincide con el orden numérico dentro del mismo año.
        from server.periodos import anio_actual
        prefijo = f'COT-{anio_actual()}-'
        ultimo = Cotizacion.objects.filter(folio__startswith=prefijo).aggregate(m=Max('folio'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                n = 1
        return f'{prefijo}{n:04d}'

    def save(self, *args, **kwargs):
        # Regla de la casa: los nombres entran como nombre propio, se capturen
        # donde se capturen (tienda, panel, API). Siglas cortas se respetan.
        if self.cliente_nombre:
            from maquinaria.models import nombre_propio
            self.cliente_nombre = nombre_propio(self.cliente_nombre)
        # El folio nace cuando la cotización se vuelve REAL (deja el borrador),
        # no al abrir el modal: así los borradores abandonados no consumen
        # folios ni dejan huecos, y dos admins no compiten por el número.
        if not self.folio and self.estado != 'borrador':
            self.folio = self.generar_folio()
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = list(set(kwargs['update_fields']) | {'folio'})
        if not self.token_publico:
            self.token_publico = secrets.token_hex(16)
        # Sello de aceptación (una sola vez): por aquí pasan TODOS los caminos
        # (panel, autorización del jefe), así que nadie se queda sin reloj.
        if self.estado == 'aceptada' and not self.aceptada_en:
            self.aceptada_en = timezone.now()
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = list(set(kwargs['update_fields']) | {'aceptada_en'})
        # vence_el = alta + vigencia. En el alta `creada` la pone auto_now_add en
        # este mismo save, así que si aún no hay fecha se usa hoy (mismo día).
        base = self.creada.date() if self.creada else timezone.now().date()
        self.vence_el = base + timedelta(days=self.vigencia_dias or 0)
        # El folio es único: si otro admin ganó el número en este instante,
        # se regenera y reintenta (savepoint para no envenenar la transacción).
        from django.db import IntegrityError, transaction as _tx
        for _ in range(5):
            try:
                with _tx.atomic():
                    super().save(*args, **kwargs)
                return
            except IntegrityError:
                if not self.folio:
                    raise
                self.folio = self.generar_folio()
        super().save(*args, **kwargs)

    def recalcular_tipo(self):
        """El tipo se DERIVA de las partidas, no se declara.

        Una cotización con partidas de venta y de renta es 'mixta'. Sin partidas
        se respeta lo que eligió el admin al crearla.
        """
        modalidades = {i.modalidad for i in self.items.all()}
        if not modalidades:
            return self.tipo
        nuevo = precios.tipo_desde_modalidades(modalidades)
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
        return precios.desglose(self.subtotal_venta, self.subtotal_renta, self.aplica_iva)[0]

    @property
    def iva(self):
        """VENTA: IVA incluido en el precio, se desglosa (siempre). RENTA: se suma
        solo si el cliente pidió factura (aplica_iva)."""
        return precios.desglose(self.subtotal_venta, self.subtotal_renta, self.aplica_iva)[1]

    @property
    def descuento_cupon(self):
        """Importe del descuento del cupón que el cliente aplicó a ESTA cotización.

        Es un % sobre el total con IVA (igual que lo muestra el PDF del cliente).

        NO mira `usado`, y es a propósito. Un cupón personal se quema en el
        momento en que se enlaza a una cotización, así que mirarlo aquí borraba
        el descuento de la cotización que acababa de gastarlo: el cliente veía
        su 5%, lo aplicaba, y el total volvía solo al precio completo.

        Lo que esa bandera quería evitar —que un código ya gastado se cuele en
        otra cotización— se resuelve donde de verdad toca, al APLICARLO
        (`maquinaria.cupones.cupon_valido_para` rechaza los personales usados).
        Aquí el enlace ya existe, y un descuento que el cliente ya reclamó no
        se le puede quitar.

        `activo` sí se mira: es el freno de emergencia del admin para un código
        que se filtró."""
        c = self.cupon
        if not c or not c.activo:
            return Decimal('0.00')
        bruto = (self.base + self.iva).quantize(Decimal('0.01'))
        return (bruto * Decimal(str(c.descuento))).quantize(Decimal('0.01'))

    @property
    def total(self):
        return (self.base + self.iva - self.descuento_cupon).quantize(Decimal('0.01'))

    # ── Precio de CONTADO (5% de venta), SIN apilar con la promo ──
    @property
    def _sub_venta_lista(self):
        return sum((i.subtotal_lista for i in self.items.all() if i.modalidad == 'venta'), Decimal('0.00'))

    @property
    def _sub_renta_lista(self):
        return sum((i.subtotal_lista for i in self.items.all() if i.modalidad != 'venta'), Decimal('0.00'))

    @property
    def total_lista(self):
        """Total a precio de LISTA (antes de promo). Base del descuento de contado."""
        base, iva = precios.desglose(self._sub_venta_lista, self._sub_renta_lista, self.aplica_iva)
        return (base + iva).quantize(Decimal('0.01'))

    @property
    def total_contado(self):
        """Mejor precio de contado (VENTA): 5% sobre el precio de LISTA, pero SIN
        apilarse con la promo — se aplica el descuento MAYOR, no la suma. Si la
        promo ya supera el 5%, el contado no baja más (queda igual al total)."""
        if self.tipo == 'renta':
            return self.total
        return min(self.total, (self.total_lista * Decimal('0.95')).quantize(Decimal('0.01')))

    @property
    def cliente_display(self):
        if self.cliente_id and self.cliente:
            return self.cliente.nombre
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


def avisar_equipo_liberado(equipo_id: int):
    """Le dice a quien cotizó este equipo que ya se liberó una máquina.

    El cliente puede cotizar algo que no hay —no se le bloquea, porque una
    cotización es justo la conversación para conseguirlo— pero entonces la
    cotización se queda esperando a que alguien devuelva una máquina, y ese
    momento no lo ve nadie: pasa un martes cualquiera cuando el técnico recoge
    en obra. Sin este aviso, la cotización se muere de vieja mientras la unidad
    que pedía está parada en la bodega.

    Se avisa UNA vez por cotización y equipo (`ref`). Si la máquina se vuelve a
    rentar y a liberar, no se repite: el segundo aviso ya no es información, es
    insistencia.

    Solo a cotizaciones VIVAS y con cuenta: sin `usuario` no hay a quién
    notificar dentro del sistema, y una cotización rechazada o cancelada ya no
    espera nada.
    """
    from maquinaria.models import crear_notificacion
    vivas = (Cotizacion.objects
             .filter(estado__in=('borrador', 'enviada', 'aceptada'),
                     usuario__isnull=False,
                     items__equipo_id=equipo_id,
                     items__modalidad__in=('dia', 'semana', 'mes'))
             .distinct()
             .select_related('usuario'))
    for cot in vivas:
        item = cot.items.filter(equipo_id=equipo_id).first()
        equipo = item.descripcion.split(' · ')[0] if item else 'el equipo'
        crear_notificacion(
            'cotizacion', 'Ya hay unidad disponible',
            f'Se liberó {equipo}, que pediste en tu cotización '
            f'{cot.folio or ""}. Escríbenos para apartarla.'.replace('  ', ' '),
            seccion='cotizaciones',
            ref=f'libre-{cot.id}-{equipo_id}',
            usuario=cot.usuario,
        )


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
    # cantidad = cuántas MÁQUINAS; duracion = cuántos PERIODOS (días/semanas/
    # meses) para renta. Son ejes distintos: 2 máquinas por 4 días = 2 × 4.
    # En venta la duración es 1 (no aplica).
    cantidad = models.PositiveIntegerField(default=1)
    duracion = models.PositiveIntegerField(default=1)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), help_text='Precio unitario SIN IVA (por periodo, si es renta)')
    # Precio de LISTA (antes de promo). 0 = sin promo → se usa precio_unitario.
    # Sirve para el descuento de contado: se toma el descuento MAYOR (promo vs 5%
    # de contado), nunca la suma de ambos.
    precio_lista = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    # De qué equipo del catálogo nació (si nació de uno): permite re-resolver
    # el precio de la web al cambiar la modalidad y mostrar la desviación
    # cuando el admin captura un precio distinto al de lista.
    equipo = models.ForeignKey('maquinaria.Equipo', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
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
    def periodos(self):
        """Periodos que se cobran: la duración en renta; 1 en venta."""
        return self.duracion if self.modalidad in ('dia', 'semana', 'mes') else 1

    @property
    def subtotal(self):
        return (Decimal(self.precio_unitario or 0) * self.cantidad * self.periodos).quantize(Decimal('0.01'))

    @property
    def subtotal_lista(self):
        """Subtotal a precio de LISTA (antes de promo). Si no hay lista, = subtotal."""
        base = Decimal(self.precio_lista or 0) or Decimal(self.precio_unitario or 0)
        return (base * self.cantidad * self.periodos).quantize(Decimal('0.01'))

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


# Los borradores del cliente viven en su propio módulo: son otro mundo (otro
# dueño, otro ciclo de vida, y REMALI no los ve). Se importan aquí para que
# Django los registre como modelos de esta app.
from .models_borrador import (  # noqa: E402,F401
    BorradorCliente,
    BorradorItem,
    PaqueteAutorizacion,
)
