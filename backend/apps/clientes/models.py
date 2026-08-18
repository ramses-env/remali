"""Padrón de clientes: la identidad ÚNICA de a quién le vendemos o rentamos.

Antes de esta app, el mismo señor podía existir de cuatro formas a la vez en una
sola venta —`empresa` FK, `nombre_cliente` texto, `telefono_cliente` texto y
`cliente_usuario` FK— y ninguna era la autoridad. El historial quedaba partido
por documento: no había forma de responder "¿cuánto me ha comprado Juan Pérez?"
ni "¿le debo un depósito?".

Aquí el cliente EXISTE tenga cuenta o no. La cuenta (`User`) cuelga de un
`Contacto`, que es una persona del cliente. Un cliente moral tiene varios
contactos —la jefa de compras y el residente de obra—; uno físico tiene uno solo,
autocreado, para que el código nunca tenga que preguntar de qué tipo es.

Regla de negocio (dueño, ago-2026): el teléfono es el identificador de búsqueda
en mostrador, pero NO es único en la base —dos personas comparten conmutador y un
dígito mal tecleado no debe tumbar una venta—. La unicidad la resuelve una
persona confirmando, no una restricción de esquema.
"""
from django.conf import settings
from django.db import models

from maquinaria.models import nombre_propio


def formatear_domicilio(*, calle='', numero_exterior='', numero_interior='',
                        colonia='', municipio='', entidad='', codigo_postal='') -> str:
    """Arma una dirección legible a partir de las partes estructuradas.
    Ej: 'Av Costera 120 Int. 3, Icacos, Acapulco, Guerrero, 39300'."""
    linea1 = ' '.join(p for p in [calle.strip(), numero_exterior.strip()] if p).strip()
    if numero_interior.strip():
        linea1 = f'{linea1} Int. {numero_interior.strip()}'.strip()
    partes = [linea1, colonia, municipio, entidad, codigo_postal]
    return ', '.join(p.strip() for p in partes if p and p.strip())


class DomicilioMixin(models.Model):
    """Domicilio estructurado, compartido por Cliente y Obra.

    El campo formateado destino difiere por modelo (Cliente.direccion,
    Obra.ubicacion): cada subclase lo declara y lo nombra en CAMPO_DIRECCION.
    Al guardar, si hay partes estructuradas, se re-arma y se escribe ahí.
    Abstracto: no crea tabla.
    """
    calle = models.CharField(max_length=180, blank=True, default='')
    numero_exterior = models.CharField(max_length=30, blank=True, default='')
    numero_interior = models.CharField(max_length=30, blank=True, default='')
    colonia = models.CharField(max_length=120, blank=True, default='')
    municipio = models.CharField(max_length=120, blank=True, default='')
    ciudad = models.CharField(max_length=120, blank=True, default='')
    entidad = models.CharField(max_length=80, blank=True, default='', help_text='Estado / entidad federativa')
    codigo_postal = models.CharField(max_length=10, blank=True, default='')
    pais = models.CharField(max_length=80, blank=True, default='México')
    referencias = models.CharField(max_length=255, blank=True, default='')
    latitud = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitud = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    CAMPO_DIRECCION = 'direccion'

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        armada = formatear_domicilio(
            calle=self.calle, numero_exterior=self.numero_exterior, numero_interior=self.numero_interior,
            colonia=self.colonia, municipio=self.municipio, entidad=self.entidad, codigo_postal=self.codigo_postal,
        )
        if armada:
            setattr(self, self.CAMPO_DIRECCION, armada)
        super().save(*args, **kwargs)


