import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
type ThemeCtx = { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }

const Ctx = createContext<ThemeCtx | null>(null)

// Clave NUEVA a propósito. El esquema viejo guardaba 'theme' en CADA carga, así
// que casi todos quedaron con 'light' aunque nunca lo eligieran; cambiar solo el
// default no los movería. Con una clave nueva —y escribiéndola solo cuando el
// usuario cambia el tema a mano— el principal pasa a ser OSCURO para todos,
// salvo quien elija claro explícitamente de aquí en adelante.
const CLAVE = 'remali_tema'

function getInitial(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const saved = localStorage.getItem(CLAVE)
  if (saved === 'light' || saved === 'dark') return saved
  return 'dark'
}

function aplicar(theme: Theme) {
  const el = document.documentElement
  el.classList.toggle('dark', theme === 'dark')
  el.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial)

  useEffect(() => { aplicar(theme) }, [theme])

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(CLAVE, t) } catch { /* modo privado */ }
    setThemeState(t)
  }
  const toggle = () => setThemeState(t => {
    const n: Theme = t === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(CLAVE, n) } catch { /* modo privado */ }
    return n
  })

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme fuera de ThemeProvider')
  return ctx
}
