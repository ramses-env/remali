from rest_framework import serializers
from .models import Refaccion


class RefaccionSerializer(serializers.ModelSerializer):
    bajo_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Refaccion
        fields = [
            'id', 'nombre', 'descripcion', 'precio_venta', 'stock', 'stock_minimo',
            'para_venta', 'ubicacion', 'codigo_barras', 'bajo_stock', 'fecha_creacion',
        ]
        extra_kwargs = {
            # Si viene vacío, el modelo genera el código automáticamente.
            'codigo_barras': {'required': False, 'allow_blank': True},
        }
