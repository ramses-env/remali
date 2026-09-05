"""
Endpoint de autocompletado de direcciones.

    GET /api/address/search/?q=Av%20Costera

Devuelve una lista uniforme de direcciones (ver `services.AddressResult`),
independiente del proveedor. Incluye caché para no repetir llamadas al
proveedor externo con la misma búsqueda.
"""
import hashlib
import logging

import requests
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .services import get_provider
from server.rastro import tragado

log = logging.getLogger(__name__)

# Longitud mínima de la búsqueda (evita consultas ruidosas / costosas).
MIN_QUERY_LEN = 3
# TTL de caché: las direcciones cambian poquísimo → 24 h.
CACHE_TTL = 60 * 60 * 24


# El autocompletado pide SESIÓN. Nació público —lo estrenaban invitados armando
# su cotización— y eso era un grifo de costo abierto: cada consulta nueva es una
# llamada de PAGO a Google Places, y cualquiera con la URL podía dejarla
# corriendo. Ahora el armador solo se lo ofrece a quien tiene cuenta; el
# invitado escribe su dirección a mano, como siempre.
#
# El techo sigue puesto igual, porque una cuenta también puede desbocarse (una
# pestaña con un bucle, alguien probando). Dos capas: una ráfaga por minuto que
# cubre el tecleo con debounce, y un techo por hora que acota el gasto.
#
# `UserRateThrottle` y ya no `AnonRateThrottle`: aquel solo pesaba a los
# anónimos, así que al cerrar el endpoint habría dejado de contar a TODO el
# mundo y el tope habría desaparecido justo al ponerle llave a la puerta.
# La caché de 24 h además hace gratis cualquier consulta repetida.
class _DireccionMinThrottle(UserRateThrottle):
    scope = 'direcciones_min'


class _DireccionHoraThrottle(UserRateThrottle):
    scope = 'direcciones_hora'


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([_DireccionMinThrottle, _DireccionHoraThrottle])
def address_search(request):
    q = (request.query_params.get('q') or '').strip()
    if len(q) < MIN_QUERY_LEN:
        return Response([])

    # Clave de caché normalizada (case-insensitive) y namespaced por proveedor
    # (así cambiar de Photon a Nominatim no sirve resultados viejos).
    provider = get_provider()
    cache_key = f'geo:addr:{provider.slug}:' + hashlib.sha1(q.lower().encode('utf-8')).hexdigest()
    # La caché es un optimizador, no una dependencia dura: si el backend de caché
    # está caído (p.ej. REDIS_URL apunta a un host inalcanzable), NO debe tumbar la
    # búsqueda. Un fallo de caché se trata como "miss" y se sigue con el proveedor.
    try:
        cached = cache.get(cache_key)
    except Exception as e:
        log.warning('address_search: caché no disponible al leer (%s): %s', type(e).__name__, e)
        cached = None
    if cached is not None:
        return Response(cached)

    try:
        resultados = provider.search(q)
    except (requests.RequestException, RuntimeError, ValueError) as e:
        # Falla de red, proveedor caído o mal configurado (p.ej. falta la API key,
        # API sin habilitar o sin facturación): no romper el formulario. Se loguea
        # el detalle para poder depurar la config sin exponerlo al cliente.
        log.warning('address_search (%s) falló para %r: %s', provider.slug, q, e)
        return Response(
            {'detalle': 'No se pudo consultar el servicio de direcciones. Intenta de nuevo.'},
            status=502,
        )

    try:
        cache.set(cache_key, resultados, CACHE_TTL)
    except Exception:
        tragado()  # guardar en caché es best-effort; su fallo no afecta la respuesta
    return Response(resultados)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([_DireccionMinThrottle, _DireccionHoraThrottle])
def address_autocomplete(request):
    """Predicciones EN VIVO (as-you-type). Se llaman por cada tecla: son baratas y
    devuelven varias sugerencias. NO traen coordenadas — eso lo da `address_details`
    al seleccionar una. Ver `services.GooglePlacesProvider.autocomplete`."""
    q = (request.query_params.get('q') or '').strip()
    if len(q) < MIN_QUERY_LEN:
        return Response([])
    session = (request.query_params.get('session') or '').strip()

    provider = get_provider()
    cache_key = f'geo:ac:{provider.slug}:' + hashlib.sha1(q.lower().encode('utf-8')).hexdigest()
    try:
        cached = cache.get(cache_key)
    except Exception:
        cached = None
    if cached is not None:
        return Response(cached)

    try:
        preds = provider.autocomplete(q, session_token=session)
    except (requests.RequestException, RuntimeError, ValueError, NotImplementedError) as e:
        log.warning('address_autocomplete (%s) falló para %r: %s', provider.slug, q, e)
        return Response(
            {'detalle': 'No se pudo consultar el servicio de direcciones. Intenta de nuevo.'},
            status=502,
        )

    try:
        cache.set(cache_key, preds, 60 * 30)  # 30 min: las predicciones cambian poco
    except Exception:
        tragado()
    return Response(preds)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([_DireccionMinThrottle, _DireccionHoraThrottle])
def address_details(request):
    """Resuelve un place_id (de `address_autocomplete`) a la dirección completa
    —componentes + coordenadas—. Una sola llamada, solo cuando el usuario elige."""
    place_id = (request.query_params.get('place_id') or '').strip()
    if not place_id:
        return Response({'detalle': 'Falta place_id.'}, status=400)
    session = (request.query_params.get('session') or '').strip()

    provider = get_provider()
    cache_key = f'geo:det:{provider.slug}:' + hashlib.sha1(place_id.encode('utf-8')).hexdigest()
    try:
        cached = cache.get(cache_key)
    except Exception:
        cached = None
    if cached is not None:
        return Response(cached)

    try:
        resultado = provider.details(place_id, session_token=session)
    except (requests.RequestException, RuntimeError, ValueError, NotImplementedError) as e:
        log.warning('address_details (%s) falló para %r: %s', provider.slug, place_id, e)
        return Response(
            {'detalle': 'No se pudo consultar el servicio de direcciones. Intenta de nuevo.'},
            status=502,
        )

    try:
        cache.set(cache_key, resultado, CACHE_TTL)  # 24 h: los detalles casi no cambian
    except Exception:
        tragado()
    return Response(resultado)
