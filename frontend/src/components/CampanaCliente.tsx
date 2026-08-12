import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { leerToken } from '../lib/token'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

type Notif = {
  id: number
  tipo: 'renta' | 'venta' | 'alerta' | 'inventario' | 'sistema' | string
  titulo: string
  mensaje?: string
  seccion?: string
  ref?: string
  data?: Record<string, any>
  creada: string
  leida: boolean
}

type MetaTipo = {
  /** Etiqueta del chip semántico (arriba del título). 1-2 palabras. */
  chip: string
  /** Variables CSS con nombre canónico. Sin bordes de lado. */
  acento: 'libre' | 'renta' | 'gold' | 'mute' | 'alerta'
  /** Pictograma SVG. */
  icono: ReactNode
}

const _METAS: Record<string, MetaTipo> = {
  'venta-compraste': {
    chip: 'Compra',
    acento: 'libre',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12l-1.1 11.2a2 2 0 0 1-2 1.8H9.1a2 2 0 0 1-2-1.8L6 7Z" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    ),
  },
  'venta-cancelacion': {
    chip: 'Cancelación',
    acento: 'mute',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    ),
  },
  'renta-rentaste': {
    chip: 'Renta',
    acento: 'renta',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  'renta-reservaste': {
    chip: 'Reserva',
    acento: 'gold',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  'sistema-autorizacion': {
    chip: 'Cotización',
    acento: 'gold',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5L20 7" />
      </svg>
    ),
  },
  sistema: {
    chip: 'Aviso',
    acento: 'mute',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5h.01" />
      </svg>
    ),
  },
  venta: {
    chip: 'Venta',
    acento: 'libre',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12l-1.1 11.2a2 2 0 0 1-2 1.8H9.1a2 2 0 0 1-2-1.8L6 7Z" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    ),
  },
  renta: {
    chip: 'Renta',
    acento: 'renta',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  alerta: {
    chip: 'Alerta',
    acento: 'alerta',
    icono: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 2.5 19h19L12 3Z" />
        <path d="M12 10v5M12 18h.01" />
      </svg>
    ),
  },
}

function _metaDe(n: Notif): MetaTipo {
  const accion = typeof n.data?.accion_cliente === 'string' ? n.data.accion_cliente : ''
  if (accion) {
    const k = `${n.tipo}-${accion}`
    if (_METAS[k]) return _METAS[k]
  }
  if (n.tipo === 'sistema' && /autorizada|rechazada|cotización/iu.test(n.titulo)) {
    return _METAS['sistema-autorizacion']
  }
  return _METAS[n.tipo] ?? _METAS.sistema
}

function _colorAcento(acento: MetaTipo['acento']): { ring: string; chipBg: string; chipText: string; iconBg: string; iconFg: string } {
  switch (acento) {
    case 'libre':
      return {
        ring: 'rgba(31,122,77,0.18)',
        chipBg: 'rgba(31,122,77,0.12)',
        chipText: 'var(--c-libre)',
        iconBg: 'rgba(31,122,77,0.14)',
        iconFg: 'var(--c-libre)',
      }
    case 'renta':
      return {
        ring: 'var(--c-renta-glow)',
        chipBg: 'rgba(43,95,173,0.12)',
        chipText: 'var(--c-renta)',
        iconBg: 'rgba(43,95,173,0.14)',
        iconFg: 'var(--c-renta)',
      }
    case 'gold':
      return {
        ring: 'var(--c-gold-glow)',
        chipBg: 'var(--c-gold-soft)',
        chipText: 'var(--c-gold)',
        iconBg: 'var(--c-gold-soft)',
        iconFg: 'var(--c-gold)',
      }
    case 'alerta':
      return {
        ring: 'rgba(220,38,38,0.22)',
        chipBg: 'rgba(220,38,38,0.10)',
        chipText: '#DC2626',
        iconBg: 'rgba(220,38,38,0.12)',
        iconFg: '#DC2626',
      }
    case 'mute':
    default:
      return {
        ring: 'rgba(107,114,128,0.18)',
        chipBg: 'var(--c-surface-2)',
        chipText: 'var(--c-mute)',
        iconBg: 'var(--c-surface-2)',
        iconFg: 'var(--c-mute)',
      }
  }
}

function _ctaPara(n: Notif): { texto: string; to: string } | null {
  const d = n.data ?? {}
  if ((n.seccion === 'mis-compras' || n.tipo === 'venta') && typeof d.venta_id === 'number') {
    return { texto: 'Ver mi compra', to: '/cuenta/compras' }
  }
  if ((n.seccion === 'mis-rentas' || n.tipo === 'renta') && typeof d.renta_id === 'number') {
    return { texto: 'Ver mi renta', to: '/cuenta/rentas' }
  }
  if (n.seccion === 'cotizaciones' || /cotizaci[oó]n/iu.test(n.titulo)) {
    return { texto: 'Ir a cotizaciones', to: '/cuenta/cotizaciones' }
  }
  return null
}

