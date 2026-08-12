import { useEffect, useRef } from 'react'
import { leerToken } from './token'

export type ClienteEvento = {
  topic: 'cotizaciones' | 'rentas' | 'adeudos' | 'compras' | 'reparaciones' | string
  action?: string
  source?: string
  cotizacion_id?: number | null
  folio?: string | null
}

/** WebSocket de eventos de la cuenta del cliente.
 *
 * El servidor no envía el estado completo: solo avisa qué cambió para que cada
 * pantalla recargue su fuente de verdad por HTTP.
 */
export function useClienteEventos(onEvent: (evt: ClienteEvento) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    let vivo = true
    let reintento: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | null = null

    const conectar = () => {
      const token = leerToken()
      if (!token || !vivo) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws/cliente-eventos/?token=${encodeURIComponent(token)}`)
      ws.onmessage = (e) => {
        try { cb.current(JSON.parse(e.data) as ClienteEvento) } catch { /* ignore */ }
      }
      ws.onclose = () => { if (vivo) reintento = setTimeout(conectar, 5000) }
      ws.onerror = () => { try { ws?.close() } catch { /* */ } }
    }

    conectar()
    return () => {
      vivo = false
      if (reintento) clearTimeout(reintento)
      try { ws?.close() } catch { /* */ }
    }
  }, [])
}
