import { useMemo } from 'react'
import BarrasApiladas, { type PuntoBarra, type SerieBarra } from '../../components/charts/barras-apiladas'
import { diaCorto, diaLargo, dinero } from '../../components/charts/formato'

/* Ingresos de los últimos 30 días, separando RENTA de VENTA.

   Por qué esta gráfica y no otra: el panel ya tiene los ingresos por mes y el
   inventario por estado. Lo que faltaba era el mes en curso con textura de día
   — "¿cómo vamos?" se contesta viendo qué días entró dinero, no un promedio. Y
   separado por renta/venta porque son dos motores distintos: la renta gotea
   todos los días, la venta llega de golpe. Sumarlas en una sola línea esconde
   justo lo que el dueño necesita ver.

   El dibujo (escalas, rejilla, columnas, globito, recorrido con flechas y tabla
   para lector de pantalla) vive en `components/charts/barras-apiladas`, que es
   el mismo que pinta los ingresos por mes. Aquí queda lo que es de ESTA
   tarjeta: el encabezado, la comparación contra el tramo previo, el reparto del
   periodo y el estado vacío.

   Los colores están validados (daltonismo, banda de luminosidad y contraste
   contra las dos superficies). Viven en index.css como --chart-renta/venta y
   no cambian entre temas a propósito. */

export type DiaIngreso = { fecha: string; ventas: number; rentas: number; total: number }

const RENTA = 'var(--chart-renta)'
const VENTA = 'var(--chart-venta)'

/** Renta ABAJO en la pila: es el ingreso que se repite mes con mes, el piso del
 *  negocio. La venta va encima porque es lo que varía.
 *
 *  Se exporta porque el Resumen pinta las MISMAS dos series en los ingresos por
 *  mes y en el ranking de equipos. Que el azul sea siempre renta y el ocre
 *  siempre venta —en las tres— es lo que permite mirar el bloque completo sin
 *  releer una leyenda por tarjeta. */
export const SERIES_INGRESO: SerieBarra[] = [
  { clave: 'rentas', etiqueta: 'Rentas', color: RENTA },
  { clave: 'ventas', etiqueta: 'Ventas', color: VENTA },
]

export default function GraficaIngresos({ dias, previo, panel }: {
  dias: DiaIngreso[]
  previo: number
  panel: string
}) {
  const { total, sumaRentas, sumaVentas, max } = useMemo(() => ({
    total: dias.reduce((a, d) => a + d.total, 0),
    sumaRentas: dias.reduce((a, d) => a + d.rentas, 0),
    sumaVentas: dias.reduce((a, d) => a + d.ventas, 0),
    max: Math.max(0, ...dias.map(d => d.total)),
  }), [dias])

  // Fechas: una de cada cinco, y la última —que es hoy—. Treinta etiquetas se
  // encimarían y ninguna se leería.
  const puntos: PuntoBarra[] = useMemo(() => dias.map((d, i) => ({
    clave: d.fecha,
    etiquetaX: (i === dias.length - 1 || (i % 5 === 0 && i < dias.length - 3)) ? diaCorto(d.fecha) : undefined,
    titulo: diaLargo(d.fecha),
    valores: { rentas: d.rentas, ventas: d.ventas },
  })), [dias])

  if (!dias.length) return null

  const desde = dias[0].fecha, hasta = dias[dias.length - 1].fecha
  const vacia = max <= 0 || total <= 0

  // Comparativo contra el tramo anterior. Sin tramo previo NO se inventa un
  // porcentaje: "primer periodo" es la verdad, "+100%" sería un adorno.
  const hayPrevio = previo > 0
  const deltaPct = hayPrevio ? Math.round(((total - previo) / previo) * 100) : 0
  const subio = deltaPct >= 0

  return (
    <div className={`${panel} p-5`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-base font-extrabold text-ink">Ingresos de los últimos 30 días</div>
          <div className="text-[13px] text-mute mt-1">Lo que de verdad se cobró, día por día</div>
        </div>
        <span className="text-[12px] font-semibold text-mute bg-app border border-edge rounded-full px-3 py-1.5 whitespace-nowrap">
          Del {diaCorto(desde)} al {diaCorto(hasta)}
        </span>
      </div>

      {/* La cifra que se lee primero, y contra qué se compara. */}
      <div className="flex items-end gap-3 flex-wrap mb-5">
        <div className="text-[30px] font-extrabold text-ink leading-none tabular-nums">{dinero(total)}</div>
        {hayPrevio ? (
          <div className={`text-[13px] font-bold mb-0.5 ${subio ? 'text-[#1F7A4D] dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {subio ? '▲' : '▼'} {Math.abs(deltaPct)}%
            <span className="text-mute font-semibold"> vs. los 30 días previos</span>
          </div>
        ) : (
          <div className="text-[13px] font-semibold text-mute mb-0.5">Primer periodo con movimiento</div>
        )}
      </div>

      {/* De dónde vino el dinero DEL PERIODO. Existe porque en un día con una
          venta grande la franja de renta mide tres pixeles: en la serie diaria
          esa proporción no se puede leer, y en una sola barra sí. Y hace de
          leyenda, que con dos series siempre debe haber. */}
      {!vacia && (
        <div className="mb-4">
          <div className="flex h-2 rounded-full overflow-hidden bg-surface-2" role="img"
            aria-label={`Del total, ${dinero(sumaRentas)} son rentas y ${dinero(sumaVentas)} ventas`}>
            {sumaRentas > 0 && <div style={{ width: `${(sumaRentas / total) * 100}%`, background: RENTA }} className={sumaVentas > 0 ? 'mr-[2px]' : ''} />}
            {sumaVentas > 0 && <div style={{ width: `${(sumaVentas / total) * 100}%`, background: VENTA }} />}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {[{ c: RENTA, l: 'Rentas', v: sumaRentas }, { c: VENTA, l: 'Ventas', v: sumaVentas }].map(s => (
              <div key={s.l} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.c }} />
                <span className="text-[12.5px] font-bold text-ink tabular-nums">{dinero(s.v)}</span>
                <span className="text-[12.5px] text-mute">{s.l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vacia ? (
        <div className="h-[186px] grid place-items-center text-center border border-dashed border-edge rounded-xl">
          <div>
            <div className="text-[14px] font-bold text-ink">Sin ingresos en estos 30 días</div>
            <div className="text-[12.5px] text-mute mt-1">Cuando se cobre una renta o una venta, aparece aquí.</div>
          </div>
        </div>
      ) : (
        <BarrasApiladas
          datos={puntos}
          series={SERIES_INGRESO}
          alto={170}
          anchoMaxBarra={24}
          resumen={`Ingresos diarios del ${diaLargo(desde)} al ${diaLargo(hasta)}. Total ${dinero(total)}. Usa las flechas para recorrer los días.`}
          tituloTabla={`Ingresos por día, del ${diaLargo(desde)} al ${diaLargo(hasta)}`}
        />
      )}
    </div>
  )
}
