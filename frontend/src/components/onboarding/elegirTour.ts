import type { TourDefinition } from './OnboardingTour'
import type { OnboardingEstado } from '../../store/onboarding'

/**
 * Qué guía toca, si es que toca alguna. Vive aparte de `OnboardingTour` a
 * propósito: la decisión es de dos líneas y no necesita react-joyride, así que
 * el portero (`OnboardingGate`) puede tomarla SIN bajar la librería. El propio
 * OnboardingTour usa esta misma función, para que no haya dos criterios que se
 * puedan desincronizar.
 *
 * `manual` distingue la guía que el usuario pidió (botón "ver guía") de la que
 * arranca sola: la automática marca el onboarding como visto al empezar, la
 * manual no.
 */
export function elegirTour(
  tours: TourDefinition[],
  estado: OnboardingEstado | null,
  tourActivo: string | null,
  pathname: string,
): { def: TourDefinition | null; manual: boolean } {
  if (tourActivo) {
    const pedida = tours.find(t => t.id === tourActivo) || null
    if (pedida) return { def: pedida, manual: true }
  }
  // Auto-arranque: solo si el onboarding NO está completado (las cuentas viejas
  // quedaron marcadas por la migración 0039, así que en la práctica es "solo
  // usuarios nuevos").
  if (!estado || estado.completado) return { def: null, manual: false }
  for (const t of tours) {
    const coincide = typeof t.ruta_activadora === 'string'
      ? pathname === t.ruta_activadora
      : t.ruta_activadora.test(pathname)
    if (!coincide) continue
    if (t.soloPrimeraVez && estado.pasos_completados.includes(t.id)) continue
    return { def: t, manual: false }
  }
  return { def: null, manual: false }
}
