import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import api from '../lib/api'
import { usePrintSettings, charsPerLine } from '../lib/printSettings'
import { buildTicket, layoutTicket, type Comprobante } from '../lib/escpos'
import { imprimirTermico, metodoSoportado } from '../lib/printer'

// Borde dentado (papel "roto") inferior del ticket.
const ZIG = (() => {
  const teeth = 26, tw = 100 / teeth
  let d = 'M0 0 H100'
  for (let i = teeth - 1; i >= 0; i--) d += ` L${((i + 0.5) * tw).toFixed(2)} 6 L${(i * tw).toFixed(2)} 0`
  return d + ' Z'
})()

const ANIM_MS = 1900

// El preview y la impresión salen del MISMO modelo de líneas (rejilla de W
// caracteres monoespaciados) → se ven igual. En pantalla se escala para leerse.
const PRINT_CSS = (mm: number, W: number) => `
.ticket { box-sizing: content-box; font-family: 'IBM Plex Mono','Courier New', ui-monospace, monospace; white-space: pre;
  color: #111; background: #fff; width: ${W}ch; font-size: 12.5px; line-height: 1.15; padding: 3mm 2.5mm; letter-spacing: -0.2px; }
.ticket .tl { min-height: 0.9em; }
.ticket .b { font-weight: 700; }
.ticket .c { text-align: center; }
.ticket .r { text-align: right; }
.ticket .big { font-size: 1.95em; font-weight: 800; line-height: 1; letter-spacing: -0.5px; }
.ticket .gap { height: 0.3em; }
.ticket .bc { width: 82%; height: auto; margin: 4px auto 1px; display: block; }

/* ── Escena de impresión (animación tipo Clip) ── */
.stage { position: relative; display: flex; flex-direction: column; align-items: center; }
.printer { position: relative; width: calc(${W}ch + 30px); height: 34px; margin-bottom: -4px; z-index: 3;
  border-radius: 10px 10px 5px 5px; background: linear-gradient(#42424c,#22222a); box-shadow: 0 10px 20px rgba(0,0,0,.32); }
.printer::before { content:''; position:absolute; left:14px; right:14px; bottom:5px; height:5px; background:#0b0b0e; border-radius:3px; box-shadow: inset 0 1px 3px #000; }
.printer::after { content:''; position:absolute; top:10px; right:18px; width:7px; height:7px; border-radius:50%; background:#3ad07a; box-shadow:0 0 8px #3ad07a; animation: tkled 1s infinite alternate; }
@keyframes tkled { from { opacity:.35 } to { opacity:1 } }
.paper { position: relative; z-index: 1; filter: drop-shadow(0 6px 10px rgba(0,0,0,.18)); }
.paper .tear { display:block; width:100%; height:6px; margin-top:-1px; }
/* El papel se EXTRUYE: crece hacia abajo saliendo de la ranura (encabezado
   primero), a velocidad constante, como una térmica real. */
.paper.feeding { overflow: hidden; will-change: height; animation: tkextrude ${ANIM_MS}ms linear both; }
@keyframes tkextrude { from { height: 0 } to { height: var(--ph, 800px) } }
.paper.feeding::before { content:''; position:absolute; top:0; left:0; right:0; height:14px; z-index:4; pointer-events:none;
  background: linear-gradient(#00000038, #0000000f 55%, transparent); }
.paper.feeding .ticket { animation: tkjitter .09s steps(2,end) infinite; }
@keyframes tkjitter { 0% { transform: translateX(-.4px) } 100% { transform: translateX(.4px) } }

@media print {
  body > #root { display: none !important; }
  .tk-overlay { position: static !important; inset: auto !important; background: #fff !important; backdrop-filter: none !important; padding: 0 !important; display: block !important; }
  .tk-card { border: 0 !important; border-radius: 0 !important; max-width: none !important; width: auto !important; box-shadow: none !important; overflow: visible !important; }
  .tk-scroll { max-height: none !important; overflow: visible !important; background: #fff !important; padding: 0 !important; display: block !important; }
  .tk-actions, .tk-head, .printer, .paper .tear, .paper.feeding::before { display: none !important; }
  .paper, .paper.feeding, .paper.feeding .ticket { animation: none !important; height: auto !important; overflow: visible !important; transform: none !important; filter: none !important; }
  .ticket { box-sizing: content-box !important; width: calc(${mm}mm - 3mm) !important; font-size: calc((${mm}mm - 3mm) / ${W} / 0.6) !important; padding: 0 1.5mm !important; box-shadow: none !important; }
  @page { size: ${mm}mm auto; margin: 0; }
}
`

