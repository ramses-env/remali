import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
type ThemeCtx = { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }

const Ctx = createContext<ThemeCtx | null>(null)

function getInitial(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  // Diseño REMALI: claro por defecto (el comp es tema claro)
  return 'light'
}

function apply(theme: Theme) {
  const el = document.documentElement
  el.classList.toggle('dark', theme === 'dark')
  el.style.colorScheme = theme
  localStorage.setItem('theme', theme)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitial)

  useEffect(() => { apply(theme) }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)
  const toggle = () => setThemeState(t => (t === 'dark' ? 'light' : 'dark'))

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme fuera de ThemeProvider')
  return ctx
}
