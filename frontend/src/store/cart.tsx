import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'

/** Cada línea dice si es venta o renta (y con qué unidad): una misma cotización mezcla ambas. */
export type Modalidad = 'venta' | 'dia' | 'semana' | 'mes'
export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  venta: 'venta', dia: 'renta por día', semana: 'renta por semana', mes: 'renta por mes',
}

type Item = { lineId: number; id: number; title: string; price: number; qty: number; image?: string; unit?: Modalidad }
type State = { items: Item[]; coupon?: { code: string; discount: number } }

const STORAGE_KEY = 'remali_cart'
// El carrito persiste en localStorage para no perder la selección al refrescar.
function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.items)) return parsed
    }
  } catch { /* ignora storage corrupto */ }
  return { items: [] }
}
type Action =
  | { type: 'add'; item: Item }
  | { type: 'remove'; lineId: number }
  | { type: 'qty'; lineId: number; qty: number }
  | { type: 'coupon'; code: string; discount: number }
  | { type: 'clear' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      return { ...state, items: [...state.items, action.item] }
    }
    case 'remove':
      return { ...state, items: state.items.filter(i => i.lineId !== action.lineId) }
    case 'qty':
      return { ...state, items: state.items.map(i => i.lineId === action.lineId ? { ...i, qty: action.qty } : i) }
    case 'coupon':
      return { ...state, coupon: { code: action.code, discount: action.discount } }
    case 'clear':
      return { items: [] }
  }
}

const CartContext = createContext<{ state: State; dispatch: React.Dispatch<Action>; total: number } | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* cuota llena, ignora */ }
  }, [state])
  const total = useMemo(() => {
    const subtotal = state.items.reduce((s, i) => s + i.price * i.qty, 0)
    const discount = state.coupon ? subtotal * state.coupon.discount : 0
    return Math.max(0, subtotal - discount)
  }, [state])
  return <CartContext.Provider value={{ state, dispatch, total }}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('Cart context')
  return ctx
}
