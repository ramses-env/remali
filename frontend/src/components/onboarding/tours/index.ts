import homeTour from './home.tour'
import catalogoTour from './catalogo.tour'
import cotizacionTour from './cotizacion.tour'
import perfilTour from './perfil.tour'
import type { TourDefinition } from '../OnboardingTour'

const TODOS_TOURS: TourDefinition[] = [
  homeTour,
  catalogoTour,
  cotizacionTour,
  perfilTour,
].sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))

export default TODOS_TOURS
