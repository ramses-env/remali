from decimal import Decimal
from secrets import token_urlsafe
from urllib.parse import quote

from django.conf import settings
from django.contrib.staticfiles import finders
from django.contrib.staticfiles.storage import staticfiles_storage
from django.core.files.storage import default_storage
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

from .permissions import (
    ROL_ADMIN, ROL_ASESOR, ROL_CAJERO, ROL_GERENTE, ROL_TECNICO,
)


def select_ficha_storage():
    """Compatibilidad con migraciones: la ficha técnica usa el storage por defecto."""
    return default_storage


def nombre_propio(texto: str) -> str:
    conectores = {'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von'}
    palabras = (texto or '').strip().split()
    out = []
    for i, p in enumerate(palabras):
        pl = p.lower()
        out.append(pl if (i > 0 and pl in conectores) else (pl[:1].upper() + pl[1:]))
    return ' '.join(out)


# ═══════════════════════════════════════════════════════════════════
# AVATARES POR DEFECTO SEGÚN ROL
# ═══════════════════════════════════════════════════════════════════
# Se sirven en este orden de prioridad:
#   1. Foto subida por el usuario (campo `avatar` de PerfilUsuario).
#   2. PNG estático del rol (apps/maquinaria/static/maquinaria/avatares-rol/*.png).
#   3. SVG inline (data-URI) con paleta del rol + inicial del usuario.
#
# Nunca volvemos None: hay un avatar para CUALQUIER cuenta.
# ═══════════════════════════════════════════════════════════════════

# Mapeo: ROL QUE MUESTRA EL PANEL → ARCHIVO (sin extensión)
ROL_ARCHIVO = {
    'Dueño':        'admin',   # el dueño se ve como administración, no como su grupo
    ROL_ADMIN:      'admin',
    ROL_GERENTE:    'gerente',
    ROL_CAJERO:     'cajero',
    ROL_ASESOR:     'asesor',
    ROL_TECNICO:    'tecnico',
    'Almacén':      'tecnico',
    'Cliente':      'cliente',
}

# Paleta usada cuando el PNG del rol NO existe (fallback SVG).
ROL_PALETA = {
    ROL_ADMIN:      {'fondo': '#FFD369', 'texto': '#181715', 'acento': '#FFD369', 'inicial': 'A'},
    ROL_GERENTE:    {'fondo': '#3B3A37', 'texto': '#FFD369', 'acento': '#FFD369', 'inicial': 'G'},
    ROL_CAJERO:     {'fondo': '#1F2937', 'texto': '#60A5FA', 'acento': '#60A5FA', 'inicial': '$'},
    ROL_ASESOR:     {'fondo': '#132A25', 'texto': '#34D399', 'acento': '#34D399', 'inicial': '✎'},
    ROL_TECNICO:    {'fondo': '#2A1F1A', 'texto': '#FB923C', 'acento': '#FB923C', 'inicial': '⚙'},
    'Almacén':      {'fondo': '#2A1F1A', 'texto': '#FB923C', 'acento': '#FB923C', 'inicial': '⚙'},
    'Cliente':      {'fondo': '#2B2A28', 'texto': '#E6E6E6', 'acento': '#E6E6E6', 'inicial': 'C'},
}
_PALETA_DEFAULT = {'fondo': '#2B2A28', 'texto': '#E6E6E6', 'acento': '#E6E6E6', 'inicial': 'U'}


def _avatar_svg(cfg: dict, inicial_usuario: str = '') -> str:
    """Fallback SVG vectorial (data-URI) cuando el PNG no existe o falta."""
    fondo = cfg['fondo']
    texto = cfg['texto']
    acento = cfg['acento']
    inicial = inicial_usuario or cfg['inicial']
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="{fondo}" stop-opacity="1"/>
      <stop offset="100%" stop-color="{fondo}" stop-opacity="0.92"/>
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="98" fill="url(#bg)"/>
  <circle cx="100" cy="100" r="92" fill="none" stroke="{acento}" stroke-opacity="0.35" stroke-width="4"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="{acento}" stroke-opacity="0.12" stroke-width="2"/>
  <text x="100" y="104" text-anchor="middle" dominant-baseline="central" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="110" font-weight="800" fill="{texto}"
        style="dominant-baseline:central; letter-spacing: -0.02em;">{inicial}</text>
