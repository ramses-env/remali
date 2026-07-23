import { createPortal } from 'react-dom'
import { usePrintSettings } from '../lib/printSettings'
import resolveMediaUrl from '../lib/resolveMediaUrl'

type Spec = { etiqueta: string; valor: string }
type Equipo = {
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  especificaciones?: Spec[]
  categoria?: { nombre?: string } | null
  marca?: { nombre?: string } | null
}

// El amarillo del sistema (token del tema), no un dorado fijo.
const GOLD = 'var(--c-gold)'

const CSS = (pw: number, ph: number, name: string) => `
.ficha { width:${pw}mm; min-height:${ph}mm; background:#fff; color:#1F2937; box-sizing:border-box;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif; padding:0; overflow:hidden; }
.ficha .pad { padding:14mm; }
.ficha .band { background:${GOLD}; color:#1F2937; display:inline-flex; align-items:center; gap:8px;
  padding:7px 22px 7px 16px; font-weight:800; letter-spacing:1px; font-size:11pt; text-transform:uppercase;
  clip-path:polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); }
.ficha .brand { font-size:17pt; font-weight:800; color:#111827; letter-spacing:.5px; }
.ficha .brand small { display:block; font-size:7.5pt; font-weight:600; color:#9CA3AF; letter-spacing:1px; text-transform:uppercase; }
.ficha h1 { font-size:22pt; font-weight:800; margin:0; color:#111827; text-transform:uppercase; letter-spacing:.5px; }
.ficha .modelo { font-size:15pt; font-weight:800; color:${GOLD}; margin-top:2px; }
.ficha .destacado { font-size:26pt; font-weight:800; color:#111827; line-height:1; }
.ficha .destacado small { font-size:9pt; font-weight:700; color:#9CA3AF; text-transform:uppercase; letter-spacing:.5px; display:block; }
.ficha .spec { break-inside:avoid; padding:7px 0; }
.ficha .spec .dash { width:20px; height:2px; background:${GOLD}; display:block; margin-bottom:5px; }
.ficha .spec .k { font-size:8.5pt; font-weight:800; color:#6B7280; text-transform:uppercase; letter-spacing:.4px; }
.ficha .spec .v { font-size:11pt; font-weight:700; color:#111827; }
.ficha .feat { display:flex; gap:8px; align-items:flex-start; font-size:10pt; color:#374151; margin-bottom:6px; }
.ficha .feat .ck { color:${GOLD}; font-weight:900; }
.ficha .foto { width:100%; height:100%; object-fit:contain; }
.ficha .footer { background:#111827; color:#fff; padding:9px 14mm; display:flex; justify-content:space-between;
  align-items:center; font-size:8.5pt; }
@media print {
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .ficha { width:auto !important; min-height:auto !important; }
  .oc-actions { display:none !important; }
  @page { size:${name} portrait; margin:0; }
}
`

export default function FichaTecnicaModal({ equipo, onClose }: { equipo: Equipo; onClose: () => void }) {
  const [ps, setPs] = usePrintSettings()
  const a4 = ps.docSize === 'a4'
  const pw = a4 ? 210 : 216, ph = a4 ? 297 : 279, pageName = a4 ? 'A4' : 'Letter'
  const neg = ps.negocio

  const specs = (equipo.especificaciones || []).filter(s => s.etiqueta && s.valor)
  const foto = resolveMediaUrl(equipo.imagen || equipo.imagenes?.[0] || '')
  // Dato destacado: la primera spec cuyo valor traiga potencia (kW / HP).
  const destacado = specs.find(s => /\b(kw|kva|hp)\b/i.test(s.valor))
  // Características: de la descripción, una por línea o por punto.
  const feats = (equipo.descripcion || '')
    .split(/\n|(?<=\.)\s+/).map(s => s.trim()).filter(Boolean).slice(0, 4)

  return createPortal(
    <div className="oc-overlay fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[880px] my-4" onClick={e => e.stopPropagation()}>
        <div className="oc-scroll max-h-[80vh] overflow-y-auto bg-neutral-200 p-5 flex justify-center">
          <div className="ficha">
            {/* Encabezado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10mm 14mm 0' }}>
              <div className="band">{equipo.categoria?.nombre || 'Equipo'}</div>
              <div className="brand" style={{ textAlign: 'right' }}>{neg.nombre || 'REMALI'}<small>Renta · Venta · Servicio</small></div>
            </div>

            <div className="pad" style={{ paddingTop: '8mm' }}>
              {/* Título + destacado + foto */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flex: 1.2, minWidth: 0 }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1 }}>{equipo.marca?.nombre || 'Ficha técnica'}</div>
                  <h1>{equipo.modelo}</h1>
                  {destacado && <div style={{ marginTop: 10 }}><div className="destacado">{destacado.valor}<small>{destacado.etiqueta}</small></div></div>}
                </div>
                {foto && (
                  <div style={{ width: '58mm', height: '46mm', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={foto} alt={equipo.modelo} className="foto" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </div>
                )}
              </div>

              <div style={{ height: 2, background: '#E5E7EB', margin: '10px 0 4px' }} />

              {/* Grid de especificaciones */}
              {specs.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28 }}>
                  {specs.map((s, i) => (
                    <div key={i} className="spec">
                      <span className="dash" />
                      <div className="k">{s.etiqueta}</div>
                      <div className="v">{s.valor}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#9CA3AF', fontSize: '10pt', padding: '12px 0' }}>Este producto aún no tiene especificaciones capturadas.</p>
              )}

              {/* Características */}
              {feats.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid #E5E7EB', paddingTop: 12 }}>
                  {feats.map((f, i) => (
                    <div key={i} className="feat"><span className="ck">✓</span><span>{f}</span></div>
                  ))}
                </div>
              )}
            </div>

            {/* Pie */}
            <div className="footer">
              <span>{neg.nombre || 'REMALI'}{neg.telefono ? ` · Tel: ${neg.telefono}` : ''}</span>
              <span>{neg.direccion || ''}</span>
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
          <button onClick={() => window.print()} className="flex-1 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">⬇ Descargar / Imprimir</button>
        </div>
      </div>
      <style>{CSS(pw, ph, pageName)}</style>
    </div>,
    document.body,
  )
}
