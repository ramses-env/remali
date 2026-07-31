from rest_framework import serializers
from .models import Inventario, OrdenReparacion, OrdenReparacionItem


class InventarioSerializer(serializers.ModelSerializer):
    equipo_modelo = serializers.CharField(source='equipo.modelo', read_only=True)
    equipo_info = serializers.SerializerMethodField()
    renta_activa = serializers.SerializerMethodField()
    puede_rentarse = serializers.SerializerMethodField()
    puede_venderse = serializers.SerializerMethodField()

    class Meta:
        model = Inventario
        fields = [
            'id', 'equipo', 'equipo_modelo', 'equipo_info', 'codigo', 'numero_serie',
            'condicion', 'estado', 'ubicacion_actual',
            'renta_activa', 'puede_rentarse', 'puede_venderse',
            'fecha_creacion',
        ]
        read_only_fields = ['codigo', 'estado', 'equipo']

    def get_equipo_info(self, obj):
        e = obj.equipo
        if not e:
            return None
        imagen = None
        try:
            if e.imagen:
                request = self.context.get('request')
                imagen = request.build_absolute_uri(e.imagen.url) if request else e.imagen.url
        except Exception:
            imagen = None
        return {
            'id': e.id,
            'modelo': e.modelo,
            'imagen': imagen,
            'precio_dia': str(e.precio_dia) if e.precio_dia is not None else None,
            'precio_semana': str(e.precio_semana) if e.precio_semana is not None else None,
            'precio_mes': str(e.precio_mes) if e.precio_mes is not None else None,
            'precio_venta': str(e.precio_venta) if e.precio_venta is not None else None,
            'condicion': e.condicion,
            'modo': e.modo,   # 'venta' (nueva) o 'renta' (seminueva)
        }

    def get_renta_activa(self, obj):
        # Iterar la caché de prefetch_related('rentas') en memoria: .filter()
        # lanzaría 1 query por unidad (N+1) en la lista global de inventario.
        activas = [r for r in obj.rentas.all() if r.estado == 'activa']
        r = max(activas, key=lambda x: x.creado_en) if activas else None
        if not r:
            return None
        return {
            'id': r.id,
            'cliente': r.cliente,
            'cliente_nombre': r.cliente_nombre,
            'telefono_cliente': r.telefono_cliente,
            'direccion': r.direccion,
            'modalidad': r.modalidad,
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'dias_restantes': r.dias_restantes,
            'vencida': r.vencida,
            'total': str(r.total),
        }

    def get_puede_rentarse(self, obj):
        return obj.puede_rentarse()

    def get_puede_venderse(self, obj):
        return obj.puede_venderse()


class OrdenReparacionItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.SerializerMethodField()
    refaccion_nombre = serializers.CharField(source='refaccion.nombre', read_only=True)

    class Meta:
        model = OrdenReparacionItem
        fields = ['id', 'origen', 'refaccion', 'refaccion_nombre', 'nombre', 'cantidad', 'costo_unitario', 'subtotal']

    def get_subtotal(self, obj):
        return str(obj.subtotal)


class OrdenReparacionSerializer(serializers.ModelSerializer):
    items = OrdenReparacionItemSerializer(many=True, read_only=True)
    total_refacciones = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    cliente_display = serializers.CharField(read_only=True)
    equipo_display = serializers.CharField(read_only=True)
    unidad_codigo = serializers.CharField(source='unidad.codigo', read_only=True)
    empresa_nombre = serializers.CharField(source='empresa.nombre', read_only=True)

    class Meta:
        model = OrdenReparacion
        fields = [
            'id', 'folio', 'tipo', 'estado',
            'cliente_nombre', 'cliente_telefono', 'empresa', 'empresa_nombre',
            'unidad', 'unidad_codigo', 'equipo_descripcion', 'numero_serie',
            'diagnostico', 'trabajo_realizado', 'costo_mano_obra', 'notas',
            'items', 'total_refacciones', 'total', 'cliente_display', 'equipo_display',
            'fecha_recibida', 'fecha_entrega', 'actualizado_en',
        ]
        read_only_fields = ['folio', 'fecha_recibida', 'actualizado_en']

    def get_total_refacciones(self, obj):
        return str(obj.total_refacciones)

    def get_total(self, obj):
        return str(obj.total)
