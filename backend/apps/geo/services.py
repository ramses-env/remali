"""
Servicio de geocodificación / autocompletado de direcciones.

La lógica del proveedor externo (hoy OpenStreetMap · Nominatim) vive AQUÍ, detrás
de una interfaz uniforme `GeocodingProvider`. El frontend nunca habla con el
proveedor: solo consume nuestro endpoint. Para migrar a Google Places, Mapbox o
HERE en el futuro basta con:

    1. Crear otra subclase de `GeocodingProvider` (p.ej. `GooglePlacesProvider`).
    2. Apuntar `get_provider()` a la nueva (vía settings `GEOCODING_PROVIDER`).

El formato de salida (`AddressResult`) NO cambia, así que ni las vistas ni React
se tocan.
"""
from __future__ import annotations

import logging
import os
from typing import List, Dict

import requests
from django.conf import settings

log = logging.getLogger(__name__)


# Forma uniforme que devuelve CUALQUIER proveedor (contrato con el frontend).
AddressResult = Dict[str, str]

# Campos garantizados en cada resultado (para documentación / pruebas).
ADDRESS_FIELDS = (
    'display_name', 'street', 'house_number', 'neighborhood',
    'city', 'state', 'postcode', 'country', 'latitude', 'longitude',
)


def _empty_result() -> AddressResult:
    return {k: '' for k in ADDRESS_FIELDS}


# Bounding boxes por país (para sesgar resultados). minLon,minLat,maxLon,maxLat
_BBOX = {
    'mx': '-118.6,14.3,-86.5,32.8',  # México
}


class GeocodingProvider:
    """Interfaz común. Un proveedor concreto solo implementa `search`."""

    slug = 'base'

    def search(self, query: str, *, limit: int = 8, lang: str = 'es') -> List[AddressResult]:
        raise NotImplementedError


