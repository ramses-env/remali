import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import { formatMoney } from '../lib/utils'

/* Página PÚBLICA de quien autoriza: sin cuenta, sin login.

   Sirve igual para UNA cotización que para varias — mandar una y mandar tres es
   el mismo camino del lado del cliente, así que aquí también. Lo que cambia es
   la pregunta: si son OPCIONES de lo mismo, escoge una; si son cosas distintas,
   autoriza las que quiera.

   Lo que NO autorice no llega a REMALI: se queda del lado del cliente, que verá
   el motivo y podrá armar otra versión. */

type ItemSrv = {
  id: number
  descripcion: string
  cantidad: number
  duracion: number
  modalidad: string
  precio_unitario: string
  subtotal: string
  disponible: boolean
}

type BorradorSrv = {
  id: number
  nombre: string
  total: string
  tipo: string
  items: ItemSrv[]
  datos_contacto?: { nombre?: string; empresa?: string }
  obra?: { direccion?: string }
}

type PaqueteSrv = {
  modo: 'opciones' | 'lista'
  mensaje: string
  estado: 'pendiente' | 'resuelto' | 'retirado'
  vencido: boolean
  vence_el: string | null
  total: string
  autorizada_por: string
  resuelto_en: string | null
  borradores: BorradorSrv[]
}

const MODALIDAD: Record<string, string> = {
  venta: 'Venta', dia: 'Renta por día', semana: 'Renta por semana', mes: 'Renta por mes',
}
const PLURAL: Record<string, string> = { dia: 'días', semana: 'semanas', mes: 'meses' }

