/**
 * Las cuentas de fechas de las hojas de detalle.
 *
 * Van en un archivo SIN JSX a propósito: en `hoja.tsx`, que exporta
 * componentes, una función suelta rompe el refresco en caliente de Vite
 * (`react-refresh/only-export-components`) y el panel deja de recargarse solo
 * al editar.
 */

/** "23 ago 2026, 9:17 p.m." — la fecha como se dicta, no como la serializa el
 *  backend. */
export const fechaLarga = (v: string) => {
  const d = new Date(v)
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}`
}

/** Días enteros entre dos momentos. `hasta` sin valor = hasta ahora. */
export function diasEntre(desde?: string | null, hasta?: string | null): number | null {
  if (!desde) return null
  const fin = hasta ? new Date(hasta).getTime() : Date.now()
  return Math.max(0, Math.floor((fin - new Date(desde).getTime()) / 86400000))
}

/** Días que le quedan de vida a una cotización. Negativo = ya venció. */
export function diasParaVencer(hasta?: string | null): number | null {
  if (!hasta) return null
  const fin = new Date(hasta).setHours(23, 59, 59, 999)
  return Math.ceil((fin - Date.now()) / 86400000)
}
