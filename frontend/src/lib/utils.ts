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

/** "DEMOLICIÓN" → "Demolición", "DEMOLEDOR 11 KG" → "Demoledor 11 Kg".
 *  Para mostrar en Título nombres que en la data vienen en MAYÚSCULAS (categorías,
 *  modelos). Deja los conectores en minúscula (de, del, la…) para que se lea natural. */
export function tituloCaso(texto: string | null | undefined): string {
  const conectores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'a', 'en', 'con', 'el'])
  return (texto || '').trim().toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && conectores.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Teléfono: SOLO dígitos y máximo 10 (los de México son de 10). Úsalo en el
 *  onChange de todo input de teléfono para que no admita letras ni de más. */
export function soloTelefono(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '').slice(0, 10)
}

/** true si el teléfono ya tiene los 10 dígitos exactos. */
export function telefonoValido(v: string | null | undefined): boolean {
  return soloTelefono(v).length === 10
}

/** Email SIEMPRE en minúsculas y sin espacios (no existen correos con espacios).
 *  Úsalo en el onChange de todo input de correo: nunca se guarda en MAYÚSCULAS. */
export function normalizarEmail(v: string | null | undefined): string {
  return (v || '').replace(/\s+/g, '').toLowerCase()
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
