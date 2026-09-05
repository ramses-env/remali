import type { TourDefinition, TourPaso } from '../OnboardingTour'

const pasos: TourPaso[] = [
  {
    id: 'catalogo-filtros',
    target: 'body',
    placement: 'center',
    title: '📦 Catálogo de Equipos',
    content:
      'Explora toda la maquinaria disponible. Aquí te explicamos cómo encontrar lo que necesitas rápido.',
    disableBeacon: true,
  },
  {
    id: 'catalogo-filtros-flotantes',
    target: '[data-onboarding="filtros-flotantes"], aside.hidden.md\\:block',
    placement: 'right',
    title: 'Filtros avanzados',
    content:
      'En celular toca "Filtros"; en escritorio los tienes a la izquierda. Filtra por categoría, marca y disponibilidad.',
  },
  {
    id: 'catalogo-toggle-venta-renta',
    target: '[data-onboarding="toggle-precio"], [role="radiogroup"][aria-label*="Selecciona unidad"]',
    placement: 'bottom',
    title: 'Precio por día/semana/mes',
    content:
      'Cambia entre ver precios de renta por Día, Semana o Mes. Arriba puedes filtrar por "Comprar" o "Rentar".',
  },
  {
    id: 'catalogo-tarjeta-corazon',
    target: '.equipo-card:first-of-type [data-onboarding="tarjeta-favorito"]',
    placement: 'right',
    title: 'Guardar en favoritos ♥',
    content:
      'Toca el corazón en cualquier equipo para guardarlo y compararlo después desde tu menú.',
  },
  {
    id: 'catalogo-disponibilidad',
    target: '.equipo-card:first-of-type [data-onboarding="badge-disponible"]',
    placement: 'top',
    title: 'Disponibilidad hoy',
    content:
      'Verde = entrega inmediata. Ámbar = sobre pedido (te lo conseguimos en X días). Negro = agotado temporalmente.',
  },
  {
    id: 'catalogo-ver-detalle',
    target: '.equipo-card:first-of-type [data-onboarding="tarjeta-ver"]',
    placement: 'left',
    title: 'Ver ficha del equipo',
    content:
      'Toca cualquier imagen para entrar al detalle: ficha técnica PDF, especificaciones y solicitar cotización.',
  },
] as unknown as TourPaso[]

const catalogoTour: TourDefinition = {
  id: 'catalogo-v1',
  ruta_activadora: '/equipos',
  soloPrimeraVez: true,
  orden: 2,
  pasos,
}

export default catalogoTour
