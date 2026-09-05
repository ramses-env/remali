import type { TourDefinition, TourPaso } from '../OnboardingTour'

const pasos: TourPaso[] = [
  {
    id: 'cotizacion-intro',
    target: 'body',
    placement: 'center',
    title: '📋 Tu cotización',
    content:
      'Aquí armas tu pedido: mezcla equipos en Venta o Renta y solicita tu cotización oficial.',
    disableBeacon: true,
  },
  {
    id: 'cotizacion-ficha',
    target: '[data-onboarding="ficha-pdf"]',
    placement: 'bottom',
    title: 'Ficha técnica / PDF',
    content: 'Descarga el PDF con todo el detalle para mostrarle a tu jefe o cliente.',
  },
  {
    id: 'cotizacion-modo',
    target: '[data-onboarding="selector-modo"]',
    placement: 'right',
    title: 'El modo: Venta o Renta',
    content:
      'Arriba ves si el pedido actual es VENTA o RENTA. Cambias el modo al agregar cada equipo desde el catálogo.',
  },
  {
    id: 'cotizacion-fechas',
    target: '[data-onboarding="selector-fechas"]',
    placement: 'top',
    title: 'Duración de tu renta',
    content:
      'Usa los + y − para ajustar días, semanas o meses. El total se recalcula en tiempo real.',
  },
  {
    id: 'cotizacion-solicitar',
    target: '[data-onboarding="btn-solicitar"]',
    placement: 'left',
    title: 'Solicitar cotización',
    content:
      'Cuando estés listo, toca aquí. Nosotros recibimos tu solicitud y te contactamos en menos de 24h.',
  },
] as unknown as TourPaso[]

const cotizacionTour: TourDefinition = {
  id: 'cotizacion-v1',
  ruta_activadora: /^\/(cotizacion|equipo\/\d+)/,
  soloPrimeraVez: true,
  orden: 3,
  pasos,
}

export default cotizacionTour
