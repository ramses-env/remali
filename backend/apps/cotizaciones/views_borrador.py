"""El taller privado del cliente y la liga de quien autoriza.

Dos superficies con reglas distintas:

* El **cliente** sobre sus borradores. Puede tener cuenta o no; si no la tiene,
  su espacio se identifica con un token que viaja en el encabezado `X-Espacio`.
  Nunca en la URL: un secreto en la barra de direcciones se filtra por
  historial, logs y el `Referer` de cualquier recurso externo.
* El **autorizador** (el jefe del cliente), sin cuenta, con la liga del paquete.

Lo que NO hay aquí: ni un endpoint, ni un filtro, ni una bandera para que REMALI
vea borradores. La privacidad no es una regla que se aplica — es que estos datos
viven en otra tabla y el panel nunca la consulta.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from maquinaria.permissions import NoEsDelNegocio
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from maquinaria.throttling import AutorizacionThrottle, BorradorThrottle, SolicitudPublicaThrottle

from . import precios
from .conversion import cotizacion_desde_borrador
from .models_borrador import (
    MAX_BORRADORES,
    MAX_POR_PAQUETE,
    BorradorCliente,
    BorradorItem,
    PaqueteAutorizacion,
    nuevo_token,
)
from server.rastro import tragado


def _error(mensaje, codigo, status=400):
    """Todas las respuestas de error del módulo tienen la misma forma.

    `detalle` es para la persona; `codigo` es para la interfaz, que necesita
    distinguir casos sin leer el texto (y sin romperse si el texto cambia).
    """
    return Response({'detalle': mensaje, 'codigo': codigo}, status=status)


# ──────────────────────────── Dueño ────────────────────────────

def _dueno(request, *, crear=False):
    """(usuario, espacio_token): exactamente uno no nulo, o (None, None).

    Con `crear=True` se le inventa un espacio al invitado que aún no tiene: es
    lo que pasa cuando guarda su primer borrador.
    """
    if request.user.is_authenticated:
        return request.user, None
    token = (request.META.get('HTTP_X_ESPACIO') or '').strip()
    if len(token) == 32 and token.isalnum():
        return None, token
    return (None, nuevo_token()) if crear else (None, None)


def _mios(modelo, request):
    """Lo que es de quien pregunta. Sin dueño, no es nada de nadie."""
    usuario, espacio = _dueno(request)
    if usuario:
        return modelo.objects.filter(usuario=usuario)
    if espacio:
        return modelo.objects.filter(espacio_token=espacio)
    return modelo.objects.none()


def _mi_borrador(request, pk):
    """El borrador, o None. Quien no es el dueño recibe un 404 —no un 403—:
    un 403 le confirmaría que ese borrador existe."""
    return _mios(BorradorCliente, request).filter(pk=pk).first()


# ──────────────────────── Serialización ────────────────────────

def _ser_borrador(b, *, con_items=True):
    d = {
        'id': b.id,
        'nombre': b.nombre,
        'estado': b.estado,
        'estado_label': b.get_estado_display(),
        'congelado': b.congelado,
        'requiere_factura': b.requiere_factura,
        'datos_contacto': b.datos_contacto or {},
        'obra': b.obra or {},
        'tipo': b.tipo,
        'total': str(b.total),
        'decision': b.decision,
        'rechazo_motivo': b.rechazo_motivo,
        'cambios_pedidos': b.cambios_pedidos,
        'paquete': b.paquete_id,
        'cotizacion': b.cotizacion_id,
        'folio': b.cotizacion.folio if b.cotizacion_id and b.cotizacion else None,
        'creado': b.creado,
        'actualizado': b.actualizado,
    }
    if con_items:
        d['items'] = [
            {**l, 'precio_unitario': str(l['precio_unitario']),
             'precio_lista': str(l['precio_lista']), 'subtotal': str(l['subtotal'])}
            for l in b.lineas()
        ]
    return d


def _ser_paquete(p, *, con_borradores=True):
    d = {
        'id': p.id,
        'token': p.token,
        'liga': f'/autorizar/{p.token}',
        'modo': p.modo,
        'mensaje': p.mensaje,
        'estado': p.estado,
        'vencido': p.vencido,
        'vence_el': p.vence_el,
        'autorizada_por': p.autorizada_por,
        'resuelto_en': p.resuelto_en,
        'total': str(p.total),
        'congelado_en': p.congelado_en,
    }
    if con_borradores:
        d['borradores'] = [_ser_borrador(b) for b in p.borradores.all()]
    return d


# ──────────────────── Borradores del cliente ────────────────────

def _reemplazar_items(borrador, items):
    """Deja el borrador con exactamente estas partidas.

    El borrador es un carrito guardado, no un documento con historia: se manda
    completo y se reemplaza completo. Así no hacen falta endpoints por partida
    ni el cliente puede dejarlo a medias entre dos llamadas.
    """
    from maquinaria.models import Equipo

    borrador.items.all().delete()
    creados = 0
    for it in (items or [])[:50]:
        equipo_id, cantidad, duracion, unidad = precios.normalizar_item(it)
        if not Equipo.objects.filter(pk=equipo_id).exists():
            continue
        BorradorItem.objects.create(borrador=borrador, equipo_id=equipo_id, cantidad=cantidad,
                                    duracion=duracion, modalidad=unidad)
        creados += 1
    return creados


@api_view(['GET', 'POST'])
@permission_classes([NoEsDelNegocio])          # el invitado también arma borradores
@throttle_classes([BorradorThrottle])
def borradores(request):
    """GET: lo que el cliente tiene en su taller. POST: guarda uno nuevo."""
    if request.method == 'GET':
        usuario, espacio = _dueno(request)
        if not usuario and not espacio:
            return Response({'borradores': [], 'paquetes': [], 'espacio_token': ''})
        qs = _mios(BorradorCliente, request).prefetch_related('items__equipo', 'cotizacion')
        paquetes = _mios(PaqueteAutorizacion, request).prefetch_related('borradores__items__equipo')
        return Response({
            'borradores': [_ser_borrador(b) for b in qs],
            'paquetes': [_ser_paquete(p, con_borradores=False) for p in paquetes],
            'espacio_token': espacio or '',
        })

    d = request.data or {}
    usuario, espacio = _dueno(request, crear=True)
    if _mios(BorradorCliente, request).count() >= MAX_BORRADORES:
        return _error(f'Ya tienes {MAX_BORRADORES} borradores guardados. Borra alguno para hacer espacio.',
                      'limite_borradores')

    with transaction.atomic():
        b = BorradorCliente.objects.create(
            usuario=usuario,
            espacio_token=espacio,
            nombre=(d.get('nombre') or '').strip()[:120],
            requiere_factura=bool(d.get('requiere_factura')),
            datos_contacto=d.get('datos_contacto') or d.get('cliente') or {},
            obra=d.get('obra') or {},
        )
        if not _reemplazar_items(b, d.get('items')):
            # Devolver un Response NO revierte la transacción (no hay excepción):
            # sin esto, el borrador vacío se quedaba guardado igual.
            transaction.set_rollback(True)
            return _error('No pudimos identificar los equipos de tu borrador.', 'equipo_no_disponible')

    return Response({'borrador': _ser_borrador(b), 'espacio_token': espacio or ''}, status=201)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([NoEsDelNegocio])
def borrador_detalle(request, pk: int):
    b = _mi_borrador(request, pk)
    if not b:
        return _error('No encontramos ese borrador.', 'no_encontrado', status=404)

    if request.method == 'GET':
        return Response({'borrador': _ser_borrador(b)})

    if request.method == 'DELETE':
        b.delete()
        return Response({'detalle': 'Borrador eliminado.'})

    if b.congelado:
        return _error('Está esperando autorización: retíralo antes de cambiarlo.',
                      'borrador_congelado', status=409)

    d = request.data or {}
    if 'nombre' in d:
        b.nombre = (d.get('nombre') or '').strip()[:120]
    if 'requiere_factura' in d:
        b.requiere_factura = bool(d['requiere_factura'])
    if 'datos_contacto' in d:
        b.datos_contacto = d['datos_contacto'] or {}
    if 'obra' in d:
        b.obra = d['obra'] or {}
    # Si estaba marcado con cambios pedidos y el cliente ya lo editó, el aviso
    # cumplió su función: se retira solo en vez de quedarse ahí para siempre.
    b.cambios_pedidos = ''
    b.decision = ''
    b.save()
    if 'items' in d:
        _reemplazar_items(b, d['items'])
    return Response({'borrador': _ser_borrador(BorradorCliente.objects.get(pk=b.pk))})


@api_view(['POST'])
@permission_classes([NoEsDelNegocio])
def borrador_duplicar(request, pk: int):
    """Una versión nueva a partir de una anterior.

    Es lo que reemplaza a "editar el rechazado": lo que el jefe ya juzgó se
    queda como estaba, y el cliente sigue trabajando sobre una copia. Así su
    historial de versiones no se reescribe encima.
    """
    b = _mi_borrador(request, pk)
    if not b:
        return _error('No encontramos ese borrador.', 'no_encontrado', status=404)
    if _mios(BorradorCliente, request).count() >= MAX_BORRADORES:
        return _error(f'Ya tienes {MAX_BORRADORES} borradores guardados. Borra alguno para hacer espacio.',
                      'limite_borradores')

    with transaction.atomic():
        copia = BorradorCliente.objects.create(
            usuario=b.usuario, espacio_token=b.espacio_token,
            nombre=f'{b.nombre} (copia)'.strip() if b.nombre else '',
            requiere_factura=b.requiere_factura,
            datos_contacto=b.datos_contacto, obra=b.obra, cupon=b.cupon,
        )
        for it in b.items.all():
            BorradorItem.objects.create(borrador=copia, equipo_id=it.equipo_id, cantidad=it.cantidad,
                                        duracion=it.duracion, modalidad=it.modalidad)
    return Response({'borrador': _ser_borrador(copia)}, status=201)


@api_view(['POST'])
@permission_classes([NoEsDelNegocio])
@throttle_classes([SolicitudPublicaThrottle])
def borrador_enviar(request, pk: int):
    """Directo a REMALI, sin pasar por el jefe. Aquí nace la cotización."""
    b = _mi_borrador(request, pk)
    if not b:
        return _error('No encontramos ese borrador.', 'no_encontrado', status=404)
    if b.estado != 'armando':
        return _error('Ese borrador ya no está en tus manos.', 'borrador_congelado', status=409)
    if not b.items.exists():
        return _error('Agrega al menos un equipo antes de mandarlo.', 'sin_partidas')
    if not (b.datos_contacto or {}).get('nombre'):
        return _error('Necesitamos tu nombre para mandarla.', 'faltan_datos')

    with transaction.atomic():
        b.congelar()
        b.refresh_from_db()
        b.estado = 'esperando'      # congela el precio antes de copiarlo
        b.save(update_fields=['estado', 'actualizado'])
        cot = cotizacion_desde_borrador(b)

    _avisar_a_remali([cot], firmante='')
    return Response({'detalle': 'Solicitud recibida', 'folio': cot.folio, 'cotizacion': cot.id}, status=201)


# ──────────────── Paquete de autorización (cliente) ────────────────

@api_view(['POST'])
@permission_classes([NoEsDelNegocio])
@throttle_classes([SolicitudPublicaThrottle])
def autorizaciones(request):
    """Manda uno o varios borradores a autorizar bajo UNA liga.

    Mandar uno y mandar tres es el mismo camino: el paquete de uno no es un caso
    especial. Al crearse, los precios se congelan — es el único momento en que
    alguien está tomando una decisión de dinero, así que es donde el número deja
    de moverse.
    """
    d = request.data or {}
    ids = d.get('borradores') or []
    if not isinstance(ids, list) or not ids:
        return _error('Selecciona al menos un borrador para mandar.', 'sin_borradores')
    if len(ids) > MAX_POR_PAQUETE:
        return _error(f'Máximo {MAX_POR_PAQUETE} borradores por liga.', 'limite_paquete')

    modo = d.get('modo') if d.get('modo') in ('opciones', 'lista') else 'lista'
    usuario, espacio = _dueno(request)
    if not usuario and not espacio:
        return _error('No encontramos tu espacio de borradores.', 'sin_espacio')

    with transaction.atomic():
        qs = _mios(BorradorCliente, request).select_for_update().filter(pk__in=ids)
        elegidos = list(qs)
        if len(elegidos) != len(set(ids)):
            return _error('Alguno de esos borradores ya no existe.', 'no_encontrado', status=404)
        for b in elegidos:
            if b.estado != 'armando':
                return _error(f'"{b}" ya no está en tus manos.', 'borrador_congelado', status=409)
            if not b.items.exists():
                return _error(f'"{b}" no tiene equipos.', 'sin_partidas')

        paquete = PaqueteAutorizacion.objects.create(
            usuario=usuario, espacio_token=espacio, modo=modo,
            mensaje=(d.get('mensaje') or '').strip()[:2000],
        )
        for b in elegidos:
            b.congelar()
            b.estado = 'esperando'
            b.paquete = paquete
            b.save(update_fields=['estado', 'paquete', 'actualizado'])

    return Response({
        'detalle': 'Liga lista. Compártela con quien autoriza.',
        'paquete': _ser_paquete(paquete),
        'token': paquete.token,
        'liga': f'/autorizar/{paquete.token}',
    }, status=201)


@api_view(['DELETE'])
@permission_classes([NoEsDelNegocio])
def autorizacion_retirar(request, pk: int):
    """El cliente se arrepiente antes de que el jefe conteste."""
    p = _mios(PaqueteAutorizacion, request).filter(pk=pk).first()
    if not p:
        return _error('No encontramos esa liga.', 'no_encontrado', status=404)
    if p.estado != 'pendiente':
        return _error('Ya la resolvieron: no se puede retirar.', 'ya_resuelto', status=409)

    with transaction.atomic():
        p.estado = 'retirado'
        p.save(update_fields=['estado'])
        # Vuelven a armarse: al dejar de estar congelados, sus precios vuelven a
        # seguir al catálogo. Es lo correcto — nadie autorizó ese número.
        p.borradores.update(estado='armando', paquete=None)
    return Response({'detalle': 'Liga retirada. Tus borradores volvieron a estar editables.'})


# ─────────────── La liga del autorizador (público) ───────────────

def _avisar_a_remali(cotizaciones, *, firmante):
    """UNA notificación por paquete, no una por cotización.

    Si el jefe autoriza dos de tres, al panel le llega un aviso con los dos
    folios, no dos avisos sueltos. Lo que REMALI necesita saber es "llegó esto",
    no el detalle de cómo lo decidió el cliente por dentro.
    """
    if not cotizaciones:
        return
    from maquinaria.models import CorreoAviso, crear_notificacion

    folios = ', '.join(c.folio for c in cotizaciones)
    total = sum((c.total for c in cotizaciones), 0)
    quien = cotizaciones[0].cliente_nombre or 'Cliente'
    tel = cotizaciones[0].cliente_telefono or '—'
    titulo = (f'{firmante} autorizó {len(cotizaciones)} cotización(es) · {folios}'
              if firmante else f'Nueva solicitud de cotización · {folios}')
    try:
        crear_notificacion(
            'sistema', titulo,
            f'{quien} ({tel}) · ${total}.'
            + (' Entra ACEPTADA: solo falta concretarla.' if firmante else ''),
            seccion='cotizaciones',
            ref=f'cotizacion-cliente-{cotizaciones[0].id}',
            data={'cotizacion_id': cotizaciones[0].id, 'folio': cotizaciones[0].folio, 'telefono': tel},
        )
    except Exception:
        tragado()
    try:
        from maquinaria.correo import enviar_async
        destinatarios = list(CorreoAviso.objects.filter(verificado=True).values_list('email', flat=True))
        if destinatarios:
            enviar_async(f'[REMALI] {titulo}',
                         f'{quien} ({tel}) · {folios} · Total ${total}.\n'
                         f'Ya aparece en el panel para atenderse.\n', destinatarios)
    except Exception:
        tragado()


def _avisar_al_cliente(paquete, autorizadas, rechazadas, cambios=()):
    """La campanita del cliente. Esto sí es asunto suyo, aunque REMALI no lo vea."""
    if not paquete.usuario_id:
        return
    from maquinaria.models import Notificacion
    if autorizadas:
        titulo = f'{paquete.autorizada_por} autorizó {len(autorizadas)} de tus cotizaciones'
        mensaje = 'Ya están con REMALI; te contactan pronto.'
    elif cambios:
        titulo = f'{paquete.autorizada_por} te pidió cambios'
        detalle = next((b.cambios_pedidos for b in cambios if b.cambios_pedidos), '')
        mensaje = (f'«{detalle}» · ' if detalle else '') + 'Tu borrador volvió a estar editable.'
    else:
        titulo = f'{paquete.autorizada_por} rechazó lo que le mandaste'
        mensaje = 'Puedes duplicar tu borrador, ajustarlo y volver a mandarlo.'
    try:
        Notificacion.objects.create(usuario=paquete.usuario, tipo='sistema', titulo=titulo,
                                    mensaje=mensaje, seccion='cotizaciones',
                                    ref=f'paquete-{paquete.id}')
    except Exception:
        tragado()


@api_view(['GET', 'POST'])
@permission_classes([NoEsDelNegocio])          # el jefe no tiene cuenta, y no se le va a pedir
@throttle_classes([AutorizacionThrottle])
def autorizacion(request, token):
    """La liga de quien autoriza: ve lo que le mandaron y lo resuelve."""
    p = (PaqueteAutorizacion.objects
         .prefetch_related('borradores__items__equipo')
         .filter(token=token).first())
    if not p or p.estado == 'retirado':
        return _error('Enlace no válido.', 'no_encontrado', status=404)

    if request.method == 'GET':
        return Response({'paquete': _ser_paquete(p), 'ya_resuelto': p.estado == 'resuelto'})

    # Volver a entrar a una liga ya resuelta NO es un error: es alguien
    # preguntando qué pasó. Se le contesta, no se le regaña con un 409 rojo.
    if p.estado == 'resuelto':
        return Response({
            'ya_resuelto': True,
            'detalle': f'Esto ya lo resolvió {p.autorizada_por} '
                       f'el {p.resuelto_en.strftime("%d/%m/%Y")}.',
            'paquete': _ser_paquete(p),
        })
    if p.vencido:
        return _error(f'Esta liga venció el {p.vence_el.strftime("%d/%m/%Y")}. '
                      'Pide una versión nueva a quien te la mandó.', 'paquete_vencido')

    nombre = (request.data.get('nombre') or '').strip()
    if not nombre:
        return _error('Escribe tu nombre para continuar.', 'falta_nombre')

    borradores_p = list(p.borradores.all())
    decisiones = {}
    for d in (request.data.get('decisiones') or []):
        try:
            decisiones[int(d.get('borrador'))] = d
        except (TypeError, ValueError):
            continue

    autorizados = [b for b in borradores_p
                   if (decisiones.get(b.id) or {}).get('accion') == 'autorizar']
    con_cambios = [b for b in borradores_p
                   if (decisiones.get(b.id) or {}).get('accion') == 'cambios']
    if p.modo == 'opciones' and len(autorizados) > 1:
        return _error('Son opciones de lo mismo: autoriza una sola.', 'opciones_una_sola')

    from maquinaria.models import nombre_propio
    firmante = nombre_propio(nombre)[:120]
    nuevas, rechazadas = [], []

    with transaction.atomic():
        for b in borradores_p:
            if b in autorizados:
                nuevas.append(cotizacion_desde_borrador(b, autorizada_por=firmante))
                continue
            d = decisiones.get(b.id) or {}
            if b in con_cambios:
                # No es un "no": es un "sí, pero". Vuelve a manos del cliente,
                # editable y con el precio siguiendo otra vez al catálogo.
                b.estado = 'armando'
                b.decision = 'cambios'
                b.paquete = None
                b.cambios_pedidos = (d.get('motivo') or '').strip() or 'Sin detalle'
                b.save(update_fields=['estado', 'decision', 'paquete', 'cambios_pedidos', 'actualizado'])
                continue
            # En modo 'opciones' las que no eligió mueren solas; si no, se quedaban
            # esperando para siempre a una respuesta que ya no va a llegar.
            motivo = (d.get('motivo') or '').strip()
            if not motivo:
                motivo = 'No seleccionada' if p.modo == 'opciones' else 'Sin motivo indicado'
            b.estado = 'rechazado'
            b.decision = 'rechazado'
            b.rechazo_motivo = motivo
            b.save(update_fields=['estado', 'decision', 'rechazo_motivo', 'actualizado'])
            rechazadas.append(b)

        p.estado = 'resuelto'
        p.autorizada_por = firmante
        p.resuelto_en = timezone.now()
        p.save(update_fields=['estado', 'autorizada_por', 'resuelto_en'])

    # A REMALI solo le llega lo autorizado. Lo que el jefe mató no existió nunca
    # para el negocio: sin notificación, sin correo, sin folio.
    _avisar_a_remali(nuevas, firmante=firmante)
    _avisar_al_cliente(p, nuevas, rechazadas, con_cambios)

    return Response({
        'detalle': ('Autorizada: REMALI la recibió.' if nuevas
                    else 'Cambios pedidos. Le avisamos a quien te la mandó.' if con_cambios
                    else 'Rechazada. Le avisamos a quien te la mandó.'),
        'ya_resuelto': False,
        'folios': [c.folio for c in nuevas],
        'autorizadas': len(nuevas),
        'rechazadas': len(rechazadas),
        'cambios': len(con_cambios),
    })


# ─────────────────────── Espacio del invitado ───────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reclamar_espacio(request):
    """Adopta a la cuenta los borradores que el cliente armó como invitado.

    Lo dispara la app al iniciar sesión si el navegador todavía trae un token.
    El token se borra de la fila —no solo se ignora—: el `CheckConstraint` exige
    un solo dueño, y un espacio con dueño ya no es un espacio.
    """
    token = (request.META.get('HTTP_X_ESPACIO') or '').strip()
    if len(token) != 32 or not token.isalnum():
        return Response({'reclamados': 0})

    with transaction.atomic():
        n = BorradorCliente.objects.filter(espacio_token=token).update(
            usuario=request.user, espacio_token=None)
        PaqueteAutorizacion.objects.filter(espacio_token=token).update(
            usuario=request.user, espacio_token=None)
    return Response({'reclamados': n})
