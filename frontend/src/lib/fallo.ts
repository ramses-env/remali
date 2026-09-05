/** Fallos que NO se le enseñan al usuario, pero tampoco se pierden.
 *
 *  Hay peticiones cuyo fracaso no vale una alerta: marcar una notificación como
 *  leída, precargar un historial, un catálogo secundario. La respuesta a eso era
 *  `.catch(() => {})`, y ahí está el problema: el error no se maneja, desaparece.
 *  Cuando el panel amanece vacío no queda ni una línea de por dónde empezar —el
 *  "panel mudo" que ya nos costó dos rondas de depuración a ciegas—.
 *
 *  `anotarFallo` no molesta a nadie y deja el rastro. La URL y el método no hay
 *  que escribirlos: vienen dentro del error de axios.
 *
 *      api.post(`/notificaciones/${n.id}/leer/`).then(recargar).catch(anotarFallo)
 */
type ErrorAxios = {
  response?: { status?: number }
  config?: { method?: string; url?: string }
  message?: string
}

export function anotarFallo(err: unknown): void {
  const e = err as ErrorAxios
  const donde = e?.config?.url
    ? `${(e.config.method || 'get').toUpperCase()} ${e.config.url}`
    : 'una petición'
  const porque = e?.response?.status ? `HTTP ${e.response.status}` : e?.message || String(err)
  console.error(`[remali] falló ${donde}: ${porque}`)
}

/** Igual, con una nota de qué se estaba haciendo (para lo que no es axios). */
export const anotarFalloDe = (que: string) => (err: unknown): void => {
  console.error(`[remali] falló ${que}:`, err)
}
