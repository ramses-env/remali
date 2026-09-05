import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useClienteEventos } from '../lib/clienteEventos'
import Migas from '../components/Migas'
import { descargarBlob } from '../lib/descargar'
import { useLatido } from '../lib/latido'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'
import { useAuth } from '../store/auth'

type Rep = {
  id?: number
  folio: string; estado: string; equipo?: string; diagnostico?: string
  fecha_recibida?: string; fecha_entrega?: string | null; cliente?: string; trabajo_realizado?: string
  mano_obra_definida?: boolean
}

const PASOS = [
  { t: 'Recibida', d: 'Recibimos tu equipo en el taller.' },
  { t: 'En proceso', d: 'Nuestro técnico lo está revisando y reparando.' },
  { t: 'Lista para entrega', d: 'En cuanto quede lista te avisamos.' },
  { t: 'Entregada', d: 'Coordinamos la entrega contigo.' },
]
// Etapa alcanzada (índice del paso EN CURSO). "Recibida" ya cuenta como hecha.
const IDX: Record<string, number> = { recibida: 1, proceso: 2, terminada: 3, entregada: 4 }
const CHIP: Record<string, { txt: string; cls: string }> = {
  recibida: { txt: 'Recibida', cls: 'text-mute border-edge' },
  proceso: { txt: 'En proceso', cls: 'text-gold-ink border-gold/40' },
  terminada: { txt: 'Lista para entrega', cls: 'text-emerald-500 border-emerald-500/40' },
  entregada: { txt: 'Entregada', cls: 'text-emerald-500 border-emerald-500/40' },
}
const fechaLarga = (s?: string | null) =>
  s ? new Date(s).toLocaleString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/** Seguimiento de una reparación, con el mismo lenguaje que la cotización.
 *  Sirve con cuenta (/mis-reparaciones/:folio) y por liga pública
 *  (/seguir/reparacion/:token) — misma pantalla, distinta fuente. */
