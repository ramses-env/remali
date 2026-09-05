from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.core.exceptions import ValidationError
from django.utils import timezone

from inventario.models import Inventario

def nota_de_liquidacion(total, pagado):
    """Si la máquina se recogió por debajo del piso, la frase que lo deja anotado.
    Cadena vacía cuando el cliente sí llegó (no hay nada que reportar).

    Ojo con lo que esta función NO hace: **no bloquea**. Y no es un descuido.

    La primera versión sí frenaba la recolección hasta llegar al piso, y estaba
    mal por dos razones que solo se ven en campo:

    1. El recargo. `finalizar()` cobra `tarifa_diaria × días de retraso` y ese
       recargo entra en `total`, que es la base del piso. Así que NO recoger
       subía el piso al día siguiente: un faltante de $250 se volvía uno de
       $1,000 en 24 horas. El candado hacía crecer la deuda que quería cobrar.
    2. Al final de una renta la empresa QUIERE su máquina de vuelta. Negarse a
       recogerla no presiona al cliente —él se queda con la máquina y nosotros
       sin ella, sin poder rentarla y cargando con el riesgo si se daña—.

    La palanca de cobro se mudó a donde sí hay presión y donde sí hay un
    administrador presente: la ENTREGA de la siguiente renta (ver
    `adeudo_vencido_de` y `entregar_renta`).

    Aquí queda el rastro y el aviso: administración se entera el mismo día y
    persigue el cobro. Control por revisión, no por permiso previo.
    """
    from maquinaria.models import ConfiguracionSitio

    total = Decimal(str(total or 0))
    pagado = Decimal(str(pagado or 0))
    saldo = max(total - pagado, Decimal('0'))
    if saldo <= 0:
        return ''                  # liquidada: nada que anotar

    pct_min = Decimal(str(ConfiguracionSitio.get_solo().renta_liquidacion_minima_pct or 0))
    if pct_min <= 0:
        return ''                  # piso apagado: la empresa fía sin condiciones

    minimo = (total * pct_min / Decimal('100')).quantize(Decimal('0.01'))
    if pagado >= minimo:
        return ''                  # llegó al piso; el resto es cobranza normal

    pct_dado = (pagado / total * Decimal('100')).quantize(Decimal('0.1')) if total > 0 else Decimal('0')
    return (f'Recogida con {pct_dado}% abonado (mínimo {int(pct_min)}%). '
            f'Saldo ${saldo} a cobranza.')