class Cliente(DomicilioMixin):
    """A quién le vendemos o rentamos. Con cuenta o sin ella."""

    FISICA = 'fisica'
    MORAL = 'moral'
    TIPOS = [
        (FISICA, 'Persona física'),
        (MORAL, 'Persona moral / empresa'),
    ]

    tipo = models.CharField(max_length=6, choices=TIPOS, default=FISICA)

    # Física: nombre completo. Moral: nombre comercial (con el que lo conocen en
    # mostrador, que casi nunca es la razón social).
    nombre = models.CharField(max_length=200, db_index=True)

    # ── Datos fiscales (CFDI / SAT) ──
    # Viven en el CLIENTE, no en el perfil de la cuenta: un cliente de mostrador
    # sin cuenta también pide factura.
    razon_social = models.CharField(max_length=200, blank=True, default='')
    rfc = models.CharField(max_length=20, blank=True, default='')
    regimen_fiscal = models.CharField(max_length=10, blank=True, default='', help_text='Clave SAT, ej. 601')
    uso_cfdi = models.CharField(max_length=10, blank=True, default='', help_text='Clave SAT, ej. G03')
    cp_fiscal = models.CharField(max_length=10, blank=True, default='')
    email_fiscal = models.EmailField(blank=True, default='')

    # `telefono` y `email` los normaliza la señal global de maquinaria
    # (10 dígitos / minúsculas) por el NOMBRE del campo. No hay que hacer nada.
    telefono = models.CharField(max_length=40, blank=True, default='', db_index=True)
    email = models.EmailField(blank=True, default='')

    # Domicilio: partes estructuradas en DomicilioMixin; aquí el formateado.
    direccion = models.CharField(max_length=255, blank=True, default='', help_text='Dirección formateada (se arma con las partes de abajo)')

    notas = models.TextField(blank=True, default='')
    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True)

    # Bandeja de revisión: la migración del histórico no adivina. Cuando un caso
    # queda dudoso (mismo teléfono con nombres muy distintos, empresa en texto
    # que no casó con ninguna Empresa) se une al candidato más probable y se
    # marca aquí para que una persona lo confirme o lo separe.
    requiere_revision = models.BooleanField(default=False, db_index=True)
    revision_motivo = models.CharField(max_length=255, blank=True, default='')

    CAMPO_DIRECCION = 'direccion'

    class Meta:
        db_table = 'clientes'
        verbose_name = 'Cliente'
        verbose_name_plural = 'Clientes'
        ordering = ['nombre']

    def save(self, *args, **kwargs):
        # A las personas se les acomoda el nombre (juan PEREZ → Juan Pérez); a
        # las morales NO: "CFE" o "GRUPO ADO" no son errores de captura.
        if self.tipo == self.FISICA and self.nombre:
            self.nombre = nombre_propio(self.nombre)
        self.rfc = (self.rfc or '').strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nombre

    @property
    def es_moral(self) -> bool:
        return self.tipo == self.MORAL

    @property
    def contacto_principal(self):
        """El contacto que representa al cliente. Nunca falla si no hay."""
        return self.contactos.filter(principal=True).first() or self.contactos.first()

    @property
    def tiene_cuenta(self) -> bool:
        """¿Alguno de sus contactos puede entrar al panel?"""
        return self.contactos.filter(usuario__isnull=False).exists()

    @classmethod
    def buscar_por_telefono(cls, telefono: str):
        """Clientes cuyo teléfono —o el de alguno de sus contactos— coincide.

        Es la búsqueda de mostrador: el vendedor teclea el número que trae a la
        mano, que en una constructora tanto puede ser el conmutador como el
        celular del residente. Devuelve queryset (puede haber varios: el
        vendedor confirma cuál es).
        """
        digitos = ''.join(c for c in (telefono or '') if c.isdigit())[:10]
        if not digitos:
            return cls.objects.none()
        return cls.objects.filter(
            models.Q(telefono=digitos) | models.Q(contactos__telefono=digitos)
        ).distinct()


class Contacto(models.Model):
    """Una persona del cliente. Aquí —y solo aquí— cuelga la cuenta de acceso.

    Un contacto con `usuario` ve TODO lo de su cliente en el panel, no solo los
    documentos donde él aparece: la jefa de compras necesita el estado de cuenta
    completo de la constructora.
    """
    # OPCIONAL a propósito. Una cuenta recién registrada en la tienda es un
    # contacto SIN cliente: existe la persona, todavía no se sabe de quién es.
    # Crear un Cliente automático por cada registro ensuciaría justamente el
    # padrón que REMALI cura a mano. Vincular = ponerle su cliente.
    cliente = models.ForeignKey(
        Cliente,
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name='contactos',
    )

    nombre = models.CharField(max_length=200)
    telefono = models.CharField(max_length=40, blank=True, default='', db_index=True)
    email = models.EmailField(blank=True, default='')
    puesto = models.CharField(max_length=80, blank=True, default='')

    # La cuenta. OneToOne: un login pertenece a UNA persona. Nulo = contacto que
    # existe en el padrón pero nunca abrió cuenta (la mayoría, y está bien).
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='contacto_cliente',
    )

    principal = models.BooleanField(default=False)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'clientes_contacto'
        verbose_name = 'Contacto de cliente'
        verbose_name_plural = 'Contactos de cliente'
        ordering = ['-principal', 'nombre']

    def save(self, *args, **kwargs):
        self.nombre = nombre_propio(self.nombre)
        super().save(*args, **kwargs)
        # Un solo principal por cliente (mismo patrón que ObraCliente.predeterminada).
        # `cliente_id` nulo se salta: si no, los contactos sin vincular contarían
        # todos como "el mismo cliente" y se apagarían entre sí.
        if self.principal and self.cliente_id:
            Contacto.objects.filter(cliente_id=self.cliente_id).exclude(pk=self.pk).update(principal=False)

    def __str__(self):
        if not self.cliente_id:
            return f'{self.nombre} (sin vincular)'
        return f'{self.nombre} ({self.cliente.nombre})'

    @classmethod
    def sin_vincular(cls):
        """Cuentas registradas en la tienda que nadie ha asignado todavía.
        Es la bandeja que REMALI resuelve; el aviso de "cuenta nueva" apunta aquí."""
        return cls.objects.filter(cliente__isnull=True, usuario__isnull=False)


