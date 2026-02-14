import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed left-0 top-0 h-full w-full sm:w-[360px] md:w-[380px] bg-neutral-50 z-50 shadow-xl flex flex-col"
              initial={{ x: -380 }}
              animate={{ x: 0 }}
              exit={{ x: -380 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="p-3 sm:p-4 border-b border-neutral-200 flex items-center justify-between">
                <p className="text-lg font-extrabold">Filtros ({selectedCount})</p>
                <button className="p-2 rounded border" onClick={() => setOpen(false)}>Cerrar</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <FilterSidebar value={value} onChange={onChange} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
