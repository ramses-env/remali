from decimal import Decimal

from django.db import models, transaction
from django.conf import settings

# IVA México. Los precios se capturan SIN IVA (son el subtotal). El IVA (16%)
# solo se SUMA cuando el cliente pedirá factura (aplica_iva=True).
IVA_RATE = Decimal('0.16')


def evaluar_anticipo(precio, anticipo, codigo='', user=None):
    """Valida un anticipo de apartado contra el mínimo configurado.

    Devuelve (anticipo_nota, error) donde `error` es None o {'detalle','status'}.
    Un anticipo menor al mínimo solo se acepta con el CÓDIGO PERSONAL del operador
    que lo registra (`user`), y deja rastro de QUIÉN autorizó en `anticipo_nota`.
    """
    from maquinaria.models import ConfiguracionSitio
    from maquinaria.seguridad import verificar_codigo
    precio = Decimal(str(precio or 0))
    anticipo = Decimal(str(anticipo or 0))
    if anticipo <= 0:
        return '', {'detalle': 'Captura el anticipo que deja el cliente para apartar.', 'status': 400}
    if anticipo >= precio:
        return '', {'detalle': 'El anticipo cubre el total: registra una venta normal, no un apartado.', 'status': 400}
    cfg = ConfiguracionSitio.get_solo()
    pct_min = Decimal(str(cfg.anticipo_minimo_pct or 0))
    minimo = (precio * pct_min / Decimal('100')).quantize(Decimal('0.01'))
    if anticipo < minimo:
        ok, detalle, status, _cod = verificar_codigo(user, codigo)
        if not ok:
            return '', {'detalle': f'Anticipo menor al mínimo ({int(pct_min)}%). {detalle}', 'status': status}
        pct_dado = (anticipo / precio * Decimal('100')).quantize(Decimal('0.1'))
        quien = getattr(user, 'username', '') or 's/d'
        return f'Anticipo {pct_dado}% (mínimo {int(pct_min)}%), autorizado por {quien}.', None
    return '', None