/** Campana de notificaciones personales del cliente. */
export default function CampanaCliente() {
  const [items, setItems] = useState<Notif[]>([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [abierto, setAbierto] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const sinMovimiento = useReducedMotion()
  const navegar = useNavigate()

  const cargar = () => {
    api
      .get<{ notificaciones: Notif[]; no_leidas: number }>('/notificaciones/mias/', { fondo: true } as never)
      .then(r => {
        setItems(r.data.notificaciones || [])
        setNoLeidas(r.data.no_leidas || 0)
      })
      .catch(() => {})
  }

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 60000)
    return () => clearInterval(id)
  }, [])

  // WebSocket para push en tiempo real.
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
        } catch { /* */ }
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

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setAbierto(false)
    }
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

  const eliminar = (id: number) => {
    setItems(prev => prev.filter(n => n.id !== id))
    api.post(`/notificaciones/mias/${id}/eliminar/`, {}, { fondo: true } as never).catch(() => {})
  }

  const limpiarTodas = () => {
    setItems([]); setNoLeidas(0)
    api.post('/notificaciones/mias/limpiar/', {}, { fondo: true } as never).catch(() => {})
  }

  const durMs = useMemo(() => (sinMovimiento ? 0 : undefined), [sinMovimiento])

  return (
    <div ref={box} className="relative">
      <button
        onClick={toggle}
        aria-label={`Notificaciones${noLeidas ? `, ${noLeidas} sin leer` : ''}`}
        className="relative w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-gold transition-colors flex items-center justify-center active:scale-95"
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v.5a3 3 0 1 1-6 0V17" />
        </svg>
        {noLeidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-black text-[10px] font-black flex items-center justify-center tabular-nums">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: durMs ?? 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="origin-top-right fixed inset-x-3 top-[76px] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[400px] max-w-none sm:max-w-[calc(100vw-2rem)] rounded-2xl border border-edge bg-surface shadow-[0_22px_60px_rgba(17,24,39,0.20)] z-[110] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gold-soft flex items-center justify-center text-gold">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v.5a3 3 0 1 1-6 0V17" />
                  </svg>
                </div>
                <div className="flex flex-col leading-tight">
                  <div className="text-[15px] font-extrabold text-ink tracking-tight">Notificaciones</div>
                  {noLeidas > 0 ? (
                    <div className="text-[12px] text-mute font-medium">{noLeidas} nueva{noLeidas === 1 ? '' : 's'} sin leer</div>
                  ) : (
                    <div className="text-[12px] text-mute font-medium">Todo al día</div>
                  )}
                </div>
              </div>
              {items.length > 0 && (
                <button
                  onClick={limpiarTodas}
                  className="h-8 px-3 rounded-full text-[12.5px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="max-h-[min(58vh,440px)] overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-14 text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center mx-auto mb-4 text-mute">
                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 5 5L20 7" />
                    </svg>
                  </div>
                  <div className="text-[14px] font-semibold text-ink mb-1">Todo listo</div>
                  <p className="text-[13px] text-mute leading-relaxed max-w-xs mx-auto">
                    No tienes avisos nuevos. Aquí verás tus compras, rentas, cotizaciones autorizadas y actualizaciones de REMALI.
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {items.map(n => {
                    const meta = _metaDe(n)
                    const c = _colorAcento(meta.acento)
                    const cta = _ctaPara(n)
                    return (
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                        transition={{ duration: durMs ?? 0.2, ease: [0.32, 0.72, 0, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div
                          className={[
                            'flex gap-3.5 px-5 py-4 border-b border-edge/60 last:border-b-0 transition-colors',
                            !n.leida ? 'bg-gold-soft/25' : 'hover:bg-surface-2/50',
                          ].join(' ')}
                        >
                          {/* Pictograma semántico (reemplaza el side-stripe prohibido) */}
                          <div
                            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                            style={{ background: c.iconBg, color: c.iconFg }}
                          >
                            <div className="w-5 h-5">{meta.icono}</div>
                          </div>

                          {/* Contenido */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span
                                className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-black tracking-wide uppercase"
                                style={{ background: c.chipBg, color: c.chipText }}
                              >
                                {meta.chip}
                              </span>
                              <span className="text-[11.5px] text-mute tabular-nums font-medium">
                                {tiempoRelativo(n.creada)}
                              </span>
                            </div>
                            <div className="text-[14.5px] font-extrabold text-ink leading-snug tracking-tight">
                              {n.titulo}
                            </div>
                            {n.mensaje && (
                              <div className="text-[13.5px] text-mute mt-1 leading-relaxed line-clamp-3">
                                {n.mensaje}
                              </div>
                            )}

                            {/* CTA contextual + X inline */}
                            <div className="mt-2.5 flex items-center gap-2 justify-between">
                              {cta ? (
                                <button
                                  onClick={() => { setAbierto(false); navegar(cta.to) }}
                                  className="h-8 px-3 rounded-full text-[12px] font-bold bg-gold text-black hover:opacity-92 transition-opacity active:scale-[0.97]"
                                >
                                  {cta.texto}
                                </button>
                              ) : (
                                <span />
                              )}
                              <button
                                onClick={() => eliminar(n.id)}
                                title="Quitar notificación"
                                aria-label="Quitar notificación"
                                className="w-7 h-7 rounded-full bg-surface-2/80 hover:bg-surface-2 text-mute hover:text-ink shrink-0 flex items-center justify-center transition-[background-color,color,transform] active:scale-90"
                              >
                                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m6 6 12 12M18 6 6 18" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Tiempo relativo corto: "hace 5 min", "ayer". */
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
