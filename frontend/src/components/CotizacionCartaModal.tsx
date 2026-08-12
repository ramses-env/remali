import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X, FileText, Download } from 'lucide-react'
import { usePrintSettings } from '../lib/printSettings'
import { formatMoney } from '../lib/utils'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import api from '../lib/api'
import { descargarBlob } from '../lib/descargar'
import LogoRemali from './ui/logo-remali'

type Item = { id: number; descripcion: string; cantidad: number; precio_unitario: string; subtotal: string; modalidad_label?: string; equipo?: number | null; equipo_imagen?: string | null }
type Foto = { id: number; imagen: string; orden: number }
type Cotizacion = {
  id: number; folio: string | null; estado: string; tipo: string
  cliente_display: string; cliente_telefono: string
  vigencia_dias: number; vigencia_hasta?: string | null; aplica_iva: boolean; notas: string
  items: Item[]; fotos?: Foto[]; subtotal: string; base: string; iva: string; total: string; descuento_cupon?: string; creada: string
}

// La carta se maqueta SIEMPRE a tamaño Carta (216 × 279 mm). En pantalla se
// reduce con un escalado uniforme para que entre completa en cualquier ancho
// (móvil incluido) sin cortarse; al imprimir se resetea a tamaño real.
const PW = 216, PH = 279
const DOC_PX = (PW * 96) / 25.4   // ancho del documento en px (~816)

const CSS = (acento: string) => `
.cot-carta { width: ${PW}mm; min-height: ${PH}mm; background:#fff; color:#111827; padding: 13mm; box-sizing:border-box; font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:10pt; line-height:1.35; box-shadow:0 18px 50px rgba(17,24,39,.22); }
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
/* Caja que reserva el espacio del documento YA escalado, para que el scroll y
   el centrado del modal cuadren con lo que se ve. */
.carta-fit { margin:0 auto; position:relative; }
.carta-fit > .cot-carta { transform-origin:top left; }
@media print {
  .cot-carta .cot-fotos img { break-inside:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cot-carta .box, .cot-carta .cot-fotos, .cot-carta table tr { break-inside:avoid; }
  body > #root { display:none !important; }
  .oc-overlay { position:static !important; inset:auto !important; background:#fff !important; backdrop-filter:none !important; padding:0 !important; display:block !important; }
  .oc-card { border:0 !important; border-radius:0 !important; max-width:none !important; width:auto !important; box-shadow:none !important; overflow:visible !important; }
  .oc-scroll { max-height:none !important; overflow:visible !important; background:#fff !important; padding:0 !important; display:block !important; }
  .oc-topbar, .oc-actions { display:none !important; }
  .carta-fit { width:auto !important; height:auto !important; margin:0 !important; }
  .carta-fit > .cot-carta { transform:none !important; }
  .cot-carta { width:auto !important; min-height:auto !important; padding:0 !important; box-shadow:none !important; }
  @page { size: Letter portrait; margin: 13mm; }
}
`

const ESTADO_LABEL: Record<string, string> = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada' }
const TIPO_LABEL: Record<string, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }
// Acento del documento según el tipo: venta = azul, renta = naranja. (El dorado
// queda reservado para mantenimiento.) Mixta va con el azul de venta.
const ACENTO_TIPO: Record<string, string> = { venta: '#2B5FAD', renta: '#EA580C', mixta: '#2B5FAD' }

