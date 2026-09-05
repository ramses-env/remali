import { useCargando } from '../lib/cargando'
import Loader from './Loader'

/**
 * Indicador de carga de la aplicación.
 *
 * Sustituye al RouteLoader, que mostraba el loader 700 ms en cada cambio de ruta
 * con un temporizador fijo. Navegar dentro de una SPA no carga nada, así que
 * aquello inventaba una espera inexistente: hacía sentir la aplicación más lenta
 * de lo que es y enseñaba al usuario a ignorar el indicador.
 *
 * Ahora aparece solo cuando hay una petición de verdad en vuelo, y ni siquiera
 * siempre: si la respuesta llega antes de 350 ms no se muestra nada, porque un
 * loader que parpadea molesta más que la espera que intentaba cubrir. Los
 * sondeos automáticos del panel quedan fuera (ver api.ts).
 */
export default function CargaGlobal() {
  return useCargando() ? <Loader /> : null
}
