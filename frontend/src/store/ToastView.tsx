/* La capa ANIMADA de las alertas, en su propio pedazo de bundle.
 *
 *  Vive aparte porque es lo único de la raíz de la app que usaba framer-motion,
 *  y eso metía 123 KB en la PRIMERA carga de la tienda —para todos, incluido
 *  quien nunca ve una alerta—. Aquí llega cuando hace falta, y `toast.tsx` lo
 *  precarga en cuanto el navegador está libre, así que en la práctica ya está
 *  listo antes del primer aviso.
 *
 *  Las regiones `aria-live` NO están aquí: viven en el proveedor, montadas
 *  siempre. Una región live que aparece junto con su contenido no se anuncia, y
 *  eso no puede depender de que un chunk haya llegado.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { DURACION_ALERTA_MS } from '../lib/alertas'
import type { AlertaIcono, AlertaTipo, Toast } from './toast'

const CIRCULO: Record<AlertaTipo, string> = {
  ok: 'bg-emerald-500',
  err: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-violet-500',
  neutro: 'bg-neutral-400',
}

/* ENTRADA CON REBOTE — el aviso entra desde la derecha (de donde vive), se pasa
   de largo y regresa a su sitio: ATERRIZA, no se desliza. Un solo rebote firme;
   nada de gelatina, que esto lo ve un cajero cien veces al día.

   Los números son un resorte de verdad, no un gusto. Lo que manda es el
   amortiguamiento ζ = damping / (2·√(stiffness·mass)):
     ζ = 1     llega y se queda, sin rebote
     ζ ≈ 0.48  se pasa ~18% y vuelve   ← esto (22 / 2·√520)
     ζ < 0.35  oscila varias veces: se siente barato
   Con los 44 px de recorrido, ese 18% son ~8 px de sobrepaso: se ve. Medido en
   el navegador: se pasa 7.8 px a los ~170 ms y vuelve a su sitio a los ~310 ms,
   dentro de los 200-500 ms que admite una superficie ocasional (un modal, un
   toast). Si esto fuera un atajo de teclado que se usa mil veces al día, no
   llevaría animación ninguna.

   La ESCALA lleva su propio resorte más apretado (ζ ≈ 0.66, 6% de sobrepaso):
   cierra antes que el desplazamiento, así el rebote se lee como que la barra se
   MUEVE y no como que respira. La OPACIDAD nunca va en resorte —un fade que
   rebota parpadea—: tween corto y fuera.

   La salida no rebota y dura 220 ms, ~60% de la entrada: irse rápido se siente
   responsivo; irse con gracia se siente lento. */
const ENTRADA = {
  x: { type: 'spring' as const, stiffness: 520, damping: 22, mass: 1 },
  scale: { type: 'spring' as const, stiffness: 520, damping: 30, mass: 1 },
  opacity: { duration: 0.18, ease: 'easeOut' as const },
}

/* El SELLO: el círculo de color se estampa en su propio tiempo, 110 ms después,
   con más rebote (ζ ≈ 0.41 → medido, llega a escala 1.108) y menos recorrido
   para compensar. Su pico cae a los ~205 ms, justo cuando la barra va de regreso
   de su sobrepaso: se leen como dos golpes de un mismo aterrizaje, no como dos
   animaciones. Es el único adorno de todo esto y va donde importa —el color es
   lo que dice de qué se trata la alerta. */
const SELLO = { type: 'spring' as const, stiffness: 900, damping: 22, mass: 0.8, delay: 0.11 }

