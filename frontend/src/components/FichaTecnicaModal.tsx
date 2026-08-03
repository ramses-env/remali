import { createPortal } from 'react-dom'
import { usePrintSettings } from '../lib/printSettings'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import LogoRemali from './ui/logo-remali'

type Spec = { etiqueta: string; valor: string }
type Equipo = {
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  especificaciones?: Spec[]
  categoria?: { nombre?: string } | null
  tipo?: { nombre?: string } | null
  marca?: { nombre?: string } | null
  condicion?: string
  que_incluye?: string[]
}

/* Colores FIJOS de impresión: la ficha se ve igual en pantalla, PDF y papel,
   sin depender del token del tema. El acento es el azul MARINO de la marca
   (el mismo del logo y del pie): banda, guiones y palomitas a juego. */
const MARINO = '#111827'
const TINTA = '#111827'

const CSS = (pw: number, ph: number, name: string) => `
.ficha { width:${pw}mm; min-height:${ph}mm; background:#fff; color:#1F2937; box-sizing:border-box;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif; padding:0; overflow:hidden;
  display:flex; flex-direction:column; }
.ficha .pad { padding:0 14mm; }
.ficha .band { background:${MARINO}; color:#fff; display:inline-flex; align-items:center;
  padding:7px 22px 7px 16px; font-weight:800; letter-spacing:1px; font-size:11pt; text-transform:uppercase;
  clip-path:polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); }
.ficha .brand { font-size:15pt; font-weight:800; color:${TINTA}; letter-spacing:.5px; line-height:1; }
.ficha .brand small { display:block; font-size:7pt; font-weight:700; color:#9CA3AF; letter-spacing:1.6px; text-transform:uppercase; margin-top:3px; }
.ficha h1 { font-size:22pt; font-weight:800; margin:0; color:${TINTA}; text-transform:uppercase; letter-spacing:.5px; line-height:1.05; }
.ficha .desc { font-size:9.5pt; color:#4B5563; line-height:1.55; margin-top:6px; }
.ficha .destacado { font-size:25pt; font-weight:800; color:${TINTA}; line-height:1; }
.ficha .destacado small { font-size:8.5pt; font-weight:700; color:#9CA3AF; text-transform:uppercase; letter-spacing:.5px; display:block; margin-top:2px; }
.ficha .clasif { background:#F9FAFB; border:1px solid #E5E7EB; border-radius:10px; padding:10px 14px;
  display:flex; gap:24px; flex-wrap:wrap; }
.ficha .clasif .item { min-width:80px; }
.ficha .clasif .k { font-size:7.5pt; font-weight:800; color:#9CA3AF; text-transform:uppercase; letter-spacing:.6px; }
.ficha .clasif .v { font-size:10.5pt; font-weight:700; color:${TINTA}; margin-top:1px; }
.ficha .titulo-sec { display:flex; align-items:center; gap:8px; font-size:9pt; font-weight:800; color:${TINTA};
  text-transform:uppercase; letter-spacing:1px; margin:0 0 4px; }
.ficha .titulo-sec::before { content:''; width:22px; height:3px; background:${MARINO}; display:block; }
.ficha .spec { break-inside:avoid; padding:7px 0; border-bottom:1px solid #F3F4F6; }
.ficha .spec .k { font-size:8.5pt; font-weight:800; color:#6B7280; text-transform:uppercase; letter-spacing:.4px; }
.ficha .spec .v { font-size:11pt; font-weight:700; color:${TINTA}; }
.ficha .feat { display:flex; gap:8px; align-items:flex-start; font-size:9.5pt; color:#374151; margin-bottom:5px; }
.ficha .feat .ck { color:${MARINO}; font-weight:900; }
.ficha .foto { width:100%; height:100%; object-fit:contain; }
.ficha .footer { background:${TINTA}; color:#fff; padding:10px 14mm; display:flex; justify-content:space-between;
  align-items:center; gap:16px; font-size:8pt; margin-top:auto; }
.ficha .footer .sep { opacity:.45; margin:0 6px; }
/* Cada dato (tel, correo, dirección) es una unidad: si no cabe, baja completo,
   nunca se parte a media palabra ni a medio teléfono. */
.ficha .footer .u { white-space:nowrap; }
.ficha .footer .izq { display:inline-flex; flex-wrap:wrap; align-items:center; row-gap:2px; }
@media print {
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .ficha { width:auto !important; min-height:${ph}mm !important; }
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
  // Descripción como párrafo de presentación (recortada a un largo de ficha).
  const descripcion = (equipo.descripcion || '').trim()
  const descCorta = descripcion.length > 320 ? descripcion.slice(0, 317).trimEnd() + '…' : descripcion
  // "Incluye": el campo capturado en el producto ("Título: detalle" por línea).
  const incluye = (equipo.que_incluye || []).map(l => l.trim()).filter(Boolean)
  const condicion = equipo.condicion === 'nueva' ? 'Nueva' : equipo.condicion === 'seminueva' ? 'Seminueva' : ''
  const clasif = [
    { k: 'Categoría', v: equipo.categoria?.nombre },
    { k: 'Tipo', v: equipo.tipo?.nombre },
    { k: 'Marca', v: equipo.marca?.nombre },
    { k: 'Condición', v: condicion },
  ].filter(c => c.v)
  const pieContacto = [
    neg.telefono ? `Tel: ${neg.telefono}` : '',
    neg.email || '',
  ].filter(Boolean)

  return createPortal(
    <div className="oc-overlay modal-in fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-2xl overflow-hidden w-full max-w-[880px] my-4" onClick={e => e.stopPropagation()}>
        <div className="oc-scroll max-h-[80vh] overflow-y-auto bg-neutral-200 p-5 flex justify-center">
          <div className="ficha">
            {/* Encabezado: banda de categoría + marca del negocio alineada al logo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10mm 14mm 0' }}>
              <div className="band">Ficha técnica</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <LogoRemali className="h-10 w-10" title="REMALI" />
                <div className="brand">{neg.nombre || 'REMALI'}<small>Renta · Venta · Servicio</small></div>
              </div>
            </div>

            <div className="pad" style={{ paddingTop: '8mm' }}>
              {/* Título + descripción + destacado | foto */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flex: 1.2, minWidth: 0 }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1 }}>{equipo.marca?.nombre || equipo.categoria?.nombre || 'Equipo'}</div>
                  <h1>{equipo.modelo}</h1>
                  {descCorta && <p className="desc">{descCorta}</p>}
                  {destacado && <div style={{ marginTop: 12 }}><div className="destacado">{destacado.valor}<small>{destacado.etiqueta}</small></div></div>}
                </div>
                {foto && (
                  <div style={{ width: '62mm', height: '50mm', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={foto} alt={equipo.modelo} className="foto" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </div>
                )}
              </div>

              {/* Clasificación: llena la ficha y ubica el equipo en el catálogo */}
              {clasif.length > 0 && (
                <div className="clasif" style={{ marginTop: 12 }}>
                  {clasif.map(c => (
                    <div key={c.k} className="item">
                      <div className="k">{c.k}</div>
                      <div className="v">{c.v}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Especificaciones técnicas */}
              <div style={{ marginTop: 16 }}>
                <p className="titulo-sec">Especificaciones técnicas</p>
                {specs.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28 }}>
                    {specs.map((s, i) => (
                      <div key={i} className="spec">
                        <div className="k">{s.etiqueta}</div>
                        <div className="v">{s.valor}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#9CA3AF', fontSize: '10pt', padding: '6px 0 10px' }}>Este producto aún no tiene especificaciones capturadas.</p>
                )}
              </div>

              {/* Qué incluye (el campo del producto; antes se improvisaba con la descripción) */}
              {incluye.length > 0 && (
                <div style={{ marginTop: 16, paddingBottom: 14 }}>
                  <p className="titulo-sec">Incluye</p>
                  {incluye.map((f, i) => (
                    <div key={i} className="feat"><span className="ck">✓</span><span>{f}</span></div>
                  ))}
                </div>
              )}
            </div>

            {/* Pie con los datos completos del negocio */}
            <div className="footer">
              <span className="izq">
                <b className="u">{neg.nombre || 'REMALI'}</b>
                {pieContacto.map((p, i) => <span key={i} className="u"><span className="sep">·</span>{p}</span>)}
              </span>
              {neg.direccion && <span className="u" style={{ textAlign: 'right' }}>{neg.direccion}</span>}
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
