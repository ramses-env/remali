import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import { formatMoney } from '../lib/utils'

type Item = { descripcion: string; cantidad: number; precio: string; modalidad: string }
type Info = {
  folio: string
  cliente: string
  empresa?: string
  obra?: string
  tipo: string
  items: Item[]
  subtotal: string
  descuento: string
  total: string
  vence_el?: string | null
  autorizada: boolean
  rechazada?: boolean
  autorizada_por?: string
}

const MODALIDAD: Record<string, string> = { venta: 'Venta', dia: 'Renta por día', semana: 'Renta por semana', mes: 'Renta por mes' }

/** Página PÚBLICA de quien autoriza (el jefe del cliente): sin cuenta, sin
 *  login. Ve la propuesta, escribe su nombre y al autorizar la cotización
 *  llega sola a REMALI — el empleado y el admin se enteran, nadie mueve nada. */
export default function AutorizarCotizacion() {
  const { token } = useParams()
  const [info, setInfo] = useState<Info | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const [rechazando, setRechazando] = useState(false)   // muestra el motivo
  const [motivo, setMotivo] = useState('')
  const [rechazoListo, setRechazoListo] = useState(false)

  useEffect(() => {
    let vivo = true
    api.get<Info>(`/autorizacion/${token}/`, { fondo: true } as never)
      .then(r => { if (vivo) setInfo(r.data) })
      .catch(e => { if (vivo) setError(e?.response?.data?.detalle || 'No se pudo abrir el enlace.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [token])

  const decidir = async (accion: 'autorizar' | 'rechazar') => {
    if (!nombre.trim()) { setError('Escribe tu nombre para continuar.'); return }
    setEnviando(true)
    setError('')
    try {
      await api.post(`/autorizacion/${token}/`, { nombre: nombre.trim(), accion, motivo: motivo.trim() }, { fondo: true } as never)
      if (accion === 'rechazar') setRechazoListo(true)
      else setListo(true)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo enviar tu decisión.')
    } finally {
      setEnviando(false)
    }
  }

  const yaAutorizada = listo || !!info?.autorizada
  const yaRechazada = rechazoListo || !!info?.rechazada

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8">
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Abriendo la propuesta…</p>
          </div>
        ) : error && !info ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.6" className="fill-current" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Enlace no disponible</h1>
            <p className="text-mute text-sm mt-2">{error}</p>
          </div>
        ) : yaRechazada ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Cotización rechazada</h1>
            <p className="text-mute text-sm mt-2 max-w-[38ch] mx-auto">
              Le avisamos a {info?.cliente ? info.cliente.split(' ')[0] : 'quien la armó'} para que prepare otra versión. REMALI no recibió nada.
            </p>
            {info?.autorizada_por && !rechazoListo && (
              <p className="text-[12.5px] text-mute mt-2">Rechazada por {info.autorizada_por}.</p>
            )}
          </div>
        ) : yaAutorizada ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Cotización autorizada</h1>
            <p className="text-mute text-sm mt-2 max-w-[38ch] mx-auto">
              {info?.folio ? <>La <b className="text-ink">{info.folio}</b> ya está en manos de REMALI.</> : 'Ya está en manos de REMALI.'}{' '}
              El equipo se pondrá en contacto para coordinar todo.
            </p>
            {info?.autorizada_por && !listo && (
              <p className="text-[12.5px] text-mute mt-2">Autorizada por {info.autorizada_por}.</p>
            )}
          </div>
        ) : info ? (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold flex items-center justify-center mb-5">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
              </div>
              <h1 className="text-[22px] font-black text-ink leading-tight">Solicitud de autorización</h1>
              <p className="text-mute text-sm mt-2">
                <b className="text-ink">{info.cliente || 'Tu equipo'}</b>
                {info.empresa ? <> ({info.empresa})</> : null} te pide autorizar esta cotización de maquinaria.
              </p>
            </div>

            {/* Partidas */}
            <div className="mt-6 rounded-2xl bg-surface-2 border border-edge p-5 text-sm">
              {info.items.map((it, i) => (
                <div key={i} className={`flex items-start justify-between gap-4 ${i > 0 ? 'mt-3 pt-3 border-t border-edge' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-ink font-semibold leading-snug">{it.descripcion}</p>
                    <p className="text-[12px] text-mute mt-0.5">{MODALIDAD[it.modalidad] || it.modalidad} · {it.cantidad} × {formatMoney(Number(it.precio))}</p>
                  </div>
                  <span className="text-ink font-bold shrink-0">{formatMoney(Number(it.precio) * it.cantidad)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-4 pt-4">
                <span className="text-[15px] font-bold text-ink">Total</span>
                <span className="text-[24px] font-black tracking-tight text-ink">{formatMoney(Number(info.total))}</span>
              </div>
              {Number(info.descuento) > 0 && (
                <p className="text-[12px] text-emerald-600 dark:text-emerald-400 mt-1 text-right">Incluye descuento de {formatMoney(Number(info.descuento))}</p>
              )}
              {info.obra && <p className="text-[12px] text-mute mt-3">Obra: {info.obra}</p>}
              {info.vence_el && <p className="text-[12px] text-mute mt-1">Precios vigentes hasta el {new Date(info.vence_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.</p>}
            </div>

            {/* Quién autoriza */}
            <div className="mt-6">
              <label className="block text-[12.5px] font-semibold text-mute mb-1.5">Tu nombre (quien autoriza)</label>
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido"
                className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors" />
            </div>
            {rechazando && (
              <div className="mt-3">
                <label className="block text-[12.5px] font-semibold text-mute mb-1.5">Motivo del rechazo (opcional)</label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder="Ej. Excede el presupuesto de la obra"
                  className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 text-sm text-ink placeholder-mute focus:outline-none focus:border-red-400/60 transition-colors resize-none" />
              </div>
            )}
            {error && <p className="text-red-500 text-[12.5px] mt-2">{error}</p>}
            {rechazando ? (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <button onClick={() => { setRechazando(false); setMotivo('') }}
                  className="py-3.5 rounded-full border border-edge text-ink font-semibold text-sm hover:bg-surface-2 transition-colors">Mejor no</button>
                <button onClick={() => decidir('rechazar')} disabled={enviando || !nombre.trim()}
                  className="py-3.5 rounded-full bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors disabled:opacity-50">
                  {enviando ? 'Enviando…' : 'Rechazar cotización'}
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => decidir('autorizar')} disabled={enviando || !nombre.trim()}
                  className="mt-4 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                  {enviando ? 'Enviando…' : 'Autorizar y enviar a REMALI'}
                </button>
                <button onClick={() => setRechazando(true)} disabled={enviando}
                  className="mt-2.5 w-full py-3 rounded-full text-red-600 dark:text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  Rechazar
                </button>
              </>
            )}
            <p className="text-[11.5px] text-mute mt-3 text-center">
              Al autorizar, REMALI recibe la solicitud y contacta a {info.cliente ? info.cliente.split(' ')[0] : 'tu equipo'} para coordinar. No necesitas cuenta.
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
