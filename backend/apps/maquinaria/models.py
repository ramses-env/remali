from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator, FileExtensionValidator
from decimal import Decimal


def select_ficha_storage():
    """Storage para la ficha técnica (PDF). Usa Cloudinary como archivo *raw*
    (no imagen) SOLO cuando Cloudinary está realmente configurado — las mismas
    llaves con las que settings decide su storage por defecto; si no, cae al
    storage por defecto (disco local). Es una función (no una instancia) para
    que la migración deconstruya siempre a la misma ruta en todos los entornos."""
    from django.core.files.storage import default_storage
    try:
        cfg = getattr(settings, 'CLOUDINARY_STORAGE', {}) or {}
        if cfg.get('CLOUD_NAME') and cfg.get('API_KEY') and cfg.get('API_SECRET'):
            from cloudinary_storage.storage import RawMediaCloudinaryStorage
            return RawMediaCloudinaryStorage()
    except Exception:
        pass
    return default_storage


class PerfilUsuario(models.Model):
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='perfil'
    )
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    telefono = models.CharField(max_length=30, blank=True, default='')
    puesto = models.CharField(max_length=80, blank=True, default='')
    bio = models.TextField(blank=True, default='')

    # ── Datos que declara el propio cliente ────────────────────────────────
    # Van como texto y NO enlazados a Empresa/Obra a propósito. Esos catálogos
    # los cura administración; si cada cliente pudiera crear registros al
    # registrarse, en un mes habría "Constructora ABC", "constructora abc" y
    # "ABC S.A. de C.V." como tres empresas distintas. Aquí queda lo que el
    # cliente declara, y administración lo concilia con el catálogo real.
    empresa = models.CharField(
        max_length=180, blank=True, default='',
        help_text='Empresa para la que trabaja el cliente (declarada por él)',
    )
    obra_direccion = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Dónde se entrega la maquinaria',
    )
    obra_responsable = models.CharField(
        max_length=180, blank=True, default='',
        help_text='Quién recibe en la obra',
    )
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    # ── Verificación de correo ──────────────────────────────────────────────
    # Con datos_completos, es lo que desbloquea el 5%. Google ya trae el correo
    # verificado; el alta con contraseña se confirma con un token por correo.
    email_verificado = models.BooleanField(default=False)
    email_token = models.CharField(max_length=64, blank=True, default='', editable=False)
    email_verificado_en = models.DateTimeField(null=True, blank=True)
    # El premio del 5% se entrega UNA sola vez: sin esto se re-mandaría el correo
    # y se re-generaría el cupón cada vez que edita el perfil ya estando completo.
    recompensado = models.BooleanField(default=False)

    class Meta:
        db_table = 'perfiles_usuario'
        verbose_name = 'Perfil de usuario'
        verbose_name_plural = 'Perfiles de usuario'

    def __str__(self):
        return f'Perfil de {self.usuario.username}'

    @property
    def telefono_valido(self) -> bool:
        """Teléfono con 10 dígitos, sin contar espacios, guiones o paréntesis."""
        return len(''.join(c for c in self.telefono if c.isdigit())) == 10

    @property
    def datos_completos(self) -> bool:
        """¿Ya hay lo necesario para atenderle sin perseguirlo por teléfono?

        Se calcula en vez de guardarse: un booleano aparte se queda desfasado en
        cuanto alguien edita el perfil por otra vía (el admin de Django, por
        ejemplo) y nadie se acuerda de recalcularlo.
        """
        return all([
            self.telefono_valido,
            self.empresa.strip(),
            self.obra_direccion.strip(),
            self.obra_responsable.strip(),
        ])

    @property
    def perfil_verificado(self) -> bool:
        """Correo confirmado + datos completos: lo que desbloquea el 5%."""
        return self.email_verificado and self.datos_completos

    def nuevo_email_token(self):
        import secrets
        self.email_token = secrets.token_urlsafe(32)
        return self.email_token


