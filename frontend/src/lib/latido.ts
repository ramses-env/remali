import { useEffect, useRef } from 'react'
import api from './api'

/* Cuántos latidos seguidos pueden fallar antes de decirlo en voz alta.

   El latido es lo que mantiene vivo al panel: si empieza a dar 403 (sesión de
   cliente pegada, permiso retirado) o 500, el `catch` de abajo se lo tragaba y
   el panel se quedaba congelado PARA SIEMPRE sin una sola señal —lo que en las
   notas del proyecto quedó como "panel mudo", diagnosticado a mano leyendo el
   STATUS de /api/latido/ en el log del servidor—.

   Tres seguidos y no dos: uno solo es un bache de red, y avisar por eso sería
   ruido. Tres son ~6 s de panel sin actualizarse, que ya es un problema. Se
   avisa UNA vez por racha; cuando el latido vuelve, la racha se reinicia y el
   siguiente corte vuelve a avisar. */
const FALLOS_PARA_AVISAR = 3

function avisoDeLatido(url: string, fallos: number, err: unknown) {
  const st = (err as { response?: { status?: number } })?.response?.status
  if (fallos === FALLOS_PARA_AVISAR) {
    console.error(
      `[remali] el latido ${url} lleva ${fallos} fallos seguidos${st ? ` (HTTP ${st})` : ''}: ` +
      'esta pantalla ya NO se está actualizando sola.',
    )
  }
}

/**
 * Tiempo real por latido: consulta un sello de versión ultra barato cada
 * `ms` (solo con la pestaña visible) y llama `alCambiar` únicamente cuando
 * el sello se movió — es decir, cuando OTRA persona cambió algo.
 *
 * Así la recarga completa (la consulta cara) ocurre solo ante cambios
 * reales, y el sondeo frecuente cuesta unos bytes. Latencia percibida:
 * 1-2 s, prácticamente instantáneo, sin websockets que mantener.
 *
 * Al volver a la pestaña se late de inmediato, para no esperar el tick.
 */
export function useLatido(url: string, ms: number, alCambiar: () => void) {
  // El callback vive en un ref: el intervalo no se rearma si cambia.
  const cb = useRef(alCambiar)
  cb.current = alCambiar

  useEffect(() => {
    let vivo = true
    let sello: string | null = null
    let fallos = 0
    const latir = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api.get<{ v: string }>(url, { fondo: true } as never)
        if (!vivo) return
        const v = r.data?.v
        if (v && sello !== null && v !== sello) cb.current()
        if (v) sello = v
        fallos = 0
      } catch (err) {
        // Un fallo aislado no se anuncia: el siguiente latido reintenta. Lo que
        // no puede pasar es que se caiga del todo y nadie lo note nunca.
        fallos += 1
        avisoDeLatido(url, fallos, err)
      }
    }
    latir()
    const id = window.setInterval(latir, ms)
    const alVolver = () => { if (document.visibilityState === 'visible') latir() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
  }, [url, ms])
}

/**
 * Variante por temas para el panel: el endpoint devuelve {tema: sello} y
 * aquí se invalida SOLO lo que se movió — editar un producto en otra PC
 * refresca productos, no el panel entero.
 */
export function useLatidoPanel(url: string, ms: number, alCambiar: (temas: string[]) => void) {
  const cb = useRef(alCambiar)
  cb.current = alCambiar

  useEffect(() => {
    let vivo = true
    let sellos: Record<string, string> | null = null
    let fallos = 0
    const latir = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api.get<Record<string, string>>(url, { fondo: true } as never)
        if (!vivo) return
        const datos = r.data || {}
        if (sellos !== null) {
          const previos = sellos
          const cambiados = Object.keys(datos).filter(k => datos[k] !== previos[k])
          if (cambiados.length) cb.current(cambiados)
        }
        sellos = datos
        fallos = 0
      } catch (err) {
        // Un fallo aislado no se anuncia: el siguiente latido reintenta. Lo que
        // no puede pasar es que se caiga del todo y nadie lo note nunca.
        fallos += 1
        avisoDeLatido(url, fallos, err)
      }
    }
    latir()
    const id = window.setInterval(latir, ms)
    const alVolver = () => { if (document.visibilityState === 'visible') latir() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
  }, [url, ms])
}
