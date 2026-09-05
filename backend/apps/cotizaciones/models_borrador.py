"""El taller privado del cliente: borradores y su autorización interna.

Esto NO es una cotización de REMALI. Es el espacio donde el cliente arma
versiones, las compara y se las manda a su jefe para que las autorice. REMALI no
ve nada de aquí: un borrador puede nacer, cambiar diez veces y morir rechazado
sin que el negocio se entere ni gaste un folio.

La `Cotizacion` nace SOLO cuando el cliente decide mandarla —directo o ya
autorizada por su jefe—. Por eso son dos tablas y no un estado más: si fuera un
estado, cada consulta futura del panel tendría que acordarse de filtrarlo, y
tarde o temprano una se olvida.

Nada de esto se registra en el admin de Django ni en el Dashboard, **a
propósito**: no es una función que falte llevar al panel, es información del
cliente que REMALI decidió no tener.
"""
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from . import precios

# Días que vale un paquete congelado: la misma vigencia que una cotización.
VIGENCIA_DIAS = 15
# Topes: el taller es para comparar unas cuantas versiones, no un archivero.
MAX_BORRADORES = 20
MAX_POR_PAQUETE = 20
# Días sin actividad tras los que se purga un espacio de invitado.
DIAS_PURGA = 90
# Días de silencio de quien autoriza tras los que se le avisa AL CLIENTE.
DIAS_RECORDATORIO = 5


def nuevo_token():
    return secrets.token_hex(16)


class DuenoMixin(models.Model):
    """Dueño del objeto: una cuenta, o un espacio de invitado. Nunca los dos.

    El invitado no tiene usuario, así que su "espacio de trabajo" no es una
    tabla: es el conjunto de filas que comparten su `espacio_token`. Cuando se
    registra, el token se cambia por el usuario (ver `reclamar_espacio`).
    """
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE,
        related_name='%(class)s_set',
    )
    espacio_token = models.CharField(max_length=32, null=True, blank=True, db_index=True)

    class Meta:
        abstract = True


class PaqueteAutorizacion(DuenoMixin):
    """Lo que el cliente le manda a su jefe: una liga, uno o varios borradores.

    Mandar UNO y mandar TRES es el mismo camino. Antes el envío individual y el
    lote eran dos endpoints y dos pantallas casi idénticas; aquí el paquete de
    uno deja de ser un caso especial.
    """
    # Qué puede hacer el jefe con lo que recibe. Lo elige el cliente al mandarlo,
    # porque solo él sabe si son tres versiones de LO MISMO o tres pedidos.
    MODOS = [
        ('opciones', 'Son opciones: autoriza una sola'),
        ('lista', 'Son varias: autoriza las que quiera'),
    ]
    ESTADOS = [
        ('pendiente', 'Esperando al autorizador'),
        ('resuelto', 'Ya lo resolvió'),
        ('retirado', 'El cliente lo retiró'),
    ]

    token = models.CharField(max_length=64, unique=True, default=nuevo_token, editable=False)
    modo = models.CharField(max_length=8, choices=MODOS, default='lista')
    # Recado del cliente para quien autoriza ("es para la obra Norte, urge el martes").
    mensaje = models.TextField(blank=True, default='')
    estado = models.CharField(max_length=10, choices=ESTADOS, default='pendiente')

    # Congelado: al mandarlo, los precios de sus borradores se escriben en piedra
    # y dejan de seguir al catálogo. El jefe autoriza un número real.
    congelado_en = models.DateTimeField(auto_now_add=True)
    vence_el = models.DateField(null=True, blank=True)

    # Quién resolvió (lo escribe él mismo en la liga; no tiene cuenta) y cuándo.
    autorizada_por = models.CharField(max_length=120, blank=True, default='')
    resuelto_en = models.DateTimeField(null=True, blank=True)
    # Cuándo se le recordó AL CLIENTE que su autorizador no ha contestado. Se
    # guarda para no repetirlo: un recordatorio que llega tres veces se ignora.
    recordatorio_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'cotizacion_paquetes'
        verbose_name = 'Paquete de autorización'
        verbose_name_plural = 'Paquetes de autorización'
        ordering = ['-congelado_en']
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(usuario__isnull=False, espacio_token__isnull=True)
                    | Q(usuario__isnull=True, espacio_token__isnull=False)
                ),
                name='paquete_un_solo_dueno',
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.vence_el:
            base = self.congelado_en.date() if self.congelado_en else timezone.now().date()
            self.vence_el = base + timedelta(days=VIGENCIA_DIAS)
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = list(set(kwargs['update_fields']) | {'vence_el'})
        super().save(*args, **kwargs)

    @property
    def vencido(self) -> bool:
        return self.estado == 'pendiente' and bool(self.vence_el) and self.vence_el < timezone.now().date()

    @property
    def total(self) -> Decimal:
        """Lo que suman todos los borradores del paquete: el número que al jefe
        de verdad le importa cuando le llegan tres de golpe."""
        return sum((b.total for b in self.borradores.all()), Decimal('0.00'))

    def __str__(self):
        return f'Paquete {self.token[:8]} · {self.get_estado_display()}'


