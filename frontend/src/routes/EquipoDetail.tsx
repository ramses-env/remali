import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import { toNumber, tituloCaso } from '../lib/utils'
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
  modos?: Array<'venta' | 'renta'>
  venta_estado?: 'sin_venta' | 'inmediata' | 'sobre_pedido' | 'agotado'
  disponible_venta?: boolean
  disponible_renta?: boolean
  stock_disponible?: number
  estado?: string
  categoria?: { id: number; nombre: string }
  tipo?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
}

const UNIT_LABEL: Record<PriceUnit, string> = { dia: 'día', semana: 'semana', mes: 'mes' }
const periodoLabel = (u: PriceUnit, n: number) =>
  n === 1 ? UNIT_LABEL[u] : ({ dia: 'días', semana: 'semanas', mes: 'meses' } as Record<PriceUnit, string>)[u]
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
  const [qty, setQty] = useState(1)          // cuántas máquinas
  const [dias, setDias] = useState(1)        // cuántos periodos (día/semana/mes) en renta
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
  const condiciones = (e?.condiciones || []).filter(Boolean)
  // Modos que ofrece el producto: si el backend manda las banderas (unidades +
  // precios), un mismo modelo puede venderse Y rentarse. Si no, se cae a la
  // condición de siempre (comportamiento anterior).
  const ext = (e || {}) as { ofrece_venta?: boolean; ofrece_renta?: boolean; venta_disponible?: boolean; renta_disponible?: boolean; entrega_estimada_dias?: number | null; venta_estado?: 'sin_venta' | 'inmediata' | 'sobre_pedido' | 'agotado' }
  const seRenta = ext.ofrece_renta ?? (e ? condiciones.includes('seminueva') : false)
  const seVende = ext.ofrece_venta ?? (e ? (precioVenta !== null && precioVenta > 0) : false)

  // Modalidades que este equipo realmente ofrece (hay quien solo se vende).
  const modalidades = useMemo<Modalidad[]>(() => {
    const m: Modalidad[] = []
    if (seVende) m.push('venta')
    if (seRenta) m.push('dia', 'semana', 'mes')
    if (m.length) return m
    // Sin modo disponible: cae a RENTA si el producto tiene tarifa (las seminuevas
    // se rentan, no se promocionan para venta); solo si no hay tarifa, a venta.
    return (precioDia || precioSemana || precioMes) ? ['dia', 'semana', 'mes'] : ['venta']
  }, [seVende, seRenta, precioDia, precioSemana, precioMes])

  // Si venimos de una card de Venta (?ver=venta), arrancamos en venta; si no,
  // en la unidad global del catálogo. Se corrige si el equipo no la ofrece.
  const [searchParams] = useSearchParams()
  const [modalidad, setModalidad] = useState<Modalidad>(searchParams.get('ver') === 'venta' ? 'venta' : unit)
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

  // Según el modo que el cliente está viendo ahora (venta o renta).
  const availability = esRenta ? 'Renta' : 'Venta'
  const hayStock = esRenta ? (ext.renta_disponible ?? e?.disponible_renta ?? true) : ((ext.venta_estado ? ext.venta_estado === 'inmediata' : undefined) ?? ext.venta_disponible ?? e?.disponible_venta ?? true)
  // Estado de existencias con lenguaje de venta: con stock la venta dice "Entrega
  // inmediata"; una venta con precio pero SIN stock es "Sobre pedido" (se surte a
  // pedido, no es un "Agotado" muerto); el resto queda "Agotado". La renta con
  // stock dice "Disponible" y sin unidades, "Agotado" (no hay "sobre pedido" en renta).
  const ventaSobrePedido = !esRenta && (ext.venta_estado ? ext.venta_estado === 'sobre_pedido' : (!hayStock && displayPrice > 0))
  const estadoStock = ventaSobrePedido ? 'Sobre pedido' : hayStock ? (esRenta ? 'Disponible' : 'Entrega inmediata') : 'Agotado'

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
    dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id: e.id, title: e.modelo, price: displayPrice, qty, duracion: esRenta ? dias : 1, image: activeSrc || '', unit: modalidad } })
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
        <div className="contenedor pt-24 pb-10 grid grid-cols-1 min-[980px]:grid-cols-[minmax(0,1fr)_400px] gap-10 animate-pulse">
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

  const waMsg = `Hola REMALI, me interesa ${esRenta ? 'rentar' : 'comprar'}: ${e.modelo}`
  const telWa = cfg.whatsapp_principal || cfg.negocio_telefono
  const condicionesTexto = condiciones.length
    ? condiciones.map(c => c === 'nueva' ? 'Nueva' : c === 'seminueva' ? 'Seminueva' : c).join(' y ')
    : '—'
  const mostrarFicha = seVende || !!e.ficha_tecnica || specs.length > 0

  return (
    <div className="bg-app min-h-screen text-ink">
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={subirImagenes} />

      <div className="contenedor pt-24">
        {/* Breadcrumb */}
        <div className="pb-4 text-[13.5px] text-mute flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => (window.history.length > 1 ? nav(-1) : nav('/equipos'))}
            aria-label="Regresar"
            className="w-8 h-8 rounded-full border border-edge bg-surface grid place-items-center text-mute hover:text-ink hover:border-gold/50 active:scale-95 transition-all shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
          </button>
          <Link to="/" className="hover:text-ink transition-colors">Inicio</Link>
          <span>/</span>
          <Link to="/equipos" className="hover:text-ink transition-colors">Equipos</Link>
          {e.categoria?.nombre && <><span>/</span><Link to="/equipos" className="hover:text-ink transition-colors">{tituloCaso(e.categoria.nombre)}</Link></>}
          <span>/</span><span className="text-ink font-semibold">{tituloCaso(e.modelo)}</span>
        </div>

        <div className="grid grid-cols-1 min-[980px]:grid-cols-[minmax(0,1fr)_400px] gap-10 items-start pb-16">
          {/* ── Columna izquierda ── */}
          <div className="min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-2.5 flex-wrap mb-4">
              {condiciones.includes('nueva') && <span className={`${mono} px-2.5 py-1.5 rounded-md border text-emerald-500 bg-emerald-500/10 border-emerald-500/25`}>NUEVO</span>}
              {condiciones.includes('seminueva') && <span className={`${mono} px-2.5 py-1.5 rounded-md border text-blue-500 bg-blue-500/10 border-blue-500/25`}>SEMINUEVO</span>}
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
                  <span className="absolute top-3.5 left-3.5 bg-red-600 text-white text-[15px] sm:text-[17px] font-extrabold tracking-wide px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl shadow-lg">PROMO −{promo}%</span>
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

            {/* Tabs: especificaciones / condiciones de renta */}
            {hayTabs && (
              <>
                <div className="flex gap-7 border-b border-edge mt-11 overflow-x-auto">
                  {disponibles.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`pb-3.5 text-[15px] font-bold -mb-px border-b-2 whitespace-nowrap transition-colors ${tabActiva === t ? 'text-ink border-gold' : 'text-mute border-transparent hover:text-ink'}`}>
                      {t === 'specs' ? 'Especificaciones' : t === 'incluye' ? 'Qué incluye' : seRenta ? 'Condiciones de Renta' : 'Condiciones de Venta'}
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
                {tabActiva === 'cond' && (() => {
                  // Limpio, como "Qué incluye": lista numerada sin tarjetas. Las
                  // líneas cortas EN MAYÚSCULAS (p. ej. "IMPORTANTE") son rótulos:
                  // van como encabezado, sin número; el resto se numera en orden.
                  let n = 0
                  return (
                    <ol className="pt-6 max-w-[720px]">
                      {condLista.map((c, i) => {
                        const encabezado = c.length <= 40 && c === c.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(c) && !/[.:]/.test(c)
                        if (encabezado) return (
                          <li key={i} className="pt-7 first:pt-0 pb-1 text-[12px] font-black uppercase tracking-[0.14em] text-gold">{c}</li>
                        )
                        n += 1
                        return (
                          <li key={i} className="flex gap-4 items-start py-3.5 border-b border-edge/50 last:border-0">
                            <span className="shrink-0 w-6 text-[13px] font-black text-gold tabular-nums leading-6">{String(n).padStart(2, '0')}</span>
                            <p className="text-[14.5px] text-ink/90 leading-relaxed">{c}</p>
                          </li>
                        )
                      })}
                    </ol>
                  )
                })()}
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
              <div className={`${mono} text-mute`}>{esRenta ? 'EQUIPO EN RENTA' : 'EQUIPO EN VENTA'}</div>
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

            {/* Duración (solo renta): cuántos días / semanas / meses */}
            {esRenta && (
              <div className="flex items-center justify-between gap-4">
                <div className={`${mono} text-mute`}>{modalidad === 'dia' ? 'DÍAS' : modalidad === 'semana' ? 'SEMANAS' : 'MESES'}</div>
                <div className="flex items-center border border-edge rounded-xl bg-app overflow-hidden">
                  <button onClick={() => setDias(d => Math.max(1, d - 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">−</button>
                  <span className="min-w-[38px] text-center text-[15px] font-bold">{dias}</span>
                  <button onClick={() => setDias(d => Math.min(365, d + 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">+</button>
                </div>
              </div>
            )}

            {/* Cantidad de máquinas */}
            <div className="flex items-center justify-between gap-4">
              <div className={`${mono} text-mute`}>{esRenta ? 'EQUIPOS' : 'CANTIDAD'}</div>
              <div className="flex items-center border border-edge rounded-xl bg-app overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">−</button>
                <span className="min-w-[38px] text-center text-[15px] font-bold">{qty}</span>
                <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-10 h-10 grid place-items-center text-lg text-ink hover:bg-surface-2 transition-colors">+</button>
              </div>
            </div>

            {/* Total: precio × equipos × duración */}
            <div className="flex items-center justify-between border-y border-edge py-3.5">
              <span className="text-sm text-mute">
                {esRenta
                  ? `Total · ${qty} ${qty === 1 ? 'equipo' : 'equipos'} × ${dias} ${periodoLabel(modalidad as PriceUnit, dias)}`
                  : 'Total'}
              </span>
              <span className="text-xl font-extrabold">${formatCurrency(displayPrice * qty * (esRenta ? dias : 1))}</span>
            </div>

            {/* Disponibilidad del modo actual (venta o renta). Es informativo:
                el cliente puede cotizar igual y REMALI confirma existencias. */}
            {(() => {
              const color = ventaSobrePedido ? 'text-[#c026ff]' : hayStock ? 'text-libre' : 'text-mute'
              const dot = ventaSobrePedido ? 'bg-[#c026ff] shadow-[0_0_9px_#c026ff]' : hayStock ? 'bg-libre shadow-[0_0_8px_var(--c-libre)]' : 'bg-mute'
              const dias = ext.entrega_estimada_dias || 0
              const nota = ventaSobrePedido
                ? (dias ? `— entrega estimada: ~${dias} días.` : '— se surte sobre pedido; te confirmamos el tiempo de entrega.')
                : !hayStock ? '— solicítalo y te avisamos si se libera.' : ''
              const fechaAprox = ventaSobrePedido && dias
                ? new Date(Date.now() + dias * 86400000).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                : ''
              return (
                <div className="mb-1">
                  <div className="flex items-start gap-2 text-[13px] font-bold">
                    <span className={`w-2 h-2 rounded-full mt-[5px] shrink-0 ${dot}`} />
                    <span className={`${color} [text-shadow:0_0_10px_currentColor]`}>{estadoStock}
                      {nota && <span className="text-mute font-normal [text-shadow:none]"> {nota}</span>}
                    </span>
                  </div>
                  {fechaAprox && <p className="text-[12px] text-mute mt-1 ml-4">Si lo pides hoy, llega aprox. el {fechaAprox}.</p>}
                </div>
              )
            })()}

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
                { k: 'Disponibilidad', v: estadoStock, color: ventaSobrePedido ? 'text-[#c026ff]' : hayStock ? 'text-emerald-500' : 'text-mute' },
                ...(ventaSobrePedido && (ext.entrega_estimada_dias || 0) ? [{ k: 'Entrega estimada', v: `~${ext.entrega_estimada_dias} días`, color: 'text-[#c026ff]' }] : []),
                { k: 'Categoría', v: e.categoria?.nombre || '—', color: '' },
                { k: 'Tipo', v: e.tipo?.nombre || '—', color: '' },
                { k: 'Marca', v: e.marca?.nombre || '—', color: '' },
                { k: 'Condiciones', v: condicionesTexto, color: '' },
              ].map(f => (
                <div key={f.k} className="flex justify-between gap-3">
                  <span className="text-mute">{f.k}</span>
                  <span className={`font-semibold text-right ${f.color}`}>{f.v}</span>
                </div>
              ))}
            </div>

            {/* Ficha técnica: catálogo comercial del producto, no de la unidad. */}
            {mostrarFicha && (
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
                {esRenta ? 'Se renta junto con' : 'También te puede interesar'}
              </h2>
              <Link to="/equipos" className="text-sm font-semibold text-gold hover:opacity-80">Ver catálogo →</Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {relacionados.map(r => {
                const rOfreceVenta = (r as any).ofrece_venta ?? !!toNumber(r.precio_venta)
                const rOfreceRenta = (r as any).ofrece_renta ?? (r.condiciones || []).includes('seminueva')
                const rModo = (esRenta && rOfreceRenta) ? 'renta' : (rOfreceVenta ? 'venta' : 'renta')
                const rPrecio = rModo === 'venta' ? toNumber(r.precio_venta) : toNumber(r.precio_dia)
                return (
                  <Link key={r.id} to={`/equipo/${r.id}?ver=${rModo === 'venta' ? 'venta' : 'renta'}`}
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
        <div className="modal-in fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setFullImage(false)}>
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
