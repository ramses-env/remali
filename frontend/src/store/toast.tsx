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
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200)
  }
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <ToastView toasts={toasts} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('Toast context')
  return ctx
}

function ToastView({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="px-4 py-2 rounded-full shadow bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white text-sm flex items-center gap-2"
          >
            {t.kind === 'cart' && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.25 3h1.386c.51 0 .955.343 1.088.834l.383 1.437M7.5 14.25h9.563a1.875 1.875 0 001.822-1.416l1.32-5.274A.938.938 0 0019.31 6.75H5.107" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7.5 21a.75.75 0 100-1.5.75.75 0 000 1.5zm9 0a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
            )}
            {t.kind === 'heart' && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-white"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z"></path></svg>
            )}
            {t.kind === 'bookmark' && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-white"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 3h12a1 1 0 011 1v16l-7-4-7 4V4a1 1 0 011-1z"></path></svg>
            )}
            {t.kind === 'x' && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none"><circle cx="12" cy="12" r="9" strokeWidth="1.5"></circle><path d="M8 8L16 16" strokeWidth="1.5" strokeLinecap="round"></path><path d="M16 8L8 16" strokeWidth="1.5" strokeLinecap="round"></path></svg>
            )}
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