class BorradorCliente(DuenoMixin):
    """Una versión que el cliente está armando. Invisible para REMALI."""
    ESTADOS = [
        ('armando', 'Armándola'),
        ('esperando', 'Esperando autorización'),
        ('rechazado', 'Rechazado por su autorizador'),
        ('entregado', 'Ya se mandó a REMALI'),
    ]
    DECISIONES = [
        ('autorizado', 'Autorizado'),
        ('rechazado', 'Rechazado'),
        ('cambios', 'Le pidieron cambios'),
    ]

    # La etiqueta que le pone el cliente para distinguir sus versiones
    # ("Obra Norte — opción 2"). Vacía = la lista muestra la fecha.
    nombre = models.CharField(max_length=120, blank=True, default='')
    estado = models.CharField(max_length=10, choices=ESTADOS, default='armando', db_index=True)

    # Misma forma que Cotizacion.datos_solicitud, para que mandarlo sea un
    # volcado y no una traducción.
    datos_contacto = models.JSONField(default=dict, blank=True)
    obra = models.JSONField(default=dict, blank=True)
    requiere_factura = models.BooleanField(default=False)
    cupon = models.ForeignKey(
        'maquinaria.Cupon', null=True, blank=True, on_delete=models.SET_NULL, related_name='borradores',
    )

    paquete = models.ForeignKey(
        PaqueteAutorizacion, null=True, blank=True, on_delete=models.SET_NULL, related_name='borradores',
    )
    # La decisión del jefe SOBRE ESTE borrador. En modo 'lista' cada uno lleva la
    # suya; en modo 'opciones' la que no eligió queda rechazada sola.
    decision = models.CharField(max_length=10, choices=DECISIONES, blank=True, default='')
    rechazo_motivo = models.TextField(blank=True, default='')
    # Lo que quien autoriza pidió CAMBIAR. Vive aparte del rechazo porque no es
    # un "no": es un "sí, pero". El borrador vuelve a manos del cliente con esta
    # nota pegada, y se limpia en cuanto la atiende.
    cambios_pedidos = models.TextField(blank=True, default='')

    # La cotización que nació de este borrador (si llegó a nacer). Es el único
    # hilo que cruza la frontera, y va en este sentido: del lado privado hacia el
    # de REMALI, nunca al revés.
    cotizacion = models.ForeignKey(
        'cotizaciones.Cotizacion', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='borradores_origen',
    )

    creado = models.DateTimeField(auto_now_add=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cotizacion_borradores'
        verbose_name = 'Borrador del cliente'
        verbose_name_plural = 'Borradores del cliente'
        ordering = ['-actualizado']
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(usuario__isnull=False, espacio_token__isnull=True)
                    | Q(usuario__isnull=True, espacio_token__isnull=False)
                ),
                name='borrador_un_solo_dueno',
            ),
        ]

    # ── Precio ──
    # Mientras se arma NO hay precio firme: se resuelve contra el catálogo de hoy
    # en cada lectura. Se congela al mandarlo a autorizar, y desde ahí manda lo
    # guardado aunque el catálogo se mueva.
    @property
    def congelado(self) -> bool:
        return self.estado != 'armando'

    def lineas(self):
        """Las partidas con su precio ya resuelto, listas para mostrar."""
        congelado = self.congelado
        return [i.resuelto(congelado) for i in self.items.all()]

    @property
    def subtotal_venta(self) -> Decimal:
        return sum((l['subtotal'] for l in self.lineas() if l['modalidad'] == 'venta'), Decimal('0.00'))

    @property
    def subtotal_renta(self) -> Decimal:
        return sum((l['subtotal'] for l in self.lineas() if l['modalidad'] != 'venta'), Decimal('0.00'))

    @property
    def total(self) -> Decimal:
        base, iva = precios.desglose(self.subtotal_venta, self.subtotal_renta, self.requiere_factura)
        return (base + iva).quantize(Decimal('0.01'))

    @property
    def tipo(self) -> str:
        return precios.tipo_desde_modalidades(l['modalidad'] for l in self.lineas()) or 'venta'

    def congelar(self):
        """Escribe en piedra el precio de hoy en cada partida.

        A partir de aquí el catálogo puede moverse: lo que el jefe ve es lo que
        REMALI va a respetar. Una partida cuyo equipo ya no existe se queda sin
        precio: no se cotiza lo que no se puede surtir.
        """
        for item in self.items.select_related('equipo'):
            r = item.resuelto(False)
            item.descripcion = r['descripcion']
            item.precio_unitario = r['precio_unitario']
            item.precio_lista = r['precio_lista']
            item.modalidad = r['modalidad']
            item.save(update_fields=['descripcion', 'precio_unitario', 'precio_lista', 'modalidad'])

    def __str__(self):
        return self.nombre or f'Borrador {self.pk}'


