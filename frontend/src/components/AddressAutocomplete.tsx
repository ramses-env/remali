/**
 * AddressAutocomplete — autocompletado de direcciones estilo Google Maps.
 *
 * Flujo de DOS pasos (todo a través de nuestro backend, `src/lib/geocoding.ts`):
 *   1. Mientras tecleas → `/address/autocomplete/` devuelve varias predicciones
 *      en vivo, sesgadas a la zona de operación.
 *   2. Al elegir una → `/address/details/` resuelve su dirección completa
 *      (calle, colonia, CP, coordenadas) y se entrega por `onSelect`.
 * Un `sessionToken` agrupa ambas llamadas en una sesión de facturación de Google
 * (más barato); se renueva tras cada selección.
 *
 * Props:
 *   value    — texto actual del campo (controlado por el padre)
 *   onChange — el usuario escribe (dispara autocomplete con debounce)
 *   onSelect — el usuario elige una sugerencia → recibe el AddressResult completo
 *
 * UX: debounce · cancelación de peticiones · navegación con ↑ ↓ Enter · Esc para
 * cerrar · clic fuera para cerrar · indicador de carga (tecleo y resolución) ·
 * "No se encontraron resultados".
 */
import { useEffect, useRef, useState } from 'react'
import {
  autocompleteAddresses, getAddressDetails, nuevaSesionDireccion,
  type AddressPrediction, type AddressResult,
} from '../lib/geocoding'

type Props = {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: AddressResult) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  minChars?: number
  debounceMs?: number
  autoFocus?: boolean
}

const DEFAULT_INPUT = 'campo pl-11 pr-11'

export default function AddressAutocomplete({
  value, onChange, onSelect,
  placeholder = 'Buscar dirección…',
  className = '', inputClassName,
  minChars = 3, debounceMs = 300, autoFocus,
}: Props) {
  const [results, setResults] = useState<AddressPrediction[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)     // buscando predicciones
  const [selecting, setSelecting] = useState(false) // resolviendo la elegida (details)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef(false) // no re-buscar justo después de seleccionar
  const sesionRef = useRef(nuevaSesionDireccion())

  // Debounce + autocomplete con cancelación de la petición anterior
  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return }
    const q = value.trim()
    if (q.length < minChars) { setResults([]); setSearched(false); setError(false); setLoading(false); return }

    const ctrl = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      autocompleteAddresses(q, sesionRef.current, ctrl.signal)
        .then(r => { setResults(r); setSearched(true); setError(false); setActive(-1); setOpen(true) })
        .catch(err => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return
          setError(true); setResults([]); setSearched(true); setOpen(true)
        })
        .finally(() => setLoading(false))
    }, debounceMs)

    return () => { clearTimeout(t); ctrl.abort() }
  }, [value, minChars, debounceMs])

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function choose(p: AddressPrediction) {
    skipRef.current = true
    setActive(-1)
    try {
      // Los proveedores sin autocomplete nativo ya traen la dirección embebida.
      let addr: AddressResult
      if (p.detalle) {
        addr = p.detalle
      } else {
        setSelecting(true)
        addr = await getAddressDetails(p.place_id, sesionRef.current)
      }
      onSelect(addr)
      setOpen(false); setResults([])
      sesionRef.current = nuevaSesionDireccion() // la sesión de facturación terminó
    } catch {
      setError(true); setOpen(true) // no se pudo resolver: deja el aviso en el desplegable
    } finally {
      setSelecting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { if (results.length) setOpen(true); return }
      setActive(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && results[active]) { e.preventDefault(); choose(results[active]) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && value.trim().length >= minChars

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        {/* Icono buscar */}
        <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (results.length) setOpen(true) }}
          placeholder={placeholder}
          className={inputClassName || DEFAULT_INPUT}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {/* Indicador de carga: tecleo (autocomplete) o resolución (details) */}
        {(loading || selecting) && <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-mute/30 border-t-gold rounded-full animate-spin" />}
      </div>

      {showDropdown && (
        <div className="absolute z-[90] mt-1.5 w-full bg-surface border border-edge rounded-xl shadow-[0_16px_40px_rgba(33,29,22,0.16)] overflow-hidden max-h-72 overflow-y-auto">
          {loading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-mute">Buscando direcciones…</p>
          )}
          {!loading && error && (
            <p className="px-4 py-3 text-sm text-red-500">No se pudo consultar el servicio. Intenta de nuevo.</p>
          )}
          {!loading && !error && searched && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-mute">No se encontraron resultados.</p>
          )}
          {results.map((p, i) => (
            <button
              type="button"
              key={`${p.place_id || 'x'}-${i}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              disabled={selecting}
              className={`w-full text-left px-4 py-2.5 border-b border-edge last:border-0 transition-colors disabled:opacity-60 ${active === i ? 'bg-gold-soft' : 'hover:bg-surface-2'}`}
            >
              <p className="text-sm font-medium text-ink truncate">{p.main_text || p.description}</p>
              {p.secondary_text && <p className="text-[12px] text-mute truncate">{p.secondary_text}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
