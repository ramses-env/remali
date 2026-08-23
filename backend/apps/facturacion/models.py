"""
Solicitudes de factura (CFDI) — bandeja "por facturar".

El sistema NO timbra todavía: solo CAPTURA y deja lista cada venta/renta que el
cliente quiere facturar (con el snapshot fiscal del receptor + importes), para
que se timbre APARTE en el PAC y luego se marque como facturada con su folio
fiscal (UUID). Así no se pierde ninguna venta facturable y queda el control.
"""
from decimal import Decimal

from django.db import models

IVA_RATE = Decimal('0.16')

# Mapa método de pago interno -> clave SAT "Forma de pago".
FORMA_PAGO_SAT = {
    'efectivo': '01',
    'transferencia': '03',
    'tarjeta': '04',
}


class SolicitudFactura(models.Model):
    ESTADOS = [
        ('pendiente', 'Pendiente de facturar'),
        ('facturada', 'Facturada'),
        ('cancelada', 'Cancelada'),
    ]
    TIPOS = [('venta', 'Venta'), ('renta', 'Renta')]

    tipo = models.CharField(max_length=6, choices=TIPOS)
    venta = models.ForeignKey('ventas.Venta', null=True, blank=True, on_delete=models.CASCADE, related_name='solicitudes_factura')
    renta = models.ForeignKey('renta.Renta', null=True, blank=True, on_delete=models.CASCADE, related_name='solicitudes_factura')
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='solicitudes_factura')

    # ── Receptor (snapshot fiscal al momento de la solicitud) ──
    rfc = models.CharField(max_length=20, blank=True, default='')
    razon_social = models.CharField(max_length=200, blank=True, default='')
    codigo_postal = models.CharField(max_length=10, blank=True, default='')
    regimen_fiscal = models.CharField(max_length=10, blank=True, default='')
    uso_cfdi = models.CharField(max_length=10, blank=True, default='')
    email = models.EmailField(blank=True, default='')

    # ── Importes (snapshot; total es IVA incluido) ──
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    forma_pago = models.CharField(max_length=4, blank=True, default='', help_text='Clave SAT (01 efectivo, 03 transferencia, 04 tarjeta)')
    concepto = models.CharField(max_length=255, blank=True, default='')

    # ── Control ──
    estado = models.CharField(max_length=10, choices=ESTADOS, default='pendiente')
    uuid = models.CharField(max_length=40, blank=True, default='', help_text='Folio fiscal del CFDI timbrado')
    fecha_timbrado = models.DateTimeField(null=True, blank=True)
    notas = models.TextField(blank=True, default='')

    creada = models.DateTimeField(auto_now_add=True)
    actualizada = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'solicitudes_factura'
        verbose_name = 'Solicitud de factura'
        verbose_name_plural = 'Solicitudes de factura'
        ordering = ['-creada']

    # ── Datos derivados para la UI ──
    @property
    def folio_origen(self):
        if self.venta_id:
            # Folio de la venta (VEN-AAAA-NNNN) si lo tiene; los históricos sin
            # folio caen al identificador corto de siempre.
            folio = getattr(self.venta, 'folio', None) if self.venta else None
            return folio or f'V-{self.venta_id}'
        if self.renta_id:
            return f'R-{self.renta_id}'
        return '—'

    @property
    def cliente_display(self):
        return self.razon_social or self.rfc or 'Sin datos'

    @property
    def datos_completos(self):
        """True si trae el mínimo para timbrar (RFC, razón social, CP, régimen, uso)."""
        return all([self.rfc, self.razon_social, self.codigo_postal, self.regimen_fiscal, self.uso_cfdi])

    def __str__(self):
        return f'{self.folio_origen} · {self.cliente_display} · {self.estado}'

    # ── Alta desde una venta o renta ──
    @classmethod
    def registrar(cls, *, venta=None, renta=None, cliente=None, receptor=None, forma_pago='', concepto=''):
        """Crea (o devuelve la existente) la solicitud a partir de una venta o renta.
        Prioriza el snapshot fiscal del cliente del padrón; si no hay, usa `receptor`."""
        obj = venta or renta
        if obj is None:
            return None
        # Evita duplicados si se llama dos veces.
        existente = cls.objects.filter(venta=venta, renta=renta).first() if (venta or renta) else None
        if existente:
            return existente

        receptor = receptor or {}
        if cliente is not None:
            rfc, razon = cliente.rfc, (cliente.razon_social or cliente.nombre)
            cp, regimen, uso, email = (cliente.cp_fiscal or cliente.codigo_postal), cliente.regimen_fiscal, cliente.uso_cfdi, (cliente.email_fiscal or cliente.email)
        else:
            rfc = (receptor.get('rfc') or '').strip().upper()
            razon = (receptor.get('razon_social') or '').strip()
            cp = (receptor.get('codigo_postal') or '').strip()
            regimen = (receptor.get('regimen_fiscal') or '').strip()
            uso = (receptor.get('uso_cfdi') or '').strip()
            email = (receptor.get('email') or '').strip()

        # La venta/renta ya trae el desglose (con IVA sumado porque lleva factura).
        total = Decimal(str(getattr(obj, 'total', 0) or 0))
        iva = Decimal(str(getattr(obj, 'iva', 0) or 0))
        subtotal = (total - iva).quantize(Decimal('0.01'))
        if iva == 0:
            # Respaldo: si por algún motivo no venía IVA, lo desglosa del total.
            subtotal = (total / (Decimal('1.00') + IVA_RATE)).quantize(Decimal('0.01'))
            iva = (total - subtotal).quantize(Decimal('0.01'))

        return cls.objects.create(
            tipo='venta' if venta else 'renta',
            venta=venta, renta=renta, cliente=cliente,
            rfc=rfc, razon_social=razon, codigo_postal=cp, regimen_fiscal=regimen, uso_cfdi=uso, email=email,
            subtotal=subtotal, iva=iva, total=total,
            forma_pago=FORMA_PAGO_SAT.get((forma_pago or '').lower(), ''),
            concepto=concepto,
        )


