import type { Modalidad } from '../store/cart'

/* ── Borradores de cotización del cliente ──────────────────────────────────
   Viven SOLO en el navegador del cliente (localStorage). El armador de
   cotizaciones (Cotizacion.tsx) los crea; esta lib los comparte con "Mis
   cotizaciones" para poder listarlos, calcular su total, enviarlos y borrarlos
   desde un mismo lugar. El folio nace al ENVIAR, nunca antes: un borrador no
   existe para el sistema. */

/** Una línea del borrador = una línea del carrito (misma forma que store/cart). */
export type LineaBorrador = {
  lineId: number
  id: number
  title: string
  price: number
  qty: number
  duracion?: number
  image?: string
  unit?: Modalidad
}

export type Borrador = {
  id: number
  nombre: string
  items: LineaBorrador[]
  coupon?: { code: string; discount: number }
  creado: string
}

const CLAVE = 'remali_borradores'
/** Tope de seguridad: mismo que aplica el armador al guardar. */
export const MAX_BORRADORES = 8
/** Vigencia: los precios de un borrador valen lo mismo que una cotización
 *  (cotizaciones/models.py → vigencia_dias default 15). Pasados los días, el
 *  total mostrado quedó viejo; el borrador NO se borra (igual que una cotización
 *  vencida) y al enviarlo el servidor recalcula precios. */
export const VIGENCIA_BORRADOR_DIAS = 15

/** Días transcurridos desde que se guardó el borrador. */
export function diasBorrador(b: Borrador): number {
  const t = new Date(b.creado).getTime()
  if (Number.isNaN(t)) return 0
  return Math.floor((Date.now() - t) / 86_400_000)
}

/** ¿Sus precios ya "vencieron" (>15 días)? No lo borra: solo lo marca. */
export function borradorVencido(b: Borrador): boolean {
  return diasBorrador(b) > VIGENCIA_BORRADOR_DIAS
}

export function leerBorradores(): Borrador[] {
  try {
    const bs = JSON.parse(localStorage.getItem(CLAVE) || '[]')
    return Array.isArray(bs) ? bs.filter((b): b is Borrador => !!b && Array.isArray(b.items)) : []
  } catch {
    return []
  }
}

export function guardarBorradores(bs: Borrador[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(bs))
  } catch {
    /* cuota llena: el borrador se queda en memoria durante la sesión */
  }
}

/** Borra un borrador y devuelve la lista resultante. */
export function eliminarBorrador(id: number): Borrador[] {
  const bs = leerBorradores().filter(b => b.id !== id)
  guardarBorradores(bs)
  return bs
}

const periodos = (i: LineaBorrador) => (i.unit && i.unit !== 'venta') ? (i.duracion || 1) : 1
const importe = (i: LineaBorrador) => i.price * i.qty * periodos(i)

/** Total con el MISMO espejo del backend (cotizaciones/models.py): los precios
 *  de VENTA ya incluyen IVA; los de RENTA van sin IVA (el borrador todavía no
 *  sabe si se pedirá factura). El cupón se descuenta sobre el subtotal. */
export function totalBorrador(b: Borrador): number {
  const sub = b.items.reduce((s, i) => s + importe(i), 0)
  const desc = b.coupon ? sub * b.coupon.discount : 0
  return Math.max(0, sub - desc)
}

export function esVentaBorrador(b: Borrador): boolean {
  return (b.items[0]?.unit || 'venta') === 'venta'
}

/** "N equipos · Nombre (+k)" para la meta de la fila. La cuenta usa el número de
 *  líneas (igual que el nombre autogenerado del armador). */
export function resumenBorrador(b: Borrador): string {
  const n = b.items.length
  const nombres = [...new Set(b.items.map(i => i.title))]
  const equipos = nombres.length === 1 ? nombres[0]
    : nombres.length > 1 ? `${nombres[0]} +${nombres.length - 1}`
    : 'Sin equipos'
  return `${n} equipo${n === 1 ? '' : 's'} · ${equipos}`
}