class ObraCliente(models.Model):
    """Obra que guarda un CLIENTE para reusar sus datos al cotizar.

    Aparte de empresas.Obra (curada por administración) a propósito: aquí el
    cliente guarda lo suyo sin ensuciar el catálogo formal. Un cliente puede
    tener varias; al cotizar elige una y se rellenan los datos de la obra.
    """
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='obras')
    nombre = models.CharField(max_length=120, help_text='Alias para identificarla (ej. "Torre Costera")')
    responsable = models.CharField(max_length=180, blank=True, default='')
    direccion = models.CharField(max_length=255, blank=True, default='')
    telefono = models.CharField(max_length=30, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'obras_cliente'
        verbose_name = 'Obra de cliente'
        verbose_name_plural = 'Obras de cliente'
        ordering = ['nombre']

    def __str__(self):
        return self.nombre


class Categoria(models.Model):
    nombre = models.CharField(max_length=120, unique=True)

    class Meta:
        db_table = 'categorias'
        verbose_name = 'Categoría'
        verbose_name_plural = 'Categorías'

    def __str__(self):
        return self.nombre


class Tipo(models.Model):
    nombre = models.CharField(max_length=30, unique=True)

    class Meta:
        db_table = 'tipos'
        verbose_name = 'Tipo'
        verbose_name_plural = 'Tipos'

    def __str__(self):
        return self.nombre


class Marca(models.Model):
    nombre = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'marcas'
        verbose_name = 'Marca'
        verbose_name_plural = 'Marcas'

    def __str__(self):
        return self.nombre






class Equipo(models.Model):
    # Nueva se vende, seminueva se renta. La condición del EQUIPO define su modo
    # (venta/renta) en todo el sitio: catálogo, precios, ficha y cotización. Un
    # equipo es una cosa o la otra, nunca ambas.
    CONDICIONES = [('nueva', 'Nueva'), ('seminueva', 'Seminueva')]

    modelo = models.CharField(max_length=120, default='')
    descripcion = models.TextField(blank=True)
    condicion = models.CharField(max_length=10, choices=CONDICIONES, default='nueva')
    imagen = models.ImageField(upload_to='products/', blank=True, null=True)
    # Ficha técnica: PDF ya diseñado que sube el admin; el cliente lo descarga.
    ficha_tecnica = models.FileField(
        upload_to='fichas/', blank=True, null=True, storage=select_ficha_storage,
        validators=[FileExtensionValidator(['pdf'])],
        help_text='PDF de ficha técnica del equipo (opcional)'
    )
    # Especificaciones técnicas: lista ordenada de {etiqueta, valor}
    # (ej. {"etiqueta": "Frecuencia", "valor": "60 Hz"}). Flexible por producto.
    especificaciones = models.JSONField(default=list, blank=True)
    # Lista de textos "Título: detalle" que se muestran en la pestaña
    # "Qué incluye" del detalle público del equipo.
    que_incluye = models.JSONField(default=list, blank=True)
    # Promoción por equipo: % de descuento sobre el precio mostrado (0 = sin promo).
    promo_pct = models.PositiveSmallIntegerField(default=0, blank=True)

    categoria = models.ForeignKey(
        'Categoria',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='equipos'
    )

    tipo = models.ForeignKey(
        'Tipo',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='equipos'
    )

    marca = models.ForeignKey(
        'Marca',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='equipos'
    )

    precio_venta = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True
    )

    precio_dia = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    precio_semana = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    precio_mes = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    fecha_creacion = models.DateTimeField(auto_now_add=True)

    @property
    def modo(self):
        """'venta' si el equipo es nuevo; 'renta' si es seminuevo."""
        return 'renta' if self.condicion == 'seminueva' else 'venta'

    # 🔥 ESTADO CALCULADO AUTOMÁTICO
    @property
    def estado_resumen(self):
        unidades = self.unidades.all()

        if not unidades.exists():
            return "Sin stock"

        if unidades.filter(estado="disponible").exists():
            return "Disponible"

        if unidades.filter(estado="rentado").exists():
            return "Rentado"

        return "Vendido"

    def get_precio_por_unidad(self, unidad):
        """Devuelve el precio de renta según la modalidad ('dia'|'semana'|'mes').

        Regresa None si la modalidad no existe o el equipo no tiene ese precio.
        """
        return {
            'dia': self.precio_dia,
            'semana': self.precio_semana,
            'mes': self.precio_mes,
        }.get(unidad)

    def __str__(self):
        return self.modelo

    class Meta:
        db_table = 'equipos'
        verbose_name = 'Equipo'
        verbose_name_plural = 'Equipos'


















class ImagenProducto(models.Model):
    equipo = models.ForeignKey(
        Equipo,
        related_name='imagenes',
        on_delete=models.CASCADE
    )

    imagen = models.ImageField(upload_to='products/')
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'imagenes_producto'
        verbose_name = 'Imagen de Producto'
        verbose_name_plural = 'Imágenes de Producto'
        ordering = ['id']

    def __str__(self):
        return f"{self.equipo.modelo} #{self.id}"


