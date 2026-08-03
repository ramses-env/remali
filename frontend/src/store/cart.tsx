import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'

/** Cada línea dice si es venta o renta (y con qué unidad). */
export type Modalidad = 'venta' | 'dia' | 'semana' | 'mes'
export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  venta: 'venta', dia: 'renta por día', semana: 'renta por semana', mes: 'renta por mes',
}

/** Regla de negocio: UNA cotización es de UN solo tipo (venta O renta). */
export const esVenta = (u?: Modalidad) => u === 'venta'
export function tipoCotizacion(items: { unit?: Modalidad }[]): 'venta' | 'renta' | null {
  if (!items.length) return null
  return esVenta(items[0].unit) ? 'venta' : 'renta'
}

// qty = cuántas MÁQUINAS; duracion = cuántos PERIODOS (días/semanas/meses) en
// renta. En venta la duración no aplica (queda en 1).
type Item = { lineId: number; id: number; title: string; price: number; qty: number; duracion?: number; image?: string; unit?: Modalidad }
type State = {
  items: Item[]
  coupon?: { code: string; discount: number }
  /** Intento de agregar un tipo distinto al de la cotización en curso: el
      reducer NO lo agrega; lo deja aquí para que el modal global pregunte
      si se empieza una cotización nueva. No se persiste. */
  conflicto?: Item
}

const STORAGE_KEY = 'remali_cart'
// El carrito persiste en localStorage para no perder la selección al refrescar.
function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.items)) return { items: parsed.items, coupon: parsed.coupon }
    }
  } catch { /* ignora storage corrupto */ }
  return { items: [] }
}
type Action =
  | { type: 'add'; item: Item }
  | { type: 'remove'; lineId: number }
  | { type: 'qty'; lineId: number; qty: number }
  | { type: 'duracion'; lineId: number; duracion: number }
  | { type: 'coupon'; code: string; discount: number }
  | { type: 'clear' }
  | { type: 'reemplazar'; items: Item[] }        // nueva cotización con estas líneas
  | { type: 'conflicto-aceptar' }                // vacía y agrega lo pendiente
  | { type: 'conflicto-cancelar' }               // conserva la cotización actual

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      // Una cotización no mezcla venta con renta: si el tipo choca, no se
      // agrega — queda pendiente para que el modal pregunte qué hacer.
      const tipo = tipoCotizacion(state.items)
      const nuevo = esVenta(action.item.unit) ? 'venta' : 'renta'
      if (tipo && tipo !== nuevo) return { ...state, conflicto: action.item }
      return { ...state, items: [...state.items, action.item] }
    }
    case 'remove':
      return { ...state, items: state.items.filter(i => i.lineId !== action.lineId) }
    case 'qty':
      return { ...state, items: state.items.map(i => i.lineId === action.lineId ? { ...i, qty: action.qty } : i) }
    case 'duracion':
      return { ...state, items: state.items.map(i => i.lineId === action.lineId ? { ...i, duracion: action.duracion } : i) }
    case 'coupon':
      return { ...state, coupon: { code: action.code, discount: action.discount } }
    case 'clear':
      return { items: [], coupon: state.coupon }
    case 'reemplazar':
      return { items: action.items, coupon: state.coupon }
    case 'conflicto-aceptar':
      return state.conflicto ? { items: [state.conflicto], coupon: state.coupon } : state
    case 'conflicto-cancelar':
      return { ...state, conflicto: undefined }
  }
}

const CartContext = createContext<{ state: State; dispatch: React.Dispatch<Action>; total: number } | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  useEffect(() => {
    try {
      // El conflicto es efímero (UI): no se persiste.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, coupon: state.coupon }))
    } catch { /* cuota llena, ignora */ }
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
