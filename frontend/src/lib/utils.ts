import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Une clases de Tailwind resolviendo las que se contradicen.
 *
 * Antes solo concatenaba. El problema: los componentes de shadcn traen clases
 * propias y encima reciben `className`, así que `h-10` + `h-8` acababan las dos
 * en el DOM y ganaba la que estuviera después en el CSS, no la que pidió quien
 * usa el componente. `twMerge` deja solo la última de cada conflicto.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** '1200', 1200 o null → número o null. La API manda los decimales como string. */
export function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : null
  if (n === null || Number.isNaN(n)) return null
  return n
}

/** Moneda con SIEMPRE dos decimales — mismo formato en pantalla, carta y PDF.
 *  (Sin maximumFractionDigits un total con 3+ decimales imprimía distinto.) */
export function formatMoney(n: number | string | null | undefined): string {
  const v = toNumber(n) ?? 0
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
