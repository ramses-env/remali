import { createContext, useContext, useState } from 'react'
import api from '../lib/api'
import { olvidarAcceso } from '../lib/acceso'
import { borrarToken, guardarToken, leerToken } from '../lib/token'

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

  async function login(usuario: string, password: string, recordar = true) {
    async function tryEndpoints() {
      const attempts = [
        { url: '/auth/token/', payload: { email: usuario, password } },
        { url: '/auth/token/', payload: { username: usuario, password } },
        { url: '/auth/login/', payload: { email: usuario, password } },
        { url: '/auth/jwt/create/', payload: { email: usuario, password } },
      ]
      for (const a of attempts) {
        try {
          const r = await api.post(a.url, a.payload as any)
          const t = r.data?.access || r.data?.token || r.data?.key
          if (typeof t === 'string' && t.length > 0) return t
        } catch {}
      }
      throw new Error('auth')
    }
    const t = await tryEndpoints()
    guardarToken(t, recordar)
    setToken(t)
  }

  function entrarConToken(access: string, recordar = true) {
    guardarToken(access, recordar)
    setToken(access)
  }

  function logout() {
    borrarToken()
    // El acento y el nivel son de esa cuenta, no del navegador: si no se limpian,
    // quien entre después vería el panel en negro y abriría en la sección del
    // usuario anterior hasta que cargue su propio perfil.
    olvidarAcceso()
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