export default function SeguirReparacion({ modo }: { modo: 'cuenta' | 'publico' }) {
  const { folio, token } = useParams()
  const nav = useNavigate()
  const cfg = useConfigPublica()
  const { token: sesion } = useAuth()
  const [rep, setRep] = useState<Rep | null>(null)
  const [cargando, setCargando] = useState(true)
  const [noEncontrada, setNoEncontrada] = useState(false)
  const [bajando, setBajando] = useState(false)

  const cargar = useCallback((fondo = false) => {
    if (modo === 'cuenta') {
      api.get<{ reparaciones: Rep[] }>('/reparaciones/mias/', { fondo } as never)
        .then(r => { const m = (r.data.reparaciones || []).find(x => x.folio === folio) || null; setRep(m); if (!m) setNoEncontrada(true) })
        .catch(() => { if (!fondo) setNoEncontrada(true) })
        .finally(() => setCargando(false))
    } else {
      api.get<Rep>(`/seguir/reparacion/${token}/`, { fondo } as never)
        .then(r => setRep(r.data))
        .catch(() => setNoEncontrada(true))
        .finally(() => setCargando(false))
    }
  }, [modo, folio, token])

  useClienteEventos((evt) => {
    if (modo === 'cuenta' && evt.topic === 'reparaciones') cargar(true)
  })
  useLatido('/cotizaciones/latido/', 60_000, () => { if (modo === 'cuenta') cargar(true) })

  useEffect(() => {
    if (modo === 'cuenta' && !sesion) { nav(`/login?next=/mis-reparaciones/${folio}`, { replace: true }); return }
    cargar()
    if (modo !== 'publico') return
    const id = window.setInterval(() => cargar(true), 15_000)
    return () => window.clearInterval(id)
  }, [cargar, modo, sesion, folio, nav])

  if (cargando) return <div className="bg-app min-h-screen grid place-items-center"><div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" /></div>
  if (noEncontrada || !rep) return (
    <div className="bg-app min-h-screen text-ink grid place-items-center px-6 text-center">
      <div>
        <p className="text-xl font-bold">No encontramos esa reparación</p>
        <Link to="/" className="inline-block mt-4 px-5 py-2.5 rounded-full bg-gold text-black text-sm font-bold">Ir al inicio</Link>
      </div>
    </div>
  )

  const activo = IDX[rep.estado] ?? 1
  const entregada = rep.estado === 'entregada'
  const lista = rep.estado === 'terminada' || entregada
  const chip = CHIP[rep.estado] || CHIP.recibida
  const wa = waLink(cfg.whatsapp_principal, `Hola REMALI, quiero saber de mi reparación ${rep.folio}.`)

  // Con el equipo ya listo/entregado, el cliente descarga su orden de reparación
  // (la "orden de pago") en PDF. En cuenta va por id; por liga pública, por token.
  const descargarOrden = async () => {
    if (bajando) return
    setBajando(true)
    try {
      const url = modo === 'cuenta' ? `/reparaciones/mias/${rep.id}/pdf/` : `/seguir/reparacion/${token}/pdf/`
      const res = await api.get(url, { responseType: 'blob' })
      descargarBlob(res.data as Blob, `${rep.folio}.pdf`)
    } catch { /* si falla, no rompe la pantalla */ }
    finally { setBajando(false) }
  }

  const pasos = PASOS.map((p, i) => {
    if (i === 2 && lista) return { ...p, d: '¡Quedó lista! Coordinamos la entrega o pásala a recoger.' }
    if (i === 3) return { ...p, d: entregada && rep.fecha_entrega ? `Entregada el ${fechaLarga(rep.fecha_entrega)}.` : 'Coordinamos la entrega contigo.' }
    return p
  })

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="contenedor pt-24 pb-16 flex flex-col gap-5">
        {modo === 'cuenta'
          ? <Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis reparaciones', to: '/mis-reparaciones' }, { label: rep.folio }]} />
          : <Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Seguimiento' }, { label: rep.folio }]} />}

        <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7 flex flex-col min-[800px]:flex-row min-[800px]:items-center gap-5 justify-between">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${lista ? 'bg-emerald-500/12' : 'bg-gold-soft'}`}>
              {lista
                ? <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-6 h-6 text-gold-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></svg>}
            </div>
            <div>
              <h1 className="text-[26px] sm:text-[32px] font-extrabold tracking-tight leading-none">{rep.equipo || 'Tu equipo'}</h1>
              <p className="text-mute text-[14.5px] mt-2">Folio <span className="font-mono font-bold text-ink">{rep.folio}</span> · Reparación</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 self-start">
            {lista && rep.mano_obra_definida ? (
              <button
                onClick={descargarOrden}
                disabled={bajando}
                className="h-[46px] px-5 rounded-xl border border-edge bg-surface text-ink text-[14.5px] font-bold inline-flex items-center gap-2 hover:bg-surface-2 hover:border-gold/40 transition-colors disabled:opacity-50"
              >
                {bajando
                  ? <span className="w-4 h-4 rounded-full border-2 border-ink/30 border-t-ink animate-spin" />
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>}
                Descargar orden
              </button>
            ) : lista ? (
              // Ya está lista físicamente, pero la orden se libera cuando administración
              // confirma el costo (mano de obra), para no entregarla incompleta.
              <span className="h-[46px] px-4 rounded-xl border border-edge text-mute text-[13.5px] font-medium inline-flex items-center">Orden en preparación</span>
            ) : null}
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="h-[46px] px-5 rounded-xl bg-[#25D366] text-white text-[14.5px] font-bold grid place-items-center hover:opacity-90">WhatsApp</a>}
          </div>
        </div>

        <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
            <h2 className="text-[18px] font-extrabold">Estado de tu reparación</h2>
            <span className={`text-[12.5px] font-semibold border rounded-full px-3.5 py-1.5 ${chip.cls}`}>{chip.txt}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
            {pasos.map((p, i) => {
              const ok = i < activo
              const act = i === activo
              return (
                <div key={i}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className={`w-6 h-6 rounded-full grid place-items-center border-2 shrink-0 ${ok ? 'border-emerald-500 bg-emerald-500/12' : act ? 'border-gold' : 'border-edge'}`}>
                      {ok && <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    {i < pasos.length - 1 && <span className={`flex-1 h-px ${ok ? 'bg-emerald-500/40' : 'bg-edge'}`} />}
                  </div>
                  <p className={`text-[15px] font-bold ${act ? 'text-gold-ink' : ''}`}>{p.t}</p>
                  <p className="text-[13px] text-mute mt-1 leading-snug">{p.d}</p>
                </div>
              )
            })}
          </div>
        </div>

        {rep.diagnostico && (
          <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-6">
            <p className="text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase mb-1.5">Falla reportada</p>
            <p className="text-[14.5px] text-ink">{rep.diagnostico}</p>
            {rep.fecha_recibida && <p className="text-[12.5px] text-mute mt-3">Recibido el {fechaLarga(rep.fecha_recibida)}</p>}
          </div>
        )}

        {/* Diagnóstico / solución del técnico: se ve en cuanto lo escribe (el
            seguimiento refresca solo), para que el cliente sepa qué tenía y qué
            se le hizo aunque siga en el taller. */}
        {rep.trabajo_realizado && (
          <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-6">
            <div className="flex items-center gap-2 mb-1.5">
              <svg className="w-4 h-4 text-gold-ink shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></svg>
              <p className="text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase">Diagnóstico y solución</p>
            </div>
            <p className="text-[14.5px] text-ink whitespace-pre-wrap leading-relaxed">{rep.trabajo_realizado}</p>
          </div>
        )}
      </div>
    </div>
  )
}
