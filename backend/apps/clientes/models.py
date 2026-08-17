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

from empresas.models import DomicilioMixin
from maquinaria.models import nombre_propio


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
