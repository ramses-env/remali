import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useCart } from '../store/cart'
import { useToast } from '../store/toast'
import PriceUnitToggle from '../components/PriceUnitToggle'
import { usePriceUnit, formatCurrency } from '../store/priceUnit'
import { motion, AnimatePresence } from 'framer-motion'
import { useProfile } from '../store/profile'
import { downloadEquipoPdf } from '../lib/pdf'

type Equipo = {
  id: number
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  condicion?: string
  disponible_venta?: boolean
  disponible_renta?: boolean
  estado?: string
  categoria?: { id: number; nombre: string }
  tipo?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
  fecha_creacion?: string
}

function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : null
  if (n === null || Number.isNaN(n)) return null
  return n
}

export default function EquipoDetail() {
  const { id } = useParams()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const nav = useNavigate()
  const { unit } = usePriceUnit()
  const { user } = useProfile()
  const [e, setE] = useState<Equipo | null>(null)
  const [qty, setQty] = useState(1)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const images = useMemo(() => {
    const base = e?.imagen ? [e.imagen] : []
    const more = (e?.imagenes || [])
    return [...uploadedImages, ...base, ...more]
  }, [e, uploadedImages])
  const [activeImage, setActiveImage] = useState<string | undefined>(undefined)
  const [fullImage, setFullImage] = useState(false)
  const [fitCover, setFitCover] = useState(false)
  const [lensOn, setLensOn] = useState(false)
  const [lensPos, setLensPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const lensZoom = 1.6
  const lensSize = 160
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isAdmin = useMemo(() => user ? (user.is_staff || (user.groups || []).includes('Administrador')) : false, [user])
  useEffect(() => {
    api.get<Equipo>(`/equipos/${id}/`)
      .then(r => setE(r.data))
      .catch(() => setE({
        id: Number(id),
        modelo: 'Equipo demo',
        descripcion: 'Descripción de ejemplo',
        imagen: '/vite.svg',
        precio_dia: 420,
        precio_semana: 2600,
        precio_mes: 8900,
        condicion: 'seminuevo'
      }))
  }, [id])
  useEffect(() => {
    setActiveImage(e?.imagen || (e?.imagenes || [])[0] || undefined)
  }, [e])
  const precioDia = toNumber(e?.precio_dia)
  const precioSemana = toNumber(e?.precio_semana)
  const precioMes = toNumber(e?.precio_mes)
  const displayPrice =
    unit === 'dia' ? (precioDia ?? precioSemana ?? precioMes ?? 0) :
    unit === 'semana' ? (precioSemana ?? (precioDia ? precioDia * 7 : null) ?? precioMes ?? 0) :
    (precioMes ?? (precioDia ? precioDia * 30 : null) ?? (precioSemana ? precioSemana * 4 : null) ?? 0)
  const availability = useMemo(() => {
    const v = e?.disponible_venta
    const r = e?.disponible_renta
    if (v && r) return 'Venta y renta'
    if (v) return 'Venta'
    if (r) return 'Renta'
    return 'No disponible'
  }, [e])
  if (!e) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async ev => {
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
            setE(r.data)
            setUploadedImages([])
            notify('Imágenes subidas correctamente')
          } catch {
            notify('Error al subir imágenes')
          } finally {
            ev.currentTarget.value = ''
          }
        }}
      />
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-[#517ea0] hover:underline">Inicio</Link>
        <span>/</span>
        <Link to="/equipos" className="text-[#517ea0] hover:underline">Equipos</Link>
        <span>/</span>
        <span className="text-gray-700">{e.modelo}</span>
      </div>
      <div className="grid lg:grid-cols-12 gap-6 md:gap-8">
        <div className="order-1 lg:order-1 lg:col-span-7 space-y-4">
          <div className="md:flex md:items-start md:gap-4">
            <div className="hidden md:flex md:flex-col md:gap-3">
              {isAdmin && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border grid place-items-center bg-white shadow-sm border-neutral-200 hover:border-[#517ea0]"
                  aria-label="Subir fotos"
                  title="Subir fotos"
                >
                  <svg className="w-5 h-5 stroke-[#517ea0] fill-none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 5v14M5 12h14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {images.map((img, i) => (
                <button
                  key={`v-${i}`}
                  onClick={() => setActiveImage(img)}
                  className={`w-14 h-14 lg:w-16 lg:h-16 rounded-full border grid place-items-center bg-white shadow-sm ${activeImage === img ? 'ring-2 ring-[#517ea0] border-[#517ea0]' : 'border-neutral-200 hover:border-[#517ea0]'}`}
                  aria-label={`Miniatura ${i + 1}`}
                >
                  <img src={img} alt={`thumb-${i}`} className="max-w-[80%] max-h-[80%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
            <div
              ref={imageWrapRef}
              className="flex-1 bg-neutral-100 rounded-tl-3xl rounded-br-3xl overflow-hidden relative cursor-zoom-in grid place-items-center"
              onClick={() => activeImage && setFullImage(true)}
              onMouseEnter={() => setLensOn(true)}
              onMouseLeave={() => setLensOn(false)}
              onMouseMove={e => {
                const rect = imageWrapRef.current?.getBoundingClientRect()
                if (!rect) return
                const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
                const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
                setLensPos({ x, y })
              }}
            >
              {activeImage ? (
                <img
                  src={activeImage}
                  alt={e.modelo}
                  className={`w-full h-80 sm:h-96 md:h-[36rem] lg:h-[42rem] ${fitCover ? 'object-cover' : 'object-contain'} object-center transition-transform duration-200 ${fitCover ? 'hover:scale-[1.02]' : ''}`}
                  loading="lazy"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={ev => {
                    const t = ev.currentTarget
                    if (t.dataset.fallbackApplied === '1') return
                    t.dataset.fallbackApplied = '1'
                    t.src = '/vite.svg'
                  }}
                />
              ) : null}
              <div className="hidden md:block">
                {lensOn && activeImage && (
                  <div
                    className="absolute rounded-xl ring-1 ring-black/10 shadow-lg pointer-events-none"
                    style={{
                      width: lensSize,
                      height: lensSize,
                      left: Math.max(0, Math.min(lensPos.x - lensSize / 2, (imageWrapRef.current?.getBoundingClientRect().width || lensSize) - lensSize)),
                      top: Math.max(0, Math.min(lensPos.y - lensSize / 2, (imageWrapRef.current?.getBoundingClientRect().height || lensSize) - lensSize)),
                      backgroundImage: `url(${activeImage})`,
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: `${(imageWrapRef.current?.getBoundingClientRect().width || 0) * lensZoom}px ${(imageWrapRef.current?.getBoundingClientRect().height || 0) * lensZoom}px`,
                      backgroundPosition: `${-lensPos.x * lensZoom + lensSize / 2}px ${-lensPos.y * lensZoom + lensSize / 2}px`,
                      backdropFilter: 'contrast(105%)',
                    }}
                  />
                )}
              </div>
              <div className="hidden md:flex absolute inset-x-0 bottom-3 justify-center">
                <span className="px-3 py-1 rounded-full bg-white/90 text-black text-xs shadow">Haz clic para vista completa</span>
              </div>
              <button
                aria-label={fitCover ? 'Ajuste cubrir' : 'Ajuste contener'}
                title={fitCover ? 'Cubrir' : 'Contener'}
                onClick={e => { e.stopPropagation(); setFitCover(v => !v) }}
                className="absolute right-3 top-3 w-9 h-9 rounded-full bg-white/90 text-black grid place-items-center shadow"
              >
                {fitCover ? (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M7 9h3M14 9h3M7 15h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="7" y="8" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M4 6h4M16 6h4M4 18h4M16 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
          {images.length > 0 && (
            <>
              <div className="md:hidden -mx-1 px-1 flex gap-2 overflow-x-auto snap-x snap-mandatory">
                {isAdmin && (
                  <button onClick={() => fileInputRef.current?.click()} className="snap-start w-28 h-20 grid place-items-center rounded-xl overflow-hidden border bg-white border-neutral-200 hover:border-[#517ea0]">
                    <svg className="w-6 h-6 stroke-[#517ea0] fill-none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 5v14M5 12h14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
                {images.map((img, i) => (
                  <button key={`m-${i}`} onClick={() => setActiveImage(img)} className={`snap-start w-28 h-20 grid place-items-center rounded-xl overflow-hidden border bg-white ${activeImage === img ? 'border-[#517ea0]' : 'border-transparent'} hover:border-[#517ea0]`}>
                    <img src={img} alt={`thumb-${i}`} className="max-w-full max-h-full object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
              <div className="hidden md:grid"></div>
            </>
          )}
          <div className="hidden rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
            <p className="text-lg font-extrabold">Descripción</p>
            <p className="mt-2 text-sm text-gray-600">{e.descripcion}</p>
          </div>
        </div>
        <div className="order-2 lg:order-2 lg:col-span-5 space-y-4">
          <h2 className="text-2xl md:text-3xl font-extrabold text-black">{e.modelo}</h2>
          <div className="lg:sticky lg:top-6 rounded-xl bg-white border border-neutral-100 shadow-sm p-3 sm:p-4 space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-2xl sm:text-3xl font-extrabold text-black">${formatCurrency(displayPrice)}</p>
              <PriceUnitToggle />
            </div>
            <p className="text-xs text-gray-600">Mostrando precio por {unit}</p>
            <div>
              <button
                className="rounded-full border px-3 py-2 text-sm bg-white shadow-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
                onClick={async () => {
                  await downloadEquipoPdf(e, unit, activeImage)
                }}
                title="Descargar PDF"
                aria-label="Descargar PDF"
              >
                Descargar PDF
              </button>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <label className="text-xs sm:text-sm text-gray-700">Cantidad</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 sm:w-8 sm:h-8 rounded-full border grid place-items-center">-</button>
                <span className="w-10 text-center font-semibold">{qty}</span>
                <button onClick={() => setQty(q => Math.min(99, q + 1))} className="w-10 h-10 sm:w-8 sm:h-8 rounded-full border grid place-items-center">+</button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                className="btn-universe-primary w-full sm:flex-1 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
                onClick={() => {
                  dispatch({
                    type: 'add',
                    item: {
                      lineId: Date.now() + Math.floor(Math.random() * 1000),
                      id: e.id,
                      title: e.modelo,
                      price: displayPrice,
                      qty,
                      image: activeImage || '',
                      unit,
                    },
                  })
                  notify('Producto añadido al carrito')
                }}
              >
                Añadir al carrito
              </button>
              <button
                className="btn-universe-black w-full sm:flex-1 focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
                onClick={() => {
                  dispatch({
                    type: 'add',
                    item: {
                      lineId: Date.now() + Math.floor(Math.random() * 1000),
                      id: e.id,
                      title: e.modelo,
                      price: displayPrice,
                      qty,
                      image: activeImage || '',
                      unit,
                    },
                  })
                  nav('/checkout')
                }}
              >
                Comprar ahora
              </button>
            </div>
            <div className="rounded-md p-3 sm:p-4">
              <p className="text-sm font-extrabold">Ficha</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-600">Disponibilidad</p>
                  <p className="font-semibold">{availability}</p>
                </div>
                <div>
                  <p className="text-gray-600">Estado</p>
                  <p className="font-semibold">{e.estado || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-600">Categoría</p>
                  <p className="font-semibold">{e.categoria?.nombre || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-600">Tipo</p>
                  <p className="font-semibold">{e.tipo?.nombre || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-600">Marca</p>
                  <p className="font-semibold">{e.marca?.nombre || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-600">Condición</p>
                  <p className="font-semibold">{e.condicion || '—'}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden md:block rounded-md bg-white border border-neutral-100 shadow-sm p-4">
            <p className="text-lg font-extrabold">Descripción</p>
            <p className="mt-2 text-sm text-gray-600">{e.descripcion}</p>
          </div>
        </div>
      </div>
      <div className="md:hidden rounded-md bg-white border border-neutral-100 shadow-sm p-4">
        <p className="text-lg font-extrabold">Descripción</p>
        <p className="mt-2 text-sm text-gray-600">{e.descripcion}</p>
      </div>
      <AnimatePresence>
        {fullImage && activeImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 grid place-items-center"
            onClick={() => setFullImage(false)}
          >
            <div
              className="relative w-[94vw] max-w-6xl h-[80vh] rounded-2xl bg-white shadow-2xl border border-neutral-200 p-4 md:p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="grid md:grid-cols-[1fr_minmax(18rem,24rem)] gap-6 items-start h-full">
                <div className="relative w-full h-full grid place-items-center overflow-hidden">
                  <img
                    src={activeImage}
                    alt={e.modelo}
                    className="max-w-full max-h-full object-contain"
                    loading="eager"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    onError={ev => {
                      const t = ev.currentTarget
                      if (t.dataset.fallbackApplied === '1') return
                      t.dataset.fallbackApplied = '1'
                      t.src = '/vite.svg'
                    }}
                  />
                </div>
                <div className="hidden md:flex flex-col gap-4 h-full overflow-auto pr-1">
                  <div className="space-y-2">
                    <p className="font-extrabold text-lg">{e.modelo}</p>
                    <p className="text-sm text-gray-600">{(e.descripcion || '').slice(0, 220)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {images.map((img, i) => (
                      <button
                        key={`mv-${i}`}
                        onClick={() => setActiveImage(img)}
                        className={`w-14 h-14 rounded-xl border grid place-items-center bg-white ${activeImage === img ? 'ring-2 ring-[#517ea0] border-[#517ea0]' : 'border-neutral-200 hover:border-[#517ea0]'}`}
                      >
                        <img src={img} alt={`thumb-${i}`} className="max-w-[80%] max-h-[80%] object-contain" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setFullImage(false)}
                className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white text-black grid place-items-center shadow"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