class BorradorItem(models.Model):
    """Una partida del borrador.

    Mientras el borrador se arma, aquí solo vive la INTENCIÓN (qué equipo, cuánto
    y en qué modalidad); el precio se calcula al vuelo. Los tres campos de precio
    se llenan al congelar. Si el equipo se borra del catálogo, la partida no
    miente con un precio muerto: se marca no disponible y sale del total.
    """
    borrador = models.ForeignKey(BorradorCliente, on_delete=models.CASCADE, related_name='items')
    equipo = models.ForeignKey('maquinaria.Equipo', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    cantidad = models.PositiveIntegerField(default=1)
    duracion = models.PositiveIntegerField(default=1)
    modalidad = models.CharField(max_length=8, default='venta')

    # Solo se escriben al congelar (ver BorradorCliente.congelar).
    descripcion = models.CharField(max_length=255, blank=True, default='')
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    precio_lista = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        db_table = 'cotizacion_borrador_items'
        ordering = ['id']

    def resuelto(self, congelado: bool):
        """La partida con precio: el guardado si está congelada, el de hoy si no."""
        if congelado:
            descripcion = self.descripcion
            precio = Decimal(self.precio_unitario or 0)
            lista = Decimal(self.precio_lista or 0)
            modalidad = self.modalidad
            disponible = True
        elif self.equipo_id and self.equipo:
            p = precios.partida_de_equipo(self.equipo, self.modalidad)
            descripcion = p['descripcion']
            precio = p['precio_unitario']
            lista = p['precio_lista']
            modalidad = p['modalidad']
            disponible = True
        else:
            # El equipo ya no está en el catálogo: se dice, no se inventa.
            descripcion = self.descripcion or 'Equipo ya no disponible'
            precio = lista = Decimal('0.00')
            modalidad = self.modalidad
            disponible = False

        n = precios.periodos(modalidad, self.duracion)
        return {
            'id': self.pk,
            'equipo': self.equipo_id,
            'descripcion': descripcion,
            'cantidad': self.cantidad,
            'duracion': self.duracion,
            'modalidad': modalidad,
            'precio_unitario': precio,
            'precio_lista': lista,
            'subtotal': (precio * self.cantidad * n).quantize(Decimal('0.01')) if disponible else Decimal('0.00'),
            'disponible': disponible,
        }

    def __str__(self):
        return f'{self.descripcion or self.equipo_id} x{self.cantidad}'
