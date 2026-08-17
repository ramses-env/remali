import axios from 'axios'
import { notificarMutacion } from './realtime'
import { borrarToken, leerToken, guardarToken, esRecordado } from './token'
import { empiezaPeticion, terminaPeticion } from './cargando'
import { avisar } from './avisos'

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

// timeout: sin esto, una subida que se cuelga (Cloudinary lento, la red móvil
// que se cae a media petición) deja el botón en "Guardando…" para siempre. 60 s
// da margen a una foto grande, pero corta lo que de verdad se atoró y deja que
// el formulario muestre el error y se libere.
const api = axios.create({ baseURL: normalizeBase(import.meta.env.VITE_API_URL), timeout: 60_000 })

/* Refresco silencioso: cuando el access vence, el backend responde 401. En vez
   de sacar al usuario, se pide un access nuevo a /auth/refresh/ con el REFRESH
   que vive en la cookie httpOnly (el navegador la manda solo; JS no la ve). Una
   sola renovación a la vez: si varias peticiones caen 401 juntas, comparten la
   misma promesa para no rotar el refresh varias veces y pisarse. Se usa `axios`
   crudo (no `api`) para no reentrar en este mismo interceptor. */
let refrescando: Promise<string | null> | null = null
function refrescarAccess(): Promise<string | null> {
  if (!refrescando) {
    refrescando = axios
      .post(normalizeBase(import.meta.env.VITE_API_URL) + '/auth/refresh/', {}, { withCredentials: true, timeout: 20_000 })
      .then(r => {
        const nuevo = r.data?.access
        if (typeof nuevo === 'string' && nuevo) { guardarToken(nuevo, esRecordado()); return nuevo }
        return null
      })
      .catch(() => null)
      .finally(() => { refrescando = null })
  }
  return refrescando
}

/* Rutas del flujo de contraseña OLVIDADA (las públicas; ojo: `/auth/password/`
   a secas es el cambio con sesión y ese SÍ necesita el token). No deben llevar
   el token: quien viene a restablecer suele traer una sesión vieja en el
   navegador (la olvidó pero seguía logueado), y un access vencido en el header
   hace que el backend conteste 401 antes de mirar la vista. Tampoco deben
   disparar el refresco ni el redirect a /login, o el usuario nunca llega a ver
   el formulario del enlace que le llegó por correo. */
const RUTAS_OLVIDE = ['/auth/password/olvide/', '/auth/password/restablecer/']
const esRutaOlvide = (url?: string) => RUTAS_OLVIDE.some(r => (url || '').includes(r))

api.interceptors.request.use(config => {
  const token = leerToken()
  if (token && !esRutaOlvide(config.url)) config.headers.Authorization = `Bearer ${token}`
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
  async error => {
    cerrar(error?.config)
    const status = error?.response?.status
    const original: any = error?.config || {}
    const url: string = original.url || ''
    const hadToken = Boolean(leerToken())
    // El propio flujo de auth no debe disparar refresco ni redirect (evita bucles).
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')
      || esRutaOlvide(url)

    if (status === 401 && hadToken && !isAuthCall) {
      // 1er 401: el access seguramente venció → renovar en silencio y REINTENTAR.
      if (!original.__reintento) {
        original.__reintento = true
        const nuevo = await refrescarAccess()
        if (nuevo) {
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${nuevo}` }
          return api(original)
        }
      }
      // No se pudo renovar (o el reintento volvió a 401): la sesión terminó.
      borrarToken()
      const path = window.location.pathname
      if (!path.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(path)}&expired=1`
      }
      return Promise.reject(error)
    }

    // Avisos GLOBALES (tienda y panel por igual): SOLO red caída y errores del
    // servidor. Los 400 son de cada formulario; los 403 NO van aquí — el panel
    // sondea módulos que cada rol no ve (técnico → métricas, usuarios...) y
    // avisarlos inundaba la pantalla con "necesitas permisos" (visto en campo).
    if (!esDeFondo(original) && status !== 401) {
      if (!error?.response) {
        avisar('Sin conexión con REMALI. Revisa tu internet e inténtalo de nuevo.')
      } else if (status >= 500) {
        avisar('Algo falló de nuestro lado. Inténtalo de nuevo en un momento.')
      }
    }
    return Promise.reject(error)
  }
)

export default api
