import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { formatMoney } from '../lib/utils'

type Compra = { id: number; fecha: string; total: string; estado: string; metodo_pago: string; concepto: string }

/** "Mis compras": las ventas ligadas a la cuenta del cliente (por la liga de
 *  vinculación). Espejo de "Mis rentas" / "Mis cotizaciones". */
export default function MisCompras() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [compras, setCompras] = useState<Compra[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-compras'); return }
    api.get<{ compras: Compra[] }>('/ventas/mias/', { fondo: true } as never)
      .then(r => setCompras(r.data.compras || []))
      .catch(() => { /* interceptor avisa */ })
      .finally(() => setCargando(false))
  }, [token])

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-black text-white mb-1">Mis compras</h1>
      <p className="text-white/50 text-sm mb-6">Las compras que has registrado en REMALI.</p>

      {cargando ? (
        <p className="text-white/50 text-sm">Cargando…</p>
      ) : compras.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <p className="text-white/60 text-sm">Aún no tienes compras ligadas a tu cuenta.</p>
          <p className="text-white/40 text-xs mt-2">Cuando compres, pídenos la liga para que aparezca aquí.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {compras.map(c => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{c.concepto}</p>
                <p className="text-white/40 text-xs mt-0.5">
                  {new Date(c.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })} · <span className="capitalize">{c.metodo_pago}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-black ${c.estado === 'cancelada' ? 'text-white/40 line-through' : 'text-[var(--c-gold)]'}`}>${formatMoney(Number(c.total))}</p>
                {c.estado === 'cancelada' && <p className="text-red-400 text-[10px] font-semibold uppercase">Cancelada</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
