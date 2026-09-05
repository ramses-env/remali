"""API del padrón de clientes.

El padrón lo cura REMALI: aquí se da de alta a mano, se busca y se corrige. No
es un subproducto de vender —eso vendrá en la entrega B—, es la base de clientes
del negocio.

Los permisos se piden por CAPACIDAD (`ver_clientes` / `editar_clientes`), nunca
por nombre de puesto: es lo que permitirá que la pantalla de permisos
configurables funcione sin tocar estas vistas.
"""
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from maquinaria.permissions import (
    ExigeCapacidad, IsAdminGroupOrStaff as EsAdministracion, NIVEL_ADMIN, nivel_de,
)

from .models import Cliente, Contacto, DocumentoCliente
from .cuenta import estado_de_cuenta
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
    # ¿Entra a la tienda con su cuenta, o es de los que solo existen en el
    # padrón? Es una diferencia de mostrador: al primero se le manda la liga y
    # se entera solo; al segundo hay que llamarle.
    con_cuenta = (request.query_params.get('cuenta') or '').strip()
    if con_cuenta == '1':
        qs = qs.filter(contactos__usuario__isnull=False).distinct()
    elif con_cuenta == '0':
        qs = qs.exclude(contactos__usuario__isnull=False).distinct()

    # Contadores ANOTADOS: calcularlos en el serializer sería una consulta por
    # renglón, que es exactamente cómo una lista de clientes se vuelve inusable.
    qs = qs.annotate(
        contactos_total=Count('contactos', distinct=True),
        # Cuántos de sus contactos tienen cuenta. Anotado y no la propiedad
        # `Cliente.tiene_cuenta`, que hace una consulta POR RENGLÓN.
        cuentas_total=Count('contactos', filter=Q(contactos__usuario__isnull=False), distinct=True),
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
#  COMPROBANTES
# ═══════════════════════════════════════════════════════════════════
def _doc_json(d, *, con_archivo: bool):
    """Nivel 1 ve QUE existe y si está vigente; el archivo es de nivel 2.
    Adentro hay INEs, y no todo el que atiende necesita el INE de nadie."""
    datos = {
        'id': d.id, 'tipo': d.tipo, 'tipo_display': d.get_tipo_display(),
        'nota': d.nota, 'vence': d.vence, 'vigente': d.vigente,
        'subido_en': d.subido_en,
        'subido_por': (d.subido_por.get_username() if d.subido_por_id else ''),
    }
    if con_archivo:
        try:
            datos['archivo'] = d.archivo.url
        except Exception:
            datos['archivo'] = None
    return datos


@api_view(['GET', 'POST'])
@permission_classes([PuedeVerClientes])
def documentos(request, pk: int):
    cli = Cliente.objects.filter(pk=pk).first()
    if cli is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)

    if request.method == 'POST':
        if not _es_admin(request):
            return Response({'detalle': 'Los comprobantes los sube administración.'}, status=403)
        archivo = request.FILES.get('archivo')
        if not archivo:
            return Response({'detalle': 'Falta el archivo.'}, status=400)
        d = DocumentoCliente.objects.create(
            cliente=cli,
            tipo=request.data.get('tipo') or 'otro',
            archivo=archivo,
            nota=(request.data.get('nota') or '').strip(),
            vence=request.data.get('vence') or None,
            subido_por=request.user,
        )
        return Response(_doc_json(d, con_archivo=True), status=201)

    con_archivo = _es_admin(request)
    return Response({'documentos': [
        _doc_json(d, con_archivo=con_archivo) for d in cli.documentos.all()
    ]})


@api_view(['DELETE'])
@permission_classes([EsAdministracion])
def documento_borrar(request, pk: int):
    d = DocumentoCliente.objects.filter(pk=pk).first()
    if d is None:
        return Response({'detalle': 'Documento no encontrado.'}, status=404)
    d.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ═══════════════════════════════════════════════════════════════════
#  CUENTAS SIN VINCULAR
# ═══════════════════════════════════════════════════════════════════
@api_view(['GET'])
@permission_classes([PuedeVerClientes])
def sin_vincular(request):
    """La bandeja: quién se registró en la tienda y todavía no es de nadie.

    Cada renglón trae la PISTA de teléfono si la hay. Es una sugerencia, no una
    decisión: el sistema no une nunca por su cuenta.
    """
    filas = []
    for c in Contacto.sin_vincular().select_related('usuario'):
        pista = Cliente.buscar_por_telefono(c.telefono).first() if c.telefono else None
        filas.append({
            'id': c.id,
            'nombre': c.nombre,
            'telefono': c.telefono,
            'email': c.email or (c.usuario.email if c.usuario_id else ''),
            'creado': c.creado,
            'pista': ({'id': pista.id, 'nombre': pista.nombre,
                       'documentos': sum(resumen_de(pista)[k] for k in
                                         ('compras', 'rentas', 'cotizaciones', 'reparaciones'))}
                      if pista else None),
        })
    return Response({'total': len(filas), 'contactos': filas})


@api_view(['POST'])
@permission_classes([PuedeEditarClientes])
def vincular_contacto(request, pk: int):
    """Le pone su cliente a una cuenta registrada. Con rastro de quién y cuándo."""
    cli = Cliente.objects.filter(pk=pk).first()
    if cli is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)
    contacto = Contacto.objects.filter(pk=request.data.get('contacto_id')).first()
    if contacto is None:
        return Response({'detalle': 'Contacto no encontrado.'}, status=404)
    if contacto.cliente_id:
        return Response({'detalle': f'Ese contacto ya es de "{contacto.cliente.nombre}".'}, status=400)

    contacto.cliente = cli
    contacto.save()
    quien = getattr(request.user, 'username', '') or 's/d'
    cli.notas = (f'{cli.notas}\n' if cli.notas else '') + (
        f'[{timezone.now():%d/%m/%Y}] {quien} vinculó la cuenta de {contacto.nombre}.')
    cli.save(update_fields=['notas'])
    return Response(ClienteFichaSerializer(_con_relaciones(cli.pk)).data)


