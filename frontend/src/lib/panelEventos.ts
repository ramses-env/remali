import { useEffect } from 'react'

import { expandTemas, invalidar, type Tema } from './realtime'
import { leerToken } from './token'
import wsUrl from './wsUrl'

type PanelPayload = { topics?: string[] }

/** WebSocket del panel interno.
 *
 * El servidor solo avisa qué temas cambiaron; cada módulo sigue recargando su
 * propia fuente de verdad por HTTP.
 */
export function usePanelEventos() {
  useEffect(() => {
    let vivo = true
    let ws: WebSocket | null = null
    let reintento: ReturnType<typeof setTimeout> | undefined

    const conectar = () => {
      const token = leerToken()
      if (!token || !vivo) return
      ws = new WebSocket(wsUrl('/ws/panel-eventos/', token))
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as PanelPayload
          const topics = (data.topics || []).filter(Boolean) as Tema[]
          if (topics.length) invalidar(...expandTemas(topics))
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (vivo) reintento = setTimeout(conectar, 5000) }
      ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
    }

    conectar()
    return () => {
      vivo = false
      if (reintento) clearTimeout(reintento)
      try { ws?.close() } catch { /* ignore */ }
    }
  }, [])
}
