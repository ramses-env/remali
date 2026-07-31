import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { toNumber } from '../lib/utils'
import { useCart, type Modalidad } from '../store/cart'
import { useToast } from '../store/toast'
import { usePriceUnit, formatCurrency, type PriceUnit } from '../store/priceUnit'
import { useProfile } from '../store/profile'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'
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
  condiciones?: string[]          // ojo: es el set nueva/seminueva de unidades, NO términos
  que_incluye?: string[]
  promo_pct?: number
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
// Etiqueta chica estilo monoespaciada (badges, secciones) del diseño nuevo.
const mono = 'font-mono text-[11px] tracking-[0.14em]'

export default function EquipoDetail() {
  const { id } = useParams()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const nav = useNavigate()
  const { unit, setUnit } = usePriceUnit()
  const { user } = useProfile()
  const cfg = useConfigPublica()
  const [e, setE] = useState<Equipo | null>(null)
  const [relacionados, setRelacionados] = useState<Equipo[]>([])
  const [notFound, setNotFound] = useState(false)
  const [fichaOpen, setFichaOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [tab, setTab] = useState<'specs' | 'incluye' | 'cond'>('specs')
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

  // Relacionados: misma categoría, sin el equipo actual.
  useEffect(() => {
    if (!e) { setRelacionados([]); return }
    let vivo = true
    // Misma categoría primero; si no alcanza, rellena con el resto del catálogo.
    api.get<Equipo[]>('/equipos/')
      .then(r => {
        if (!vivo) return
        const otros = (r.data || []).filter(x => x.id !== e.id)
        const mismaCat = otros.filter(x => x.categoria?.id && x.categoria.id === e.categoria?.id)
        const resto = otros.filter(x => !mismaCat.includes(x))
        setRelacionados([...mismaCat, ...resto].slice(0, 4))
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [e])

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
  const esRenta = modalidad !== 'venta'

  const precioDe = (m: Modalidad): number =>
    m === 'venta' ? (precioVenta ?? 0) :
    m === 'dia' ? (precioDia ?? precioSemana ?? precioMes ?? 0) :
    m === 'semana' ? (precioSemana ?? (precioDia ? precioDia * 7 : null) ?? precioMes ?? 0) :
    (precioMes ?? (precioDia ? precioDia * 30 : null) ?? (precioSemana ? precioSemana * 4 : null) ?? 0)
  const promo = Math.max(0, Math.min(90, e?.promo_pct || 0))
  const precioLista = precioDe(modalidad)
  // El precio que ve (y cotiza) el cliente ya trae la promo aplicada.
  const displayPrice = promo ? Math.round(precioLista * (1 - promo / 100) * 100) / 100 : precioLista

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
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-24 pb-10 grid grid-cols-1 min-[980px]:grid-cols-[minmax(0,1fr)_400px] gap-10 animate-pulse">
          <div><div className="h-[460px] bg-surface-2 rounded-2xl" /><div className="flex gap-2.5 mt-3">{[0, 1, 2].map(i => <div key={i} className="w-20 h-20 bg-surface-2 rounded-xl" />)}</div></div>
          <div className="h-96 bg-surface-2 rounded-[22px]" />
        </div>
      </div>
    )
  }

  const idxActiva = Math.max(0, images.indexOf(activeImage || ''))
  // Términos de renta REALES: los de Configuración › Negocio (una línea por punto).
  // Renta → términos de renta; venta → términos de venta. Ambos los edita el
  // admin en Configuración › Negocio (una línea por punto).
  const condLista = (seRenta ? (cfg.cotizacion_condiciones_renta || '') : (cfg.cotizacion_condiciones || ''))
    .split('\n').map(l => l.trim()).filter(Boolean)
  const incluyeLista = (e.que_incluye || []).filter(Boolean)
  const specs = e.especificaciones || []
  const disponibles = ([
    specs.length ? 'specs' : null,
    incluyeLista.length ? 'incluye' : null,
    condLista.length ? 'cond' : null,
  ].filter(Boolean)) as Array<'specs' | 'incluye' | 'cond'>
  const hayTabs = disponibles.length > 0
  const tabActiva = disponibles.includes(tab) ? tab : disponibles[0]

  // Confianza: las mismas promesas reales del sitio (sección "La diferencia REMALI").
  const confianza = [
    { t: 'Experiencia', s: 'Proyectos exigentes en toda la región' },
    { t: 'Procesos claros', s: 'Renta y venta sin letra pequeña' },
    { t: 'Soporte 24/7', s: 'Técnicos para emergencias en obra' },
    { t: 'Garantía', s: 'Equipos revisados y certificados' },
  ]

  const waMsg = `Hola REMALI, me interesa ${esRenta ? 'rentar' : 'comprar'}: ${e.modelo}`
  const telWa = cfg.whatsapp_principal || cfg.negocio_telefono

  return (
    <div className="bg-app min-h-screen text-ink">
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={subirImagenes} />

      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-24">
        {/* Breadcrumb */}
        <div className="pb-4 text-[13.5px] text-mute flex items-center gap-2 flex-wrap">
          <Link to="/equipos" className="hover:text-ink transition-colors">Equipos</Link>
          {e.categoria?.nombre && <><span>/</span><Link to="/equipos" className="hover:text-ink transition-colors">{e.categoria.nombre}</Link></>}
          <span>/</span><span className="text-ink font-semibold">{e.modelo}</span>
        </div>

        <div className="grid grid-cols-1 min-[980px]:grid-cols-[minmax(0,1fr)_400px] gap-10 items-start pb-16">
          {/* ── Columna izquierda ── */}
          <div className="min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-2.5 flex-wrap mb-4">
              {e.condicion && (
                <span className={`${mono} px-2.5 py-1.5 rounded-md border ${e.condicion === 'nueva'
                  ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25'
                  : 'text-blue-500 bg-blue-500/10 border-blue-500/25'}`}>
                  {e.condicion === 'nueva' ? 'NUEVO' : 'SEMINUEVO'}
                </span>
              )}
              <span className={`${mono} px-2.5 py-1.5 rounded-md text-gold bg-gold-soft border border-gold/25 uppercase`}>{availability}</span>
              {e.marca?.nombre && <span className={`${mono} px-2.5 py-1.5 rounded-md text-mute bg-surface-2 border border-edge uppercase`}>{e.marca.nombre}</span>}
            </div>

            <h1 className="text-[32px] sm:text-[42px] font-extrabold tracking-tight leading-[1.05]">{e.modelo}</h1>
            {e.descripcion && <p className="text-[16px] leading-relaxed text-mute mt-3 max-w-[640px]">{e.descripcion}</p>}

            {/* Galería: miniaturas + principal */}
            <div className="grid grid-cols-1 md:grid-cols-[92px_minmax(0,1fr)] gap-4 mt-7">
              <div className="hidden md:flex md:flex-col gap-3">
                {images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImage(img)} aria-label={`Vista ${i + 1}`}
                    className={`relative aspect-square rounded-xl border bg-surface overflow-hidden grid place-items-center transition-colors ${activeImage === img ? 'border-gold ring-1 ring-gold' : 'border-edge hover:border-gold/40'}`}>
                    <img src={resolveMediaUrl(img)} alt="" className="max-w-[80%] max-h-[80%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </button>
                ))}
                {isAdmin && (
                  <button onClick={() => fileInputRef.current?.click()} title="Subir fotos" aria-label="Subir fotos"
                    className="aspect-square rounded-xl border border-dashed border-edge text-mute grid place-items-center hover:text-gold hover:border-gold/40 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                  </button>
                )}
              </div>

              <div className="relative rounded-2xl overflow-hidden bg-surface border border-edge aspect-[4/3] grid place-items-center min-w-0">
                {activeSrc
                  ? <img src={activeSrc} alt={e.modelo} onClick={() => setFullImage(true)} className="max-w-full max-h-full object-contain cursor-zoom-in p-6" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={ev => { const t = ev.currentTarget; if (t.dataset.fb === '1') return; t.dataset.fb = '1'; t.src = '/vite.svg' }} />
                  : <span className="text-mute text-sm">Sin imagen</span>}
                {promo > 0 && (
                  <span className="absolute top-3.5 left-3.5 bg-red-600 text-white text-[12px] font-extrabold tracking-wide px-3 py-1.5 rounded-lg">PROMO −{promo}%</span>
                )}
                {images.length > 1 && (
                  <span className={`${mono} absolute bottom-3.5 right-3.5 px-2.5 py-1.5 rounded-lg bg-app/70 border border-edge backdrop-blur text-mute`}>
                    {idxActiva + 1} / {images.length}
                  </span>
                )}
              </div>
            </div>

            {/* Miniaturas (fila, móvil) + subir fotos */}
            {images.length > 1 && (
              <div className="flex md:hidden gap-2.5 mt-3 overflow-x-auto">
                {images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImage(img)} aria-label={`Vista ${i + 1}`}
                    className={`w-16 h-16 rounded-xl border bg-surface grid place-items-center overflow-hidden shrink-0 transition-colors ${activeImage === img ? 'border-gold ring-1 ring-gold' : 'border-edge'}`}>
                    <img src={resolveMediaUrl(img)} alt="" className="max-w-[80%] max-h-[80%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
            {isAdmin && <button onClick={() => fileInputRef.current?.click()} className="md:hidden mt-3 text-sm font-semibold text-gold hover:opacity-80">+ Subir fotos</button>}

            {/* Confianza */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              {confianza.map(c => (
                <div key={c.t} className="border border-edge rounded-xl bg-surface px-4 py-3.5">
                  <div className="text-[13.5px] font-bold">{c.t}</div>
                  <div className="text-[12.5px] text-mute mt-0.5 leading-snug">{c.s}</div>
                </div>
              ))}
            </div>

            {/* Tabs: especificaciones / condiciones de renta */}
            {hayTabs && (
              <>
                <div className="flex gap-7 border-b border-edge mt-11 overflow-x-auto">
                  {disponibles.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`pb-3.5 text-[15px] font-bold -mb-px border-b-2 whitespace-nowrap transition-colors ${tabActiva === t ? 'text-ink border-gold' : 'text-mute border-transparent hover:text-ink'}`}>
                      {t === 'specs' ? 'Especificaciones' : t === 'incluye' ? 'Qué incluye' : seRenta ? 'Condiciones de renta' : 'Condiciones de venta'}
                    </button>
                  ))}
                </div>

                {tabActiva === 'specs' && (
                  <div className="grid sm:grid-cols-2 gap-x-14 pt-2">
                    {specs.map((s, i) => (
                      <div key={i} className="flex justify-between items-baseline gap-4 py-[13px] border-b border-edge/60">
                        <span className="text-[14.5px] text-mute">{s.etiqueta}</span>
                        <span className="text-[14.5px] font-semibold text-right">{s.valor}</span>
                      </div>
                    ))}
                  </div>
                )}
                {tabActiva === 'incluye' && (
                  <div className="grid sm:grid-cols-2 gap-x-14 gap-y-4 pt-6">
                    {incluyeLista.map((l, i) => {
                      const [titulo, ...resto] = l.split(':')
                      const detalle = resto.join(':').trim()
                      return (
                        <div key={i} className="flex gap-3 items-start">
                          <span className="w-[7px] h-[7px] rounded-[2px] bg-gold mt-2 flex-none" />
                          <div>
                            <div className="text-[15px] font-semibold">{titulo.trim()}</div>
                            {detalle && <div className="text-[13.5px] text-mute leading-relaxed mt-0.5">{detalle}</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {tabActiva === 'cond' && (
                  <div className="flex flex-col gap-3.5 pt-6 max-w-[720px]">
                    {condLista.map((c, i) => (
                      <div key={i} className="flex gap-3.5 items-start border border-edge bg-surface rounded-xl px-4.5 p-4">
                        <span className={`${mono} text-gold mt-0.5`}>{String(i + 1).padStart(2, '0')}</span>
                        <p className="text-[13.5px] text-mute leading-relaxed">{c}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Panel de compra (sticky) ── */}
          <aside className="min-[980px]:sticky min-[980px]:top-24 border border-edge rounded-[22px] bg-surface p-6 flex flex-col gap-5 min-w-0">
            {/* Comprar / Rentar */}
            {seVende && seRenta ? (
              <div className="grid grid-cols-2 gap-1.5 bg-app border border-edge rounded-xl p-1">
                <button onClick={() => elegirModalidad('venta')}
                  className={`h-10 rounded-lg text-[14.5px] font-bold transition-colors ${!esRenta ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}>Comprar</button>
                <button onClick={() => elegirModalidad(modalidades.includes(unit) && unit !== ('venta' as Modalidad) ? unit : 'dia')}
                  className={`h-10 rounded-lg text-[14.5px] font-bold transition-colors ${esRenta ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}>Rentar</button>
              </div>
            ) : (
              <div className={`${mono} text-mute`}>{seRenta ? 'EQUIPO EN RENTA' : 'EQUIPO EN VENTA'}</div>
            )}

            {/* Precio */}
            <div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[38px] font-extrabold tracking-tight text-price leading-none">${formatCurrency(displayPrice)}</span>
                {promo > 0 && <span className="text-[16px] text-mute line-through">${formatCurrency(precioLista)}</span>}
              </div>
              <div className="text-[13px] text-mute mt-2">
                {esRenta
                  ? `Renta por ${UNIT_LABEL[modalidad as PriceUnit]} · sin IVA · con factura se suma 16%`
                  : 'Precio de venta · IVA incluido · factura disponible'}
              </div>
            </div>

            {/* Periodo (solo renta) */}
            {esRenta && (
              <div>
                <div className={`${mono} text-mute mb-2.5`}>PERIODO</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['dia', 'semana', 'mes'] as PriceUnit[]).map(p => (
                    <button key={p} onClick={() => elegirModalidad(p)}
                      className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl border transition-colors ${modalidad === p ? 'border-gold bg-gold-soft' : 'border-edge bg-app hover:border-gold/40'}`}>
                      <span className="text-[13.5px] font-bold capitalize">{UNIT_LABEL[p]}</span>
                      <span className="text-[12px] text-mute">${formatCurrency(precioDe(p)).replace('.00', '')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cantidad */}
            <div className="flex items-center justify-between gap-4">
              <div className={`${mono} text-mute`}>{esRenta ? 'EQUIPOS' : 'CANTIDAD'}</div>
              <div className="flex items-center border border-edge rounded-xl bg-app overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">−</button>
                <span className="min-w-[38px] text-center text-[15px] font-bold">{qty}</span>
                <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">+</button>
              </div>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between border-y border-edge py-3.5">
              <span className="text-sm text-mute">{esRenta ? `Total por ${UNIT_LABEL[modalidad as PriceUnit]}` : 'Total'}</span>
              <span className="text-xl font-extrabold">${formatCurrency(displayPrice * qty)}</span>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-2.5">
              <button onClick={() => { addToCart(); nav('/cotizacion') }}
                className="h-[52px] rounded-[14px] bg-gold text-black text-[15.5px] font-extrabold btn-acento">Solicitar cotización</button>
              <button onClick={() => { addToCart(); notify('Añadido a tu cotización') }}
                className="h-[50px] rounded-[14px] border border-edge text-ink text-[14.5px] font-semibold hover:bg-surface-2 transition-colors">Agregar a mi cotización</button>
              {telWa && (
                <a href={waLink(telWa, waMsg)} target="_blank" rel="noopener noreferrer"
                  className="h-[46px] rounded-[14px] bg-emerald-500/12 text-emerald-500 text-[14px] font-bold grid place-items-center hover:bg-emerald-500/20 transition-colors">
                  WhatsApp · respuesta rápida
                </a>
              )}
            </div>

            {/* Datos */}
            <div className="flex flex-col gap-2.5 text-[13.5px]">
              {[
                { k: 'Disponibilidad', v: availability, verde: hayStock },
                { k: 'Categoría', v: e.categoria?.nombre || '—' },
                { k: 'Tipo', v: e.tipo?.nombre || '—' },
                { k: 'Marca', v: e.marca?.nombre || '—' },
                { k: 'Condición', v: e.condicion ? (e.condicion === 'nueva' ? 'Nueva' : 'Seminueva') : '—' },
              ].map(f => (
                <div key={f.k} className="flex justify-between gap-3">
                  <span className="text-mute">{f.k}</span>
                  <span className={`font-semibold text-right ${f.verde ? 'text-emerald-500' : ''}`}>{f.v}</span>
                </div>
              ))}
            </div>

            {/* Ficha técnica: solo equipos de venta (nuevos). */}
            {e.condicion !== 'seminueva' && (
              <button onClick={descargarFicha}
                className="flex items-center justify-center gap-2 border-t border-edge pt-4 text-[14px] font-semibold text-mute hover:text-gold transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar ficha técnica (PDF)
              </button>
            )}
          </aside>
        </div>

        {/* Relacionados */}
        {relacionados.length > 0 && (
          <section className="pb-20">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-[24px] font-extrabold tracking-tight">
                {e.condicion === 'seminueva' ? 'Se renta junto con' : 'También te puede interesar'}
              </h2>
              <Link to="/equipos" className="text-sm font-semibold text-gold hover:opacity-80">Ver catálogo →</Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {relacionados.map(r => {
                const rModo = r.condicion === 'seminueva' ? 'renta' : 'venta'
                const rPrecio = rModo === 'venta' ? toNumber(r.precio_venta) : toNumber(r.precio_dia)
                return (
                  <Link key={r.id} to={`/equipo/${r.id}`}
                    className="border border-edge rounded-2xl bg-surface overflow-hidden hover:border-gold/40 transition-colors group">
                    <div className="aspect-[4/3] bg-surface-2 grid place-items-center overflow-hidden">
                      {r.imagen || (r.imagenes || [])[0]
                        ? <img src={resolveMediaUrl(r.imagen || (r.imagenes || [])[0])} alt={r.modelo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                        : <span className="text-mute text-xs">Sin imagen</span>}
                    </div>
                    <div className="p-4">
                      <div className="text-[14.5px] font-bold leading-snug line-clamp-1">{r.modelo}</div>
                      <div className="text-[12.5px] text-mute mt-0.5 capitalize">{rModo === 'venta' ? 'Venta' : 'Renta'}</div>
                      {rPrecio !== null && (
                        <div className="text-[15px] font-extrabold text-gold mt-2.5">
                          ${formatCurrency(rPrecio)}{rModo === 'renta' ? ' / día' : ''}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}
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
