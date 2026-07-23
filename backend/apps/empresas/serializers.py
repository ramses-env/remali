from rest_framework import serializers
from .models import Empresa, Obra


# Campos de domicilio estructurado (compartidos por Empresa y Obra).
_DOMICILIO_FIELDS = [
    'calle', 'numero_exterior', 'numero_interior', 'colonia', 'municipio',
    'ciudad', 'entidad', 'codigo_postal', 'pais', 'referencias', 'latitud', 'longitud',
]

# Partes del domicilio requeridas al crear (mínimo para una dirección fiscal válida).
_DOMICILIO_REQUERIDO = {
    'calle': 'Calle', 'colonia': 'Colonia', 'municipio': 'Municipio',
    'entidad': 'Estado', 'codigo_postal': 'Código postal',
}


def _faltantes(attrs, requeridos):
    return {campo: [f'{etiqueta} es obligatorio.']
            for campo, etiqueta in requeridos.items()
            if not (str(attrs.get(campo) or '')).strip()}


class ObraSerializer(serializers.ModelSerializer):
    empresa_nombre = serializers.CharField(source='empresa.nombre', read_only=True)

    class Meta:
        model = Obra
        fields = [
            'id', 'empresa', 'empresa_nombre', 'nombre', 'responsable', 'telefono',
            'ubicacion', *_DOMICILIO_FIELDS, 'estado', 'notas', 'creada',
        ]
        read_only_fields = ['empresa', 'ubicacion']

    def validate(self, attrs):
        # Al crear una obra: responsable, teléfono y el domicilio son obligatorios
        # (nombre lo exige el modelo). En edición (PATCH) no se fuerza.
        if self.instance is None:
            requeridos = {'responsable': 'Responsable', 'telefono': 'Teléfono del responsable'}
            errores = _faltantes(attrs, requeridos)
            errores.update(_faltantes(attrs, _DOMICILIO_REQUERIDO))
            if errores:
                raise serializers.ValidationError(errores)
        return attrs


class EmpresaSerializer(serializers.ModelSerializer):
    obras = ObraSerializer(many=True, read_only=True)
    obras_count = serializers.SerializerMethodField()
    obras_activas = serializers.SerializerMethodField()

    class Meta:
        model = Empresa
        fields = [
            'id', 'nombre', 'rfc', 'contacto', 'telefono', 'email',
            'regimen_fiscal', 'uso_cfdi',
            'direccion', *_DOMICILIO_FIELDS,
            'notas', 'activa', 'creada',
            'obras', 'obras_count', 'obras_activas',
        ]
        read_only_fields = ['direccion']

    # Ojo: .count()/.filter() ignoran la caché de prefetch_related y lanzan una
    # query por empresa (N+1). Las obras ya vienen prefetched y serializadas,
    # así que contamos en memoria: 0 queries extra.
    def get_obras_count(self, obj):
        return len(obj.obras.all())

    def get_obras_activas(self, obj):
        return sum(1 for o in obj.obras.all() if o.estado == 'activa')

    def validate(self, attrs):
        # Al crear un cliente/empresa (facturable): datos de contacto, fiscales
        # y domicilio fiscal completo. En edición (PATCH) no se fuerza.
        if self.instance is None:
            requeridos = {
                'rfc': 'RFC', 'regimen_fiscal': 'Régimen fiscal', 'uso_cfdi': 'Uso de CFDI',
                'contacto': 'Contacto', 'telefono': 'Teléfono',
            }
            errores = _faltantes(attrs, requeridos)
            errores.update(_faltantes(attrs, _DOMICILIO_REQUERIDO))
            if errores:
                raise serializers.ValidationError(errores)
        return attrs
