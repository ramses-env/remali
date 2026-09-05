import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { conectarAvisos } from '../lib/avisos'
import { anotarFallo } from '../lib/fallo'
import { DURACION_ALERTA_MS } from '../lib/alertas'

/* La capa animada carga aparte: era lo único de la raíz que traía framer-motion
   (123 KB) a la primera carga de toda la tienda. Ver store/ToastView.tsx. */
const ToastItems = lazy(() => import('./ToastView'))

/* ALERTAS DE LA CASA — una sola implementación para el sitio y para el panel.
   Barra gris (bg-alert) con círculo de color según el TIPO y botón de cerrar.

   El tipo dice qué le pasó al usuario; nunca es decorativo:

     ok       verde    algo SUMÓ: se guardó, se creó, se cobró
     err      rojo     no se pudo
     warning  ámbar    sí pasó, pero ojo / falta algo
     info     morado   te estamos contando algo, ni bueno ni malo
     neutro   gris     algo se fue: borrado, quitado, cancelado

   El verde se gana sumando. "Producto eliminado" con palomita verde le dice al
   ojo "qué bueno" cuando lo que hubo fue una baja: eso va en `neutro`.

   El ÍCONO sale del tipo. El tercer argumento solo lo cambia cuando el gesto
   tiene un dibujo propio (corazón de favoritos, campana de notificación) sin
   alterar el color, que sigue mandando. */

export type AlertaTipo = 'ok' | 'err' | 'warning' | 'info' | 'neutro'
export type AlertaIcono = 'corazon' | 'corazon-vacio' | 'campana' | 'carrito' | 'marcador'
export type Notify = (mensaje: string, tipo?: AlertaTipo, icono?: AlertaIcono) => void

export type Toast = { id: number; message: string; tipo: AlertaTipo; icono?: AlertaIcono }
const ToastContext = createContext<{ notify: Notify } | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const notify: Notify = (message, tipo = 'ok', icono) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(t => {
      // El mismo mensaje repetido no se apila (una ráfaga de errores iguales
      // debe leerse UNA vez), y nunca más de 3 a la vez.
      if (t.some(x => x.message === message)) return t
      return [...t, { id, message, tipo, icono }].slice(-3)
    })
    // La duración vive en un solo lugar global (lib/alertas).
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), DURACION_ALERTA_MS)
  }
  // Los errores globales del interceptor (red, 500, permisos) también se
  // pintan aquí: el cliente ve los mismos avisos que el panel.
  useEffect(() => conectarAvisos(m => notify(m, 'err')), [])  // eslint-disable-line react-hooks/exhaustive-deps

  /* La capa animada se precarga en cuanto el navegador está libre —después de
     pintar, sin competir con nada—, así que para cuando salga la primera alerta
     ya está en caché y no se ve el respaldo. */
  useEffect(() => {
    const traer = () => { import('./ToastView').catch(anotarFallo) }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (ric) { ric(traer); return }
    const id = window.setTimeout(traer, 1200)
    return () => window.clearTimeout(id)
  }, [])

  const quitar = (id: number) => setToasts(t => t.filter(x => x.id !== id))

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {/* El aviso se va solo: quien usa lector de pantalla no tiene una segunda
          oportunidad de enterarse. La región `polite` anuncia lo normal; los
          errores se espejean en `alert` (assertive) para que interrumpan en vez
          de esperar turno. Ambas van montadas SIEMPRE —aquí, no en el pedazo
          que carga aparte—: una región live que aparece junto con su contenido
          no se anuncia, y eso no puede depender de que llegue un chunk. */}
      <div className="sr-only" role="alert" aria-live="assertive">
        {toasts.filter(t => t.tipo === 'err').slice(-1).map(t => <span key={t.id}>{t.message}</span>)}
      </div>
      <div
        className="fixed top-[76px] right-3 sm:right-5 z-[130] flex flex-col items-end gap-2.5 pointer-events-none max-w-[calc(100vw-1.5rem)]"
        role="status"
        aria-live="polite"
      >
        {toasts.length > 0 && (
          <Suspense fallback={<ToastsPlanos toasts={toasts} quitar={quitar} />}>
            <ToastItems toasts={toasts} quitar={quitar} />
          </Suspense>
        )}
      </div>
    </ToastContext.Provider>
  )
}

/* Respaldo sin animación, y no es un detalle: el primer aviso puede ser
   justamente "se cayó la red", y entonces el pedazo animado tampoco se puede
   bajar. Un mensaje de error que no se ve porque falló la red es el peor de los
   casos —es todo lo que este cambio trata de evitar—. Feo pero legible gana. */
function ToastsPlanos({ toasts, quitar }: { toasts: Toast[]; quitar: (id: number) => void }) {
  return (
    <>
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 max-w-[min(23rem,calc(100vw-1.5rem))] pl-3 pr-2.5 py-2.5 rounded-2xl border border-edge bg-alert text-ink shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <span className={`w-2.5 h-2.5 mt-[9px] rounded-full shrink-0 ${CIRCULO_PLANO[t.tipo]}`} />
          <span className="min-w-0 text-sm font-semibold leading-snug text-pretty break-words pr-1">{t.message}</span>
          <button onClick={() => quitar(t.id)} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink shrink-0 -mt-0.5">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      ))}
    </>
  )
}

/* Solo el color del punto: el círculo con ícono vive en la capa animada. */
const CIRCULO_PLANO: Record<AlertaTipo, string> = {
  ok: 'bg-emerald-500',
  err: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-violet-500',
  neutro: 'bg-zinc-400',
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('Toast context')
  return ctx
}