class ConfiguracionSitio(models.Model):
    """Configuración editable del sistema (registro único / singleton).

    Reemplaza constantes de código y variables de entorno: los números de
    WhatsApp y los datos del negocio se editan desde el panel y los lee tanto
    el admin como la tienda pública.
    """
    # ── WhatsApp ──
    whatsapp_principal = models.CharField(
        max_length=20, blank=True, default='',
        help_text='Número que ve el cliente en la tienda (10 dígitos)')
    whatsapp_respaldos = models.JSONField(
        default=list, blank=True,
        help_text='Respaldos: [{"label": "Respaldo 1", "number": "7441234567"}]')

    # ── Datos del negocio (tickets, fichas, cartas) ──
    negocio_nombre = models.CharField(max_length=120, blank=True, default='REMALI')
    negocio_telefono = models.CharField(max_length=40, blank=True, default='')
    negocio_direccion = models.CharField(max_length=255, blank=True, default='')
    negocio_email = models.EmailField(blank=True, default='')
    negocio_web = models.CharField(max_length=120, blank=True, default='')
    negocio_rfc = models.CharField(max_length=20, blank=True, default='')
    negocio_representante = models.CharField(
        max_length=120, blank=True, default='',
        help_text='Nombre que firma la cotización (ej. C.P. Nombre Apellido)')
    negocio_footer = models.CharField(max_length=200, blank=True, default='¡Gracias por su preferencia!')

    # ── Cotizaciones: condiciones de pago y datos bancarios ──
    # Salen en la carta y el PDF. Son editables (no texto quemado) porque el
    # porcentaje de anticipo, el descuento y la cuenta cambian con el tiempo.
    cotizacion_condiciones = models.TextField(
        blank=True,
        default=('Anticipo del 60% para iniciar el pedido; el resto contra entrega.\n'
                 'Pago de contado (una sola exhibición): 5% de descuento.\n'
                 'Precios sujetos a cambio sin previo aviso.'),
        help_text='Condiciones que aparecen en las cotizaciones de VENTA')
    cotizacion_condiciones_renta = models.TextField(
        blank=True,
        default=('IMPORTANTE\n'
                 'El equipo deberá entregarse en las mismas condiciones en que se recibe (limpio); de lo '
                 'contrario se hará un cargo adicional de $300.00 más IVA.\n'
                 'Diariamente y antes de arrancar el motor, verificar el nivel de aceite y agregar en caso necesario.\n'
                 'Hacer cambio de aceite cada 25 horas de trabajo.\n'
                 'Utilizar gasolina limpia en los motores.\n'
                 'No desarmar parcial ni totalmente ningún equipo sin autorización de nuestra gerencia de servicio; '
                 'reportar cualquier desperfecto a los tels. 744-507-33-34 / 744-373-72-01.\n'
                 'En caso de no atender lo anterior, o de avería y daños en la máquina, la reparación será por cuenta del cliente.'),
        help_text='Condiciones que aparecen en las cotizaciones de RENTA')
    datos_bancarios = models.TextField(
        blank=True, default='',
        help_text='Datos para depósito/transferencia que se muestran en la cotización '
                  '(banco, titular, cuenta, CLABE)')
    cotizacion_cierre = models.TextField(
        blank=True,
        default=('Confiando en que lo anterior sea de su agrado y esperando contar con '
                 'su valiosa preferencia, le extendemos un cordial saludo.'),
        help_text='Frase de despedida al pie de la cotización')

    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'configuracion_sitio'
        verbose_name = 'Configuración del sitio'
        verbose_name_plural = 'Configuración del sitio'

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton: siempre el mismo registro
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return 'Configuración del sitio'


class CorreoAviso(models.Model):
    """Correos que reciben el aviso de nuevas solicitudes de cotización.

    Se verifican con un token enviado al propio correo: mientras no se
    verifique NO recibe avisos, así un typo no manda los avisos al vacío.
    """
    email = models.EmailField(unique=True)
    etiqueta = models.CharField(max_length=60, blank=True, default='', help_text='Ej. "Respaldo 1"')
    verificado = models.BooleanField(default=False)
    token = models.CharField(max_length=64, blank=True, default='', editable=False)
    creado = models.DateTimeField(auto_now_add=True)
    verificado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'correos_aviso'
        verbose_name = 'Correo de aviso'
        verbose_name_plural = 'Correos de aviso'
        ordering = ['email']

    def nuevo_token(self):
        import secrets
        self.token = secrets.token_urlsafe(32)
        return self.token

    def __str__(self):
        return f'{self.email}{"" if self.verificado else " (sin verificar)"}'