class Obra(DomicilioMixin):
    """Dónde trabaja el cliente. Un cliente puede tener VARIAS.

    Regla de negocio (dueño, ago-2026): tanto una persona como una constructora
    pueden tener varias obras. Antes eran dos modelos —`empresas.Obra` colgada de
    la empresa y `maquinaria.ObraCliente` colgada de la cuenta—, que era la misma
    idea escrita dos veces y sin forma de pasar de una a otra. Aquí hay una sola,
    y cuelga del cliente, que es lo único que ambas tenían en común.
    """
    ESTADOS = [
        ('activa', 'Activa'),
        ('pausada', 'Pausada'),
        ('finalizada', 'Finalizada'),
    ]

    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='obras')
    nombre = models.CharField(max_length=180)
    responsable = models.CharField(max_length=180, blank=True, default='')
    telefono = models.CharField(max_length=40, blank=True, default='')  # del responsable

    # Domicilio de la obra: partes en DomicilioMixin; aquí el formateado.
    ubicacion = models.CharField(max_length=255, blank=True, default='',
                                 help_text='Dirección formateada (se arma con las partes de abajo)')

    estado = models.CharField(max_length=12, choices=ESTADOS, default='activa')
    predeterminada = models.BooleanField(default=False, help_text='La que se propone al rentar.')
    notas = models.TextField(blank=True, default='')
    creada = models.DateTimeField(auto_now_add=True)

    CAMPO_DIRECCION = 'ubicacion'

    class Meta:
        db_table = 'obras'
        verbose_name = 'Obra'
        verbose_name_plural = 'Obras'
        ordering = ['-predeterminada', 'nombre']
        unique_together = ('cliente', 'nombre')

    def save(self, *args, **kwargs):
        self.nombre = nombre_propio(self.nombre)
        super().save(*args, **kwargs)
        if self.predeterminada:
            Obra.objects.filter(cliente=self.cliente).exclude(pk=self.pk).update(predeterminada=False)

    def __str__(self):
        return f'{self.nombre} ({self.cliente.nombre})'


class DocumentoCliente(models.Model):
    """Los papeles del cliente: acta constitutiva, INE, comprobante de domicilio.

    Regla de negocio (dueño, ago-2026): casi no se le renta a personas sueltas —
    se le renta a constructoras, con comprobante de por medio. La identidad se
    establece con papeles en el mostrador, y aquí es donde viven.

    `vence` es lo que le da valor: un comprobante de domicilio de hace tres años
    no sirve para nada, y la ficha puede avisar antes de que alguien entregue una
    máquina de $800,000.

    ACCESO PARTIDO: el mostrador (nivel 1) ve QUE existen y si están vigentes —es
    lo que necesita para decidir si entrega—; abrirlos o descargarlos es nivel 2,
    porque ahí adentro hay INEs.
    """
    TIPOS = [
        ('acta', 'Acta constitutiva'),
        ('ine', 'Identificación oficial'),
        ('domicilio', 'Comprobante de domicilio'),
        ('orden_compra', 'Orden de compra'),
        ('otro', 'Otro'),
    ]

    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='documentos')
    tipo = models.CharField(max_length=14, choices=TIPOS, default='otro')
    archivo = models.FileField(upload_to='clientes/documentos/')
    nota = models.CharField(max_length=200, blank=True, default='')
    vence = models.DateField(null=True, blank=True, help_text='Vacío = no caduca.')

    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='documentos_cliente_subidos',
    )
    subido_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'clientes_documento'
        verbose_name = 'Documento del cliente'
        verbose_name_plural = 'Documentos del cliente'
        ordering = ['-subido_en']

    @property
    def vigente(self) -> bool:
        """Se CALCULA, no se guarda: un documento marcado 'vigente' en la base
        que en realidad venció ayer es peor que no tener el dato."""
        from django.utils import timezone
        return self.vence is None or self.vence >= timezone.localdate()

    def __str__(self):
        return f'{self.get_tipo_display()} · {self.cliente.nombre}'


