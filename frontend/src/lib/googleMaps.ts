/**
 * Carga de Google Maps JavaScript API (bajo demanda, una sola vez).
 *
 * La key vive en frontend/.env.local → VITE_GOOGLE_MAPS_API_KEY (gitignored).
 * OJO: las keys de Maps JS son públicas por diseño (viajan al navegador);
 * su protección real son las RESTRICCIONES en Google Cloud Console:
 *   - Application restrictions → HTTP referrers (remali.mx, localhost).
 *   - API restrictions → solo Maps JavaScript API (+ las que de verdad uses).
 *
 * Uso:
 *   const g = await cargarGoogleMaps()
 *   const { Map } = await g.maps.importLibrary('maps')
 *   new Map(el, { center: { lat: 16.86, lng: -99.88 }, zoom: 12 })
 */

declare global {
  interface Window { google?: any }
}

let cargando: Promise<any> | null = null

export function cargarGoogleMaps(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google)
  if (cargando) return cargando

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (!key) {
    return Promise.reject(new Error(
      'Falta VITE_GOOGLE_MAPS_API_KEY en frontend/.env.local (reinicia Vite tras agregarla).'
    ))
  }

  cargando = new Promise((resolve, reject) => {
    // Con loading=async el `onload` del <script> NO garantiza que la API ya
    // inicializó (importLibrary aparece después): la señal correcta es el
    // parámetro `callback`, que Google invoca al terminar el bootstrap.
    const cb = '__remaliGmapsListo'
    ;(window as any)[cb] = () => {
      delete (window as any)[cb]
      resolve(window.google)
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=es&region=MX&callback=${cb}`
    s.async = true
    s.onerror = () => { cargando = null; delete (window as any)[cb]; reject(new Error('No se pudo cargar Google Maps')) }
    document.head.appendChild(s)
  })
  return cargando
}
