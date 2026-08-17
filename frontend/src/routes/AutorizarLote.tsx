import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import { formatMoney } from '../lib/utils'

type ItemL = { descripcion: string; cantidad: number; duracion?: number; precio: string; subtotal?: string; modalidad: string }
type CotL = { folio: string; tipo: string; items: ItemL[]; subtotal: string; total: string }
type InfoLote = {
  cliente: string
  empresa?: string
  obra?: string
  count: number
  cotizaciones: CotL[]
  total: string
  vence_el?: string | null
  autorizada: boolean
  rechazada?: boolean
  autorizada_por?: string
}

const MODALIDAD: Record<string, string> = { venta: 'Venta', dia: 'Renta por día', semana: 'Renta por semana', mes: 'Renta por mes' }
const PERIODO: Record<string, string> = { dia: 'días', semana: 'semanas', mes: 'meses' }

/** Página PÚBLICA de quien autoriza un LOTE (el jefe del cliente): sin cuenta.
 *  Ve TODAS las cotizaciones con su total combinado y las autoriza/rechaza
 *  JUNTAS. Al autorizar, todas llegan solas a REMALI. Espejo de la individual. */
export default function AutorizarLote() {
  const { token } = useParams()
  const [info, setInfo] = useState<InfoLote | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [rechazoListo, setRechazoListo] = useState(false)

  useEffect(() => {
    let vivo = true
    api.get<InfoLote>(`/autorizacion-lote/${token}/`, { fondo: true } as never)
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
      await api.post(`/autorizacion-lote/${token}/`, { nombre: nombre.trim(), accion, motivo: motivo.trim() }, { fondo: true } as never)
      if (accion === 'rechazar') setRechazoListo(true)
      else setListo(true)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo enviar tu decisión.')
    } finally {
      setEnviando(false)
    }
  }

  const yaAutorizado = listo || !!info?.autorizada
  const yaRechazado = rechazoListo || !!info?.rechazada
  const n = info?.count || info?.cotizaciones?.length || 0
  const primerNombre = info?.cliente ? info.cliente.split(' ')[0] : 'quien lo armó'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8">
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Abriendo el lote…</p>
          </div>
        ) : error && !info ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.6" className="fill-current" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Enlace no disponible</h1>
            <p className="text-mute text-sm mt-2">{error}</p>
          </div>
        ) : yaRechazado ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Lote rechazado</h1>
            <p className="text-mute text-sm mt-2 max-w-[42ch] mx-auto">
              Le avisamos a {primerNombre} para que prepare otra versión. REMALI no recibió nada.
            </p>
            {info?.autorizada_por && !rechazoListo && (
              <p className="text-[12.5px] text-mute mt-2">Rechazado por {info.autorizada_por}.</p>
            )}
          </div>
        ) : yaAutorizado ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Lote autorizado</h1>
            <p className="text-mute text-sm mt-2 max-w-[42ch] mx-auto">
              Las <b className="text-ink">{n}</b> cotizaciones ya están en manos de REMALI. El equipo se pondrá en contacto para coordinar todo.
            </p>
            {info?.autorizada_por && !listo && (
              <p className="text-[12.5px] text-mute mt-2">Autorizado por {info.autorizada_por}.</p>
            )}
          </div>
        ) : info ? (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mb-5">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
              </div>
              <h1 className="text-[22px] font-black text-ink leading-tight">Autorización de lote · {n} {n === 1 ? 'cotización' : 'cotizaciones'}</h1>
              <p className="text-mute text-sm mt-2">
                <b className="text-ink">{info.cliente || 'Tu equipo'}</b>
                {info.empresa ? <> ({info.empresa})</> : null} te pide autorizar estas {n} cotizaciones de maquinaria.
              </p>
            </div>

            {/* Cada cotización del lote */}
            <div className="mt-6 flex flex-col gap-3">
              {info.cotizaciones.map((c, ci) => (
                <div key={c.folio || ci} className="rounded-2xl bg-surface-2 border border-edge p-5 text-sm">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="font-mono text-[13px] font-bold text-mute">{c.folio}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-mute">{c.tipo}</span>
                  </div>
                  {c.items.map((it, i) => (
                    <div key={i} className={`flex items-start justify-between gap-4 ${i > 0 ? 'mt-3 pt-3 border-t border-edge' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-ink font-semibold leading-snug">{it.descripcion}</p>
                        <p className="text-[12px] text-mute mt-0.5">
                          {MODALIDAD[it.modalidad] || it.modalidad} · {it.cantidad} {it.cantidad === 1 ? 'equipo' : 'equipos'}
                          {it.modalidad !== 'venta' && (it.duracion || 1) > 1 ? ` × ${it.duracion} ${PERIODO[it.modalidad] || ''}` : ''}
                          {' · '}{formatMoney(Number(it.precio))}
                        </p>
                      </div>
                      <span className="text-ink font-bold shrink-0">{formatMoney(Number(it.subtotal ?? Number(it.precio) * it.cantidad))}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-3 pt-3">
                    <span className="text-[12.5px] font-semibold text-mute">Subtotal de esta cotización</span>
                    <span className="text-[15px] font-bold text-ink">{formatMoney(Number(c.total))}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total combinado del lote */}
            <div className="mt-4 rounded-2xl border border-gold/30 bg-gold-soft/40 px-5 py-4 flex items-baseline justify-between gap-4">
              <span className="text-[15px] font-bold text-ink">Total del lote</span>
              <span className="text-[26px] font-black tracking-tight text-ink">{formatMoney(Number(info.total))}</span>
            </div>
            {info.obra && <p className="text-[12px] text-mute mt-3">Obra: {info.obra}</p>}
            {info.vence_el && <p className="text-[12px] text-mute mt-1">Precios vigentes hasta el {new Date(info.vence_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.</p>}

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
                  {enviando ? 'Enviando…' : 'Rechazar el lote'}
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => decidir('autorizar')} disabled={enviando || !nombre.trim()}
                  className="mt-4 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                  {enviando ? 'Enviando…' : `Autorizar todo y enviar a REMALI`}
                </button>
                <button onClick={() => setRechazando(true)} disabled={enviando}
                  className="mt-2.5 w-full py-3 rounded-full text-red-600 dark:text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  Rechazar
                </button>
              </>
            )}
            <p className="text-[11.5px] text-mute mt-3 text-center">
              Al autorizar, REMALI recibe las {n} cotizaciones y contacta a {primerNombre} para coordinar. No necesitas cuenta.
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
