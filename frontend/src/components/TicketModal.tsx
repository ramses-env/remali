import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { createPortal } from 'react-dom'
import api from '../lib/api'
import { usePrintSettings, charsPerLine } from '../lib/printSettings'
import { buildTicket, layoutTicket, altoTicketMm, type Comprobante } from '../lib/escpos'
import { imprimirTermico, metodoSoportado } from '../lib/printer'
import TicketPaper, { paperCss } from './TicketPaper'

const ANIM_MS = 1900

// El preview y la impresión salen del MISMO modelo de líneas (rejilla de W
// caracteres monoespaciados) → se ven igual. En pantalla se escala para leerse.
const PRINT_CSS = (mm: number, W: number) => `
${paperCss(W)}

/* ── Escena de impresión (animación tipo Clip) ── */
.stage { position: relative; display: flex; flex-direction: column; align-items: center; }
.printer { position: relative; width: var(--pw, 260px); height: 34px; margin-bottom: -4px; z-index: 3;
  border-radius: 10px 10px 5px 5px; background: linear-gradient(#42424c,#22222a); box-shadow: 0 10px 20px rgba(0,0,0,.32); }
.printer::before { content:''; position:absolute; left:14px; right:14px; bottom:5px; height:5px; background:#0b0b0e; border-radius:3px; box-shadow: inset 0 1px 3px #000; }
.printer::after { content:''; position:absolute; top:10px; right:18px; width:7px; height:7px; border-radius:50%; background:#3ad07a; box-shadow:0 0 8px #3ad07a; animation: tkled 1s infinite alternate; }
@keyframes tkled { from { opacity:.35 } to { opacity:1 } }
.paper { z-index: 1; filter: drop-shadow(0 6px 10px rgba(0,0,0,.18)); }
/* El papel se EXTRUYE: crece hacia abajo saliendo de la ranura (encabezado
   primero), a velocidad constante, como una térmica real. */
.paper.feeding { overflow: hidden; will-change: height; animation: tkextrude ${ANIM_MS}ms linear both; }
@keyframes tkextrude { from { height: 0 } to { height: var(--ph, 800px) } }
.paper.feeding::before { content:''; position:absolute; top:0; left:0; right:0; height:14px; z-index:4; pointer-events:none;
  background: linear-gradient(#00000038, #0000000f 55%, transparent); }
.paper.feeding .ticket { animation: tkjitter .09s steps(2,end) infinite; }
@keyframes tkjitter { 0% { transform: translateX(-.4px) } 100% { transform: translateX(.4px) } }
@media (prefers-reduced-motion: reduce) {
  .paper.feeding, .paper.feeding .ticket, .printer::after { animation: none !important; height: auto !important; }
}

@media print {
  body > #root { display: none !important; }
  .tk-overlay { position: static !important; inset: auto !important; background: #fff !important; backdrop-filter: none !important; padding: 0 !important; display: block !important; }
  .tk-card { border: 0 !important; border-radius: 0 !important; max-width: none !important; width: auto !important; box-shadow: none !important; overflow: visible !important; }
  .tk-scroll { max-height: none !important; overflow: visible !important; background: #fff !important; padding: 0 !important; display: block !important; }
  .tk-actions, .tk-head, .printer, .tk-paper .tear, .paper.feeding::before { display: none !important; }
  .paper, .paper.feeding, .paper.feeding .ticket { animation: none !important; height: auto !important; overflow: visible !important; transform: none !important; filter: none !important; }
  .ticket { box-sizing: content-box !important; width: calc(${mm}mm - 3mm) !important; font-size: calc((${mm}mm - 3mm) / ${W} / 0.6) !important; padding: 0 1.5mm !important; box-shadow: none !important; background: #fff !important; }
  @page { size: ${mm}mm auto; margin: 0; }
}
`

const VISTAS = ['100', '140', '180', 'real'] as const

