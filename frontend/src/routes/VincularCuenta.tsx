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
export default function VincularCuenta({ tipo }: { tipo: 'venta' | 'renta' | 'cotizacion' }) {
  const { token } = useParams()
  const nav = useNavigate()
  const { token: sesion } = useAuth()
  const ruta = `/vincular/${tipo}/${token}`
  const titulo = tipo === 'renta' ? 'renta' : tipo === 'cotizacion' ? 'cotización' : 'compra'

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
      <div className="w-full max-w-md rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8 text-center">
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Abriendo tu enlace…</p>
          </div>
        ) : ok ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">¡Listo!</h1>
            <p className="text-mute text-sm mt-2">Tu {titulo} ya vive en tu cuenta.</p>
            <button onClick={() => nav(tipo === 'renta' ? '/mis-rentas' : '/mis-cotizaciones')}
              className="mt-7 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity">
              Ver mi historial
            </button>
          </>
        ) : error ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.6" className="fill-current" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Enlace no disponible</h1>
            <p className="text-mute text-sm mt-2">{error}</p>
            <button onClick={() => nav('/')} className="mt-7 w-full py-3.5 rounded-full border border-edge text-ink font-semibold text-sm hover:bg-surface-2 transition-colors">
              Ir al inicio
            </button>
          </>
        ) : info ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold flex items-center justify-center mb-5">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink leading-tight">Vincular {titulo} a tu cuenta</h1>
            <p className="text-mute text-sm mt-2">Confírmalo y quedará guardada en tu historial de REMALI.</p>

            <div className="mt-6 rounded-2xl bg-surface-2 border border-edge p-5 text-left text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-mute">Concepto</span>
                <span className="text-ink font-semibold text-right">{info.concepto || '—'}</span>
              </div>
              {info.cliente && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">A nombre de</span>
                  <span className="text-ink font-semibold text-right">{info.cliente}</span>
                </div>
              )}
              {info.fecha && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">Fecha</span>
                  <span className="text-ink font-semibold">{new Date(info.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              )}
              {info.fecha_fin && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">Vence</span>
                  <span className="text-ink font-semibold">{new Date(info.fecha_fin).toLocaleDateString('es-MX')}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-4 pt-4">
                <span className="text-[15px] font-bold text-ink">Total</span>
                <span className="text-[24px] font-black tracking-tight text-ink">{formatMoney(Number(info.total))}</span>
              </div>
            </div>

            {info.ya_ligada && (
              <p className="text-amber-600 dark:text-amber-400 text-xs mt-3">Esta {titulo} ya estaba en una cuenta; al confirmar pasará a la tuya.</p>
            )}
            <button onClick={vincular} disabled={vinculando}
              className="mt-6 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
              {vinculando ? 'Vinculando…' : 'Vincular a mi cuenta'}
            </button>
            <p className="text-[11.5px] text-mute mt-3">Se guardará en la cuenta con la que iniciaste sesión.</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
