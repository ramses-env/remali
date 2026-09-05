import { useLayoutEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { COLS, anchoLegible, medirColumnas, money, type TLine, type Zona } from '../lib/escpos'

/**
 * El papel del ticket, dibujado a partir del MISMO modelo de líneas que se
 * manda a la impresora. Lo usan la vista previa del cobro y el configurador,
 * así que hay un solo lugar donde el ticket "se ve": si aquí sale bien, sale
 * bien en las dos pantallas, en el PDF y en el diálogo de impresión.
 *
 * Aquí la letra es PROPORCIONAL y las columnas son columnas de verdad: es el
 * ticket que ve el cliente en pantalla y el que sale del navegador. La térmica
 * sin driver imprime lo mismo y en el mismo orden, pero con su rejilla de
 * caracteres, que es lo único que sabe hacer (ver `gridTicket`).
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

/** Ancho en pantalla del área impresa, según el papel. `W` = caracteres por línea (32 o 48). */
const anchoPreview = (W: number) => (W >= 44 ? 344 : 248)

/** CSS del papel. `W` = caracteres por línea (32 o 48): decide el ancho base. */
export const paperCss = (W: number) => `
/* Todo el ticket se escala desde UNA medida: el ancho del área impresa. El
   cuerpo de letra sale de dividirla, así que el ticket de 58 y el de 80 mm se
   ven con la misma proporción y a 1:1 miden lo que mide el papel. */
.ticket { box-sizing: content-box; width: calc(${anchoPreview(W)}px * var(--tk-zoom, 1));
  font-family: 'Figtree', 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: calc(var(--tk-cw, ${anchoPreview(W)}px * var(--tk-zoom, 1)) / 19);
  color: #14120f; background: #fffdf7; padding: 4mm 3mm; line-height: 1.32;
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }

/* Encabezado */
.ticket .nm { font-size: 1.62em; font-weight: 800; text-align: center; line-height: 1.12; letter-spacing: -0.015em; }
.ticket .sb { font-size: 1.06em; font-weight: 700; text-align: center; line-height: 1.25; margin-top: .1em; }
.ticket .tt { font-size: .82em; font-weight: 800; text-align: center; text-transform: uppercase;
  letter-spacing: .14em; margin: .1em 0 .55em; }

/* Filas etiqueta / valor: la etiqueta pesa, el dato se lee a la derecha. */
.ticket .rw { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; padding: .09em 0; }
.ticket .rw > b { font-weight: 700; white-space: nowrap; }
.ticket .rw > span { text-align: right; min-width: 0; }

/* Tabla de conceptos: UNA rejilla para todo el bloque. Las tres columnas de
   números se miden solas (auto) con la cifra más larga del ticket, y lo que
   sobra es del nombre; los renglones se disuelven en la rejilla para que las
   columnas queden alineadas de arriba abajo. */
.ticket .tbl { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; column-gap: .55em; margin-top: .85em; }
.ticket .th, .ticket .it { display: contents; }
.ticket .th > * { font-size: .78em; font-weight: 800; letter-spacing: .04em; padding-bottom: .42em;
  border-bottom: 1.5px solid currentColor; }
.ticket .it > * { padding: .5em 0; }
.ticket .it ~ .it > * { border-top: 1px dotted #14120f66; }
.ticket .th > *:not(:first-child), .ticket .it > *:not(:first-child) { text-align: right; white-space: nowrap; }
/* El nombre parte la palabra antes que invadir la columna de al lado: un
   "Retroexcavadora" encimado sobre el precio no se puede leer. */
.ticket .th > *:first-child, .ticket .it > *:first-child { overflow-wrap: anywhere; }
.ticket .dt { display: block; font-size: .84em; opacity: .65; line-height: 1.2; white-space: normal; font-weight: 400; }

/* Conceptos sin tabla: cuando los números se llevan el renglón, el nombre se
   queda con todo el ancho y la cuenta baja abajo. */
.ticket .lista { margin-top: .85em; }
.ticket .th2 { display: flex; justify-content: space-between; font-size: .78em; font-weight: 800;
  letter-spacing: .04em; padding-bottom: .42em; border-bottom: 1.5px solid currentColor; }
.ticket .lista > * + * { border-top: 1px dotted #14120f66; }
.ticket .lista > * { padding: .5em 0; }
.ticket .lista .n2 { font-weight: 600; }
.ticket .lista .c2 { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; }
.ticket .lista .c2 > span:first-child { opacity: .75; }
.ticket .lista .c2 > span:last-child { font-weight: 700; white-space: nowrap; }

/* Totales: el fuerte manda, los demás acompañan. */
.ticket .tot { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; padding: .1em 0; }
.ticket .tot.f { font-size: 1.5em; font-weight: 800; letter-spacing: -0.01em; padding: .12em 0; }

.ticket .ln { text-align: left; }
.ticket .ln.c { text-align: center; }
.ticket .ln.r { text-align: right; }
.ticket .ln.b { font-weight: 700; }
.ticket .hr { border: 0; border-top: 1.4px dashed #14120f; opacity: .55; margin: .62em 0; }
.ticket .hr.hv { opacity: .85; }
.ticket .gap { height: .5em; }
.ticket .bc { height: auto; margin: .7em auto .1em; display: block; max-width: 92%; }
/* El logo ya viene en 1 bit: 'pixelated' evita que el navegador lo suavice y
   enseñe una nitidez que la impresora no tiene. */
.ticket .lg { display: block; margin: 0 auto .35em; image-rendering: pixelated; max-width: 100%; }

/* Señalar en el papel lo que el admin acaba de tocar. Entra rápido (ve el
   cambio) y se va despacio (no distrae). No es movimiento, así que no molesta
   a quien pidió menos animación: solo se le quitan las transiciones. */
.ticket > *, .ticket .th > *, .ticket .it > * { transition: background-color 640ms cubic-bezier(0.23, 1, 0.32, 1); }
.ticket .on, .ticket .on > * { background-color: rgba(255, 198, 26, .42); transition-duration: 90ms; }
@media (prefers-reduced-motion: reduce) {
  .ticket > *, .ticket .th > *, .ticket .it > * { transition: none; }
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
      JsBarcode(svg, bc.v, { format: 'CODE128', displayValue: true, fontSize: 13, height: 32, margin: 0, width: 1.5, lineColor: '#14120f', background: 'transparent' })
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

  // El ancho del área impresa: en 1:1 son los milímetros del papel menos el
  // margen que el cabezal no alcanza; si no, el ancho de pantalla escalado.
  const cw = tamanoReal ? `calc(${tamanoReal}mm - 6mm)` : `calc(${anchoPreview(width)}px * ${zoom})`

  /* La tabla de conceptos es UNA rejilla, no un renglón por concepto: solo así
     las cuatro columnas se miden con la cifra más larga del ticket y quedan
     alineadas entre sí. Por eso el encabezado y los conceptos que le siguen se
     agrupan aquí antes de dibujar. */
  const bloques: (TLine | { k: 'tabla'; items: Extract<TLine, { k: 'item' }>[]; z?: Zona })[] = []
  for (const ln of lineas) {
    const ultimo = bloques[bloques.length - 1]
    if (ln.k === 'item' && ultimo && 'items' in ultimo) { ultimo.items.push(ln); continue }
    if (ln.k === 'cols') { bloques.push({ k: 'tabla', items: [], z: ln.z }); continue }
    bloques.push(ln)
  }

  /* Las columnas se deciden con los mismos números que en el papel, solo que
     contando los caracteres que caben a esta letra: si el nombre se quedara sin
     lugar, mejor lista que tabla apretada. */
  const cuatro = medirColumnas(
    lineas.filter(l => l.k === 'item') as Extract<TLine, { k: 'item' }>[],
    anchoLegible(width),
  ).cuatro

  return (
    <div ref={innerRef} className={`tk-paper ${className}`} style={{ ['--tk-zoom' as string]: zoom, ...style }}>
      <div className="ticket" style={{ ['--tk-cw' as string]: cw, width: cw }}>
        {bloques.map((ln, i) => {
          const on = !!resaltar && ln.z === resaltar ? ' on' : ''
          switch (ln.k) {
            case 'tabla': return cuatro ? (
              <div key={i} className="tbl">
                <div className={`th${on}`}>
                  <span>{COLS.nombre}</span><span>{COLS.cant}</span><span>{COLS.unit}</span><span>{COLS.imp}</span>
                </div>
                {ln.items.map((it, j) => (
                  <div key={j} className={`it${!!resaltar && it.z === resaltar ? ' on' : ''}`}>
                    <span>{it.nombre}{it.detalle && <span className="dt">{it.detalle}</span>}</span>
                    <span>{it.cant}</span><span>{money(it.unit)}</span><span>{money(it.imp)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div key={i} className="lista">
                <div className={`th2${on}`}><span>{COLS.nombre}</span><span>{COLS.imp}</span></div>
                {ln.items.map((it, j) => (
                  <div key={j} className={!!resaltar && it.z === resaltar ? 'on' : undefined}>
                    <div className="n2">{it.nombre}{it.detalle && <span className="dt">{it.detalle}</span>}</div>
                    <div className="c2">
                      <span>{it.cant && it.unit ? `${it.cant} × ${money(it.unit)}` : ''}</span>
                      <span>{money(it.imp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
            case 'hr': return <hr key={i} className={`hr${ln.heavy ? ' hv' : ''}${on}`} />
            case 'sp': return <div key={i} className="gap" />
            case 'bc': return <svg key="bc" ref={bcRef} className={`bc${on}`} style={{ width: `${anchoBc}%` }} role="img" aria-label={`Código de barras ${ln.v}`} />
            case 'logo': return <img key="logo" className={`lg${on}`} src={ln.src} alt="Logo del negocio" style={{ width: `${ln.escala}%` }} />
            case 'name': return <div key={i} className={`nm${on}`}>{ln.t}</div>
            case 'sub': return <div key={i} className={`sb${on}`}>{ln.t}</div>
            case 'titulo': return <div key={i} className={`tt${on}`}>{ln.t}</div>
            case 'row': return <div key={i} className={`rw${on}`}><b>{ln.l}</b><span>{ln.r}</span></div>
            case 'total': return (
              <div key={i} className={`tot${ln.fuerte ? ' f' : ''}${on}`}>
                <span>{ln.l}</span><span>{money(ln.v)}</span>
              </div>
            )
            case 'text': return <div key={i} className={`ln${on} ${ln.b ? 'b' : ''} ${ln.a === 'c' ? 'c' : ln.a === 'r' ? 'r' : ''}`}>{ln.t || ' '}</div>
            // 'cols' e 'item' ya salieron dibujados dentro de su tabla.
            default: return null
          }
        })}
      </div>
      {adornos && <svg className="tear" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden><path d={ZIG} fill="#fffdf7" /></svg>}
    </div>
  )
}
