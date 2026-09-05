import axios from 'axios'
import { notificarMutacion } from './realtime'
import { borrarToken, leerToken, guardarToken, esRecordado } from './token'
import { leerEspacio } from './espacio'
import { empiezaPeticion, terminaPeticion } from './cargando'
import { avisar } from './avisos'

/* `fondo` es una opción NUESTRA, no de axios: marca la petición para que no
   encienda el indicador global. Se declara aquí para que el resto del código la
   pase como un campo normal (`{ fondo: true }`) en vez de castear a `never` en
   cada llamada, que es como estaba y escondía errores de tipos de verdad. */
declare module 'axios' {
  interface AxiosRequestConfig {
    fondo?: boolean
  }
}

/* ¿Qué enciende el indicador global (el overlay que tapa la pantalla)?

   La regla está INVERTIDA respecto a como estaba: antes lo encendía todo salvo
   una lista de excepciones, y la lista se quedó corta. El panel se fue marcando
   a mano con `fondo: true` —módulo por módulo, porque cambiar de sección dispara
   entre dos y seis peticiones y la pantalla parpadeaba en cada cambio— pero la
   TIENDA nunca se marcó: abrir /equipos dispara entre cuatro y siete peticiones
   (catálogo, marcas, categorías, tipos, perfil…) y el overlay las tapaba todas.

   Un indicador que se enciende sin que el usuario haya pedido nada enseña a
   ignorarlo, y entonces ya no sirve cuando de verdad hace falta.

   Ahora el overlay sale SOLO por algo que el usuario disparó a propósito:

   - Mutaciones (POST/PUT/PATCH/DELETE): guardar, timbrar, cobrar. Aquí tapar la
     pantalla sí comunica algo —"no toques nada, esto se está escribiendo"— y
     además evita el doble clic.
   - Descargas (`responseType: 'blob'`): generar un PDF, exportar. El usuario
     picó un botón y espera un archivo.

   Un GET normal —traer datos para pintar una pantalla— NUNCA lo enciende. Cada
   pantalla enseña su propio esqueleto mientras llega lo suyo, que es lo que
   deja ver la forma de la página en vez de un velo negro encima.

   Se puede forzar cualquiera de las dos formas por llamada:
     { fondo: true }    nunca enciende el overlay (una mutación de fondo)
     { fondo: false }   lo enciende aunque sea un GET
*/
const SIN_INDICADOR = ['/notificaciones/', '/rentas/tareas/']

function esDeFondo(config: any) {
  // La llamada manda: `fondo` explícito gana sobre cualquier heurística.
  if (config?.fondo !== undefined) return Boolean(config.fondo)
  const url: string = config?.url || ''
  if (SIN_INDICADOR.some(s => url.includes(s))) return true
  // Mutación: la disparó el usuario y conviene bloquear mientras se escribe.
  if ((config?.method || 'get').toLowerCase() !== 'get') return false
  // Descarga de archivo: también la disparó el usuario.
  return config?.responseType !== 'blob'
}

/* Si una petición merece un AVISO cuando falla es otra pregunta, y por eso vive
   en su propia función. Antes la contestaba `esDeFondo`, pero al invertir la
   regla del overlay las dos se separaron: que un GET del catálogo no tape la
   pantalla mientras carga no significa que pueda quedarse MUDO si el servidor
   está caído —eso deja al cliente viendo una pantalla vacía sin saber por qué—.

   Aquí la regla sigue siendo la de siempre: avisa todo, salvo los sondeos
   automáticos (que van solos, cada pocos segundos, y avisarlos sería una
   cascada de toasts por un bache de red) y lo que la llamada silencie a mano
   con `fondo: true`. */
function avisaFallos(config: any) {
  if (config?.fondo === true) return false
  const url: string = config?.url || ''
  return !SIN_INDICADOR.some(s => url.includes(s))
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

/* Rutas PÚBLICAS de entrada: crear cuenta, entrar, y el flujo de contraseña
   olvidada (ojo: `/auth/password/` a secas es el cambio CON sesión y ese sí
   necesita el token).

   Ninguna debe llevar el token. Quien viene aquí casi siempre trae una sesión
   vieja colgando en el navegador —se le venció, la olvidó, probó algo— y un
   access muerto en el header hace que el backend conteste 401 ANTES de mirar la
   vista, aunque la vista sea pública.

   Y tampoco deben disparar el refresco ni el redirect a /login. Ese redirect es
   lo que hacía que "Crear cuenta" pareciera un botón muerto: el 401 se comía la
   petición, borraba el token y te mandaba a /login — que comparte marco visual
   con /registro, así que ni se notaba que te habían movido de página. */
const RUTAS_PUBLICAS = [
  '/auth/registro/',
  '/auth/login',
  '/auth/password/olvide/',
  '/auth/password/restablecer/',
]
const esRutaPublica = (url?: string) => RUTAS_PUBLICAS.some(r => (url || '').includes(r))

/* Pantallas donde el usuario está ENTRANDO o creando cuenta. Un 401 aquí no
   debe moverlo de sitio: no hay nada protegido que defender y sí una captura a
   medias que perder. Se comparan con la ruta del navegador, no con la URL de la
   petición: lo que importa es dónde está el usuario, no a quién le preguntamos. */
const PANTALLAS_DE_ACCESO = ['/login', '/registro', '/recuperar', '/restablecer', '/verificar']
const enPantallaDeAcceso = () =>
  PANTALLAS_DE_ACCESO.some(r => window.location.pathname.startsWith(r))

api.interceptors.request.use(config => {
  const token = leerToken()
  if (token && !esRutaPublica(config.url)) config.headers.Authorization = `Bearer ${token}`
  /* El cliente SIN cuenta se identifica con su espacio de borradores. Va en un
     encabezado y no en la URL a propósito: un secreto en la barra de
     direcciones se filtra por historial, logs y Referer. Se manda también con
     sesión iniciada, porque /espacio/reclamar/ necesita los dos a la vez para
     adoptar los borradores que armó antes de registrarse. */
  const espacio = leerEspacio()
  if (espacio) config.headers['X-Espacio'] = espacio
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
    const isAuthCall = url.includes('/auth/refresh') || esRutaPublica(url)

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
      /* El token muerto se borra SIEMPRE, pero mandar al usuario a /login solo
         tiene sentido si estaba en una pantalla que necesita sesión.

         En las pantallas de acceso NO se le toca la página. Ahí el redirect
         hacía daño de verdad: quien está creando una cuenta con una sesión
         vieja colgando en el navegador —se le venció, la borraron, cambió de
         cuenta— veía cómo `window.location.href` recargaba entera la página a
         media captura y le borraba lo que había escrito. Desde su lado, el
         botón "Crear cuenta" simplemente no hacía nada.

         Y es un redirect que además sobra: estas pantallas ya saben tratar una
         sesión muerta —`useRedirigirSiHaySesion` hace `logout()` y enseña el
         formulario—. El interceptor se le adelantaba a martillazos. */
      if (!enPantallaDeAcceso()) {
        const path = window.location.pathname
        window.location.href = `/login?next=${encodeURIComponent(path)}&expired=1`
      }
      return Promise.reject(error)
    }

    // Avisos GLOBALES (tienda y panel por igual): SOLO red caída y errores del
    // servidor. Los 400 son de cada formulario; los 403 NO van aquí — el panel
    // sondea módulos que cada rol no ve (técnico → métricas, usuarios...) y
    // avisarlos inundaba la pantalla con "necesitas permisos" (visto en campo).
    if (avisaFallos(original) && status !== 401) {
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
