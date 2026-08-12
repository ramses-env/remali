import type { TourDefinition, TourPaso } from '../OnboardingTour'

const pasos: TourPaso[] = [
  {
    id: 'home-bienvenida',
    target: 'body',
    placement: 'center',
    title: '👋 Te damos la bienvenida a REMALI',
    content:
      'En menos de un minuto verás lo esencial para rentar y comprar maquinaria. Y por empezar con el pie derecho, te dejamos esto:',
    cupon: 'gancho',
    disableBeacon: true,
  },
  {
    id: 'home-logo',
    target: 'header a[href="/"]',
    placement: 'bottom',
    title: 'Logo REMALI',
    content: 'Desde cualquier página, toca el logo para volver al inicio.',
  },
  {
    id: 'home-favoritos',
    target: 'header a[href="/favoritos"]',
    placement: 'bottom',
    title: 'Tus favoritos ♥',
    content: 'Guarda aquí los equipos que te interesan para revisarlos después.',
  },
  {
    id: 'home-cotizacion',
    target: 'header a[href="/cotizacion"]',
    placement: 'bottom',
    title: 'Tu cotización',
    content:
      'Aquí verás los equipos que seleccionaste para pedir una cotización oficial.',
  },
  {
    id: 'home-menu-cuenta',
    target: 'header [aria-label="Tu cuenta"]',
    placement: 'bottom-end',
    title: 'Tu menú de cuenta',
    content:
      'Tu centro de control: perfil, cotizaciones, rentas y compras. Aquí también completas tu perfil para activar el 5% de bienvenida.',
  },
  {
    id: 'home-dock',
    target: '[data-onboarding="dock-whatsapp"]',
    placement: 'top',
    soloEn: 'movil',
    title: 'Dock de navegación',
    content:
      'La barra inferior te lleva a Catálogo, Favoritos, Cotización, WhatsApp y tus Rentas. Todo al alcance del pulgar.',
  },
  {
    id: 'home-cierre',
    target: 'body',
    placement: 'center',
    title: '🎉 ¡Listo, ya conoces REMALI!',
    content:
      'Eso era todo lo esencial. Ahora completa tu perfil para reclamar tu regalo de bienvenida:',
    cupon: 'listo',
    disableBeacon: true,
  },
] as unknown as TourPaso[]

const homeTour: TourDefinition = {
  id: 'home-welcome-v1',
  ruta_activadora: '/',
  soloPrimeraVez: true,
  orden: 1,
  pasos,
}

export default homeTour
