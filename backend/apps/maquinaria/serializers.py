from rest_framework import serializers
from .models import (
    Equipo, Cupon, Categoria, Tipo, Marca, PerfilUsuario, Notificacion,
    ConfiguracionSitio, CorreoAviso, ObraCliente,
)


class NotificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notificacion
        fields = ['id', 'tipo', 'titulo', 'mensaje', 'seccion', 'leida', 'data', 'creada']

class ObraClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ObraCliente
        fields = ['id', 'nombre', 'responsable', 'direccion', 'telefono', 'email', 'creada']
        read_only_fields = ['creada']


class PerfilUsuarioSerializer(serializers.ModelSerializer):
    # Campos del User asociados (editables)
    id = serializers.IntegerField(source='usuario.id', read_only=True)   # el panel lo usa para saber "cuál soy yo"
    username = serializers.CharField(source='usuario.username', read_only=True)
    email = serializers.EmailField(source='usuario.email', required=False)
    first_name = serializers.CharField(source='usuario.first_name', required=False, allow_blank=True)
    last_name = serializers.CharField(source='usuario.last_name', required=False, allow_blank=True)
    is_staff = serializers.BooleanField(source='usuario.is_staff', read_only=True)
    is_superuser = serializers.BooleanField(source='usuario.is_superuser', read_only=True)
    puede = serializers.SerializerMethodField()   # qué secciones mostrar
    groups = serializers.SerializerMethodField()
    avatar = serializers.ImageField(required=False, allow_null=True)
    avatar_url = serializers.SerializerMethodField()
    # Solo lectura: lo decide el modelo. Si el cliente pudiera enviarlo, se
    # marcaría "completo" sin haber llenado nada.
    datos_completos = serializers.BooleanField(read_only=True)
    # Quien entró con Google no tiene contraseña: la pantalla de seguridad usa
    # esto para pedir "la actual" solo a quien realmente tiene una.
    tiene_password = serializers.SerializerMethodField()
    # Verificación de correo + estado "perfil verificado" (correo + datos), y el
    # cupón de 5% que se desbloquea al completarlo. Todo read-only: lo decide el
    # servidor, el cliente no puede marcarse verificado ni darse un cupón.
    email_verificado = serializers.BooleanField(read_only=True)
    perfil_verificado = serializers.BooleanField(read_only=True)
    cupon = serializers.SerializerMethodField()

    class Meta:
        model = PerfilUsuario
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'is_staff', 'is_superuser', 'puede', 'groups',
            'telefono', 'puesto', 'bio', 'avatar', 'avatar_url',
            'empresa', 'obra_direccion', 'obra_responsable', 'datos_completos', 'tiene_password',
            'email_verificado', 'perfil_verificado', 'cupon',
        ]

    def get_tiene_password(self, obj):
        return obj.usuario.has_usable_password()

    def get_cupon(self, obj):
        """El cupón personal de 5% por completar el perfil (o None)."""
        c = obj.usuario.cupones.filter(motivo='perfil', activo=True).order_by('-id').first()
        return {'codigo': c.codigo, 'descuento': float(c.descuento)} if c else None

    def validate_telefono(self, value):
        """Se guarda como lo escriban, pero si viene, debe traer 10 dígitos."""
        v = (value or '').strip()
        if v and len(''.join(c for c in v if c.isdigit())) != 10:
            raise serializers.ValidationError('El teléfono debe tener 10 dígitos.')
        return v

    def get_groups(self, obj):
        return list(obj.usuario.groups.values_list('name', flat=True))

    def get_puede(self, obj):
        from .permissions import puede_de
        return puede_de(obj.usuario)

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        try:
            url = obj.avatar.url
        except Exception:
            return None
        request = self.context.get('request')
        if not request:
            return url
        host = request.get_host()
        if host in ('localhost', '127.0.0.1') and ':' not in host:
            return url
        return request.build_absolute_uri(url)

    def update(self, instance, validated_data):
        user_data = validated_data.pop('usuario', {})
        user = instance.usuario
        for attr in ('email', 'first_name', 'last_name'):
            if attr in user_data:
                setattr(user, attr, user_data[attr])
        user.save()
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance

