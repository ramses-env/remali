import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/** Favoritos del visitante: ids de equipos guardados con el corazón.
 *  Persisten en localStorage (sirven con o sin cuenta, en cualquier dispositivo
 *  donde el cliente los marque). Patrón idéntico a priceUnit. */
type FavState = {
  ids: number[]
  esFavorito: (id: number) => boolean
  toggle: (id: number) => boolean   // devuelve el nuevo estado (true = quedó marcado)
  count: number
}

const FavCtx = createContext<FavState | null>(null)
const KEY = 'remali_favoritos'

export function FavoritosProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : []
    } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* modo privado */ }
  }, [ids])

  const esFavorito = useCallback((id: number) => ids.includes(id), [ids])
  const toggle = useCallback((id: number) => {
    let quedaMarcado = false
    setIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      quedaMarcado = true
      return [...prev, id]
    })
    return quedaMarcado
  }, [])

  const value = useMemo(() => ({ ids, esFavorito, toggle, count: ids.length }), [ids, esFavorito, toggle])
  return <FavCtx.Provider value={value}>{children}</FavCtx.Provider>
}

export function useFavoritos() {
  const ctx = useContext(FavCtx)
  if (!ctx) throw new Error('useFavoritos debe usarse dentro de FavoritosProvider')
  return ctx
}
