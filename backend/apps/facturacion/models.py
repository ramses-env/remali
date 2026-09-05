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
