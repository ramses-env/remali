import { useEffect, useRef } from 'react'
import Modal from './Modal'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'

type Etiqueta = { nombre: string; codigo_barras: string; precio_venta: string }

const ETIQUETA_CSS = `
.etiqueta {
  width: 50mm; background: #fff; color: #000; padding: 2mm;
  text-align: center; box-sizing: border-box;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
}
.etiqueta .et-nombre { font-size: 9px; font-weight: 700; line-height: 1.15; margin-bottom: 1mm; overflow: hidden; }
.etiqueta .et-bc { width: 100%; height: auto; display: block; }
.etiqueta .et-precio { font-size: 12px; font-weight: 800; margin-top: 0.5mm; }
@media print {
  body > #root { display: none !important; }
  .lbl-overlay { position: static !important; inset: auto !important; background: #fff !important; backdrop-filter: none !important; padding: 0 !important; display: block !important; }
  .lbl-card { border: 0 !important; border-radius: 0 !important; max-width: none !important; width: auto !important; box-shadow: none !important; overflow: visible !important; }
  .lbl-scroll { background: #fff !important; padding: 0 !important; display: block !important; }
  .lbl-actions { display: none !important; }
  @page { size: 50mm 30mm; margin: 1mm; }
}
`

export default function EtiquetaModal({ refaccion, onClose }: { refaccion: Etiqueta; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const code = (refaccion.codigo_barras || '').trim()
    if (!code) return
    const isEAN13 = /^\d{13}$/.test(code)
    const opts = { displayValue: true, fontSize: 13, textMargin: 1, height: 42, margin: 2, width: 1.6 as number }
    try {
      JsBarcode(svgRef.current, code, { format: isEAN13 ? 'EAN13' : 'CODE128', ...opts })
    } catch {
      try { JsBarcode(svgRef.current, code, { format: 'CODE128', ...opts }) } catch { /* noop */ }
    }
  }, [refaccion.codigo_barras])

  const precio = Number(refaccion.precio_venta) || 0

  return createPortal(
    <Modal className="lbl-overlay modal-in fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClose={onClose} label="Etiqueta de la unidad">
      <div className="lbl-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[320px]" onClick={e => e.stopPropagation()}>
        <div className="lbl-scroll bg-neutral-200 p-5 flex justify-center">
          <div id="etiqueta-print" className="etiqueta">
            <div className="et-nombre">{refaccion.nombre}</div>
            <svg ref={svgRef} className="et-bc" />
            {precio > 0 && <div className="et-precio">${precio.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>}
          </div>
        </div>
        <div className="lbl-actions flex gap-2 p-3 border-t border-edge bg-surface">
          <button onClick={onClose} className="flex-1 py-2 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
          <button onClick={() => window.print()} className="flex-1 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">🏷️ Imprimir</button>
        </div>
      </div>
      <style>{ETIQUETA_CSS}</style>
    </Modal>,
    document.body,
  )
}