class Garantia(models.Model):
    """La garantía que REMALI le dio a un CLIENTE al venderle.

    Ojo con el nombre: en este código "garantía" ya significaba otra cosa —el
    depósito en garantía de las rentas, que es dinero retenido—. Nada que ver.
    Y tampoco es la que el proveedor le da a REMALI, que vive en la venta sobre
    pedido como dato de referencia.

    Sirve para una sola pregunta, que es la que llega al mostrador: el cliente
    aparece con su máquina descompuesta, se teclea su teléfono y hay que poder
    contestar "sí, vence el 15/03/2027" o "no, venció hace cuatro meses".

    Decisión del dueño: el sistema SOLO informa. No levanta orden de reparación
    en garantía ni registra el reclamo; eso lo resuelve una persona.
    """
    venta = models.ForeignKey('ventas.Venta', on_delete=models.CASCADE, related_name='garantias')
    cliente = models.ForeignKey(Cliente, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name='garantias')
    inventario = models.ForeignKey('inventario.Inventario', null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name='garantias')

    # SNAPSHOT legible de qué cubre. La unidad puede venderse otra vez, darse de
    # baja o cambiar de código; la garantía tiene que seguir diciendo qué ampara.
    descripcion = models.CharField(max_length=200)

    inicia = models.DateField()
    meses = models.PositiveSmallIntegerField()
    vence = models.DateField(db_index=True)

    anulada_en = models.DateTimeField(null=True, blank=True)
    anulada_motivo = models.CharField(max_length=200, blank=True, default='')

    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'clientes_garantia'
        verbose_name = 'Garantía'
        verbose_name_plural = 'Garantías'
        ordering = ['-vence']

    @property
    def vigente(self) -> bool:
        """Se CALCULA, no se guarda. Una garantía marcada 'vigente' en la base
        que en realidad venció ayer es peor que no tener el dato: alguien la
        haría válida en el mostrador."""
        from django.utils import timezone
        return self.anulada_en is None and self.vence >= timezone.localdate()

    @property
    def dias_restantes(self) -> int:
        from django.utils import timezone
        return (self.vence - timezone.localdate()).days

    def __str__(self):
        return f'{self.descripcion} · vence {self.vence}'

    @classmethod
    def emitir(cls, venta, *, inventario=None, meses=None, descripcion='', inicia=None):
        """Nace con la venta, si el catálogo dice que esa máquina lleva garantía.

        Devuelve None cuando no aplica (meses=0), en vez de crear una garantía de
        cero días que después alguien tendría que interpretar.
        """
        from datetime import date
        from django.utils import timezone

        inv = inventario or venta.inventario
        equipo = (inv.equipo if inv and inv.equipo_id else
                  (venta.equipo if venta.equipo_id else None))
        if meses is None:
            meses = getattr(equipo, 'garantia_meses', 0) or 0
        if not meses:
            return None

        inicia = inicia or timezone.localdate()
        # Sumar meses sin dependencias: se normaliza el mes y se recorta el día
        # si el mes destino es más corto (31 de enero + 1 mes = 28 de febrero).
        total = inicia.month - 1 + int(meses)
        anio, mes = inicia.year + total // 12, total % 12 + 1
        dia = min(inicia.day, [31, 29 if anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0) else 28,
                               31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1])

        if not descripcion:
            modelo = getattr(equipo, 'modelo', '') or 'Equipo'
            serie = getattr(inv, 'numero_serie', '') or getattr(inv, 'codigo', '')
            descripcion = f'{modelo}{f" · {serie}" if serie else ""}'

        return cls.objects.create(
            venta=venta, cliente=venta.cliente, inventario=inv,
            descripcion=descripcion[:200], inicia=inicia, meses=meses,
            vence=date(anio, mes, dia),
        )
