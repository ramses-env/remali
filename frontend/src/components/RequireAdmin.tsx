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

/* `falla` NO es lo mismo que `denied`. Antes cualquier error de /auth/me/ —una
   red que parpadea, un 500, el backend reiniciándose— se trataba como "no tienes
   permiso" y expulsaba a la tienda. Recargar el panel con mala señal te sacaba
   de donde estabas sin explicación. Ahora el rebote es solo para una respuesta
   DEFINITIVA del servidor; lo demás ofrece reintentar y conserva la dirección. */
type State = 'checking' | 'allowed' | 'denied' | 'falla'

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const loc = useLocation()
  const [state, setState] = useState<State>('checking')
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let active = true
    if (!token) {
      setState('denied')
      return
    }
    setState('checking')
    consultarYo()
      .then(yo => {
        if (!active) return
        // Se recuerda aquí también: si alguien abre /dashboard directo (sin pasar
        // por el login), el panel ya sabe con qué acento y sección abrir.
        recordarAcceso(yo)
        setState(entraAlPanel(yo) ? 'allowed' : 'denied')
      })
      .catch(err => {
        if (!active) return
        const status = err?.response?.status
        // 401 ya lo maneja el interceptor de api.ts (renueva o manda al login).
        // 403 sí es definitivo: el servidor dijo que esta cuenta no entra.
        setState(status === 403 ? 'denied' : 'falla')
      })
    return () => { active = false }
  }, [token, intento])

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

  if (state === 'falla') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app px-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-ink font-bold">No pudimos confirmar tu acceso</p>
          <p className="text-mute text-sm">Puede ser tu conexión o que el servidor esté ocupado. Tu sesión sigue abierta.</p>
          <button
            onClick={() => setIntento(n => n + 1)}
            className="px-6 py-2.5 rounded-full bg-gold text-gold-on text-sm font-bold hover:opacity-90 transition-opacity"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    // Sin sesión → al login para que entre. Con sesión pero sin nivel (un cliente
    // que cayó en una ruta del panel) → a la tienda: ya está autenticado, mandarlo
    // al login lo regresaría aquí en bucle (el parpadeo de "Verificando acceso…").
    return <Navigate to={token ? '/' : `/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  }

  return <>{children}</>
}
