"""API del padrón de clientes.

El padrón lo cura REMALI: aquí se da de alta a mano, se busca y se corrige. No
es un subproducto de vender —eso vendrá en la entrega B—, es la base de clientes
del negocio.

Los permisos se piden por CAPACIDAD (`ver_clientes` / `editar_clientes`), nunca
por nombre de puesto: es lo que permitirá que la pantalla de permisos
configurables funcione sin tocar estas vistas.
"""
from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import ExigeCapacidad, NIVEL_ADMIN, nivel_de

from .models import Cliente, Contacto
from .resolucion import resumen_de
from .serializers import (
    CAMPOS_FISCALES, ClienteFichaSerializer, ClienteListaSerializer, ContactoSerializer,
)

# Tope duro de la página. La lista de clientes es la tabla que más rápido va a
# crecer del sistema: sin techo, un `?limite=100000` tumba el panel.
LIMITE_MAX = 100
LIMITE_DEFAULT = 25


class PuedeVerClientes(ExigeCapacidad):
    capacidad = 'ver_clientes'


class PuedeEditarClientes(ExigeCapacidad):
    capacidad = 'editar_clientes'


def _es_admin(request) -> bool:
    return nivel_de(getattr(request, 'user', None)) >= NIVEL_ADMIN


def _digitos(valor) -> str:
    return ''.join(c for c in (valor or '') if c.isdigit())[:10]


# ═══════════════════════════════════════════════════════════════════
#  LISTA Y ALTA
# ═══════════════════════════════════════════════════════════════════
@api_view(['GET', 'POST'])
@permission_classes([PuedeVerClientes])
def clientes(request):
    if request.method == 'POST':
        if not PuedeEditarClientes().has_permission(request, None):
            return Response({'detalle': 'No puedes dar de alta clientes.'}, status=403)
        return _crear(request)
    return _listar(request)


def _listar(request):
    q = (request.query_params.get('q') or '').strip()
    tipo = (request.query_params.get('tipo') or '').strip()
    solo_revision = request.query_params.get('revision') in ('1', 'true')

    qs = Cliente.objects.all()
    if q:
        # El teléfono se busca por dígitos: quien escribe "477 123" quiere
        # encontrar 4771234567, y quien pega un número con guiones también.
        digitos = _digitos(q)
        filtro = Q(nombre__icontains=q) | Q(razon_social__icontains=q) | Q(rfc__icontains=q)
        filtro |= Q(contactos__nombre__icontains=q)
        if digitos:
            filtro |= Q(telefono__startswith=digitos) | Q(contactos__telefono__startswith=digitos)
        qs = qs.filter(filtro).distinct()
    if tipo in (Cliente.FISICA, Cliente.MORAL):
        qs = qs.filter(tipo=tipo)
    if solo_revision:
        qs = qs.filter(requiere_revision=True)

    # Contadores ANOTADOS: calcularlos en el serializer sería una consulta por
    # renglón, que es exactamente cómo una lista de clientes se vuelve inusable.
    qs = qs.annotate(
        contactos_total=Count('contactos', distinct=True),
        documentos_total=(
            Count('ventas', distinct=True) + Count('rentas', distinct=True)
            + Count('cotizaciones', distinct=True) + Count('reparaciones', distinct=True)
        ),
    )

    total = qs.count()
    try:
        limite = min(int(request.query_params.get('limite') or LIMITE_DEFAULT), LIMITE_MAX)
        desde = max(int(request.query_params.get('desde') or 0), 0)
    except ValueError:
        limite, desde = LIMITE_DEFAULT, 0

    return Response({
        'total': total,
        'desde': desde,
        'limite': limite,
        'en_revision': Cliente.objects.filter(requiere_revision=True).count(),
        'clientes': ClienteListaSerializer(qs[desde:desde + limite], many=True).data,
    })


