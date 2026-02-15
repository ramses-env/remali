import { Link } from 'react-router-dom'
import { useState } from 'react'
import StarRating from './StarRating'
import { useCart } from '../store/cart'
import { usePriceUnit } from '../store/priceUnit'
import { useToast } from '../store/toast'

type Props = {
  id: number
  title: string
  price: number | string
  image: string
  subtitle?: string
  rating?: number
  linkTo?: string
}

export default function ProductCard({ id, title, price, image, subtitle, rating = 4, linkTo }: Props) {
  const { dispatch } = useCart()
  const { notify } = useToast()
  const { unit } = usePriceUnit()
  const priceNum = typeof price === 'string' ? parseFloat(price) : price
  const displayPrice = Number.isFinite(priceNum) ? priceNum : 0
  const iconBtn = "group flex items-center justify-center w-12 h-12 rounded-full border-2 border-white/70 bg-white/10 backdrop-blur-md text-white transition duration-300 hover:bg-white/20 hover:scale-110 hover:shadow-xl"
  const iconSvg = "w-6 h-6 stroke-white fill-none duration-300"
  const mobileBtn = "h-8 px-3 text-xs flex-1 flex items-center justify-center gap-1 rounded-full border-2 border-neutral-300 bg-white text-neutral-800 min-w-0 max-w-full"
  const mobileCircleBtn = "w-8 h-8 flex-none flex items-center justify-center rounded-full border-2 border-neutral-300 bg-white text-neutral-800"
  const mobileIcon = "w-4 h-4 stroke-zinc-600 fill-none"
  const [fav, setFav] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <div
      className="group rounded-2xl p-4 bg-neutral-50 border border-neutral-200 shadow-sm hover:shadow-md relative w-full max-w-full min-w-0 overflow-hidden flex flex-col h-full"
    >
      <Link to={linkTo || `/equipo/${id}`} className="block">
        <div className="bg-neutral-100 rounded-tl-3xl rounded-br-3xl overflow-hidden">
          {image ? (
            <img
              src={image}
              alt={title}
              className="w-full h-56 md:h-80 object-cover transition-opacity duration-200 group-hover:opacity-85"
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
        </div>
      </Link>
        <div className="mt-4 space-y-1 flex-1 flex flex-col">
          <h3 className="font-extrabold uppercase tracking-wide break-words">{title}</h3>
          {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
          <div className="mt-auto flex items-center justify-between">
            <StarRating value={rating} />
          <span className="text-gray-900 font-bold">${displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      <div className="absolute inset-0 bg-neutral-900/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl md:flex hidden items-center justify-center gap-4">
        <button aria-label="Comprar" title="Comprar" onClick={() => { dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id, title, price: displayPrice, qty: 1, image, unit } }); notify('Producto añadido al carrito') }} className={`${iconBtn} shine-button`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`${iconSvg} shine-icon`}>
            <path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z" strokeWidth="1.5"></path>
            <path d="M8 12H16" strokeWidth="1.5"></path>
            <path d="M12 16V8" strokeWidth="1.5"></path>
          </svg>
        </button>
        <Link aria-label="Ver" to={linkTo || `/equipo/${id}`} className={`${iconBtn} shine-button`}>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={`${iconSvg} shine-icon`}>
            <path d="M5 12H18" strokeWidth="1.5" strokeLinecap="round"></path>
            <path d="M12 7L17 12L12 17" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
          </svg>
        </Link>
        <button aria-label="Favorito" onClick={() => { setFav(v => !v); notify(!fav ? 'Añadido a favoritos' : 'Eliminado de favoritos', !fav ? 'heart' : 'x') }} className={`${iconBtn} shine-button`}>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={`${iconSvg} shine-icon ${fav ? 'fill-[#517ea0]' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z"></path>
          </svg>
        </button>
        <button aria-label="Guardar" onClick={() => { setSaved(s => !s); notify(!saved ? 'Guardado' : 'Eliminado de guardados', !saved ? 'bookmark' : 'x') }} className={`${iconBtn} shine-button`}>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={`w-6 h-6 duration-300 ${saved ? 'stroke-[#517ea0] fill-[#487aa1]' : 'stroke-white fill-none'} shine-icon`}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 3h12a1 1 0 011 1v16l-7-4-7 4V4a1 1 0 011-1z"></path>
          </svg>
        </button>
      </div>
      <div className="mt-3 w-full min-w-0 flex md:hidden items-center gap-1 sm:gap-2 justify-center sm:justify-start flex-wrap sm:flex-nowrap">
        <button title="Comprar" onClick={() => { dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id, title, price: displayPrice, qty: 1, image, unit } }); notify('Producto añadido al carrito') }} className={mobileBtn}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={mobileIcon}>
            <circle cx="12" cy="12" r="9" strokeWidth="1.5"></circle>
            <path d="M8 12H16" strokeWidth="1.5" strokeLinecap="round"></path>
            <path d="M12 8V16" strokeWidth="1.5" strokeLinecap="round"></path>
          </svg>
          <span className="font-medium">Comprar</span>
        </button>
        <Link to={`/equipo/${id}`} className={mobileBtn}>Ver
          <svg className={mobileIcon} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="9" strokeWidth="1.5"></circle>
            <path d="M12 15V9" strokeWidth="1.5" strokeLinecap="round"></path>
            <path d="M9 12L12 9L15 12" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
          </svg>
        </Link>
        <button aria-label="Favorito" onClick={() => { setFav(v => !v); notify(!fav ? 'Añadido a favoritos' : 'Eliminado de favoritos', !fav ? 'heart' : 'x') }} className={mobileBtn}> 
          <svg className={`${mobileIcon} ${fav ? 'fill-[#517ea0]' : 'fill-none'}`} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z"/></svg>
          <span className="font-medium">Favorito</span>
        </button>
        <button aria-label="Guardar" aria-pressed={saved} onClick={() => { setSaved(s => !s); notify(!saved ? 'Guardado' : 'Eliminado de guardados', !saved ? 'bookmark' : 'x') }} className={mobileCircleBtn}>
          <svg className={`${saved ? 'stroke-[#517ea0] fill-[#487aa1]' : 'stroke-zinc-600 fill-none'} w-4 h-4`} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 3h12a1 1 0 011 1v16l-7-4-7 4V4a1 1 0 011-1z"/></svg>
        </button>
      </div>
    </div>
  )
}
