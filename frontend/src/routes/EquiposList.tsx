import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import ProductCard from '../components/ProductCard'
import api from '../lib/api'
import Migas from '../components/Migas'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import PriceUnitToggle from '../components/PriceUnitToggle'
import FloatingFilters from '../components/FloatingFilters'
import FilterSidebar from '../components/FilterSidebar'
import { usePriceUnit } from '../store/priceUnit'
import { toNumber } from '../lib/utils'

gsap.registerPlugin(ScrollTrigger)

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
  promo_pct?: number
  estado?: string
  tipo?: { id: number; nombre: string }
  categoria?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
  disponible_venta?: boolean
  disponible_renta?: boolean
  condiciones?: string[]
}

export default function EquiposList() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const firstCardRef = useRef<HTMLDivElement | null>(null)

  const [items, setItems] = useState<Equipo[]>([])
  const { unit } = usePriceUnit()
  const [sortKey, setSortKey] = useState<'price-asc' | 'price-desc' | 'title' | 'recientes'>('recientes')
  const [page, setPage] = useState<number>(0)
  const [pageSize, setPageSize] = useState<number>(9)
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [query, setQuery] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState<number>(-1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [uso, setUso] = useState<'' | 'venta' | 'renta'>('')

  // Popover de descarga: el cliente elige qué incluir en el PDF.
  const [dlOpen, setDlOpen] = useState(false)
  const [dlVenta, setDlVenta] = useState(true)
  const [dlRenta, setDlRenta] = useState(true)
  const [dlTodosPrecios, setDlTodosPrecios] = useState(true)
  const dlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dlOpen) return
    const onDoc = (e: MouseEvent) => {
      if (dlRef.current && !dlRef.current.contains(e.target as Node)) setDlOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDlOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [dlOpen])

  // Animaciones GSAP de entrada
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.char', { yPercent: 110, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.035 })
      gsap.from('.catalog-header-title', { y: 16, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, delay: 0.15 })
    }, rootRef)
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    const categories = filters['category']?.filter(Boolean) || []
    if (categories.length) params['category'] = categories.join(',')
    const brands = filters['brand']?.filter(Boolean) || []
    if (brands.length) params['brand'] = brands.join(',')
    const types = filters['type']?.filter(Boolean) || []
    if (types.length) params['type'] = types.join(',')
    const priceSel = (filters['price'] || [])[0]
    const search = query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''
    if (priceSel) {
      const [minStr, maxStr] = priceSel.split(':')
      const min = Number(minStr) || 0
      const max = Number(maxStr) || 0
      if (min) params['price_min'] = String(min)
      if (max) params['price_max'] = String(max)
    }
    if (uso) params['uso'] = uso
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    setLoadError(false)
    api.get<Equipo[]>(`/equipos/?${qs}${search}`)
      .then(r => setItems(Array.isArray(r.data) ? r.data : []))
      // Sin datos-mock: mostrar productos falsos a un cliente real es engañoso.
      .catch(() => { setItems([]); setLoadError(true) })
      .finally(() => setLoading(false))
  }, [filters, query, uso])

  useEffect(() => {
    const w = window.innerWidth
    const cols = w >= 1024 ? 3 : w >= 640 ? 2 : 1
    const gridTop = gridRef.current?.getBoundingClientRect().top || 0
    const avail = Math.max(0, window.innerHeight - gridTop - 90)
    const measured = firstCardRef.current?.getBoundingClientRect()?.height
    const fallbackH = w >= 1024 ? 420 : w >= 640 ? 380 : 360
    const cardH = measured && measured > 0 ? measured : fallbackH
    const rows = Math.max(1, Math.floor(avail / cardH))
    const desired = Math.max(cols * rows, 10)
    setPageSize(Math.ceil(desired / cols) * cols)
  }, [items])

  useEffect(() => {
    const h = setTimeout(() => setQuery(inputValue), 250)
    return () => clearTimeout(h)
  }, [inputValue])

  useEffect(() => { setPage(0) }, [query, filters, sortKey, uso])

  // Categorías para chips rápidos (derivadas del catálogo cargado)
  const categoriasChips = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach(e => { const n = e.categoria?.nombre; if (n) m.set(n, (m.get(n) || 0) + 1) })
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nombre]) => nombre)
  }, [items])
  const activeCat = (filters['category'] || [])[0] || ''
  const setCat = (nombre: string) => setFilters(f => {
    const next = { ...f }
    if (!nombre || activeCat === nombre) delete next['category']
    else next['category'] = [nombre]
    return next
  })

  const asProduct = useMemo(() => (e: Equipo) => {
    const modo: 'venta' | 'renta' = e.modo || (e.condicion === 'seminueva' ? 'renta' : 'venta')
    const d = toNumber(e.precio_dia)
    const s = toNumber(e.precio_semana)
    const m = toNumber(e.precio_mes)
    const rentaPrice =
      unit === 'dia' ? (d ?? s ?? m ?? 0) :
      unit === 'semana' ? (s ?? (d ? d * 7 : null) ?? m ?? 0) :
      (m ?? (d ? d * 30 : null) ?? (s ? s * 4 : null) ?? 0)
    // Venta muestra su precio de venta; renta, el de la modalidad elegida.
    const bruto = modo === 'venta' ? (toNumber(e.precio_venta) ?? 0) : rentaPrice
    // Promo del equipo (admin): la card muestra el precio ya con descuento.
    const promo = Math.max(0, Math.min(90, e.promo_pct || 0))
    const price = promo ? Math.round(bruto * (1 - promo / 100) * 100) / 100 : bruto
    return {
      id: e.id,
      title: e.modelo,
      price,
      priceOriginal: promo ? bruto : undefined,
      promo,
      modo,
      // Precios crudos por modalidad: los usa el PDF para ofrecer "los tres precios".
      precioDia: d,
      precioSemana: s,
      precioMes: m,
      image: resolveMediaUrl(e.imagen || (e.imagenes || [])[0] || '') || '',
      description: e.descripcion || '',
      condition: (e as any).condicion || '',
      brand: (e as any).marca?.nombre || '',
      category: (e as any).categoria?.nombre || '',
      type: (e as any).tipo?.nombre || '',
      ventaOk: e.disponible_venta ?? true,
      rentaOk: e.disponible_renta ?? false,
      condiciones: e.condiciones || [],
    }
  }, [unit])

  const filteredAll = useMemo(() => {
    let out = items.map(asProduct)
    const priceSel = (filters['price'] || [])[0]
    if (priceSel) {
      const [minStr, maxStr] = priceSel.split(':')
      const min = Number(minStr) || 0
      const max = Number(maxStr) || Number.POSITIVE_INFINITY
      out = out.filter(p => { const n = Number(p.price); return !Number.isFinite(n) || (n >= min && n <= max) })
    }
    const conds = filters['condition'] || []
    if (conds.length) {
      const set = new Set(conds.map(c => c.toLowerCase()))
      out = out.filter(p => { const c = (p.condition || '').toLowerCase(); return !c || set.has(c) })
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      out = out.filter(p => `${p.title} ${p.description} ${p.brand} ${p.category}`.toLowerCase().includes(q))
    }
    out.sort((a, b) => {
      switch (sortKey) {
        case 'price-asc': return Number(a.price) - Number(b.price)
        case 'price-desc': return Number(b.price) - Number(a.price)
        case 'title': return a.title.localeCompare(b.title)
        default: return b.id - a.id // recientes
      }
    })
    // El cliente pidió los equipos de venta SEPARADOS de los de renta: en
    // "Todos" van agrupados (venta primero), con el orden elegido dentro de
    // cada grupo. Con un chip (Comprar/Rentar) activo el grupo ya es único.
    out = [...out.filter(p => p.modo === 'venta'), ...out.filter(p => p.modo !== 'venta')]
    return out
  }, [items, filters, query, sortKey, unit, asProduct])

  const shown = useMemo(() => {
    const start = page * pageSize
    return filteredAll.slice(start, start + pageSize)
  }, [filteredAll, page, pageSize])

  // Animar cards cuando cambia el resultado
  useEffect(() => {
    if (loading) return
    const ctx = gsap.context(() => {
      gsap.from('.equipo-card', {
        y: 50,
        opacity: 0,
        duration: 0.7,
        ease: 'expo.out',
        stagger: 0.07,
      })
    }, gridRef)
    return () => ctx.revert()
  }, [loading, shown])

  const suggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (!q) return []
    return items.map(asProduct).filter(p =>
      `${p.title} ${p.description} ${p.brand} ${p.category}`.toLowerCase().includes(q)
    ).slice(0, 6)
  }, [items, inputValue, asProduct])

  const activeFilterCount = Object.values(filters).flat().filter(Boolean).length

  return (
    <div ref={rootRef} className="bg-app min-h-screen text-ink font-sans">
      <FloatingFilters value={filters} onChange={setFilters} />

      {/* ── HEADER ── */}
      <div className="relative px-6 md:px-16 lg:px-24 pt-28 pb-8 overflow-hidden">
        {/* Fondo premium: rejilla + glow dorado */}
        <div className="absolute inset-0 pointer-events-none -z-10">
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(var(--c-grid) 1px,transparent 1px),linear-gradient(90deg,var(--c-grid) 1px,transparent 1px)', backgroundSize: '64px 64px' }} />
          <div className="absolute -top-20 right-[8%] w-[420px] h-[420px] rounded-full bg-gold/10 blur-[130px]" />
        </div>

        <div className="mb-4"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Equipos' }]} /></div>
        <p className="catalog-header-title text-[11px] font-mono text-gold uppercase tracking-[0.3em] mb-4">
          — Maquinaria ligera · Renta y venta
        </p>
        <div className="overflow-hidden mb-1">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.92]">
            {/* Cada PALABRA en un contenedor nowrap: la animación sigue letra por
                letra, pero el salto de línea solo cae ENTRE palabras completas
                (antes la "E" de EQUIPOS se quedaba arriba y el resto abajo). */}
            <span className="inline-block whitespace-nowrap">{'CATÁLOGO'.split('').map((c, i) => <span key={i} className="char inline-block">{c}</span>)}</span>{' '}
            <span className="text-gold"><span className="inline-block whitespace-nowrap">{'DE'.split('').map((c, i) => <span key={`d${i}`} className="char inline-block">{c}</span>)}</span>{' '}<span className="inline-block whitespace-nowrap">{'EQUIPOS'.split('').map((c, i) => <span key={`e${i}`} className="char inline-block">{c}</span>)}</span></span>
          </h1>
        </div>
        <p className="catalog-header-title text-mute text-sm md:text-base mt-4 max-w-xl leading-relaxed">
          Explora nuestra flota. Filtra por categoría, compara precios por día, semana o mes, y solicita tu equipo en minutos.
        </p>

        {/* Chips de categoría */}
        {categoriasChips.length > 0 && (
          <div className="catalog-header-title flex gap-2 mt-6 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
            <button
              onClick={() => setCat('')}
              className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${!activeCat ? 'bg-gold text-black border-gold' : 'border-edge bg-surface-2 text-mute hover:text-ink'}`}
            >
              Todas
            </button>
            {categoriasChips.map(c => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${activeCat === c ? 'bg-gold text-black border-gold' : 'border-edge bg-surface-2 text-mute hover:text-ink'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── BARRA DE CONTROLES ── */}
      {/* En móvil NO es fija: apilada (buscador + filtros + precio + conteo) mide
          demasiado y, pegada arriba, tapaba media pantalla y estorbaba para ver
          las máquinas. Se deja fija solo en desktop, donde sí cabe en una fila. */}
      <div className="catalog-controls relative md:sticky md:top-[64px] z-30 bg-app/90 backdrop-blur-md border-y border-edge px-6 md:px-16 lg:px-24 py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          {/* Buscador */}
          <div className="relative flex-1 max-w-xl">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-mute pointer-events-none">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" />
              </svg>
            </div>
            <input
              value={inputValue}
              onChange={e => { setInputValue(e.target.value); setShowSuggestions(true); setActiveSuggestion(-1) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(i => Math.max(i - 1, 0)) }
                else if (e.key === 'Enter') {
                  if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                    const s = suggestions[activeSuggestion]
                    setInputValue(s.title); setQuery(s.title); setShowSuggestions(false)
                    navigate(`/equipo/${s.id}`)
                  } else { setQuery(inputValue); setShowSuggestions(false) }
                } else if (e.key === 'Escape') setShowSuggestions(false)
              }}
              placeholder="Buscar equipo..."
              className="w-full bg-surface-2 border border-edge rounded-full pl-10 pr-10 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 focus:bg-surface-2 transition-all"
            />
            {inputValue && (
              <button
                onClick={() => { setInputValue(''); setQuery(''); setShowSuggestions(false) }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-mute hover:text-ink transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}

            {/* Sugerencias */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full mt-2 left-0 right-0 z-50 bg-surface border border-edge rounded-2xl overflow-hidden shadow-2xl">
                {suggestions.map((s, i) => (
                  <button
                    key={s.id}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${activeSuggestion === i ? 'bg-gold-soft' : 'hover:bg-surface-2'}`}
                    onMouseEnter={() => setActiveSuggestion(i)}
                    onClick={() => { setInputValue(s.title); setQuery(s.title); setShowSuggestions(false); navigate(`/equipo/${s.id}`) }}
                  >
                    {s.image && (
                      <img src={s.image} alt={s.title} className="w-10 h-10 object-cover rounded-lg" loading="lazy"
                        onError={e => { const t = e.currentTarget; if (!t.dataset.fb) { t.dataset.fb = '1'; t.src = '/vite.svg' } }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{s.title}</p>
                      <p className="text-xs text-mute">${Number(s.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
                <p className="px-4 py-2 text-xs text-mute border-t border-edge">
                  Enter para buscar "{inputValue}"
                </p>
              </div>
            )}
          </div>

          {/* Controles derecha */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Segmented Comprar / Rentar */}
            <div className="flex items-center p-1 rounded-full border border-edge bg-surface-2">
              {([['', 'Todos'], ['venta', 'Comprar'], ['renta', 'Rentar']] as const).map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setUso(val)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${uso === val ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* Filtros mobile */}
            <button
              onClick={() => window.dispatchEvent(new Event('toggleFilters'))}
              className={`md:hidden flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-medium transition-colors ${activeFilterCount > 0 ? 'border-gold bg-gold-soft text-gold' : 'border-edge bg-surface-2 text-mute hover:text-ink hover:border-edge'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M7 12h10M10 18h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Filtros {activeFilterCount > 0 && <span className="w-5 h-5 rounded-full bg-gold text-black text-[10px] font-black flex items-center justify-center">{activeFilterCount}</span>}
            </button>

            {/* Orden */}
            <div className="relative">
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as typeof sortKey)}
                className="appearance-none pl-4 pr-9 py-2.5 rounded-full border border-edge bg-surface-2 text-mute hover:text-ink text-xs font-semibold focus:outline-none focus:border-gold/50 transition-colors cursor-pointer"
                aria-label="Ordenar"
              >
                <option value="recientes" className="bg-surface">Más recientes</option>
                <option value="price-asc" className="bg-surface">Precio: menor a mayor</option>
                <option value="price-desc" className="bg-surface">Precio: mayor a menor</option>
                <option value="title" className="bg-surface">Nombre (A-Z)</option>
              </select>
              <svg className="w-3.5 h-3.5 absolute right-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </div>

            {/* Toggle precio */}
            <PriceUnitToggle />

            {/* PDF con opciones de descarga */}
            <div className="relative" ref={dlRef}>
              <button
                onClick={() => setDlOpen(o => !o)}
                aria-expanded={dlOpen}
                aria-label="Opciones de descarga PDF"
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-edge bg-surface-2 text-mute hover:text-ink hover:border-edge text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="hidden sm:inline">PDF</span>
                <svg className={`w-3 h-3 transition-transform duration-200 ${dlOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>

              {dlOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-edge bg-surface shadow-[0_16px_50px_rgba(0,0,0,0.5)] p-4 z-50 origin-top-right stagger-item">
                  <p className="text-sm font-bold text-ink">Descargar catálogo</p>
                  <p className="text-[11px] text-mute mb-3">Elige qué incluir en el PDF.</p>

                  <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                    <span className="text-sm text-ink">Equipos en venta</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-mute font-mono">{filteredAll.filter(p => p.modo === 'venta').length}</span>
                      <input type="checkbox" className="w-4 h-4 accent-gold" checked={dlVenta} onChange={e => setDlVenta(e.target.checked)} />
                    </span>
                  </label>

                  <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                    <span className="text-sm text-ink">Equipos en renta</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-mute font-mono">{filteredAll.filter(p => p.modo !== 'venta').length}</span>
                      <input type="checkbox" className="w-4 h-4 accent-gold" checked={dlRenta} onChange={e => setDlRenta(e.target.checked)} />
                    </span>
                  </label>

                  {/* Precios de renta: los tres o solo la unidad activa */}
                  <div className={`mt-2.5 mb-3.5 transition-opacity ${dlRenta ? '' : 'opacity-40 pointer-events-none'}`}>
                    <p className="text-[11px] text-mute mb-1.5">Precios de renta</p>
                    <div className="flex rounded-full border border-edge overflow-hidden text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setDlTodosPrecios(true)}
                        className={`flex-1 px-2 py-1.5 transition-colors ${dlTodosPrecios ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}
                      >Día · Semana · Mes</button>
                      <button
                        type="button"
                        onClick={() => setDlTodosPrecios(false)}
                        className={`flex-1 px-2 py-1.5 transition-colors ${!dlTodosPrecios ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}
                      >Solo {unit === 'mes' ? 'mes' : unit === 'semana' ? 'semana' : 'día'}</button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!dlVenta && !dlRenta}
                    onClick={async () => {
                      setDlOpen(false)
                      // jsPDF pesa ~350 KB: se descarga solo cuando alguien genera un PDF.
                      const { downloadEquiposPdf } = await import('../lib/pdf')
                      await downloadEquiposPdf(filteredAll, filters, unit, { venta: dlVenta, renta: dlRenta, rentaTodosPrecios: dlTodosPrecios })
                    }}
                    className="w-full py-2.5 rounded-full bg-gold text-black text-sm font-bold btn-acento disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Descargar PDF
                  </button>
                </div>
              )}
            </div>

            {/* Contador */}
            <p className="text-xs text-mute font-mono whitespace-nowrap">
              {shown.length} / {filteredAll.length} equipos
            </p>
          </div>
        </div>
      </div>

      {/* ── LAYOUT PRINCIPAL ── */}
      <div className="flex gap-0 px-6 md:px-16 lg:px-24 py-10">

        {/* Sidebar filtros desktop */}
        <aside className="hidden md:block w-64 shrink-0 mr-10">
          <div className="sticky top-[140px] max-h-[calc(100vh-160px)] overflow-y-auto scrollbar-thin">
            <div className="bg-surface border border-edge rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
                <p className="text-sm font-bold text-ink tracking-tight">Filtros</p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters({})}
                    className="text-xs text-gold hover:text-gold font-medium transition-colors flex items-center gap-1"
                  >
                    Limpiar
                    <span className="w-4 h-4 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold">{activeFilterCount}</span>
                  </button>
                )}
              </div>
              <FilterSidebar value={filters} onChange={setFilters} />
            </div>
          </div>
        </aside>

        {/* Grid de equipos */}
        <div className="flex-1 min-w-0">
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 min-h-[50vh]">

            {/* Skeletons */}
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-surface-2 rounded-2xl h-80" />
            ))}

            {/* Vacío */}
            {!loading && shown.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                <div className="w-20 h-20 rounded-full bg-surface-2 border border-edge flex items-center justify-center mb-6">
                  <svg className="w-9 h-9 text-mute" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-mute mb-2">{loadError ? 'No pudimos cargar el catálogo' : 'Sin resultados'}</h3>
                <p className="text-mute text-sm mb-6 max-w-xs">
                  {loadError ? 'Revisa tu conexión e inténtalo de nuevo en un momento.' : 'Intenta con otros términos o elimina algunos filtros.'}
                </p>
                <button
                  onClick={() => { setFilters({}); setQuery(''); setInputValue('') }}
                  className="px-6 py-3 rounded-full border border-gold/30 bg-gold-soft text-gold text-sm font-semibold hover:bg-gold/20 transition-colors"
                >
                  Limpiar filtros
                </button>
              </div>
            )}

            {/* Cards */}
            {!loading && shown.map((p, i) => (
              /* h-full: la card llena su celda del grid; sin esto, una card sin
                 descripción queda más corta que su vecina y el precio flota. */
              <div key={p.id} className="equipo-card h-full" ref={i === 0 ? firstCardRef : undefined}>
                <ProductCard
                  id={p.id}
                  title={p.title}
                  price={p.price}
                  modo={p.modo}
                  image={p.image || ''}
                  subtitle={p.description}
                  meta={[p.category, p.brand].filter(Boolean).join(' · ')}
                  linkTo={`/equipo/${p.id}`}
                  priceOriginal={p.priceOriginal}
                  tags={[
                    ...(p.promo ? [{ label: `PROMO −${p.promo}%`, tone: 'promo' as const }] : []),
                    p.modo === 'venta' ? { label: 'Venta', tone: 'sale' as const } : { label: 'Renta', tone: 'rent' as const },
                  ]}
                />
              </div>
            ))}
          </div>

          {/* Paginación */}
          {filteredAll.length > pageSize && (
            <div className="mt-10 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage(p => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="px-6 py-3 rounded-full border border-edge bg-surface-2 text-sm font-medium text-mute hover:text-ink hover:border-edge disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Anterior
              </button>

              <span className="text-xs text-mute font-mono">
                {page + 1} / {Math.ceil(filteredAll.length / pageSize)}
              </span>

              <button
                onClick={() => setPage(p => (p + 1) * pageSize < filteredAll.length ? p + 1 : p)}
                disabled={(page + 1) * pageSize >= filteredAll.length}
                className="px-6 py-3 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Siguiente →
              </button>
            </div>
          )}

          <p className="mt-6 text-xs text-mute font-mono">
            Precios por {unit}. Las demás unidades son estimadas.
          </p>
        </div>
      </div>
    </div>
  )
}
