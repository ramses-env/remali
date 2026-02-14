import { useRef } from 'react'
import { usePriceUnit } from '../store/priceUnit'

export default function PriceUnitToggle() {
  const { unit, setUnit } = usePriceUnit()
  const wrapRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-sm">
      <span className="text-gray-700">Precio por</span>
      <div ref={wrapRef} className="radio-inputs" role="radiogroup" aria-label="Selecciona unidad de precio">
        <label className="radio">
          <input type="radio" name="price-unit" checked={unit === ('dia' as any)} onChange={() => setUnit('dia' as any)} />
          <span className="name">Día</span>
        </label>
        <label className="radio">
          <input type="radio" name="price-unit" checked={unit === ('semana' as any)} onChange={() => setUnit('semana' as any)} />
          <span className="name">Semana</span>
        </label>
        <label className="radio">
          <input type="radio" name="price-unit" checked={unit === ('mes' as any)} onChange={() => setUnit('mes' as any)} />
          <span className="name">Mes</span>
        </label>
      </div>
    </div>
  )
}