function Icono({ tipo, icono }: { tipo: AlertaTipo; icono?: AlertaIcono }) {
  const trazo = 'w-4 h-4 stroke-white fill-none'

  // Dibujos propios de un gesto: el color lo sigue poniendo el tipo.
  if (icono === 'corazon' || icono === 'corazon-vacio') {
    // Guardado = corazón lleno; quitado = corazón vacío. Así "quitar" no se
    // confunde con "agregar" (antes ambos usaban la palomita verde de éxito).
    return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white" strokeWidth="2" fill={icono === 'corazon' ? 'white' : 'none'} strokeLinecap="round" strokeLinejoin="round"><path d="M11.995 20.5s-7-4.5-7-10.5a4 4 0 017-2.5 4 4 0 017 2.5c0 6-7 10.5-7 10.5z" /></svg>
  }
  if (icono === 'campana') {
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2"><path d="M15 17h5l-1.3-1.3A2 2 0 0 1 18.1 14V11a6.1 6.1 0 1 0-12.2 0v3a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9.2 17v.8a2.8 2.8 0 0 0 5.6 0V17" /></svg>
  }
  if (icono === 'carrito') {
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.4 10.4a1.6 1.6 0 0 0 1.6 1.2h7.4a1.6 1.6 0 0 0 1.6-1.2L20 7H6" /><circle cx="9.5" cy="19.5" r="1.3" className="fill-white" /><circle cx="16.5" cy="19.5" r="1.3" className="fill-white" /></svg>
  }
  if (icono === 'marcador') {
    return <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white" strokeWidth="2" fill="white" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12v16l-6-4.2L6 20z" /></svg>
  }

  // Por tipo. Error y aviso llevan EXCLAMACIÓN (raya arriba, punto abajo);
  // info lleva la "i" (punto arriba, raya abajo). Antes los tres compartían el
  // mismo dibujo y solo cambiaba el color.
  if (tipo === 'err') {
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.5" className="fill-white" /></svg>
  }
  if (tipo === 'warning') {
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4" /><circle cx="12" cy="16.9" r="0.5" className="fill-white" /></svg>
  }
  if (tipo === 'info') {
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="7.5" r="0.5" className="fill-white" /><path d="M12 11.5v5.5" /></svg>
  }
  if (tipo === 'neutro') {
    // Bote de basura: confirma que se fue, sin celebrarlo.
    return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6.5 7l.8 11.3A1.8 1.8 0 0 0 9.1 20h5.8a1.8 1.8 0 0 0 1.8-1.7L17.5 7" /></svg>
  }
  // ok: palomita
  return <svg viewBox="0 0 24 24" className={trazo} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
}

export default function ToastItems({ toasts, quitar }: { toasts: Toast[]; quitar: (id: number) => void }) {
  const reduce = useReducedMotion()
  return (
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 44, scale: 0.94 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: 28, scale: 0.96, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={reduce ? { duration: 0.15 } : ENTRADA}
            /* El ancho se ACOTA aquí. Sin tope, un mensaje largo estiraba la
               barra hasta el otro lado de la pantalla en un solo renglón: se
               leía como un cintillo y no como un aviso. Es un TOPE, no un ancho:
               "Guardado" sigue siendo una barra corta —la mediana de los 215
               avisos son 29 caracteres— y solo el mensaje largo baja a dos o
               tres líneas.
               `items-start` alinea el sello con la PRIMERA línea; el `mt-1` del
               texto lo recentra cuando el mensaje cabe en una sola. */
            className="pointer-events-auto relative overflow-hidden flex items-start gap-3 max-w-[min(23rem,calc(100vw-1.5rem))] pl-3 pr-2.5 py-2.5 rounded-2xl border border-edge bg-alert text-ink shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          >
            <motion.span
              initial={reduce ? false : { scale: 0.55 }}
              animate={reduce ? {} : { scale: 1 }}
              transition={reduce ? { duration: 0 } : SELLO}
              className={`w-7 h-7 rounded-full grid place-items-center shrink-0 self-start ${CIRCULO[t.tipo]}`}
            >
              <Icono tipo={t.tipo} icono={t.icono} />
            </motion.span>
            <span className="min-w-0 mt-1 text-sm font-semibold leading-snug text-pretty break-words pr-1">{t.message}</span>
            <button onClick={() => quitar(t.id)} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface transition-colors shrink-0 self-start">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {/* Barra de vida: se vacía en lo que dura la alerta (global) */}
            <span className={`absolute left-0 bottom-0 h-[3px] rounded-full ${CIRCULO[t.tipo]}`} style={{ animation: `toast-avance ${DURACION_ALERTA_MS}ms linear forwards` }} />
          </motion.div>
        ))}
      </AnimatePresence>
  )
}
