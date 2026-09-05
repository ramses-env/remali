/* El pie de página de las tablas del panel.
 *
 * Existe porque una lista sin paginar crece para siempre: a los dos años de
 * operación, "Por facturar" o "Reparaciones" son mil renglones que el navegador
 * pinta enteros —se siente pesado, el scroll no termina nunca y encontrar algo
 * es imposible—. Con esto la tabla siempre mide lo mismo y arriba queda dicho
 * cuántos hay en total.
 *
 * El dibujo salió de "Equipo", que ya lo tenía a mano: primera página, última y
 * las vecinas, con puntos suspensivos en medio. Con 31 páginas, pintar las 31
 * es una fila que nadie usa.
 *
 * Dos formas de usarlo, según de dónde salgan los datos:
 *
 *   · La lista viene COMPLETA del servidor (reparaciones, por facturar,
 *     inventario…): `usePaginado` corta el arreglo ya filtrado. Las cifras de
 *     arriba siguen contando sobre el total, que es lo correcto.
 *   · El servidor ya pagina (ventas, cotizaciones, clientes): se le pasan a
 *     mano `pagina`, `paginas` y `total`, y `onIr` pide la página nueva.
 */
import { type RefObject } from 'react'
import { POR_PAGINA, subirA } from './usar-paginado'

export default function Paginador({
  pagina, paginas, total, porPagina = POR_PAGINA, onIr, ancla, cargando, nombre = 'resultados',
}: {
  pagina: number
  paginas: number
  total: number
  porPagina?: number
  onIr: (n: number) => void
  ancla?: RefObject<HTMLElement | null>
  cargando?: boolean
  /** Cómo se llaman las cosas contadas: "resultados", "órdenes", "clientes"… */
  nombre?: string
}) {
  if (total <= 0) return null

  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)
  const ir = (n: number) => {
    const destino = Math.max(1, Math.min(paginas, n))
    if (destino === pagina) return
    onIr(destino)
    subirA(ancla)
  }

  // Los números que sirven: la primera, la última y las vecinas de la actual.
  const numeros = Array.from({ length: paginas }, (_, i) => i + 1)
    .filter(n => n === 1 || n === paginas || Math.abs(n - pagina) <= 1)

  return (
    <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-edge flex-wrap">
      <p className="text-[12.5px] text-mute tabular-nums">
        Mostrando <b className="text-ink">{desde}</b> a <b className="text-ink">{hasta}</b> de{' '}
        <b className="text-ink">{total}</b> {nombre}
      </p>

      {/* Con una sola página el texto de arriba ya lo dice todo; los botones
          serían tres controles apagados ocupando lugar. */}
      {paginas > 1 && (
        <nav className="flex items-center gap-1.5" aria-label="Paginación">
          <button onClick={() => ir(pagina - 1)} disabled={pagina <= 1 || cargando}
            className="h-9 px-3.5 rounded-full border border-edge text-[12.5px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-40 transition-colors">
            Anterior
          </button>
          {numeros.map((n, i, arr) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - arr[i - 1] > 1 && <span className="text-mute text-[12.5px]">…</span>}
              <button onClick={() => ir(n)} disabled={cargando}
                aria-current={n === pagina ? 'page' : undefined}
                aria-label={`Página ${n}`}
                className={`w-9 h-9 rounded-full text-[12.5px] font-bold transition-colors ${n === pagina ? 'bg-gold text-gold-on' : 'text-mute hover:text-ink hover:bg-surface-2'}`}>
                {n}
              </button>
            </span>
          ))}
          <button onClick={() => ir(pagina + 1)} disabled={pagina >= paginas || cargando}
            className="h-9 px-3.5 rounded-full border border-edge text-[12.5px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-40 transition-colors">
            Siguiente
          </button>
        </nav>
      )}
    </div>
  )
}