class Factura(models.Model):
    """Un CFDI timbrado que ya entró al sistema.

    Vive aparte de la solicitud a propósito: una solicitud es "el cliente quiere
    factura" y un CFDI es un documento fiscal con su propio ciclo. Cuando el SAT
    cancela una factura y se refactura, la solicitud termina con DOS CFDI y los
    dos se conservan; con los datos escritos encima de la solicitud, el cancelado
    se perdería.

    El XML se guarda como TEXTO y no como archivo por tres razones: el storage
    por defecto del proyecto es Cloudinary, que sirve por URL pública, y aquí van
    los datos fiscales del cliente; `respaldar_bd` usa dumpdata, así que un
    archivo quedaría fuera de todos los respaldos y un CFDI se conserva cinco
    años; y un CFDI pesa entre 4 y 15 KB.

    El XML es la verdad. Las columnas de abajo se extrajeron de él para poder
    listar y validar sin parsear, y si alguna vez discrepan, se regeneran desde
    el XML. Nunca al revés, y el XML no se edita jamás: cambiarlo invalida el
    sello.
    """
    ESTADOS = [('vigente', 'Vigente'), ('cancelada', 'Cancelada ante el SAT')]
    ENVIO = [('pendiente', 'Sin enviar'), ('enviada', 'Enviada'), ('fallo', 'Falló el envío')]

    solicitud = models.ForeignKey(SolicitudFactura, on_delete=models.CASCADE, related_name='facturas')
    xml = models.TextField(help_text='El CFDI íntegro, tal como llegó. No se edita.')

    uuid = models.CharField(max_length=40, unique=True, help_text='Folio fiscal')
    serie = models.CharField(max_length=25, blank=True, default='')
    folio = models.CharField(max_length=40, blank=True, default='')

    rfc_emisor = models.CharField(max_length=20, blank=True, default='')
    nombre_emisor = models.CharField(max_length=200, blank=True, default='')
    regimen_emisor = models.CharField(max_length=10, blank=True, default='')

    rfc_receptor = models.CharField(max_length=20, blank=True, default='')
    nombre_receptor = models.CharField(max_length=200, blank=True, default='')
    cp_receptor = models.CharField(max_length=10, blank=True, default='')
    regimen_receptor = models.CharField(max_length=10, blank=True, default='')
    uso_cfdi = models.CharField(max_length=10, blank=True, default='')

    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    moneda = models.CharField(max_length=5, blank=True, default='MXN')

    tipo_comprobante = models.CharField(max_length=5, blank=True, default='')
    forma_pago = models.CharField(max_length=5, blank=True, default='')
    metodo_pago = models.CharField(max_length=5, blank=True, default='')
    lugar_expedicion = models.CharField(max_length=10, blank=True, default='')

    fecha_emision = models.CharField(max_length=30, blank=True, default='')
    fecha_certificacion = models.CharField(max_length=30, blank=True, default='')

    sello_cfd = models.TextField(blank=True, default='')
    sello_sat = models.TextField(blank=True, default='')
    no_certificado_emisor = models.CharField(max_length=30, blank=True, default='')
    no_certificado_sat = models.CharField(max_length=30, blank=True, default='')
    rfc_prov_certif = models.CharField(max_length=20, blank=True, default='')
    cadena_original = models.TextField(blank=True, default='')

    estado = models.CharField(max_length=10, choices=ESTADOS, default='vigente')
    cancelada_en = models.DateTimeField(null=True, blank=True)
    cancelada_motivo = models.CharField(max_length=255, blank=True, default='')
    sustituye_a = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='sustituida_por')

    envio_estado = models.CharField(max_length=10, choices=ENVIO, default='pendiente')
    enviada_en = models.DateTimeField(null=True, blank=True)
    envio_error = models.CharField(max_length=255, blank=True, default='')

    subida_por = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='facturas_subidas')
    subida_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'facturas_cfdi'
        verbose_name = 'Factura (CFDI)'
        verbose_name_plural = 'Facturas (CFDI)'
        ordering = ['-subida_en']

    def __str__(self):
        return f'{self.serie}{self.folio} · {self.uuid[:8]} · {self.estado}'
