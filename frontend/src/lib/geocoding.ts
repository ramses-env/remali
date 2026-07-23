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
