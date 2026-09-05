"""Serializers del padrón.

Dos vistas del mismo cliente: la de LISTA (ligera, se pintan cientos) y la de
FICHA (completa, se pinta una). Separarlas no es purismo: la lista es la pantalla
que más va a crecer del sistema, y mandar contactos y obras de cada renglón la
haría inservible con 500 clientes.
"""
from rest_framework import serializers

from .models import Cliente, Contacto


class ContactoSerializer(serializers.ModelSerializer):
    """Una persona del cliente, con el estado de su cuenta si la tiene.

    La cuenta viaja aquí —y no en una pantalla aparte— porque es un DATO de esta
    persona, no otra entidad: el mismo señor te renta con cuenta o sin ella, y
    partirlo en dos listas según eso volvería a romper el padrón. Lo que se ve es
    lo único que hace falta para decidir: si entra, si confirmó su correo y
    cuándo entró por última vez.
    """
    tiene_cuenta = serializers.SerializerMethodField()
    cuenta_correo = serializers.SerializerMethodField()
    cuenta_id = serializers.IntegerField(source='usuario_id', read_only=True)
    cuenta_activa = serializers.SerializerMethodField()
    cuenta_verificada = serializers.SerializerMethodField()
    cuenta_ultimo_acceso = serializers.SerializerMethodField()

    class Meta:
        model = Contacto
        fields = ['id', 'nombre', 'telefono', 'email', 'puesto', 'principal',
                  'tiene_cuenta', 'cuenta_correo', 'cuenta_id', 'cuenta_activa',
                  'cuenta_verificada', 'cuenta_ultimo_acceso']

    def get_tiene_cuenta(self, obj) -> bool:
        return obj.usuario_id is not None

    def get_cuenta_correo(self, obj):
        """El correo con el que entra, para distinguirlo del de contacto."""
        return obj.usuario.email if obj.usuario_id else None

    def get_cuenta_activa(self, obj):
        return obj.usuario.is_active if obj.usuario_id else None

    def get_cuenta_verificada(self, obj):
        """Sin correo confirmado no puede iniciar sesión, así que "tiene cuenta"
        no basta: hay que poder ver que la cuenta todavía no sirve."""
        perfil = getattr(obj.usuario, 'perfil', None) if obj.usuario_id else None
        return bool(getattr(perfil, 'email_verificado', False)) if perfil else None

    def get_cuenta_ultimo_acceso(self, obj):
        return obj.usuario.last_login if obj.usuario_id else None


class ObraResumenSerializer(serializers.Serializer):
    """Obra vista desde el cliente. No usa ModelSerializer para no acoplar el
    padrón al modelo de `empresas`, que se va a mover en la fase 3."""
    id = serializers.IntegerField()
    nombre = serializers.CharField()
    responsable = serializers.CharField()
    telefono = serializers.CharField()
    ubicacion = serializers.CharField()
    estado = serializers.CharField()


class ClienteListaSerializer(serializers.ModelSerializer):
    """Un renglón de la lista. Los contadores vienen anotados en el queryset;
    calcularlos aquí sería una consulta por renglón."""
    contactos_total = serializers.IntegerField(read_only=True)
    documentos_total = serializers.IntegerField(read_only=True)
    cuentas_total = serializers.IntegerField(read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    tiene_cuenta = serializers.SerializerMethodField()

    class Meta:
        model = Cliente
        fields = ['id', 'tipo', 'tipo_display', 'nombre', 'telefono', 'email',
                  'rfc', 'activo', 'requiere_revision', 'revision_motivo',
                  'contactos_total', 'documentos_total', 'cuentas_total', 'tiene_cuenta']

    def get_tiene_cuenta(self, obj) -> bool:
        """Sale de la ANOTACIÓN del queryset, no de `Cliente.tiene_cuenta`: esa
        propiedad consulta la base una vez por renglón."""
        return bool(getattr(obj, 'cuentas_total', 0))


class ClienteFichaSerializer(serializers.ModelSerializer):
    contactos = ContactoSerializer(many=True, read_only=True)
    obras = ObraResumenSerializer(many=True, read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    tiene_cuenta = serializers.BooleanField(read_only=True)
    documentos_vencidos = serializers.SerializerMethodField()

    class Meta:
        model = Cliente
        fields = [
            'id', 'tipo', 'tipo_display', 'nombre',
            'razon_social', 'rfc', 'regimen_fiscal', 'uso_cfdi', 'cp_fiscal', 'email_fiscal',
            'telefono', 'email',
            'direccion', 'calle', 'numero_exterior', 'numero_interior', 'colonia',
            'municipio', 'ciudad', 'entidad', 'codigo_postal', 'pais', 'referencias',
            'notas', 'activo', 'creado',
            'requiere_revision', 'revision_motivo',
            'contactos', 'obras', 'tiene_cuenta', 'documentos_vencidos',
        ]
        read_only_fields = ['creado', 'direccion']

    def get_documentos_vencidos(self, obj) -> int:
        """Cuántos comprobantes caducaron. Es lo que hay que ver ANTES de
        entregar una máquina cara, sin tener que abrir los archivos."""
        return sum(1 for d in obj.documentos.all() if not d.vigente)


# Campos que solo administración puede escribir. Tocan la factura: un RFC mal
# puesto sale impreso en un CFDI y corregirlo después cuesta dinero.
CAMPOS_FISCALES = frozenset({
    'razon_social', 'rfc', 'regimen_fiscal', 'uso_cfdi', 'cp_fiscal', 'email_fiscal',
})
