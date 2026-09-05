import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/* Lenguaje de movimiento de las pantallas de RESULTADO: vincular una renta a tu
   cuenta, autorizar o rechazar una cotización. Son pantallas que alguien ve una
   sola vez en su vida, justo después de decidir algo: se ganaron el momento.

   La idea: EL VEREDICTO SE DIBUJA. No aparece ya hecho — se traza enfrente de
   quien acaba de decidir, como cuando alguien firma.

   Y no todos los veredictos se celebran igual. El sí lleva un anillo que pulsa
   una vez y un rebote mínimo. El no entra derecho: sin anillo, sin rebote, y
   sus dos trazos se cruzan uno tras otro. Queda REGISTRADO, no festejado. Esa
   diferencia es el diseño, no un detalle. */

const ENTRADA = [0.23, 1, 0.32, 1] as const  // ease-out del sistema (DESIGN.md)
const SALIDA = [0.4, 0, 1, 1] as const       // salir siempre es más corto que entrar

export type Veredicto = 'exito' | 'cambios' | 'rechazo' | 'alerta' | 'neutro'

type Trazo = { d: string; en: number; dura: number }
type Marca = {
  piel: string
  anillo?: boolean   // el pulso de "quedó hecho": solo lo gana el sí
  rebote?: boolean   // entrada con sobretiro: solo el sí
  punto?: boolean    // el punto del signo de admiración
  sacude?: boolean   // el "no" sutil del aviso
  trazos: Trazo[]
}

const MARCAS: Record<Veredicto, Marca> = {
  exito: {
    piel: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    anillo: true,
    rebote: true,
    trazos: [{ d: 'M5 13l4 4L19 7', en: 0.3, dura: 0.36 }],
  },
  // Primero el lápiz, y hasta el final el renglón: se dibuja la corrección que
  // el cliente acaba de pedir. Dorado, porque esto no terminó — regresa.
  cambios: {
    piel: 'bg-gold-soft text-gold-ink',
    trazos: [
      { d: 'M16.4 3.6a2.12 2.12 0 0 1 3 3L8.4 17.6 4 19l1.4-4.4z', en: 0.16, dura: 0.44 },
      { d: 'M12.6 20.4h7.8', en: 0.62, dura: 0.24 },
    ],
  },
  // Sin anillo y sin rebote. Un trazo, luego el otro.
  rechazo: {
    piel: 'bg-red-500/10 text-red-500',
    trazos: [
      { d: 'M6.5 6.5l11 11', en: 0.16, dura: 0.2 },
      { d: 'M17.5 6.5l-11 11', en: 0.32, dura: 0.2 },
    ],
  },
  alerta: {
    piel: 'bg-red-500/10 text-red-500',
    trazos: [{ d: 'M12 7v6', en: 0.18, dura: 0.22 }],
    punto: true,
    sacude: true,
  },
  // Nadie decidió nada ahora: se informa, no se dictamina.
  neutro: {
    piel: 'bg-surface-2 text-mute',
    trazos: [{ d: 'M5 13l4 4L19 7', en: 0.2, dura: 0.34 }],
  },
}

/** La insignia de una pantalla de resultado, con su trazo dibujándose. */
export function MarcaVeredicto({ tipo, className = '' }: { tipo: Veredicto; className?: string }) {
  const quieto = !!useReducedMotion()
  const m = MARCAS[tipo]
  // Con movimiento reducido la marca YA está trazada: el veredicto se lee igual,
  // solo que sin el gesto. Reducir no es esconder.
  const traza = (dura: number, en: number) =>
    quieto ? { duration: 0 } : { duration: dura, delay: en, ease: ENTRADA }
  return (
    <div className={`relative w-[76px] h-[76px] mx-auto grid place-items-center ${className}`}>
      {m.anillo && (
        <span aria-hidden="true" className="exito-ring absolute inset-0 rounded-full border-2 border-emerald-500/60" />
      )}
      <div className={`${m.rebote ? 'exito-pop' : 'vc-pop'} ${m.piel} w-[76px] h-[76px] rounded-full grid place-items-center`}>
        <svg className={`w-9 h-9 ${m.sacude ? 'err-shake' : ''}`} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {m.trazos.map(t => (
            <motion.path key={t.d} d={t.d}
              initial={{ pathLength: quieto ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={traza(t.dura, t.en)} />
          ))}
          {m.punto && (
            <motion.circle cx="12" cy="17" r="1.05" fill="currentColor" stroke="none"
              style={{ transformOrigin: '12px 17px' }}
              initial={{ opacity: quieto ? 1 : 0, scale: quieto ? 1 : 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={traza(0.2, 0.44)} />
          )}
        </svg>
      </div>
    </div>
  )
}

/** La tarjeta de una pantalla de resultado: UN objeto que cambia de contenido,
 *  no dos pantallas que se reemplazan.
 *
 *  Antes, al confirmar, esto cortaba en seco: la caja saltaba de alto y lo que
 *  estabas leyendo desaparecía sin despedirse. Aquí lo viejo se va rápido, la
 *  caja viaja a su nuevo alto, y lo nuevo sube. El alto se mide de verdad (no
 *  se adivina), así que sirve con cualquier contenido.
 *
 *  `paso` identifica el estado: cuando cambia, se hace el relevo. */
export function TarjetaViva({ paso, className = '', interior = 'p-8', children }: {
  paso: string
  className?: string
  interior?: string
  children: ReactNode
}) {
  const reducir = !!useReducedMotion()
  const caja = useRef<HTMLDivElement>(null)
  const cuerpo = useRef<HTMLDivElement>(null)
  const ultimo = useRef<number | null>(null)
  // 'auto' es el estado por defecto y el de respaldo: si el navegador no trae
  // ResizeObserver o el script falla, la tarjeta simplemente no se anima —
  // nunca se queda en cero ni esconde el contenido.
  const [alto, setAlto] = useState<number | 'auto'>('auto')
  const [animando, setAnimando] = useState(false)

  useLayoutEffect(() => {
    const el = cuerpo.current
    if (!el || reducir || typeof ResizeObserver === 'undefined') return
    const medir = () => {
      /* El borde cuenta. Con box-sizing:border-box —el de todo el proyecto— un
         `height` fijo INCLUYE el borde de 1px de la tarjeta, así que plantarle
         el alto del contenido a secas le comía 2px al final. */
      const marco = caja.current ? caja.current.offsetHeight - caja.current.clientHeight : 0
      const n = el.offsetHeight + marco
      if (n === ultimo.current) return
      // La primera medición NO es un cambio: es el alto con el que ya nació.
      if (ultimo.current !== null) setAnimando(true)
      ultimo.current = n
      setAlto(n)
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [reducir])

  return (
    <motion.div
      ref={caja}
      className={className}
      initial={false}
      animate={{ height: reducir ? 'auto' : alto }}
      transition={{ duration: 0.34, ease: ENTRADA }}
      onAnimationComplete={() => setAnimando(false)}
      /* Recortar SOLO mientras viaja: así lo nuevo se descubre conforme la caja
         crece, y en reposo nada queda cortado (el anillo del sí se sale de la
         caja a propósito, y el foco del teclado también). */
      style={{ overflow: animando ? 'hidden' : undefined }}
    >
      <div ref={cuerpo} className={interior}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={paso}
            initial={{ opacity: 0, y: reducir ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducir ? 0 : -6, transition: { duration: 0.14, ease: SALIDA } }}
            transition={{ duration: 0.32, ease: ENTRADA }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
