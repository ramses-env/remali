/* Área con degradado: cuántas máquinas estuvieron trabajando cada día.
 *
 * Aquí SÍ va curva y no columnas, al revés que en los ingresos, y la razón es
 * la naturaleza del dato: la ocupación es un estado CONTINUO —una máquina que
 * salió el lunes y volvió el viernes estuvo rentada los cinco días—, así que la
 * línea entre dos puntos existe de verdad. En los ingresos no: un día sin cobro
 * es un cero, no una interpolación.
 *
 * Estructura de Rosen Charts (MIT): `scaleTime` + `area`/`line` de d3 con
 * `preserveAspectRatio="none"` y `vectorEffect` para que el trazo no se
 * deforme al estirar el viewBox. Encima: guía vertical al pasar el ratón,
 * recorrido con flechas y tabla `sr-only`, igual que las columnas.
 */
import { useMemo, useState } from 'react'
import { area as d3area, line as d3line, curveMonotoneX } from 'd3-shape'
import { scaleLinear, scaleTime } from 'd3-scale'
import { useTooltip } from './tooltip'
import { FilaTooltip, TituloTooltip } from './tooltip-piezas'
import { diaLargo, fechaLocal } from './formato'

export type PuntoArea = { fecha: string; valor: number; techoDia?: number }

export default function Area({
  datos, color, etiquetaSerie, alto = 150, formato = (n: number) => String(n),
  formatoEjeX, resumen, tituloTabla,
}: {
  datos: PuntoArea[]
  color: string
  etiquetaSerie: string
  alto?: number
  formato?: (n: number) => string
  formatoEjeX?: (iso: string) => string
  resumen: string
  tituloTabla: string
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const { disparador, capa } = useTooltip()
  const id = useMemo(() => `area-${Math.random().toString(36).slice(2, 8)}`, [])

  const puntos = useMemo(() => datos.map(d => ({ ...d, dia: fechaLocal(d.fecha) })), [datos])

  const xScale = useMemo(() => scaleTime()
    .domain([puntos[0]?.dia ?? new Date(), puntos[puntos.length - 1]?.dia ?? new Date()])
    .range([0, 100]), [puntos])

  // El techo es la FLOTA, no el máximo de la serie: si el eje se ajustara al
  // pico, un día con 3 de 40 máquinas rentadas llenaría la gráfica y se leería
  // como "todo trabajando". Con la flota arriba, la altura significa ocupación.
  const tope = useMemo(
    () => Math.max(1, ...puntos.map(p => p.techoDia ?? p.valor)),
    [puntos],
  )
  const yScale = useMemo(() => scaleLinear().domain([0, tope]).range([100, 0]), [tope])

  const linea = useMemo(() => d3line<typeof puntos[number]>()
    .x(p => xScale(p.dia)).y(p => yScale(p.valor)).curve(curveMonotoneX)(puntos) ?? '', [puntos, xScale, yScale])
  const relleno = useMemo(() => d3area<typeof puntos[number]>()
    .x(p => xScale(p.dia)).y0(yScale(0)).y1(p => yScale(p.valor)).curve(curveMonotoneX)(puntos) ?? '', [puntos, xScale, yScale])

  const mover = (paso: number) => setActivo(prev => {
    const i = (prev == null ? puntos.length - 1 : prev) + paso
    return Math.max(0, Math.min(puntos.length - 1, i))
  })
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); mover(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1) }
    else if (e.key === 'Escape') setActivo(null)
  }

  // Con un solo punto no hay línea que trazar y la escala de tiempo colapsa
  // (dominio de ancho cero → NaN en cada coordenada).
  if (puntos.length < 2) return null

  const globito = (i: number) => (
    <div className="min-w-[160px]">
      <TituloTooltip><span className="first-letter:uppercase">{diaLargo(puntos[i].fecha)}</span></TituloTooltip>
      <FilaTooltip color={color} etiqueta={etiquetaSerie} valor={formato(puntos[i].valor)} />
    </div>
  )

  return (
    <div>
      <div className="flex gap-2">
      {/* Eje Y con el MISMO carril de 46px que las columnas: las tarjetas del
          Resumen se leen en bloque y sus áreas de dibujo tienen que empezar a la
          misma altura, o la vista se ve chueca. */}
      <div className="relative w-[46px] shrink-0" style={{ height: alto }}>
        {yScale.ticks(3).map(t => (
          <span key={t} className="absolute right-0 text-[11px] text-mute tabular-nums -translate-y-1/2"
            style={{ top: `${yScale(t)}%` }}>
            {t}
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
        style={{ height: alto }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible revela-derecha">
          <defs>
            {/* Tres paradas y no dos: con dos, el relleno baja en línea recta y
                se ve como un bloque de color. La caída rápida arriba y la cola
                larga abajo es lo que da el aire. */}
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="55%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
            <filter id={`${id}-halo`} x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>
          {/* Rejilla: cuatro pasos del color del borde. La del CERO entera, las
              demás a media tinta: es la única contra la que se mide. */}
          {yScale.ticks(4).map(t => (
            <line key={t} x1={0} x2={100} y1={yScale(t)} y2={yScale(t)}
              className="text-edge" stroke="currentColor" strokeWidth={1}
              strokeOpacity={t === 0 ? 1 : 0.55} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={relleno} fill={`url(#${id})`} />
          {/* Halo: la misma línea, gruesa y desenfocada por debajo. Da la
              sensación de luz propia sin engordar el trazo real. */}
          <path d={linea} fill="none" stroke={color} strokeWidth={5} strokeOpacity={0.28}
            filter={`url(#${id}-halo)`} vectorEffect="non-scaling-stroke" />
          <path d={linea} fill="none" stroke={color} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {activo != null && (
            <line x1={xScale(puntos[activo].dia)} x2={xScale(puntos[activo].dia)} y1={0} y2={100}
              stroke={color} strokeWidth={1} strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* El punto va en HTML y no en el SVG: con `preserveAspectRatio="none"`
            el viewBox se estira a lo ancho y un `<circle>` sale ovalado. */}
        {activo != null && (
          <span
            aria-hidden="true"
            className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${xScale(puntos[activo].dia)}%`,
              top: `${yScale(puntos[activo].valor)}%`,
              background: color,
              boxShadow: '0 0 0 2px var(--c-surface)',
            }}
          />
        )}

        {/* Carriles invisibles: un día es una franja, no un pixel. Sin esto hay
            que atinarle a la curva para que salga el globito. */}
        <div className="absolute inset-0 flex">
          {puntos.map((p, i) => (
            <div key={p.fecha} onMouseEnter={() => setActivo(i)} {...disparador(globito(i))}
              className="flex-1 h-full" />
          ))}
        </div>
      </div>

      </div>

      {formatoEjeX && (
        <div className="relative h-4 mt-1.5 ml-[54px]">
          {puntos.map((p, i) => {
            const ultimo = i === puntos.length - 1
            if (!(ultimo || i === 0 || i === Math.floor(puntos.length / 2))) return null
            return (
              <span key={p.fecha}
                className={`absolute text-[11px] whitespace-nowrap ${ultimo ? 'font-bold text-ink right-0' : 'text-mute -translate-x-1/2'}`}
                style={ultimo ? undefined : { left: `${xScale(p.dia)}%` }}>
                {formatoEjeX(p.fecha)}
              </span>
            )
          })}
        </div>
      )}

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
          <thead><tr><th>Día</th><th>{etiquetaSerie}</th></tr></thead>
          <tbody>
            {puntos.map(p => (
              <tr key={p.fecha}><th scope="row">{diaLargo(p.fecha)}</th><td>{formato(p.valor)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
