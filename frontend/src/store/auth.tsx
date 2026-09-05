import { createContext, useContext, useEffect, useState } from 'react'
import api from '../lib/api'
import { olvidarAcceso } from '../lib/acceso'
import { borrarToken, guardarToken, leerToken } from '../lib/token'
import { olvidarDatos } from '../lib/datos'
import { anotarFallo } from '../lib/fallo'

type AuthContextType = {
  token: string | null
  /** `recordar` decide si la sesión sobrevive al cierre del navegador. */
  login: (usuario: string, password: string, recordar?: boolean) => Promise<void>
  /** Entra con un token que el backend ya emitió (p. ej. tras validar el de Google). */
  entrarConToken: (access: string, recordar?: boolean) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => leerToken())

  /* La sesión vive en el navegador, no en la pestaña: la tienda y el panel son
     el mismo origen y comparten la llave del token. Si en otra pestaña alguien
     entra como cliente, el panel abierto aquí se queda con su pantalla pintada
     pero YA trae otro token, y todas sus peticiones empiezan a responder 403.
     Como los 403 no levantan aviso (el panel sondea módulos que cada rol no ve),
     el resultado era un panel mudo: listas vacías, campana vacía y ni una
     bandera de error. El evento `storage` solo llega a las OTRAS pestañas, que
     es justo lo que hace falta: al cambiar la sesión, esta pestaña se entera y
     RequireAdmin vuelve a verificar el acceso. */
  useEffect(() => {
    const alCambiarSesion = (e: StorageEvent) => {
      if (e.key !== null && e.key !== 'token') return
      const actual = leerToken()
      setToken(prev => (prev === actual ? prev : actual))
    }
    window.addEventListener('storage', alCambiarSesion)
    return () => window.removeEventListener('storage', alCambiarSesion)
  }, [])

  async function login(usuario: string, password: string, recordar = true) {
    // Un solo endpoint: /auth/login/ acepta correo O usuario y deja el REFRESH en
    // cookie httpOnly (los /auth/token/ de antes lo devolvían en el body y no
    // ponían la cookie → el refresco silencioso no tendría de dónde renovar).
    const r = await api.post('/auth/login/', { email: usuario, password })
    const t = r.data?.access
    if (typeof t !== 'string' || !t) throw new Error('auth')
    guardarToken(t, recordar)
    setToken(t)
  }

  function entrarConToken(access: string, recordar = true) {
    guardarToken(access, recordar)
    setToken(access)
  }

  function logout() {
    // Cierra también en el SERVIDOR: borra la cookie httpOnly del refresh e
    // invalida los tokens vivos. Fire-and-forget (va con el access aún en el
    // header); la UI no espera y, aunque falle la red, se limpia local igual.
    try { api.post('/auth/logout/', {}, { withCredentials: true }).catch(anotarFallo) } catch { /* noop */ }
    borrarToken()
    // El acento y el nivel son de esa cuenta, no del navegador: si no se limpian,
    // quien entre después vería el panel en negro y abriría en la sección del
    // usuario anterior hasta que cargue su propio perfil.
    olvidarAcceso()
    /* Y la caché de lecturas: ahí quedaron el catálogo, los clientes, lo que
       esa cuenta hubiera abierto. Aquí SÍ se borra en vez de caducarse —lo que
       hace el bus tras una mutación— porque el dato es de otra persona y no
       puede seguir pintado ni un render mientras llega el de quien entre ahora. */
    olvidarDatos()
    setToken(null)
  }

  return (
    <AuthContext.Provider value={{ token, login, entrarConToken, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('Auth context')
  return ctx
}
