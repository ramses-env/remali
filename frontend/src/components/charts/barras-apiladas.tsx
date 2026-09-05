/* Columnas apiladas: la gráfica de trabajo del panel.
 *
 * La usan los ingresos por día (30 columnas, renta sobre venta) y los ingresos
 * por mes (6 columnas, las mismas dos series). Antes eran dos bloques de JSX
 * distintos —uno con eje y otro sin— y la de meses ni siquiera separaba renta
 * de venta aunque el dato ya venía separado.
 *
 * Estructura tomada de Rosen Charts (MIT): escalas de d3, rejilla en SVG con
 * `vectorEffect="non-scaling-stroke"` (la línea mide lo mismo aunque el
 * viewBox se estire) y barras en `div` para que el redondeo y las transiciones
 * sean CSS. Encima va lo que el panel ya tenía y una librería no da:
 *
 *  · Recorrido con FLECHAS. 30 columnas serían 30 paradas de tabulador; aquí el
 *    área es UNA parada y las flechas caminan los datos, como una tabla.
 *  · Tabla `sr-only` con las mismas cifras: el globito enriquece, nunca es la
 *    única puerta al número.
 *  · Techo del eje con escalera fina (ver `techo`), para no dejar media gráfica
 *    en blanco.
 *
 * Por qué COLUMNAS y no un área suave: el ingreso diario es un dato discreto
 * —lo que entró ese día— y en maquinaria la mayoría de los días son cero. Una
 * curva interpola entre días que no existieron: se ve mejor y miente.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { scaleBand, scaleLinear } from 'd3-scale'
import { useTooltip } from './tooltip'
import { FilaTooltip, TituloTooltip } from './tooltip-piezas'
import { dinero, dineroCorto, techo } from './formato'

export type SerieBarra = { clave: string; etiqueta: string; color: string }
export type PuntoBarra = {
  /** Identidad de la columna (la fecha ISO, el mes…). */
  clave: string
  /** Lo que se escribe bajo la columna. Vacío = no se etiqueta. */
  etiquetaX?: string
  /** Cómo se nombra en el globito y en la tabla del lector de pantalla. */
  titulo: string
  valores: Record<string, number>
}

