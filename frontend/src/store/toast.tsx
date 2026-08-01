import { createContext, useContext, useEffect, useState } from 'react'
import { conectarAvisos } from '../lib/avisos'
import { AnimatePresence, motion } from 'framer-motion'

/* Alertas de la casa: barra gris (surface-2) con círculo de color según el
   tipo — verde éxito, rojo error, morado info, ámbar aviso, gris campana
   para notificaciones — y botón de cerrar. Mismo lenguaje que el panel. */
type ToastKind = 'cart' | 'heart' | 'bookmark' | 'x' | 'primary' | 'info' | 'warning'
type Toast = { id: number; message: string; kind: ToastKind }
const ToastContext = createContext<{ notify: (m: string, kind?: ToastKind) => void } | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  function notify(message: string, kind: ToastKind = 'cart') {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(t => {
      // El mismo mensaje repetido no se apila (una ráfaga de errores iguales
      // debe leerse UNA vez), y nunca más de 3 a la vez.
      if (t.some(x => x.message === message)) return t
      return [...t, { id, message, kind }].slice(-3)
    })
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600)
  }
  // Los errores globales del interceptor (red, 500, permisos) también se
  // pintan aquí: el cliente ve los mismos avisos que el panel.
  useEffect(() => conectarAvisos(m => notify(m, 'x')), [])  // eslint-disable-line react-hooks/exhaustive-deps

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

const CIRCULO: Record<ToastKind, string> = {
  cart: 'bg-emerald-500', heart: 'bg-emerald-500', bookmark: 'bg-emerald-500',
  x: 'bg-red-500', primary: 'bg-neutral-400', info: 'bg-violet-500', warning: 'bg-amber-500',
}

function Icono({ kind }: { kind: ToastKind }) {
  if (kind === 'x' || kind === 'info') {
    return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.5" className="fill-white" /></svg>
  }
  if (kind === 'warning') {
    return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.6" strokeLinecap="round"><path d="M8 12h8" /></svg>
  }
  if (kind === 'primary') {
    return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2"><path d="M15 17h5l-1.3-1.3A2 2 0 0 1 18.1 14V11a6.1 6.1 0 1 0-12.2 0v3a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9.2 17v.8a2.8 2.8 0 0 0 5.6 0V17" /></svg>
  }
  // cart / heart / bookmark: éxito
  return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
}

function ToastView({ toasts, quitar }: { toasts: Toast[]; quitar: (id: number) => void }) {
  return (
    <div className="fixed top-[76px] right-3 sm:right-5 z-[130] flex flex-col items-end gap-2.5 pointer-events-none max-w-[calc(100vw-1.5rem)]">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            className="pointer-events-auto relative overflow-hidden flex items-center gap-3 pl-3 pr-2.5 py-2.5 rounded-2xl border border-edge bg-surface-2 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <span className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${CIRCULO[t.kind]}`}>
              <Icono kind={t.kind} />
            </span>
            <span className="text-sm font-semibold pr-1">{t.message}</span>
            <button onClick={() => quitar(t.id)} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface transition-colors shrink-0">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {/* Barra de vida: se vacía en los 2.6 s que dura la alerta */}
            <span className={`absolute left-0 bottom-0 h-[3px] rounded-full ${CIRCULO[t.kind]}`} style={{ animation: 'toast-avance 2.6s linear forwards' }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
