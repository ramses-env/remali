/**
 * Servicio de geocodificación (autocompletado de direcciones).
 *
 * React SOLO habla con nuestro backend (`/api/address/search/`), nunca con
 * OpenStreetMap directamente. El formato `AddressResult` es uniforme e
 * independiente del proveedor: si el backend cambia de Nominatim a Google
 * Places / Mapbox / HERE, este archivo y los componentes no se tocan.
 */
import api from './api'

export type AddressResult = {
  display_name: string
  street: string
  house_number: string
  neighborhood: string
  city: string
  state: string
  postcode: string
  country: string
  latitude: string
  longitude: string
}

/**
 * Busca direcciones. Acepta un AbortSignal para cancelar peticiones en vuelo
 * (útil con el debounce del autocompletado).
 */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressResult[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const res = await api.get<AddressResult[]>('/address/search/', { params: { q }, signal })
  return Array.isArray(res.data) ? res.data : []
}

/**
 * Predicción de autocompletado (as-you-type). NO trae coordenadas: se resuelven
 * con `getAddressDetails(place_id)` al seleccionar. Los proveedores sin
 * autocomplete nativo (Photon/Nominatim) embeben la dirección completa en
 * `detalle`, así el front la usa sin una segunda llamada.
 */
export type AddressPrediction = {
  place_id: string
  description: string
  main_text: string
  secondary_text: string
  detalle?: AddressResult
}

/**
 * Token de sesión de autocompletado: agrupa las llamadas de un mismo tecleo + el
 * `details` final en UNA sesión de facturación de Google (bastante más barato).
 * Se renueva tras cada selección.
 */
export function nuevaSesionDireccion(): string {
  try { return crypto.randomUUID() } catch { return `s-${Date.now()}-${Math.round(Math.random() * 1e9)}` }
}

/** Sugerencias EN VIVO. Acepta AbortSignal para cancelar con el debounce. */
export async function autocompleteAddresses(query: string, session: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const res = await api.get<AddressPrediction[]>('/address/autocomplete/', { params: { q, session }, signal })
  return Array.isArray(res.data) ? res.data : []
}

/** Resuelve una predicción (place_id) a su dirección completa, al seleccionarla. */
export async function getAddressDetails(placeId: string, session: string): Promise<AddressResult> {
  const res = await api.get<AddressResult>('/address/details/', { params: { place_id: placeId, session } })
  return res.data
}

/** Compone una dirección legible a partir del resultado estructurado. */
export function formatAddress(a: AddressResult): string {
  const linea1 = [a.street, a.house_number].filter(Boolean).join(' ')
  const partes = [linea1, a.neighborhood, a.city, a.state, a.postcode].map(s => (s || '').trim()).filter(Boolean)
  return partes.join(', ') || a.display_name
}

/** Mapea un resultado al conjunto de campos de domicilio estructurado del formulario. */
export function addressToFields(a: AddressResult) {
  return {
    calle: a.street || '',
    numero_exterior: a.house_number || '',
    colonia: a.neighborhood || '',
    municipio: a.city || '',
    ciudad: a.city || '',
    entidad: a.state || '',
    codigo_postal: a.postcode || '',
    pais: a.country || 'México',
    latitud: a.latitude || null,
    longitud: a.longitude || null,
  }
}
