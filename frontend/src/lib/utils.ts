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
