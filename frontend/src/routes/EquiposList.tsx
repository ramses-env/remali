import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import api from '../lib/api'
import PriceUnitToggle from '../components/PriceUnitToggle'
import FloatingFilters from '../components/FloatingFilters'
import FilterSidebar from '../components/FilterSidebar'
import { usePriceUnit } from '../store/priceUnit'
import { downloadEquiposPdf } from '../lib/pdf'

type Equipo = {
  id: number
  modelo: string
  descripcion?: string
  imagen?: string | null
  imagenes?: string[]
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  estado?: string
  tipo?: { id: number; nombre: string }
  categoria?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
}

function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : null
  if (n === null || Number.isNaN(n)) return null
  return n
}

export default function EquiposList() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Equipo[]>([])
  const { unit } = usePriceUnit()
  const [sortBy] = useState<'price'|'title'>('price')
  const [order] = useState<'asc'|'desc'>('asc')
  const [page, setPage] = useState<number>(0)
  const [pageSize, setPageSize] = useState<number>(9)
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [query, setQuery] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState<number>(-1)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const firstCardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
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
    const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    api.get<Equipo[]>(`/equipos/?${qs}${search}`)
      .then(r => setItems(r.data))
      .catch(() => setItems([
        { id: 101, modelo: 'Equipo demo A', descripcion: 'Descripción de ejemplo', imagen: '/vite.svg', precio_dia: 500, precio_semana: 2800, precio_mes: 9500 },
        { id: 102, modelo: 'Equipo demo B', descripcion: 'Descripción de ejemplo', imagen: '/vite.svg', precio_dia: 350, precio_semana: 2100, precio_mes: 7800 },
      ]))
  }, [filters, query])

  useEffect(() => {
    const w = window.innerWidth
    const cols = w >= 1024 ? 3 : w >= 640 ? 2 : 1
    const gridTop = gridRef.current?.getBoundingClientRect().top || 0
    const paginationReserve = 90
    const avail = Math.max(0, window.innerHeight - gridTop - paginationReserve)
    const measured = firstCardRef.current?.getBoundingClientRect()?.height
    const fallbackH = w >= 1024 ? 420 : w >= 640 ? 380 : 360
    const cardH = measured && measured > 0 ? measured : fallbackH
    const rows = Math.max(1, Math.floor(avail / cardH))
    const desired = Math.max(cols * rows, 10)
    const size = Math.ceil(desired / cols) * cols
    setPageSize(size)
  }, [items])

  useEffect(() => {
    const h = setTimeout(() => setQuery(inputValue), 250)
    return () => clearTimeout(h)
  }, [inputValue])

  useEffect(() => {
    setPage(0)
  }, [query, filters, sortBy, order])

  const asProduct = (e: Equipo) => {
    const d = toNumber(e.precio_dia)
    const s = toNumber(e.precio_semana)
    const m = toNumber(e.precio_mes)
    const price =
      unit === 'dia' ? (d ?? s ?? m ?? 0) :
      unit === 'semana' ? (s ?? (d ? d * 7 : null) ?? m ?? 0) :
      (m ?? (d ? d * 30 : null) ?? (s ? s * 4 : null) ?? 0)
    return {
      id: e.id,
      title: e.modelo,
      price,
      image: (e.imagen || (e.imagenes || [])[0] || '') || '',
      description: e.descripcion || '',
      condition: (e as any).condicion || '',
      brand: (e as any).marca?.nombre || '',
      category: (e as any).categoria?.nombre || '',
      type: (e as any).tipo?.nombre || '',
    }
  }

  const shown = useMemo(() => {
    const arr = items.map(asProduct)
    const priceSel = (filters['price'] || [])[0]
    let out = arr
    if (priceSel) {
      const [minStr, maxStr] = priceSel.split(':')
      const min = Number(minStr) || 0
      const max = Number(maxStr) || Number.POSITIVE_INFINITY
      out = out.filter(p => {
        const n = Number(p.price)
        if (!Number.isFinite(n)) return true
        return n >= min && n <= max
      })
    }
    const conds = filters['condition'] || []
    if (conds.length) {
      const set = new Set(conds.map(c => c.toLowerCase()))
      out = out.filter(p => {
        const c = (p.condition || '').toLowerCase()
        if (!c) return true
        return set.has(c)
      })
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      out = out.filter(p => {
        const full = `${p.title} ${p.description} ${p.brand} ${p.category}`.toLowerCase()
        return full.includes(q)
      })
    }
    out.sort((a, b) => {
      const va = sortBy === 'price' ? Number(a.price) : a.title.localeCompare(b.title)
      const vb = sortBy === 'price' ? Number(b.price) : b.title.localeCompare(a.title)
      if (typeof va === 'number' && typeof vb === 'number') return order === 'asc' ? va - vb : vb - va
      return 0
    })
    const start = page * pageSize
    const end = start + pageSize
    return out.slice(start, end)
  }, [items, filters, query, sortBy, order, page, pageSize, unit])

  const suggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (!q) return []
    return items
      .map(asProduct)
      .filter(p => {
        const full = `${p.title} ${p.description} ${p.brand} ${p.category}`.toLowerCase()
        return full.includes(q)
      })
      .slice(0, 6)
  }, [items, inputValue, unit])
  const filteredAll = useMemo(() => {
    const arr = items.map(asProduct)
    const priceSel = (filters['price'] || [])[0]
    let out = arr
    if (priceSel) {
      const [minStr, maxStr] = priceSel.split(':')
      const min = Number(minStr) || 0
      const max = Number(maxStr) || Number.POSITIVE_INFINITY
      out = out.filter(p => {
        const n = Number(p.price)
        if (!Number.isFinite(n)) return true
        return n >= min && n <= max
      })
    }
    const conds = filters['condition'] || []
    if (conds.length) {
      const set = new Set(conds.map(c => c.toLowerCase()))
      out = out.filter(p => {
        const c = (p.condition || '').toLowerCase()
        if (!c) return true
        return set.has(c)
      })
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      out = out.filter(p => {
        const full = `${p.title} ${p.description} ${p.brand} ${p.category}`.toLowerCase()
        return full.includes(q)
      })
    }
    out.sort((a, b) => {
      const va = sortBy === 'price' ? Number(a.price) : a.title.localeCompare(b.title)
      const vb = sortBy === 'price' ? Number(b.price) : b.title.localeCompare(a.title)
      if (typeof va === 'number' && typeof vb === 'number') return order === 'asc' ? va - vb : vb - va
      return 0
    })
    return out
  }, [items, filters, query, sortBy, order, unit])
  return (
    <div className="space-y-6">
      <FloatingFilters value={filters} onChange={setFilters} />
      <div className="text-center space-y-2">
        <p className="uppercase tracking-widest text-sm text-gray-500">Catálogo de Equipo</p>
        <h2 className="text-3xl font-extrabold tracking-tight">Remali</h2>
      </div>
      <div>
        <div className="flex flex-col gap-3 md:grid md:grid-cols-4 md:gap-3 md:items-center">
          <div className="block order-2 md:order-1 md:col-span-1 text-xs sm:text-sm text-gray-600 mt-2 md:mt-0 px-3 sm:px-0">Mostrando {shown.length} de {items.length} resultados</div>
          <div className="order-1 md:order-2 md:col-span-3">
            <div className="grid grid-cols-2 gap-2 justify-items-center md:flex md:gap-3 md:justify-end md:items-center">
              <div className="col-span-2 md:flex-none md:w-auto min-w-0">
                <div className="relative flex w-full mx-auto px-3 sm:px-0">
                  <div className="flex shrink-0 w-10 items-center justify-center rounded-tl-lg rounded-bl-lg border-r border-gray-300 bg-gray-100 shadow-md">
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none w-5 fill-gray-500 transition">
                      <path d="M16.72 17.78a.75.75 0 1 0 1.06-1.06l-1.06 1.06ZM9 14.5A5.5 5.5 0 0 1 3.5 9H2a7 7 0 0 0 7 7v-1.5ZM3.5 9A5.5 5.5 0 0 1 9 3.5V2a7 7 0 0 0-7 7h1.5ZM9 3.5A5.5 5.5 0 0 1 14.5 9H16a7 7 0 0 0-7-7v1.5Zm3.89 10.45 3.83 3.83 1.06-1.06-3.83-3.83-1.06 1.06ZM14.5 9a5.48 5.48 0 0 1-1.61 3.89l1.06 1.06A6.98 6.98 0 0 0 16 9h-1.5Zm-1.61 3.89A5.48 5.48 0 0 1 9 14.5V16a6.98 6.98 0 0 0 4.95-2.05l-1.06-1.06Z"></path>
                    </svg>
                  </div>
                  <input
                    value={inputValue}
                    onChange={e => { setInputValue(e.target.value); setShowSuggestions(true); setActiveSuggestion(-1) }}
                    onFocus={() => setShowSuggestions(true)}
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(i => Math.max(i - 1, 0)) }
                      else if (e.key === 'Enter') {
                        if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                          const s = suggestions[activeSuggestion]
                          setInputValue(s.title)
                          setQuery(s.title)
                          setShowSuggestions(false)
                          navigate(`/equipo/${s.id}`)
                        } else {
                          setQuery(inputValue)
                          setShowSuggestions(false)
                        }
                      } else if (e.key === 'Escape') {
                        setShowSuggestions(false)
                      }
                    }}
                    placeholder="Buscar equipo..."
                    className="flex-1 min-w-0 bg-gray-100 pl-2 text-sm font-semibold outline-0 h-10 leading-10 shadow-md focus:ring-2 focus:ring-[#517ea0]"
                  />
                  <button
                    aria-label={inputValue ? 'Limpiar búsqueda' : 'Buscar'}
                    title={inputValue ? 'Limpiar' : 'Buscar'}
                    className="bg-gradient-to-r from-[#5488af] to-[#487aa1] w-20 sm:w-28 h-10 rounded-tr-lg rounded-br-lg text-white font-semibold flex items-center justify-center gap-2 transition-all shrink-0"
                    onClick={() => {
                      if (inputValue) {
                        setInputValue(''); setQuery(''); setShowSuggestions(false)
                      } else {
                        setQuery(inputValue); setShowSuggestions(false)
                      }
                    }}
                  >
                    {inputValue ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 20 20" aria-hidden="true">
                          <path className="fill-current" d="M16.72 17.78a.75.75 0 1 0 1.06-1.06l-1.06 1.06ZM9 14.5A5.5 5.5 0 0 1 3.5 9H2a7 7 0 0 0 7 7v-1.5ZM3.5 9A5.5 5.5 0 0 1 9 3.5V2a7 7 0 0 0-7 7h1.5ZM9 3.5A5.5 5.5 0 0 1 14.5 9H16a7 7 0 0 0-7-7v1.5Zm3.89 10.45 3.83 3.83 1.06-1.06-3.83-3.83-1.06 1.06ZM14.5 9a5.48 5.48 0 0 1-1.61 3.89l1.06 1.06A6.98 6.98 0 0 0 16 9h-1.5Zm-1.61 3.89A5.48 5.48 0 0 1 9 14.5V16a6.98 6.98 0 0 0 4.95-2.05l-1.06-1.06Z"></path>
                        </svg>
                        <span className="hidden sm:inline">Buscar</span>
                      </>
                    )}
                  </button>
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute left-10 right-0 top-11 z-20 rounded-b-lg bg-white border border-neutral-200 shadow-lg max-h-64 overflow-auto">
                      {suggestions.map((s, i) => (
                        <button
                          key={s.id}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left ${activeSuggestion === i ? 'bg-[#e9f2f7]' : 'hover:bg-neutral-100'}`}
                          onMouseEnter={() => setActiveSuggestion(i)}
                          onClick={() => { setInputValue(s.title); setQuery(s.title); setShowSuggestions(false); navigate(`/equipo/${s.id}`) }}
                        >
                          {s.image && (
                            <img
                              src={s.image}
                              alt={s.title}
                              className="w-10 h-10 object-cover rounded"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={e => {
                                const t = e.currentTarget
                                if (t.dataset.fallbackApplied === '1') return
                                t.dataset.fallbackApplied = '1'
                                t.src = '/vite.svg'
                              }}
                            />
                          )}
                          <span className="flex-1 min-w-0">
                            <span className="block font-semibold truncate">{s.title}</span>
                            <span className="block text-xs text-gray-600 truncate">${Number(s.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </span>
                        </button>
                      ))}
                      <div className="px-3 py-2 text-xs text-gray-600 border-t">Pulsa Enter para buscar “{inputValue}” o selecciona una sugerencia</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-1 gap-3 px-3 sm:px-0 mt-3 mb-5 md:my-0 md:flex md:justify-end">
                <div className="col-span-1 md:hidden">
                  <button
                    className="w-full rounded-full border px-3 py-2 text-sm bg-white shadow-sm hover:bg-neutral-50 flex items-center justify-center gap-2"
                    onClick={() => window.dispatchEvent(new CustomEvent('toggleFilters'))}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    Filtros
                  </button>
                </div>
                <div className="col-span-1 md:flex-none">
                  <PriceUnitToggle />
                </div>
                <div className="col-span-1 md:flex-none">
                  <button
                    className="rounded-full border px-3 py-2 text-sm bg-white shadow-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
                    onClick={async () => {
                      await downloadEquiposPdf(filteredAll, filters, unit)
                    }}
                    title="Descargar PDF"
                    aria-label="Descargar PDF"
                  >
                    Descargar PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid md:grid-cols-4 gap-6 mt-0 sm:mt-6">
          <aside className="hidden md:block">
            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 shadow-sm sticky top-24 max-h-[calc(100vh-6rem)] overflow-y-auto">
              <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
                <p className="font-extrabold">Filtros</p>
                <button className="text-sm px-3 py-1.5 rounded-full border" onClick={() => setFilters({})}>Limpiar</button>
              </div>
              <FilterSidebar value={filters} onChange={setFilters} />
            </div>
          </aside>
          <div className="md:col-span-3">
            <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {shown.map((p, i) => (
                <div key={p.id} ref={i === 0 ? firstCardRef : undefined}>
                  <ProductCard id={p.id} title={p.title} price={p.price} image={p.image || ''} subtitle={p.description?.slice(0, 40)} rating={(p.id % 5) + 1} linkTo={`/equipo/${p.id}`} />
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-center">
              <div className="btn-conteiner">
                <button
                  type="button"
                  aria-label="Siguiente"
                  className="btn-content"
                  onClick={() => setPage(p => (p + 1) * pageSize < items.length ? p + 1 : p)}
                  disabled={(page + 1) * pageSize >= items.length}
                >
                  <span>Siguiente</span>
                  <span className="icon-arrow">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      xmlnsXlink="http://www.w3.org/1999/xlink"
                      version="1.1"
                      viewBox="0 0 66 43"
                      height="30px"
                      width="30px"
                    >
                      <g
                        fillRule="evenodd"
                        fill="none"
                        strokeWidth="1"
                        stroke="none"
                        id="arrow"
                      >
                        <path
                          fill="#ffffff"
                          d="M40.1543933,3.89485454 L43.9763149,0.139296592 C44.1708311,-0.0518420739 44.4826329,-0.0518571125 44.6771675,0.139262789 L65.6916134,20.7848311 C66.0855801,21.1718824 66.0911863,21.8050225 65.704135,22.1989893 C65.7000188,22.2031791 65.6958657,22.2073326 65.6916762,22.2114492 L44.677098,42.8607841 C44.4825957,43.0519059 44.1708242,43.0519358 43.9762853,42.8608513 L40.1545186,39.1069479 C39.9575152,38.9134427 39.9546793,38.5968729 40.1481845,38.3998695 C40.1502893,38.3977268 40.1524132,38.395603 40.1545562,38.3934985 L56.9937789,21.8567812 C57.1908028,21.6632968 57.193672,21.3467273 57.0001876,21.1497035 C56.9980647,21.1475418 56.9959223,21.1453995 56.9937605,21.1432767 L40.1545208,4.60825197 C39.9574869,4.41477773 39.9546013,4.09820839 40.1480756,3.90117456 C40.1501626,3.89904911 40.152268631,3.89694235 40.1543933,3.89485454 Z"
                          id="arrow-icon-one"
                        ></path>
                        <path
                          fill="#ffffff"
                          d="M20.1543933,3.89485454 L23.9763149,0.139296592 C24.1708311,-0.0518420739 24.4826329,-0.0518571125 24.6771675,0.139262789 L45.6916134,20.7848311 C46.0855801,21.1718824 46.0911863,21.8050225 45.704135,22.1989893 C45.7000188,22.2031791 45.6958657,22.2073326 45.6916762,22.2114492 L24.677098,42.8607841 C24.4825957,43.0519059 24.1708242,43.0519358 23.9762853,42.8608513 L20.1545186,39.1069479 C19.9575152,38.9134427 19.9546793,38.5968729 20.1481845,38.3998695 C20.1502893,38.3977268 20.1524132,38.395603 20.1545562,38.3934985 L36.9937789,21.8567812 C37.1908028,21.6632968 37.193672,21.3467273 37.0001876,21.1497035 C36.9980647,21.1475418 36.9959223,21.1453995 36.9937605,21.1432767 L20.1545208,4.60825197 C19.9574869,4.41477773 19.9546013,4.09820839 20.1480756,3.90117456 C20.1501626,3.89904911 20.152268631,3.89694235 20.1543933,3.89485454 Z"
                          id="arrow-icon-two"
                        ></path>
                        <path
                          fill="#ffffff"
                          d="M0.154393339,3.89485454 L3.97631488,0.139296592 C4.17083111,-0.0518420739 4.48263286,-0.0518571125 4.67716753,0.139262789 L25.6916134,20.7848311 C26.0855801,21.1718824 26.0911863,21.8050225 25.704135,22.1989893 C25.7000188,22.2031791 25.6958657,22.2073326 25.6916762,22.2114492 L4.67709797,42.8607841 C4.48259567,43.0519059 4.17082418,43.0519358 3.97628526,42.8608513 L0.154518591,39.1069479 C-0.0424848215,38.9134427 -0.0453206733,38.5968729 0.148184538,38.3998695 C0.150289256,38.3977268 0.152413239,38.395603 0.154556228,38.3934985 L16.9937789,21.8567812 C17.1908028,21.6632968 17.193672,21.3467273 17.0001876,21.1497035 C16.9980647,21.1475418 16.9959223,21.1453995 16.9937605,21.1432767 L0.15452076,4.60825197 C-0.0425130651,4.41477773 -0.0453986756,4.09820839 0.148075568,3.90117456 C0.150162624,3.89904911 0.152268631,3.89694235 0.154393339,3.89485454 Z"
                          id="arrow-icon-three"
                        ></path>
                      </g>
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-600">
        <p>Mostrando precios por {unit}. Los precios por otra unidad se pueden estimar.</p>
      </div>
    </div>
  )
}