export default function TicketModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [data, setData] = useState<Comprobante | null>(null)
  const [error, setError] = useState(false)
  const [settings, setSettings] = usePrintSettings()
  const [estado, setEstado] = useState<{ tipo: 'idle' | 'ok' | 'err'; msg?: string }>({ tipo: 'idle' })
  const [imprimiendo, setImprimiendo] = useState(false)
  const [animando, setAnimando] = useState(false)
  const [paperH, setPaperH] = useState(800)
  const [paperW, setPaperW] = useState(260)
  const [vista, setVista] = useState<typeof VISTAS[number]>('100')
  const zoom = vista === 'real' ? 1 : Number(vista) / 100
  const paperRef = useRef<HTMLDivElement>(null)
  const mm = settings.thermalWidth
  const W = charsPerLine(mm)
  const neg = settings.negocio
  const lineas = data ? layoutTicket(data, { width: W, negocio: neg, ticket: settings.ticket }) : []

  // Duración de la animación = largo FÍSICO del ticket (mm) ÷ velocidad de la
  // impresora (mm/s). Así coincide con la impresión real; se calibra en Ajustes.
  const durMs = Math.min(6000, Math.max(600, Math.round((altoTicketMm(lineas) / (settings.printSpeed || 70)) * 1000)))

  useEffect(() => {
    let vivo = true
    api.get<Comprobante>(url.replace(/^\/api(?=\/)/, ''))
      .then(r => { if (vivo) setData(r.data) })
      .catch(() => { if (vivo) setError(true) })
    return () => { vivo = false }
  }, [url])

  const puedeTermica = settings.method !== 'navegador' && metodoSoportado(settings.method)

  async function imprimirTermica() {
    if (!data) return
    // Mide la altura real del papel para que la extrusión llegue justo a su fin.
    const h = paperRef.current?.scrollHeight || 800
    setPaperH(h); setPaperW((paperRef.current?.offsetWidth || 230) + 30)
    setImprimiendo(true); setEstado({ tipo: 'idle' }); setAnimando(true)
    const finAnim = new Promise(res => setTimeout(res, durMs))
    try {
      const bytes = await buildTicket(data, { width: W, negocio: neg, ticket: settings.ticket })
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

  const chip = (activo: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 ${activo ? 'bg-gold text-black' : 'bg-surface-2 text-mute hover:text-ink'}`

  return createPortal(
    <Modal className="tk-overlay modal-in fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClose={onClose} label="Ticket de la venta">
      <div className="tk-card bg-surface border border-edge rounded-2xl overflow-hidden w-full flex flex-col max-h-[88vh]" style={{ maxWidth: mm >= 80 ? 460 : 400 }} onClick={e => e.stopPropagation()}>
        <div className="tk-head flex items-center justify-between gap-2 px-3 py-2 border-b border-edge bg-surface">
          <span className="text-[11px] font-semibold text-mute uppercase tracking-wide">Vista previa</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-1" role="group" aria-label="Ancho del papel">
              {([58, 80] as const).map(w => (
                <button key={w} disabled={animando} onClick={() => setSettings({ thermalWidth: w })} aria-pressed={mm === w} className={chip(mm === w)}>{w}mm</button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Tamaño de la vista previa">
              {VISTAS.map(v => (
                <button key={v} disabled={animando} onClick={() => setVista(v)} aria-pressed={vista === v} className={chip(vista === v)}
                  title={v === 'real' ? 'Tamaño físico aproximado: depende de los puntos por pulgada de tu monitor' : undefined}>
                  {v === 'real' ? '1:1' : `${v}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="tk-scroll flex-1 overflow-auto p-4 flex justify-center" style={{ background: '#d7d4ce' }}>
          {error && <p className="text-sm text-red-600 py-8">No se pudo cargar el comprobante.</p>}
          {!error && !data && <p className="text-sm text-neutral-600 py-8">Cargando…</p>}
          {data && (
            <div className="stage" style={{ ['--tk-zoom' as string]: zoom, ['--pw' as string]: `${paperW}px` }}>
              {animando && <div className="printer" aria-hidden />}
              <TicketPaper
                innerRef={paperRef}
                lineas={lineas}
                width={W}
                zoom={zoom}
                tamanoReal={vista === 'real' ? mm : undefined}
                className={`paper ${animando ? 'feeding' : ''}`}
                style={animando ? ({ animationDuration: `${durMs}ms`, '--ph': `${paperH}px` } as React.CSSProperties) : undefined}
              />
            </div>
          )}
        </div>

        {estado.tipo !== 'idle' && (
          <div role="status" className={`tk-head px-3 py-2 text-[12px] font-medium ${estado.tipo === 'ok' ? 'text-emerald-600 bg-emerald-500/10' : 'text-red-500 bg-red-500/10'}`}>{estado.msg}</div>
        )}

        <div className="tk-actions flex flex-col gap-2 p-3 border-t border-edge bg-surface">
          <div className="flex gap-2">
            {puedeTermica ? (
              <button onClick={imprimirTermica} disabled={!data || imprimiendo} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {imprimiendo ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                {imprimiendo ? 'Imprimiendo…' : 'Imprimir (sin driver)'}
              </button>
            ) : (
              <div className="flex-1 text-[11px] text-mute self-center px-2">Configura la impresora en Ajustes → Impresión. Mientras, usa PDF/Diálogo →</div>
            )}
            <button onClick={() => window.print()} disabled={!data || animando} title="Imprime con el diálogo del navegador o guarda PDF" className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 active:scale-[0.98] transition-all disabled:opacity-50">PDF / Diálogo</button>
          </div>
          {/* Aquí NO va la orden en carta. Este modal es el ticket térmico y el
              ticket es de refacciones: los tres lugares que lo abren (la caja,
              VenderRefaccionModal y el detalle de una venta de refacción) venden
              refacciones. La orden en carta es el documento de la maquinaria y
              vive en el detalle de esa venta. */}
          <button onClick={onClose} className="py-2 rounded-full text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
        </div>
      </div>
      <style>{PRINT_CSS(mm, W)}</style>
    </Modal>,
    document.body
  )
}
