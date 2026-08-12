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
  is_superuser?: boolean
  groups?: string[]
  /* Foto de perfil (resuelta): si el usuario subió foto, usa esa; si no,
     fallback al SVG POR DEFECTO DE SU ROL (data-URI). Nunca null. */
  avatar_url?: string | null
  /* Foto de reserva (capa 2): avatar por rol (PNG o SVG), IGNORE la foto
     que subió el usuario. Útil cuando la foto personalizada da 404 porque
     el storage la borró o el enlace expiró. */
  avatar_url_rol?: string | null
  /* `/auth/me/` ya devuelve las capacidades; sin tiparlas, la tienda no puede
     distinguir a un cliente de alguien de administración. */
  puede?: { nivel: number; rol: string; [k: string]: boolean | number | string }
  /* Para saber si al cliente le falta completar su perfil sin pedir otro endpoint. */
  datos_completos?: boolean
  /* Correo confirmado y "perfil verificado" (correo + datos) = lo que da el 5%. */
  email_verificado?: boolean
  perfil_verificado?: boolean
  /* Estado del onboarding / guía de primer uso. */
  onboarding?: {
    completado: boolean
    pasos_completados: string[]
    version: number
  }
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

  /* ⚠️ Upgrade-safe loader.
   *
   * Antes el endpoint `/auth/me/` NO devolvía `avatar_url`. Si el usuario
   * tiene sesión abierta desde antes del deploy (token no cambió), el primer
   * `useEffect([token])` ya corrió hace días y ya no vuelve a ejecutarse.
   *
   * Solución: (A) refrescar una vez al montar el Provider si hay token; (B)
   * volver a refrescar si por cualquier motivo el objeto `user` cargado NO
   * trae avatar_url (código viejo). Sin doble-carga en uso normal. */
  useEffect(() => { if (token) refresh() }, [token]) // login / logout
  useEffect(() => { if (token && !user) refresh() }, [token, user]) // mount cold-start
  useEffect(() => {
    if (!token || !user) return
    // Upgrade-safe: objeto viejo que no trae campos nuevos del endpoint `/auth/me/`.
    const faltan = !('avatar_url' in user) || !('avatar_url_rol' in user)
    if (faltan) refresh()
  }, [token, user])

  return <ProfileContext.Provider value={{ user, refresh }}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('Profile context')
  return ctx
}
