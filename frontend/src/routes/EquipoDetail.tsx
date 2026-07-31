import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { toNumber } from '../lib/utils'
import { useCart, type Modalidad } from '../store/cart'
import { useToast } from '../store/toast'
import { usePriceUnit, formatCurrency, type PriceUnit } from '../store/priceUnit'
import { useProfile } from '../store/profile'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import FichaTecnicaModal from '../components/FichaTecnicaModal'

type Equipo = {
  id: number
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  ficha_tecnica?: string | null
  especificaciones?: { etiqueta: string; valor: string }[]
  precio_venta?: number | string | null
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  condicion?: string
  disponible_venta?: boolean
  disponible_renta?: boolean
  stock_disponible?: number
  estado?: string
  categoria?: { id: number; nombre: string }
  tipo?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
}

const UNIT_LABEL: Record<PriceUnit, string> = { dia: 'día', semana: 'semana', mes: 'mes' }
const MOD_BTN: Record<Modalidad, string> = { venta: 'Comprar', dia: 'Día', semana: 'Semana', mes: 'Mes' }

export default function EquipoDetail() {
  const { id } = useParams()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const nav = useNavigate()
  const { unit, setUnit } = usePriceUnit()
  const { user } = useProfile()
  const [e, setE] = useState<Equipo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fichaOpen, setFichaOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const images = useMemo(() => {
    const base = e?.imagen ? [e.imagen] : []
    return [...uploadedImages, ...base, ...(e?.imagenes || [])]
  }, [e, uploadedImages])
  const [activeImage, setActiveImage] = useState<string | undefined>(undefined)
  const [fullImage, setFullImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isAdmin = useMemo(() => (user ? (user.is_staff || (user.groups || []).includes('Administrador')) : false), [user])
  const activeSrc = resolveMediaUrl(activeImage)

  useEffect(() => {
    setNotFound(false)
    api.get<Equipo>(`/equipos/${id}/`).then(r => setE(r.data)).catch(() => setNotFound(true))
  }, [id])
  useEffect(() => { setActiveImage(e?.imagen || (e?.imagenes || [])[0] || undefined) }, [e])

  const precioVenta = toNumber(e?.precio_venta)
  const precioDia = toNumber(e?.precio_dia)
  const precioSemana = toNumber(e?.precio_semana)
  const precioMes = toNumber(e?.precio_mes)
  const seRenta = precioDia !== null || precioSemana !== null || precioMes !== null
  const seVende = precioVenta !== null

  // Modalidades que este equipo realmente ofrece (hay quien solo se vende).
  const modalidades = useMemo<Modalidad[]>(() => {
    const m: Modalidad[] = []
    if (seVende) m.push('venta')
    if (seRenta) m.push('dia', 'semana', 'mes')
    return m.length ? m : ['venta']
  }, [seVende, seRenta])

  // 'venta' o una unidad de renta. Arranca en la unidad global del catálogo,
  // y se corrige si este equipo no ofrece esa modalidad.
  const [modalidad, setModalidad] = useState<Modalidad>(unit)
  useEffect(() => {
    if (!modalidades.includes(modalidad)) setModalidad(modalidades.includes(unit) ? unit : modalidades[0])
  }, [modalidades])           // eslint-disable-line react-hooks/exhaustive-deps

  const displayPrice =
    modalidad === 'venta' ? (precioVenta ?? 0) :
    modalidad === 'dia' ? (precioDia ?? precioSemana ?? precioMes ?? 0) :
    modalidad === 'semana' ? (precioSemana ?? (precioDia ? precioDia * 7 : null) ?? precioMes ?? 0) :
    (precioMes ?? (precioDia ? precioDia * 30 : null) ?? (precioSemana ? precioSemana * 4 : null) ?? 0)

  function elegirModalidad(m: Modalidad) {
    setModalidad(m)
    if (m !== 'venta') setUnit(m)   // mantiene sincronizado el selector global del catálogo
  }

  const availability = useMemo(() => {
    const v = e?.disponible_venta, r = e?.disponible_renta
    if (v && r) return 'Renta y venta'
    if (v) return 'Venta'
    if (r) return 'Renta'
    return 'No disponible'
  }, [e])
  const hayStock = availability !== 'No disponible'

  async function subirImagenes(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || [])
    if (files.length === 0) return
    const urls = files.map(f => URL.createObjectURL(f))
    setUploadedImages(prev => [...prev, ...urls])
    if (!activeImage && urls[0]) setActiveImage(urls[0])
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('images', f))
      await api.post(`/equipos/${id}/imagenes/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const r = await api.get<Equipo>(`/equipos/${id}/`)
      setE(r.data); setUploadedImages([]); notify('Imágenes subidas')
    } catch { notify('Error al subir imágenes') } finally { ev.target.value = '' }
  }

  function addToCart() {
    if (!e) return
    dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id: e.id, title: e.modelo, price: displayPrice, qty, image: activeSrc || '', unit: modalidad } })
  }

  function descargarFicha() {
    if (e?.ficha_tecnica) window.open(resolveMediaUrl(e.ficha_tecnica), '_blank', 'noopener,noreferrer')
    else setFichaOpen(true)
  }

  if (notFound) {
    return (
      <div className="bg-app min-h-screen text-ink flex flex-col items-center justify-center py-32 px-6 text-center">
        <p className="text-xl font-bold">Equipo no encontrado</p>
        <p className="text-mute text-sm mt-2">Puede que ya no esté en el catálogo.</p>
        <Link to="/equipos" className="mt-6 px-5 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90">Volver al catálogo</Link>
      </div>
    )
  }
  if (!e) {
    return (
      <div className="bg-app min-h-screen text-ink">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-12 pt-24 pb-10 grid grid-cols-1 min-[900px]:grid-cols-[1.15fr_0.85fr] gap-9 animate-pulse">
          <div><div className="h-[460px] bg-surface-2 rounded-2xl" /><div className="flex gap-2.5 mt-3">{[0, 1, 2].map(i => <div key={i} className="w-[78px] h-[78px] bg-surface-2 rounded-[10px]" />)}</div></div>
          <div className="h-80 bg-surface-2 rounded-2xl" />
        </div>
      </div>
    )
  }

  const seg = (m: Modalidad) => (
    <button key={m} onClick={() => elegirModalidad(m)}
      className={`px-2.5 py-[7px] text-[12.5px] font-bold whitespace-nowrap transition-colors ${modalidad === m ? 'bg-ink text-app' : 'bg-surface text-ink hover:bg-surface-2'}`}>
      {MOD_BTN[m]}
    </button>
  )

  return (
    <div className="bg-app min-h-screen text-ink">
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={subirImagenes} />

      <div className="max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-12 pt-24">
        <div className="pb-1 text-[13px] text-mute">
          <Link to="/equipos" className="text-gold hover:underline">Equipos</Link> <span className="mx-0.5">/</span> <span className="text-ink font-semibold">{e.modelo}</span>
        </div>

        <div className="grid grid-cols-1 min-[900px]:grid-cols-[1.15fr_0.85fr] gap-9 items-start pt-2 pb-16">
          {/* ── Columna izquierda: galería + info ── */}
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              {/* Miniaturas circulares (columna izquierda, desktop) — como el diseño anterior */}
              <div className="hidden md:flex md:flex-col md:gap-3 shrink-0">
                {isAdmin && (
                  <button onClick={() => fileInputRef.current?.click()} title="Subir fotos" aria-label="Subir fotos"
                    className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 border-edge bg-surface grid place-items-center text-mute hover:text-gold hover:border-gold/40 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                  </button>
                )}
                {images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImage(img)} aria-label={`Vista ${i + 1}`}
                    className={`w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 bg-surface grid place-items-center overflow-hidden transition-colors ${activeImage === img ? 'ring-2 ring-gold border-gold' : 'border-edge hover:border-gold/40'}`}>
                    <img src={resolveMediaUrl(img)} alt="" className="max-w-[70%] max-h-[70%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>

              {/* Imagen principal */}
              <div className="relative flex-1 min-w-0 rounded-2xl overflow-hidden bg-surface border border-edge h-[380px] sm:h-[460px] flex items-center justify-center">
                {activeSrc
                  ? <img src={activeSrc} alt={e.modelo} onClick={() => setFullImage(true)} className="max-w-full max-h-full object-contain cursor-zoom-in p-6" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={ev => { const t = ev.currentTarget; if (t.dataset.fb === '1') return; t.dataset.fb = '1'; t.src = '/vite.svg' }} />
                  : <span className="text-mute text-sm">Sin imagen</span>}
                <div className="absolute top-3.5 left-3.5 flex gap-1.5">
                  {e.condicion && <span className={`text-[11px] font-extrabold tracking-wide px-2.5 py-1 rounded-md ${e.condicion === 'nueva' ? 'bg-emerald-500/12 text-emerald-600' : 'bg-blue-500/12 text-blue-600'}`}>{e.condicion === 'nueva' ? 'NUEVO' : 'SEMINUEVO'}</span>}
                  {e.disponible_renta && <span className="text-[11px] font-extrabold tracking-wide px-2.5 py-1 rounded-md bg-surface-2 text-mute">RENTA</span>}
                  {e.disponible_venta && <span className="text-[11px] font-extrabold tracking-wide px-2.5 py-1 rounded-md bg-surface-2 text-mute">VENTA</span>}
                </div>
              </div>
            </div>

            {/* Miniaturas circulares (fila, solo móvil) */}
            {images.length > 1 && (
              <div className="flex md:hidden gap-2.5 mt-3 overflow-x-auto">
                {images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImage(img)} aria-label={`Vista ${i + 1}`}
                    className={`w-14 h-14 rounded-full border-2 bg-surface grid place-items-center overflow-hidden shrink-0 transition-colors ${activeImage === img ? 'ring-2 ring-gold border-gold' : 'border-edge hover:border-gold/40'}`}>
                    <img src={resolveMediaUrl(img)} alt="" className="max-w-[70%] max-h-[70%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
            {/* Subir fotos (móvil, admin) */}
            {isAdmin && (
              <button onClick={() => fileInputRef.current?.click()} className="md:hidden mt-3 text-sm font-semibold text-gold hover:opacity-80">+ Subir fotos</button>
            )}

            <div className="mt-8">
              <h1 className="text-[26px] font-extrabold text-ink leading-tight">{e.modelo}</h1>
              <div className="text-[14.5px] text-mute leading-relaxed mt-3.5 max-w-[560px]">{e.descripcion || 'Sin descripción.'}</div>
            </div>

            {e.especificaciones && e.especificaciones.length > 0 && (
              <div className="mt-8">
                <p className="text-sm font-extrabold text-ink flex items-center gap-2 mb-3"><span className="w-1.5 h-4 rounded-full bg-gold" /> Especificaciones técnicas</p>
                <div className="grid sm:grid-cols-2 gap-x-8">
                  {e.especificaciones.map((s, i) => (
                    <div key={i} className="flex justify-between gap-3 py-2 border-b border-edge/60 last:border-0">
                      <span className="text-mute text-sm">{s.etiqueta}</span>
                      <span className="text-ink text-sm font-semibold text-right">{s.valor}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Columna derecha: panel de compra (sticky) ── */}
          <div className="min-[900px]:sticky min-[900px]:top-24 bg-surface border border-edge rounded-2xl p-6 min-w-0">
            <div className="flex flex-col min-[900px]:flex-row items-start min-[900px]:items-baseline justify-between gap-2.5 flex-wrap mb-1">
              <div className="text-[32px] font-extrabold text-price leading-none">${formatCurrency(displayPrice)}</div>
              {modalidades.length > 1 && (
                <div className="flex border border-edge rounded-[9px] overflow-hidden shrink-0">
                  {modalidades.map(seg)}
                </div>
              )}
            </div>
            <div className="text-[12.5px] text-mute mb-5">
              {modalidad === 'venta' ? 'Precio de venta' : `Precio por ${UNIT_LABEL[modalidad]}`} · {availability.toLowerCase()}
            </div>

            <div className="border-y border-edge py-[18px] mb-5">
              <div className="text-[12px] font-bold text-mute mb-2.5">CANTIDAD</div>
              <div className="inline-flex items-center gap-3.5 border border-edge rounded-[9px] px-2 py-1.5">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-7 h-7 rounded-md grid place-items-center font-bold text-ink hover:bg-surface-2">−</button>
                <span className="min-w-[16px] text-center font-bold text-sm">{qty}</span>
                <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-7 h-7 rounded-md grid place-items-center font-bold text-ink hover:bg-surface-2">+</button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 mb-6">
              <button onClick={() => { addToCart(); nav('/cotizacion') }} className="text-center py-3.5 rounded-[10px] bg-gold text-black font-bold text-[14.5px] hover:opacity-90 transition-opacity">Solicitar cotización</button>
              <button onClick={() => { addToCart(); notify('Añadido a tu cotización') }} className="text-center py-3.5 rounded-[10px] border border-edge text-ink font-bold text-[14.5px] hover:bg-surface-2 transition-colors">Añadir al carrito</button>
              {/* La ficha técnica es solo para equipos de venta (nuevos). */}
              {e.condicion !== 'seminueva' && (
                <button onClick={descargarFicha} className="flex items-center justify-center gap-2 py-3 rounded-[10px] text-mute font-semibold text-[13.5px] hover:text-ink transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Descargar ficha técnica
                </button>
              )}
            </div>

            <div className="border-t border-edge pt-[18px] grid grid-cols-2 gap-x-5 gap-y-4">
              {[
                { k: 'DISPONIBILIDAD', v: availability, green: hayStock },
                { k: 'ESTADO', v: e.estado || '—' },
                { k: 'CATEGORÍA', v: e.categoria?.nombre || '—' },
                { k: 'TIPO', v: e.tipo?.nombre || '—' },
                { k: 'MARCA', v: e.marca?.nombre || '—' },
                { k: 'CONDICIÓN', v: e.condicion ? (e.condicion === 'nueva' ? 'Nueva' : 'Seminueva') : '—' },
              ].map(f => (
                <div key={f.k}>
                  <div className="text-[11px] font-bold tracking-wide text-mute mb-1">{f.k}</div>
                  <div className={`text-[13.5px] font-bold ${f.green ? 'text-emerald-600' : 'text-ink'}`}>{f.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {fullImage && activeSrc && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setFullImage(false)}>
          <div className="relative w-[94vw] max-w-5xl h-[82vh] rounded-2xl bg-surface border border-edge p-4 sm:p-6" onClick={ev => ev.stopPropagation()}>
            <img src={activeSrc} alt={e.modelo} className="w-full h-full object-contain" crossOrigin="anonymous" referrerPolicy="no-referrer" />
            <button aria-label="Cerrar" onClick={() => setFullImage(false)} className="absolute top-3 right-3 w-10 h-10 rounded-full bg-surface border border-edge text-ink grid place-items-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      )}

      {fichaOpen && <FichaTecnicaModal equipo={e} onClose={() => setFichaOpen(false)} />}
    </div>
  )
}
