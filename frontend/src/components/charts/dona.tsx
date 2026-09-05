/* Dona con cifra al centro.
 *
 * Reemplaza al `conic-gradient` que pintaba los indicadores. Aquel era una sola
 * pieza de CSS: no se podía señalar un tramo, ni separar dos que se tocan, ni
 * darle esquina redonda. Este es SVG con `pie`/`arc` de d3 (estructura de Rosen
 * Charts, MIT), así que cada tramo es un `path` propio: tiene globito, se
 * levanta al pasar encima y se recorre con el tabulador.
 *
 * El hueco es grande a propósito (radio interior ≈ 0.62): la dona no está para
 * comparar áreas —el ojo humano es malísimo para eso— sino para enseñar UNA
 * cifra grande al centro con su reparto alrededor. Las cifras exactas viven en
 * la leyenda de al lado, que es donde se leen.
 */
import { useId, useMemo, useState } from 'react'
import { arc, pie, type PieArcDatum } from 'd3-shape'
import { useTooltip } from './tooltip'
import { FilaTooltip, TituloTooltip } from './tooltip-piezas'

export type TramoDona = { clave: string; etiqueta: string; valor: number; color: string }

export default function Dona({
  datos, centroValor, centroEtiqueta, formato = (n: number) => String(n), tamano = 168, resumen,
}: {
  datos: TramoDona[]
  /** Lo que va en grande al centro (ya formateado: "72%", "$12,300"…). */
  centroValor: string
  centroEtiqueta: string
  formato?: (n: number) => string
  tamano?: number
  resumen: string
}) {
  const [activo, setActivo] = useState<string | null>(null)
  const { disparador, capa } = useTooltip()
  // Los `id` de los degradados y del filtro tienen que ser únicos en la página:
  // dos donas en la misma pantalla con el mismo id comparten relleno.
  const id = useId().replace(/:/g, '')

  const conValor = useMemo(() => datos.filter(d => d.valor > 0), [datos])
  const total = useMemo(() => conValor.reduce((a, d) => a + d.valor, 0), [conValor])

  // Geometría en unidades del viewBox; el tamaño real lo pone el contenedor.
  const R = 100
  const interior = R * 0.62

  const tramos = useMemo(() => {
    const layout = pie<TramoDona>()
      .value(d => d.valor)
      // El orden lo decide quien llama, no el tamaño: así el color de cada
      // estado no salta de lugar cuando cambia el inventario.
      .sort(null)
      // Separación entre tramos, salvo cuando hay UNO SOLO: un corte en un
      // anillo completo se lee como un error de dibujo, no como un dato.
      .padAngle(conValor.length > 1 ? 0.03 : 0)
    return layout(conValor)
  }, [conValor])

  const generador = useMemo(
    () => arc<PieArcDatum<TramoDona>>().innerRadius(interior).outerRadius(R).cornerRadius(3),
    [interior],
  )
  const generadorActivo = useMemo(
    () => arc<PieArcDatum<TramoDona>>().innerRadius(interior).outerRadius(R + 6).cornerRadius(3),
    [interior],
  )

  const globito = (d: TramoDona) => (
    <div className="min-w-[140px]">
      <TituloTooltip>{d.etiqueta}</TituloTooltip>
      <FilaTooltip color={d.color} etiqueta={total ? `${Math.round((d.valor / total) * 100)}%` : '—'}
        valor={formato(d.valor)} />
    </div>
  )

  return (
    <div className="relative mx-auto" style={{ width: tamano, height: tamano }}>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[30px] font-extrabold text-ink leading-none tabular-nums tracking-tight">{centroValor}</span>
        <span className="text-[10.5px] text-mute mt-1.5 uppercase tracking-[0.08em] font-semibold">{centroEtiqueta}</span>
      </div>

      <svg viewBox={`${-R - 10} ${-R - 10} ${(R + 10) * 2} ${(R + 10) * 2}`} className="w-full h-full dona-entra"
        role="img" aria-label={resumen}>
        <defs>
          {/* Un degradado por tramo, en diagonal: el color entero arriba y una
              versión aclarada abajo. Es el relieve que distingue una dona de un
              gráfico de pastel de hoja de cálculo. */}
          {tramos.map(t => (
            <linearGradient key={t.data.clave} id={`${id}-${t.data.clave}`} x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stopColor={t.data.color} />
              <stop offset="100%" stopColor={t.data.color} stopOpacity={0.72} />
            </linearGradient>
          ))}
          {/* Sombra suave por debajo del anillo. Muy corta y muy abierta: se
              nota como peso, no como una sombra dibujada. */}
          <filter id={`${id}-sombra`} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#000" floodOpacity="0.16" />
          </filter>
        </defs>

        {/* Aro de fondo: sin él, una dona vacía (todo en cero) no se ve y la
            tarjeta parece rota en vez de "todavía no hay nada". */}
        {!tramos.length && (
          <circle r={(R + interior) / 2} fill="none" strokeWidth={R - interior}
            className="text-surface-2" stroke="currentColor" />
        )}
        <g filter={tramos.length ? `url(#${id}-sombra)` : undefined}>
          {tramos.map(t => {
            const esActivo = activo === t.data.clave
            return (
              <path
                key={t.data.clave}
                d={(esActivo ? generadorActivo(t) : generador(t)) || undefined}
                fill={`url(#${id}-${t.data.clave})`}
                // Filo de luz sobre el propio tramo (truco de Rosen Charts): el
                // trazo translúcido se recorta contra el arco y deja un canto
                // brillante en el borde exterior, como una pieza con bisel.
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={2}
                tabIndex={0}
                role="button"
                aria-label={`${t.data.etiqueta}: ${formato(t.data.valor)}`}
                onMouseEnter={() => setActivo(t.data.clave)}
                onMouseLeave={() => setActivo(null)}
                onFocus={() => setActivo(t.data.clave)}
                onBlur={() => setActivo(null)}
                {...disparador(globito(t.data))}
                className="cursor-pointer outline-none transition-opacity duration-150 focus-visible:opacity-80"
                style={{ opacity: activo && !esActivo ? 0.5 : 1 }}
              />
            )
          })}
        </g>
      </svg>
      {capa}
    </div>
  )
}
