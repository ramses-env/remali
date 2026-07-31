import { useEffect, useState } from 'react'
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
}

const money = formatMoney
const fecha = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const MOD: Record<string, string> = { dia: 'por día', semana: 'por semana', mes: 'por mes' }

function estiloEstado(estado: string) {
  if (estado === 'activa') return 'bg-gold/15 text-gold'
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
    </div>
  )
}

export default function MisRentas() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [cargando, setCargando] = useState(true)
  const [rentas, setRentas] = useState<RentaMia[]>([])

  useEffect(() => {
    if (!token) {
      nav('/login?next=/mis-rentas', { replace: true })
      return
    }
    let vivo = true
    api.get<{ rentas: RentaMia[] }>('/rentas/mias/')
      .then(r => vivo && setRentas(r.data.rentas || []))
      .catch(() => {})
      .finally(() => vivo && setCargando(false))
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