</svg>"""
    return 'data:image/svg+xml;charset=utf-8,' + quote(svg, safe='')


def _static_url_avatar_rol(rol: str) -> str | None:
    """Devuelve la URL del PNG estático del rol, si el archivo existe.

    Usa `finders.find()` (respeta AppDirectoriesFinder / FileSystemFinder)
    para localizar el PNG SIN haber corrido `collectstatic` todavía. Solo
    después resolvemos la URL pública vía `staticfiles_storage.url()`."""
    archivo_base = ROL_ARCHIVO.get(rol)
    if not archivo_base:
        return None
    ruta_rel = f'maquinaria/avatares-rol/{archivo_base}.png'
    try:
        encontrado = finders.find(ruta_rel)
        if not encontrado:
            # Fallback: tal vez ya fue collecteado a STATIC_ROOT y finders
            # no lo incluye porque STATICFILES_DIRS / APP_DIRS no lo cubre.
            if not staticfiles_storage.exists(ruta_rel):
                return None
        return staticfiles_storage.url(ruta_rel)
    except Exception:
        return None


def _rol_de_usuario(usuario) -> str:
    """El rol que decide QUÉ AVATAR se muestra.

    Delega en `rol_de()`, que es la MISMA función con la que el panel escribe la
    etiqueta junto al nombre. Antes esto tenía su propia precedencia —el grupo
    por encima de todo— y el resultado era que el dueño (superusuario que además
    está en el grupo 'Técnico') salía con el chip "DUEÑO" al lado de la foto de
    técnico. Dos verdades sobre la misma persona en la misma tarjeta.

    Con una sola fuente, la regla es simple: si el panel te llama Dueño, tu
    avatar es el de administración.
    """
    from .permissions import ROL_TECNICO_ANTERIOR, rol_de
    if not usuario or not usuario.pk:
        return ''

    rol = rol_de(usuario)
    if rol in ROL_ARCHIVO:
        return rol
    if rol == ROL_TECNICO_ANTERIOR:
        return ROL_TECNICO

    # Grupo escrito a mano sin acento ("Tecnico"): rol_de no lo reconoce y
    # devolvería la etiqueta del nivel. Aquí sí lo rescatamos por el grupo.
    alias = {'administrador': ROL_ADMIN, 'gerente': ROL_GERENTE, 'asesor': ROL_ASESOR,
             'cajero': ROL_CAJERO, 'tecnico': ROL_TECNICO, 'almacén': ROL_TECNICO,
             'almacen': ROL_TECNICO, 'cliente': 'Cliente'}
    for n in usuario.groups.values_list('name', flat=True):
        r = alias.get(str(n).lower())
        if r:
            return r

    # Cuenta de administración "de fábrica" (staff sin grupo con nombre).
    if getattr(usuario, 'is_superuser', False) or getattr(usuario, 'is_staff', False):
        return ROL_ADMIN
    return ''


def _inicial_usuario(usuario) -> str:
    if not usuario:
        return ''
    nombres = [
        (getattr(usuario, 'first_name', None) or '').strip(),
        (getattr(usuario, 'last_name', None) or '').strip(),
        (getattr(usuario, 'username', None) or '').strip(),
    ]
    for parte in nombres:
        if parte:
            return parte[:1].upper()
    return ''


def avatar_por_rol(usuario, *, override_inicial='', absoluta=False, request=None) -> str:
    """Devuelve la URL (o data-URI) del avatar POR DEFECTO para este usuario.

    Flujo: PNG estático del rol → SVG inline (con la inicial del usuario).
    Si `request` se pasa, la URL del PNG siempre se entrega ABSOLUTA porque
    el frontend suele correr en otro host/puerto (Vite) y una ruta /static/
    relativa se resolvería contra el frontend, no contra el backend."""
    rol = _rol_de_usuario(usuario) if usuario else ''
    inicial = override_inicial or _inicial_usuario(usuario)

    # 1) Intentar PNG estático del rol.
    url = _static_url_avatar_rol(rol) if rol else None

    # 2) Fallback: SVG inline.
    if not url:
        cfg = ROL_PALETA.get(rol, _PALETA_DEFAULT)
        salida = _avatar_svg(cfg, inicial)
        # data-URI no requiere absolutizar: el navegador la lee directo.
        return salida

    # 3) El PNG sí existe: absolutizar la URL si hace falta.
    #    Si hay request, build_absolute_uri sin excepciones (localhost o prod).
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url
    if absoluta and settings.STATIC_URL and url.startswith('/'):
        try:
            from django.contrib.staticfiles.storage import staticfiles_storage as s
            base = getattr(s, 'base_url', None) or getattr(settings, 'STATIC_URL', '/static/')
            if base and base.startswith('http'):
                return base.rstrip('/') + url
        except Exception:
            pass
    return url


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
    empresa = models.CharField(max_length=180, blank=True, default='')
    obra_direccion = models.CharField(max_length=255, blank=True, default='')
    obra_responsable = models.CharField(max_length=180, blank=True, default='')
    email_token = models.CharField(max_length=64, blank=True, default='', editable=False)
    # Cuándo se emitió el token de arriba. La liga del correo abre sesión sola, así
    # que no puede valer para siempre: un correo viejo reenviado sería una llave a
    # la cuenta. Con esta fecha, la vista de verificación la caduca (48 h).
    email_token_creado = models.DateTimeField(null=True, blank=True, editable=False)
    email_verificado = models.BooleanField(default=False)
    email_verificado_en = models.DateTimeField(null=True, blank=True)
    recompensado = models.BooleanField(default=False)
    fiscal_razon_social = models.CharField(max_length=200, blank=True, default='')
    fiscal_rfc = models.CharField(max_length=20, blank=True, default='')
    fiscal_regimen = models.CharField(max_length=10, blank=True, default='')
    fiscal_cp = models.CharField(max_length=10, blank=True, default='')
    fiscal_uso_cfdi = models.CharField(max_length=10, blank=True, default='')
    fiscal_email = models.EmailField(blank=True, default='')

    # ── 🔐 Código de seguridad PERSONAL (PIN de 6 dígitos) ──
    # Autoriza acciones sensibles (cancelar venta/renta, ajustar precio a mano,
    # anticipo bajo el mínimo, resolver depósito). Se guarda HASHEADO como una
    # contraseña; cada operador tiene el suyo, así el rastro dice QUIÉN autorizó.
    # `codigo_intentos` / `codigo_bloqueado_hasta` frenan la fuerza bruta (un PIN
    # de 6 dígitos sin límite es adivinable).
    codigo_seguridad = models.CharField(max_length=128, blank=True, default='', editable=False)
    codigo_intentos = models.PositiveSmallIntegerField(default=0)
    codigo_bloqueado_hasta = models.DateTimeField(null=True, blank=True)

    fecha_actualizacion = models.DateTimeField(auto_now=True)
    onboarding_completado = models.BooleanField(
        default=False,
        help_text='El cliente ya terminó la guía de primer uso.'
    )
    onboarding_pasos_completados = models.JSONField(
        default=list,
        blank=True,
        help_text='IDs de los pasos o tours que el cliente ya completó.'
    )
    onboarding_iniciado_en = models.DateTimeField(null=True, blank=True)
    onboarding_finalizado_en = models.DateTimeField(null=True, blank=True)
    onboarding_version = models.PositiveSmallIntegerField(
        default=1,
        help_text='Versión del tour. Al incrementar, se obliga a ver la nueva guía.'
    )

    class Meta:
        db_table = 'perfiles_usuario'
        verbose_name = 'Perfil de usuario'
        verbose_name_plural = 'Perfiles de usuario'

    def __str__(self):
        return f'Perfil de {self.usuario.username}'

    @property
    def rol_display(self) -> str:
        return _rol_de_usuario(self.usuario) or 'Cliente'

    @property
    def datos_completos(self):
        # El formulario del cliente captura el nombre completo en UN solo campo
        # (first_name); no pedimos apellido por separado. El 5% de bienvenida se
        # activa con lo mínimo para atender y contactar al cliente: nombre +
        # teléfono. La empresa y los datos fiscales son OPCIONALES —no todo
        # cliente los tiene ni los quiere—, así que no bloquean el descuento.
        return bool(
            (self.usuario.first_name or '').strip()
            and (self.telefono or '').strip()
        )

    @property
    def perfil_verificado(self):
        return self.email_verificado and self.datos_completos

    @property
    def avatar_por_defecto_url(self) -> str:
        """Data-URI con el avatar POR DEFECTO de su rol (sin guardar nada)."""
        return avatar_por_rol(self.usuario)

    @property
    def avatar_resuelto_url(self) -> str:
        """Prioridad: foto subida > avatar por rol. Nunca vacío."""
        if self.avatar:
            try:
                return self.avatar.url
            except Exception:
                pass
        return self.avatar_por_defecto_url


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
    # Catálogo maestro del producto. La operación real vive en Inventario: qué
    # unidad existe, en qué condición está y si hoy puede rentarse o venderse.

    # Meses de garantía que REMALI le da al COMPRADOR. Por defecto 3, que es lo
    # normal; se ajusta por máquina porque no todas se garantizan igual. En 0 =
    # esta máquina se vende sin garantía.
    # NO confundir con el "depósito en garantía" de las rentas, que es dinero
    # retenido, ni con la garantía que el PROVEEDOR le da a REMALI (esa vive en
    # la venta sobre pedido).
    garantia_meses = models.PositiveSmallIntegerField(
        default=3, help_text='Meses de garantía al comprador. 0 = se vende sin garantía.')

    CONDICIONES = [('nueva', 'Nueva'), ('seminueva', 'Seminueva')]
    ESTADOS_VENTA = [
        ('sin_venta', 'Sin venta'),
        ('inmediata', 'Entrega inmediata'),
        ('sobre_pedido', 'Sobre pedido'),
        ('agotado', 'Agotado'),
    ]

    modelo = models.CharField(max_length=20, default='')
    descripcion = models.TextField(blank=True)
    imagen = models.ImageField(upload_to='products/', blank=True, null=True)
    ficha_tecnica = models.FileField(
        upload_to='fichas/',
        blank=True,
        null=True,
        storage=select_ficha_storage,
        validators=[FileExtensionValidator(['pdf'])],
        help_text='PDF de ficha técnica del equipo (opcional)',
    )
    especificaciones = models.JSONField(default=list, blank=True)
    que_incluye = models.JSONField(default=list, blank=True)
    promo_pct = models.PositiveSmallIntegerField(default=0, blank=True)
    condicion = models.CharField(max_length=10, choices=CONDICIONES, default='nueva')

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
    permite_sobre_pedido = models.BooleanField(
        default=False,
        help_text='Permite vender este producto aunque no haya unidades disponibles en bodega.',
    )
    dias_entrega_pedido = models.PositiveIntegerField(
        default=0,
        help_text='Días estimados de entrega cuando se vende sobre pedido (0 = usar el general del sitio).',
    )

    fecha_creacion = models.DateTimeField(auto_now_add=True)

    def get_precio_por_unidad(self, unidad):
        unidad = (unidad or '').strip().lower()
        if unidad == 'dia':
            return self.precio_dia
        if unidad == 'semana':
            return self.precio_semana
        if unidad == 'mes':
            return self.precio_mes
        return None

    @property
    def condiciones_catalogo(self):
        vals = sorted({u.condicion for u in self.unidades.all() if u.condicion and u.estado != 'vendido'})
        return vals or ([self.condicion] if self.condicion else [])

    @property
    def disponibilidad_detallada(self):
        """
        Desglose de disponibilidad POR CONDICIÓN.

        Devuelve un dict con llaves 'nueva' y/o 'seminueva' (solo las que
        existen en inventario no vendido, o la default del catálogo si no
        hay unidades). Para cada una indica:
          - venta_disponible: bool   (hay unidades de esa condición para vender)
          - renta_disponible: bool   (hay unidades de esa condición para rentar)
          - venta_estado: 'sin_venta'|'inmediata'|'sobre_pedido'|'agotado'
          - stock_venta: int         (unidades disponibles para venta)
          - stock_renta: int         (unidades disponibles para renta)

        El frontend usa esta info para generar UNA CARD POR COMBINACIÓN
        (condición × modo) válida, en lugar de colapsar todas las condiciones
        en una sola card por modo.
        """
        unidades = [u for u in self.unidades.all() if u.estado != 'vendido']
        condiciones_presentes = sorted({u.condicion for u in unidades if u.condicion})
        if not condiciones_presentes and self.condicion:
            condiciones_presentes = [self.condicion]

        out = {}
        precio_venta_ok = bool(self.precio_venta and self.precio_venta > 0)
        precio_renta_ok = any([self.precio_dia, self.precio_semana, self.precio_mes])

        for cond in condiciones_presentes:
            es_nueva = cond == 'nueva'
            unidades_cond = [u for u in unidades if u.condicion == cond]
            # Venta pública SOLO de unidades NUEVAS (regla de negocio): la seminueva
            # se renta; venderla es caso especial interno, no se exhibe en catálogo.
            unidades_venta = [u for u in unidades_cond if u.puede_venderse()] if es_nueva else []
            unidades_renta = [u for u in unidades_cond if u.puede_rentarse()]

            venta_disponible = len(unidades_venta) > 0
            renta_disponible = (len(unidades_renta) > 0) and precio_renta_ok

            # Cualquier máquina de venta (línea nueva con precio) se ofrece: con stock
            # es venta inmediata; si se AGOTÓ, pasa sola a SOBRE PEDIDO (se ordena al
            # proveedor) y al reponer stock vuelve a 'inmediata'. `permite_sobre_pedido`
            # ya no es requisito: solo distingue las "especiales" que nunca tienen stock.
            ofrece_venta_cond = es_nueva and precio_venta_ok

            if ofrece_venta_cond:
                venta_estado = 'inmediata' if venta_disponible else 'sobre_pedido'
            else:
                venta_estado = 'sin_venta'

            entrega_cond = None
            if venta_estado == 'sobre_pedido':
                if self.dias_entrega_pedido > 0:
                    entrega_cond = self.dias_entrega_pedido
                else:
                    try:
                        entrega_cond = ConfiguracionSitio.get_solo().dias_entrega_pedido or None
                    except Exception:
                        entrega_cond = None

            out[cond] = {
                'venta_disponible': venta_disponible,
                'renta_disponible': renta_disponible,
                'venta_estado': venta_estado,
                'stock_venta': len(unidades_venta),
                'stock_renta': len(unidades_renta),
                'entrega_estimada_dias': entrega_cond,
            }

        return out

    @property
    def _tiene_linea_nueva(self):
        """El producto maneja unidades NUEVAS (para saber si la venta pública aplica).
        Con inventario: hay alguna unidad nueva; sin unidades: la condición por defecto."""
        us = list(self.unidades.all())
        if us:
            return any(u.condicion == 'nueva' for u in us)
        return (self.condicion or '') == 'nueva'

    @property
    def ofrece_venta_catalogo(self):
        # Venta pública SOLO de línea NUEVA. Las seminuevas se rentan; venderlas es
        # caso especial interno (admin/POS), no se promociona en el catálogo.
        if not (self.precio_venta and self.precio_venta > 0):
            return False
        if self.venta_disponible_catalogo:
            return True
        # Agotada (o especial sin stock): se ofrece SOBRE PEDIDO automáticamente.
        return self._tiene_linea_nueva

    @property
    def _tiene_linea_renta(self):
        """El producto es una LÍNEA de renta (seminueva, o nueva autorizada para
        renta), aunque ahora mismo no haya unidades libres. Sirve para mostrar la
        card de renta como 'Agotado' en vez de esconderla o marcarla 'Disponible'."""
        us = list(self.unidades.all())
        if us:
            return any(u.condicion == 'seminueva' or (u.condicion == 'nueva' and u.autorizada_para_renta)
                       for u in us)
        return (self.condicion or '') == 'seminueva'

    @property
    def ofrece_renta_catalogo(self):
        # CAPABILITY (no disponibilidad): tiene tarifa de renta y es línea rentable.
        # La disponibilidad real la dice renta_disponible_catalogo / renta_estado.
        tiene_tarifa = any([self.precio_dia, self.precio_semana, self.precio_mes])
        return bool(tiene_tarifa) and self._tiene_linea_renta

    @property
    def venta_disponible_catalogo(self):
        # Solo las unidades NUEVAS cuentan para la venta al público.
        return any(u.puede_venderse() for u in self.unidades.all() if u.condicion == 'nueva')

    @property
    def renta_disponible_catalogo(self):
        return any(u.puede_rentarse() for u in self.unidades.all())

    @property
    def renta_estado(self):
        """'disponible' | 'agotado' | 'sin_renta'. La renta NUNCA es 'sobre pedido'."""
        if not self.ofrece_renta_catalogo:
            return 'sin_renta'
        return 'disponible' if self.renta_disponible_catalogo else 'agotado'

    @property
    def estado_venta_catalogo(self):
        if not self.ofrece_venta_catalogo:
            return 'sin_venta'
        if self.venta_disponible_catalogo:
            return 'inmediata'
        # Sin stock pero es línea de venta -> sobre pedido (se ordena al proveedor).
        return 'sobre_pedido'

    @property
    def entrega_estimada_dias(self):
        if self.estado_venta_catalogo != 'sobre_pedido':
            return None
        if self.dias_entrega_pedido > 0:
            return self.dias_entrega_pedido
        try:
            return ConfiguracionSitio.get_solo().dias_entrega_pedido or None
        except Exception:
            return None

    @property
    def modos_catalogo(self):
        modos = []
        if self.ofrece_venta_catalogo:
            modos.append('venta')
        if self.ofrece_renta_catalogo:
            modos.append('renta')
        return modos

    @property
    def modo(self):
        if 'venta' in self.modos_catalogo:
            return 'venta'
        if 'renta' in self.modos_catalogo:
            return 'renta'
        return 'venta'

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


class Cupon(models.Model):
    codigo = models.CharField(max_length=50, unique=True)
    descuento = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        help_text="Porcentaje de descuento (0-1)"
    )
    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True, null=True)
    motivo = models.CharField(max_length=40, blank=True, default='')
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='cupones',
    )
    # Cupones PERSONALES (con usuario) son de un solo uso: se marcan aquí cuando
    # la venta/renta que los aplicó se concreta. Los genéricos (usuario vacío,
    # p.ej. BIENVENIDA) se quedan reusables. 'usado' vive aparte de 'activo'
    # para no confundir "ya lo gastó el cliente" con "el admin lo apagó".
    usado = models.BooleanField(default=False)
    usado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'cupones'
        verbose_name = 'Cupón'
        verbose_name_plural = 'Cupones'

    def __str__(self):
        return self.codigo

    @property
    def personal(self):
        """De un solo uso y atado a un cliente (vs. los genéricos reusables)."""
        return self.usuario_id is not None

    def marcar_usado(self):
        """Consume el cupón personal (idempotente). No toca los genéricos."""
        if not self.personal or self.usado:
            return
        from django.utils import timezone
        self.usado = True
        self.usado_en = timezone.now()
        self.save(update_fields=['usado', 'usado_en'])

    @classmethod
    def otorgar_bienvenida(cls, usuario):
        """Cupón personal de 5% por completar el perfil (idempotente).

        Se llama cuando el perfil YA está completo. Un solo cupón por usuario
        (motivo 'perfil'); si ya existe lo devuelve tal cual —incluso gastado—,
        no crea otro. Devuelve None si no puede (usuario inválido).
        """
        if not usuario or not getattr(usuario, 'id', None):
            return None
        cupon = cls.objects.filter(usuario=usuario, motivo='perfil').first()
        if cupon:
            return cupon
        import secrets
        from decimal import Decimal
        for _ in range(8):
            codigo = f'MI5-{secrets.token_hex(3).upper()}'
            if not cls.objects.filter(codigo=codigo).exists():
                return cls.objects.create(
                    codigo=codigo, descuento=Decimal('0.05'), activo=True,
                    motivo='perfil', usuario=usuario,
                )
        return None

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
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='notificaciones',
    )
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


def crear_notificacion(tipo, titulo, mensaje='', seccion='', ref='', data=None, *, usuario=None):
    """Crea una notificación.

    - Si `ref` se pasa, evita duplicados (leída o no) con la misma ref.
    - Si `usuario` es User/FK: notificación PERSONAL (solo ese usuario la ve).
    - Si `usuario` es None (default): notificación BROADCAST (la ven todos los
      miembros de staff; los clientes NO reciben broadcasts para evitarles
      ruido de eventos ajenos)."""
    if ref:
        qs_ref = Notificacion.objects.filter(ref=ref)
        if usuario is not None:
            qs_ref = qs_ref.filter(Q(usuario=usuario) | Q(usuario__isnull=True))
        existe = qs_ref.exists()
        if existe:
            return None
    kwargs = dict(
        tipo=tipo, titulo=titulo, mensaje=mensaje, seccion=seccion, ref=ref, data=(data or {}),
    )
    if usuario is not None:
        kwargs['usuario'] = usuario
    return Notificacion.objects.create(**kwargs)


class ConfiguracionSitio(models.Model):
    whatsapp_principal = models.CharField(max_length=20, blank=True, default='')
    whatsapp_respaldos = models.JSONField(blank=True, default=list)
    negocio_nombre = models.CharField(max_length=120, blank=True, default='REMALI')
    negocio_telefono = models.CharField(max_length=40, blank=True, default='')
    negocio_direccion = models.CharField(max_length=255, blank=True, default='')
    negocio_email = models.EmailField(blank=True, default='')
    negocio_web = models.CharField(max_length=120, blank=True, default='')
    negocio_rfc = models.CharField(max_length=20, blank=True, default='')
    negocio_representante = models.CharField(max_length=120, blank=True, default='')
    negocio_footer = models.CharField(max_length=200, blank=True, default='¡Gracias por su preferencia!')
    cotizacion_condiciones = models.TextField(blank=True, default='')
    cotizacion_condiciones_renta = models.TextField(blank=True, default='')
    datos_bancarios = models.TextField(blank=True, default='')
    cotizacion_cierre = models.TextField(blank=True, default='')
    dias_entrega_pedido = models.PositiveIntegerField(default=0)
    # Descuento (%) que se ofrece al pagar de CONTADO en efectivo al vender una
    # máquina. Es política de la empresa: se aplica sin código de autorización.
    descuento_contado_pct = models.PositiveSmallIntegerField(default=5)
    # Anticipo MÍNIMO (%) para apartar/pedir una máquina. Un anticipo menor
    # requiere el código de autorización (codigo_ajuste).
    anticipo_minimo_pct = models.PositiveSmallIntegerField(default=60)
    # Código de 6 dígitos que autoriza AJUSTAR el precio a mano al vender (fuera
    # del descuento de contado). Se guarda hasheado; nunca se devuelve en claro.
    codigo_ajuste = models.CharField(max_length=128, blank=True, default='', editable=False)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'configuracion_sitio'
        verbose_name = 'Configuración del sitio'
        verbose_name_plural = 'Configuración del sitio'

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.negocio_nombre or 'Configuración del sitio'


class CorreoAviso(models.Model):
    email = models.EmailField(unique=True)
    etiqueta = models.CharField(max_length=60, blank=True, default='')
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
        self.token = token_urlsafe(32)[:64]
        return self.token

    def save(self, *args, **kwargs):
        if not self.token:
            self.nuevo_token()
        self.email = (self.email or '').strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.email


class ObraCliente(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='obras',
        on_delete=models.CASCADE,
    )
    nombre = models.CharField(max_length=120)
    empresa = models.CharField(max_length=180, blank=True, default='')  # constructora / nombre de la obra
    responsable = models.CharField(max_length=180, blank=True, default='')
    direccion = models.CharField(max_length=255, blank=True, default='')
    telefono = models.CharField(max_length=30, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    predeterminada = models.BooleanField(default=False)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'obras_cliente'
        verbose_name = 'Obra de cliente'
        verbose_name_plural = 'Obras de cliente'
        ordering = ['-predeterminada', 'nombre']

    def save(self, *args, **kwargs):
        self.nombre = nombre_propio(self.nombre)
        if self.email:
            self.email = self.email.strip().lower()
        super().save(*args, **kwargs)
        if self.predeterminada:
            ObraCliente.objects.filter(usuario=self.usuario).exclude(pk=self.pk).update(predeterminada=False)

    def __str__(self):
        return self.nombre


class SelloTema(models.Model):
    tema = models.CharField(max_length=30, unique=True)
    marca = models.DateTimeField(auto_now=True)


def espejar_obra_predeterminada(usuario):
    perfil = getattr(usuario, 'perfil', None)
    if not perfil:
        return None
    direccion = (perfil.obra_direccion or '').strip()
    responsable = (perfil.obra_responsable or '').strip()
    if not direccion and not responsable:
        return None
    defaults = {
        'responsable': responsable,
        'direccion': direccion,
        'telefono': (perfil.telefono or '').strip(),
        'email': (usuario.email or '').strip().lower(),
        'predeterminada': True,
    }
    obra, _ = ObraCliente.objects.update_or_create(
        usuario=usuario,
        nombre='Obra principal',
        defaults=defaults,
    )
    return obra


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
        return f'{self.id} - {self.autor_tipo} - {self.creada}'


class Favorito(models.Model):
    perfil = models.ForeignKey(
        PerfilUsuario,
        on_delete=models.CASCADE,
        related_name='favoritos',
    )
    equipo = models.ForeignKey(
        Equipo,
        on_delete=models.CASCADE,
        related_name='favoritos',
    )
    fecha_agregado = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'favoritos'
        verbose_name = 'Favorito'
        verbose_name_plural = 'Favoritos'
        unique_together = [('perfil', 'equipo')]
        ordering = ['-fecha_agregado', '-id']

    def __str__(self):
        return f'{self.perfil.usuario.username} ♥ {self.equipo.modelo}'
