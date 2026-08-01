import axios from 'axios'
import { notificarMutacion } from './realtime'
import { borrarToken, leerToken } from './token'
import { empiezaPeticion, terminaPeticion } from './cargando'

/* Peticiones que NO deben encender el indicador global de carga. Un indicador
   que se enciende sin que el usuario haya pedido nada enseña a ignorarlo, y
   entonces ya no sirve cuando de verdad hace falta.
   Una llamada suelta puede excluirse pasando `{ fondo: true }` en su config.

   - /notificaciones/            el panel lo sondea cada 5 s.
   - /rentas/tareas/             no se sondea, pero lo recarga el bus de tiempo
                                 real tras cada mutación y la pantalla "Mi jornada"
                                 ya muestra su propio estado de carga. Taparla
                                 además con un overlay a pantalla completa
                                 después de cada acción del técnico estorba. */
const SIN_INDICADOR = ['/notificaciones/', '/rentas/tareas/']

function esDeFondo(config: any) {
  if (config?.fondo) return true
  const url: string = config?.url || ''
  return SIN_INDICADOR.some(s => url.includes(s))
}

/** Normaliza VITE_API_URL a una base usable ('/api', ':8000' → localhost, etc.).
 *  La comparte resolveMediaUrl para derivar el origin del backend. */
export function normalizeBase(url?: string) {
  const u = (url || '').trim()
  if (!u) return '/api'
  if (u.startsWith('/')) return u
  if (u.startsWith(':')) return `http://localhost${u}`
  if (!/^https?:\/\//.test(u)) return `http://${u}`
  return u
}

const api = axios.create({ baseURL: normalizeBase(import.meta.env.VITE_API_URL) })

api.interceptors.request.use(config => {
  const token = leerToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Se marca la propia petición: al llegar la respuesta hay que saber si esta
  // llegó a contarse, o el contador se desbalancea y el loader se queda pegado.
  if (!esDeFondo(config)) {
    ;(config as any).__contada = true
    empiezaPeticion()
  }
  return config
})

/** Descuenta una petición contada, venga por respuesta buena o por error. */
function cerrar(config: any) {
  if (config?.__contada) {
    config.__contada = false
    terminaPeticion()
  }
}

// Si el token expira o es inválido (401), limpiar sesión y mandar a login
api.interceptors.response.use(
  response => {
    cerrar(response.config)
    // Toda mutación exitosa avisa al bus: lo que quedó viejo se recarga solo.
    notificarMutacion(response.config?.url || '', response.config?.method || '')
    return response
  },
  error => {
    cerrar(error?.config)
    const status = error?.response?.status
    const hadToken = Boolean(leerToken())
    const url: string = error?.config?.url || ''
    // No redirigir por el propio intento de login
    const isAuthCall = url.includes('/auth/token') || url.includes('/auth/login')
    if (status === 401 && hadToken && !isAuthCall) {
      borrarToken()
      const path = window.location.pathname
      if (!path.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(path)}&expired=1`
      }
    }
    return Promise.reject(error)
  }
)

export default api
