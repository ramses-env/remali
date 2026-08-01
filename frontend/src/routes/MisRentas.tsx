import { useEffect, useRef, useState } from 'react'
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

function Tarjeta({ r, i }: { r: RentaMia; i: number }) {
  return (
    <div style={{ animationDelay: `${i * 40}ms` }} className="stagger-item rounded-2xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-extrabold text-ink">{r.equipo || 'Equipo'}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${estiloEstado(r.estado)}`}>{r.estado_label}</span>
        <span className="text-[13px] text-mute">renta {MOD[r.modalidad] || r.modalidad}</span>
        <span className="ml-auto text-sm font-extrabold text-price">{money(Number(r.total))}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[13px] text-mute">
        <CalendarClock className="h-4 w-4 shrink-0" />
        <span>Del {fecha(r.fecha_inicio)} al {fecha(r.fecha_fin)}</span>
        <button
          onClick={async () => {
            try {
              const res = await api.get(`/rentas/${r.id}/ticket/`, { responseType: 'blob' })
              descargarBlob(res.data as Blob, `orden-renta-${r.id}.pdf`)
            } catch { /* sin permiso o red: el interceptor avisa */ }
          }}
          className="text-gold font-semibold hover:opacity-80 transition-opacity">↓ Orden (PDF)</button>
      </div>
      {r.direccion && <p className="mt-1.5 text-[12.5px] text-mute leading-relaxed">{r.direccion}</p>}

      {/* Sus pagos: cuánto lleva abonado y cuánto falta, sin llamar a preguntar. */}
      {r.estado !== 'cancelada' && Number(r.total) > 0 && (
        <div className="mt-3 pt-3 border-t border-edge">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-mute">Pagos</span>
            {Number(r.saldo || 0) <= 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-libre/10 text-libre">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                Pagada
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 whitespace-nowrap">
                Saldo pendiente {money(Number(r.saldo))}
              </span>
            )}
          </div>
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

  // Tiempo real: si en el negocio le registran o cierran una renta, la ve llegar.
  const recargar = useRef<() => void>(() => {})
  useLatido('/cotizaciones/latido/', 3_000, () => recargar.current())

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

  const activas = rentas.filter(r => ['activa', 'vencida', 'reservada'].includes(r.estado))
  const historial = rentas.filter(r => ['finalizada', 'cancelada'].includes(r.estado))

  return (
    <div className="mx-auto max-w-4xl px-6 pt-28 pb-16">
      <header className="mb-8">
        <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Tus rentas' }]} /></div>
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">Tus rentas</h1>
        <p className="mt-1 text-sm text-mute">Desde cuándo rentas cada equipo y su monto.</p>
      </header>

      {cargando ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-gold" style={{ animationDuration: '0.7s' }} />
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
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Activas</h2>
              {activas.map((r, i) => <Tarjeta key={r.id} r={r} i={i} />)}
            </section>
          )}
          {historial.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Historial</h2>
              {historial.map((r, i) => <Tarjeta key={r.id} r={r} i={i} />)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