def _crear(request):
    datos = dict(request.data or {})
    if not _es_admin(request):
        # Nivel 1 da de alta al cliente para poder atenderlo; los fiscales los
        # captura administración, porque salen impresos en un CFDI.
        for campo in CAMPOS_FISCALES:
            datos.pop(campo, None)

    nombre = (datos.get('nombre') or '').strip()
    if not nombre:
        return Response({'detalle': 'El cliente necesita un nombre.'}, status=400)

    cli = Cliente(tipo=datos.get('tipo') or Cliente.FISICA)
    _asignar(cli, datos)

    # No se une por teléfono sin confirmación (§5.1 del diseño): se crea el
    # cliente y, si el número ya existía, se marca para que una persona revise.
    if cli.telefono:
        ya = Cliente.buscar_por_telefono(cli.telefono).first()
        if ya:
            cli.requiere_revision = True
            cli.revision_motivo = f'El teléfono {cli.telefono} ya es de "{ya.nombre}".'
    cli.save()

    # Toda ficha nace con su contacto principal: para una persona física es ella
    # misma, y así el resto del sistema nunca pregunta de qué tipo es.
    contacto = (datos.get('contacto') or {}) if isinstance(datos.get('contacto'), dict) else {}
    Contacto.objects.create(
        cliente=cli,
        nombre=(contacto.get('nombre') or cli.nombre),
        telefono=contacto.get('telefono') or cli.telefono,
        email=contacto.get('email') or cli.email,
        puesto=contacto.get('puesto') or '',
        principal=True,
    )
    return Response(ClienteFichaSerializer(_con_relaciones(cli.pk)).data, status=201)


# ═══════════════════════════════════════════════════════════════════
#  FICHA
# ═══════════════════════════════════════════════════════════════════
@api_view(['GET', 'PATCH'])
@permission_classes([PuedeVerClientes])
def cliente_detalle(request, pk: int):
    cli = _con_relaciones(pk)
    if cli is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)

    if request.method == 'PATCH':
        if not PuedeEditarClientes().has_permission(request, None):
            return Response({'detalle': 'No puedes editar clientes.'}, status=403)
        datos = dict(request.data or {})
        if not _es_admin(request) and CAMPOS_FISCALES & set(datos):
            return Response(
                {'detalle': 'Los datos fiscales los edita administración: salen impresos en la factura.'},
                status=403)
        _asignar(cli, datos)
        # Resolver la revisión es una decisión explícita, no un efecto de guardar.
        if datos.get('requiere_revision') is False:
            cli.requiere_revision = False
            cli.revision_motivo = ''
        cli.save()
        cli = _con_relaciones(pk)

    return Response(ClienteFichaSerializer(cli).data)


