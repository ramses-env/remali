import { Link } from 'react-router-dom'
import { useCart, esVenta, tipoCotizacion } from '../store/cart'
import { useEsDelNegocio } from '../store/profile'
import { usePriceUnit } from '../store/priceUnit'
import { useToast } from '../store/toast'
import { useFavoritos } from '../store/favoritos'
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
  // Estado explícito de disponibilidad (fuente: backend). Manda sobre `agotado`.
  // Si no se pasa, se deriva de `agotado`/`modo` (compat. Favoritos y llamadas viejas).
  estado?: 'inmediata' | 'disponible' | 'sobre_pedido' | 'agotado'
  entregaDias?: number | null
}

const tagStyle: Record<Tag['tone'], string> = {
  new: 'bg-emerald-500/90 text-white',
  used: 'bg-blue-500/90 text-white',
  rent: 'bg-black/60 text-white backdrop-blur-sm',
  sale: 'bg-gold text-black',
  promo: 'bg-red-600 text-white',
}

export default function ProductCard({ id, title, price, priceOriginal, image, subtitle, meta, linkTo, tags = [], modo, agotado = false, estado, entregaDias }: Props) {
  const { state, dispatch } = useCart()
  const delNegocio = useEsDelNegocio()
  // Si el tipo choca, el reducer NO agrega (abre el modal global): no avisar "añadido".
  const chocaTipo = () => { const t = tipoCotizacion(state.items); return !!t && t !== (esVenta(cartUnit) ? 'venta' : 'renta') }
  const { notify } = useToast()
  const { unit } = usePriceUnit()
  const { esFavorito, toggle } = useFavoritos()
  const fav = esFavorito(id)
  const priceNum = typeof price === 'string' ? parseFloat(price) : price
  const displayPrice = Number.isFinite(priceNum) ? priceNum : 0
  // Un equipo de venta entra al carrito como 'venta'; uno de renta, con la modalidad elegida.
  const cartUnit = modo === 'venta' ? ('venta' as const) : unit
  const resolvedImage = resolveMediaUrl(image)
  const ficha = linkTo || `/equipo/${id}`
  // Estado real de la card. Preferimos el `estado` explícito del backend
  // (inmediata/disponible/sobre_pedido/agotado). Si no llega —Favoritos y
  // llamadas antiguas— lo derivamos: una venta con precio pero sin stock es
  // "Sobre pedido" (se cotiza, no se pinta gris); el gris se reserva a lo
  // realmente agotado (p. ej. una renta sin unidades).
  const estadoFinal: 'inmediata' | 'disponible' | 'sobre_pedido' | 'agotado' =
    estado ?? (agotado
      ? (modo === 'venta' && displayPrice > 0 ? 'sobre_pedido' : 'agotado')
      : (modo === 'venta' ? 'inmediata' : 'disponible'))
  const sobrePedido = estadoFinal === 'sobre_pedido'
  const gris = estadoFinal === 'agotado'
  const dispoLabel = estadoFinal === 'inmediata' ? 'Entrega inmediata' : 'Disponible'

  const agregar = () => {
    const choca = chocaTipo()
    dispatch({ type: 'add', item: { lineId: Date.now() + Math.floor(Math.random() * 1000), id, title, price: displayPrice, qty: 1, image: resolvedImage, unit: cartUnit } })
    if (!choca) notify('Equipo añadido a tu cotización')
  }

  return (
    <div className="equipo-card group h-full bg-surface border border-edge rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:border-gold/30 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.5)]">

      {/* Imagen (más baja que 4:3 para compactar la card) */}
      <div data-onboarding="tarjeta-ver" className="relative overflow-hidden aspect-[16/10] bg-surface-2">
        {/* Enlace que cubre la imagen (stretched link) */}
        <Link to={ficha} aria-label={`Ver detalle de ${title}`} className="absolute inset-0 z-10" />
        {tags.length > 0 && (
          <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5 max-w-[65%] pointer-events-none">
            {tags.map(t => (
              <span key={t.label} className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${tagStyle[t.tone]}`}>{t.label}</span>
            ))}
          </div>
        )}
        {/* Favorito: SIEMPRE visible (el corazón que se guarda en "Favoritos"). */}
        <button
          type="button"
          data-onboarding="tarjeta-favorito"
          aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
          onClick={() => { const m = toggle(id); notify(m ? 'Guardado en favoritos' : 'Quitado de favoritos', m ? 'ok' : 'neutro', m ? 'corazon' : 'corazon-vacio') }}
          className={`absolute top-2.5 right-2.5 z-20 w-9 h-9 rounded-full grid place-items-center backdrop-blur-sm transition-colors active:scale-90 ${fav ? 'bg-white text-red-500 shadow-sm' : 'bg-black/40 text-white hover:bg-black/60'}`}
        >
          <svg className="w-[18px] h-[18px]" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z" /></svg>
        </button>
        {sobrePedido ? (
          <span data-onboarding="badge-disponible" className="absolute bottom-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-[#c026ff]/90 text-white backdrop-blur-sm shadow-[0_0_18px_rgba(192,38,255,0.85)]">Sobre pedido</span>
        ) : agotado ? (
          <span data-onboarding="badge-disponible" className="absolute bottom-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-red-500/90 text-white backdrop-blur-sm shadow-[0_0_16px_rgba(239,68,68,0.75)]">Agotado</span>
        ) : (
          <span data-onboarding="badge-disponible" className="absolute bottom-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-emerald-500/90 text-white backdrop-blur-sm shadow-[0_0_16px_rgba(16,185,129,0.75)]">{dispoLabel}</span>
        )}
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt={title}
            className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${gris ? 'opacity-50 grayscale' : ''}`}
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={e => { const t = e.currentTarget; if (t.dataset.fb === '1') return; t.dataset.fb = '1'; t.src = '/vite.svg' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-12 h-12 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
        )}
      </div>

      {/* Info compacta: el título reserva 2 líneas para que los precios queden
          alineados aunque un nombre ocupe una o dos líneas. La descripción SOLO
          aparece si el producto la tiene: antes se reservaban 2 líneas vacías y
          la card quedaba muy "despegada" entre el texto y el precio. */}
      <div className="p-4 flex flex-col">
        {meta && <p className="text-[11px] text-mute truncate mb-1">{meta}</p>}
        <h3 className="font-bold text-ink text-sm uppercase tracking-wide leading-snug line-clamp-2 group-hover:text-gold-ink transition-colors">
          {title}
        </h3>
        {subtitle && <p className="text-xs text-mute mt-1 line-clamp-1">{subtitle}</p>}

        {/* Precio + disponibilidad. items-center (no items-end): con la etiqueta
            de disponibilidad a 1 línea y el precio a 2, items-end dejaba un hueco
            grande encima de la disponibilidad. */}
        <div className="pt-2.5 flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold [text-shadow:0_0_6px_currentColor] ${sobrePedido ? 'text-[#c026ff]' : gris ? 'text-red-500' : 'text-libre'}`}>
            <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] ${sobrePedido ? 'bg-[#c026ff]' : gris ? 'bg-red-500' : 'bg-libre'}`} />
            {sobrePedido ? 'Sobre pedido' : gris ? 'Agotado' : dispoLabel}
          </span>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-mute font-mono uppercase leading-none">{modo === 'venta' ? 'Precio venta' : `desde /${unit}`}{priceOriginal ? <span className="ml-1.5 normal-case line-through text-[10.5px]">${priceOriginal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> : null}</p>
            <p className="text-base font-black text-gold-ink leading-tight mt-0.5">
              ${displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {sobrePedido && entregaDias ? (
          <p className="mt-2 text-[11px] font-semibold text-[#c026ff]">Entrega estimada ~{entregaDias} días</p>
        ) : null}

        {/* "Ver ficha" siempre; cotizar solo para quien puede hacerlo.
            Una cuenta del equipo no arma cotizaciones de cliente (el backend lo
            rechaza), así que ofrecerle el botón solo sirve para que llene el
            carrito y se estrelle al enviar. Consultar el catálogo sí es suyo:
            necesita ver precios y fichas para atender a alguien. */}
        <div className="mt-3 pt-3 border-t border-edge flex gap-2">
          <Link to={ficha} className={`${delNegocio ? 'w-full' : 'flex-1'} py-2 rounded-full border border-edge text-ink text-xs font-semibold text-center hover:bg-surface-2 hover:border-gold/40 transition-colors`}>
            Ver ficha
          </Link>
          {!delNegocio && (gris ? (
            <span className="flex-1 py-2 rounded-full bg-surface-2 text-mute text-xs font-bold text-center">Agotado</span>
          ) : (
            <button onClick={agregar} className="flex-1 py-2 rounded-full bg-gold text-black text-xs font-bold hover:opacity-90 transition-colors active:scale-[0.98]">
              {sobrePedido ? 'Cotizar pedido' : '+ Cotizar'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
