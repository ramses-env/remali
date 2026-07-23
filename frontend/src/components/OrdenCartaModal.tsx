import { createPortal } from 'react-dom'
import { usePrintSettings } from '../lib/printSettings'

type Item = { id: number; origen: string; nombre: string; cantidad: number; costo_unitario: string; subtotal: string }
type Orden = {
  folio: string; estado: string; tipo: string
  cliente_display: string; cliente_telefono: string
  equipo_display: string; numero_serie: string
  diagnostico: string; trabajo_realizado: string
  costo_mano_obra: string; total_refacciones: string; total: string
  items: Item[]; fecha_recibida?: string; fecha_entrega?: string | null
}

const CSS = (pw: number, ph: number, name: string) => `
.orden-carta { width: ${pw}mm; min-height: ${ph}mm; background:#fff; color:#111827; padding: 14mm; box-sizing:border-box; font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:11pt; }
.orden-carta h1 { font-size:20pt; font-weight:800; margin:0; }
.orden-carta .muted { color:#6B7280; }
.orden-carta .row { display:flex; justify-content:space-between; gap:16px; }
.orden-carta .box { border:1px solid #E5E7EB; border-radius:8px; padding:10px 14px; }
.orden-carta table { width:100%; border-collapse:collapse; margin-top:6px; }
.orden-carta th, .orden-carta td { text-align:left; padding:7px 8px; border-bottom:1px solid #E5E7EB; font-size:10pt; }
.orden-carta th { color:#6B7280; font-size:8.5pt; text-transform:uppercase; letter-spacing:.4px; }
.orden-carta .r { text-align:right; }
.orden-carta .sect-title { font-size:9pt; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:#B8872E; margin:16px 0 4px; }
@media print {
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .oc-actions { display:none !important; }
  /* Al imprimir, la hoja manda los márgenes: el documento ocupa el ancho útil vertical */
  .orden-carta { width:auto !important; min-height:auto !important; padding:0 !important; }
  @page { size: ${name} portrait; margin: 14mm; }
}
`

const ESTADO_LABEL: Record<string, string> = { recibida: 'Recibida', proceso: 'En proceso', terminada: 'Terminada', entregada: 'Entregada' }

export default function OrdenCartaModal({ orden, onClose }: { orden: Orden; onClose: () => void }) {
  const [ps, setPs] = usePrintSettings()
  const a4 = ps.docSize === 'a4'
  const pw = a4 ? 210 : 216, ph = a4 ? 297 : 279, pageName = a4 ? 'A4' : 'Letter'
  const money = (v: any) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
  const fecha = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : '—')

  return createPortal(
    <div className="oc-overlay fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[880px] my-4" onClick={e => e.stopPropagation()}>
        <div className="oc-scroll max-h-[80vh] overflow-y-auto bg-neutral-200 p-5 flex justify-center">
          <div className="orden-carta">
            {/* Encabezado */}
            <div className="row" style={{ alignItems: 'flex-start', borderBottom: '2px solid #111827', paddingBottom: 12 }}>
              <div>
                <h1>REMALI</h1>
                <div className="muted" style={{ fontSize: '9.5pt' }}>Renta · Venta · Servicio de maquinaria</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14pt', fontWeight: 800 }}>ORDEN DE REPARACIÓN</div>
                <div style={{ fontWeight: 700, color: '#B8872E' }}>{orden.folio}</div>
                <div className="muted" style={{ fontSize: '9pt' }}>Estado: {ESTADO_LABEL[orden.estado] || orden.estado}</div>
              </div>
            </div>

            {/* Cliente / equipo */}
            <div className="row" style={{ marginTop: 14 }}>
              <div className="box" style={{ flex: 1 }}>
                <div className="sect-title" style={{ marginTop: 0 }}>Cliente</div>
                <div style={{ fontWeight: 700 }}>{orden.cliente_display}</div>
                {orden.cliente_telefono && <div className="muted" style={{ fontSize: '9.5pt' }}>Tel: {orden.cliente_telefono}</div>}
              </div>
              <div className="box" style={{ flex: 1 }}>
                <div className="sect-title" style={{ marginTop: 0 }}>Equipo</div>
                <div style={{ fontWeight: 700 }}>{orden.equipo_display}</div>
                {orden.numero_serie && <div className="muted" style={{ fontSize: '9.5pt' }}>Serie: {orden.numero_serie}</div>}
              </div>
            </div>
            <div className="row muted" style={{ fontSize: '9pt', marginTop: 6 }}>
              <div>Recibido: {fecha(orden.fecha_recibida)}</div>
              <div>Entregado: {fecha(orden.fecha_entrega)}</div>
            </div>

            {/* Diagnóstico */}
            {orden.diagnostico && (<>
              <div className="sect-title">Falla reportada / diagnóstico</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{orden.diagnostico}</div>
            </>)}

            {/* Trabajo realizado */}
            {orden.trabajo_realizado && (<>
              <div className="sect-title">Trabajo realizado</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{orden.trabajo_realizado}</div>
            </>)}

            {/* Refacciones */}
            <div className="sect-title">Refacciones y materiales</div>
            <table>
              <thead><tr><th>Descripción</th><th>Origen</th><th className="r">Cant.</th><th className="r">P. unit.</th><th className="r">Importe</th></tr></thead>
              <tbody>
                {orden.items.length === 0 && <tr><td colSpan={5} className="muted">Sin refacciones registradas.</td></tr>}
                {orden.items.map(it => (
                  <tr key={it.id}>
                    <td>{it.nombre}</td>
                    <td className="muted">{it.origen === 'stock' ? 'Inventario' : 'Comprada aparte'}</td>
                    <td className="r">{it.cantidad}</td>
                    <td className="r">{money(it.costo_unitario)}</td>
                    <td className="r">{money(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totales */}
            <div className="row" style={{ marginTop: 12 }}>
              <div style={{ flex: 1 }} />
              <div style={{ width: '62mm' }}>
                <div className="row"><span className="muted">Refacciones</span><span>{money(orden.total_refacciones)}</span></div>
                <div className="row"><span className="muted">Mano de obra</span><span>{money(orden.costo_mano_obra)}</span></div>
                <div className="row" style={{ borderTop: '1px solid #E5E7EB', marginTop: 4, paddingTop: 6, fontWeight: 800, fontSize: '13pt' }}><span>TOTAL</span><span style={{ color: '#B8872E' }}>{money(orden.total)}</span></div>
              </div>
            </div>

            {/* Firmas */}
            <div className="row" style={{ marginTop: '20mm' }}>
              <div style={{ flex: 1, textAlign: 'center' }}><div style={{ borderTop: '1px solid #111827', paddingTop: 4 }} className="muted">Firma del técnico</div></div>
              <div style={{ width: 24 }} />
              <div style={{ flex: 1, textAlign: 'center' }}><div style={{ borderTop: '1px solid #111827', paddingTop: 4 }} className="muted">Firma del cliente (conforme)</div></div>
            </div>
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
