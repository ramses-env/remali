import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useCart, esVenta, tipoCotizacion } from '../store/cart'
import { usePriceUnit } from '../store/priceUnit'
import { useToast } from '../store/toast'
import resolveMediaUrl from '../lib/resolveMediaUrl'

type Tag = { label: string; tone: 'new' | 'used' | 'rent' | 'sale' | 'promo' }
type Props = {
  id: number
  title: string
  price: number | string
  priceOriginal?: number
  image: string
  subtitle?: string
  meta?: string
  linkTo?: string
  tags?: Tag[]
  modo?: 'venta' | 'renta'
  agotado?: boolean
}

const tagStyle: Record<Tag['tone'], string> = {
  new: 'bg-emerald-500/90 text-white',
  used: 'bg-blue-500/90 text-white',
  rent: 'bg-black/60 text-white backdrop-blur-sm',
  sale: 'bg-gold text-black',
  promo: 'bg-red-600 text-white',
}

export default function ProductCard({ id, title, price, priceOriginal, image, subtitle, meta, linkTo, tags = [], modo, agotado = false }: Props) {
  const { state, dispatch } = useCart()
  // Si el tipo choca, el reducer NO agrega (abre el modal global): no avisar "añadido".
  const chocaTipo = () => { const t = tipoCotizacion(state.items); return !!t && t !== (esVenta(cartUnit) ? 'venta' : 'renta') }
  const { notify } = useToast()
  const { unit } = usePriceUnit()
  const priceNum = typeof price === 'string' ? parseFloat(price) : price
  const displayPrice = Number.isFinite(priceNum) ? priceNum : 0
  // Un equipo de venta entra al carrito como 'venta'; uno de renta, con la modalidad elegida.
  const cartUnit = modo === 'venta' ? ('venta' as const) : unit
  const [fav, setFav] = useState(false)
  const resolvedImage = resolveMediaUrl(image)

  return (
    <div className="group h-full bg-surface border border-edge rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:border-gold/30 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.5)]">

      {/* Imagen */}
      <div className="relative overflow-hidden aspect-[4/3]">
        {/* Enlace que cubre toda la imagen (patrón "stretched link"): sin anclas ni botones anidados dentro */}
        <Link
          to={linkTo || `/equipo/${id}`}
          aria-label={`Ver detalle de ${title}`}
          className="absolute inset-0 z-10"
        />
        {tags.length > 0 && (
          <div className="absolute top-3 left-3 z-30 flex flex-wrap gap-1.5 max-w-[80%] pointer-events-none">
            {tags.map(t => (
              <span key={t.label} className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${tagStyle[t.tone]}`}>
                {t.label}
              </span>
            ))}
          </div>
        )}
        {agotado && (
          <span className="absolute top-3 right-3 z-30 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-black/70 text-white/90 backdrop-blur-sm pointer-events-none">
            Agotado
          </span>
        )}
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt={title}
            className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${agotado ? 'opacity-50 grayscale' : ''}`}
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={e => {
              const t = e.currentTarget
              if (t.dataset.fb === '1') return
              t.dataset.fb = '1'
              t.src = '/vite.svg'
            }}
          />
        ) : (
          <div className="w-full h-full bg-surface-2 flex items-center justify-center">
            <svg className="w-12 h-12 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {/* Overlay al hover: transparente a los clics salvo en los botones, para que el enlace de la imagen siga activo */}
        <div className="absolute inset-0 z-20 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3 pointer-events-none">
          {!agotado && (
          <button
            aria-label="Agregar al carrito"
            onClick={() => {
              const choca = chocaTipo()
              dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id, title, price: displayPrice, qty: 1, image: resolvedImage, unit: cartUnit } })
              if (!choca) notify('Equipo añadido a tu cotización')
            }}
            className="w-11 h-11 rounded-full bg-gold text-black flex items-center justify-center hover:opacity-90 transition-colors pointer-events-none group-hover:pointer-events-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          )}
          <button
            aria-label="Favorito"
            onClick={() => { setFav(v => !v); notify(fav ? 'Eliminado de favoritos' : 'Añadido a favoritos') }}
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors pointer-events-none group-hover:pointer-events-auto ${fav ? 'bg-gold/20 border-gold/40 text-gold' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}
          >
            <svg className="w-5 h-5" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-bold text-ink text-sm uppercase tracking-wide leading-snug mb-1 group-hover:text-gold transition-colors">
          {title}
        </h3>
        {/* Descripción SIEMPRE presente con altura de 2 líneas reservada:
            así el título, la línea y el precio quedan a la misma altura en
            todas las cards, tengan descripción o no. Si es larga, el clamp
            la corta con "…" y el detalle del equipo cuenta el resto. */}
        <p className="text-xs text-mute mb-3 line-clamp-2 min-h-[2rem]">{subtitle || ''}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3 border-t border-edge">
          <span className="min-w-0 leading-tight pb-0.5">
            {meta && <span className="block text-[11px] text-mute truncate">{meta}</span>}
            <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${agotado ? 'text-mute' : 'text-libre'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${agotado ? 'bg-mute' : 'bg-libre'}`} />
              {agotado ? 'Agotado' : 'Disponible'}
            </span>
          </span>
          <div className="text-right shrink-0">
            {/* Etiqueta chica sobre el precio: renta = "desde /modalidad"; venta = "Precio venta". */}
            <p className="text-[10px] text-mute font-mono uppercase">{modo === 'venta' ? 'Precio venta' : `desde /${unit}`}{priceOriginal ? <span className="ml-1.5 normal-case line-through text-[10.5px]">${priceOriginal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> : null}</p>
            <p className="text-base font-black text-gold leading-none">
              ${displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Botones móvil */}
      <div className="md:hidden flex gap-2 px-5 pb-4">
        {agotado ? (
          <span className="flex-1 py-2.5 rounded-full bg-surface-2 text-mute text-xs font-bold text-center">Agotado</span>
        ) : (
        <button
          onClick={() => { const choca = chocaTipo(); dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id, title, price: displayPrice, qty: 1, image: resolvedImage, unit: cartUnit } }); if (!choca) notify('Equipo añadido a tu cotización') }}
          className="flex-1 py-2.5 rounded-full bg-gold text-black text-xs font-bold hover:opacity-90 transition-colors"
        >
          Agregar
        </button>
        )}
        <Link
          to={linkTo || `/equipo/${id}`}
          className="flex-1 py-2.5 rounded-full border border-edge text-ink text-xs font-medium text-center hover:border-edge transition-colors"
        >
          Ver más
        </Link>
      </div>
    </div>
  )
}
