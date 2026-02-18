import { useEffect, useState } from 'react'
import api from '../lib/api'

type FilterOption = {
  id: number
  label: string
  param: string
  value?: string
  price_min?: number
  price_max?: number
  active: boolean
}

type Props = {
  value: Record<string, string[]>
  onChange: (next: Record<string, string[]>) => void
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-3 group cursor-pointer select-none py-1">
      <div className={`relative flex items-center justify-center w-5 h-5 rounded border transition-all duration-200 ${checked ? 'bg-[#517ea0] border-[#517ea0]' : 'bg-white border-neutral-300 group-hover:border-[#517ea0]'}`}>
        <input type="checkbox" className="peer appearance-none absolute inset-0 w-full h-full cursor-pointer z-10 opacity-0" checked={checked} onChange={onChange} />
        <svg className={`w-3.5 h-3.5 text-white fill-current transition-transform duration-200 ${checked ? 'scale-100' : 'scale-0'}`} viewBox="0 0 20 20">
          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
        </svg>
      </div>
      <span className={`text-sm transition-colors ${checked ? 'text-neutral-900 font-medium' : 'text-neutral-600 group-hover:text-neutral-900'}`}>{label}</span>
    </label>
  )
}

export default function FilterSidebar({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [marcas, setMarcas] = useState<string[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [minPrice, setMinPrice] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<string>('')

  const condiciones = [
    { label: 'Nuevo', value: 'nuevo' },
    { label: 'Seminuevo', value: 'seminuevo' },
  ]

  useEffect(() => {
    api.get<any[]>('/marcas/')
      .then(r => setMarcas(r.data.map(m => (m.nombre || '').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b))))
      .catch(() => setMarcas([]))
    api.get<any[]>('/categorias/')
      .then(r => setCategorias(r.data.map(c => (c.nombre || '').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b))))
      .catch(() => setCategorias([]))
    api.get<any[]>('/tipos/')
      .then(r => setTipos(r.data.map(t => (t.nombre || '').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b))))
      .catch(() => setTipos([]))
  }, [])

  // No brandScope dinámico por ahora; backend soporta búsqueda por marca y tipo vía query

  function toggle(param: string, opt: FilterOption) {
    const next = { ...value }
    const arr = new Set(next[param] || [])
    const key = opt.value ?? `${opt.price_min ?? ''}:${opt.price_max ?? ''}`
    if (arr.has(key)) arr.delete(key); else arr.add(key)
    next[param] = Array.from(arr)
    onChange(next)
  }

  useEffect(() => {
    const p = (value['price'] || [])[0] || ''
    const [min, max] = p.split(':')
    setMinPrice(min || '')
    setMaxPrice(max || '')
  }, [value])

  function applyPrice() {
    const min = minPrice.trim()
    const max = maxPrice.trim()
    const next = { ...value }
    if (min || max) {
      next['price'] = [`${min}:${max}`]
    } else {
      delete next['price']
    }
    onChange(next)
  }

  function toggleExpand(id: number) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <aside className="p-5 space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Condición</p>
        </div>
        <div className="space-y-2">
          {condiciones.map(opt => (
            <Checkbox
              key={opt.value}
              label={opt.label}
              checked={(value['condition'] || []).includes(opt.value)}
              onChange={() => toggle('condition', { id: 0, label: opt.label, param: 'condition', value: opt.value, active: true } as any)}
            />
          ))}
        </div>
      </div>
      
      {marcas.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Marcas</p>
          </div>
          <div className="space-y-2">
            {(expanded[1000] ? marcas : marcas.slice(0,6))
              .map(lbl => (
              <Checkbox
                key={lbl}
                label={lbl}
                checked={(value['brand'] || []).includes(lbl)}
                onChange={() => toggle('brand', { id: 0, label: lbl, param: 'brand', value: lbl, active: true } as any)}
              />
            ))}
          </div>
          {marcas.length > 6 && (
            <button className="mt-2 text-xs font-semibold text-[#517ea0] hover:text-[#416a8a] flex items-center gap-1 transition-colors" onClick={() => toggleExpand(1000)}>
              {expanded[1000] ? 'Ver menos' : 'Ver más'}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`w-4 h-4 transition-transform duration-200 ${expanded[1000] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
      )}
      {marcas.length === 0 && (
        <p className="text-sm text-gray-500 italic">Aún no hay marcas definidas.</p>
      )}

      {categorias.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Categorías</p>
          </div>
          <div className="space-y-2">
            {(expanded[1001] ? categorias : categorias.slice(0,6)).map(lbl => (
              <Checkbox
                key={lbl}
                label={lbl}
                checked={(value['category'] || []).includes(lbl)}
                onChange={() => toggle('category', { id: 0, label: lbl, param: 'category', value: lbl, active: true } as any)}
              />
            ))}
          </div>
          {categorias.length > 6 && (
            <button className="mt-2 text-xs font-semibold text-[#517ea0] hover:text-[#416a8a] flex items-center gap-1 transition-colors" onClick={() => toggleExpand(1001)}>
              {expanded[1001] ? 'Ver menos' : 'Ver más'}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`w-4 h-4 transition-transform duration-200 ${expanded[1001] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
      )}

      {tipos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
            <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Tipo</p>
          </div>
          <div className="space-y-2">
            {(expanded[1002] ? tipos : tipos.slice(0,6)).map(lbl => (
              <Checkbox
                key={lbl}
                label={lbl}
                checked={(value['type'] || []).includes(lbl)}
                onChange={() => toggle('type', { id: 0, label: lbl, param: 'type', value: lbl, active: true } as any)}
              />
            ))}
          </div>
          {tipos.length > 6 && (
            <button className="mt-2 text-xs font-semibold text-[#517ea0] hover:text-[#416a8a] flex items-center gap-1 transition-colors" onClick={() => toggleExpand(1002)}>
              {expanded[1002] ? 'Ver menos' : 'Ver más'}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`w-4 h-4 transition-transform duration-200 ${expanded[1002] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Precio</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <input
              inputMode="numeric"
              placeholder="Min"
              value={minPrice}
              onChange={e => setMinPrice(e.target.value)}
              onBlur={applyPrice}
              className="w-full rounded-lg px-3 py-2 bg-white border border-neutral-300 text-sm focus:ring-2 focus:ring-[#517ea0] focus:border-[#517ea0] outline-none transition-all placeholder-neutral-400 shadow-sm text-neutral-900"
            />
          </div>
          <div className="relative">
            <input
              inputMode="numeric"
              placeholder="Máx"
              value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)}
              onBlur={applyPrice}
              className="w-full rounded-lg px-3 py-2 bg-white border border-neutral-300 text-sm focus:ring-2 focus:ring-[#517ea0] focus:border-[#517ea0] outline-none transition-all placeholder-neutral-400 shadow-sm text-neutral-900"
            />
          </div>
        </div>
      </div>
    </aside>
  )
}