export default function TicketModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [data, setData] = useState<Comprobante | null>(null)
  const [error, setError] = useState(false)
  const [settings, setSettings] = usePrintSettings()
  const [estado, setEstado] = useState<{ tipo: 'idle' | 'ok' | 'err'; msg?: string }>({ tipo: 'idle' })
  const [imprimiendo, setImprimiendo] = useState(false)
  const [animando, setAnimando] = useState(false)
  const [paperH, setPaperH] = useState(800)
  const bcRef = useRef<SVGSVGElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const mm = settings.thermalWidth
  const W = charsPerLine(mm)
  const neg = settings.negocio
  const lineas = data ? layoutTicket(data, { width: W, negocio: neg }) : []

  // Duración de la animación = largo FÍSICO del ticket (mm) ÷ velocidad de la
  // impresora (mm/s). Así coincide con la impresión real; se calibra en Ajustes.
  const LH = 3.8 // alto aproximado de una línea impresa, en mm
  const altoMm = lineas.reduce((a, l) =>
    a + (l.k === 'bc' ? 9 : l.k === 'sp' ? LH * 0.6 : (l.k === 'text' && l.big ? LH * 2 : LH)), 0) + LH * 3.5 // + avance/corte final
  const durMs = Math.min(6000, Math.max(600, Math.round((altoMm / (settings.printSpeed || 70)) * 1000)))

  useEffect(() => {
    let vivo = true
    api.get<Comprobante>(url.replace(/^\/api(?=\/)/, ''))
      .then(r => { if (vivo) setData(r.data) })
      .catch(() => { if (vivo) setError(true) })
    return () => { vivo = false }
  }, [url])

  useEffect(() => {
    if (!data?.folio || !bcRef.current) return
    try { JsBarcode(bcRef.current, data.folio, { format: 'CODE128', displayValue: true, fontSize: 13, height: 32, margin: 0, width: 1.5 }) } catch { /* noop */ }
  }, [data, mm, animando])

  const puedeTermica = settings.method !== 'navegador' && metodoSoportado(settings.method)

  async function imprimirTermica() {
    if (!data) return
    // Mide la altura real del papel para que la extrusión llegue justo a su fin.
    const h = paperRef.current?.scrollHeight || 800
    setPaperH(h)
    setImprimiendo(true); setEstado({ tipo: 'idle' }); setAnimando(true)
    const finAnim = new Promise(res => setTimeout(res, durMs))
    try {
      const bytes = buildTicket(data, { width: W, negocio: neg })
      await imprimirTermico(bytes, { method: settings.method, baud: settings.baud })
      await finAnim
      setEstado({ tipo: 'ok', msg: '✓ Impreso' })
    } catch (e: any) {
      await finAnim
      setEstado({ tipo: 'err', msg: e?.name === 'NotFoundError' ? 'No se seleccionó impresora.' : (e?.message || 'No se pudo imprimir.') })
    } finally {
      setImprimiendo(false); setAnimando(false)
    }
  }

  return createPortal(
    <div className="tk-overlay fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="tk-card bg-surface border border-edge rounded-2xl overflow-hidden w-full flex flex-col max-h-[88vh]" style={{ maxWidth: mm >= 80 ? 420 : 360 }} onClick={e => e.stopPropagation()}>
        <div className="tk-head flex items-center justify-between gap-2 px-3 py-2 border-b border-edge bg-surface">
          <span className="text-[11px] font-semibold text-mute uppercase tracking-wide">Vista previa {mm}mm</span>
          <div className="flex gap-1">
            {([58, 80] as const).map(w => (
              <button key={w} disabled={animando} onClick={() => setSettings({ thermalWidth: w })}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 ${mm === w ? 'bg-gold text-black' : 'bg-surface-2 text-mute hover:text-ink'}`}>{w}mm</button>
            ))}
          </div>
        </div>

        <div className="tk-scroll flex-1 overflow-y-auto bg-neutral-300 p-4 flex justify-center">
          {error && <p className="text-sm text-red-500 py-8">No se pudo cargar el comprobante.</p>}
          {!error && !data && <p className="text-sm text-neutral-600 py-8">Cargando…</p>}
          {data && (
            <div className="stage">
              {animando && <div className="printer" aria-hidden />}
              <div ref={paperRef} className={`paper ${animando ? 'feeding' : ''}`} style={animando ? ({ animationDuration: `${durMs}ms`, '--ph': `${paperH}px` } as React.CSSProperties) : undefined}>
                <div className="ticket">
                  {lineas.map((ln, i) => {
                    if (ln.k === 'hr') return <div key={i} className="tl">{(ln.heavy ? '=' : '-').repeat(W)}</div>
                    if (ln.k === 'sp') return <div key={i} className="gap" />
                    if (ln.k === 'bc') return <svg key={i} ref={bcRef} className="bc" />
                    return <div key={i} className={`tl ${ln.b ? 'b' : ''} ${ln.big ? 'big' : ''} ${ln.a === 'c' ? 'c' : ln.a === 'r' ? 'r' : ''}`}>{ln.t || ' '}</div>
                  })}
                </div>
                <svg className="tear" viewBox="0 0 100 6" preserveAspectRatio="none"><path d={ZIG} fill="#fff" /></svg>
              </div>
            </div>
          )}
        </div>

        {estado.tipo !== 'idle' && (
          <div className={`tk-head px-3 py-2 text-[12px] font-medium ${estado.tipo === 'ok' ? 'text-emerald-600 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>{estado.msg}</div>
        )}

        <div className="tk-actions flex flex-col gap-2 p-3 border-t border-edge bg-surface">
          <div className="flex gap-2">
            {puedeTermica ? (
              <button onClick={imprimirTermica} disabled={!data || imprimiendo} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {imprimiendo ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : '🖨'}
                {imprimiendo ? 'Imprimiendo…' : 'Imprimir (sin driver)'}
              </button>
            ) : (
              <div className="flex-1 text-[11px] text-mute self-center px-2">Configura la impresora en Ajustes → Impresión. Mientras, usa PDF/Diálogo →</div>
            )}
            <button onClick={() => window.print()} disabled={!data || animando} title="Imprime con el diálogo del navegador o guarda PDF" className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50">PDF / Diálogo</button>
          </div>
          <button onClick={onClose} className="py-2 rounded-full text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
        </div>
      </div>
      <style>{PRINT_CSS(mm, W)}</style>
    </div>,
    document.body
  )
}
