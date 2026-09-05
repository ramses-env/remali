import { useEffect, useRef, useState } from 'react'
import { useClienteEventos } from '../lib/clienteEventos'
import { useLatido } from '../lib/latido'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import Migas from '../components/Migas'
import { formatMoney, ligaAbsoluta } from '../lib/utils'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import { anotarFallo } from '../lib/fallo'

type Cot = {
  id: number
  cancelacion_solicitada?: string | null
  folio: string; estado: string; estado_label: string; tipo: string; total: string
  creada?: string; vence_el?: string | null; pdf?: string | null; atendida_por?: string | null; atendida?: boolean; convertida?: boolean; entrega_prometida?: string | null
  renta_id?: number | null; venta_id?: number | null; entregada_en?: string | null
  /** Quien la firmó del lado del cliente, si pasó por su autorizador. */
  autorizada_por?: string | null
  /** `unidades_libres` viene en vivo del servidor: `null` si la partida no
   *  cuelga de un equipo del catálogo, 0 si están todas rentadas. */
  items: { descripcion: string; cantidad: number; unidades_libres?: number | null }[]
  carrito?: { id: number; title: string; qty: number; duracion?: number; unit?: string; image?: string }[]
}

const monoLabel = 'text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase'

/** Estado vivo de una cotización del cliente: el mismo stepper de la
 *  confirmación, pero alimentado por el estado real del backend. */
