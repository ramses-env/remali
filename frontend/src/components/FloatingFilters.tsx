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
        className="fixed left-0 top-0 h-full w-full sm:w-[360px] md:w-[380px] bg-neutral-50 z-50 shadow-xl flex flex-col transition-transform"
      >
        <div className="p-3 sm:p-4 border-b border-neutral-200 flex items-center justify-between">
          <p className="text-lg font-extrabold">Filtros ({selectedCount})</p>
          <button className="p-2 rounded border" onClick={() => setOpen(false)}>Cerrar</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FilterSidebar value={value} onChange={onChange} />
        </div>
      </div>
    </>
  )
}
