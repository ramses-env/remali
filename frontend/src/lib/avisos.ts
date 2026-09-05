/** Bus de avisos GLOBAL: el interceptor de la API publica aquí los errores que
 *  nadie más va a contar (sin conexión, 500, permisos), y la superficie viva
 *  (la tienda con su ToastProvider o el panel con su pila) los pinta con las
 *  alertas de la casa. Una sola ranura: tienda y panel nunca conviven. */
type Pintor = (mensaje: string) => void

let pintor: Pintor | null = null

export function conectarAvisos(f: Pintor) {
  pintor = f
  return () => { if (pintor === f) pintor = null }
}

/* Anti-inundación: cuando se cae la red (o el túnel) MUCHAS peticiones fallan
   —seguidas o espaciadas— y cada una pedía su toast: la pantalla se llenaba de
   avisos idénticos. La dedup de cada pila solo mira lo que hay EN PANTALLA, así
   que no frena los que llegan una vez que el anterior ya se desvaneció. Aquí, en
   el bus, se recuerda cuándo se mostró cada mensaje y se ignora si se repite
   dentro de la ventana: como mucho un aviso igual cada VENTANA_MS. */
const VENTANA_MS = 8000
const ultimoPorMensaje = new Map<string, number>()

export function avisar(mensaje: string) {
  const ahora = Date.now()
  if (ahora - (ultimoPorMensaje.get(mensaje) || 0) < VENTANA_MS) return
  ultimoPorMensaje.set(mensaje, ahora)
  pintor?.(mensaje)
}
