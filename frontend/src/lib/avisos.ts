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

export function avisar(mensaje: string) {
  pintor?.(mensaje)
}
