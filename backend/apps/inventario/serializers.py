from rest_framework import serializers
from .models import Inventario, OrdenReparacion, OrdenReparacionItem


class InventarioSerializer(serializers.ModelSerializer):
    equipo_modelo = serializers.CharField(source='equipo.modelo', read_only=True)
    equipo_info = serializers.SerializerMethodField()
    renta_activa = serializers.SerializerMethodField()
    puede_rentarse = serializers.SerializerMethodField()
    puede_venderse = serializers.SerializerMethodField()
    autorizacion_renta = serializers.SerializerMethodField()

    class Meta:
        model = Inventario
        fields = [
            'id', 'equipo', 'equipo_modelo', 'equipo_info', 'codigo', 'numero_serie',
            'condicion', 'estado', 'ubicacion_actual',
            'renta_activa', 'puede_rentarse', 'puede_venderse',
            # Permiso para rentar una unidad NUEVA (sustitución, demanda extra).
            # `puede_rentarse` no sirve para filtrar por sí solo: es falso en
            # cuanto la unidad deja de estar disponible, así que una seminueva
            # ya rentada saldría como "no rentable". Con esto el panel puede
            # preguntar por la CONDICIÓN, que no cambia con el estado.
            'autorizada_para_renta',
            # El RASTRO de esa autorización. Se guardaba desde siempre —quién,
            # cuándo y por qué— y no salía en ninguna respuesta: para leerlo
            # había que entrar a la base. Un rastro que nadie puede consultar
            # no protege de nada, y sacar una máquina NUEVA a renta es
            # justamente de las decisiones que alguien va a querer explicar
            # meses después.
            'autorizacion_renta',
            'fecha_creacion',
        ]
        read_only_fields = ['codigo', 'estado', 'equipo']

    def get_autorizacion_renta(self, obj):
        """Quién autorizó rentar esta unidad nueva, cuándo y con qué motivo.

        `None` cuando no está autorizada o cuando la autorización es anterior a
        que se empezara a guardar el rastro: decir "autorizada por nadie" sería
        inventar un dato que no existe.
        """
        if not obj.autorizada_para_renta or not obj.autorizada_renta_en:
            return None
        quien = obj.autorizada_renta_por
        return {
            'en': obj.autorizada_renta_en,
            'por': (quien.get_full_name() or quien.get_username()) if quien else None,
            'nota': obj.autorizada_renta_nota or '',
        }

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
            'condiciones': e.condiciones_catalogo,
            'modos': e.modos_catalogo,
            'ofrece_venta': e.ofrece_venta_catalogo,
            'ofrece_renta': e.ofrece_renta_catalogo,
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
            'cliente': r.cliente_texto,
            'cliente_nombre': r.cliente_nombre,
            'telefono_cliente': r.telefono_cliente,
            'direccion': r.direccion,
            'modalidad': r.modalidad,
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'dias_restantes': r.dias_restantes,
            'vence_en': r.vence_en,
            'horas_restantes': round(r.horas_restantes, 1),
            'por_vencer': r.por_vencer,
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
    cliente_padron_nombre = serializers.CharField(source='cliente.nombre', read_only=True)
    cuenta = serializers.SerializerMethodField()

    class Meta:
        model = OrdenReparacion
        fields = [
            'id', 'folio', 'tipo', 'estado',
            'cliente_nombre', 'cliente_telefono', 'cliente', 'cliente_padron_nombre',
            'unidad', 'unidad_codigo', 'equipo_descripcion', 'numero_serie',
            'diagnostico', 'trabajo_realizado', 'costo_mano_obra', 'notas',
            'items', 'total_refacciones', 'total', 'cliente_display', 'equipo_display',
            'cuenta', 'token_publico', 'fecha_recibida', 'fecha_entrega', 'actualizado_en',
        ]
        read_only_fields = ['folio', 'fecha_recibida', 'actualizado_en']

    def get_cuenta(self, obj):
        u = obj.usuario if obj.usuario_id else None
        return (u.get_full_name() or u.username) if u else None

    def get_total_refacciones(self, obj):
        return str(obj.total_refacciones)

    def get_total(self, obj):
        return str(obj.total)
