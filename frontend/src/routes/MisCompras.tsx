import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBag, Loader2, PackageOpen } from 'lucide-react'

import api from '../lib/api'
import { useClienteEventos } from '../lib/clienteEventos'
import Migas from '../components/Migas'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useLatido } from '../lib/latido'

type Compra = {
  id: number
  fecha: string
  total: string
  pagado?: string
  saldo?: string
  pagos?: { fecha: string; monto: string; metodo: string }[]
  sobre_pedido?: boolean
  pedido_fase?: string
  fecha_estimada_entrega?: string | null
  estado: string
  metodo_pago: string
  concepto: string
}

const money = formatMoney
const fechaHora = (s: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
// Los abonos llegan como día suelto (AAAA-MM-DD) o ISO completo; ambos se ven bien.
const fechaPago = (s: string) =>
  s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—'
const METODO: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

function Tarjeta({ c, i }: { c: Compra; i: number }) {
  const cancelada = c.estado === 'cancelada'
  const apartada = c.estado === 'apartada'
  const saldo = Number(c.saldo || 0)
  const abonos = c.pagos?.length || 0
  const [abierto, setAbierto] = useState(false)
  // Seguimiento SOBRE PEDIDO: confirmado → en camino → en sucursal → entregado.
  const seguimiento = apartada && c.sobre_pedido
  const fase = c.pedido_fase || 'confirmado'
  const faseIdx = ['confirmado', 'en_camino', 'en_sucursal'].indexOf(fase)
  const eta = c.fecha_estimada_entrega
    ? new Date(c.fecha_estimada_entrega + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
    : null
  const msgFase = fase === 'en_sucursal'
    ? `¡Tu máquina llegó a sucursal! Pásala a recoger${saldo > 0 ? ' (liquida el saldo pendiente)' : ''}.`
    : fase === 'en_camino'
      ? `Tu máquina ya viene en camino desde el proveedor.${eta ? ` Llega aprox. el ${eta}.` : ''}`
      : `Pedido confirmado. La mandamos a pedir con el proveedor.${eta ? ` Entrega estimada: ${eta}.` : ''}`
  return (
    <div style={{ animationDelay: `${i * 40}ms` }} className="stagger-item rounded-2xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-extrabold text-ink">{c.concepto || 'Compra'}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${cancelada ? 'bg-red-500/10 text-red-500' : apartada ? 'bg-gold/15 text-gold-ink' : 'bg-libre/10 text-libre'}`}>
          {cancelada ? 'Cancelada' : apartada ? (c.sobre_pedido ? 'Sobre pedido' : 'Apartada') : 'Completada'}
        </span>
        <span className="text-[13px] text-mute">compra</span>
        <span className={`ml-auto text-sm font-extrabold ${cancelada ? 'text-mute line-through' : 'text-price'}`}>{money(Number(c.total))}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[13px] text-mute">
        <ShoppingBag className="h-4 w-4 shrink-0" />
        <span>{fechaHora(c.fecha)} · {METODO[c.metodo_pago] || c.metodo_pago}</span>
      </div>
      {apartada && (saldo > 0 || abonos > 0) && (
        <div className="mt-2.5 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
            <span className="text-mute">Pagado <b className="text-ink">{money(Number(c.pagado || 0))}</b> de {money(Number(c.total))}</span>
            {saldo > 0
              ? <Link to="/mis-adeudos" className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 whitespace-nowrap hover:bg-red-500/20 transition-colors">Debes {money(saldo)} →</Link>
              : <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-libre/10 text-libre">Liquidado</span>}
          </div>
          {abonos > 0 && (
            <>
              <button onClick={() => setAbierto(v => !v)}
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-gold-ink hover:opacity-80 transition-opacity">
                {abierto ? 'Ocultar pagos' : `Ver mis pagos (${abonos})`}
                <svg className={`w-3 h-3 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {abierto && (
                <div className="mt-2 space-y-1 border-t border-gold/20 pt-2 text-[12px]">
                  {c.pagos!.map((p, j) => (
                    <div key={j} className="flex justify-between gap-3">
                      <span className="text-mute">{fechaPago(p.fecha)} · <span className="capitalize">{METODO[p.metodo] || p.metodo}</span></span>
                      <span className="text-ink font-semibold tabular-nums">{money(Number(p.monto))}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {seguimiento && (
        <div className="mt-3 rounded-xl border border-gold/25 bg-gold/[0.05] p-3.5">
          <div className="flex items-center gap-1 text-[10.5px] font-bold">
            {([['confirmado', 'Confirmado'], ['en_camino', 'En camino'], ['en_sucursal', 'En sucursal'], ['entregado', 'Entregado']] as [string, string][]).map(([f, lbl], idx) => (
              <span key={f} className="flex items-center gap-1 min-w-0">
                {idx > 0 && <span className={`h-px w-3 shrink-0 ${idx <= faseIdx ? 'bg-gold' : 'bg-edge'}`} />}
                <span className={`px-2 py-0.5 rounded-full whitespace-nowrap ${idx <= faseIdx ? 'bg-gold/20 text-gold-ink' : 'bg-surface-2 text-mute'}`}>{lbl}</span>
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-[12.5px] text-mute leading-snug">{msgFase}</p>
        </div>
      )}
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

  // Push real por WebSocket; el latido queda solo como red de seguridad.
  const recargar = useRef<() => void>(() => {})
  useClienteEventos((evt) => {
    if (evt.topic === 'compras') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 60_000, () => recargar.current())

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
          <Loader2 className="h-7 w-7 animate-spin text-gold-ink" style={{ animationDuration: '0.7s' }} />
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
