import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wrench, Loader2, PackageOpen, Download } from 'lucide-react'

import api from '../lib/api'
import { useClienteEventos } from '../lib/clienteEventos'
import Migas from '../components/Migas'
import { descargarBlob } from '../lib/descargar'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useLatido } from '../lib/latido'
import { anotarFallo } from '../lib/fallo'

type Reparacion = {
  id: number
  folio: string
  estado: string
  estado_label: string
  equipo: string
  diagnostico?: string
  trabajo_realizado?: string
  total: string
  fecha_recibida: string
  fecha_entrega?: string | null
  mano_obra_definida?: boolean
}

const money = formatMoney
const fecha = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const PILL: Record<string, string> = {
  recibida: 'bg-surface-2 text-mute',
  proceso: 'bg-gold-soft text-gold-ink',
  terminada: 'bg-blue-500/10 text-blue-500',
  entregada: 'bg-emerald-500/10 text-emerald-500',
}

function Tarjeta({ r, i }: { r: Reparacion; i: number }) {
  const [bajando, setBajando] = useState(false)
  // El cliente baja su orden solo cuando el equipo ya está listo/entregado Y
  // administración puso la mano de obra: sin ese cargo la orden iría incompleta.
  const listo = r.estado === 'entregada' || r.estado === 'terminada'
  const puedeDescargar = listo && r.mano_obra_definida

  const descargar = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()   // el botón vive dentro del Link
    if (bajando) return
    setBajando(true)
    try {
      const res = await api.get(`/reparaciones/mias/${r.id}/pdf/`, { responseType: 'blob' })
      descargarBlob(res.data as Blob, `${r.folio}.pdf`)
    } catch { /* si falla, no rompe la tarjeta */ }
    finally { setBajando(false) }
  }

  return (
    <Link to={`/mis-reparaciones/${r.folio}`} style={{ animationDelay: `${i * 40}ms` }} className="stagger-item block rounded-2xl border border-edge bg-surface p-5 hover:border-gold/40 transition-colors">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[13px] font-bold text-ink">{r.folio}</span>
        <span className="text-sm font-extrabold text-ink">{r.equipo}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${PILL[r.estado] || PILL.recibida}`}>
          {r.estado_label}
        </span>
        <span className="ml-auto text-sm font-extrabold text-price">{money(Number(r.total))}</span>
      </div>
      {(r.trabajo_realizado || r.diagnostico) && (
        <p className="mt-2.5 text-[13px] text-mute line-clamp-2">{r.trabajo_realizado || r.diagnostico}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-mute">
        <Wrench className="h-4 w-4 shrink-0" />
        <span>Recibido {fecha(r.fecha_recibida)}{r.estado === 'entregada' && r.fecha_entrega ? ` · Entregado ${fecha(r.fecha_entrega)}` : ''}</span>
        {puedeDescargar ? (
          <button
            onClick={descargar}
            disabled={bajando}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3.5 py-1.5 text-[12.5px] font-bold text-ink hover:bg-surface-2 hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            {bajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descargar orden
          </button>
        ) : listo ? (
          <span className="ml-auto text-[12px] text-mute">Orden en preparación</span>
        ) : null}
      </div>
    </Link>
  )
}

/** "Mis reparaciones" del cliente: las órdenes de servicio de SU equipo,
 *  ligadas a su cuenta por la liga de vinculación. Solo lectura. */
export default function MisReparaciones() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [cargando, setCargando] = useState(true)
  const [reparaciones, setReparaciones] = useState<Reparacion[]>([])

  // Push real por WebSocket; el latido queda solo como red de seguridad.
  const recargar = useRef<() => void>(() => {})
  useClienteEventos((evt) => {
    if (evt.topic === 'reparaciones') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 60_000, () => recargar.current())

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-reparaciones', { replace: true }); return }
    let vivo = true
    const cargar = () => api.get<{ reparaciones: Reparacion[] }>('/reparaciones/mias/', { fondo: true } as never)
      .then(r => { if (vivo) setReparaciones(r.data.reparaciones || []) })
      .catch(anotarFallo)
      .finally(() => { if (vivo) setCargando(false) })
    cargar()
    recargar.current = cargar
    return () => { vivo = false }
  }, [token, nav])

  const enTaller = reparaciones.filter(r => r.estado !== 'entregada')
  const entregadas = reparaciones.filter(r => r.estado === 'entregada')

  return (
    <div className="contenedor pt-28 pb-16">
      <header className="mb-8">
        <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis reparaciones' }]} /></div>
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">Mis reparaciones</h1>
        <p className="mt-1 text-sm text-mute">El equipo que dejaste a servicio y en qué va cada orden.</p>
      </header>

      {cargando ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-gold-ink" style={{ animationDuration: '0.7s' }} /></div>
      ) : reparaciones.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-14 text-center">
          <PackageOpen className="mx-auto h-10 w-10 text-mute" />
          <p className="mt-4 text-sm font-semibold text-ink">Aún no tienes reparaciones registradas</p>
          <p className="mt-1 text-sm text-mute">Cuando dejes un equipo a servicio, pídenos la liga para seguir el avance aquí.</p>
          <Link to="/equipos" className="btn-acento mt-5 inline-flex h-10 items-center rounded-full px-6 text-sm font-bold">Ver maquinaria</Link>
        </div>
      ) : (
        <div className="space-y-8">
          {enTaller.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">En taller</h2>
              {enTaller.map((r, i) => <Tarjeta key={r.id} r={r} i={i} />)}
            </section>
          )}
          {entregadas.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Entregadas</h2>
              {entregadas.map((r, i) => <Tarjeta key={r.id} r={r} i={i} />)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
