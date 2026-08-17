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

    # ── Cliente ──
    # `cliente`/`contacto` son la identidad del padrón: la única. `obra` cuelga
    # de ese mismo cliente. `cliente_texto` y `telefono_cliente` se conservan
    # como respaldo legible de lo que se capturó ese día, no como forma alterna
    # de identificar a nadie.
    cliente = models.ForeignKey(
        'clientes.Cliente',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='rentas',
    )
    contacto = models.ForeignKey(
        'clientes.Contacto',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='rentas',
    )

    obra = models.ForeignKey(
        'clientes.Obra',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='rentas',
    )
    cliente_texto = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Nombre del cliente (si no es una empresa registrada)"
    )
    telefono_cliente = models.CharField(max_length=40, blank=True, default='')
    # Cuenta del cliente (si el admin la vincula): habilita "Tus rentas" en su panel.
    # Cotización de la que nació esta renta (cierra el ciclo del cliente:
    # su stepper marca "completada" cuando la renta existe).
    cotizacion = models.ForeignKey(
        'cotizaciones.Cotizacion', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='rentas_convertidas',
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='rentas_cliente',
    )

    # Liga de vinculación (un solo uso + caducidad): el admin genera el enlace y
    # el cliente, ya con sesión, liga esta renta a SU cuenta al abrirlo.
    token_vinculo = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)
    token_vinculo_expira = models.DateTimeField(null=True, blank=True, editable=False)

    # Renovación: si esta renta nació al renovar otra (el cliente pidió otro
    # día/semana/mes), apunta a la anterior. `renovaciones` da la cadena de
    # continuidad de una misma unidad/cliente.
    renta_origen = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='renovaciones',
        help_text='Renta anterior de la que ésta es continuación (renovación).')

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
    # Abonos del cliente: lista de {fecha, monto, metodo}. Muchos conocidos
    # pagan DESPUÉS de la renta; aquí vive cuánto ha entregado y cuánto debe.
    pagos = models.JSONField(default=list, blank=True)
    observaciones = models.TextField(blank=True, null=True)

    # ── 🔐 Liquidación del DEPÓSITO en garantía ──
    # El depósito se RETIENE durante la renta. Al devolver, el técnico valida la
    # máquina y decide su destino: devolverlo, dejarlo a favor (crédito), aplicarlo
    # a la deuda/daño, o —si no hubo efectivo— marcarlo "por devolver" para que la
    # empresa sepa cuánto le debe a cada cliente.
    deposito_estado = models.CharField(max_length=14, default='retenido', choices=[
        ('retenido', 'Retenido'),           # renta en curso, aún no se resuelve
        ('devuelto', 'Devuelto'),           # se le regresó al cliente (efectivo/transf.)
        ('a_favor', 'A favor del cliente'),  # crédito para su próxima renta
        ('por_devolver', 'Por devolver'),    # la empresa se lo debe (no hubo efectivo)
        ('aplicado', 'Aplicado'),           # se usó todo (deuda/daño), nada que regresar
    ])
    deposito_aplicado = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text='Parte del depósito usada para cubrir deuda de renta o daños.')
    deposito_reembolso = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text='Parte del depósito que se le regresa/acredita al cliente.')
    deposito_nota = models.CharField(max_length=255, blank=True, default='')
    deposito_resuelto_en = models.DateTimeField(null=True, blank=True)
    deposito_resuelto_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='depositos_resueltos')

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
        # Alertas ("por vencer"/"vencidas") filtran estado + fecha_fin; el
        # listado ordena por creado_en. Índices para que no haga full-scan.
        indexes = [
            models.Index(fields=['estado', 'fecha_fin']),
            models.Index(fields=['-creado_en']),
        ]

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
            # La DISPONIBILIDAD de la unidad se valida SOLO al crear la renta. Una
            # renta ya persistida ES la ocupante legítima de su unidad: re-guardarla
            # (pagos, liga de cotización, transiciones de estado) no debe fallar
            # "no disponible" contra su PROPIA ocupación. El traslape de más abajo
            # excluye self y sigue blindando contra doble-reserva.
            if self._state.adding:
                # Regla flexible: 'seminueva' siempre se renta; 'nueva' SOLO si fue
                # autorizada (autorizada_para_renta=True) por sustitución/demanda.
                if not self.inventario.puede_rentarse():
                    if self.inventario.condicion == 'nueva':
                        raise ValidationError(
                            "Unidad NUEVA no autorizada para renta. "
                            "Autorícela primero (sustitución de unidad dañada o demanda extraordinaria)."
                        )
                    raise ValidationError(
                        f"La unidad {self.inventario.codigo} no está disponible para renta "
                        f"(estado actual: {self.inventario.get_estado_display()})."
                    )
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
        if self.cliente_texto:
            from maquinaria.models import nombre_propio
            self.cliente_texto = nombre_propio(self.cliente_texto)
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
        # El padrón manda; el texto es el respaldo de lo que se capturó ese día.
        if self.cliente_id and self.cliente:
            return self.cliente.nombre
        return self.cliente_texto or 'Cliente'

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

    def saldo_pendiente(self):
        """Lo que el cliente aún debe de la renta (total + recargo − abonos)."""
        pagado = sum((Decimal(str(p.get('monto', 0))) for p in (self.pagos or [])), Decimal('0'))
        return max((self.total or Decimal('0')) + (self.recargo or Decimal('0')) - pagado, Decimal('0'))

    @transaction.atomic
    def resolver_deposito(self, *, aplicar_deuda=Decimal('0'), aplicar_dano=Decimal('0'),
                          reembolso_tipo='devuelto', nota='', user=None):
        """Cierre del depósito al devolver (lo hace el técnico).

        El depósito se parte en lo que se APLICA (a la deuda de renta y/o a daños)
        y lo que se REEMBOLSA al cliente. Aplicar a la deuda se registra como un
        abono desde la garantía (baja el saldo). El reembolso se marca según cómo
        se entregó: 'devuelto' (efectivo), 'a_favor' (crédito) o 'por_devolver'
        (la empresa se lo queda debiendo).
        """
        if self.deposito_estado != 'retenido':
            return  # ya se resolvió una vez; no re-aplicar (evitaría doble abono)
        dep = Decimal(self.deposito or 0)
        aplicar_deuda = max(Decimal('0'), min(Decimal(str(aplicar_deuda or 0)), dep))
        aplicar_dano = max(Decimal('0'), min(Decimal(str(aplicar_dano or 0)), dep - aplicar_deuda))
        aplicado = (aplicar_deuda + aplicar_dano).quantize(Decimal('0.01'))
        reembolso = (dep - aplicado).quantize(Decimal('0.01'))

        # Aplicar a la deuda = abono desde la garantía (baja el saldo del cliente).
        if aplicar_deuda > 0:
            pagos = list(self.pagos or [])
            pagos.append({
                'fecha': timezone.now().isoformat(),
                'monto': str(aplicar_deuda.quantize(Decimal('0.01'))),
                'metodo': 'deposito',
                'nota': 'Aplicado de la garantía',
            })
            self.pagos = pagos

        if reembolso <= 0:
            estado = 'aplicado'
        elif reembolso_tipo in ('devuelto', 'a_favor', 'por_devolver'):
            estado = reembolso_tipo
        else:
            estado = 'devuelto'

        self.deposito_aplicado = aplicado
        self.deposito_reembolso = reembolso
        self.deposito_estado = estado
        self.deposito_nota = (nota or '')[:255]
        self.deposito_resuelto_en = timezone.now()
        self.deposito_resuelto_por = user
        self.save(update_fields=[
            'pagos', 'deposito_aplicado', 'deposito_reembolso', 'deposito_estado',
            'deposito_nota', 'deposito_resuelto_en', 'deposito_resuelto_por', 'actualizado_en',
        ])

    @transaction.atomic
    def marcar_deposito_saldado(self, *, user=None, nota=''):
        """La empresa por fin le REGRESÓ al cliente el depósito que le debía:
        pasa de 'por_devolver' (o 'a_favor') a 'devuelto'."""
        if self.deposito_estado not in ('por_devolver', 'a_favor'):
            return
        self.deposito_estado = 'devuelto'
        if nota:
            self.deposito_nota = f'{self.deposito_nota} · {nota}'.strip(' ·')[:255]
        self.deposito_resuelto_en = timezone.now()
        self.deposito_resuelto_por = user
        self.save(update_fields=[
            'deposito_estado', 'deposito_nota', 'deposito_resuelto_en',
            'deposito_resuelto_por', 'actualizado_en',
        ])

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
