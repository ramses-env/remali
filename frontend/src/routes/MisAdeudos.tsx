import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'

import api from '../lib/api'
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
const MOD: Record<string, string> = { dia: 'por día', semana: 'por semana', mes: 'por mes' }

/** El carril del DINERO, aparte del historial: aquí solo viven las rentas que
 *  aún deben algo (la máquina puede haber vuelto ya — eso es el historial).
 *  Se liquida con REMALI por transferencia o efectivo. */
export default function MisAdeudos() {
  const { token } = useAuth()
  const nav = useNavigate()
  const cfg = useConfigPublica()
  const [rentas, setRentas] = useState<RentaMia[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = () => api.get<{ rentas: RentaMia[] }>('/rentas/mias/', { fondo: true } as never)
    .then(r => setRentas((r.data?.rentas || []).filter(x => x.estado !== 'cancelada' && Number(x.saldo || 0) > 0)))
    .catch(() => {})
    .finally(() => setCargando(false))
  const recargar = useRef(cargar)
  recargar.current = cargar

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-adeudos', { replace: true }); return }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
  // Si REMALI registra un abono, el saldo baja aquí en segundos.
  useLatido('/cotizaciones/latido/', 3_000, () => recargar.current())

  const totalDeuda = rentas.reduce((a, r) => a + Number(r.saldo || 0), 0)
  const wa = (cfg.whatsapp_principal || '').replace(/\D/g, '')
  const waHref = (r?: RentaMia) => {
    if (!wa) return undefined
    const msg = r
      ? `Hola, quiero liquidar el saldo de ${money(Number(r.saldo || 0))} de mi renta del ${r.equipo}.`
      : `Hola, quiero liquidar mi adeudo de ${money(totalDeuda)}.`
    return `https://wa.me/${wa.length === 10 ? '52' + wa : wa}?text=${encodeURIComponent(msg)}`
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-28 pb-16">
      <div className="mb-5"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis adeudos' }]} /></div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-ink">Mis adeudos</h1>
          <p className="mt-1 text-sm text-mute">Saldos pendientes de tus rentas. Se liquidan por transferencia o efectivo con REMALI.</p>
        </div>
        {totalDeuda > 0 && (
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute">Debes en total</p>
            <p className="text-[26px] font-black tracking-tight text-red-600 dark:text-red-400 tabular-nums">{money(totalDeuda)}</p>
          </div>
        )}
      </header>

      {cargando ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-gold" /></div>
      ) : rentas.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-edge bg-surface px-6 py-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-libre" />
          <p className="mt-3 text-[16px] font-bold text-ink">No debes nada</p>
          <p className="mt-1 text-sm text-mute">Todas tus rentas están al corriente. Aquí aparecería cualquier saldo pendiente.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {rentas.map(r => {
            const saldo = Number(r.saldo || 0)
            const pagado = Number(r.pagado || 0)
            return (
              <div key={r.id} className="rounded-2xl border border-red-500/25 bg-surface overflow-hidden">
                <div className="px-5 sm:px-6 py-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-[15px] font-extrabold text-ink">{r.equipo}</span>
                  <span className="text-[12.5px] text-mute">renta {MOD[r.modalidad] || r.modalidad} · del {fecha(r.fecha_inicio)} al {fecha(r.fecha_fin)}</span>
                  {r.estado === 'finalizada' && (
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-2 text-mute">Equipo devuelto</span>
                  )}
                  <span className="ml-auto text-[17px] font-black text-red-600 dark:text-red-400 tabular-nums">Debes {money(saldo)}</span>
                </div>
                <div className="px-5 sm:px-6 py-3.5 border-t border-edge bg-surface-2/50 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                  <span className="text-mute">Total <b className="text-ink">{money(Number(r.total || 0))}</b></span>
                  <span className="text-mute">Pagado <b className="text-ink">{money(pagado)}</b></span>
                  {(r.pagos?.length || 0) > 0 && <span className="text-mute">{r.pagos!.length} abono{r.pagos!.length === 1 ? '' : 's'}</span>}
                  {waHref(r) && (
                    <a href={waHref(r)} target="_blank" rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#25D366] text-white text-[12.5px] font-bold hover:opacity-90 transition-opacity">
                      Liquidar por WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )
          })}
          <p className="text-[12px] text-mute text-center pt-2">
            ¿Ya pagaste? En cuanto REMALI registre tu abono, el saldo se actualiza aquí solo.
          </p>
        </div>
      )}
    </div>
  )
}