export default function AutorizarCotizacion() {
  const { token } = useParams()
  const [paquete, setPaquete] = useState<PaqueteSrv | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [rechazando, setRechazando] = useState(false)
  /** Qué decidió marcar. En modo 'opciones' nunca tiene más de uno. */
  const [elegidos, setElegidos] = useState<Set<number>>(new Set())
  const [resultado, setResultado] = useState<{ autorizadas: number; folios: string[] } | null>(null)

  useEffect(() => {
    let vivo = true
    api.get<{ paquete: PaqueteSrv; ya_resuelto: boolean }>(`/autorizacion/${token}/`, { fondo: true } as never)
      .then(r => {
        if (!vivo) return
        setPaquete(r.data.paquete)
        // Con una sola, viene marcada: el caso normal es autorizarla.
        if (r.data.paquete.borradores.length === 1) setElegidos(new Set([r.data.paquete.borradores[0].id]))
      })
      .catch(e => { if (vivo) setError(e?.response?.data?.detalle || 'No se pudo abrir el enlace.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [token])

  const borradores = paquete?.borradores || []
  const varias = borradores.length > 1
  const opciones = paquete?.modo === 'opciones'
  const quien = borradores[0]?.datos_contacto || {}
  const obra = borradores[0]?.obra?.direccion || ''

  const totalElegido = useMemo(
    () => borradores.filter(b => elegidos.has(b.id)).reduce((s, b) => s + Number(b.total || 0), 0),
    [borradores, elegidos])

  const marcar = (id: number) => setElegidos(prev => {
    if (opciones) return new Set(prev.has(id) ? [] : [id])
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  async function decidir(accion: 'autorizar' | 'rechazar') {
    if (!nombre.trim()) { setError('Escribe tu nombre para continuar.'); return }
    if (accion === 'autorizar' && elegidos.size === 0) {
      setError(opciones ? 'Escoge cuál autorizas.' : 'Marca al menos una para autorizar.')
      return
    }
    setEnviando(true)
    setError('')
    try {
      const decisiones = borradores.map(b => ({
        borrador: b.id,
        accion: accion === 'autorizar' && elegidos.has(b.id) ? 'autorizar' : 'rechazar',
        motivo: elegidos.has(b.id) && accion === 'autorizar' ? '' : motivo.trim(),
      }))
      const r = await api.post<{ autorizadas: number; folios: string[]; ya_resuelto: boolean; detalle: string }>(
        `/autorizacion/${token}/`, { nombre: nombre.trim(), decisiones }, { fondo: true } as never)
      if (r.data.ya_resuelto) {
        setError(r.data.detalle)
        setPaquete(p => p && { ...p, estado: 'resuelto' })
        return
      }
      setResultado({ autorizadas: r.data.autorizadas || 0, folios: r.data.folios || [] })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo enviar tu decisión.')
    } finally {
      setEnviando(false)
    }
  }

  const primerNombre = (quien.nombre || '').split(' ')[0] || 'quien te la mandó'
  const caja = 'w-full max-w-lg rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8'

  // ── Ya se resolvió (ahora, o en otra visita) ──
  if (resultado || (paquete && paquete.estado === 'resuelto' && !cargando)) {
    const autorizadas = resultado?.autorizadas ?? (paquete?.autorizada_por ? -1 : 0)
    const hubo = autorizadas !== 0
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <div className={`${caja} text-center`}>
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-5 ${hubo ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-500'}`}>
            {hubo
              ? <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              : <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>}
          </div>
          <h1 className="text-[22px] font-black text-ink">
            {resultado ? (hubo ? 'Autorizada' : 'Rechazada') : 'Esto ya se resolvió'}
          </h1>
          <p className="text-mute text-sm mt-2 max-w-[40ch] mx-auto">
            {resultado
              ? (hubo
                ? <>Ya {resultado.autorizadas === 1 ? 'está' : 'están'} en manos de REMALI{resultado.folios.length ? <> (<b className="text-ink">{resultado.folios.join(', ')}</b>)</> : null}. El equipo contacta a {primerNombre} para coordinar.</>
                : <>Le avisamos a {primerNombre} para que prepare otra versión. REMALI no recibió nada.</>)
              : <>{paquete?.autorizada_por ? `${paquete.autorizada_por} ya lo resolvió` : 'Ya se resolvió'}{paquete?.resuelto_en ? ` el ${new Date(paquete.resuelto_en).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}` : ''}. No hace falta que hagas nada.</>}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className={caja}>
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Abriendo la propuesta…</p>
          </div>
        ) : !paquete ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.6" className="fill-current" /></svg>
            </div>
            <h1 className="text-[22px] font-black text-ink">Enlace no disponible</h1>
            <p className="text-mute text-sm mt-2">{error}</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mb-5">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
              </div>
              <h1 className="text-[22px] font-black text-ink leading-tight">Solicitud de autorización</h1>
              <p className="text-mute text-sm mt-2">
                <b className="text-ink">{quien.nombre || 'Tu equipo'}</b>
                {quien.empresa ? <> ({quien.empresa})</> : null} te pide autorizar
                {varias ? <> {borradores.length} cotizaciones de maquinaria.</> : <> esta cotización de maquinaria.</>}
              </p>
              {varias && (
                <p className="text-[12.5px] font-semibold text-gold-ink mt-2">
                  {opciones ? 'Son opciones de lo mismo: escoge una.' : 'Son cosas distintas: autoriza las que quieras.'}
                </p>
              )}
            </div>

            {paquete.mensaje && (
              <div className="mt-5 rounded-2xl bg-gold-soft/40 border border-gold/30 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gold-ink">Recado de {primerNombre}</p>
                <p className="text-[13.5px] text-ink mt-1 whitespace-pre-line">{paquete.mensaje}</p>
              </div>
            )}

            {paquete.vencido && (
              <div className="mt-5 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                <p className="text-[13.5px] font-semibold text-red-600 dark:text-red-400">
                  Esta liga venció{paquete.vence_el ? ` el ${new Date(paquete.vence_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}` : ''}.
                  Los precios ya no están garantizados: pídele a {primerNombre} una versión nueva.
                </p>
              </div>
            )}

            {/* Las propuestas */}
            <div className="mt-6 flex flex-col gap-3">
              {borradores.map((b, idx) => {
                const sel = elegidos.has(b.id)
                return (
                  <div key={b.id}
                    onClick={varias ? () => marcar(b.id) : undefined}
                    className={`rounded-2xl border p-5 text-sm transition-colors ${varias ? 'cursor-pointer' : ''} ${sel && varias ? 'border-gold/60 bg-gold-soft/25' : 'border-edge bg-surface-2'}`}>
                    {varias && (
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`w-5 h-5 shrink-0 grid place-items-center border-2 transition-colors ${opciones ? 'rounded-full' : 'rounded-md'} ${sel ? 'bg-gold border-gold text-black' : 'bg-surface border-edge text-transparent'}`}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </span>
                        <span className="text-[14px] font-bold text-ink truncate">{b.nombre || `Opción ${idx + 1}`}</span>
                        <span className="ml-auto text-[15px] font-black text-ink shrink-0">{formatMoney(Number(b.total))}</span>
                      </div>
                    )}
                    {b.items.map((it, i) => (
                      <div key={it.id} className={`flex items-start justify-between gap-4 ${i > 0 || varias ? 'mt-3 pt-3 border-t border-edge' : ''}`}>
                        <div className="min-w-0">
                          <p className="text-ink font-semibold leading-snug">{it.descripcion}</p>
                          <p className="text-[12px] text-mute mt-0.5">
                            {MODALIDAD[it.modalidad] || it.modalidad} · {it.cantidad} {it.cantidad === 1 ? 'equipo' : 'equipos'}
                            {it.modalidad !== 'venta' && it.duracion > 1 ? ` × ${it.duracion} ${PLURAL[it.modalidad] || ''}` : ''}
                            {' · '}{formatMoney(Number(it.precio_unitario))}
                          </p>
                        </div>
                        <span className="text-ink font-bold shrink-0">{formatMoney(Number(it.subtotal))}</span>
                      </div>
                    ))}
                    {!varias && (
                      <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-4 pt-4">
                        <span className="text-[15px] font-bold text-ink">Total</span>
                        <span className="text-[24px] font-black tracking-tight text-ink">{formatMoney(Number(b.total))}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {varias && (
              <div className="mt-4 flex items-baseline justify-between gap-4 px-1">
                <span className="text-[15px] font-bold text-ink">{opciones ? 'La que escogiste' : 'Total de lo marcado'}</span>
                <span className="text-[24px] font-black tracking-tight text-ink">{formatMoney(totalElegido)}</span>
              </div>
            )}

            <div className="mt-3 px-1">
              {obra && <p className="text-[12px] text-mute">Obra: {obra}</p>}
              {paquete.vence_el && !paquete.vencido && (
                <p className="text-[12px] text-mute mt-1">
                  Precios congelados hasta el {new Date(paquete.vence_el).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.
                </p>
              )}
            </div>

            {/* Quién autoriza */}
            <div className="mt-6">
              <label className="block text-[12.5px] font-semibold text-mute mb-1.5">Tu nombre (quien autoriza)</label>
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido"
                className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors" />
            </div>

            {rechazando && (
              <div className="mt-3">
                <label className="block text-[12.5px] font-semibold text-mute mb-1.5">Motivo (opcional, lo ve {primerNombre})</label>
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
                  {enviando ? 'Enviando…' : varias ? 'Rechazar todas' : 'Rechazar cotización'}
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => decidir('autorizar')} disabled={enviando || !nombre.trim() || paquete.vencido || elegidos.size === 0}
                  className="mt-4 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                  {enviando ? 'Enviando…'
                    : varias ? `Autorizar ${elegidos.size === 1 ? 'la marcada' : `las ${elegidos.size} marcadas`} y enviar a REMALI`
                    : 'Autorizar y enviar a REMALI'}
                </button>
                <button onClick={() => setRechazando(true)} disabled={enviando}
                  className="mt-2.5 w-full py-3 rounded-full text-red-600 dark:text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  {varias ? 'Rechazar todas' : 'Rechazar'}
                </button>
              </>
            )}

            <p className="text-[11.5px] text-mute mt-3 text-center">
              Solo lo que autorices llega a REMALI. Lo demás se queda con {primerNombre}. No necesitas cuenta.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
