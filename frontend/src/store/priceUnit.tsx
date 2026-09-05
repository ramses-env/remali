import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type PriceUnit = 'dia' | 'semana' | 'mes'

type PriceUnitState = {
  unit: PriceUnit
  setUnit: (u: PriceUnit) => void
}

const PriceUnitCtx = createContext<PriceUnitState | null>(null)

export function PriceUnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<PriceUnit>(() => {
    const saved = localStorage.getItem('price_unit')
    if (saved === 'semana' || saved === 'mes') return saved
    return 'dia'
  })
  useEffect(() => {
    try {
      localStorage.setItem('price_unit', unit)
    } catch {
      // Este SÍ se traga a propósito y no hace falta rastro: en modo privado o
      // con la cuota llena, guardar falla y lo único que se pierde es recordar
      // en qué unidad venía viendo los precios. No hay nada que reportar.
    }
  }, [unit])
  const value = useMemo(() => ({ unit, setUnit }), [unit])
  return <PriceUnitCtx.Provider value={value}>{children}</PriceUnitCtx.Provider>
}

export function usePriceUnit() {
  const ctx = useContext(PriceUnitCtx)
  if (!ctx) throw new Error('usePriceUnit debe usarse dentro de PriceUnitProvider')
  return ctx
}

export function formatCurrency(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

