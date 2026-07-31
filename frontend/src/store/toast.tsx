import { createContext, useContext, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type ToastKind = 'cart' | 'heart' | 'bookmark' | 'x'
type Toast = { id: number; message: string; kind: ToastKind }
const ToastContext = createContext<{ notify: (m: string, kind?: ToastKind) => void } | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  function notify(message: string, kind: ToastKind = 'cart') {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(t => [...t, { id, message, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600)
  }
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <ToastView toasts={toasts} quitar={id => setToasts(t => t.filter(x => x.id !== id))} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('Toast context')
  return ctx
}

/* Alerta lateral (derecha, bajo el navbar): pill con círculo de color según
   el tipo — verde éxito, rojo error, dorado aviso — y botón de cerrar. */
function ToastView({ toasts, quitar }: { toasts: Toast[]; quitar: (id: number) => void }) {
  return (
    <div className="fixed top-[76px] right-3 sm:right-5 z-[130] flex flex-col items-end gap-2.5 pointer-events-none max-w-[calc(100vw-1.5rem)]">
      <AnimatePresence>
        {toasts.map(t => {
          const esError = t.kind === 'x'
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              className="pointer-events-auto flex items-center gap-3 pl-3 pr-2.5 py-2.5 rounded-2xl border border-edge bg-surface text-ink shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            >
              <span className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${esError ? 'bg-red-500' : 'bg-emerald-500'}`}>
                {esError ? (
                  <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.5" className="fill-white" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                )}
              </span>
              <span className="text-sm font-semibold pr-1">{t.message}</span>
              <button onClick={() => quitar(t.id)} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