# ═══════════════════════════════════════════════════════════════════
#  CONTACTOS
# ═══════════════════════════════════════════════════════════════════
@api_view(['POST'])
@permission_classes([PuedeEditarClientes])
def contactos(request, pk: int):
    cli = Cliente.objects.filter(pk=pk).first()
    if cli is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)
    nombre = (request.data.get('nombre') or '').strip()
    if not nombre:
        return Response({'detalle': 'El contacto necesita un nombre.'}, status=400)
    c = Contacto.objects.create(
        cliente=cli,
        nombre=nombre,
        telefono=request.data.get('telefono') or '',
        email=request.data.get('email') or '',
        puesto=request.data.get('puesto') or '',
        principal=bool(request.data.get('principal')),
    )
    return Response(ContactoSerializer(c).data, status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([PuedeEditarClientes])
def contacto_detalle(request, pk: int):
    c = Contacto.objects.filter(pk=pk).first()
    if c is None:
        return Response({'detalle': 'Contacto no encontrado.'}, status=404)

    if request.method == 'DELETE':
        if c.usuario_id:
            # Borrar el contacto dejaría a esa cuenta sin dueño y sin forma de
            # llegar a su historial. Primero se desliga, y eso es otra acción.
            return Response(
                {'detalle': 'Este contacto tiene una cuenta ligada. Desvincúlala antes de borrarlo.'},
                status=400)
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    for campo in ('nombre', 'telefono', 'email', 'puesto'):
        if campo in request.data:
            setattr(c, campo, request.data[campo] or '')
    if 'principal' in request.data:
        c.principal = bool(request.data['principal'])
    c.save()
    return Response(ContactoSerializer(c).data)


# ═══════════════════════════════════════════════════════════════════
@api_view(['GET'])
@permission_classes([PuedeVerClientes])
def buscar(request):
    """El buscador del MOSTRADOR: pocos resultados, con lo justo para decidir.

    Distinto de la lista del padrón, que es para administrar. Aquí lo que
    importa es contestar "¿es este?" en un vistazo, mientras el cliente espera.
    Busca contra el teléfono del cliente Y el de sus contactos: en una
    constructora, el vendedor teclea el número que trae a la mano, que tanto
    puede ser el conmutador como el celular del residente.
    """
    telefono = _digitos(request.query_params.get('telefono') or '')
    q = (request.query_params.get('q') or '').strip()

    if telefono:
        qs = Cliente.buscar_por_telefono(telefono)
    elif len(q) >= 2:
        digitos = _digitos(q)
        filtro = Q(nombre__icontains=q) | Q(razon_social__icontains=q) | Q(contactos__nombre__icontains=q)
        if digitos:
            filtro |= Q(telefono__startswith=digitos) | Q(contactos__telefono__startswith=digitos)
        qs = Cliente.objects.filter(filtro).distinct()
    else:
        # Con menos de dos letras cualquier cosa coincide: mejor no responder
        # que llenarle la pantalla de candidatos al vendedor.
        return Response({'clientes': []})

    qs = qs.filter(activo=True).prefetch_related('contactos', 'obras')[:8]
    return Response({'clientes': [
        {
            'id': c.id,
            'nombre': c.nombre,
            'tipo': c.tipo,
            'tipo_display': c.get_tipo_display(),
            'telefono': c.telefono,
            'rfc': c.rfc,
            'requiere_revision': c.requiere_revision,
            'contactos': ContactoSerializer(c.contactos.all(), many=True).data,
            'obras': [{'id': o.id, 'nombre': o.nombre, 'ubicacion': o.ubicacion} for o in c.obras.all()],
            'resumen': resumen_de(c),
        }
        for c in qs
    ]})


@api_view(['GET'])
@permission_classes([PuedeVerClientes])
def catalogo(request):
    """Lo que el formulario necesita para pintarse: tipos y si quien pregunta
    puede tocar los fiscales. Evita que el front duplique estas reglas."""
    from maquinaria.permissions import catalogo_capacidades
    return Response({
        'tipos': [{'valor': v, 'etiqueta': e} for v, e in Cliente.TIPOS],
        'puede_editar_fiscales': _es_admin(request),
        'capacidades': catalogo_capacidades(),
    })


# ─────────────────────────────────────────────
def _con_relaciones(pk: int):
    return (Cliente.objects
            .prefetch_related('contactos', 'contactos__usuario', 'obras')
            .filter(pk=pk).first())


CAMPOS_EDITABLES = (
    'nombre', 'telefono', 'email', 'notas', 'activo',
    'razon_social', 'rfc', 'regimen_fiscal', 'uso_cfdi', 'cp_fiscal', 'email_fiscal',
    'calle', 'numero_exterior', 'numero_interior', 'colonia', 'municipio',
    'ciudad', 'entidad', 'codigo_postal', 'pais', 'referencias',
)


def _asignar(cli: Cliente, datos: dict):
    """Copia solo los campos permitidos. Lista blanca, no `setattr` a ciegas:
    así un `requiere_revision: true` en el cuerpo no se cuela como si nada."""
    if 'tipo' in datos and datos['tipo'] in (Cliente.FISICA, Cliente.MORAL):
        cli.tipo = datos['tipo']
    for campo in CAMPOS_EDITABLES:
        if campo in datos:
            valor = datos[campo]
            setattr(cli, campo, valor if campo == 'activo' else (valor or ''))
