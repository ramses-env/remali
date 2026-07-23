"""
Endpoint de autocompletado de direcciones.

    GET /api/address/search/?q=Av%20Costera

Devuelve una lista uniforme de direcciones (ver `services.AddressResult`),
independiente del proveedor. Incluye caché para no repetir llamadas al
proveedor externo con la misma búsqueda.
"""
import hashlib

import requests
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .services import get_provider

# Longitud mínima de la búsqueda (evita consultas ruidosas / costosas).
MIN_QUERY_LEN = 3
# TTL de caché: las direcciones cambian poquísimo → 24 h.
CACHE_TTL = 60 * 60 * 24


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def address_search(request):
    q = (request.query_params.get('q') or '').strip()
    if len(q) < MIN_QUERY_LEN:
        return Response([])

    # Clave de caché normalizada (case-insensitive) y namespaced por proveedor
    # (así cambiar de Photon a Nominatim no sirve resultados viejos).
    provider = get_provider()
    cache_key = f'geo:addr:{provider.slug}:' + hashlib.sha1(q.lower().encode('utf-8')).hexdigest()
    cached = cache.get(cache_key)
    if cached is not None:
        return Response(cached)

    try:
        resultados = provider.search(q)
    except requests.RequestException:
        # Falla de red / proveedor caído: no romper el formulario.
        return Response(
            {'detalle': 'No se pudo consultar el servicio de direcciones. Intenta de nuevo.'},
            status=502,
        )

    cache.set(cache_key, resultados, CACHE_TTL)
    return Response(resultados)
