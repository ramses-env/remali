import { createContext, useContext, useEffect, useState } from 'react'
import api from '../lib/api'
import { useAuth } from './auth'

type User = {
  id: number
  email: string
  username: string
  first_name: string
  last_name: string
  is_staff?: boolean
  groups?: string[]
  /* `/auth/me/` ya devuelve las capacidades; sin tiparlas, la tienda no puede
     distinguir a un cliente de alguien de administración. */
  puede?: { nivel: number; rol: string }
  /* Para saber si al cliente le falta completar su perfil sin pedir otro endpoint. */
  datos_completos?: boolean
  /* Correo confirmado y "perfil verificado" (correo + datos) = lo que da el 5%. */
  email_verificado?: boolean
  perfil_verificado?: boolean
}

type ProfileContextType = {
  user: User | null
  refresh: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextType | null>(null)

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const [user, setUser] = useState<User | null>(null)

  async function refresh() {
    if (!token) {
      setUser(null)
      return
    }
    try {
      const r = await api.get('/auth/me/')
      setUser(r.data)
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    if (token) refresh()
    else setUser(null)
  }, [token])

  return <ProfileContext.Provider value={{ user, refresh }}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('Profile context')
  return ctx
}
