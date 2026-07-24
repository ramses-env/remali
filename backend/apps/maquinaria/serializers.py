from rest_framework import serializers
from .models import (
    Equipo, Cupon, Categoria, Tipo, Marca, PerfilUsuario, Notificacion,
    ConversacionSoporte, MensajeSoporte, ConfiguracionSitio, CorreoAviso,
)


class NotificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notificacion
        fields = ['id', 'tipo', 'titulo', 'mensaje', 'seccion', 'leida', 'data', 'creada']

class MensajeSoporteSerializer(serializers.ModelSerializer):
    autor_admin_username = serializers.SerializerMethodField()

    class Meta:
        model = MensajeSoporte
        fields = ['id', 'autor_tipo', 'autor_admin_username', 'cuerpo', 'creada']

    def get_autor_admin_username(self, obj):
        try:
            return obj.autor_admin.username if obj.autor_admin else None
        except Exception:
            return None


class ConversacionSoporteListSerializer(serializers.ModelSerializer):
    no_leidos_admin = serializers.SerializerMethodField()
    ultimo_mensaje = serializers.SerializerMethodField()
    ultima_actividad = serializers.DateTimeField(source='actualizada', read_only=True)

    class Meta:
        model = ConversacionSoporte
        fields = [
            'id', 'nombre', 'email', 'telefono', 'asunto', 'estado',
            'asignado_a', 'ultima_actividad', 'ultimo_mensaje', 'no_leidos_admin',
        ]
        depth = 1

    # Iteran la caché de prefetch_related('mensajes'); .filter()/.count()/.first()
    # lanzarían 1 query por conversación (N+1) en la lista de soporte.
    def get_no_leidos_admin(self, obj):
        lr = obj.last_read_admin
        return sum(
            1 for m in obj.mensajes.all()
            if m.autor_tipo == 'usuario' and (lr is None or m.creada > lr)
        )

    def get_ultimo_mensaje(self, obj):
        mensajes = list(obj.mensajes.all())
        if not mensajes:
            return ''
        m = max(mensajes, key=lambda x: (x.creada, x.id))
        txt = (m.cuerpo or '').strip()
        return (txt[:140] + '…') if len(txt) > 140 else txt


class ConversacionSoporteDetailSerializer(serializers.ModelSerializer):
    no_leidos_admin = serializers.SerializerMethodField()
    mensajes = MensajeSoporteSerializer(many=True, read_only=True)

    class Meta:
        model = ConversacionSoporte
        fields = [
            'id', 'nombre', 'email', 'telefono', 'asunto', 'estado',
            'asignado_a', 'creada', 'actualizada', 'last_read_admin',
            'no_leidos_admin', 'mensajes',
        ]
        depth = 1

    def get_no_leidos_admin(self, obj):
        qs = obj.mensajes.filter(autor_tipo='usuario')
        if obj.last_read_admin:
            qs = qs.filter(creada__gt=obj.last_read_admin)
        return qs.count()


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

    class Meta:
        model = PerfilUsuario
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'is_staff', 'is_superuser', 'puede', 'groups',
            'telefono', 'puesto', 'bio', 'avatar', 'avatar_url',
            'empresa', 'obra_direccion', 'obra_responsable', 'datos_completos', 'tiene_password',
        ]

    def get_tiene_password(self, obj):
        return obj.usuario.has_usable_password()

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
            'negocio_nombre', 'negocio_telefono', 'negocio_direccion', 'negocio_rfc', 'negocio_footer',
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
