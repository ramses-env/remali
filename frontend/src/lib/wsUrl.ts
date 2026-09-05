import { normalizeBase } from './api'

/** URL absoluta de un WebSocket del backend.
 *
 * `location.host` sirve mientras el frontend y el backend comparten origen: en
 * desarrollo Vite proxyea /ws, y antes Django servía el SPA. Separados en dos
 * servicios —remali.mx es un sitio estático y api.remali.mx es Django— ese host
 * apunta al que NO habla WebSocket: la campana y el bus del panel se quedan
 * reintentando cada 5 s contra un servidor que nunca va a responder, sin un solo
 * error a la vista. El destino sale de VITE_API_URL, igual que el origen de las
 * imágenes en resolveMediaUrl.
 *
 * Si VITE_API_URL es relativa ('/api'), seguimos en el mismo origen y vale
 * `location`.
 */
export default function wsUrl(ruta: string, token: string) {
  const base = normalizeBase(import.meta.env.VITE_API_URL)
  let host = location.host
  let seguro = location.protocol === 'https:'

  if (/^https?:\/\//.test(base)) {
    try {
      const u = new URL(base)
      host = u.host
      seguro = u.protocol === 'https:'
    } catch { /* base ilegible: nos quedamos con el origen actual */ }
  }

  return `${seguro ? 'wss' : 'ws'}://${host}${ruta}?token=${encodeURIComponent(token)}`
}