export default function CotizacionCartaModal({ cotizacion, onClose }: { cotizacion: Cotizacion; onClose: () => void }) {
  const [ps] = usePrintSettings()
  const [descargando, setDescargando] = useState(false)
  const [errPdf, setErrPdf] = useState('')
  const neg = ps.negocio
  const acento = ACENTO_TIPO[cotizacion.tipo] || '#B8872E'

  // Escalado a medida: se mide el ancho disponible del modal y se reduce la hoja
  // para que entre completa. transform:scale no altera offsetWidth/Height, así que
  // el layout se calcula SIEMPRE a ancho Carta (sin cortes) y solo se ve más chico.
  const scrollRef = useRef<HTMLDivElement>(null)
  const cartaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 1, w: DOC_PX, h: PH * 96 / 25.4 })

  const medir = useCallback(() => {
    const scroll = scrollRef.current, carta = cartaRef.current
    if (!scroll || !carta) return
    const PAD = 20
    const disponible = scroll.clientWidth - PAD * 2
    const w = carta.offsetWidth || DOC_PX
    const h = carta.offsetHeight
    const scale = Math.min(1, disponible / w)
    setBox({ scale, w: w * scale, h: h * scale })
  }, [])

  useLayoutEffect(() => {
    medir()
    const scroll = scrollRef.current, carta = cartaRef.current
    if (!scroll || !carta) return
    const ro = new ResizeObserver(medir)
    ro.observe(scroll); ro.observe(carta)
    return () => ro.disconnect()
  }, [medir, cotizacion])

  // Fotos de la carta: primero las que el admin subió a mano; si no hay ninguna
  // (típico si la cotización la armó el cliente desde la tienda), se respalda con
  // la imagen de cada equipo cotizado —sin repetir— para que la de venta también
  // salga con fotos. Coincide con lo que hace el PDF de reportlab.
  const fotosCarta: { id: string; src: string }[] =
    cotizacion.fotos && cotizacion.fotos.length > 0
      ? cotizacion.fotos.map(f => ({ id: `f${f.id}`, src: resolveMediaUrl(f.imagen) }))
      : [...new Map(
          cotizacion.items
            .filter(it => it.equipo_imagen)
            .map(it => {
              const k = it.equipo ?? `i${it.id}`
              return [k, { id: `e${k}`, src: resolveMediaUrl(it.equipo_imagen as string) }] as const
            })
        ).values()]

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
    <div className="oc-overlay modal-in fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div className="oc-card bg-surface border border-edge rounded-t-2xl sm:rounded-2xl overflow-hidden w-full max-w-[880px] sm:my-4 flex flex-col max-h-[92vh] sm:max-h-[88vh]" onClick={e => e.stopPropagation()}>

        {/* Barra superior del modal: identidad + cerrar (no se imprime) */}
        <div className="oc-topbar flex items-center justify-between gap-3 px-4 py-3 border-b border-edge bg-surface shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${acento}22`, color: acento }}>
              <FileText className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink leading-tight truncate">Cotización {cotizacion.folio || ''}</p>
              <p className="text-[11px] text-mute leading-tight truncate">{TIPO_LABEL[cotizacion.tipo] || 'Venta'} · {ESTADO_LABEL[cotizacion.estado] || cotizacion.estado} · Carta</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full flex items-center justify-center text-mute hover:bg-surface-2 hover:text-ink transition-colors shrink-0">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Área de vista previa: "escritorio" con la hoja escalada al centro */}
        <div ref={scrollRef} className="oc-scroll flex-1 overflow-auto bg-gradient-to-b from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-900 px-5 py-6">
          <div className="carta-fit" style={{ width: box.w, height: box.h }}>
            <div ref={cartaRef} className="cot-carta" style={{ transform: `scale(${box.scale})` }}>
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
                  {Number(cotizacion.descuento_cupon) > 0 && <div className="row"><span className="muted">Descuento cupón</span><span>−{money(cotizacion.descuento_cupon)}</span></div>}
                  <div className="row" style={{ borderTop: '1px solid #E5E7EB', marginTop: 4, paddingTop: 6, fontWeight: 800, fontSize: '13pt' }}><span>TOTAL</span><span style={{ color: acento }}>{money(cotizacion.total)}</span></div>
                  {cotizacion.tipo !== 'renta' && <div className="row" style={{ marginTop: 4 }}><span className="muted" style={{ fontSize: '9pt' }}>Contado (−5%)</span><span className="muted" style={{ fontSize: '9pt' }}>{money(Number(cotizacion.total) * 0.95)}</span></div>}
                </div>
              </div>

              {cotizacion.notas && (<>
                <div className="sect-title">Notas</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>{cotizacion.notas}</div>
              </>)}

              {fotosCarta.length > 0 && (<>
                <div className="sect-title">Fotos</div>
                <div className="cot-fotos">
                  {fotosCarta.map(f => (
                    <img key={f.id} src={f.src} alt="Equipo cotizado" />
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
                  // Cada tipo con SUS condiciones; una cotización mixta lleva los dos
                  // bloques rotulados por separado, para que no se mezclen las de
                  // venta con las de renta.
                  ...(cotizacion.tipo === 'mixta'
                    ? [
                        neg.condiciones && `CONDICIONES DE VENTA\n${neg.condiciones}`,
                        neg.condicionesRenta && `CONDICIONES DE RENTA\n${neg.condicionesRenta}`,
                      ]
                    : [cotizacion.tipo === 'renta' ? neg.condicionesRenta : neg.condiciones]),
                  `Precios en pesos mexicanos (MXN)${Number(cotizacion.iva) > 0 ? ', IVA incluido en el total' : ', más IVA si aplica'}. Cotización válida por ${cotizacion.vigencia_dias} días. Sujeta a disponibilidad.`,
                ].filter(Boolean).join('\n\n')}
              </p>
            </div>
          </div>
        </div>

        {errPdf && <div className="oc-actions px-4 pt-2 text-[12px] text-red-500 text-right shrink-0">{errPdf}</div>}

        {/* Acciones: tamaño fijo Carta, sin selector A4 (este negocio imprime en Carta) */}
        <div className="oc-actions flex items-center gap-2 p-3 sm:p-4 border-t border-edge bg-surface shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-mute text-sm font-semibold hover:text-ink hover:bg-surface-2 transition-colors">Cerrar</button>
          <button onClick={descargarPDF} disabled={descargando} className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {descargando
              ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
              : <Download className="h-[18px] w-[18px]" />}
            <span>{descargando ? 'Generando…' : 'Descargar PDF'}</span>
          </button>
          <button onClick={() => window.print()} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
            <Printer className="h-[18px] w-[18px]" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>
      <style>{CSS(acento)}</style>
    </div>,
    document.body,
  )
}
