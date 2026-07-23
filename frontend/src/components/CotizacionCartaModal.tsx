import { createPortal } from 'react-dom'
import { usePrintSettings } from '../lib/printSettings'

type Item = { id: number; descripcion: string; cantidad: number; precio_unitario: string; subtotal: string; modalidad_label?: string }
type Cotizacion = {
  folio: string; estado: string; tipo: string
  cliente_display: string; cliente_telefono: string
  vigencia_dias: number; vigencia_hasta?: string | null; aplica_iva: boolean; notas: string
  items: Item[]; subtotal: string; iva: string; total: string; creada: string
}

const CSS = (pw: number, ph: number, name: string) => `
.cot-carta { width: ${pw}mm; min-height: ${ph}mm; background:#fff; color:#111827; padding: 14mm; box-sizing:border-box; font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:11pt; }
.cot-carta h1 { font-size:20pt; font-weight:800; margin:0; }
.cot-carta .muted { color:#6B7280; }
.cot-carta .row { display:flex; justify-content:space-between; gap:16px; }
.cot-carta .box { border:1px solid #E5E7EB; border-radius:8px; padding:10px 14px; }
.cot-carta table { width:100%; border-collapse:collapse; margin-top:6px; }
.cot-carta th, .cot-carta td { text-align:left; padding:7px 8px; border-bottom:1px solid #E5E7EB; font-size:10pt; }
.cot-carta th { color:#6B7280; font-size:8.5pt; text-transform:uppercase; letter-spacing:.4px; }
.cot-carta .r { text-align:right; }
.cot-carta .sect-title { font-size:9pt; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:#B8872E; margin:16px 0 4px; }
@media print {
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .cot-carta { width:auto !important; min-height:auto !important; padding:0 !important; }
  .oc-actions { display:none !important; }
  @page { size: ${name} portrait; margin: 14mm; }
}
`

const ESTADO_LABEL: Record<string, string> = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada' }
const TIPO_LABEL: Record<string, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }

export default function CotizacionCartaModal({ cotizacion, onClose }: { cotizacion: Cotizacion; onClose: () => void }) {
  const [ps, setPs] = usePrintSettings()
  const a4 = ps.docSize === 'a4'
  const pw = a4 ? 210 : 216, ph = a4 ? 297 : 279, pageName = a4 ? 'A4' : 'Letter'
  const neg = ps.negocio
  const money = (v: any) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
  const fecha = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : '—')

  return createPortal(
    <div className="oc-overlay fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[880px] my-4" onClick={e => e.stopPropagation()}>
        <div className="oc-scroll max-h-[80vh] overflow-y-auto bg-neutral-200 p-5 flex justify-center">
          <div className="cot-carta">
            <div className="row" style={{ alignItems: 'flex-start', borderBottom: '2px solid #111827', paddingBottom: 12 }}>
              <div>
                <h1>{neg.nombre || 'REMALI'}</h1>
                <div className="muted" style={{ fontSize: '9.5pt' }}>Renta · Venta · Servicio de maquinaria</div>
                {neg.direccion && <div className="muted" style={{ fontSize: '9pt' }}>{neg.direccion}</div>}
                {neg.telefono && <div className="muted" style={{ fontSize: '9pt' }}>Tel: {neg.telefono}</div>}
                {neg.rfc && <div className="muted" style={{ fontSize: '9pt' }}>RFC: {neg.rfc}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14pt', fontWeight: 800 }}>COTIZACIÓN</div>
                <div style={{ fontWeight: 700, color: '#B8872E' }}>{cotizacion.folio}</div>
                <div className="muted" style={{ fontSize: '9pt' }}>{ESTADO_LABEL[cotizacion.estado] || cotizacion.estado}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <div className="box" style={{ flex: 1 }}>
                <div className="sect-title" style={{ marginTop: 0 }}>Cliente</div>
                <div style={{ fontWeight: 700 }}>{cotizacion.cliente_display}</div>
                {cotizacion.cliente_telefono && <div className="muted" style={{ fontSize: '9.5pt' }}>Tel: {cotizacion.cliente_telefono}</div>}
              </div>
              <div className="box" style={{ flex: 1 }}>
                <div className="sect-title" style={{ marginTop: 0 }}>Datos</div>
                <div className="muted" style={{ fontSize: '9.5pt' }}>Fecha: {fecha(cotizacion.creada)}</div>
                <div className="muted" style={{ fontSize: '9.5pt' }}>Tipo: {TIPO_LABEL[cotizacion.tipo] || 'Venta'}</div>
                <div className="muted" style={{ fontSize: '9.5pt' }}>Válida hasta: {fecha(cotizacion.vigencia_hasta)}</div>
              </div>
            </div>

            <div className="sect-title">Conceptos</div>
            <table>
              <thead><tr><th>Descripción</th><th>Modalidad</th><th className="r">Cant.</th><th className="r">P. unit.</th><th className="r">Importe</th></tr></thead>
              <tbody>
                {cotizacion.items.length === 0 && <tr><td colSpan={5} className="muted">Sin partidas.</td></tr>}
                {cotizacion.items.map(it => (
                  <tr key={it.id}>
                    <td>{it.descripcion}</td>
                    <td className="muted">{it.modalidad_label || 'Venta'}</td>
                    <td className="r">{it.cantidad}</td>
                    <td className="r">{money(it.precio_unitario)}</td>
                    <td className="r">{money(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row" style={{ marginTop: 12 }}>
              <div style={{ flex: 1 }} />
              <div style={{ width: '62mm' }}>
                <div className="row"><span className="muted">Subtotal</span><span>{money(cotizacion.subtotal)}</span></div>
                {cotizacion.aplica_iva && <div className="row"><span className="muted">IVA (16%)</span><span>{money(cotizacion.iva)}</span></div>}
                <div className="row" style={{ borderTop: '1px solid #E5E7EB', marginTop: 4, paddingTop: 6, fontWeight: 800, fontSize: '13pt' }}><span>TOTAL</span><span style={{ color: '#B8872E' }}>{money(cotizacion.total)}</span></div>
              </div>
            </div>

            {cotizacion.notas && (<>
              <div className="sect-title">Notas</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>{cotizacion.notas}</div>
            </>)}

            <p className="muted" style={{ fontSize: '8.5pt', marginTop: '10mm' }}>
              Precios en pesos mexicanos (MXN){cotizacion.aplica_iva ? ', IVA incluido en el total' : ', más IVA si aplica'}. Cotización válida por {cotizacion.vigencia_dias} días. Sujeta a disponibilidad.
            </p>
          </div>
        </div>
        <div className="oc-actions flex items-center gap-2 p-3 border-t border-edge bg-surface">
          <div className="flex border border-edge rounded-lg overflow-hidden shrink-0">
            {(['carta', 'a4'] as const).map(d => (
              <button key={d} onClick={() => setPs({ docSize: d })} className={`px-3 py-2 text-xs font-bold transition-colors ${ps.docSize === d ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`}>{d === 'carta' ? 'Carta' : 'A4'}</button>
            ))}
          </div>
          <button onClick={onClose} className="flex-1 py-2 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
          <button onClick={() => window.print()} className="flex-1 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">🖨 Imprimir ({a4 ? 'A4' : 'Carta'})</button>
        </div>
      </div>
      <style>{CSS(pw, ph, pageName)}</style>
    </div>,
    document.body,
  )
}
