import { useLayoutEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import type { TLine, Zona } from '../lib/escpos'

/**
 * El papel del ticket, dibujado a partir del MISMO modelo de líneas que se
 * manda a la impresora. Lo usan la vista previa del cobro y el configurador,
 * así que hay un solo lugar donde el ticket "se ve": si aquí sale bien, sale
 * bien en las dos pantallas y en el papel.
 *
 * El color no es negro sobre blanco: el papel térmico es tibio y la tinta es
 * carbón, no tinta. Copiarlo hace que el admin juzgue el contraste real.
 */

// Borde dentado (papel "roto") inferior del ticket.
export const ZIG = (() => {
  const teeth = 26, tw = 100 / teeth
  let d = 'M0 0 H100'
  for (let i = teeth - 1; i >= 0; i--) d += ` L${((i + 0.5) * tw).toFixed(2)} 6 L${(i * tw).toFixed(2)} 0`
  return d + ' Z'
})()

/** CSS de la rejilla del papel. `W` = caracteres por línea (32 o 48). */
export const paperCss = (W: number) => `
.ticket { box-sizing: content-box; font-family: 'IBM Plex Mono','Courier New', ui-monospace, monospace; white-space: pre;
  color: #1c1a17; background: #fffdf7; width: ${W}ch; font-size: calc(12.5px * var(--tk-zoom, 1)); line-height: 1.15;
  padding: 3mm 2.5mm; letter-spacing: -0.2px; }
.ticket .tl { min-height: 0.9em; }
.ticket .b { font-weight: 700; }
.ticket .c { text-align: center; }
.ticket .r { text-align: right; }
.ticket .big { font-size: 1.95em; font-weight: 800; line-height: 1; letter-spacing: -0.5px; }
.ticket .gap { height: 0.3em; }
.ticket .bc { height: auto; margin: 4px auto 1px; display: block; max-width: 92%; }
/* El logo ya viene en 1 bit: 'pixelated' evita que el navegador lo suavice y
   enseñe una nitidez que la impresora no tiene. */
.ticket .lg { display: block; margin: 0 auto 2px; image-rendering: pixelated; max-width: 100%; }

/* Señalar en el papel lo que el admin acaba de tocar. Entra rápido (ve el
   cambio) y se va despacio (no distrae). No es movimiento, así que no molesta
   a quien pidió menos animación: solo se le quitan las transiciones. */
.ticket .tl, .ticket .lg, .ticket .bc { transition: background-color 640ms cubic-bezier(0.23, 1, 0.32, 1); }
.ticket .on { background-color: rgba(255, 198, 26, .42); transition-duration: 90ms; }
@media (prefers-reduced-motion: reduce) {
  .ticket .tl, .ticket .lg, .ticket .bc { transition: none; }
}

.tk-paper { position: relative; }
.tk-paper .tear { display: block; width: 100%; height: 6px; margin-top: -1px; }

/* Regla de milímetros: recuerda que el papel mide lo que mide. */
.tk-regla { position: relative; height: 13px; width: 100%;
  background-image: repeating-linear-gradient(to right, var(--c-mute, #8a8a8a) 0 1px, transparent 1px 10%);
  opacity: .45; }
.tk-regla::after { content: ''; position: absolute; inset: auto 0 0 0; height: 1px; background: currentColor; opacity: .5; }
`

type Props = {
  lineas: TLine[]
  width: number                 // caracteres por línea
  zoom?: number
  className?: string
  /** Dentado del corte al pie. Se apaga al imprimir: ahí lo corta la máquina. */
  adornos?: boolean
  innerRef?: React.Ref<HTMLDivElement>
  style?: React.CSSProperties
  /** Zona a señalar en el papel mientras el admin la está editando. */
  resaltar?: Zona | null
  /** Ancho del papel en mm: dibuja el ticket a su tamaño FÍSICO en vez de al de pantalla. */
  tamanoReal?: 58 | 80
}

export default function TicketPaper({ lineas, width, zoom = 1, className = '', adornos = true, innerRef, style, resaltar, tamanoReal }: Props) {
  const bcRef = useRef<SVGSVGElement>(null)
  const bc = lineas.find(l => l.k === 'bc') as { k: 'bc'; v: string } | undefined

  /* Ancho REAL del código, no uno decorativo: la impresora dibuja cada módulo
     con 2 puntos de cabezal (GS w 2), y un CODE128-B gasta 11 módulos por
     carácter más el arranque, el verificador y el cierre. Calcularlo así hace
     que en pantalla ocupe la misma franja de papel que va a ocupar impreso. */
  const puntos = width >= 48 ? 576 : 384
  const anchoBc = bc ? Math.min(92, ((11 * (bc.v.length + 2) + 13) * 2 / puntos) * 100) : 0

  // useLayoutEffect y no useEffect: el código se dibuja antes de pintar, así no
  // se ve el hueco vacío saltar a su tamaño final.
  useLayoutEffect(() => {
    const svg = bcRef.current
    if (!bc?.v || !svg) return
    try {
      // Fondo transparente: JsBarcode pinta por defecto un rectángulo BLANCO
      // PURO que se nota como un parche sobre el papel tibio (y tapaba el
      // resaltado de la zona). El papel de abajo es el fondo correcto.
      JsBarcode(svg, bc.v, { format: 'CODE128', displayValue: true, fontSize: 13, height: 32, margin: 0, width: 1.5, lineColor: '#1c1a17', background: 'transparent' })
      // JsBarcode fija width/height en atributos y no pone viewBox: al ajustarlo
      // por CSS el dibujo se RECORTA en vez de escalar. Se lo damos nosotros.
      // parseFloat y no el atributo tal cual: JsBarcode los escribe como "135px"
      // y un viewBox con unidades es inválido — el navegador lo ignora en
      // silencio, el SVG pierde su proporción y se planta en 150 px de alto.
      const w = parseFloat(svg.getAttribute('width') || ''), h = parseFloat(svg.getAttribute('height') || '')
      if (w > 0 && h > 0) {
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        svg.removeAttribute('width'); svg.removeAttribute('height')
      }
    } catch { /* folio no representable: se queda sin código y el ticket sirve igual */ }
    // `lineas.length` entra a propósito: al encender el logo la lista crece y
    // el <svg> puede reconciliarse de nuevo; sin esto el código quedaría en blanco.
  }, [bc?.v, width, zoom, lineas.length])

  return (
    <div ref={innerRef} className={`tk-paper ${className}`} style={{ ['--tk-zoom' as string]: zoom, ...style }}>
      <div className="ticket" style={tamanoReal ? {
        // El papel de 58 mm imprime sobre 53: los 5 mm restantes son el margen
        // que el cabezal no alcanza, y son justo el padding del ticket.
        width: `calc(${tamanoReal}mm - 5mm)`,
        fontSize: `calc((${tamanoReal}mm - 5mm) / ${width} / 0.6)`,
      } : undefined}>
        {lineas.map((ln, i) => {
          const on = !!resaltar && ln.z === resaltar ? ' on' : ''
          if (ln.k === 'hr') return <div key={i} className={`tl${on}`}>{(ln.heavy ? '=' : '-').repeat(width)}</div>
          if (ln.k === 'sp') return <div key={i} className="gap" />
          if (ln.k === 'bc') return <svg key="bc" ref={bcRef} className={`bc${on}`} style={{ width: `${anchoBc}%` }} role="img" aria-label={`Código de barras ${ln.v}`} />
          if (ln.k === 'logo') return <img key="logo" className={`lg${on}`} src={ln.src} alt="Logo del negocio" style={{ width: `${ln.escala}%` }} />
          return <div key={i} className={`tl${on} ${ln.b ? 'b' : ''} ${ln.big ? 'big' : ''} ${ln.a === 'c' ? 'c' : ln.a === 'r' ? 'r' : ''}`}>{ln.t || ' '}</div>
        })}
      </div>
      {adornos && <svg className="tear" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden><path d={ZIG} fill="#fffdf7" /></svg>}
    </div>
  )
}
