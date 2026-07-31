import { useState } from 'react'
import { createPortal } from 'react-dom'
import { usePrintSettings } from '../lib/printSettings'
import { formatMoney } from '../lib/utils'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import api from '../lib/api'
import { descargarBlob } from '../lib/descargar'
import LogoRemali from './ui/logo-remali'

type Item = { id: number; descripcion: string; cantidad: number; precio_unitario: string; subtotal: string; modalidad_label?: string }
type Foto = { id: number; imagen: string; orden: number }
type Cotizacion = {
  id: number; folio: string; estado: string; tipo: string
  cliente_display: string; cliente_telefono: string
  vigencia_dias: number; vigencia_hasta?: string | null; aplica_iva: boolean; notas: string
  items: Item[]; fotos?: Foto[]; subtotal: string; base: string; iva: string; total: string; creada: string
}

const CSS = (pw: number, ph: number, name: string, acento: string) => `
.cot-carta { width: ${pw}mm; min-height: ${ph}mm; background:#fff; color:#111827; padding: 13mm; box-sizing:border-box; font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:10pt; line-height:1.35; }
.cot-carta h1 { font-size:18pt; font-weight:800; margin:0; }
.cot-carta .muted { color:#6B7280; }
.cot-carta .row { display:flex; justify-content:space-between; gap:14px; }
.cot-carta .box { border:1px solid #E5E7EB; border-radius:8px; padding:9px 12px; }
.cot-carta table { width:100%; border-collapse:collapse; margin-top:5px; }
.cot-carta th, .cot-carta td { text-align:left; padding:5.5px 8px; border-bottom:1px solid #E5E7EB; font-size:9.5pt; }
.cot-carta th { color:#6B7280; font-size:8pt; text-transform:uppercase; letter-spacing:.4px; }
.cot-carta .r { text-align:right; }
.cot-carta .sect-title { font-size:8.5pt; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:${acento}; margin:10px 0 3px; }
.cot-carta .cot-fotos { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:5px; }
.cot-carta .cot-fotos img { width:100%; height:48mm; object-fit:contain; background:#FAFAFA; border:1px solid #E5E7EB; border-radius:6px; display:block; }
.cot-carta .cot-fine { border-top:1px solid #E5E7EB; margin-top:7mm; padding-top:6px; color:#6B7280; font-size:8pt; white-space:pre-wrap; }
@media print {
  .cot-carta .cot-fotos img { break-inside:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cot-carta .box, .cot-carta .cot-fotos, .cot-carta table tr { break-inside:avoid; }
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .cot-carta { width:auto !important; min-height:auto !important; padding:0 !important; }
  .oc-actions { display:none !important; }
  @page { size: ${name} portrait; margin: 13mm; }
}
`

const ESTADO_LABEL: Record<string, string> = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada' }
const TIPO_LABEL: Record<string, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }
// Acento del documento según el tipo: venta = azul, renta = naranja. (El dorado
// queda reservado para mantenimiento.) Mixta va con el azul de venta.
const ACENTO_TIPO: Record<string, string> = { venta: '#2B5FAD', renta: '#EA580C', mixta: '#2B5FAD' }