export default function BarrasApiladas({
  datos, series, alto = 190, formato = dinero, formatoEje = dineroCorto,
  anchoMaxBarra = 26, etiquetaMaximo = true, resumen, tituloTabla,
}: {
  datos: PuntoBarra[]
  series: SerieBarra[]
  /** Alto del área de dibujo en px (sin ejes). */
  alto?: number
  formato?: (n: number) => string
  formatoEje?: (n: number) => string
  anchoMaxBarra?: number
  /** Escribe la cifra sobre la columna más alta. Una etiqueta, no treinta. */
  etiquetaMaximo?: boolean
  /** Descripción del conjunto para lector de pantalla. */
  resumen: string
  tituloTabla: string
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const { disparador, capa } = useTooltip()
  // De arriba hacia abajo se pinta la última serie primero, para que la primera
  // quede en la BASE de la pila (renta abajo, venta encima).
  const seriesArriba = useMemo(() => [...series].reverse(), [series])

  const { totales, tope, mejor } = useMemo(() => {
    const totales = datos.map(d => series.reduce((a, s) => a + (d.valores[s.clave] || 0), 0))
    const max = Math.max(0, ...totales)
    let mejor = -1
    totales.forEach((t, i) => { if (t > 0 && t === max && mejor < 0) mejor = i })
    return { totales, tope: techo(max), mejor }
  }, [datos, series])

  // Escalas de d3. `scaleBand` reparte el ancho con su aire entre columnas;
  // `scaleLinear` invertida (100 → 0) convierte pesos en porcentaje de altura.
  const xScale = useMemo(
    () => scaleBand().domain(datos.map(d => d.clave)).range([0, 100]).padding(datos.length > 12 ? 0.28 : 0.42),
    [datos],
  )
  const yScale = useMemo(
    () => scaleLinear().domain([0, tope || 1]).range([100, 0]),
    [tope],
  )
  const guias = useMemo(() => yScale.ticks(4), [yScale])

  const mover = (paso: number) => setActivo(prev => {
    const i = (prev == null ? datos.length - 1 : prev) + paso
    return Math.max(0, Math.min(datos.length - 1, i))
  })
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); mover(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(0) }
    else if (e.key === 'End') { e.preventDefault(); setActivo(datos.length - 1) }
    else if (e.key === 'Escape') setActivo(null)
  }

  const globito = (i: number) => (
    <div className="min-w-[150px]">
      <TituloTooltip>{datos[i].titulo}</TituloTooltip>
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
    <div>
      <div className="flex gap-2" style={{ '--alto-plot': `${alto}px` } as CSSProperties}>
        {/* Eje Y: cifras redondas. Cargan los valores que no se etiquetan. */}
        <div className="relative w-[46px] shrink-0" style={{ height: 'var(--alto-plot)' }}>
          {guias.map(g => (
            <span key={g} className="absolute right-0 text-[11px] text-mute tabular-nums -translate-y-1/2"
              style={{ top: `${yScale(g)}%` }}>
              {formatoEje(g)}
            </span>
          ))}
        </div>

        <div
          tabIndex={0}
          role="img"
          aria-label={resumen}
          onKeyDown={teclas}
          onMouseLeave={() => setActivo(null)}
          onBlur={() => setActivo(null)}
          className="relative flex-1 min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          style={{ height: 'var(--alto-plot)' }}
        >
          {/* Rejilla. Línea SÓLIDA, nunca punteada: el punteado se lee como
              "proyección" y esto son datos ya cobrados. Las intermedias van a
              media tinta y la del CERO entera: es la única contra la que se mide
              una altura, las demás solo ayudan a estimar. */}
          <svg className="absolute inset-0 w-full h-full overflow-visible text-edge" viewBox="0 0 100 100"
            preserveAspectRatio="none" aria-hidden="true">
            {guias.map(g => (
              <line key={g} x1={0} x2={100} y1={yScale(g)} y2={yScale(g)}
                stroke="currentColor" strokeWidth={1} strokeOpacity={g === 0 ? 1 : 0.55}
                vectorEffect="non-scaling-stroke" />
            ))}
          </svg>

          {/* Columnas */}
          {datos.map((d, i) => {
            const esActivo = activo === i
            const apagado = activo != null && !esActivo
            return (
              <div
                key={d.clave}
                onMouseEnter={() => setActivo(i)}
                {...disparador(globito(i))}
                className="absolute bottom-0 top-0 flex flex-col justify-end items-center cursor-pointer"
                style={{ left: `${xScale(d.clave)}%`, width: `${xScale.bandwidth()}%` }}
              >
                {esActivo && (
                  <span aria-hidden="true" className="absolute inset-y-0 -inset-x-[1px] rounded-md"
                    style={{ background: 'linear-gradient(to top, var(--c-gold-soft), transparent 85%)' }} />
                )}
                <div className="relative w-full flex flex-col justify-end h-full mx-auto"
                  style={{ maxWidth: anchoMaxBarra }}>
                  {seriesArriba.map((s, idx) => {
                    const v = d.valores[s.clave] || 0
                    if (v <= 0) return null
                    // El primer tramo con valor es el de más arriba: solo ese
                    // lleva las esquinas redondeadas, o la pila se ve partida.
                    const arriba = idx === seriesArriba.findIndex(x => (d.valores[x.clave] || 0) > 0)
                    return (
                      <div
                        key={s.clave}
                        style={{
                          height: `${tope ? (v / tope) * 100 : 0}%`,
                          // Degradado vertical: la barra se aclara hacia abajo.
                          // Es lo que separa un rectángulo de color de una barra
                          // con volumen, y de paso deja respirar la base cuando
                          // dos series se apilan.
                          background: `linear-gradient(to bottom, ${s.color}, color-mix(in srgb, ${s.color} 72%, transparent))`,
                          // Filo de luz arriba: un pixel translúcido que hace de
                          // canto. Sin él las dos series se ven pegadas.
                          boxShadow: arriba ? 'inset 0 1px 0 rgba(255,255,255,0.34)' : 'inset 0 1px 0 rgba(255,255,255,0.16)',
                          opacity: apagado ? 0.4 : 1,
                          // Escalonado con tope: 30 columnas × 18 ms serían más
                          // de medio segundo de espera para ver la última.
                          '--retraso': `${Math.min(i, 24) * 16}ms`,
                        } as CSSProperties}
                        className={`w-full barra-sube transition-opacity duration-150 ${arriba ? 'rounded-t-[5px]' : ''}`}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Etiqueta directa, UNA sola: la columna más alta. Un número sobre
              cada una sería ruido y nadie lo lee. */}
          {etiquetaMaximo && mejor >= 0 && activo == null && (
            <span
              className="absolute text-[11px] font-bold text-ink tabular-nums -translate-x-1/2 -translate-y-full pointer-events-none whitespace-nowrap rounded-full border border-edge bg-surface px-2 py-0.5 shadow-[0_2px_10px_rgba(17,24,39,0.10)]"
              style={{
                left: `${(xScale(datos[mejor].clave) ?? 0) + xScale.bandwidth() / 2}%`,
                top: `${yScale(totales[mejor])}%`,
                marginTop: -6,
              }}
            >
              {formato(totales[mejor])}
            </span>
          )}
        </div>
      </div>

      {/* Eje X */}
      <div className="flex gap-2 mt-2">
        <div className="w-[46px] shrink-0" />
        <div className="relative flex-1 min-w-0 h-4">
          {datos.map((d, i) => d.etiquetaX ? (
            <span
              key={d.clave}
              className={`absolute text-[11px] whitespace-nowrap -translate-x-1/2 ${i === datos.length - 1 ? 'font-bold text-ink' : 'text-mute'}`}
              style={{ left: `${(xScale(d.clave) ?? 0) + xScale.bandwidth() / 2}%` }}
            >
              {d.etiquetaX}
            </span>
          ) : null)}
        </div>
      </div>

      {capa}

      {/* Los mismos datos en tabla, para lector de pantalla. */}
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
              <th>Periodo</th>
              {series.map(s => <th key={s.clave}>{s.etiqueta}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {datos.map((d, i) => (
              <tr key={d.clave}>
                <th scope="row">{d.titulo}</th>
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
