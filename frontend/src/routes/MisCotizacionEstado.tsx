import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import { formatMoney } from '../lib/utils'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'

type Cot = {
  folio: string; estado: string; estado_label: string; tipo: string; total: string
  creada?: string; vence_el?: string | null; pdf?: string | null
  items: { descripcion: string; cantidad: number }[]
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

  useEffect(() => {
    api.get<{ cotizaciones: Cot[] }>('/cotizaciones/mias/')
      .then(r => setCot((r.data?.cotizaciones || []).find(c => c.folio === folio) || null))
      .catch(() => setCot(null))
      .finally(() => setCargando(false))
  }, [folio])

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
  const venc = cot.estado === 'vencida'
  const acep = cot.estado === 'aceptada'
  const activo = acep ? 3 : 1   // enviada/borrador → revisión; aceptada → entrega
  const pasos = [
    { t: 'Cotización recibida', d: `Folio ${cot.folio} generado.` },
    { t: 'Revisión de disponibilidad', d: 'Confirmamos existencias y fechas de entrega.' },
    { t: 'Autorización', d: 'Quien autoriza aprueba desde la liga o por WhatsApp.' },
    { t: 'Entrega en obra', d: 'Agendamos día y hora; llevamos el equipo probado.' },
  ]
  const chip = rech ? { txt: 'No procedió', cls: 'text-red-500 border-red-500/40' }
    : venc ? { txt: 'Vencida — vuelve a cotizar', cls: 'text-mute border-edge' }
    : acep ? { txt: 'Paso 4 de 4 · aceptada, agendando entrega', cls: 'text-emerald-500 border-emerald-500/40' }
    : { txt: 'Paso 2 de 4 · en revisión ahora', cls: 'text-gold border-gold/40' }

  const wa = waLink(cfg.whatsapp_principal, `Hola REMALI, quiero seguimiento de mi cotización ${cot.folio}.`)

  async function copiar() {
    if (!cot?.pdf) return
    try { await navigator.clipboard.writeText(cot.pdf); setCopiada(true); setTimeout(() => setCopiada(false), 2000) } catch { /* portapapeles bloqueado */ }
  }

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-24 pb-16 flex flex-col gap-5">
        <Link to="/mis-cotizaciones" className="text-[13.5px] text-mute hover:text-ink transition-colors">← Mis cotizaciones</Link>

        <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7 flex flex-col min-[800px]:flex-row min-[800px]:items-center gap-5 justify-between">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${rech ? 'bg-red-500/12' : 'bg-emerald-500/12'}`}>
              {rech
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

        <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
            <h2 className="text-[18px] font-extrabold">Qué sigue</h2>
            <span className={`text-[12.5px] font-semibold border rounded-full px-3.5 py-1.5 ${chip.cls}`}>{chip.txt}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
            {pasos.map((p, i) => {
              const ok = !venc && !rech ? i < activo : i === 0
              const act = !venc && !rech && i === activo
              return (
                <div key={i} className={venc || (rech && i > 1) ? 'opacity-50' : ''}>
                  <span className={`w-6 h-6 rounded-full grid place-items-center border-2 mb-3 ${ok ? 'border-emerald-500 bg-emerald-500/12' : act ? 'border-gold' : 'border-edge'}`}>
                    {ok && <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <p className={`text-[15px] font-bold ${act ? 'text-gold' : ''}`}>{p.t}</p>
                  <p className="text-[13px] text-mute mt-1 leading-snug">{p.d}</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-[20px] border border-edge bg-surface overflow-hidden">
          <div className="px-6 sm:px-8 py-6 flex flex-wrap items-end gap-x-10 gap-y-4 justify-between border-b border-edge">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <div><p className={monoLabel}>Folio</p><p className="font-mono text-[15px] font-bold mt-1">{cot.folio}</p></div>
              <div><p className={monoLabel}>Total</p><p className="text-[15px] font-extrabold text-price mt-1">{formatMoney(cot.total)}</p></div>
              {cot.vence_el && <div><p className={monoLabel}>Vigencia</p><p className="text-[15px] font-bold mt-1">{cot.vence_el}</p></div>}
            </div>
            {cot.pdf && <a href={cot.pdf} target="_blank" rel="noopener noreferrer" className="text-[14px] font-semibold text-gold hover:opacity-80">Ver completa →</a>}
          </div>
          {cot.items.map((it, i) => (
            <div key={i} className="px-6 sm:px-8 py-4 border-b border-edge/60 flex items-center justify-between gap-4">
              <p className="text-[14.5px] font-semibold line-clamp-1">{it.descripcion}</p>
              <span className="text-[13.5px] text-mute shrink-0">× {it.cantidad}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