export default function CotizacionCartaModal({ cotizacion, onClose }: { cotizacion: Cotizacion; onClose: () => void }) {
  const [ps, setPs] = usePrintSettings()
  const [descargando, setDescargando] = useState(false)
  const [errPdf, setErrPdf] = useState('')
  const a4 = ps.docSize === 'a4'
  const pw = a4 ? 210 : 216, ph = a4 ? 297 : 279, pageName = a4 ? 'A4' : 'Letter'
  const neg = ps.negocio
  const acento = ACENTO_TIPO[cotizacion.tipo] || '#B8872E'

  // Baja el PDF de reportlab (idéntico al del correo), no una captura del HTML.
  function descargarPDF() {
    setErrPdf(''); setDescargando(true)
    api.get(`/cotizaciones/${cotizacion.id}/pdf/`, { responseType: 'blob' })
      .then(r => descargarBlob(r.data as Blob, `${cotizacion.folio || 'cotizacion'}.pdf`))
      .catch(() => setErrPdf('No se pudo descargar el PDF.'))
      .finally(() => setDescargando(false))
  }
  const money = formatMoney
  const fecha = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : '—')

  return createPortal(
    <div className="oc-overlay fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[880px] my-4" onClick={e => e.stopPropagation()}>
        <div className="oc-scroll max-h-[80vh] overflow-y-auto bg-neutral-200 p-5 flex justify-center items-start">
          <div className="cot-carta">
            <div className="row" style={{ alignItems: 'flex-start', borderBottom: '2px solid #111827', paddingBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: acento }}>
                  <LogoRemali className="h-10 w-10" title="REMALI" />
                  <h1 style={{ color: acento }}>{neg.nombre || 'REMALI'}</h1>
                </div>
                <div className="muted" style={{ fontSize: '9.5pt', marginTop: 2 }}>Renta · Venta · Servicio de maquinaria</div>
                {neg.direccion && <div className="muted" style={{ fontSize: '8.5pt' }}>{neg.direccion}</div>}
                {(neg.telefono || neg.email) && <div className="muted" style={{ fontSize: '8.5pt' }}>{[neg.telefono && `Tel. ${neg.telefono}`, neg.email].filter(Boolean).join('   ·   ')}</div>}
                {(neg.web || neg.rfc) && <div className="muted" style={{ fontSize: '8.5pt' }}>{[neg.web, neg.rfc && `RFC: ${neg.rfc}`].filter(Boolean).join('   ·   ')}</div>}
                {neg.representante && <div style={{ fontSize: '8.5pt', marginTop: 3, fontWeight: 600 }}>{neg.representante}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14pt', fontWeight: 800 }}>COTIZACIÓN</div>
                <div style={{ fontWeight: 700, color: acento }}>{cotizacion.folio}</div>
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
                <div className="row"><span className="muted">Subtotal</span><span>{money(cotizacion.base)}</span></div>
                {Number(cotizacion.iva) > 0 && <div className="row"><span className="muted">IVA (16%)</span><span>{money(cotizacion.iva)}</span></div>}
                <div className="row" style={{ borderTop: '1px solid #E5E7EB', marginTop: 4, paddingTop: 6, fontWeight: 800, fontSize: '13pt' }}><span>TOTAL</span><span style={{ color: acento }}>{money(cotizacion.total)}</span></div>
                {cotizacion.tipo !== 'renta' && <div className="row" style={{ marginTop: 4 }}><span className="muted" style={{ fontSize: '9pt' }}>Contado (−5%)</span><span className="muted" style={{ fontSize: '9pt' }}>{money(Number(cotizacion.total) * 0.95)}</span></div>}
              </div>
            </div>

            {cotizacion.notas && (<>
              <div className="sect-title">Notas</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>{cotizacion.notas}</div>
            </>)}

            {cotizacion.fotos && cotizacion.fotos.length > 0 && (<>
              <div className="sect-title">Fotos</div>
              <div className="cot-fotos">
                {cotizacion.fotos.map(f => (
                  <img key={f.id} src={resolveMediaUrl(f.imagen)} alt="Equipo cotizado" />
                ))}
              </div>
            </>)}

            {neg.datosBancarios && (
              <div className="box" style={{ marginTop: 14 }}>
                <div className="sect-title" style={{ marginTop: 0 }}>Datos bancarios</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '9.5pt' }}>{neg.datosBancarios}</div>
              </div>
            )}

            {neg.cierre && (
              <p style={{ whiteSpace: 'pre-wrap', fontSize: '9.5pt', fontStyle: 'italic', marginTop: '6mm' }}>{neg.cierre}</p>
            )}

            <p className="cot-fine">
              {[
                cotizacion.tipo === 'renta' ? neg.condicionesRenta : neg.condiciones,
                `Precios en pesos mexicanos (MXN)${Number(cotizacion.iva) > 0 ? ', IVA incluido en el total' : ', más IVA si aplica'}. Cotización válida por ${cotizacion.vigencia_dias} días. Sujeta a disponibilidad.`,
              ].filter(Boolean).join('\n')}
            </p>
          </div>
        </div>
        {errPdf && <div className="oc-actions px-3 pt-2 text-[12px] text-red-500 text-right">{errPdf}</div>}
        <div className="oc-actions flex items-center gap-2 p-3 border-t border-edge bg-surface">
          <div className="flex border border-edge rounded-lg overflow-hidden shrink-0">
            {(['carta', 'a4'] as const).map(d => (
              <button key={d} onClick={() => setPs({ docSize: d })} className={`px-3 py-2 text-xs font-bold transition-colors ${ps.docSize === d ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`}>{d === 'carta' ? 'Carta' : 'A4'}</button>
            ))}
          </div>
          <button onClick={onClose} className="flex-1 py-2 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
          <button onClick={descargarPDF} disabled={descargando} className="flex-1 py-2 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {descargando
              ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>}
            {descargando ? 'Generando…' : 'Descargar PDF'}
          </button>
          <button onClick={() => window.print()} className="flex-1 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">Imprimir ({a4 ? 'A4' : 'Carta'})</button>
        </div>
      </div>
      <style>{CSS(pw, ph, pageName, acento)}</style>
    </div>,
    document.body,
  )
}