class Venta(models.Model):
    METODO_PAGO = [
        ('efectivo', 'Efectivo'),
        ('tarjeta', 'Tarjeta'),
        ('transferencia', 'Transferencia'),
    ]

    ESTADOS = [
        ('apartada', 'Apartada'),   # con anticipo; saldo pendiente y/o sobre pedido
        ('activa', 'Activa'),       # venta consumada (liquidada y entregada)
        ('cancelada', 'Cancelada'),
    ]

    # Folio por ejercicio: VEN-AAAA-NNNN, el consecutivo reinicia cada año.
    # Nace al crear la venta (save); los registros viejos sin folio caen a #id.
    folio = models.CharField(max_length=20, unique=True, editable=False, blank=True, null=True)

    # ── Cliente ──
    # `cliente`/`contacto` son la identidad del padrón: la única. Los campos de
    # texto de abajo se conservan como respaldo legible del documento (lo que se
    # capturó el día de la venta), no como forma alterna de identificar a nadie.
    cliente = models.ForeignKey(
        'clientes.Cliente',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='ventas',
    )
    contacto = models.ForeignKey(
        'clientes.Contacto',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='ventas',
    )

    nombre_cliente = models.CharField(max_length=255, blank=True, null=True)
    telefono_cliente = models.CharField(max_length=40, blank=True, default='')

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

    # Cuenta de CLIENTE ligada a la venta. Es DISTINTA de `usuario` (que es el
    # vendedor/operador): se llena cuando el cliente reclama la liga, para que la
    # compra pueda aparecer en su cuenta.
    cliente_usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='compras_cliente',
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

    # Rastro cuando el precio se AJUSTÓ a mano al vender (botón "Ajustar precio"):
    # queda "de lista $X → $Y. Motivo: …". Quién lo hizo = `usuario`; cuándo = `fecha`.
    nota_ajuste = models.CharField(max_length=300, blank=True, default='')

    # ── Apartado / pedido con anticipo ────────────────────────────────
    # Una venta 'apartada' se paga en abonos (viven en `pagos`); el saldo se cobra
    # contra entrega. Al entregar pasa a 'activa'. El IVA/total son completos desde
    # el día uno; los abonos solo bajan el saldo.
    sobre_pedido = models.BooleanField(
        default=False,
        help_text='Apartado de una máquina sin stock (se manda a pedir; la unidad se asigna al llegar).',
    )
    # Equipo pedido cuando aún no hay unidad física asignada (sobre pedido).
    equipo = models.ForeignKey(
        'maquinaria.Equipo',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='ventas_sobre_pedido',
    )
    fecha_estimada_entrega = models.DateField(null=True, blank=True)
    # Seguimiento del SOBRE PEDIDO para el cliente: confirmado (anticipo dado) →
    # en_camino (surtido con el proveedor) → en_sucursal (llegó, listo para
    # recoger/entregar). Al entregar, la venta pasa a 'activa' y el seguimiento
    # se muestra como "entregado". Solo aplica cuando sobre_pedido=True.
    PEDIDO_FASES = [
        ('confirmado', 'Confirmado'),
        ('en_camino', 'En camino'),
        ('en_sucursal', 'En sucursal'),
    ]
    pedido_fase = models.CharField(max_length=12, choices=PEDIDO_FASES, default='confirmado')
    entregada_en = models.DateTimeField(null=True, blank=True)
    entregada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='ventas_entregadas',
    )
    # Rastro si el anticipo fue MENOR al mínimo (autorizado con código).
    anticipo_nota = models.CharField(max_length=300, blank=True, default='')

    class Meta:
        db_table = 'ventas'
        verbose_name = 'Venta'
        verbose_name_plural = 'Ventas'
        ordering = ['-fecha']
        indexes = [
            models.Index(fields=['estado', '-fecha']),
            # Filtro por periodo (año/mes/rango) sobre la fecha de la venta.
            models.Index(fields=['fecha']),
        ]

    def generar_folio(self):
        """VEN-AAAA-NNNN con el consecutivo reiniciado por año."""
        from server.periodos import anio_actual
        prefijo = f'VEN-{anio_actual()}-'
        ultimo = Venta.objects.filter(folio__startswith=prefijo).aggregate(m=models.Max('folio'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                n = 1
        return f'{prefijo}{n:04d}'

    # ─────────────────────────────────────────────
    #  MONTOS
    # ─────────────────────────────────────────────
    def recalcular_total(self):
        """El precio de venta (máquina y refacciones) YA INCLUYE IVA (16%): es un
        precio al público, así que NO se le suma ningún impuesto encima. El total
        es esa suma tal cual; el IVA se DESGLOSA del total (total / 1.16) solo para
        mostrarlo en el comprobante y la factura — igual que hace la cotización."""
        total = Decimal(self.precio_maquina or 0)
        # Los items solo existen si la venta ya fue guardada (tiene PK)
        if self.pk:
            for item in self.items.all():
                total += item.subtotal
        total = total.quantize(Decimal('0.01'))
        self.total = total
        # IVA incluido → se desglosa hacia atrás, nunca se suma encima.
        self.subtotal = (total / (Decimal('1') + IVA_RATE)).quantize(Decimal('0.01'))
        self.iva = (total - self.subtotal).quantize(Decimal('0.01'))

    # ─────────────────────────────────────────────
    #  ANTICIPO / SALDO / ENTREGA (apartado)
    # ─────────────────────────────────────────────
    def pagado(self):
        """Suma de abonos registrados en `pagos`."""
        return sum((Decimal(str(p.get('monto', 0))) for p in (self.pagos or [])), Decimal('0'))

    def saldo_pendiente(self):
        """Lo que el cliente aún debe (total − abonos). Nunca negativo."""
        return max((self.total or Decimal('0')) - self.pagado(), Decimal('0'))

    @property
    def liquidada(self):
        return self.saldo_pendiente() <= 0

    @transaction.atomic
    def entregar(self, unidad=None, user=None):
        """Cierra un apartado: exige saldo 0; asigna y marca vendida la unidad
        (si es sobre pedido) o marca vendida la ya apartada; pasa a 'activa'."""
        if self.estado != 'apartada':
            raise ValueError('Solo se puede entregar una venta apartada.')
        if self.saldo_pendiente() > 0:
            raise ValueError(f'Falta liquidar el saldo (${self.saldo_pendiente()}).')
        from django.utils import timezone
        if self.sobre_pedido or not self.inventario:
            if unidad is None:
                raise ValueError('Se requiere una unidad para entregar un pedido sobre pedido.')
            if not unidad.puede_venderse():
                raise ValueError(f'La unidad {unidad.codigo} no está disponible.')
            self.inventario = unidad
            unidad.marcar_vendido()
        else:
            self.inventario.entregar_apartado()
        self.estado = 'activa'
        self.entregada_en = timezone.now()
        if user is not None and getattr(user, 'is_authenticated', False):
            self.entregada_por = user
        self.save(update_fields=['inventario', 'estado', 'entregada_en', 'entregada_por'])

    @transaction.atomic
    def save(self, *args, **kwargs):
        if self.nombre_cliente:
            from maquinaria.models import nombre_propio
            self.nombre_cliente = nombre_propio(self.nombre_cliente)
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

        # Folio por ejercicio (VEN-AAAA-NNNN), solo al crear. Reintenta si dos
        # ventas se registran a la vez y chocan por el consecutivo (folio único).
        if es_nueva and not self.folio:
            from django.db import IntegrityError
            ultimo_error = None
            for _ in range(6):
                self.folio = self.generar_folio()
                try:
                    with transaction.atomic():
                        super().save(*args, **kwargs)
                    ultimo_error = None
                    break
                except IntegrityError as e:
                    ultimo_error = e
            if ultimo_error:
                raise ultimo_error
        else:
            super().save(*args, **kwargs)

        # Fuente única: la venta transiciona la unidad según su estado.
        #  • activa   → vendida de inmediato (venta normal / liquidada).
        #  • apartada → reservada (apartado); se marca vendida al entregar.
        if es_nueva and self.inventario:
            if self.estado == 'apartada':
                self.inventario.apartar()
            else:
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
        # Devolver la máquina a inventario (vendida o apartada). Un apartado
        # sobre pedido sin unidad no toca inventario. Los abonos NO se borran:
        # quedan como rastro; el reembolso del anticipo es una acción manual.
        if self.inventario and self.inventario.estado in ('vendido', 'apartado'):
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


# ─────────────────────────────────────────────────────────────────────────────
# CAJA · SESIÓN · MOVIMIENTOS
#
# La caja es un concepto aparte del rol y del permiso: quién PUEDE operarla lo
# decide el permiso (usar_caja); qué DINERO hay dentro lo lleva una SESIÓN (un
# turno). Una venta de mostrador exige una sesión abierta, y cada evento queda
# en un LIBRO que no se borra: cancelar o devolver genera un movimiento inverso,
# nunca elimina el original.
# ─────────────────────────────────────────────────────────────────────────────
class Caja(models.Model):
    """El cajón físico. Puede haber varias; se siembra una principal."""
    nombre = models.CharField(max_length=80, unique=True)
    activa = models.BooleanField(default=True)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cajas'
        verbose_name = 'Caja'
        verbose_name_plural = 'Cajas'
        ordering = ['nombre']

    def __str__(self):
        return self.nombre


class SesionCaja(models.Model):
    """Un turno de caja: se abre con un fondo inicial y se cierra con el arqueo.
    Máximo una abierta por usuario a la vez (lo garantiza la BD)."""
    ABIERTA, CERRADA = 'abierta', 'cerrada'
    ESTADOS = [(ABIERTA, 'Abierta'), (CERRADA, 'Cerrada')]

    caja = models.ForeignKey(Caja, on_delete=models.PROTECT, related_name='sesiones')
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='sesiones_caja')
    abierta_en = models.DateTimeField(auto_now_add=True)
    monto_inicial = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    cerrada_en = models.DateTimeField(null=True, blank=True)
    # Se calculan al cerrar (arqueo). Nulos mientras la sesión sigue abierta.
    monto_esperado = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    monto_contado = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    diferencia = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADOS, default=ABIERTA)
    notas_cierre = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = 'sesiones_caja'
        verbose_name = 'Sesión de caja'
        verbose_name_plural = 'Sesiones de caja'
        ordering = ['-abierta_en']
        constraints = [
            # Nadie puede tener dos cajas abiertas a la vez: la BD lo impide.
            models.UniqueConstraint(
                fields=['usuario'], condition=models.Q(estado='abierta'),
                name='una_sesion_abierta_por_usuario',
            ),
        ]

    def __str__(self):
        return f'Sesión #{self.id} · {self.caja} · {self.usuario_id}'

    def efectivo_esperado(self) -> Decimal:
        """Lo que DEBERÍA haber en el cajón: suma con signo de los movimientos
        que tocan efectivo (apertura, ventas en efectivo, entradas, retiros,
        devoluciones, ajustes). Tarjeta y transferencia no cuentan."""
        from django.db.models import Sum
        s = self.movimientos.filter(afecta_efectivo=True).aggregate(s=Sum('monto'))['s']
        return s or Decimal('0')

    def totales_por_metodo(self) -> dict:
        """{metodo: total} de las ventas del turno (todas, no solo efectivo)."""
        from django.db.models import Sum
        out = {}
        qs = self.movimientos.filter(tipo=MovimientoCaja.VENTA).values('metodo_pago').annotate(t=Sum('monto'))
        for row in qs:
            out[row['metodo_pago'] or 'efectivo'] = row['t'] or Decimal('0')
        return out


