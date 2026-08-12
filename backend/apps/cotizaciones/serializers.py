from rest_framework import serializers

from .models import Cotizacion, CotizacionItem, CotizacionFoto


class CotizacionFotoSerializer(serializers.ModelSerializer):
    imagen = serializers.SerializerMethodField()

    class Meta:
        model = CotizacionFoto
        fields = ['id', 'imagen', 'orden']

    def get_imagen(self, obj):
        if not obj.imagen:
            return None
        url = obj.imagen.url
        # Absoluta si hay request (el detalle la usa): la carta y el visor cargan
        # la imagen desde el origen de Django, no del de la SPA en dev.
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class CotizacionItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.SerializerMethodField()
    modalidad_label = serializers.CharField(read_only=True)
    equipo_imagen = serializers.SerializerMethodField()

    class Meta:
        model = CotizacionItem
        fields = ['id', 'descripcion', 'cantidad', 'duracion', 'precio_unitario', 'precio_lista', 'equipo', 'equipo_imagen', 'subtotal', 'modalidad', 'modalidad_label']

    def get_subtotal(self, obj):
        return str(obj.subtotal)

    def get_equipo_imagen(self, obj):
        # Imagen del equipo cotizado: sirve de respaldo en la carta/PDF cuando la
        # cotización no trae fotos subidas a mano (típico si la armó el cliente).
        eq = obj.equipo
        if not eq or not getattr(eq, 'imagen', None):
            return None
        url = eq.imagen.url
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class CotizacionSerializer(serializers.ModelSerializer):
    items = CotizacionItemSerializer(many=True, read_only=True)
    fotos = CotizacionFotoSerializer(many=True, read_only=True)
    subtotal = serializers.SerializerMethodField()
    subtotal_venta = serializers.SerializerMethodField()
    subtotal_renta = serializers.SerializerMethodField()
    iva = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    descuento_cupon = serializers.SerializerMethodField()
    cupon = serializers.SerializerMethodField()
    base = serializers.SerializerMethodField()
    cliente_display = serializers.CharField(read_only=True)
    vigencia_hasta = serializers.DateField(read_only=True)
    vencida = serializers.BooleanField(read_only=True)
    empresa_nombre = serializers.CharField(source='empresa.nombre', read_only=True)
    convertida = serializers.SerializerMethodField()
    venta_id = serializers.SerializerMethodField()
    renta_id = serializers.SerializerMethodField()
    atendida_por_nombre = serializers.SerializerMethodField()
    usuario_nombre = serializers.SerializerMethodField()
    usuario_email = serializers.SerializerMethodField()

    class Meta:
        model = Cotizacion
        fields = [
            'id', 'folio', 'tipo', 'estado', 'origen', 'datos_solicitud',
            'cliente_nombre', 'cliente_telefono', 'cliente_email', 'empresa', 'empresa_nombre',
            'vigencia_dias', 'aplica_iva', 'notas',
            'items', 'fotos', 'subtotal', 'subtotal_venta', 'subtotal_renta', 'base', 'iva', 'total', 'descuento_cupon', 'cupon',
            'cliente_display', 'vigencia_hasta', 'vencida', 'token_publico',
            'convertida', 'venta_id', 'renta_id', 'atendida_en', 'atendida_por_nombre', 'usuario_nombre', 'usuario_email', 'entrega_prometida', 'escalada_en',
            'autorizada_por', 'autorizada_en', 'autorizacion_rechazo', 'cancelacion_solicitada', 'cancelacion_motivo',
            'usuario',
            'creada', 'actualizada',
        ]
        read_only_fields = ['folio', 'origen', 'datos_solicitud', 'atendida_en', 'escalada_en', 'creada', 'actualizada']

    # Iteran la caché de prefetch_related('conversiones'); .exists()/.first()
    # lanzarían 1 query por cotización (N+1) en la lista.
    def get_convertida(self, obj):
        # Convertida es convertida: en venta O en renta. Contar solo ventas
        # dejaba la cotización "viva" (editable y con acciones) tras concretar
        # la renta, como si nada hubiera pasado.
        return len(obj.conversiones.all()) > 0 or len(obj.rentas_convertidas.all()) > 0

    def get_venta_id(self, obj):
        convs = list(obj.conversiones.all())
        return convs[0].id if convs else None

    def get_renta_id(self, obj):
        rentas = list(obj.rentas_convertidas.all())
        return rentas[0].id if rentas else None

    def get_atendida_por_nombre(self, obj):
        return obj.atendida_por.get_username() if obj.atendida_por_id else None

    def get_usuario_nombre(self, obj):
        if not obj.usuario_id or not obj.usuario:
            return None
        return obj.usuario.get_full_name() or obj.usuario.get_username()

    def get_usuario_email(self, obj):
        return obj.usuario.email if (obj.usuario_id and obj.usuario) else None

    def get_subtotal(self, obj):
        return str(obj.subtotal)

    def get_subtotal_venta(self, obj):
        return str(obj.subtotal_venta)

    def get_subtotal_renta(self, obj):
        return str(obj.subtotal_renta)

    def get_iva(self, obj):
        return str(obj.iva)

    def get_total(self, obj):
        return str(obj.total)

    def get_descuento_cupon(self, obj):
        return str(obj.descuento_cupon)

    def get_cupon(self, obj):
        """El cupón vigente aplicado a esta cotización (o None si no aplica hoy).
        Lo lee el panel al concretar la venta/renta para mostrar y cobrar el
        descuento; sale None si ya se gastó, para no cobrarlo dos veces."""
        c = obj.cupon
        if not c or not c.activo or c.usado:
            return None
        return {'codigo': c.codigo, 'descuento': float(c.descuento)}

    def get_base(self, obj):
        return str(obj.base)