# ═══════════════════════════════════════════════════════════════════
#  FUSIONAR
# ═══════════════════════════════════════════════════════════════════
@api_view(['POST'])
@permission_classes([EsAdministracion])
def fusionar(request, pk: int):
    """Funde dos fichas: TODO lo del origen pasa a este cliente.

    Nivel 2 a propósito: mueve historial y saldos de una persona a otra, y eso
    no se deshace solo. Queda el rastro de quién, cuándo y desde dónde.

    El origen NO se borra: se desactiva. Borrarlo perdería la única prueba de
    que esa ficha existió, y con ella la forma de entender una fusión mal hecha.
    """
    destino = Cliente.objects.filter(pk=pk).first()
    origen = Cliente.objects.filter(pk=request.data.get('origen_id')).first()
    if destino is None or origen is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)
    if origen.pk == destino.pk:
        return Response({'detalle': 'El origen y el destino son el mismo cliente.'}, status=400)

    # Las CUENTAS del origen, antes de mover los contactos (después ya cuelgan
    # del destino y no se sabría cuáles eran suyas).
    cuentas_origen = list(origen.contactos.filter(usuario__isnull=False)
                          .values_list('usuario_id', flat=True))

    movidos = {
        'ventas': origen.ventas.update(cliente=destino),
        'rentas': origen.rentas.update(cliente=destino),
        'cotizaciones': origen.cotizaciones.update(cliente=destino),
        'reparaciones': origen.reparaciones.update(cliente=destino),
        'obras': origen.obras.update(cliente=destino),
        # Los contactos pierden el "principal": el destino ya tiene el suyo y
        # dos principales en la misma ficha es un estado inválido.
        'contactos': origen.contactos.update(cliente=destino, principal=False),
    }

    # ── El vínculo de CUENTA, que es lo que la fusión no movía ──
    #
    # Mover la ficha no basta. "Mis rentas" del cliente filtra por su `User`, no
    # por su ficha: si venía con dos cuentas —el caso que motiva casi toda
    # fusión—, tras fundir seguía entrando con una y sin ver lo que quedó colgado
    # de la otra. La ficha se veía completa en el panel de administración y el
    # cliente juraba que le faltaban rentas, que es de los reportes más difíciles
    # de entender desde este lado.
    #
    # Aquí sí se reasigna el `usuario` de los documentos, y es el ÚNICO lugar
    # donde se permite: el endpoint de vincular ya no deja cambiar de cuenta, y
    # esto es una operación de nivel 2 que deja rastro de quién y por qué.
    cuenta_destino = (destino.contactos.filter(usuario__isnull=False)
                      .order_by('-principal', 'id')
                      .values_list('usuario_id', flat=True).first())
    if cuenta_destino and cuentas_origen:
        # `exclude` para no contar como movido lo que ya apuntaba al destino.
        otras = [c for c in cuentas_origen if c != cuenta_destino]
        if otras:
            from renta.models import Renta
            from cotizaciones.models import Cotizacion
            from ventas.models import Venta
            from inventario.models import OrdenReparacion
            movidos['cuentas_rentas'] = Renta.objects.filter(usuario_id__in=otras).update(usuario_id=cuenta_destino)
            movidos['cuentas_cotizaciones'] = Cotizacion.objects.filter(usuario_id__in=otras).update(usuario_id=cuenta_destino)
            movidos['cuentas_compras'] = Venta.objects.filter(cliente_usuario_id__in=otras).update(cliente_usuario_id=cuenta_destino)
            movidos['cuentas_reparaciones'] = OrdenReparacion.objects.filter(usuario_id__in=otras).update(usuario_id=cuenta_destino)

    quien = getattr(request.user, 'username', '') or 's/d'
    motivo = (request.data.get('motivo') or '').strip()
    sello = f'[{timezone.now():%d/%m/%Y %H:%M}] {quien} fundió aquí la ficha "{origen.nombre}" (#{origen.pk}).'
    if motivo:
        sello += f' Motivo: {motivo}'
    destino.notas = (f'{destino.notas}\n' if destino.notas else '') + sello
    destino.save(update_fields=['notas'])

    origen.activo = False
    origen.requiere_revision = False
    origen.notas = (f'{origen.notas}\n' if origen.notas else '') + (
        f'[{timezone.now():%d/%m/%Y %H:%M}] {quien} fundió esta ficha en "{destino.nombre}" (#{destino.pk}).')
    origen.save(update_fields=['activo', 'requiere_revision', 'notas'])

    return Response({'movidos': movidos, 'cliente': ClienteFichaSerializer(_con_relaciones(destino.pk)).data})


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
def estado_cuenta(request, pk: int):
    """Lo que debe, lo que se le debe, y su historial completo.

    Permiso `ver_clientes` (nivel 1) a propósito: esto es
    `ver_montos_operacion` —cobrar lo que uno atiende—, no `ver_dinero`, que son
    las cuentas del negocio. El cajero necesita saber que el cliente debe ANTES
    de venderle otra cosa, no después.
    """
    cli = Cliente.objects.filter(pk=pk).first()
    if cli is None:
        return Response({'detalle': 'Cliente no encontrado.'}, status=404)
    return Response(estado_de_cuenta(cli, con_documentos=True))


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
