import { Joyride } from 'react-joyride'
import type { Step, TooltipRenderProps } from 'react-joyride'
import { useLocation } from 'react-router-dom'
import { useMemo, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useOnboarding } from '../../store/onboarding'

export interface TourPaso extends Step {
  id: string
  /** Limita el paso a un tamaño de pantalla: el dock solo existe en móvil, y
   *  algunos elementos del header solo en escritorio. */
  soloEn?: 'movil' | 'escritorio'
  /** Muestra el cupón de bienvenida (5% de único uso) dentro del globo. El tono
   *  cambia el texto: 'gancho' invita a completar el perfil; 'listo' cierra. */
  cupon?: 'gancho' | 'listo'
}

export interface TourDefinition {
  id: string
  ruta_activadora: RegExp | string
  pasos: TourPaso[]
  soloPrimeraVez?: boolean
  orden?: number
}

interface Props {
  tours: TourDefinition[]
}

/* ─────────────────────────────────────────────────────────────
   Cupón de bienvenida: la pieza-firma del onboarding. Un talón
   troquelado (como los folios de renta de REMALI) que hace tangible
   el 5% y deja claro, sin letras chicas, que es de UN SOLO USO.
   ───────────────────────────────────────────────────────────── */
function CuponBienvenida({ tono }: { tono: 'gancho' | 'listo' }) {
  return (
    <div className="relative mt-3.5 flex items-stretch overflow-hidden rounded-xl bg-gradient-to-br from-gold to-[#EBA91B] text-black shadow-[0_12px_28px_rgba(255,198,26,0.28)]">
      {/* Talón: el 5% */}
      <div className="flex flex-col items-center justify-center px-4 py-3 leading-none">
        <span className="text-[27px] font-black tracking-tight">5<span className="align-top text-[15px]">%</span></span>
        <span className="mt-1 text-[8px] font-black uppercase tracking-[0.16em] text-black/60">único uso</span>
      </div>
      {/* Troquel: dos muescas + línea punteada, como un ticket que se desprende */}
      <div className="relative mx-0.5 flex items-center">
        <span aria-hidden className="absolute left-1/2 -top-1.5 h-3 w-3 -translate-x-1/2 rounded-full bg-surface" />
        <span aria-hidden className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rounded-full bg-surface" />
        <span aria-hidden className="h-full border-l-2 border-dashed border-black/30" />
      </div>
      {/* Detalle */}
      <div className="flex-1 px-3.5 py-3">
        <div className="text-[12.5px] font-black leading-tight">Descuento de bienvenida</div>
        <div className="mt-0.5 text-[11px] font-semibold leading-snug text-black/70">
          {tono === 'listo'
            ? 'Complétalo en tu perfil y actívalo. Se aplica una sola vez.'
            : 'Se activa al completar tu perfil. Válido una sola vez.'}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Tooltip propio de REMALI: usa los tokens del tema (se ve bien en
   claro y oscuro), entra con un pop suave, cambia de paso con un
   desliz corto, muestra el avance con dots y respeta reduced-motion.
   ───────────────────────────────────────────────────────────── */
function TourTooltip({
  index, size, step, backProps, closeProps, primaryProps, skipProps, tooltipProps, isLastStep,
}: TooltipRenderProps) {
  const reduce = useReducedMotion()
  return (
    <div {...tooltipProps} className="w-[min(92vw,360px)] outline-none">
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.26, ease: [0.23, 1, 0.32, 1] }}
        className="relative overflow-hidden rounded-2xl border border-edge bg-surface text-ink shadow-[0_28px_80px_rgba(0,0,0,0.32)]"
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-gold/60 via-gold to-gold/60" />

        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-gold">
              <span className="w-1.5 h-1.5 rounded-full bg-gold" />
              Paso {index + 1} de {size}
            </span>
            <button
              {...closeProps}
              aria-label="Cerrar guía"
              className="-mr-1.5 -mt-1.5 w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface-2 transition-[color,background-color,transform] active:scale-90"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={reduce ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -14 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              {step.title && <h3 className="text-[17px] font-black tracking-tight leading-snug mt-2.5">{step.title}</h3>}
              <div className="text-[13.5px] text-mute leading-relaxed mt-1.5">{step.content}</div>
              {(step as TourPaso).cupon && <CuponBienvenida tono={(step as TourPaso).cupon!} />}
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between gap-3 mt-5">
            <div className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: size }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? 'w-5 bg-gold' : i < index ? 'w-1.5 bg-gold/50' : 'w-1.5 bg-edge'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  {...backProps}
                  className="px-3.5 py-2 rounded-full text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-[color,background-color,transform] active:scale-95"
                >
                  Atrás
                </button>
              )}
              <button
                {...primaryProps}
                className="px-5 py-2 rounded-full text-[13px] font-black bg-gold text-black hover:opacity-90 transition-[opacity,transform] active:scale-[0.97]"
              >
                {isLastStep ? 'Finalizar' : 'Siguiente'}
              </button>
            </div>
          </div>

          {!isLastStep && (
            <button
              {...skipProps}
              className="mt-3.5 w-full text-center text-[12px] font-semibold text-mute hover:text-ink transition-colors"
            >
              Saltar guía
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default function OnboardingTour({ tours }: Props) {
  const loc = useLocation()
  const { estado, marcarPaso, marcarCompletado, tourActivo, activarTour } = useOnboarding()

  const tourActivoDef = useMemo(() => {
    if (tourActivo) return tours.find(t => t.id === tourActivo) || null
    return null
  }, [tourActivo, tours])

  // Candidata a AUTO-arranque: solo si el onboarding NO está completado (las
  // cuentas viejas quedaron marcadas por la migración 0039, así que en la
  // práctica es "solo usuarios nuevos").
  const autoTour = useMemo(() => {
    if (!estado || estado.completado) return null
    for (const t of tours) {
      const coincide = typeof t.ruta_activadora === 'string'
        ? loc.pathname === t.ruta_activadora
        : t.ruta_activadora.test(loc.pathname)
      if (!coincide) continue
      if (t.soloPrimeraVez && estado.pasos_completados.includes(t.id)) continue
      return t
    }
    return null
  }, [estado, tours, loc.pathname])

  const [esMovil, setEsMovil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setEsMovil(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // UNA guía, UNA sola vez. En cuanto una guía automática va a arrancar se marca
  // el onboarding como VISTO (backend + local) y se "fija" la guía en curso. Así
  // ya no reaparece —ni al refrescar ni al navegar, la termine el usuario o no—,
  // pero la guía actual sí corre completa porque queda fijada aparte del gate
  // (marcar visto ya no la corta). Las manuales (activarTour) no se re-marcan.
  const candidato = tourActivoDef || autoTour
  const [corriendo, setCorriendo] = useState<TourDefinition | null>(null)
  useEffect(() => {
    if (corriendo || !candidato) return
    setCorriendo(candidato)
    if (!tourActivoDef) marcarCompletado()
  }, [corriendo, candidato, tourActivoDef, marcarCompletado])

  const tourAEjecutar = corriendo
  const pasos = useMemo(
    () => (tourAEjecutar?.pasos || []).filter(
      p => !p.soloEn || p.soloEn === (esMovil ? 'movil' : 'escritorio'),
    ),
    [tourAEjecutar, esMovil],
  )

  if (!pasos.length) return null

  const handleCallback = (data: any) => {
    const { status, type, index } = data as { status: string; type: string; index: number }

    if (type === 'step:after' && typeof index === 'number' && pasos[index]) {
      const pasoId = (pasos[index] as any).id
      if (pasoId && estado && !estado.pasos_completados.includes(pasoId)) {
        marcarPaso(pasoId)
      }
    }

    const esFin =
      status === 'finished' ||
      status === 'skipped' ||
      type === 'tour:end'

    if (esFin) {
      // El onboarding ya quedó marcado al iniciar; aquí solo se suelta la guía.
      setCorriendo(null)
      activarTour(null)
    }
  }

  // El globo (tooltip) es 100% custom (TourTooltip). Aquí solo quedan el velo que
  // oscurece el fondo, el foco dorado sobre el elemento y el "beacon".
  const styles = {
    options: {
      overlayColor: 'rgba(9, 11, 18, 0.6)',
      primaryColor: '#FFC61A',
      arrowColor: '#161618',   // igual que --c-surface (oscuro): la flecha lee como parte del globo
      zIndex: 10000,
    },
    spotlight: {
      borderRadius: 14,
      border: '2px solid #FFC61A',
      boxShadow: '0 0 0 3px rgba(255,198,26,0.30), 0 0 44px rgba(255,198,26,0.28)',
    } as any,
    beacon: { backgroundColor: '#FFC61A' } as any,
    beaconInner: { backgroundColor: '#FFC61A', borderColor: '#FFC61A' } as any,
    beaconOuter: { borderColor: 'rgba(255,198,26,0.45)' } as any,
  }

  const props = {
    key: tourAEjecutar!.id,
    steps: pasos as Step[],
    run: Boolean(tourAEjecutar),
    continuous: true,
    showProgress: false,
    showSkipButton: true,
    disableCloseOnEsc: false,
    disableOverlayClose: false,
    hideBackButton: false,
    spotlightPadding: 8,
    callback: handleCallback,
    tooltipComponent: TourTooltip,
    locale: {
      back: 'Atrás',
      close: 'Cerrar',
      last: 'Finalizar',
      next: 'Siguiente',
      open: 'Abrir guía',
      skip: 'Saltar guía',
    },
    styles: styles as any,
    floaterProps: {
      hideArrow: false,
    },
  }

  return <Joyride {...(props as any)} />
}
