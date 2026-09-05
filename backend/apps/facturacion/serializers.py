from rest_framework import serializers

from .models import SolicitudFactura


class SolicitudFacturaSerializer(serializers.ModelSerializer):
    folio_origen = serializers.CharField(read_only=True)
    cliente_display = serializers.CharField(read_only=True)
    datos_completos = serializers.BooleanField(read_only=True)
    fecha_origen = serializers.SerializerMethodField()

    class Meta:
        model = SolicitudFactura
        fields = [
            'id', 'tipo', 'venta', 'renta', 'cliente', 'folio_origen',
            'rfc', 'razon_social', 'codigo_postal', 'regimen_fiscal', 'uso_cfdi', 'email',
            'subtotal', 'iva', 'total', 'forma_pago', 'concepto',
            'estado', 'uuid', 'fecha_timbrado', 'notas',
            'cliente_display', 'datos_completos', 'fecha_origen',
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
