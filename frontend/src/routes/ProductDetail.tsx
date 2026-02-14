import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import { useCart } from '../store/cart'
import { useToast } from '../store/toast'
import { useProfile } from '../store/profile'
import ProductCard from '../components/ProductCard'
import StarRating from '../components/StarRating'

type Product = {
  id: number
  title: string
  price: number
  image?: string
  images?: string[]
  description?: string
  condition?: string
  category?: { id: number; name: string }
  equipo?: { id: number; name: string }
  marca?: { id: number; name: string }
  created_at?: string
}

export default function ProductDetail() {
  const { id } = useParams()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const { user } = useProfile()
  const nav = useNavigate()
  const [p, setP] = useState<Product | null>(null)
  const [qty, setQty] = useState(1)
  const [fav, setFav] = useState(false)
  const [saved, setSaved] = useState(false)
  const [related, setRelated] = useState<Product[]>([])
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const images = useMemo(() => {
    const base = p?.image ? [p.image] : []
    const more = (p?.images || [])
    return [...uploadedImages, ...base, ...more]
  }, [p, uploadedImages])
  const [activeImage, setActiveImage] = useState<string | undefined>(undefined)
  const [fullImage, setFullImage] = useState(false)
  const [fitCover, setFitCover] = useState(false)
  const [lensOn, setLensOn] = useState(false)
  const [lensPos, setLensPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const lensZoom = 1.6
  const lensSize = 160
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const condLabel = useMemo(() => p?.condition === 'new' ? 'Nuevo' : p?.condition === 'refurbished' ? 'Renovado' : p?.condition === 'used' ? 'Usado' : '—', [p])
  const createdAt = useMemo(() => p?.created_at ? new Date(p.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) : '', [p])
  const isAdmin = useMemo(() => user ? (user.is_staff || (user.groups || []).includes('Administrador')) : false, [user])

  useEffect(() => {
    api.get<Product>(`/products/${id}/`)
      .then(r => setP(r.data))
      .catch(() => setP({ id: Number(id), title: 'Producto demo', price: 49.9, image: '/vite.svg', description: 'Descripción de ejemplo' }))
  }, [id])

  useEffect(() => {
    setActiveImage(p?.image)
  }, [p])

  useEffect(() => {
    api.get<Product[]>(`/products/`)
      .then(r => {
        const items = (r.data || []).filter(x => String(x.id) !== String(id)).slice(0, 8)
        setRelated(items)
      })
      .catch(() => {
        const demo = Array.from({ length: 8 }).map((_, i) => ({
          id: (Number(id) || 1) + i + 1,
          title: `Producto ${i + 1}`,
          price: 19.99 + i * 3,
          image: '/vite.svg',
          description: 'Producto relacionado de ejemplo'
        }))
        setRelated(demo)
      })
  }, [id])

  if (!p) return null

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async e => {
          const files = Array.from(e.target.files || [])
          if (files.length === 0) return
          const urls = files.map(f => URL.createObjectURL(f))
          setUploadedImages(prev => [...prev, ...urls])
          if (!activeImage && urls[0]) setActiveImage(urls[0])
          try {
            const fd = new FormData()
            files.forEach(f => fd.append('images', f))
            await api.post(`/products/${id}/images/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
            const r = await api.get<Product>(`/products/${id}/`)
            setP(r.data)
            setUploadedImages([])
            notify('Imágenes subidas correctamente')
          } catch {
            notify('Error al subir imágenes')
          } finally {
            e.currentTarget.value = ''
          }
        }}
      />
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-[#517ea0] hover:underline">Inicio</Link>
        <span>/</span>
        <Link to="/productos" className="text-[#517ea0] hover:underline">Productos</Link>
        <span>/</span>
        <span className="text-gray-700">{p.title}</span>
      </div>
      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 md:gap-8">
        <div className="order-2 lg:order-1 lg:col-span-7 space-y-4">
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
                  alt={p.title}
                  className={`w-full h-80 sm:h-96 md:h-[36rem] lg:h-[42rem] ${fitCover ? 'object-cover' : 'object-contain'} object-center transition-transform duration-200 ${fitCover ? 'hover:scale-[1.02]' : ''}`}
                  loading="lazy"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={e => {
                    const t = e.currentTarget
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
              <div className="absolute left-3 top-3 flex items-center gap-2">
                <span className="px-2 py-1 rounded-full bg-emerald-500 text-white text-xs">Más vendido</span>
                <span className="px-2 py-1 rounded-full bg-[#517ea0] text-white text-xs">Envío en Acapulco</span>
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
          <div className="hidden md:block rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
            <p className="text-lg font-extrabold">Descripción</p>
            <div className={`relative mt-2 text-sm text-gray-600 ${descExpanded ? '' : 'max-h-40 overflow-hidden'}`}>
              <p className="whitespace-pre-line">{p.description}</p>
              {!descExpanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent"></div>
              )}
            </div>
            {p.description && p.description.length > 160 && (
              <button
                onClick={() => setDescExpanded(v => !v)}
                className="mt-3 text-[#517ea0] text-sm font-semibold flex items-center gap-1"
              >
                {descExpanded ? 'Ver menos' : 'Ver descripción completa'}
                <svg className={`w-4 h-4 ${descExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="order-1 lg:order-2 lg:col-span-5 space-y-4">
          <h2 className="text-2xl md:text-3xl font-extrabold text-black">{p.title}</h2>
          <div className="flex items-center gap-3">
            <StarRating value={(p.id % 5) + 1} />
            <span className="text-xs md:text-sm text-gray-600">({((p.id % 90) + 10)} opiniones)</span>
          </div>
          <div className="lg:sticky lg:top-6 rounded-2xl bg-white border border-neutral-100 shadow-sm p-3 sm:p-4 space-y-3 sm:space-y-4">
            <p className="text-3xl sm:text-4xl font-extrabold text-black">${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded-full bg-[#517ea0] text-white text-xs">Envío en Acapulco</span>
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
                onClick={() => { dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id: p.id, title: p.title, price: p.price, qty, image: p.image || '' } }); notify('Producto añadido al carrito') }}
              >
                Añadir al carrito
              </button>
              <button
                className="btn-universe-black w-full sm:flex-1 focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
                onClick={() => { dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id: p.id, title: p.title, price: p.price, qty, image: p.image || '' } }); nav('/checkout') }}
              >
                Comprar ahora
              </button>
            </div>
            <div className="flex items-center gap-2 sm:gap-2 flex-wrap">
              <button
                aria-label="Favorito"
                onClick={() => { setFav(v => !v); notify(!fav ? 'Añadido a favoritos' : 'Eliminado de favoritos', !fav ? 'heart' : 'x') }}
                className="w-10 h-10 sm:w-10 sm:h-10 flex items-center justify-center rounded-full border bg-white text-neutral-800"
                title="Favorito"
              >
                <svg className={`w-5 h-5 ${fav ? 'fill-[#517ea0] stroke-[#517ea0]' : 'fill-none stroke-zinc-700'}`} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z"/>
                </svg>
              </button>
              <button
                aria-label="Compartir"
                onClick={() => { navigator.clipboard.writeText(window.location.href); notify('Enlace copiado', 'share') }}
                className="w-10 h-10 sm:w-10 sm:h-10 flex items-center justify-center rounded-full border bg-white text-neutral-800"
                title="Compartir"
              >
                <svg className="w-5 h-5 stroke-zinc-700 fill-none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 12v6a2 2 0 002 2h6a2 2 0 002-2v-6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M12 12l5-5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M12 12V4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
              <button
                aria-label="Guardar"
                onClick={() => { setSaved(s => !s); notify(!saved ? 'Guardado' : 'Eliminado de guardados', !saved ? 'bookmark' : 'x') }}
                className="w-10 h-10 sm:w-10 sm:h-10 flex items-center justify-center rounded-full border bg-white text-neutral-800"
                title="Guardar"
              >
                <svg className={`${saved ? 'stroke-[#517ea0] fill-[#487aa1]' : 'stroke-zinc-700 fill-none'} w-5 h-5`} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 3h12a1 1 0 011 1v16l-7-4-7 4V4a1 1 0 011-1z"></path>
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-xs">
              <div className="rounded-xl bg-white border p-3">
                <p className="font-semibold">Garantía</p>
                <p className="text-gray-600 mt-1">12 meses</p>
              </div>
              <div className="rounded-xl bg-white border p-3">
                <p className="font-semibold">Devoluciones</p>
                <p className="text-gray-600 mt-1">30 días</p>
              </div>
              <div className="rounded-xl bg-white border p-3">
                <p className="font-semibold">Facturación</p>
                <p className="text-gray-600 mt-1">Disponible</p>
              </div>
            </div>
            <div className="rounded-xl bg-white border p-3">
              <p className="text-sm font-semibold">Vendido por</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#517ea0] text-white grid place-items-center">R</div>
                <div>
                  <p className="text-sm font-semibold">Remali Store</p>
                  <p className="text-xs text-gray-600">Mercado Líder • Atención 24/7</p>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
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
                    alt={p.title}
                    className="max-w-full max-h-full object-contain"
                    loading="eager"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    onError={e => {
                      const t = e.currentTarget
                      if (t.dataset.fallbackApplied === '1') return
                      t.dataset.fallbackApplied = '1'
                      t.src = '/vite.svg'
                    }}
                  />
                </div>
                <div className="hidden md:flex flex-col gap-4 h-full overflow-auto pr-1">
                  <div className="space-y-2">
                    <p className="font-extrabold text-lg">{p.title}</p>
                    <p className="text-sm text-gray-600">{(p.description || '').slice(0, 220)}</p>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
          <p className="text-lg font-extrabold">Características</p>
          <ul className="mt-3 list-disc pl-5 space-y-1">
            {(p.description || '')
              .split(/[.,;\\n]+/)
              .map(s => s.trim())
              .filter(Boolean)
              .slice(0, 6)
              .map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
          <p className="text-lg font-extrabold">Ficha técnica</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-600">Categoría</p>
              <p className="font-semibold">{p.category?.name || '—'}</p>
            </div>
            <div>
              <p className="text-gray-600">Equipo</p>
              <p className="font-semibold">{p.equipo?.name || '—'}</p>
            </div>
            <div>
              <p className="text-gray-600">Marca</p>
              <p className="font-semibold">{p.marca?.name || '—'}</p>
            </div>
            <div>
              <p className="text-gray-600">Condición</p>
              <p className="font-semibold">{condLabel}</p>
            </div>
            <div>
              <p className="text-gray-600">Precio</p>
              <p className="font-semibold">${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-600">Publicado</p>
              <p className="font-semibold">{createdAt || '—'}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="md:hidden rounded-2xl bg-white border border-neutral-100 shadow-sm p-4">
        <p className="text-lg font-extrabold">Descripción</p>
        <div className={`relative mt-2 text-sm text-gray-600 ${descExpanded ? '' : 'max-h-40 overflow-hidden'}`}>
          <p className="whitespace-pre-line">{p.description}</p>
          {!descExpanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent"></div>
          )}
        </div>
        {p.description && p.description.length > 160 && (
          <button
            onClick={() => setDescExpanded(v => !v)}
            className="mt-3 text-[#517ea0] text-sm font-semibold flex items-center gap-1"
          >
            {descExpanded ? 'Ver menos' : 'Ver descripción completa'}
            <svg className={`w-4 h-4 ${descExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
      <div className="space-y-4">
        <p className="text-xl font-extrabold">Productos relacionados</p>
        <div className="md:hidden -mx-2 px-2 flex gap-3 overflow-x-auto snap-x snap-mandatory">
          {related.map(item => (
            <div key={`m-${item.id}`} className="snap-start min-w-[16rem] sm:min-w-[18rem]">
              <ProductCard
                id={item.id}
                title={item.title}
                price={item.price}
                image={item.image || ''}
                subtitle={(item.description || '').slice(0, 60)}
                rating={(item.id % 5) + 1}
              />
            </div>
          ))}
        </div>
        <div className="hidden md:grid grid-cols-3 lg:grid-cols-4 gap-4">
          {related.map(item => (
            <ProductCard
              key={`d-${item.id}`}
              id={item.id}
              title={item.title}
              price={item.price}
              image={item.image || ''}
              subtitle={(item.description || '').slice(0, 60)}
              rating={(item.id % 5) + 1}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
