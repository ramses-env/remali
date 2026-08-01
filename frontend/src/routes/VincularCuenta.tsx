import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { formatMoney } from '../lib/utils'

type Info = {
  tipo: string
  id: number
  total: string
  concepto?: string
  cliente?: string
  ya_ligada?: boolean
  fecha?: string
  fecha_inicio?: string
  fecha_fin?: string
}

/** Página pública de la "liga de vinculación": el cliente abre el enlace que le
 *  mandó el admin; si no tiene sesión se le pide iniciar, y al confirmar la
 *  venta/renta queda ligada a SU cuenta (la liga es de un solo uso). */
export default function VincularCuenta({ tipo }: { tipo: 'venta' | 'renta' }) {
  const { token } = useParams()
  const nav = useNavigate()
  const { token: sesion } = useAuth()
  const ruta = `/vincular/${tipo}/${token}`
  const titulo = tipo === 'renta' ? 'renta' : 'compra'

  const [info, setInfo] = useState<Info | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [vinculando, setVinculando] = useState(false)

  useEffect(() => {
    // Sin sesión: al login y de regreso aquí (Login respeta ?next).
    if (!sesion) {
      nav(`/login?next=${encodeURIComponent(ruta)}`, { replace: true })
      return
    }
    let vivo = true
    api.get<Info>(`/vinculo/${tipo}/${token}/`, { fondo: true } as never)
      .then(r => { if (vivo) setInfo(r.data) })
      .catch(e => { if (vivo) setError(e?.response?.data?.detalle || 'No se pudo abrir el enlace.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [tipo, token, sesion])

  const vincular = async () => {
    setVinculando(true)
    setError('')
    try {
      await api.post(`/vinculo/${tipo}/${token}/`, {}, { fondo: true } as never)
      setOk(true)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo vincular.')
    } finally {
      setVinculando(false)
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        {cargando ? (
          <p className="text-white/60 text-sm">Cargando…</p>
        ) : ok ? (
          <>
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-4">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-xl font-bold text-white">¡Listo!</h1>
            <p className="text-white/60 text-sm mt-2">Tu {titulo} quedó ligada a tu cuenta.</p>
            <button onClick={() => nav(tipo === 'renta' ? '/mis-rentas' : '/mis-cotizaciones')} className="mt-6 w-full py-3 rounded-full bg-[var(--c-gold)] text-black font-bold text-sm">
              Ver mi historial
            </button>
          </>
        ) : error ? (
          <>
            <h1 className="text-xl font-bold text-white">Enlace no disponible</h1>
            <p className="text-white/60 text-sm mt-2">{error}</p>
            <button onClick={() => nav('/')} className="mt-6 w-full py-3 rounded-full border border-white/15 text-white font-semibold text-sm">Ir al inicio</button>
          </>
        ) : info ? (
          <>
            <h1 className="text-xl font-bold text-white">Vincular {titulo} a tu cuenta</h1>
            <p className="text-white/60 text-sm mt-2">Confirma para guardar esta {titulo} en tu historial.</p>
            <div className="mt-5 rounded-xl bg-white/[0.04] border border-white/10 p-4 text-left text-sm space-y-2">
              <div className="flex justify-between gap-4"><span className="text-white/50">Concepto</span><span className="text-white font-medium text-right">{info.concepto || '—'}</span></div>
              <div className="flex justify-between gap-4"><span className="text-white/50">Total</span><span className="text-white font-bold">${formatMoney(Number(info.total))}</span></div>
              {info.fecha_fin && <div className="flex justify-between gap-4"><span className="text-white/50">Vence</span><span className="text-white">{new Date(info.fecha_fin).toLocaleDateString('es-MX')}</span></div>}
            </div>
            {info.ya_ligada && <p className="text-amber-400 text-xs mt-3">Esta {titulo} ya estaba ligada a una cuenta; al confirmar pasará a la tuya.</p>}
            <button onClick={vincular} disabled={vinculando} className="mt-6 w-full py-3 rounded-full bg-[var(--c-gold)] text-black font-bold text-sm disabled:opacity-50">
              {vinculando ? 'Vinculando…' : 'Vincular a mi cuenta'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
