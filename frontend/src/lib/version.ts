/**
 * La versión del sistema, en UN solo lugar: `package.json`.
 *
 * Se importa el campo suelto (no el objeto entero) a propósito: así el bundle
 * de producción se queda con la cadena y NO con la lista de dependencias del
 * proyecto, que no tiene por qué viajar al navegador del cliente.
 *
 * Para publicar una versión nueva se sube `version` en package.json y ya: el
 * pie de la tienda y el del panel la leen de aquí.
 */
import { version } from '../../package.json'

export const VERSION = version
