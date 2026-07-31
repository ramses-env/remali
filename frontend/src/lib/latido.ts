import { useEffect, useRef } from 'react'
import api from './api'

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
    const latir = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api.get<{ v: string }>(url, { fondo: true } as never)
        if (!vivo) return
        const v = r.data?.v
        if (v && sello !== null && v !== sello) cb.current()
        if (v) sello = v
      } catch { /* sin red o sin sesión: el siguiente latido reintenta */ }
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
      } catch { /* sin red o sin sesión: el siguiente latido reintenta */ }
    }
    latir()
    const id = window.setInterval(latir, ms)
    const alVolver = () => { if (document.visibilityState === 'visible') latir() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
  }, [url, ms])
}
