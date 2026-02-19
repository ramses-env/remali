from rest_framework import serializers
from .models import Equipo, Cupon, Orden, ItemOrden, Categoria, Tipo, Marca
from django.db import transaction
from django.core.exceptions import ValidationError

class EquipoSerializer(serializers.ModelSerializer):
    imagen = serializers.SerializerMethodField()
    imagenes = serializers.SerializerMethodField()
    precio_por_unidad = serializers.SerializerMethodField()
    unidad_efectiva = serializers.SerializerMethodField()

    class Meta:
        model = Equipo
        fields = '__all__'
        depth = 1

    def get_imagen(self, obj):
        try:
            f = obj.imagen
            if not f:
                return None
            url = f.url
        except Exception:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    def get_imagenes(self, obj):
        urls = []
        for pi in getattr(obj, 'imagenes', []).all():
            try:
                url = pi.imagen.url
            except Exception:
                url = None
            if url:
                request = self.context.get('request')
                urls.append(request.build_absolute_uri(url) if request else url)
        return urls
    
    def get_precio_por_unidad(self, obj):
        request = self.context.get('request')
        unidad = None
        try:
            unidad = request.query_params.get('unit')
        except Exception:
            unidad = None
        if not unidad:
            return None
        price = obj.get_precio_por_unidad(unidad)
        try:
            return float(price) if price is not None else None
        except Exception:
            return None
    
    def get_unidad_efectiva(self, obj):
        request = self.context.get('request')
        unidad = None
        try:
            unidad = (request.query_params.get('unit') or '').strip().lower()
        except Exception:
            unidad = None
        if unidad in ('dia', 'semana', 'mes'):
            if getattr(obj, f'precio_{unidad}', None) is not None:
                return unidad
        for k in ('dia', 'semana', 'mes'):
            if getattr(obj, f'precio_{k}', None) is not None:
                return k
        return None

class CuponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cupon
        fields = '__all__'

class ItemOrdenSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemOrden
        fields = ['equipo', 'precio']

class OrdenSerializer(serializers.ModelSerializer):
    items = ItemOrdenSerializer(many=True)

    class Meta:
        model = Orden
        fields = ['id', 'fecha_creacion', 'cupon', 'items']

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        with transaction.atomic():
            equipos_ids = []
            for it in items_data:
                e = it['equipo']
                equipos_ids.append(e.id)
            # Cargar equipos y validar
            equipos = Equipo.objects.select_for_update().filter(id__in=equipos_ids)
            equipos_map = {e.id: e for e in equipos}
            for eid in equipos_ids:
                e = equipos_map.get(eid)
                if not e:
                    raise ValidationError({'items': f'Equipo {eid} no existe'})
                if e.estado != 'disponible':
                    raise ValidationError({'items': f'Equipo "{e.modelo}" no está disponible para venta (estado: {e.estado})'})
            # Crear orden e items
            orden = Orden.objects.create(**validated_data)
            for it in items_data:
                ItemOrden.objects.create(orden=orden, **it)
            # Actualizar estado a vendido
            for eid in equipos_ids:
                e = equipos_map[eid]
                e.estado = 'vendido'
                e.save(update_fields=['estado'])
            return orden

class EmailResendSerializer(serializers.Serializer):
    email = serializers.EmailField()

class CategoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categoria
        fields = ['id', 'nombre']

class TipoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tipo
        fields = ['id', 'nombre']

class MarcaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marca
        fields = ['id', 'nombre']
