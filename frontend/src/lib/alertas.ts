/**
 * Duración de una alerta (toast), en milisegundos.
 *
 * FUENTE ÚNICA Y GLOBAL: la usan los DOS sistemas de alertas de la app —la
 * tienda (`store/toast.tsx`) y el panel (`routes/Dashboard.tsx`)— tanto para el
 * auto-cierre como para la barra de vida. Antes había 4 números sueltos (y hasta
 * con valores distintos entre sí); ahora se cambia AQUÍ y todo se ajusta a la vez.
 *
 * La barra de vida usa la keyframe `toast-avance` (index.css); su duración se
 * toma de esta constante para que vaciarse y desaparecer estén siempre en sync.
 */
export const DURACION_ALERTA_MS = 4000
