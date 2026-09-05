import type { TourDefinition, TourPaso } from '../OnboardingTour'

const pasos: TourPaso[] = [
  {
    id: 'perfil-intro',
    target: 'body',
    placement: 'center',
    title: '👤 Tu área de cliente',
    content:
      'Aquí vives como cliente: tu información, tus obras y tu historial. Vamos a recorrer lo más importante.',
    disableBeacon: true,
  },
  {
    id: 'perfil-avance',
    target: '[data-onboarding="perfil-avance"]',
    placement: 'left',
    title: 'Progreso de tu perfil',
    content:
      'Completa los 5 datos y activas tu descuento de bienvenida. Lo usas una sola vez, en la compra o renta que tú elijas:',
    cupon: 'gancho',
  },
  {
    id: 'perfil-fiscales',
    target: '#facturacion',
    placement: 'left',
    title: 'Facturación (RFC y datos)',
    content:
      'Activa el switch y llena tu RFC, Razón Social y Régimen. Con esto ya podemos facturarte oficial.',
  },
  {
    id: 'perfil-mis-cotizaciones',
    target: 'header a[href="/mis-cotizaciones"]',
    placement: 'bottom',
    title: 'Mis cotizaciones',
    content:
      'Consulta el estado de cada solicitud: pendiente, autorizada, rechazada o convertida en orden.',
  },
  {
    id: 'perfil-mis-rentas',
    target: 'header a[href="/mis-rentas"]',
    placement: 'bottom',
    title: 'Mis rentas activas',
    content:
      'Aquí revisas las máquinas que hoy tienes rentadas, cuánto falta y los pagos.',
  },
  {
    id: 'perfil-mis-compras',
    target: 'header a[href="/mis-compras"]',
    placement: 'bottom',
    title: 'Mis compras',
    content:
      'Historial de equipos que ya compraste, con detalles de entrega y garantía.',
  },
  {
    id: 'perfil-mis-reparaciones',
    target: 'header a[href="/mis-reparaciones"]',
    placement: 'bottom',
    title: 'Mis reparaciones',
    content:
      '¿Mandaste una máquina al taller? Sigue su estado desde aquí, paso a paso.',
  },
  {
    id: 'perfil-whatsapp',
    target: '[data-onboarding="dock-whatsapp"], [data-dock-item="whatsapp"]',
    placement: 'top',
    title: 'Soporte por WhatsApp',
    content:
      'Un clic y hablas con nosotros directamente. Responderemos rápido, incluso fines de semana.',
  },
] as unknown as TourPaso[]

const perfilTour: TourDefinition = {
  id: 'perfil-v1',
  ruta_activadora: '/perfil',
  soloPrimeraVez: true,
  orden: 4,
  pasos,
}

export default perfilTour
