from django.conf import settings
from django.db import models
from django.db.models import Max
from django.utils import timezone
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
        ('apartado', 'Apartado'),          # reservada por una venta con anticipo (apartado)
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

    codigo = models.CharField(
        max_length=20,
        unique=True,
        editable=False
    )

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

    # ⭐ NUEVO CAMPO: Autoriza temporalmente rentar una unidad NUEVA.
    # Motivos típicos:
    #   - Sustitución de seminueva dañada en una renta activa.
    #   - Alta demanda de renta, sacar nueva para cubrir.
    # La condición NO cambia: sigue siendo NUEVA (al devolverse, si no se
    # usó, puede volver a venta como nueva). Esta bandera es un permiso
    # operativo, no un cambio de propiedad del activo.
    autorizada_para_renta = models.BooleanField(
        default=False,
        help_text=(
            'Autoriza rentar esta unidad aunque sea NUEVA. '
            'Marcar por: sustitución de unidad dañada, demanda extraordinaria, etc.'
        ),
    )
    autorizada_renta_en = models.DateTimeField(
        null=True, blank=True, editable=False,
    )
    autorizada_renta_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL, editable=False,
        related_name='+'
    )
    autorizada_renta_nota = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Motivo por el cual se autorizó la renta de una unidad nueva.',
    )

    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    # ============================
    # GENERADOR DE CÓDIGO
    # ============================

    @staticmethod
    def proximo_codigo(equipo):
        """
        Predice el código/etiqueta que se asignará a la próxima unidad de
        `equipo`, SIN crear nada. Misma lógica que usa `generar_codigo` al
        guardar, para poder mostrarlo en una confirmación antes del alta.
        Ejemplo: Taladro -> TAL-0001, HM-1810 -> HM1-0001
        """
        import re

        # Prefijo: primeros 3 caracteres alfanuméricos del modelo, en mayúsculas
        limpio = re.sub(r'[^A-Za-z0-9]', '', getattr(equipo, 'modelo', '') or '')
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

    def generar_codigo(self):
        """Código para ESTA unidad al guardarla (delega en `proximo_codigo`)."""
        return Inventario.proximo_codigo(self.equipo)

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
        """
        Regla actualizada:
          - Siempre puede rentarse una 'seminueva' disponible.
          - Una 'nueva' SÓLO puede rentarse SI fue autorizada
            (`autorizada_para_renta=True`) y está disponible.
          - En cualquier otro caso, no.
        """
        if self.estado != 'disponible':
            return False
        if self.condicion == 'seminueva':
            return True
        # condicion == 'nueva'
        return bool(self.autorizada_para_renta)

    # Métodos usados por las vistas de renta/venta
    def puede_venderse(self):
        return self.disponible_para_venta

    def puede_rentarse(self):
        return self.disponible_para_renta

    # ============================
    # TRANSICIONES OPERATIVAS NUEVAS
    #  (pensadas para sustitución / demanda extraordinaria)
    # ============================

    def autorizar_para_renta(self, *, motivo='', usuario=None):
        """
        Marca una unidad como autorizada para rentarse aunque sea NUEVA.
        Solo cambia la bandera de autorización; NO ocupa la unidad.
        Devuelve True si se produjo un cambio.

        Se usa típicamente en dos escenarios:
          a) Sustitución: seminueva en renta activa se daña → se autoriza
             la nueva para enviarla con el cliente.
          b) Demanda extraordinaria: no hay seminuevas disponibles → se
             decide sacar una nueva a renta.
        """
        if self.autorizada_para_renta:
            return False
        self.autorizada_para_renta = True
        self.autorizada_renta_en = timezone.now()
        self.autorizada_renta_nota = motivo or ''
        if usuario is not None and getattr(usuario, 'is_authenticated', False):
            self.autorizada_renta_por = usuario
        self.save(update_fields=[
            'autorizada_para_renta', 'autorizada_renta_en',
            'autorizada_renta_por', 'autorizada_renta_nota',
            'fecha_actualizacion',
        ])
        return True

    def revocar_autorizacion_renta(self, *, motivo=''):
        """
        Revoca la autorización especial de renta (solo si la unidad NO
        está rentada ni reservada). Útil cuando la unidad fue autorizada
        por demanda, la demanda pasó y la queremos de regreso en venta
        como nueva.
        """
        if not self.autorizada_para_renta:
            return False
        if self.estado in ('rentado',):
            raise ValueError(
                f'No se puede revocar: la unidad {self.codigo} está rentada.'
            )
        self.autorizada_para_renta = False
        if motivo:
            self.autorizada_renta_nota = (
                (self.autorizada_renta_nota or '')
                + f' | Revocado: {motivo}'
            )[-255:]
        self.save(update_fields=[
            'autorizada_para_renta', 'autorizada_renta_nota',
            'fecha_actualizacion',
        ])
        return True

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
        """
        disponible -> rentado.
        Versión flexible: la regla de SI puede rentarse ya no depende solo
        de condición seminueva; respeta `puede_rentarse()` (nueva+autorizada
        también es válida).
        """
        if self.estado != 'disponible':
            # Quien lee esto es el técnico parado frente a la máquina, no un
            # programador: el motivo va en su idioma y con la salida a la mano.
            motivo = {
                'rentado': 'ya está rentada en otra renta',
                'apartado': 'está apartada por una venta con anticipo',
                'mantenimiento': 'está en el taller',
                'vendido': 'ya se vendió',
            }.get(self.estado, f'está en estado {self.estado}')
            raise ValueError(
                f'No se puede entregar la unidad {self.codigo}: {motivo}. '
                f'Avisa a administración para que asigne otra unidad.'
            )
        if not self.puede_rentarse():
            detalle = (
                'no fue autorizada para renta' if self.condicion == 'nueva'
                else 'no está en condición rentable'
            )
            raise ValueError(
                f"La unidad {self.codigo} no se puede rentar: {detalle}."
            )
        self._set_estado('rentado', ubicacion)

    def liberar(self, ubicacion='Bodega'):
        """rentado -> disponible (al devolver o cancelar una renta)."""
        if self.estado == 'rentado':
            self._set_estado('disponible', ubicacion)

    # ── Apartado (venta con anticipo) ────────────────────────────────
    def renta_comprometida(self):
        """La renta activa o RESERVADA que ya tiene apalabrada esta unidad, si hay.

        Una reserva a futuro no cambia el estado de la unidad —a propósito: que
        esté apartada para el día 20 no impide rentarla hoy y recogerla el 19—,
        así que el estado por sí solo no dice si la unidad ya tiene dueño. Para
        eso hay que preguntarle a las rentas.
        """
        from renta.models import Renta
        return (Renta.objects
                .filter(inventario=self, estado__in=('activa', 'reservada'))
                .order_by('fecha_inicio')
                .first())

    def _exigir_libre_de_renta(self, verbo):
        """Impide llevarse una unidad que una renta ya tiene apalabrada.

        Sin esto, el admin elegía APi-0001 para una renta del jueves, alguien la
        vendía el martes, y el técnico se estrellaba al ir a entregarla: la
        unidad ya no existía para rentar y la renta seguía viva.
        """
        r = self.renta_comprometida()
        if r is None:
            return
        cuando = f'{r.fecha_inicio:%d/%m}' + (f' al {r.fecha_fin:%d/%m}' if r.fecha_fin else '')
        estado = 'rentada' if r.estado == 'activa' else 'reservada'
        raise ValueError(
            f'La unidad {self.codigo} no se puede {verbo}: está {estado} '
            f'en la renta #{r.id} ({cuando}). Cancela esa renta o elige otra unidad.'
        )

    def apartar(self, ubicacion='Apartado (anticipo)'):
        """disponible -> apartado. Reserva la unidad para una venta con anticipo;
        deja de estar disponible para venta/renta hasta que se entregue o cancele."""
        if self.estado != 'disponible':
            raise ValueError(
                f"La unidad {self.codigo} no está disponible (estado actual: {self.estado})."
            )
        self._exigir_libre_de_renta('apartar')
        self._set_estado('apartado', ubicacion)

    def entregar_apartado(self):
        """apartado -> vendido (al liquidar y entregar el apartado)."""
        if self.estado == 'apartado':
            self._set_estado('vendido')

    def liberar_apartado(self, ubicacion='Bodega'):
        """apartado -> disponible (al cancelar el apartado)."""
        if self.estado == 'apartado':
            self._set_estado('disponible', ubicacion)

    def enviar_mantenimiento(self):
        self._set_estado('mantenimiento', 'Taller')

    def salir_mantenimiento(self):
        self._set_estado('disponible', 'Bodega')

    def marcar_vendido(self, forzar=False):
        """disponible/apartado -> vendido.

        `forzar` solo para casos donde la venta de una unidad comprometida sea
        deliberada (y quede escrito quién lo decidió); por defecto se protege.
        """
        if self.estado == 'vendido':
            return
        if not forzar:
            self._exigir_libre_de_renta('vender')
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

    # ── Cliente ──
    # `cliente`/`contacto` son la identidad NUEVA (padrón único). Los campos de
    # abajo —cliente_nombre, cliente_telefono, empresa, usuario— son la forma
    # vieja: espejo de solo lectura durante la fase 1, se van en la fase 3.
    # Las órdenes `tipo='interna'` (máquina propia) NUNCA llevan cliente.
    cliente = models.ForeignKey(
        'clientes.Cliente',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='reparaciones',
    )
    contacto = models.ForeignKey(
        'clientes.Contacto',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='reparaciones',
    )

    cliente_nombre = models.CharField(max_length=200, blank=True, default='')
    cliente_telefono = models.CharField(max_length=40, blank=True, default='')
    empresa = models.ForeignKey('empresas.Empresa', null=True, blank=True, on_delete=models.SET_NULL, related_name='ordenes_reparacion')
    # Cuenta de cliente ligada (por la liga de vinculación): habilita "Mis
    # reparaciones" en su panel. Distinta del cliente de mostrador (texto libre).
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='reparaciones_cliente',
    )
    # Liga de un solo uso (con caducidad): el admin la genera, el cliente la abre
    # con su sesión y la orden queda en SU cuenta.
    token_vinculo = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)
    token_vinculo_expira = models.DateTimeField(null=True, blank=True, editable=False)
    # Liga PÚBLICA de seguimiento (permanente, solo lectura): el cliente sin
    # cuenta ve el avance de su reparación con esta liga, sin registrarse.
    token_publico = models.CharField(max_length=32, unique=True, null=True, blank=True, editable=False)

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
        # Folio por ejercicio: OR-AAAA-NNNN, el consecutivo reinicia cada año
        # (mismo patrón que COT/VEN). Se filtra por el prefijo del año, así el
        # Max() (comparación de texto) coincide con el orden numérico del año.
        from server.periodos import anio_actual
        prefijo = f'OR-{anio_actual()}-'
        ultimo = OrdenReparacion.objects.filter(folio__startswith=prefijo).aggregate(m=Max('folio'))['m']
        n = 1
        if ultimo:
            try:
                n = int(ultimo.split('-')[-1]) + 1
            except (ValueError, IndexError):
                n = 1
        return f'{prefijo}{n:04d}'

    def save(self, *args, **kwargs):
        if not self.folio:
            self.folio = self.generar_folio()
        if not self.token_publico:
            import secrets
            self.token_publico = secrets.token_hex(16)
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