def adeudo_vencido_de(*, cliente_id=None, usuario_id=None, nombre='', excluir_id=None):
    """Cuánto debe ESTE cliente de rentas que YA TERMINARON.

    "Vencido" = la máquina volvió y el dinero no. Una renta viva con saldo no
    cuenta: el cliente todavía la está usando y todavía está en tiempo de abonar.

    La identidad se resuelve como en `rentas_adeudos`: manda el padrón
    (`cliente_id`), luego la cuenta (`usuario_id`) y solo al final el texto del
    nombre —"Naomi" y "Naomí Pérez" son dos personas para una cadena, así que el
    texto es el último recurso y va normalizado—.

    Devuelve (total_adeudado, cuántas rentas).
    """
    qs = Renta.objects.filter(estado='finalizada')
    if excluir_id:
        qs = qs.exclude(pk=excluir_id)

    if cliente_id:
        qs = qs.filter(cliente_id=cliente_id)
    elif usuario_id:
        qs = qs.filter(usuario_id=usuario_id)
    else:
        limpio = (nombre or '').strip().lower()
        if not limpio:
            # Sin forma de identificar a nadie no se le puede cobrar un pasado a
            # alguien: mejor dejar pasar que frenar al cliente equivocado.
            return Decimal('0.00'), 0
        # Solo `cliente_texto` es columna; `cliente_nombre` es una propiedad y
        # no se puede filtrar por ella en la base.
        qs = qs.filter(cliente_texto__iexact=limpio)

    total = Decimal('0.00')
    cuantas = 0
    for r in qs.only('id', 'total', 'pagos'):
        saldo = r.saldo_pendiente()
        if saldo > 0:
            total += saldo
            cuantas += 1
    return total.quantize(Decimal('0.01')), cuantas


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
    # Hora ESTIMADA de entrega, aparte de la fecha y opcional.
    #
    # Va como campo suelto y no convirtiendo `fecha_inicio` en fecha-y-hora a
    # propósito: esa fecha la usan el cálculo del vencimiento, el traslape de
    # reservas y los recordatorios, y cambiarle el tipo tocaría todo eso sin
    # ninguna necesidad. Así el día sigue mandando y la hora solo acompaña.
    #
    # Es lo único que le puede decir al cliente "llega como a las 10": la renta
    # solo guardaba el día, y su agenda de próximas entregas anclaba todo al
    # mediodía porque no había hora que mostrar. Vacía, todo queda como antes.
    hora_entrega_estimada = models.TimeField(
        null=True, blank=True,
        help_text='Hora aproximada en que se le entrega al cliente. Opcional.',
    )
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
    # Rastro de quién dejó recoger la máquina por debajo del piso de liquidación
    # y con cuánto. Gemelo de `Venta.anticipo_nota`: una excepción que no deja
    # huella es una excepción que nadie puede revisar después.
    liquidacion_nota = models.CharField(max_length=255, blank=True, default='')
    deposito_resuelto_en = models.DateTimeField(null=True, blank=True)
    deposito_resuelto_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='depositos_resueltos')

    # ── Confirmación en campo ──
    # Una renta se crea "activa", pero el equipo puede tardar en salir. Estas
    # marcas dicen si YA se entregó y si YA se recogió, y quién lo hizo: es lo
    # que administración necesita para saber en qué va, sin llamar a preguntar.
    # Cuándo SALIÓ la camioneta, que no es lo mismo que cuándo LLEGÓ.
    #
    # Existe por una sola razón: es el instante en que el cliente deja de poder
    # cancelar solo. Antes el corte era el día ("ya llegó la fecha de tu
    # reserva"), y eso dejaba fuera el caso que ocurre de verdad: una entrega
    # programada para hoy a las 12:00 que el cliente quiere cancelar a las 7 de
    # la mañana, con la máquina todavía en el patio. Se le decía que no, y el
    # chofer salía cargado para nada.
    #
    # La marca la pone el técnico al cargar. Podría deducirse de la hora, pero
    # sería una suposición: si el chofer sale tarde, el candado se cerraría con
    # la máquina en bodega y volveríamos al mismo problema con otro disfraz.
    salida_ruta_en = models.DateTimeField(null=True, blank=True)
    salida_ruta_por = models.ForeignKey(
        'auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='rentas_en_ruta')

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

        # Ninguna máquina sale del patio gratis. `recalcular_montos` toma la
        # tarifa del catálogo, y cuando el equipo no la tenía capturada caía a
        # $0.00 sin decir nada: la renta se levantaba, el cliente se llevaba la
        # máquina y el saldo nacía en cero. Se revisa solo AL CREAR, para no
        # tumbar una renta vieja al registrarle un pago.
        if self._state.adding and (self.precio_unitario or Decimal('0')) <= 0:
            equipo = self.inventario.equipo if self.inventario_id else None
            nombre = equipo.modelo if equipo else 'este equipo'
            unidad = dict(self.MODALIDADES).get(self.modalidad, self.modalidad or '')
            raise ValidationError(
                f'{nombre} no tiene tarifa de renta por {str(unidad).lower()}. '
                'Captúrala en el catálogo o pon el precio de esta renta a mano; '
                'no se puede rentar en $0.'
            )

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
    # ─────────────────────────────────────────────
    #  EN QUÉ VA, DE VERDAD
    # ─────────────────────────────────────────────
    @property
    def fase(self) -> str:
        """Dónde está la renta AHORA, que no es lo mismo que su `estado`.

        `estado` dice si la unidad está comprometida, y para eso 'activa' es
        correcto desde el momento en que se aparta. Pero al cliente y al
        mostrador se les enseñaba ese mismo 'activa' para una máquina que sigue
        en la bodega, y eso se lee como "ya la tienes". El equipo de Josué Ramsés
        aparecía "Activa" el día anterior a que nadie la moviera.

        La fase se DERIVA: no hay columna nueva, ni migración de los estados que
        usan los reportes, los filtros y el cron. Solo se dice la verdad de en
        qué va.
        """
        if self.estado in ('finalizada', 'cancelada'):
            return self.estado
        if self.estado == 'reservada' and not self.entregada_en:
            return 'reservada'
        if not self.entregada_en:
            return 'en_camino' if self.salida_ruta_en else 'por_entregar'
        return 'vencida' if self.vencida else 'activa'

    FASE_LABEL = {
        'reservada': 'Reservada',
        'por_entregar': 'Por entregar',
        'en_camino': 'En camino',
        'activa': 'En obra',
        'vencida': 'Vencida',
        'finalizada': 'Finalizada',
        'cancelada': 'Cancelada',
    }

    @property
    def fase_label(self) -> str:
        return self.FASE_LABEL.get(self.fase, self.get_estado_display())

    @property
    def cancelable_por_cliente(self) -> bool:
        """Si el cliente todavía puede cancelar por su cuenta.

        La regla es una sola y es física: **mientras la máquina no se haya
        movido**. No el día, no el estado. Si el chofer no ha salido, cancelar
        no le cuesta nada a nadie y evita un viaje en balde; en cuanto sale, el
        costo ya se incurrió y el cambio se habla con administración.
        """
        return (self.estado in ('reservada', 'activa')
                and not self.salida_ruta_en
                and not self.entregada_en)

    def correr_fin_por_entrega(self):
        """Recalcula `fecha_fin` desde el día en que la máquina SALIÓ de verdad.

        El cliente paga días de uso, no días de calendario: si se pactó lunes a
        martes y el técnico no pudo entregar hasta el martes, la renta de un día
        empieza el martes y se recoge el miércoles. Antes la fecha pactada no se
        movía, así que esa renta nacía ya vencida y el cliente pagaba un día que
        nunca tuvo la máquina.

        Devuelve la renta o reserva de la MISMA unidad con la que la fecha nueva
        se traslapa, o None si no hay ninguna. Ojo con lo que NO hace: no
        bloquea. La máquina ya está en la obra —eso pasó en el mundo real, no en
        la base de datos— y negarse a registrarlo solo deja al técnico sin poder
        cerrar su tarea. El traslape se devuelve para AVISARLO: administración
        mueve la reserva del otro cliente o le llama, que es una decisión de
        persona, no de validación.

        No corre nada hacia atrás: una entrega adelantada respeta el día que se
        pactó (el cliente no pierde por recibir antes).
        """
        if not self.entregada_en:
            return None
        salida = timezone.localtime(self.entregada_en).date()
        if salida <= self.fecha_inicio:
            return None
        dias = MODALIDAD_DIAS.get(self.modalidad, 1) * max(self.duracion or 1, 1)
        nuevo_fin = salida + timedelta(days=dias)
        if nuevo_fin == self.fecha_fin:
            return None
        self.fecha_inicio, self.fecha_fin = salida, nuevo_fin
        # `update()` y no `save()` a propósito: `save()` pasa por `full_clean()`,
        # que rechaza el traslape con un ValidationError. Aquí el traslape no
        # puede tumbar el registro de una entrega ya ocurrida; se anota y se
        # avisa. Es el mismo criterio de `nota_de_liquidacion`: en campo, el
        # sistema deja constancia, no frena la operación.
        Renta.objects.filter(pk=self.pk).update(
            fecha_inicio=salida, fecha_fin=nuevo_fin, actualizado_en=timezone.now())
        return (Renta.objects
                .filter(inventario_id=self.inventario_id,
                        estado__in=['activa', 'reservada'],
                        fecha_inicio__lte=nuevo_fin,
                        fecha_fin__gte=salida)
                .exclude(pk=self.pk)
                .first())

    @property
    def vence_en(self):
        """El INSTANTE en que se acaba la renta, no solo el día.

        `fecha_fin` es un DateField: dice QUÉ DÍA termina. Hasta aquí el
        vencimiento se leía como "el día entero", y en una renta de un día eso
        regala casi otro día completo: entregada hoy a las 2 de la tarde, con
        fecha_fin mañana, no se marcaba vencida hasta pasado mañana a las 00:00
        — 34 horas sobre las 24 que se cobraron.

        La HORA sale de la ENTREGA, que es como se cuenta en el mostrador: si el
        técnico la entregó a las 2 pm, se recoge a las 2 pm. En orden:

          1. `entregada_en` — la hora real en que salió. Es la buena.
          2. `hora_entrega_estimada` — lo que se pactó, mientras no salga.
          3. el cierre del día de `fecha_fin` — sin ninguno de los dos datos se
             comporta igual que antes. Nadie pierde horas de renta por un campo
             que no capturó.

        Lo que NO hace: mover `fecha_fin`. Ese campo es el que consultan el
        traslape de reservas y los índices en SQL, y correrlo por una entrega
        tardía podría chocar con la reserva de otro cliente justo cuando el
        técnico está en la obra. El día pactado se respeta; lo que se afina es
        la hora dentro de ese día.
        """
        hora = None
        if self.entregada_en:
            hora = timezone.localtime(self.entregada_en).time()
        elif self.hora_entrega_estimada:
            hora = self.hora_entrega_estimada
        if hora is None:
            # Sin dato de hora: vence al cerrar el día, como siempre.
            hora = time.max
        ingenuo = datetime.combine(self.fecha_fin, hora)
        return timezone.make_aware(ingenuo) if timezone.is_naive(ingenuo) else ingenuo

    @property
    def vencida(self) -> bool:
        return self.estado == 'activa' and timezone.now() > self.vence_en

    @property
    def horas_restantes(self) -> float:
        """Cuántas horas faltan para recogerla. Negativo = de atraso.

        Es lo que necesita una renta corta: en una de un día, "1 día restante"
        no distingue entre las 24 horas y los últimos veinte minutos.
        """
        return (self.vence_en - timezone.now()).total_seconds() / 3600

    @property
    def por_vencer(self) -> bool:
        """Si ya toca avisar que hay que recogerla.

        El umbral es PROPORCIONAL a la renta, no dos días fijos. Con los dos
        días de antes, una renta de UN día nacía en amarillo: se registraba y ya
        estaba "por vencer", así que la alerta no distinguía nada y se volvía
        ruido —justo lo que hace que se deje de mirar—.

        Se avisa en el último cuarto del tiempo contratado, con tope de dos
        días: la de un día avisa en sus últimas 6 horas, la semanal el último
        día y medio, y de ahí para arriba se queda en dos días, que es lo que un
        técnico necesita para organizar la ruta. La cuenta va sobre `vence_en`,
        así que también respeta la hora de entrega.
        """
        if self.estado != 'activa' or self.vencida:
            return False
        dias = MODALIDAD_DIAS.get(self.modalidad, 1) * max(self.duracion or 1, 1)
        ventana = min(dias * 24 * 0.25, 48)
        return self.horas_restantes <= ventana

    @property
    def dias_restantes(self) -> int:
        """Días naturales que faltan. Se queda contando DÍAS a propósito: la
        jornada del técnico ("recoger hoy" / "recoger mañana") y los
        recordatorios por correo razonan en días de calendario, y para eso el
        día es la unidad correcta. Lo fino lo dice `horas_restantes`."""
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
        era_activa = self.estado == 'activa'   # define si hay que liberar la unidad
        self.fecha_devolucion_real = hoy
        # REMALI NO COBRA RECARGOS POR RETRASO. Aquí se calculaban solos
        # (`tarifa_diaria × días de retraso`) y nadie los había pedido: una renta
        # de $1,200 devuelta nueve días tarde generaba $10,800 de deuda que jamás
        # se iba a cobrar, inflaba Cobranza y —con la palanca de la renta
        # siguiente— dejaba al cliente sin poder rentar por un adeudo inventado.
        #
        # Lo que sustituye al recargo son los RECORDATORIOS: en vez de cobrarle
        # por tardarse, no se le deja olvidar (ver `recordar_rentas`).
        #
        # El campo `recargo` se conserva —hay historial y el admin de Django
        # podría capturar uno a mano en un caso excepcional—, pero ya nadie lo
        # llena solo. `recalcular_montos()` lo sigue sumando si alguien lo pone.
        self.estado = 'finalizada'
        if commit:
            self.save(update_fields=[
                'estado', 'fecha_devolucion_real', 'actualizado_en',
            ])
        if era_activa:
            self.inventario.liberar('Bodega')

    def pagado(self):
        """Lo que el cliente lleva abonado, contando lo aplicado de la garantía."""
        return sum((Decimal(str(p.get('monto', 0))) for p in (self.pagos or [])), Decimal('0'))

    def saldo_pendiente(self):
        """Lo que el cliente aún debe de la renta (total − abonos).

        El recargo por retraso NO se suma aquí: `recalcular_montos()` ya lo metió
        dentro de `total` (y le puso su IVA si la renta lleva factura). Sumarlo
        otra vez cobraba el retraso dos veces, que es justo lo que pasaba cuando
        cada vista repetía la cuenta por su lado. Ahora la cuenta vive aquí y las
        vistas la llaman.
        """
        return max((self.total or Decimal('0')) - self.pagado(), Decimal('0'))

    def falta_para_liquidar(self):
        """Cuánto falta cobrar para poder RECOGER la máquina. Cero = ya se puede.

        Es la cifra que el técnico necesita en la obra, y NO es el saldo: el
        saldo es todo lo que el cliente debe, esto es solo lo que falta para
        alcanzar el piso. Pedir el saldo entero cuando con menos ya se lleva la
        máquina hace perder el cobro.

        La config va cacheada por petición (`get_solo`), así que servir esto en
        una lista de rentas no dispara una consulta por fila.
        """
        from maquinaria.models import ConfiguracionSitio
        pct = Decimal(str(ConfiguracionSitio.get_solo().renta_liquidacion_minima_pct or 0))
        if pct <= 0:
            return Decimal('0.00')
        minimo = ((self.total or Decimal('0')) * pct / Decimal('100')).quantize(Decimal('0.01'))
        return max(minimo - self.pagado(), Decimal('0')).quantize(Decimal('0.01'))

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