class NominatimProvider(GeocodingProvider):
    """Proveedor OpenStreetMap · Nominatim.

    Respeta la política de uso: User-Agent identificable y sesgo opcional por país.
    Con debounce en el frontend + caché en el backend el volumen es mínimo.
    """

    slug = 'nominatim'
    BASE_URL = 'https://nominatim.openstreetmap.org/search'

    def __init__(self, *, user_agent: str = '', country: str = '', timeout: int = 6):
        # UA identificable (requisito de la política de Nominatim).
        self.user_agent = user_agent or 'RemaliERP/1.0 (soporte@remali.mx)'
        # Sesgo por país (ISO-3166 alpha-2). Vacío = mundial. Ej. 'mx'.
        self.country = country
        self.timeout = timeout

    def search(self, query: str, *, limit: int = 6, lang: str = 'es') -> List[AddressResult]:
        params = {
            'q': query,
            'format': 'jsonv2',
            'addressdetails': 1,
            'limit': limit,
            'accept-language': lang,
        }
        if self.country:
            params['countrycodes'] = self.country
        resp = requests.get(
            self.BASE_URL,
            params=params,
            headers={'User-Agent': self.user_agent},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json() or []
        return [self._normalizar(item) for item in data]

    @staticmethod
    def _normalizar(item: dict) -> AddressResult:
        """Traduce la respuesta cruda de Nominatim al formato uniforme."""
        a = item.get('address', {}) or {}
        out = _empty_result()
        out.update({
            'display_name': item.get('display_name', '') or '',
            'street': a.get('road') or a.get('pedestrian') or a.get('footway') or '',
            'house_number': a.get('house_number', '') or '',
            'neighborhood': a.get('neighbourhood') or a.get('suburb') or a.get('quarter') or '',
            'city': a.get('city') or a.get('town') or a.get('village') or a.get('municipality') or '',
            'state': a.get('state', '') or '',
            'postcode': a.get('postcode', '') or '',
            'country': a.get('country', '') or '',
            'latitude': str(item.get('lat', '') or ''),
            'longitude': str(item.get('lon', '') or ''),
        })
        return out


class PhotonProvider(GeocodingProvider):
    """Proveedor OpenStreetMap · Photon (komoot).

    Optimizado para AUTOCOMPLETAR: hace prefix-search y tolera consultas parciales,
    por lo que "encuentra muchas más" direcciones que Nominatim mientras escribes.
    Se sesga a un país con el bounding box (`bbox`).
    """

    slug = 'photon'
    BASE_URL = 'https://photon.komoot.io/api/'

    def __init__(self, *, user_agent: str = '', country: str = '', timeout: int = 6):
        self.user_agent = user_agent or 'RemaliERP/1.0 (soporte@remali.mx)'
        self.country = (country or '').lower()
        self.timeout = timeout

    def search(self, query: str, *, limit: int = 8, lang: str = 'es') -> List[AddressResult]:
        params = {'q': query, 'limit': limit}
        bbox = _BBOX.get(self.country)
        if bbox:
            params['bbox'] = bbox  # sesga los resultados al país
        resp = requests.get(
            self.BASE_URL,
            params=params,
            headers={'User-Agent': self.user_agent},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        features = (resp.json() or {}).get('features', []) or []
        resultados = [self._normalizar(feat) for feat in features]
        # Con bbox Photon a veces incluye vecinos de frontera: si pedimos país, filtra.
        if self.country:
            cc = self.country.upper()
            resultados = [r for r in resultados if (r['_cc'] == cc or not r['_cc'])]
        # Quita el campo interno de countrycode antes de devolver.
        for r in resultados:
            r.pop('_cc', None)
        return resultados

    @staticmethod
    def _normalizar(feature: dict) -> AddressResult:
        props = feature.get('properties', {}) or {}
        geom = feature.get('geometry', {}) or {}
        coords = geom.get('coordinates') or [None, None]
        lon = coords[0] if len(coords) >= 1 else None
        lat = coords[1] if len(coords) >= 2 else None

        name = props.get('name', '') or ''
        street = props.get('street', '') or ''
        osm_key = props.get('osm_key', '')
        osm_value = props.get('osm_value', '')
        # Si es una vialidad, el nombre ES la calle.
        if not street and osm_key == 'highway':
            street = name

        neighborhood = props.get('district') or props.get('suburb') or props.get('neighbourhood') or props.get('locality') or ''
        # Nombres de colonia/asentamiento vienen como place.
        if not neighborhood and osm_key == 'place' and osm_value in ('suburb', 'neighbourhood', 'quarter', 'locality', 'hamlet'):
            neighborhood = name

        city = props.get('city') or props.get('town') or props.get('village') or props.get('municipality') or props.get('county') or ''
        state = props.get('state', '') or ''
        postcode = props.get('postcode', '') or ''
        country = props.get('country', '') or ''
        house = props.get('housenumber', '') or ''

        linea1 = ' '.join(p for p in [street or name, house] if p).strip()
        display = ', '.join(p for p in [linea1, neighborhood, city, state, postcode, country] if p and str(p).strip())

        out = _empty_result()
        out.update({
            'display_name': display or name,
            'street': street,
            'house_number': house,
            'neighborhood': neighborhood,
            'city': city,
            'state': state,
            'postcode': postcode,
            'country': country,
            'latitude': str(lat if lat is not None else ''),
            'longitude': str(lon if lon is not None else ''),
        })
        # Campo interno para filtrar por país (se elimina antes de devolver).
        out['_cc'] = (props.get('countrycode', '') or '').upper()
        return out


class GooglePlacesProvider(GeocodingProvider):
    """Proveedor Google Places API (New) · Text Search.

    UNA sola llamada por consulta (`places:searchText`) devuelve direcciones
    completas —con componentes y coordenadas—, así que encaja en el contrato
    `search` SIN tocar el frontend. El debounce del autocompletado + la caché de
    24 h del endpoint mantienen el volumen (y el costo) al mínimo.

    Requiere (en el backend, server-side):
      - GOOGLE_MAPS_API_KEY  con la API "Places API (New)" HABILITADA y facturación activa.
      - GEOCODING_PROVIDER=google  para activarlo.
    OJO con la restricción de la key: esto es una llamada de SERVIDOR (sin referrer),
    así que NO uses "HTTP referrers"; restríngela por API (Places API New) y, si se
    puede, por IP de salida. Con FieldMask pedimos solo lo que usamos (SKU más barato).
    """

    slug = 'google'
    BASE_URL = 'https://places.googleapis.com/v1/places:searchText'

    def __init__(self, *, api_key: str = '', country: str = '', timeout: int = 6):
        self.api_key = api_key or ''
        self.country = (country or '').upper()   # regionCode ISO-3166 alpha-2 (ej. 'MX')
        self.timeout = timeout

    def search(self, query: str, *, limit: int = 8, lang: str = 'es') -> List[AddressResult]:
        if not self.api_key:
            raise RuntimeError('Falta GOOGLE_MAPS_API_KEY para el proveedor Google Places.')
        body = {
            'textQuery': query,
            'languageCode': lang,
            'maxResultCount': min(max(int(limit), 1), 20),
        }
        if self.country:
            body['regionCode'] = self.country
        headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': self.api_key,
            # Solo los campos que usamos: menos datos = respuesta liviana y SKU más barato.
            'X-Goog-FieldMask': 'places.formattedAddress,places.addressComponents,places.location',
        }
        resp = requests.post(self.BASE_URL, json=body, headers=headers, timeout=self.timeout)
        if resp.status_code != 200:
            # Log del error REAL de Google (API no habilitada, sin facturación,
            # key inválida, REQUEST_DENIED…) para que la config se pueda depurar.
            log.warning('Google Places %s: %s', resp.status_code, (resp.text or '')[:600])
        resp.raise_for_status()
        data = resp.json() or {}
        return [self._normalizar(p) for p in (data.get('places') or [])]

    @staticmethod
    def _componente(comps: list, *tipos: str) -> str:
        """longText del primer componente cuyo `types` incluya alguno de `tipos`."""
        for t in tipos:
            for c in comps:
                if t in (c.get('types') or []):
                    return c.get('longText') or c.get('shortText') or ''
        return ''

    @classmethod
    def _normalizar(cls, place: dict) -> AddressResult:
        comps = place.get('addressComponents') or []
        loc = place.get('location') or {}
        out = _empty_result()
        out.update({
            'display_name': place.get('formattedAddress', '') or '',
            'street': cls._componente(comps, 'route'),
            'house_number': cls._componente(comps, 'street_number'),
            'neighborhood': cls._componente(comps, 'sublocality', 'sublocality_level_1', 'neighborhood', 'colloquial_area'),
            'city': cls._componente(comps, 'locality', 'administrative_area_level_2', 'postal_town'),
            'state': cls._componente(comps, 'administrative_area_level_1'),
            'postcode': cls._componente(comps, 'postal_code'),
            'country': cls._componente(comps, 'country'),
            'latitude': str(loc.get('latitude', '') or ''),
            'longitude': str(loc.get('longitude', '') or ''),
        })
        return out


# Registro de proveedores disponibles (para elegir por nombre desde settings).
_PROVIDERS = {
    'photon': PhotonProvider,
    'nominatim': NominatimProvider,
    'google': GooglePlacesProvider,
    # 'mapbox': MapboxProvider,         # futuro
}

_provider_singleton: GeocodingProvider | None = None


def get_provider() -> GeocodingProvider:
    """Devuelve el proveedor activo (singleton). Se elige con settings/env:

        GEOCODING_PROVIDER   -> 'google' (DEFAULT) | 'photon' | 'nominatim'
        GEOCODING_COUNTRY    -> sesgo por país ISO-2 (default 'mx')
        GEOCODING_USER_AGENT -> User-Agent identificable (solo Photon/Nominatim)
        GOOGLE_MAPS_API_KEY  -> API key server-side (requerida por 'google')

    Decisión del negocio: SIEMPRE Google. Por eso el default es 'google' y un
    valor desconocido también cae a Google — nunca a un proveedor gratis por
    accidente. Si Google falla (falta la key, API sin habilitar, sin
    facturación), la vista devuelve 502 y lo loguea; jamás usa el gratis a
    escondidas. Photon/Nominatim quedan como opción manual explícita.
    """
    global _provider_singleton
    if _provider_singleton is None:
        name = getattr(settings, 'GEOCODING_PROVIDER', os.environ.get('GEOCODING_PROVIDER', 'google'))
        cls = _PROVIDERS.get(name, GooglePlacesProvider)
        country = getattr(settings, 'GEOCODING_COUNTRY', os.environ.get('GEOCODING_COUNTRY', 'mx'))
        if cls is GooglePlacesProvider:
            _provider_singleton = cls(
                api_key=getattr(settings, 'GOOGLE_MAPS_API_KEY', os.environ.get('GOOGLE_MAPS_API_KEY', '')),
                country=country,
            )
        else:
            _provider_singleton = cls(
                user_agent=getattr(settings, 'GEOCODING_USER_AGENT', os.environ.get('GEOCODING_USER_AGENT', '')),
                country=country,
            )
    return _provider_singleton
