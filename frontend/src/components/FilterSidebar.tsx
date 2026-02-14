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
    <aside className="p-3 sm:p-4 space-y-6">
      <div>
        <p className="text-base font-extrabold">Condición</p>
        <div className="mt-2 space-y-2">
          {condiciones.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="input"
                checked={(value['condition'] || []).includes(opt.value)}
                onChange={() =>
                  toggle('condition', { id: 0, label: opt.label, param: 'condition', value: opt.value, active: true } as any)
                }
              />
              <span className="custom-checkbox" />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
      {marcas.length > 0 && (
        <div>
          <p className="text-base font-extrabold">Marcas</p>
          <div className="mt-2 space-y-2">
            {(expanded[1000] ? marcas : marcas.slice(0,6))
              .map(lbl => (
              <label key={lbl} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="input"
                  checked={(value['brand'] || []).includes(lbl)}
                  onChange={() => toggle('brand', { id: 0, label: lbl, param: 'brand', value: lbl, active: true } as any)}
                />
                <span className="custom-checkbox" />
                <span>{lbl}</span>
              </label>
            ))}
          </div>
          {marcas.length > 6 && (
            <button className="mt-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1" onClick={() => toggleExpand(1000)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
              {expanded[1000] ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </div>
      )}
      {marcas.length === 0 && (
        <p className="text-sm text-gray-600">Aún no hay marcas definidas.</p>
      )}

      {categorias.length > 0 && (
        <div>
          <p className="text-base font-extrabold">Categorías</p>
          <div className="mt-2 space-y-2">
            {(expanded[1001] ? categorias : categorias.slice(0,6)).map(lbl => (
              <label key={lbl} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="input"
                  checked={(value['category'] || []).includes(lbl)}
                  onChange={() => toggle('category', { id: 0, label: lbl, param: 'category', value: lbl, active: true } as any)}
                />
                <span className="custom-checkbox" />
                <span>{lbl}</span>
              </label>
            ))}
          </div>
          {categorias.length > 6 && (
            <button className="mt-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1" onClick={() => toggleExpand(1001)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
              {expanded[1001] ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </div>
      )}

      {tipos.length > 0 && (
        <div>
          <p className="text-base font-extrabold">Tipo</p>
          <div className="mt-2 space-y-2">
            {(expanded[1002] ? tipos : tipos.slice(0,6)).map(lbl => (
              <label key={lbl} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="input"
                  checked={(value['type'] || []).includes(lbl)}
                  onChange={() => toggle('type', { id: 0, label: lbl, param: 'type', value: lbl, active: true } as any)}
                />
                <span className="custom-checkbox" />
                <span>{lbl}</span>
              </label>
            ))}
          </div>
          {tipos.length > 6 && (
            <button className="mt-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1" onClick={() => toggleExpand(1002)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
              {expanded[1002] ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </div>
      )}

      <div>
        <p className="text-base font-extrabold">Precio</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            inputMode="numeric"
            placeholder="Min"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            onBlur={applyPrice}
            className="w-full rounded-lg px-3 h-9 bg-gray-100 shadow-md border-0 focus:ring-2 focus:ring-[#517ea0]"
          />
          <input
            inputMode="numeric"
            placeholder="Máx"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            onBlur={applyPrice}
            className="w-full rounded-lg px-3 h-9 bg-gray-100 shadow-md border-0 focus:ring-2 focus:ring-[#517ea0]"
          />
        </div>
      </div>
    </aside>
  )
}
