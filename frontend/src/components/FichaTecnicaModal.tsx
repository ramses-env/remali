import { createPortal } from 'react-dom'
import Modal from './Modal'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Printer, X, FileText } from 'lucide-react'
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
  condiciones?: string[]
  que_incluye?: string[]
}

/* Colores FIJOS de impresión: la ficha se ve igual en pantalla, PDF y papel,
   sin depender del token del tema. El acento es el azul MARINO de la marca
   (el mismo del logo y del pie): banda, guiones y palomitas a juego. */
const MARINO = '#111827'
const TINTA = '#111827'

// La ficha se maqueta SIEMPRE a tamaño Carta (216 × 279 mm). En pantalla se
// reduce con un escalado uniforme para que quepa en cualquier ancho (móvil
// incluido) sin deformar ni encimar nada; al imprimir se resetea a tamaño real.
const PW = 216, PH = 279
const DOC_PX = (PW * 96) / 25.4   // ancho del documento en px (~816)

const CSS = `
.ficha { width:${PW}mm; min-height:${PH}mm; background:#fff; color:#1F2937; box-sizing:border-box;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif; padding:0; overflow:hidden;
  display:flex; flex-direction:column; box-shadow:0 18px 50px rgba(17,24,39,.22); }
.ficha .pad { padding:0 14mm; }
.ficha .band { background:${MARINO}; color:#fff; display:inline-flex; align-items:center;
  padding:7px 22px 7px 16px; font-weight:800; letter-spacing:1px; font-size:11pt; text-transform:uppercase;
  clip-path:polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%); }
.ficha .brand { font-size:15pt; font-weight:800; color:${TINTA}; letter-spacing:.5px; line-height:1; }
.ficha .brand small { display:block; font-size:7pt; font-weight:700; color:#9CA3AF; letter-spacing:1.6px; text-transform:uppercase; margin-top:3px; }
.ficha h1 { font-size:22pt; font-weight:800; margin:0; color:${TINTA}; text-transform:uppercase; letter-spacing:.5px; line-height:1.05; overflow-wrap:anywhere; }
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
/* Caja que reserva el espacio del documento YA escalado, para que el scroll y
   el centrado del modal cuadren con lo que se ve. */
.ficha-fit { margin:0 auto; position:relative; }
.ficha-fit > .ficha { transform-origin:top left; }
@media print {
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .oc-topbar, .oc-actions { display:none !important; }
  .ficha-fit { width:auto !important; height:auto !important; margin:0 !important; }
  .ficha-fit > .ficha { transform:none !important; }
  .ficha { width:auto !important; min-height:${PH}mm !important; box-shadow:none !important; }
  @page { size:Letter portrait; margin:0; }
}
`

export default function FichaTecnicaModal({ equipo, onClose }: { equipo: Equipo; onClose: () => void }) {
  const [ps] = usePrintSettings()
  const neg = ps.negocio

  // Escalado a medida: se mide el ancho disponible del modal y se reduce la hoja
  // para que entre completa. transform:scale no altera offsetWidth/Height, así que
  // el layout se calcula SIEMPRE a ancho Carta (sin encimados) y solo se ve más
  // chico. El ResizeObserver re-mide al rotar, cambiar de tamaño o cargar la tipografía.
  const scrollRef = useRef<HTMLDivElement>(null)
  const fichaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 1, w: DOC_PX, h: PH * 96 / 25.4 })

  const medir = useCallback(() => {
    const scroll = scrollRef.current, ficha = fichaRef.current
    if (!scroll || !ficha) return
    const PAD = 20                          // aire lateral dentro del área de vista
    const disponible = scroll.clientWidth - PAD * 2
    const w = ficha.offsetWidth || DOC_PX   // ancho real de la hoja (px)
    const h = ficha.offsetHeight            // alto natural según su contenido
    const scale = Math.min(1, disponible / w)
    setBox({ scale, w: w * scale, h: h * scale })
  }, [])

  useLayoutEffect(() => {
    medir()
    const scroll = scrollRef.current, ficha = fichaRef.current
    if (!scroll || !ficha) return
    const ro = new ResizeObserver(medir)
    ro.observe(scroll); ro.observe(ficha)
    return () => ro.disconnect()
  }, [medir, equipo])

  const specs = (equipo.especificaciones || []).filter(s => s.etiqueta && s.valor)
  const foto = resolveMediaUrl(equipo.imagen || equipo.imagenes?.[0] || '')
  // Dato destacado: la primera spec cuyo valor traiga potencia (kW / HP).
  const destacado = specs.find(s => /\b(kw|kva|hp)\b/i.test(s.valor))
  // Descripción como párrafo de presentación (recortada a un largo de ficha).
  const descripcion = (equipo.descripcion || '').trim()
  const descCorta = descripcion.length > 320 ? descripcion.slice(0, 317).trimEnd() + '…' : descripcion
  // "Incluye": el campo capturado en el producto ("Título: detalle" por línea).
  const incluye = (equipo.que_incluye || []).map(l => l.trim()).filter(Boolean)
  const condiciones = (equipo.condiciones || []).filter(Boolean)
  const condicion = condiciones.length
    ? condiciones.map(c => c === 'nueva' ? 'Nueva' : c === 'seminueva' ? 'Seminueva' : c).join(' y ')
    : (equipo.condicion === 'nueva' ? 'Nueva' : equipo.condicion === 'seminueva' ? 'Seminueva' : '')
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
    <Modal className="oc-overlay modal-in fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClose={onClose} label="Ficha técnica">
      <div className="oc-card bg-surface border border-edge rounded-t-2xl sm:rounded-2xl overflow-hidden w-full max-w-[880px] sm:my-4 flex flex-col max-h-[92vh] sm:max-h-[88vh]" onClick={e => e.stopPropagation()}>

        {/* Barra superior del modal: identidad + cerrar (no se imprime) */}
        <div className="oc-topbar flex items-center justify-between gap-3 px-4 py-3 border-b border-edge bg-surface shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gold/15 text-gold-ink flex items-center justify-center shrink-0">
              <FileText className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink leading-tight truncate">Ficha técnica</p>
              <p className="text-[11px] text-mute leading-tight truncate">{equipo.modelo}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full flex items-center justify-center text-mute hover:bg-surface-2 hover:text-ink transition-colors shrink-0">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Área de vista previa: "escritorio" con la hoja escalada al centro */}
        <div ref={scrollRef} className="oc-scroll flex-1 overflow-auto bg-gradient-to-b from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-900 px-5 py-6">
          <div className="ficha-fit" style={{ width: box.w, height: box.h }}>
            <div ref={fichaRef} className="ficha" style={{ transform: `scale(${box.scale})` }}>
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
        </div>

        {/* Acciones: tamaño fijo Carta, sin selector A4 (este negocio imprime en Carta) */}
        <div className="oc-actions flex items-center gap-3 p-3 sm:p-4 border-t border-edge bg-surface shrink-0">
          <span className="hidden sm:inline text-[11px] font-semibold text-mute uppercase tracking-wide">Tamaño carta</span>
          <button onClick={onClose} className="ml-auto px-5 py-2.5 rounded-full border border-edge text-mute text-sm font-semibold hover:text-ink hover:bg-surface-2 transition-colors">Cerrar</button>
          <button onClick={() => window.print()} className="px-5 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
            <Printer className="h-[18px] w-[18px]" />
            <span>Descargar / Imprimir</span>
          </button>
        </div>
      </div>
      <style>{CSS}</style>
    </Modal>,
    document.body,
  )
}
