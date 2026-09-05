import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDatos } from '../lib/datos'
import Migas from '../components/Migas'
import ProductCard from '../components/ProductCard'
import { useFavoritos } from '../store/favoritos'
import { usePriceUnit } from '../store/priceUnit'
import resolveMediaUrl from '../lib/resolveMediaUrl'

type Equipo = {
  id: number
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  precio_venta?: number | string | null
  condicion?: string
  modo?: 'venta' | 'renta'
  modos?: Array<'venta' | 'renta'>
  promo_pct?: number
  categoria?: { nombre: string }
  marca?: { nombre: string }
  disponible_venta?: boolean
  disponible_renta?: boolean
  ofrece_venta?: boolean
  ofrece_renta?: boolean
  venta_disponible?: boolean
  renta_disponible?: boolean
  condiciones?: string[]
}

const toNumber = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

/** "Tus favoritos": los equipos que el cliente guardó con el corazón. Los ids
 *  viven en localStorage (store de favoritos); aquí se cruzan con el catálogo
 *  y se muestran con la misma card. */
export default function Favoritos() {
  const { ids, count } = useFavoritos()
  const { unit } = usePriceUnit()
  /* Comparte la caché del catálogo con /equipos: quien llega aquí desde la
     tienda casi siempre trae la lista ya cargada, y entonces esta pantalla se
     pinta sin una sola petición. Sigue siendo el catálogo completo porque los
     ids viven en localStorage y el filtrado es local. */
  const { datos: equipos = [], cargando } = useDatos<Equipo[]>('/equipos/')

  // Mismo criterio de precio/modo que el catálogo, reusando la card de siempre.
  const cards = useMemo(() => {
    const favSet = new Set(ids)
    const out: {
      id: number; key: string; title: string; price: number; priceOriginal?: number
      modo: 'venta' | 'renta'; disponible: boolean; image: string; description: string
      brand: string; category: string
    }[] = []
    for (const e of equipos.filter(e => favSet.has(e.id))) {
      const d = toNumber(e.precio_dia), s = toNumber(e.precio_semana), m = toNumber(e.precio_mes)
      const rentaPrice =
        unit === 'dia' ? (d ?? s ?? m ?? 0) :
        unit === 'semana' ? (s ?? (d ? d * 7 : null) ?? m ?? 0) :
        (m ?? (d ? d * 30 : null) ?? (s ? s * 4 : null) ?? 0)
      const promo = Math.max(0, Math.min(90, e.promo_pct || 0))
      const mk = (modo: 'venta' | 'renta') => {
        const bruto = modo === 'venta' ? (toNumber(e.precio_venta) ?? 0) : rentaPrice
        const price = promo ? Math.round(bruto * (1 - promo / 100) * 100) / 100 : bruto
        const disponible = modo === 'venta'
          ? (e.venta_disponible ?? e.disponible_venta ?? true)
          : (e.renta_disponible ?? e.disponible_renta ?? false)
        return {
          id: e.id, key: `${e.id}-${modo}`, title: e.modelo, price,
          priceOriginal: promo ? bruto : undefined, modo, disponible,
          image: resolveMediaUrl(e.imagen || (e.imagenes || [])[0] || '') || '',
          description: e.descripcion || '', brand: e.marca?.nombre || '', category: e.categoria?.nombre || '',
        }
      }
      const modos: ('venta' | 'renta')[] = []
      if (e.ofrece_venta) modos.push('venta')
      if (e.ofrece_renta) modos.push('renta')
      if (!modos.length) modos.push((e.modos || [])[0] || e.modo || (e.condicion === 'seminueva' ? 'renta' : 'venta'))
      out.push(...modos.map(mk))
    }
    return out
  }, [equipos, ids, unit])

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="contenedor pt-24 pb-16 flex flex-col gap-6">
        <div><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Favoritos' }]} /></div>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[34px] sm:text-[44px] font-extrabold tracking-tight leading-none">Tus favoritos</h1>
            <p className="text-mute text-[15px] mt-2.5">Los equipos que guardaste con el corazón. Se quedan en este dispositivo, listos para cotizar.</p>
          </div>
          <Link to="/equipos" className="h-[46px] px-6 rounded-xl bg-gold text-black text-[15px] font-bold grid place-items-center btn-acento shrink-0">Ver catálogo</Link>
        </div>

        {cargando ? (
          <div className="grid place-items-center py-24"><div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" /></div>
        ) : count === 0 || cards.length === 0 ? (
          <div className="rounded-[20px] border border-edge bg-surface px-6 py-16 text-center">
            <svg className="w-11 h-11 text-mute mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z" /></svg>
            <p className="text-lg font-bold">Aún no tienes favoritos</p>
            <p className="text-sm text-mute mt-1.5 max-w-sm mx-auto">Toca el corazón en cualquier equipo del catálogo y aparecerá aquí para tenerlo a la mano.</p>
            <Link to="/equipos" className="inline-block mt-5 px-6 py-3 rounded-xl bg-gold text-black text-sm font-bold btn-acento">Explorar equipos</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 content-start items-start">
            {cards.map(p => (
              <ProductCard
                key={p.key}
                id={p.id}
                title={p.title}
                price={p.price}
                modo={p.modo}
                agotado={!p.disponible}
                image={p.image}
                subtitle={p.description}
                meta={[p.category, p.brand].filter(Boolean).join(' · ')}
                priceOriginal={p.priceOriginal}
                tags={[p.modo === 'venta' ? { label: 'Venta', tone: 'sale' as const } : { label: 'Renta', tone: 'rent' as const }]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
