import { useEffect, useMemo, useRef, useState } from 'react'
import { useClienteEventos } from '../lib/clienteEventos'
import { useLatido } from '../lib/latido'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Loader2, PackageOpen } from 'lucide-react'

import api from '../lib/api'
import Migas from '../components/Migas'
import { descargarBlob } from '../lib/descargar'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'

type RentaMia = {
  id: number
  equipo: string
  modalidad: string
  estado: string
  estado_label: string
  fecha_inicio: string
  fecha_fin: string
  total: string
  direccion: string
  pagos?: { fecha: string; monto: string; metodo: string }[]
  pagado?: string
  saldo?: string
  cancelable?: boolean
}

const money = formatMoney
const fecha = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
/* Fechas de pagos: llegan como día suelto (AAAA-MM-DD) o como ISO completo con
   hora; esta las traga ambas (el día suelto anclado a mediodía para que la
   zona horaria no lo corra). */
const fechaPago = (s: string) => {
  const d = new Date(s && s.length === 10 ? `${s}T12:00:00` : s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}
const MOD: Record<string, string> = { dia: 'por día', semana: 'por semana', mes: 'por mes' }

function estiloEstado(estado: string) {
  if (estado === 'activa') return 'bg-libre/10 text-libre'
  if (estado === 'reservada') return 'bg-blue-500/10 text-blue-500'
  if (estado === 'finalizada') return 'bg-libre/10 text-libre'
  if (estado === 'vencida') return 'bg-red-500/10 text-red-500'
  return 'bg-ink/10 text-mute'
}

function Tarjeta({ r, i, onCambio }: { r: RentaMia; i: number; onCambio: () => void }) {
  // Cerrada por defecto: lo esencial arriba y el desglose de pagos bajo demanda.
  const [abierto, setAbierto] = useState(false)
  const saldo = Number(r.saldo || 0)
  const total = Number(r.total || 0)
  // Cancelar la reserva: el backend manda (solo reserva a futuro, sin entregar);
  // aquí solo se muestra cuando él dice que sí se puede.
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function cancelarReserva() {
    setEnviando(true)
    try {
      await api.post(`/rentas/${r.id}/cancelar-reserva/`, { motivo: motivo.trim() }, { fondo: true } as never)
      onCambio()
    } catch { /* el interceptor avisa */ } finally { setEnviando(false) }
  }
  return (
    <div style={{ animationDelay: `${i * 40}ms` }} className="stagger-item rounded-2xl border border-edge bg-surface px-5 py-4">
      {/* Línea 1: quién es y cuánto — el restante va EN la misma línea del total */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-sm font-extrabold text-ink">{r.equipo || 'Equipo'}</span>
        <span className={`text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${estiloEstado(r.estado)}`}>{r.estado_label}</span>
        <span className="text-[12.5px] text-mute">renta {MOD[r.modalidad] || r.modalidad}</span>
        <span className="ml-auto w-full sm:w-auto flex items-center justify-end gap-2.5">
          <span className="text-sm font-extrabold text-price tabular-nums">{money(total)}</span>
          {r.estado !== 'cancelada' && total > 0 && (
            saldo > 0
              ? <Link to="/mis-adeudos" className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 whitespace-nowrap hover:bg-red-500/20 transition-colors">Debes {money(saldo)} →</Link>
              : <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-libre/10 text-libre">Pagada</span>
          )}
        </span>
      </div>
      {/* Línea 2: fechas, orden y dirección — con Detalle al final, sin filas extra */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-mute min-w-0">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-nowrap">Del {fecha(r.fecha_inicio)} al {fecha(r.fecha_fin)}</span>
        <button
          onClick={async () => {
            try {
              const res = await api.get(`/rentas/${r.id}/ticket/`, { responseType: 'blob' })
              descargarBlob(res.data as Blob, `orden-renta-${r.id}.pdf`)
            } catch { /* sin permiso o red: el interceptor avisa */ }
          }}
          className="text-gold-ink font-semibold hover:opacity-80 transition-opacity whitespace-nowrap shrink-0">↓ Orden</button>
        {r.direccion && <span className="truncate min-w-0 max-w-full">· {r.direccion}</span>}
        {r.estado !== 'cancelada' && total > 0 && (
          <button onClick={() => setAbierto(v => !v)}
            className="ml-auto shrink-0 inline-flex items-center gap-1 text-[12px] font-bold text-gold-ink hover:opacity-80 transition-opacity">
            {abierto ? 'Ocultar' : 'Detalle'}
            <svg className={`w-3 h-3 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
      </div>
      {/* Cancelar la reserva: solo mientras siga siendo reserva a futuro. Una
          vez que llega el día o te entregan la máquina, este botón desaparece. */}
      {r.estado === 'reservada' && r.cancelable && (
        cancelando ? (
          <div className="mt-3 pt-3 border-t border-edge">
            <p className="text-[13px] font-bold text-ink">¿Cancelar tu reserva de {r.equipo || 'este equipo'}?</p>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder="Motivo (opcional)"
              className="mt-2 w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-[13px] text-ink placeholder-mute focus:outline-none focus:border-red-400/60 transition-colors resize-none" />
            <div className="mt-2.5 flex gap-2">
              <button onClick={() => { setCancelando(false); setMotivo('') }} disabled={enviando}
                className="h-9 px-4 rounded-xl border border-edge text-ink text-[13px] font-semibold hover:bg-surface-2 transition-colors">Mejor no</button>
              <button onClick={cancelarReserva} disabled={enviando}
                className="h-9 px-4 rounded-xl bg-red-600 text-white text-[13px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                {enviando ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <button onClick={() => setCancelando(true)}
              className="text-[12px] font-semibold text-red-600 dark:text-red-400 hover:opacity-80 transition-opacity">
              Cancelar reserva
            </button>
          </div>
        )
      )}
      {abierto && r.estado !== 'cancelada' && total > 0 && (
        <div className="mt-2 pt-3 border-t border-edge">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Pagos</span>
            {saldo <= 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-libre/10 text-libre">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                Pagada
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 whitespace-nowrap">
                Debes {money(saldo)}
              </span>
            )}
          </div>
          {(r.pagos?.length || 0) === 0 && <p className="mt-2 text-[12px] text-mute">Aún sin abonos registrados.</p>}
          {(r.pagos?.length || 0) > 0 && (
            <div className="mt-2 space-y-1 text-[12px]">
              {r.pagos!.map((p, j) => (
                <div key={j} className="flex justify-between gap-3">
                  <span className="text-mute">{fechaPago(p.fecha)} · <span className="capitalize">{p.metodo}</span></span>
                  <span className="text-ink font-semibold tabular-nums">{money(Number(p.monto))}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 pt-1 border-t border-edge">
                <span className="text-mute font-semibold">Pagado</span>
                <span className="text-ink font-bold tabular-nums">{money(Number(r.pagado || 0))}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MisRentas() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [cargando, setCargando] = useState(true)
  const [rentas, setRentas] = useState<RentaMia[]>([])

  // Push real por WebSocket; el latido queda solo como red de seguridad.
  const recargar = useRef<() => void>(() => {})
  useClienteEventos((evt) => {
    if (evt.topic === 'rentas' || evt.topic === 'adeudos') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 60_000, () => recargar.current())

  useEffect(() => {
    if (!token) {
      nav('/login?next=/mis-rentas', { replace: true })
      return
    }
    let vivo = true
    const cargar = () => api.get<{ rentas: RentaMia[] }>('/rentas/mias/', { fondo: true } as never)
      .then(r => { if (vivo) setRentas(r.data.rentas || []) })
      .catch(() => {})
      .finally(() => { if (vivo) setCargando(false) })
    cargar()
    recargar.current = cargar
    return () => { vivo = false }
  }, [token, nav])

  // Próximas entregas / recolecciones: la agenda vive AQUÍ, con las rentas.
  const eventos = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const ev: { fecha: Date; titulo: string; sub: string }[] = []
    for (const r of rentas) {
      if (r.estado === 'cancelada' || r.estado === 'finalizada') continue
      const ini = r.fecha_inicio ? new Date(r.fecha_inicio + 'T12:00') : null
      const fin = r.fecha_fin ? new Date(r.fecha_fin + 'T12:00') : null
      if (ini && ini >= hoy) ev.push({ fecha: ini, titulo: `Entrega · ${r.equipo}`, sub: `Inicio de renta ${MOD[r.modalidad] || ''}`.trim() })
      if (fin && fin >= hoy) ev.push({ fecha: fin, titulo: `Recolección · ${r.equipo}`, sub: 'Fin de renta' })
    }
    return ev.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).slice(0, 3)
  }, [rentas])
  const mesDia = (d: Date) => ({ mes: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase(), dia: String(d.getDate()).padStart(2, '0') })

  const activas = rentas.filter(r => ['activa', 'vencida', 'reservada'].includes(r.estado))
  const historial = rentas.filter(r => ['finalizada', 'cancelada'].includes(r.estado))

  return (
    <div className="contenedor pt-28 pb-16">
      <header className="mb-8">
        <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Tus rentas' }]} /></div>
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">Tus rentas</h1>
        <p className="mt-1 text-sm text-mute">Desde cuándo rentas cada equipo y su monto.</p>
      </header>

      {cargando ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-gold-ink" style={{ animationDuration: '0.7s' }} />
        </div>
      ) : rentas.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-14 text-center">
          <PackageOpen className="mx-auto h-10 w-10 text-mute" />
          <p className="mt-4 text-sm font-semibold text-ink">Aún no tienes rentas registradas</p>
          <p className="mt-1 text-sm text-mute">Cuando rentes con nosotros, aquí verás desde cuándo y cuánto.</p>
          <Link to="/equipos" className="btn-acento mt-5 inline-flex h-10 items-center rounded-full px-6 text-sm font-bold">
            Ver maquinaria
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {activas.length > 0 && (
            <section className="space-y-3">
              {eventos.length > 0 && (
                <div className="mb-6 rounded-[20px] border border-edge bg-surface overflow-hidden">
                  <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-[15px] font-bold">Próximas entregas</span>
                    <span className="text-[12.5px] text-mute">Si necesitas mover una fecha, escríbenos y la cambiamos.</span>
                  </div>
                  {eventos.map((e, i) => {
                    const { mes, dia } = mesDia(e.fecha)
                    return (
                      <div key={i} className="px-5 py-3 border-b border-edge/60 last:border-0 flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl border border-edge bg-app grid place-items-center shrink-0">
                          <div className="text-center leading-none">
                            <p className="text-[10px] font-mono tracking-[0.14em] text-mute uppercase">{mes}</p>
                            <p className="text-[16px] font-extrabold mt-0.5">{dia}</p>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold leading-snug line-clamp-1">{e.titulo}</p>
                          <p className="text-[12.5px] text-mute mt-0.5">{e.sub}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Activas</h2>
              {activas.map((r, i) => <Tarjeta key={r.id} r={r} i={i} onCambio={() => recargar.current()} />)}
            </section>
          )}
          {historial.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Historial</h2>
              {historial.map((r, i) => <Tarjeta key={r.id} r={r} i={i} onCambio={() => recargar.current()} />)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
