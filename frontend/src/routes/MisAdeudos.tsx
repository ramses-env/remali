import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'

import api from '../lib/api'
import { useClienteEventos } from '../lib/clienteEventos'
import Migas from '../components/Migas'
import { useLatido } from '../lib/latido'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useConfigPublica } from '../lib/configPublica'

type RentaMia = {
  id: number
  equipo: string
  modalidad: string
  estado: string
  fecha_inicio: string
  fecha_fin: string
  total: string
  pagos?: { fecha: string; monto: string; metodo: string }[]
  pagado?: string
  saldo?: string
}
type CompraMia = {
  id: number
  concepto: string
  total: string
  pagado?: string
  saldo?: string
  estado: string
  sobre_pedido?: boolean
  pagos?: { fecha: string; monto: string; metodo: string }[]
}

/* Una deuda ya normalizada: renta y apartado son la misma cosa a nivel dinero
   (una cuenta por cobrar), así que aquí viven juntas, solo etiquetadas. */
type Deuda = {
  key: string
  tipo: 'renta' | 'apartado'
  titulo: string
  sub: string
  total: number
  pagado: number
  saldo: number
  abonos: number
  waMsg: string
}

const money = formatMoney
const fecha = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const MOD: Record<string, string> = { dia: 'por día', semana: 'por semana', mes: 'por mes' }

const TIPO: Record<Deuda['tipo'], { label: string; cls: string }> = {
  renta: { label: 'Renta', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  apartado: { label: 'Apartado', cls: 'bg-gold/15 text-gold' },
}

/** El carril del DINERO, aparte del historial: aquí vive TODO lo que el cliente
 *  aún debe —rentas Y apartados—, junto y etiquetado. Se liquida con REMALI por
 *  transferencia o efectivo. */
export default function MisAdeudos() {
  const { token } = useAuth()
  const nav = useNavigate()
  const cfg = useConfigPublica()
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = () => Promise.all([
    api.get<{ rentas: RentaMia[] }>('/rentas/mias/', { fondo: true } as never).then(r => r.data?.rentas || []).catch(() => [] as RentaMia[]),
    api.get<{ compras: CompraMia[] }>('/ventas/mias/', { fondo: true } as never).then(r => r.data?.compras || []).catch(() => [] as CompraMia[]),
  ]).then(([rentas, compras]) => {
    const dr: Deuda[] = rentas
      .filter(x => x.estado !== 'cancelada' && Number(x.saldo || 0) > 0)
      .map(r => ({
        key: `r-${r.id}`, tipo: 'renta', titulo: r.equipo,
        sub: `renta ${MOD[r.modalidad] || r.modalidad} · del ${fecha(r.fecha_inicio)} al ${fecha(r.fecha_fin)}`,
        total: Number(r.total || 0), pagado: Number(r.pagado || 0), saldo: Number(r.saldo || 0),
        abonos: r.pagos?.length || 0,
        waMsg: `Hola, quiero liquidar el saldo de ${money(Number(r.saldo || 0))} de mi renta del ${r.equipo}.`,
      }))
    const da: Deuda[] = compras
      .filter(x => x.estado === 'apartada' && Number(x.saldo || 0) > 0)
      .map(c => ({
        key: `v-${c.id}`, tipo: 'apartado', titulo: c.concepto || 'Apartado',
        sub: c.sobre_pedido ? 'apartado · sobre pedido' : 'apartado con anticipo',
        total: Number(c.total || 0), pagado: Number(c.pagado || 0), saldo: Number(c.saldo || 0),
        abonos: c.pagos?.length || 0,
        waMsg: `Hola, quiero liquidar el saldo de ${money(Number(c.saldo || 0))} de mi apartado (${c.concepto || 'equipo'}).`,
      }))
    setDeudas([...dr, ...da].sort((a, b) => b.saldo - a.saldo))
  }).finally(() => setCargando(false))
  const recargar = useRef(cargar)
  recargar.current = cargar

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-adeudos', { replace: true }); return }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
  // Push real por WebSocket; el latido queda solo como red de seguridad.
  useClienteEventos((evt) => {
    if (evt.topic === 'adeudos' || evt.topic === 'rentas' || evt.topic === 'compras') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 60_000, () => recargar.current())

  const totalDeuda = deudas.reduce((a, d) => a + d.saldo, 0)
  const wa = (cfg.whatsapp_principal || '').replace(/\D/g, '')
  const waHref = (msg: string) => {
    if (!wa) return undefined
    return `https://wa.me/${wa.length === 10 ? '52' + wa : wa}?text=${encodeURIComponent(msg)}`
  }
  const waTotal = waHref(`Hola, quiero liquidar mi adeudo de ${money(totalDeuda)}.`)

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-28 pb-16">
      <div className="mb-5"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis adeudos' }]} /></div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-ink">Mis adeudos</h1>
          <p className="mt-1 text-sm text-mute">Todo lo que debes a REMALI —rentas y apartados—. Se liquida por transferencia o efectivo.</p>
        </div>
        {totalDeuda > 0 && (
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute">Debes en total</p>
            <p className="text-[26px] font-black tracking-tight text-red-600 dark:text-red-400 tabular-nums">{money(totalDeuda)}</p>
            {waTotal && deudas.length > 1 && (
              <a href={waTotal} target="_blank" rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[#25D366] text-white text-[12px] font-bold hover:opacity-90 transition-opacity">
                Liquidar todo por WhatsApp
              </a>
            )}
          </div>
        )}
      </header>

      {cargando ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-gold" /></div>
      ) : deudas.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-edge bg-surface px-6 py-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-libre" />
          <p className="mt-3 text-[16px] font-bold text-ink">No debes nada</p>
          <p className="mt-1 text-sm text-mute">Estás al corriente. Aquí aparecería cualquier saldo pendiente de tus rentas o apartados.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {deudas.map(d => {
            const tipo = TIPO[d.tipo]
            return (
              <div key={d.key} className="rounded-2xl border border-red-500/25 bg-surface overflow-hidden">
                <div className="px-5 sm:px-6 py-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-[15px] font-extrabold text-ink">{d.titulo}</span>
                  <span className={`text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${tipo.cls}`}>{tipo.label}</span>
                  <span className="text-[12.5px] text-mute">{d.sub}</span>
                  <span className="ml-auto text-[17px] font-black text-red-600 dark:text-red-400 tabular-nums">Debes {money(d.saldo)}</span>
                </div>
                <div className="px-5 sm:px-6 py-3.5 border-t border-edge bg-surface-2/50 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                  <span className="text-mute">Total <b className="text-ink">{money(d.total)}</b></span>
                  <span className="text-mute">Pagado <b className="text-ink">{money(d.pagado)}</b></span>
                  {d.abonos > 0 && <span className="text-mute">{d.abonos} abono{d.abonos === 1 ? '' : 's'}</span>}
                  {waHref(d.waMsg) && (
                    <a href={waHref(d.waMsg)} target="_blank" rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#25D366] text-white text-[12.5px] font-bold hover:opacity-90 transition-opacity">
                      Liquidar por WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )
          })}
          {waTotal && deudas.length > 1 && (
            <p className="text-[12px] text-mute text-center pt-2">
              ¿Ya pagaste? En cuanto REMALI registre tu abono, el saldo se actualiza aquí solo.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
