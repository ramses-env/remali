import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBag, Loader2, PackageOpen } from 'lucide-react'

import api from '../lib/api'
import Migas from '../components/Migas'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useLatido } from '../lib/latido'

type Compra = {
  id: number
  fecha: string
  total: string
  estado: string
  metodo_pago: string
  concepto: string
}

const money = formatMoney
const fechaHora = (s: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const METODO: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

function Tarjeta({ c, i }: { c: Compra; i: number }) {
  const cancelada = c.estado === 'cancelada'
  return (
    <div style={{ animationDelay: `${i * 40}ms` }} className="stagger-item rounded-2xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-extrabold text-ink">{c.concepto || 'Compra'}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${cancelada ? 'bg-red-500/10 text-red-500' : 'bg-libre/10 text-libre'}`}>
          {cancelada ? 'Cancelada' : 'Completada'}
        </span>
        <span className="text-[13px] text-mute">compra</span>
        <span className={`ml-auto text-sm font-extrabold ${cancelada ? 'text-mute line-through' : 'text-price'}`}>{money(Number(c.total))}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[13px] text-mute">
        <ShoppingBag className="h-4 w-4 shrink-0" />
        <span>{fechaHora(c.fecha)} · {METODO[c.metodo_pago] || c.metodo_pago}</span>
      </div>
    </div>
  )
}

/** "Mis compras" del cliente: apartado APARTE de "Tus rentas" (renta y compra
 *  son cosas distintas). Muestra las ventas ligadas a su cuenta. */
export default function MisCompras() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [cargando, setCargando] = useState(true)
  const [compras, setCompras] = useState<Compra[]>([])

  // Tiempo real: si en el negocio ligan o cancelan una compra suya, la ve al vuelo.
  const recargar = useRef<() => void>(() => {})
  useLatido('/cotizaciones/latido/', 3_000, () => recargar.current())

  useEffect(() => {
    if (!token) {
      nav('/login?next=/mis-compras', { replace: true })
      return
    }
    let vivo = true
    const cargar = () => api.get<{ compras: Compra[] }>('/ventas/mias/', { fondo: true } as never)
      .then(r => { if (vivo) setCompras(r.data.compras || []) })
      .catch(() => {})
      .finally(() => { if (vivo) setCargando(false) })
    cargar()
    recargar.current = cargar
    return () => { vivo = false }
  }, [token, nav])

  const activas = compras.filter(c => c.estado !== 'cancelada')
  const canceladas = compras.filter(c => c.estado === 'cancelada')

  return (
    <div className="contenedor pt-28 pb-16">
      <header className="mb-8">
        <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis compras' }]} /></div>
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">Mis compras</h1>
        <p className="mt-1 text-sm text-mute">El equipo que has comprado en REMALI y su monto.</p>
      </header>

      {cargando ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-gold" style={{ animationDuration: '0.7s' }} />
        </div>
      ) : compras.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-14 text-center">
          <PackageOpen className="mx-auto h-10 w-10 text-mute" />
          <p className="mt-4 text-sm font-semibold text-ink">Aún no tienes compras registradas</p>
          <p className="mt-1 text-sm text-mute">Cuando compres con nosotros, pídenos la liga para que aparezca aquí.</p>
          <Link to="/equipos" className="btn-acento mt-5 inline-flex h-10 items-center rounded-full px-6 text-sm font-bold">
            Ver maquinaria
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {activas.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Compras</h2>
              {activas.map((c, i) => <Tarjeta key={c.id} c={c} i={i} />)}
            </section>
          )}
          {canceladas.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Canceladas</h2>
              {canceladas.map((c, i) => <Tarjeta key={c.id} c={c} i={i} />)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
