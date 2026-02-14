import { createContext, useContext, useState } from 'react'
import api from '../lib/api'

type AuthContextType = {
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  async function login(email: string, password: string) {
    async function tryEndpoints() {
      const attempts = [
        { url: '/auth/token/', payload: { email, password } },
        { url: '/auth/token/', payload: { username: email, password } },
        { url: '/auth/login/', payload: { email, password } },
        { url: '/auth/jwt/create/', payload: { email, password } },
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
    localStorage.setItem('token', t)
    setToken(t)
  }
  function logout() {
    localStorage.removeItem('token')
    setToken(null)
  }
  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('Auth context')
  return ctx
}
