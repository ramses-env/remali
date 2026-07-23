/**
 * Guard del panel: deja pasar a quien tenga rol, sea el nivel que sea.
 *
 * El nombre quedó de cuando solo entraban administradores. Hoy también entra
 * Técnico, así que la comprobación es "tiene nivel", no "es admin".
 */
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { consultarYo, entraAlPanel, recordarAcceso } from '../lib/acceso'

type State = 'checking' | 'allowed' | 'denied'

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const loc = useLocation()
  const [state, setState] = useState<State>('checking')

  useEffect(() => {
    let active = true
    if (!token) {
      setState('denied')
      return
    }
    consultarYo()
      .then(yo => {
        if (!active) return
        // Se recuerda aquí también: si alguien abre /dashboard directo (sin pasar
        // por el login), el panel ya sabe con qué acento y sección abrir.
        recordarAcceso(yo)
        setState(entraAlPanel(yo) ? 'allowed' : 'denied')
      })
      .catch(() => active && setState('denied'))
    return () => { active = false }
  }, [token])

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="flex flex-col items-center gap-4">
          <span className="w-8 h-8 border-2 border-edge border-t-gold rounded-full animate-spin" />
          <p className="text-mute text-sm">Verificando acceso…</p>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  }

  return <>{children}</>
}
