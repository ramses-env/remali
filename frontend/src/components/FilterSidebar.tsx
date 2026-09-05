import { useEffect, useMemo, useState } from 'react'
import { FRESCO_LARGO, useDatos } from '../lib/datos'

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
    <label className="flex items-center gap-3 group cursor-pointer select-none py-1.5">
      <div className={`relative flex items-center justify-center w-4 h-4 rounded border transition-all duration-200 ${checked ? 'bg-gold border-gold' : 'bg-transparent border-edge group-hover:border-gold/50'}`}>
        <input type="checkbox" className="peer appearance-none absolute inset-0 w-full h-full cursor-pointer z-10 opacity-0" checked={checked} onChange={onChange} />
        <svg className={`w-2.5 h-2.5 text-black fill-current transition-transform duration-150 ${checked ? 'scale-100' : 'scale-0'}`} viewBox="0 0 20 20">
          <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
        </svg>
      </div>
      <span className={`text-sm transition-colors leading-none ${checked ? 'text-gold-ink font-medium' : 'text-mute group-hover:text-mute'}`}>{label}</span>
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-5 border-b border-edge last:border-0">
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-mute mb-3">{title}</p>
      {children}
    </div>
  )
}

/** Nombres limpios y ordenados de un catálogo (marcas, categorías, tipos). */
function nombres(datos: { nombre?: string }[] | undefined): string[] {
  return (datos || [])
    .map(x => (x.nombre || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

export default function FilterSidebar({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  /* Marcas, categorías y tipos cambian una vez al mes, y hasta ahora se pedían
     en CADA montaje: el sidebar vive montado dos veces en el catálogo (fijo en
     escritorio, cajón en móvil) y el cajón se desmonta al cerrarse, así que
     abrirlo y cerrarlo tres veces eran nueve peticiones por tres datos que no
     se habían movido. La caché los sirve de memoria y los refresca cada diez
     minutos; las tres llamadas simultáneas del doble montaje se funden en una.
     Si el admin edita un catálogo, el bus invalida "catalogos" y se recargan. */
  const { datos: crudoMarcas } = useDatos<{ nombre?: string }[]>('/marcas/', { frescoMs: FRESCO_LARGO })
  const { datos: crudoCategorias } = useDatos<{ nombre?: string }[]>('/categorias/', { frescoMs: FRESCO_LARGO })
  const { datos: crudoTipos } = useDatos<{ nombre?: string }[]>('/tipos/', { frescoMs: FRESCO_LARGO })

  const marcas = useMemo(() => nombres(crudoMarcas), [crudoMarcas])
  const categorias = useMemo(() => nombres(crudoCategorias), [crudoCategorias])
  const tipos = useMemo(() => nombres(crudoTipos), [crudoTipos])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const condiciones = [
    { label: 'Nuevo', value: 'nueva' },
    { label: 'Seminuevo', value: 'seminueva' },
  ]


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
    if (min || max) next['price'] = [`${min}:${max}`]
    else delete next['price']
    onChange(next)
  }

  return (
    <div className="px-5">
      <Section title="Condición">
        {condiciones.map(opt => (
          <Checkbox
            key={opt.value}
            label={opt.label}
            checked={(value['condition'] || []).includes(opt.value)}
            onChange={() => toggle('condition', { id: 0, label: opt.label, param: 'condition', value: opt.value, active: true } as any)}
          />
        ))}
      </Section>

      {marcas.length > 0 && (
        <Section title="Marcas">
          {(expanded[1000] ? marcas : marcas.slice(0, 6)).map(lbl => (
            <Checkbox
              key={lbl}
              label={lbl}
              checked={(value['brand'] || []).includes(lbl)}
              onChange={() => toggle('brand', { id: 0, label: lbl, param: 'brand', value: lbl, active: true } as any)}
            />
          ))}
          {marcas.length > 6 && (
            <button
              className="mt-2 text-xs text-gold-ink/70 hover:text-gold-ink flex items-center gap-1 font-medium transition-colors"
              onClick={() => setExpanded(p => ({ ...p, 1000: !p[1000] }))}
            >
              {expanded[1000] ? 'Ver menos ↑' : `Ver más (${marcas.length - 6}) ↓`}
            </button>
          )}
        </Section>
      )}

      {categorias.length > 0 && (
        <Section title="Categorías">
          {(expanded[1001] ? categorias : categorias.slice(0, 6)).map(lbl => (
            <Checkbox
              key={lbl}
              label={lbl}
              checked={(value['category'] || []).includes(lbl)}
              onChange={() => toggle('category', { id: 0, label: lbl, param: 'category', value: lbl, active: true } as any)}
            />
          ))}
          {categorias.length > 6 && (
            <button
              className="mt-2 text-xs text-gold-ink/70 hover:text-gold-ink flex items-center gap-1 font-medium transition-colors"
              onClick={() => setExpanded(p => ({ ...p, 1001: !p[1001] }))}
            >
              {expanded[1001] ? 'Ver menos ↑' : `Ver más (${categorias.length - 6}) ↓`}
            </button>
          )}
        </Section>
      )}

      {tipos.length > 0 && (
        <Section title="Tipo">
          {(expanded[1002] ? tipos : tipos.slice(0, 6)).map(lbl => (
            <Checkbox
              key={lbl}
              label={lbl}
              checked={(value['type'] || []).includes(lbl)}
              onChange={() => toggle('type', { id: 0, label: lbl, param: 'type', value: lbl, active: true } as any)}
            />
          ))}
          {tipos.length > 6 && (
            <button
              className="mt-2 text-xs text-gold-ink/70 hover:text-gold-ink flex items-center gap-1 font-medium transition-colors"
              onClick={() => setExpanded(p => ({ ...p, 1002: !p[1002] }))}
            >
              {expanded[1002] ? 'Ver menos ↑' : `Ver más (${tipos.length - 6}) ↓`}
            </button>
          )}
        </Section>
      )}

      <Section title="Precio">
        <div className="grid grid-cols-2 gap-2 mt-1">
          <input
            inputMode="numeric"
            placeholder="Mín"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            onBlur={applyPrice}
            className="campo campo-sm"
          />
          <input
            inputMode="numeric"
            placeholder="Máx"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            onBlur={applyPrice}
            className="campo campo-sm"
          />
        </div>
        <button
          onClick={applyPrice}
          className="mt-2 w-full py-2 rounded-lg bg-gold-soft border border-gold/30 text-gold-ink text-xs font-semibold hover:bg-gold/20 transition-colors"
        >
          Aplicar
        </button>
      </Section>
    </div>
  )
}
