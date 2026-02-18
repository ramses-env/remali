import { usePriceUnit } from '../store/priceUnit'

export default function PriceUnitToggle() {
  const { unit, setUnit } = usePriceUnit()
  
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-sm w-full sm:w-auto">
      <span className="text-gray-700 mb-1 sm:mb-0 font-medium ml-1">Precio por</span>
      
      <div className="glass-radio-group w-full sm:w-auto justify-between sm:justify-start" role="radiogroup" aria-label="Selecciona unidad de precio">
        
        <input 
            type="radio" 
            name="plan" 
            id="plan-dia" 
            checked={unit === ('dia' as any)} 
            onChange={() => setUnit('dia' as any)} 
        />
        <label htmlFor="plan-dia">Día</label>

        <input 
            type="radio" 
            name="plan" 
            id="plan-semana" 
            checked={unit === ('semana' as any)} 
            onChange={() => setUnit('semana' as any)} 
        />
        <label htmlFor="plan-semana">Semana</label>

        <input 
            type="radio" 
            name="plan" 
            id="plan-mes" 
            checked={unit === ('mes' as any)} 
            onChange={() => setUnit('mes' as any)} 
        />
        <label htmlFor="plan-mes">Mes</label>

        <div className="glass-glider"></div>
      </div>
    </div>
  )
}