class EquipoSerializer(serializers.ModelSerializer):
    # Con depth=1 las relaciones se leen anidadas pero DRF las vuelve de solo
    # lectura: lo que el formulario mandaba en 'categoria' se descartaba en
    # silencio. Estos alias escriben la relación sin perder la lectura anidada.
    categoria_id = serializers.PrimaryKeyRelatedField(
        source='categoria', queryset=Categoria.objects.all(), required=False, allow_null=True, write_only=True)
    tipo_id = serializers.PrimaryKeyRelatedField(
        source='tipo', queryset=Tipo.objects.all(), required=False, allow_null=True, write_only=True)
    marca_id = serializers.PrimaryKeyRelatedField(
        source='marca', queryset=Marca.objects.all(), required=False, allow_null=True, write_only=True)
    # Escribible (acepta el archivo al crear/editar) y en lectura devuelve la URL.
    imagen = serializers.ImageField(required=False, allow_null=True)
    imagenes = serializers.SerializerMethodField()
    precio_por_unidad = serializers.SerializerMethodField()
    unidad_efectiva = serializers.SerializerMethodField()
    # Disponibilidad derivada de las unidades de inventario
    disponible_venta = serializers.SerializerMethodField()
    disponible_renta = serializers.SerializerMethodField()
    condiciones = serializers.SerializerMethodField()
    stock_disponible = serializers.SerializerMethodField()
    unidades_total = serializers.SerializerMethodField()
    unidades_rentadas = serializers.SerializerMethodField()
    # 'venta' (nueva) o 'renta' (seminueva). Lo decide la condición del equipo.
    modo = serializers.CharField(read_only=True)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # El precio de venta de un equipo de RENTA es interno (referencia del
        # admin): no se expone al público ni a los clientes, solo a administración.
        if instance.modo == 'renta':
            from .permissions import puede_de
            u = getattr(self.context.get('request'), 'user', None)
            es_admin = bool(u and u.is_authenticated and puede_de(u).get('nivel', 0) > 0)
            if not es_admin:
                data.pop('precio_venta', None)
        return data

    def validate_especificaciones(self, value):
        """Normaliza la lista de specs. Vía multipart llega como string JSON;
        se parsea, se descartan filas vacías y se conserva solo etiqueta/valor."""
        import json
        if value in (None, ''):
            return []
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (ValueError, TypeError):
                raise serializers.ValidationError('Formato de especificaciones inválido.')
        if not isinstance(value, list):
            raise serializers.ValidationError('Las especificaciones deben ser una lista.')
        limpio = []
        for row in value:
            if not isinstance(row, dict):
                continue
            etiqueta = str(row.get('etiqueta') or '').strip()
            valor = str(row.get('valor') or '').strip()
            if etiqueta and valor:
                limpio.append({'etiqueta': etiqueta[:60], 'valor': valor[:120]})
        return limpio

    def validate(self, attrs):
        # Un PATCH de metadatos (p. ej. solo clasificación) no debe fallar por
        # specs que faltaban de antes: la regla aplica al crear o al tocarlas.
        if self.instance is not None and 'condicion' not in attrs and 'especificaciones' not in attrs:
            return attrs
        # Los equipos de VENTA (nueva) deben traer características: con ellas se
        # arma la ficha que ve el cliente. Renta no las exige.
        condicion = attrs.get('condicion') or getattr(self.instance, 'condicion', 'nueva')
        if condicion == 'nueva':
            especs = attrs.get('especificaciones')
            if especs is None:
                especs = getattr(self.instance, 'especificaciones', None) or []
            if not especs:
                raise serializers.ValidationError(
                    {'especificaciones': 'Los equipos de venta deben tener al menos una característica.'})
        return attrs

    class Meta:
        model = Equipo
        fields = '__all__'
        depth = 1

    # Estos getters iteran obj.unidades.all() en memoria (NO .filter/.count/.exists,
    # que ignoran la caché y lanzan 1 query cada uno). La vista DEBE hacer
    # prefetch_related('unidades') para que esto sea O(0) queries por producto.
    def get_disponible_venta(self, obj):
        return any(u.estado == 'disponible' for u in obj.unidades.all())

    def get_disponible_renta(self, obj):
        return any(u.condicion == 'seminueva' and u.estado == 'disponible' for u in obj.unidades.all())

    def get_condiciones(self, obj):
        return sorted({u.condicion for u in obj.unidades.all() if u.condicion})

    def get_stock_disponible(self, obj):
        return sum(1 for u in obj.unidades.all() if u.estado == 'disponible')

    def get_unidades_total(self, obj):
        return sum(1 for u in obj.unidades.all() if u.estado != 'vendido')

    def get_unidades_rentadas(self, obj):
        return sum(1 for u in obj.unidades.all() if u.estado == 'rentado')

    def get_imagenes(self, obj):
        urls = []
        for pi in getattr(obj, 'imagenes', []).all():
            try:
                url = pi.imagen.url
            except Exception:
                url = None
            if url:
                request = self.context.get('request')
                if not request:
                    urls.append(url)
                    continue
                host = request.get_host()
                if host in ('localhost', '127.0.0.1') and ':' not in host:
                    urls.append(url)
                    continue
                urls.append(request.build_absolute_uri(url))
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

class ConfiguracionSitioSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfiguracionSitio
        fields = [
            'whatsapp_principal', 'whatsapp_respaldos',
            'negocio_nombre', 'negocio_telefono', 'negocio_direccion', 'negocio_email', 'negocio_web',
            'negocio_rfc', 'negocio_representante', 'negocio_footer',
            'cotizacion_condiciones', 'cotizacion_condiciones_renta', 'datos_bancarios', 'cotizacion_cierre',
            'actualizada',
        ]
        read_only_fields = ['actualizada']

    def validate_whatsapp_respaldos(self, value):
        """Normaliza la lista de respaldos: solo {label, number} con número válido."""
        import json
        if isinstance(value, str):
            try:
                value = json.loads(value or '[]')
            except (ValueError, TypeError):
                raise serializers.ValidationError('Formato inválido.')
        if not isinstance(value, list):
            raise serializers.ValidationError('Debe ser una lista.')
        limpio = []
        for row in value:
            if not isinstance(row, dict):
                continue
            num = ''.join(ch for ch in str(row.get('number') or '') if ch.isdigit())
            if not num:
                continue
            limpio.append({'label': str(row.get('label') or 'Respaldo')[:60], 'number': num[:15]})
        return limpio

    def validate_whatsapp_principal(self, value):
        num = ''.join(ch for ch in str(value or '') if ch.isdigit())
        if num and len(num) < 10:
            raise serializers.ValidationError('El número debe tener al menos 10 dígitos.')
        return num


class CorreoAvisoSerializer(serializers.ModelSerializer):
    class Meta:
        model = CorreoAviso
        fields = ['id', 'email', 'etiqueta', 'verificado', 'creado', 'verificado_en']
        # El token nunca se expone; verificado solo cambia al confirmar el correo.
        read_only_fields = ['verificado', 'creado', 'verificado_en']


class CuponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cupon
        fields = '__all__'

class _CatalogoSerializer(serializers.ModelSerializer):
    """Base de catálogos: normaliza el nombre (trim) y valida unicidad
    sin distinguir mayúsculas ('Bosch' == 'bosch'), excluyendo el propio
    registro al renombrar."""

    def validate_nombre(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('El nombre no puede estar vacío.')
        qs = self.Meta.model.objects.filter(nombre__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Ya existe con ese nombre.')
        return value


class CategoriaSerializer(_CatalogoSerializer):
    class Meta:
        model = Categoria
        fields = ['id', 'nombre']

class TipoSerializer(_CatalogoSerializer):
    class Meta:
        model = Tipo
        fields = ['id', 'nombre']

class MarcaSerializer(_CatalogoSerializer):
    class Meta:
        model = Marca
        fields = ['id', 'nombre']
