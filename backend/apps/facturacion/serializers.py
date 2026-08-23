from rest_framework import serializers

from .models import Factura, SolicitudFactura


class FacturaSerializer(serializers.ModelSerializer):
    """Sin el XML: pesa y no se usa para pintar. Se baja por su propia ruta."""
    subida_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Factura
        fields = [
            'id', 'uuid', 'serie', 'folio', 'estado',
            'rfc_receptor', 'nombre_receptor',
            'subtotal', 'iva', 'total', 'moneda',
            'fecha_emision', 'fecha_certificacion',
            'envio_estado', 'enviada_en', 'envio_error',
            'cancelada_en', 'cancelada_motivo', 'sustituye_a',
            'subida_en', 'subida_por_nombre',
        ]

    def get_subida_por_nombre(self, obj):
        u = obj.subida_por
        return (u.get_full_name() or u.username) if u else ''


class SolicitudFacturaSerializer(serializers.ModelSerializer):
    folio_origen = serializers.CharField(read_only=True)
    cliente_display = serializers.CharField(read_only=True)
    datos_completos = serializers.BooleanField(read_only=True)
    fecha_origen = serializers.SerializerMethodField()
    facturas = FacturaSerializer(many=True, read_only=True)

    class Meta:
        model = SolicitudFactura
        fields = [
            'id', 'tipo', 'venta', 'renta', 'cliente', 'folio_origen',
            'rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi', 'email',
            'subtotal', 'iva', 'total', 'forma_pago', 'concepto',
            'estado', 'uuid', 'fecha_timbrado', 'notas',
            'cliente_display', 'datos_completos', 'fecha_origen', 'facturas',
            'creada', 'actualizada',
        ]
        # El alta se hace desde las ventas/rentas; aquí solo se completan/marcan.
        read_only_fields = [
            'tipo', 'venta', 'renta', 'cliente', 'subtotal', 'iva', 'total',
            'concepto', 'creada', 'actualizada',
        ]

    def get_fecha_origen(self, obj):
        fuente = obj.venta or obj.renta
        f = getattr(fuente, 'fecha', None) or getattr(fuente, 'creado_en', None) or obj.creada
        return f.isoformat() if f else None