class MovimientoCaja(models.Model):
    """Cada evento de la caja, en orden. Append-only: NUNCA se borra. Una
    cancelación o devolución crea un movimiento inverso y deja el original."""
    APERTURA = 'apertura'; VENTA = 'venta'; DEVOLUCION = 'devolucion'
    ENTRADA = 'entrada'; RETIRO = 'retiro'; AJUSTE = 'ajuste'; CIERRE = 'cierre'
    TIPOS = [
        (APERTURA, 'Apertura'), (VENTA, 'Venta'), (DEVOLUCION, 'Devolución'),
        (ENTRADA, 'Entrada de efectivo'), (RETIRO, 'Retiro de efectivo'),
        (AJUSTE, 'Ajuste'), (CIERRE, 'Cierre'),
    ]

    sesion = models.ForeignKey(SesionCaja, on_delete=models.PROTECT, related_name='movimientos')
    caja = models.ForeignKey(Caja, on_delete=models.PROTECT, related_name='movimientos')
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='movimientos_caja')
    tipo = models.CharField(max_length=12, choices=TIPOS)
    metodo_pago = models.CharField(max_length=15, blank=True)
    # Si el movimiento mueve el cajón (efectivo). Tarjeta/transferencia = False:
    # se registran para el corte del turno pero no cuentan al arqueo de efectivo.
    afecta_efectivo = models.BooleanField(default=True)
    # Con signo: entra (+) / sale (−). Así la suma da el efectivo esperado.
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    concepto = models.CharField(max_length=200, blank=True)
    referencia = models.CharField(max_length=80, blank=True)
    venta = models.ForeignKey('ventas.Venta', on_delete=models.PROTECT, null=True, blank=True, related_name='movimientos_caja')
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'movimientos_caja'
        verbose_name = 'Movimiento de caja'
        verbose_name_plural = 'Movimientos de caja'
        ordering = ['creado_en', 'id']

    def __str__(self):
        return f'{self.get_tipo_display()} · {self.monto}'