class Cupon(models.Model):
    codigo = models.CharField(max_length=50, unique=True)
    descuento = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
        help_text="Fracción de descuento (0-1, ej. 0.15 = 15%)"
    )
    activo = models.BooleanField(default=True)
    # Un cupón puede ser general (usuario vacío) o PERSONAL de un cliente —el del
    # 5% por completar perfil—. `motivo` deja rastro de por qué se emitió.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='cupones',
    )
    motivo = models.CharField(max_length=40, blank=True, default='')
    creado = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        db_table = 'cupones'
        verbose_name = 'Cupón'
        verbose_name_plural = 'Cupones'

    def __str__(self):
        return self.codigo

class Notificacion(models.Model):
    TIPOS = [
        ('renta', 'Renta'),
        ('venta', 'Venta'),
        ('alerta', 'Alerta'),
        ('inventario', 'Inventario'),
        ('sistema', 'Sistema'),
    ]

    tipo = models.CharField(max_length=20, choices=TIPOS, default='sistema')
    titulo = models.CharField(max_length=200)
    mensaje = models.TextField(blank=True, default='')
    seccion = models.CharField(max_length=40, blank=True, default='')  # a qué módulo del dashboard enlaza
    leida = models.BooleanField(default=False)
    ref = models.CharField(max_length=120, blank=True, default='', db_index=True)  # clave para evitar duplicados
    data = models.JSONField(blank=True, default=dict)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notificaciones'
        verbose_name = 'Notificación'
        verbose_name_plural = 'Notificaciones'
        ordering = ['-creada']

    def __str__(self):
        return f'[{self.tipo}] {self.titulo}'


def crear_notificacion(tipo, titulo, mensaje='', seccion='', ref='', data=None):
    """Crea una notificación; si se pasa `ref` evita duplicar (leída o no) con la misma ref."""
    if ref:
        existe = Notificacion.objects.filter(ref=ref).exists()
        if existe:
            return None
    return Notificacion.objects.create(
        tipo=tipo, titulo=titulo, mensaje=mensaje, seccion=seccion, ref=ref, data=(data or {})
    )


class ConversacionSoporte(models.Model):
    ESTADOS = [
        ('abierta', 'Abierta'),
        ('cerrada', 'Cerrada'),
    ]

    nombre = models.CharField(max_length=120, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    telefono = models.CharField(max_length=30, blank=True, default='')
    asunto = models.CharField(max_length=200, blank=True, default='')
    estado = models.CharField(max_length=20, choices=ESTADOS, default='abierta')
    asignado_a = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='conversaciones_soporte',
    )
    last_read_admin = models.DateTimeField(null=True, blank=True)
    creada = models.DateTimeField(auto_now_add=True)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'conversaciones_soporte'
        verbose_name = 'Conversación (soporte)'
        verbose_name_plural = 'Conversaciones (soporte)'
        ordering = ['-actualizada', '-id']

    def __str__(self):
        return f'{self.id} - {self.asunto or self.email or "Conversación"}'


class MensajeSoporte(models.Model):
    AUTORES = [
        ('usuario', 'Usuario'),
        ('admin', 'Admin'),
    ]

    conversacion = models.ForeignKey(
        ConversacionSoporte,
        related_name='mensajes',
        on_delete=models.CASCADE,
    )
    autor_tipo = models.CharField(max_length=20, choices=AUTORES)
    autor_admin = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='mensajes_soporte',
    )
    cuerpo = models.TextField()
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'mensajes_soporte'
        verbose_name = 'Mensaje (soporte)'
        verbose_name_plural = 'Mensajes (soporte)'
        ordering = ['creada', 'id']

    def __str__(self):
        return f'{self.conversacion_id} - {self.autor_tipo} - {self.creada}'


class SelloTema(models.Model):
    """Última modificación por tema del panel (ver latido.py).

    Una fila por tema; las señales la avanzan en cada save/delete y
    /latido/ la sirve completa en una sola consulta barata."""
    tema = models.CharField(max_length=30, unique=True)
    marca = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.tema} @ {self.marca:%H:%M:%S}'
