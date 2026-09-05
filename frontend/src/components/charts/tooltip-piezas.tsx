/* Las dos piezas con las que se arma el contenido de un globito.
 *
 * Viven aparte del hook a propósito: un archivo que exporta COMPONENTES y
 * además otra cosa rompe el recargado en caliente de Vite (y su regla de
 * eslint lo dice). `tooltip.tsx` exporta el hook; esto, los componentes.
 */
import type { ReactNode } from 'react'

/** Renglón de un globito: puntito de color, etiqueta y cifra. */
export function FilaTooltip({ color, etiqueta, valor }: {
  color: string; etiqueta: string; valor: string
}) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
      <span className="text-mute">{etiqueta}</span>
      <span className="ml-auto font-bold text-ink tabular-nums">{valor}</span>
    </div>
  )
}

/** Cabecera del globito (el día, el mes, el modelo…). */
export function TituloTooltip({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12.5px] font-bold text-ink border-b border-edge pb-1.5 mb-1.5 whitespace-nowrap">
      {children}
    </div>
  )
}
