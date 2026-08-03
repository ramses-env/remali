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

  // Quitar una (se acumulan): borra en el server y de la lista al instante.
  const eliminar = (id: number) => {
    setItems(prev => prev.filter(n => n.id !== id))
    api.post(`/notificaciones/mias/${id}/eliminar/`, {}, { fondo: true } as never).catch(() => {})
  }
  const limpiarTodas = () => {
    setItems([]); setNoLeidas(0)
    api.post('/notificaciones/mias/limpiar/', {}, { fondo: true } as never).catch(() => {})
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
        <div className="fixed inset-x-3 top-[76px] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[380px] max-w-none sm:max-w-[calc(100vw-2rem)] rounded-2xl border border-edge bg-surface shadow-[0_20px_50px_rgba(17,24,39,0.18)] z-[110] overflow-hidden">
          <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-3">
            <div className="text-lg font-extrabold text-ink">Notificaciones</div>
            {items.length > 0 && (
              <button onClick={limpiarTodas} className="text-[13px] font-bold text-ink hover:text-gold transition-colors">Limpiar todas</button>
            )}
          </div>
          <div className="max-h-[min(55vh,360px)] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-12 text-center px-6">
                <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3 text-mute">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" /></svg>
                </div>
                <p className="text-sm text-mute">No tienes notificaciones.</p>
              </div>
            ) : (
              items.map(n => (
                <div key={n.id} className={`flex gap-2.5 px-5 py-4 border-b border-edge/60 last:border-b-0 ${!n.leida ? 'bg-gold-soft/30' : ''}`}>
                  <span className="w-[7px] h-[7px] rounded-full shrink-0 mt-[7px]" style={{ background: !n.leida ? 'var(--c-gold)' : 'var(--c-mute)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-[14.5px] text-ink">{n.titulo}</div>
                    {n.mensaje && <div className="text-[13.5px] text-mute mt-1 leading-snug line-clamp-2">{n.mensaje}</div>}
                    <div className="text-[12.5px] text-mute mt-1.5">{tiempoRelativo(n.creada)}</div>
                  </div>
                  <button onClick={() => eliminar(n.id)} title="Quitar" aria-label="Quitar notificación"
                    className="w-[26px] h-[26px] rounded-full bg-surface-2 hover:bg-surface text-mute hover:text-ink shrink-0 flex items-center justify-center text-xs transition-colors">✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Tiempo relativo corto (igual que el panel del admin): "hace 5 min", "ayer". */
function tiempoRelativo(iso: string): string {
  const d = new Date(iso)
  const seg = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seg < 60) return 'hace un momento'
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