export default function MisCotizacionEstado() {
  const { folio } = useParams()
  const cfg = useConfigPublica()
  const [cot, setCot] = useState<Cot | null>(null)
  const [cargando, setCargando] = useState(true)
  const [copiada, setCopiada] = useState(false)
  // Solicitud de cancelación: mini-form inline (motivo opcional).
  const [cancelando, setCancelando] = useState(false)
  const [motivoCancel, setMotivoCancel] = useState('')
  const [cancelEnviando, setCancelEnviando] = useState(false)
  const [cancelListo, setCancelListo] = useState(false)
  const [fotos, setFotos] = useState<Record<number, string>>({})

  /* Tiempo real real por WebSocket; el latido queda como respaldo lento si el
     socket cae. Así la aceptación, conversión o entrega llegan sin refrescar. */
  const recargar = useRef(() => {})
  useClienteEventos((evt) => {
    if (evt.topic === 'cotizaciones') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 10_000, () => recargar.current())
  useEffect(() => {
    let vivo = true
    const cargar = (fondo = false) => {
      // fondo:true = sin loader global; el estado cambia bajo los pies sin parpadeo.
      api.get<{ cotizaciones: Cot[] }>('/cotizaciones/mias/', { fondo } as never)
        .then(r => { if (vivo) setCot((r.data?.cotizaciones || []).find(c => c.folio === folio) || null) })
        .catch(() => { if (vivo && !fondo) setCot(null) })
        .finally(() => { if (vivo) setCargando(false) })
    }
    cargar()
    recargar.current = () => cargar(true)
    return () => { vivo = false }
  }, [folio])

  useEffect(() => {
    api.get<{ id: number; imagen?: string | null; imagenes?: string[] }[]>('/equipos/')
      .then(r => {
        const m: Record<number, string> = {}
        for (const e of r.data || []) { const im = e.imagen || (e.imagenes || [])[0]; if (im) m[e.id] = im }
        setFotos(m)
      })
      .catch(anotarFallo)
  }, [])

  if (cargando) return <div className="bg-app min-h-screen grid place-items-center"><div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" /></div>
  if (!cot) return (
    <div className="bg-app min-h-screen text-ink grid place-items-center px-6 text-center">
      <div>
        <p className="text-xl font-bold">No encontramos esa cotización</p>
        <Link to="/mis-cotizaciones" className="inline-block mt-4 px-5 py-2.5 rounded-full bg-gold text-black text-sm font-bold">Mis cotizaciones</Link>
      </div>
    </div>
  )

  // Mapa estado → progreso del stepper (0-index del paso activo; -1 = terminado)
  const rech = cot.estado === 'rechazada'
  const canc = cot.estado === 'cancelada'
  // Cancelada o rechazada: el flujo se detuvo; no hay "qué sigue" ni palomita.
  const terminalNeg = rech || canc
  const venc = cot.estado === 'vencida'
  const acep = cot.estado === 'aceptada'
  // "Entregado" = el técnico marcó la salida del equipo (entregada_en), NO que la
  // cotización se convirtió en renta. Una venta convertida sí es entrega inmediata.
  const entregado = !!cot.entregada_en
  const ventaConv = !!cot.venta_id && !cot.renta_id
  const rentaPorEntregar = !!cot.renta_id && !entregado   // renta creada, sin entregar aún
  const compl = entregado || ventaConv        // equipo entregado (renta) o vendido (venta)
  // La autorización YA ocurrió antes de que la cotización llegue a REMALI (por
  // la liga del jefe, o el propio cliente cuando no hay a quién pedirle). Por
  // eso el flujo real es: recibida (autorizada) → existencia → fecha/hora →
  // entrega. No hay un paso de "autorización" a media revisión.
  // Ya con fecha/hora agendada (entrega_prometida), el paso "Fecha y hora" queda
  // HECHO y el activo pasa a "Entrega en obra" (3). Antes, una venta aceptada se
  // quedaba en 2 aunque ya hubiera fecha, y el paso no se ponía verde con palomita.
  const entregaAgendada = acep && !!cot.entrega_prometida
  const activo = compl ? 4 : rentaPorEntregar ? 3 : entregaAgendada ? 3 : acep ? 2 : 1
  const entrega = cot.entrega_prometida
    ? new Date(cot.entrega_prometida).toLocaleString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null
  const entregadoTxt = cot.entregada_en
    ? new Date(cot.entregada_en).toLocaleString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : ''
  const pasos = [
    // "Autorizada" solo si de verdad pasó por un autorizador: la que el cliente
    // mandó directo se recibió, no se autorizó, y decirle lo contrario le
    // inventa un paso que nunca ocurrió.
    { t: 'Cotización recibida', d: cot.autorizada_por ? `Autorizada por ${cot.autorizada_por} · folio ${cot.folio}.` : `Recibida · folio ${cot.folio}.` },
    { t: 'Revisión de disponibilidad', d: 'Confirmamos que hay existencias en inventario.' },
    { t: 'Fecha y hora de entrega', d: entrega ? `Programada: ${entrega}.` : acep ? 'Coordinamos contigo el día y la hora por WhatsApp.' : 'Al confirmar existencias, agendamos la entrega.' },
    { t: 'Entrega en obra', d: entregado ? `Entregado el ${entregadoTxt}.` : ventaConv ? 'Compra completada.' : rentaPorEntregar ? (entrega ? `Programada: ${entrega}. Aún no sale; te avisamos al entregarlo.` : 'Pendiente de entrega; te avisamos al salir.') : 'Llevamos el equipo probado a tu obra.' },
  ]
  const chip = canc ? { txt: 'Cancelada', cls: 'text-red-500 border-red-500/40' }
    : rech ? { txt: 'No procedió', cls: 'text-red-500 border-red-500/40' }
    : venc ? { txt: 'Vencida — vuelve a cotizar', cls: 'text-mute border-edge' }
    : entregado ? { txt: `Entregado · ${entregadoTxt}`, cls: 'text-emerald-500 border-emerald-500/40' }
    : ventaConv ? { txt: 'Completada · compra lista', cls: 'text-emerald-500 border-emerald-500/40' }
    : rentaPorEntregar ? { txt: 'Paso 4 de 4 · pendiente de entrega', cls: 'text-gold-ink border-gold/40' }
    : entregaAgendada ? { txt: 'Paso 4 de 4 · pendiente de entrega', cls: 'text-gold-ink border-gold/40' }
    : acep ? { txt: 'Paso 3 de 4 · agendando fecha y hora', cls: 'text-gold-ink border-gold/40' }
    : { txt: 'Paso 2 de 4 · revisando existencias', cls: 'text-gold-ink border-gold/40' }

  const wa = waLink(cfg.whatsapp_principal, `Hola REMALI, quiero seguimiento de mi cotización ${cot.folio}.`)
  const diasRestantes = cot.vence_el ? Math.ceil((new Date(cot.vence_el + 'T23:59:59').getTime() - Date.now()) / 86400000) : null
  const porVencer = !venc && !rech && !canc && !acep && diasRestantes !== null && diasRestantes <= 3
  const UNIT_TXT: Record<string, string> = { venta: 'Compra', dia: 'Renta por día', semana: 'Renta por semana', mes: 'Renta por mes' }

  async function copiar() {
    if (!cot?.pdf) return
    // Con el ORIGEN pegado: lo que se copia se manda por WhatsApp, y ahí una
    // ruta suelta ("/api/cotizaciones/…") no es un link, es texto.
    try { await navigator.clipboard.writeText(ligaAbsoluta(cot.pdf)); setCopiada(true); setTimeout(() => setCopiada(false), 2000) } catch { /* portapapeles bloqueado */ }
  }

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="contenedor pt-24 pb-16 flex flex-col gap-5">
        <Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis cotizaciones', to: '/mis-cotizaciones' }, { label: cot.folio }]} />

        <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7 flex flex-col min-[800px]:flex-row min-[800px]:items-center gap-5 justify-between">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${terminalNeg ? 'bg-red-500/12' : 'bg-emerald-500/12'}`}>
              {terminalNeg
                ? <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                : <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div>
              <h1 className="text-[26px] sm:text-[32px] font-extrabold tracking-tight leading-none">Cotización {cot.estado_label.toLowerCase()}</h1>
              <p className="text-mute text-[14.5px] mt-2">Folio <span className="font-mono font-bold text-ink">{cot.folio}</span> · {cot.tipo === 'renta' ? 'Renta' : 'Venta'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="h-[46px] px-5 rounded-xl bg-[#25D366] text-white text-[14.5px] font-bold grid place-items-center hover:opacity-90">WhatsApp</a>}
            {cot.pdf && <button onClick={copiar} className={`h-[46px] px-5 rounded-xl border text-[14px] font-semibold transition-colors ${copiada ? 'border-emerald-500/50 text-emerald-600' : 'border-edge hover:bg-surface-2'}`}>{copiada ? '✓ Copiada' : '⧉ Copiar liga'}</button>}
            {cot.pdf && <a href={cot.pdf} target="_blank" rel="noopener noreferrer" className="h-[46px] px-5 rounded-xl border border-edge text-[14px] font-semibold grid place-items-center hover:bg-surface-2 transition-colors">↓ PDF</a>}
          </div>
        </div>

        {terminalNeg ? (
          <div className="rounded-[20px] border border-red-500/25 bg-red-500/5 px-6 sm:px-8 py-7 flex items-start gap-4">
            <div className="w-11 h-11 rounded-full bg-red-500/12 grid place-items-center shrink-0">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-[18px] font-extrabold">{canc ? 'Esta cotización fue cancelada' : 'Esta cotización no procedió'}</h2>
              <p className="text-[13.5px] text-mute mt-1.5 leading-relaxed max-w-[560px]">
                {canc
                  ? 'El proceso se detuvo aquí: no hay autorización ni entrega pendientes. Si la necesitas otra vez, vuelve a cotizar cuando quieras.'
                  : 'No hubo disponibilidad para lo que pediste. Puedes armar otra cotización cuando quieras.'}
              </p>
              <Link to="/equipos" className="inline-block mt-4 px-5 h-[42px] leading-[42px] rounded-xl bg-gold text-black text-[14px] font-bold btn-acento">Volver a cotizar</Link>
            </div>
          </div>
        ) : (
          <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
              <h2 className="text-[18px] font-extrabold">Qué sigue</h2>
              <span className={`text-[12.5px] font-semibold border rounded-full px-3.5 py-1.5 ${chip.cls}`}>{chip.txt}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
              {pasos.map((p, i) => {
                const ok = !venc ? i < activo : i === 0
                const act = !venc && i === activo
                return (
                  <div key={i} className={venc ? 'opacity-50' : ''}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <span className={`w-6 h-6 rounded-full grid place-items-center border-2 shrink-0 ${ok ? 'border-emerald-500 bg-emerald-500/12' : act ? 'border-gold' : 'border-edge'}`}>
                        {ok && <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      {i < pasos.length - 1 && <span className={`flex-1 h-px ${ok ? 'bg-emerald-500/40' : act ? 'bg-gold/40' : 'bg-edge'}`} />}
                    </div>
                    <p className={`text-[15px] font-bold ${act ? 'text-gold-ink' : ''}`}>{p.t}</p>
                    <p className="text-[13px] text-mute mt-1 leading-snug">{p.d}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid min-[980px]:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="rounded-[20px] border border-edge bg-surface overflow-hidden">
            <div className="px-6 sm:px-8 py-6 flex flex-wrap items-end gap-x-10 gap-y-4 justify-between border-b border-edge">
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <div><p className={monoLabel}>Folio</p><p className="font-mono text-[15px] font-bold mt-1">{cot.folio}</p></div>
                <div><p className={monoLabel}>Total</p><p className="text-[15px] font-extrabold text-price mt-1">{formatMoney(cot.total)}</p></div>
                {entrega && <div><p className={monoLabel}>Entrega</p><p className="text-[15px] font-bold mt-1 text-emerald-500">{entrega}</p></div>}
                {cot.vence_el && <div><p className={monoLabel}>Vigencia</p><p className="text-[15px] font-bold mt-1">{cot.vence_el}</p></div>}
              </div>
              {cot.pdf && <a href={cot.pdf} target="_blank" rel="noopener noreferrer" className="text-[14px] font-semibold text-gold-ink hover:opacity-80">Ver completa →</a>}
            </div>
            {(cot.carrito && cot.carrito.length > 0 ? cot.carrito : null)?.map((l, i) => {
              const foto = l.image || fotos[l.id]
              return (
                <div key={i} className="px-6 sm:px-8 py-4 border-b border-edge/60 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-surface-2 border border-edge shrink-0 overflow-hidden grid place-items-center">
                    {foto ? <img src={resolveMediaUrl(foto)} alt={l.title} className="w-full h-full object-cover" loading="lazy" crossOrigin="anonymous" referrerPolicy="no-referrer" /> : <span className="text-[9px] text-mute">Sin foto</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold leading-snug line-clamp-1">{l.title}</p>
                    <p className="text-[13px] text-mute mt-0.5">{UNIT_TXT[l.unit || 'venta'] || 'Compra'} · {l.qty} equipo{l.qty === 1 ? '' : 's'}{l.unit && l.unit !== 'venta' && (l.duracion || 1) > 1 ? ` × ${l.duracion} ${({ dia: 'días', semana: 'semanas', mes: 'meses' } as Record<string, string>)[l.unit] || ''}` : ''}</p>
                  </div>
                </div>
              )
            }) || cot.items.map((it, i) => (
              <div key={i} className="px-6 sm:px-8 py-4 border-b border-edge/60">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[14.5px] font-semibold line-clamp-1">{it.descripcion}</p>
                  <span className="text-[13.5px] text-mute shrink-0">× {it.cantidad}</span>
                </div>
                {/* Sin unidades libres: se dice AQUÍ, en la partida, no en un
                    aviso general arriba. La cotización puede traer tres equipos
                    y solo uno estar agotado; un letrero global haría dudar de
                    los tres. El cliente no pierde nada —su cotización sigue en
                    pie— y le llega aviso en cuanto se libere una. */}
                {it.unidades_libres === 0 && (
                  <p className="mt-2 inline-flex items-start gap-2 text-[12.5px] leading-snug rounded-lg border border-[color-mix(in_oklab,var(--c-taller)_34%,transparent)] bg-[color-mix(in_oklab,var(--c-taller)_10%,transparent)] px-3 py-2 text-taller-ink">
                    <svg className="w-4 h-4 shrink-0 mt-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    <span><b>Sin unidades ahora mismo</b> — están todas en obra. Te avisamos en cuanto se libere una.</span>
                  </p>
                )}
              </div>
            ))}
            {cot.vence_el && <p className="px-6 sm:px-8 py-4 text-[12.5px] text-mute">Precios vigentes hasta el {cot.vence_el}.</p>}
          </div>

          <div className="flex flex-col gap-5">
            <div className="rounded-[20px] border border-edge bg-surface p-6">
              <p className={`${monoLabel} mb-4`}>Te está atendiendo</p>
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-11 h-11 rounded-full bg-gold-soft text-gold-ink grid place-items-center font-extrabold text-[15px]">
                  {(cot.atendida_por || cfg.negocio_representante || 'R').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <p className="text-[15px] font-bold">{cot.atendida_por || cfg.negocio_representante || cfg.negocio_nombre || 'REMALI'}</p>
                  <p className="text-[12.5px] text-mute">REMALI · Acapulco, Gro.</p>
                </div>
              </div>
              {(cfg.negocio_telefono || cfg.whatsapp_principal) && (
                <div className="flex justify-between text-[13.5px] py-1.5"><span className="text-mute">Teléfono</span><span className="font-semibold">{cfg.negocio_telefono || cfg.whatsapp_principal}</span></div>
              )}
              {cfg.negocio_email && <div className="flex justify-between text-[13.5px] py-1.5 gap-3"><span className="text-mute">Correo</span><span className="font-semibold truncate">{cfg.negocio_email}</span></div>}
            </div>

            {/* Cancelar: es SU cotización — se cancela al instante, sin aprobación. */}
            {cot && !cot.convertida && !venc && cot.estado !== 'rechazada' && cot.estado !== 'cancelada' && (
              (cot.cancelacion_solicitada || cancelListo) ? (
                <div className="rounded-[20px] border border-red-500/30 bg-red-500/5 p-6">
                  <p className="text-[15px] font-extrabold text-red-600 dark:text-red-400">Cotización cancelada</p>
                  <p className="text-[13px] text-mute mt-1.5 leading-snug">Quedó cancelada y REMALI ya está enterado. Si la necesitas de nuevo, vuelve a cotizar cuando quieras.</p>
                </div>
              ) : (
                <div className="rounded-[20px] border border-edge bg-surface p-6">
                  {!cancelando ? (
                    <>
                      <p className="text-[15px] font-extrabold">¿Ya no la necesitas?</p>
                      <p className="text-[13px] text-mute mt-1.5 leading-snug">Puedes cancelarla ahora mismo; REMALI queda avisado al instante.</p>
                      <button onClick={() => setCancelando(true)}
                        className="mt-4 px-5 h-[42px] rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 text-[14px] font-bold hover:bg-red-500/10 transition-colors">
                        Cancelar cotización
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-[15px] font-extrabold">Cuéntanos el motivo (opcional)</p>
                      <textarea value={motivoCancel} onChange={e => setMotivoCancel(e.target.value)} rows={2} placeholder="Ej. El proyecto se pospuso"
                        className="campo campo-area mt-3 focus:border-red-400/60" />
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => { setCancelando(false); setMotivoCancel('') }}
                          className="h-[42px] rounded-xl border border-edge text-ink text-[13.5px] font-semibold hover:bg-surface-2 transition-colors">Mejor no</button>
                        <button disabled={cancelEnviando}
                          onClick={async () => {
                            setCancelEnviando(true)
                            try {
                              await api.post(`/cotizaciones/${cot.id}/solicitar-cancelacion/`, { motivo: motivoCancel.trim() }, { fondo: true } as never)
                              setCancelListo(true)
                            } catch { /* el siguiente latido reintenta el estado */ }
                            finally { setCancelEnviando(false) }
                          }}
                          className="h-[42px] rounded-xl bg-red-600 text-white text-[13.5px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                          {cancelEnviando ? 'Cancelando…' : 'Sí, cancelar'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            )}
            {porVencer && (
              <div className="rounded-[20px] border border-gold/40 bg-gold-soft/40 p-6">
                <p className="text-[15px] font-extrabold">Tu cotización vence {diasRestantes === 0 ? 'hoy' : diasRestantes === 1 ? 'mañana' : `en ${diasRestantes} días`}</p>
                <p className="text-[13px] text-mute mt-1.5 leading-snug">Para respetarte estos precios, confírmanos por WhatsApp antes de la fecha.</p>
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 px-5 h-[42px] leading-[42px] rounded-xl bg-gold text-black text-[14px] font-bold btn-acento">Confirmar por WhatsApp</a>}
              </div>
            )}
            {venc && (
              <div className="rounded-[20px] border border-edge bg-surface p-6">
                <p className="text-[15px] font-extrabold">Esta cotización venció</p>
                <p className="text-[13px] text-mute mt-1.5 leading-snug">Los precios ya no están garantizados, pero puedes rearmarla en un clic con los mismos equipos.</p>
                <Link to="/mis-cotizaciones" className="inline-block mt-4 px-5 h-[42px] leading-[42px] rounded-xl bg-gold text-black text-[14px] font-bold btn-acento">Volver a cotizar</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
