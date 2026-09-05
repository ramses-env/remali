/* Lo que toda gráfica necesita antes de dibujar: fechas que no se corran de día
 * y cifras que un humano lea. Vivía dentro de `grafica-ingresos.tsx`; ahora que
 * hay más de una gráfica, vive aquí. */

/** 'YYYY-MM-DD' → Date LOCAL. `new Date('2026-08-22')` la interpreta en UTC y
 *  en México se corre un día: la gráfica quedaría desfasada respecto al panel. */
export function fechaLocal(iso: string) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, (m || 1) - 1, d || 1)
}

export const diaCorto = (iso: string) =>
  fechaLocal(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '')

export const diaLargo = (iso: string) =>
  fechaLocal(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

/** Pesos redondos. Los centavos en una gráfica son ruido: nadie compara $12.35. */
export const dinero = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

/** Pesos en corto, para ejes angostos: $18k, $1.2M. El eje es una referencia,
 *  no el dato; el dato exacto lo da el globito. */
export function dineroCorto(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + 'M'
  if (abs >= 1_000) return '$' + (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + 'k'
  return '$' + Math.round(n)
}

/**
 * Techo del eje en un número redondo, para que las guías digan cifras que un
 * humano lee ($0 / $20,000 / $40,000) y no $37,412.50.
 *
 * Escalera FINA a propósito. Con una gruesa (1·2·5·10) un pico de $56,200
 * empuja el techo a $100,000 y la barra más alta se queda a media altura:
 * media gráfica en blanco y todos los días chicos aplastados. Es la razón por
 * la que no se usa `.nice()` de d3, que es exactamente la escalera gruesa.
 */
export function techo(max: number) {
  if (max <= 0) return 0
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  for (const paso of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const t = paso * exp
    if (t >= max) return t
  }
  return 10 * exp
}
