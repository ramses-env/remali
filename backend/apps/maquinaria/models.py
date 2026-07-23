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
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'perfiles_usuario'
        verbose_name = 'Perfil de usuario'
        verbose_name_plural = 'Perfiles de usuario'

    def __str__(self):
        return f'Perfil de {self.usuario.username}'


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
    modelo = models.CharField(max_length=120, default='')
    descripcion = models.TextField(blank=True)
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
    negocio_rfc = models.CharField(max_length=20, blank=True, default='')
    negocio_footer = models.CharField(max_length=200, blank=True, default='¡Gracias por su preferencia!')

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
