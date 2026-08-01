import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { leerToken } from '../lib/token'

type Notif = { id: number; tipo: string; titulo: string; mensaje?: string; creada: string; leida: boolean }

/** Campana de notificaciones personales del cliente.
 *  - Carga inicial por HTTP (/notificaciones/mias/).
 *  - Push INSTANTÁNEO por WebSocket (Channels): en cuanto el backend crea una
 *    notificación para este cliente, llega sin recargar ni sondear.
 *  - Sondeo lento (60 s) solo como red de seguridad si el socket se cae. */
export default function CampanaCliente() {
  const [items, setItems] = useState<Notif[]>([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [abierto, setAbierto] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const cargar = () => {
    api.get<{ notificaciones: Notif[]; no_leidas: number }>('/notificaciones/mias/', { fondo: true } as never)
      .then(r => { setItems(r.data.notificaciones || []); setNoLeidas(r.data.no_leidas || 0) })
      .catch(() => { /* sondeo de fondo, silencioso */ })
  }

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 60000)   // red de seguridad si el WS cae
    return () => clearInterval(id)
  }, [])

  // WebSocket para tiempo real de verdad.
  useEffect(() => {
    let vivo = true
    let reintento: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | null = null

    const conectar = () => {
      const token = leerToken()
      if (!token || !vivo) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws/notificaciones/?token=${encodeURIComponent(token)}`)
      ws.onmessage = (e) => {
        try {
          const n: Notif = JSON.parse(e.data)
          setItems(prev => [n, ...prev.filter(x => x.id !== n.id)].slice(0, 50))
          setNoLeidas(c => c + 1)
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (vivo) reintento = setTimeout(conectar, 5000) }   // reconexión
      ws.onerror = () => { try { ws?.close() } catch { /* */ } }
    }
    conectar()
    return () => { vivo = false; if (reintento) clearTimeout(reintento); try { ws?.close() } catch { /* */ } }
  }, [])

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const toggle = () => {
    const abrir = !abierto
    setAbierto(abrir)
    if (abrir && noLeidas > 0) {
      api.post('/notificaciones/mias/leer/', {}, { fondo: true } as never).catch(() => {})
      setNoLeidas(0)
      setItems(prev => prev.map(n => ({ ...n, leida: true })))
    }
  }

  return (
    <div ref={box} className="relative">
      <button onClick={toggle} aria-label="Notificaciones" className="relative w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-gold transition-colors flex items-center justify-center">
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v.5a3 3 0 1 1-6 0V17" /></svg>
        {noLeidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-black text-[10px] font-black flex items-center justify-center">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-edge bg-surface shadow-2xl z-[110] overflow-hidden">
          <div className="px-4 py-3 border-b border-edge">
            <p className="text-sm font-bold text-ink">Notificaciones</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-sm text-mute text-center py-10">Sin notificaciones.</p>
            ) : (
              items.map(n => (
                <div key={n.id} className={`px-4 py-3 border-b border-edge last:border-0 ${!n.leida ? 'bg-gold-soft/40' : ''}`}>
                  <p className="text-sm font-semibold text-ink">{n.titulo}</p>
                  {n.mensaje && <p className="text-xs text-mute mt-0.5">{n.mensaje}</p>}
                  <p className="text-[10px] text-mute mt-1">
                    {new Date(n.creada).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
