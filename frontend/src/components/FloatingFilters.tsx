import { useEffect, useMemo, useState } from 'react'
import FilterSidebar from './FilterSidebar'

type Props = {
  value: Record<string, string[]>
  onChange: (next: Record<string, string[]>) => void
}

export default function FloatingFilters({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(o => !o)
    const close = () => setOpen(false)
    window.addEventListener('toggleFilters', handler as any)
    window.addEventListener('closeFilters', close as any)
    return () => {
      window.removeEventListener('toggleFilters', handler as any)
      window.removeEventListener('closeFilters', close as any)
    }
  }, [])

  const selectedCount = useMemo(() => Object.values(value).reduce((s, v) => s + (v?.length || 0), 0), [value])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={() => setOpen(false)}
      />
      <div
        data-onboarding="filtros-flotantes"
        className="fixed left-0 top-0 h-full w-full sm:w-[360px] md:w-[380px] bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ease-out"
      >
        <div className="px-6 py-5 border-b border-neutral-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <p className="text-xl font-bold text-neutral-900 tracking-tight">Filtros ({selectedCount})</p>
          <button 
            className="p-2 -mr-2 rounded-full text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-all" 
            onClick={() => setOpen(false)}
            aria-label="Cerrar filtros"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-200 scrollbar-track-transparent p-2">
          <FilterSidebar value={value} onChange={onChange} />
        </div>
        <div className="p-4 border-t border-neutral-100 bg-white">
          <button 
            className="w-full py-3 bg-[#5488af] text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-900/10 active:scale-[0.98] transition-all hover:bg-[#467599]"
            onClick={() => setOpen(false)}
          >
            Ver resultados
          </button>
        </div>
      </div>
    </>
  )
}
