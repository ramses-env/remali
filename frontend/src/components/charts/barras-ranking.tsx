/* Ranking con barra: qué equipo trajo más dinero.
 *
 * Barras HORIZONTALES y no columnas porque lo que se compara son NOMBRES, y un
 * nombre escrito de lado no se lee: en columnas verticales las etiquetas
 * terminan giradas 45°, que es el vicio clásico del tablero. Aquí el nombre va
 * en su renglón, alineado a la izquierda, y la barra crece hacia la derecha.
 *
 * La barra va apilada por origen (renta / venta) porque un modelo que produce
 * $80,000 rentándose no es el mismo negocio que uno que produce $80,000
 * vendiéndose una vez: la mezcla es la mitad del dato.
 *
 * Estructura de Rosen Charts (MIT), simplificada: sin eje de valores. En un
 * ranking de seis renglones el eje no aporta —la cifra va escrita al final de
 * cada barra— y quita ancho a los nombres, que es lo escaso.
 */
import { useMemo, type CSSProperties } from 'react'
import { scaleLinear } from 'd3-scale'
import { useTooltip } from './tooltip'
import { FilaTooltip, TituloTooltip } from './tooltip-piezas'
import type { SerieBarra } from './barras-apiladas'
import { dinero } from './formato'

export type FilaRanking = { clave: string; etiqueta: string; nota?: string; valores: Record<string, number> }

export default function BarrasRanking({
  datos, series, formato = dinero, resumen, tituloTabla,
}: {
  datos: FilaRanking[]
  series: SerieBarra[]
  formato?: (n: number) => string
  resumen: string
  tituloTabla: string
}) {
  const { disparador, capa } = useTooltip()

  const totales = useMemo(
    () => datos.map(d => series.reduce((a, s) => a + (d.valores[s.clave] || 0), 0)),
    [datos, series],
  )
  const xScale = useMemo(
    () => scaleLinear().domain([0, Math.max(1, ...totales)]).range([0, 100]),
    [totales],
  )

  const globito = (i: number) => (
    <div className="min-w-[160px]">
      <TituloTooltip>{datos[i].etiqueta}</TituloTooltip>
      <div className="text-[15px] font-extrabold text-ink tabular-nums mb-1.5">{formato(totales[i])}</div>
      <div className="flex flex-col gap-1">
        {series.map(s => (
          <FilaTooltip key={s.clave} color={s.color} etiqueta={s.etiqueta}
            valor={formato(datos[i].valores[s.clave] || 0)} />
        ))}
      </div>
    </div>
  )

  return (
    <div role="img" aria-label={resumen}>
      <div className="flex flex-col gap-3">
        {datos.map((d, i) => (
          <div key={d.clave} {...disparador(globito(i))} className="group cursor-default">
            <div className="flex items-baseline gap-2 mb-1.5">
              {/* El lugar del ranking, en su ficha. Es la diferencia entre una
                  lista con barras y un PODIO: el 1 se ve antes de leer nada. */}
              <span className={`shrink-0 w-[18px] h-[18px] rounded-md grid place-items-center text-[10.5px] font-black tabular-nums self-center ${i === 0 ? 'bg-gold text-gold-on' : 'bg-surface-2 text-mute'}`}>
                {i + 1}
              </span>
              <span className="text-[13px] font-bold text-ink truncate">{d.etiqueta}</span>
              {d.nota && <span className="text-[11.5px] text-mute truncate">{d.nota}</span>}
              <span className="ml-auto text-[13px] font-extrabold text-ink tabular-nums shrink-0">
                {formato(totales[i])}
              </span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-2 ml-[26px]">
              {/* Un solo carril: los tramos suman el ancho de la barra, y el
                  resto queda como fondo para que se lea contra qué se compara. */}
              <div className="flex h-full barra-crece rounded-full overflow-hidden"
                style={{ width: `${xScale(totales[i])}%`, '--retraso': `${i * 70}ms` } as CSSProperties}>
                {series.map(s => {
                  const v = d.valores[s.clave] || 0
                  if (v <= 0 || totales[i] <= 0) return null
                  return (
                    <div
                      key={s.clave}
                      style={{
                        width: `${(v / totales[i]) * 100}%`,
                        background: `linear-gradient(to bottom, color-mix(in srgb, ${s.color} 88%, white), ${s.color})`,
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30)',
                      }}
                      className="h-full"
                    />
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      {capa}

      {/* La tabla va DENTRO de un div.sr-only, no lleva la clase ella misma.
          Un elemento con `display: table` trata `width`/`height` como MÍNIMOS,
          no como medidas: el `1px × 1px` de sr-only no le hace nada y la tabla
          crece con su contenido. Como además es `position: absolute` no empuja
          a nadie —así que no se ve—, pero sí cuenta para el área de scroll del
          documento: cuatro de estas estiraban el panel de 1,000 a 2,417 px de
          alto, y se podía seguir bajando por un vacío negro sin fin.
          El div es `display: block`, ahí el 1×1 sí manda y recorta la tabla. */}
      <div className="sr-only">
        <table>
          <caption>{tituloTabla}</caption>
          <thead>
            <tr>
              <th>Equipo</th>
              {series.map(s => <th key={s.clave}>{s.etiqueta}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {datos.map((d, i) => (
              <tr key={d.clave}>
                <th scope="row">{d.etiqueta}</th>
                {series.map(s => <td key={s.clave}>{formato(d.valores[s.clave] || 0)}</td>)}
                <td>{formato(totales[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
