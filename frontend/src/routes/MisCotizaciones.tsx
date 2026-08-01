import { useEffect, useMemo, useRef, useState } from 'react'
import { useLatido } from '../lib/latido'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, PackageOpen } from 'lucide-react'
import api from '../lib/api'
import Migas from '../components/Migas'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useCart, type Modalidad } from '../store/cart'
import { useToast } from '../store/toast'

type CotMia = {
  liga_autorizacion?: string | null
  folio: string
  estado: string
  estado_label: string
  tipo: string
  total: string
  aplica_iva: boolean
  creada: string
  vence_el: string | null
  items: { descripcion: string; cantidad: number }[]
  carrito: { id: number; title: string; price: number; qty: number; unit: Modalidad }[]
  pdf: string | null
  atendida_por?: string | null
}
type RentaMia = { id: number; equipo: string; modalidad: string; fecha_inicio: string; fecha_fin: string; estado?: string }

const monoLabel = 'text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase'
const UNIT_TXT: Record<string, string> = { venta: 'compra', dia: 'renta por día', semana: 'renta por semana', mes: 'renta por mes' }
const PILL: Record<string, string> = {
  enviada: 'text-gold border-gold/40 bg-gold-soft/40',
  aceptada: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  rechazada: 'text-red-500 border-red-500/40 bg-red-500/10',
  vencida: 'text-mute border-edge bg-surface-2',
  borrador: 'text-mute border-edge bg-surface-2',
  por_autorizar: 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10',
  cancelada: 'text-red-500 border-red-500/40 bg-red-500/10',
}
const LINEA_ESTADO: Record<string, string> = {
  enviada: 'ESPERANDO DISPONIBILIDAD · TE CONTACTAMOS HOY',
  aceptada: 'ACEPTADA · COORDINANDO ENTREGA',
  rechazada: 'NO PROCEDIÓ',
  vencida: 'PRECIOS EXPIRADOS · VUELVE A COTIZAR',
  por_autorizar: 'ESPERANDO AUTORIZACIÓN · COMPARTE LA LIGA',
  cancelada: 'CANCELADA A TU SOLICITUD',
}

/** Mis cotizaciones (diseño "Mis Cotizaciones REMALI"): próximas entregas
 *  reales (rentas del cliente), filtros por estado, búsqueda y cards con
 *  3 acciones — Ver estado / PDF / Volver a cotizar. */
export default function MisCotizaciones() {
  const { token } = useAuth()
  const nav = useNavigate()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const [cots, setCots] = useState<CotMia[]>([])
  const [rentas, setRentas] = useState<RentaMia[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<'todas' | 'enviada' | 'aceptada' | 'vencida'>('todas')
  const [q, setQ] = useState('')

  // Tiempo real: el sello de versión cubre cotizaciones Y rentas del usuario.
  const recargar = useRef(() => {})
  useLatido('/cotizaciones/latido/', 2_500, () => recargar.current())

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-cotizaciones'); return }
    let vivo = true
    const cargar = (fondo = false) => Promise.all([
      api.get<{ cotizaciones: CotMia[] }>('/cotizaciones/mias/', { fondo } as never).then(r => r.data?.cotizaciones || []).catch(() => [] as CotMia[]),
      api.get<{ rentas: RentaMia[] }>('/rentas/mias/', { fondo } as never).then(r => r.data?.rentas || []).catch(() => [] as RentaMia[]),
    ]).then(([c, r]) => { if (vivo) { setCots(c); setRentas(r) } }).finally(() => vivo && setCargando(false))
    cargar()
    recargar.current = () => cargar(true)
    return () => { vivo = false }
  }, [token, nav])

  // Próximas entregas / recolecciones desde las rentas reales del cliente.
  const eventos = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const ev: { fecha: Date; titulo: string; sub: string }[] = []
    for (const r of rentas) {
      const ini = r.fecha_inicio ? new Date(r.fecha_inicio + 'T12:00') : null
      const fin = r.fecha_fin ? new Date(r.fecha_fin + 'T12:00') : null
      if (ini && ini >= hoy) ev.push({ fecha: ini, titulo: `Entrega · ${r.equipo}`, sub: `Inicio de renta ${UNIT_TXT[r.modalidad] || ''}`.trim() })
      if (fin && fin >= hoy) ev.push({ fecha: fin, titulo: `Recolección · ${r.equipo}`, sub: 'Fin de renta' })
    }
    return ev.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).slice(0, 3)
  }, [rentas])

  const lista = useMemo(() => cots
    .filter(c => filtro === 'todas' || c.estado === filtro)
    .filter(c => {
      const t = q.trim().toLowerCase()
      if (!t) return true
      return c.folio.toLowerCase().includes(t) || c.items.some(i => i.descripcion.toLowerCase().includes(t))
    }), [cots, filtro, q])

  function volverACotizar(c: CotMia) {
    if (!c.carrito?.length) return
    dispatch({ type: 'reemplazar', items: c.carrito.map((l, idx) => ({ lineId: Date.now() + idx, id: l.id, title: l.title, price: l.price, qty: l.qty, unit: l.unit })) })
    notify('Cotización cargada de nuevo')
    nav('/cotizacion')
  }

  const fechaCorta = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T12:00' : s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  const mesDia = (d: Date) => ({ mes: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase(), dia: String(d.getDate()).padStart(2, '0') })

  if (cargando) return <div className="bg-app min-h-screen grid place-items-center"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-8 pt-24 pb-16 flex flex-col gap-6">

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis cotizaciones' }]} /></div>
            <h1 className="text-[34px] sm:text-[44px] font-extrabold tracking-tight leading-none">Mis cotizaciones</h1>
            <p className="text-mute text-[15px] mt-2.5">Da seguimiento, descarga el PDF o vuelve a cotizar lo mismo en un clic.</p>
          </div>
          <Link to="/equipos" className="h-[48px] px-6 rounded-xl bg-gold text-black text-[15px] font-bold grid place-items-center btn-acento">+ Nueva cotización</Link>
        </div>

        {eventos.length > 0 && (
          <div className="rounded-[20px] border border-edge bg-surface overflow-hidden">
            <div className="px-6 py-5 border-b border-edge flex items-center justify-between gap-4 flex-wrap">
              <span className="text-[16px] font-bold">Próximas entregas</span>
              <span className="text-[13px] text-mute">Si necesitas mover una fecha, escríbenos y la cambiamos.</span>
            </div>
            {eventos.map((e, i) => {
              const { mes, dia } = mesDia(e.fecha)
              return (
                <div key={i} className="px-6 py-4 border-b border-edge/60 last:border-0 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl border border-edge bg-app grid place-items-center shrink-0">
                    <div className="text-center leading-none"><p className={monoLabel}>{mes}</p><p className="text-[18px] font-extrabold mt-0.5">{dia}</p></div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold leading-snug line-clamp-1">{e.titulo}</p>
                    <p className="text-[13px] text-mute mt-0.5">{e.sub}</p>
                  </div>
                  <Link to="/mis-rentas" className="text-[13.5px] font-semibold text-gold hover:opacity-80 shrink-0">Ver rentas →</Link>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5 border border-edge rounded-full p-1 bg-surface">
            {([['todas', 'Todas'], ['enviada', 'En revisión'], ['aceptada', 'Aceptadas'], ['vencida', 'Vencidas']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={`px-4 py-2 rounded-full text-[13.5px] font-bold transition-colors ${filtro === k ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Folio o equipo…"
            className="flex-1 min-w-[200px] h-[44px] px-4 rounded-xl border border-edge bg-surface text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors" />
        </div>

        {lista.length === 0 ? (
          <div className="rounded-[20px] border border-edge bg-surface px-6 py-16 text-center">
            <PackageOpen className="w-10 h-10 text-mute mx-auto mb-3" />
            <p className="text-lg font-bold">{cots.length === 0 ? 'Aún no tienes cotizaciones' : 'Nada con ese filtro'}</p>
            <p className="text-sm text-mute mt-1.5">{cots.length === 0 ? 'Arma la primera desde el catálogo.' : 'Prueba otro estado o borra la búsqueda.'}</p>
            {cots.length === 0 && <Link to="/equipos" className="inline-block mt-5 px-6 py-3 rounded-xl bg-gold text-black text-sm font-bold btn-acento">Ver equipos</Link>}
          </div>
        ) : lista.map(c => (
          <div key={c.folio} className="rounded-[20px] border border-edge bg-surface px-6 sm:px-7 py-6">
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[15px] font-bold">{c.folio}</span>
                  <span className={`${monoLabel} !text-inherit px-2.5 py-1 rounded-md border font-bold ${PILL[c.estado] || PILL.borrador}`}>{c.estado_label.toUpperCase()}</span>
                  <span className="text-[13.5px] text-mute">{fechaCorta(c.creada)}</span>
                </div>
                <p className="text-[14px] text-mute mt-2.5 line-clamp-1">
                  {(c.carrito?.length ? c.carrito.map(l => `${l.qty}× ${l.title} · ${UNIT_TXT[l.unit] || 'compra'}`) : c.items.map(i => `${i.cantidad}× ${i.descripcion}`)).join(' · ')}
                </p>
                <p className={`${monoLabel} mt-2.5`}>{LINEA_ESTADO[c.estado] || c.estado_label.toUpperCase()}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[24px] font-extrabold tracking-tight text-price leading-none">{formatMoney(c.total)}</p>
                <p className="text-[12.5px] text-mute mt-1.5">{(c.carrito?.reduce((s, l) => s + l.qty, 0) || c.items.reduce((s, i) => s + i.cantidad, 0))} equipo(s){c.tipo === 'venta' ? ' · IVA incluido' : c.aplica_iva ? ' · con IVA' : ' · sin IVA'}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-edge flex flex-wrap items-center gap-2.5">
              <Link to={`/mis-cotizaciones/${c.folio}`} className="h-[40px] px-4 rounded-xl bg-gold-soft text-gold text-[13.5px] font-bold grid place-items-center hover:opacity-85 transition-opacity">Ver estado</Link>
              {c.liga_autorizacion && (
                <button onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${c.liga_autorizacion}`); notify('Liga copiada: mándasela a quien autoriza') } catch { notify('No se pudo copiar', 'x') } }}
                  className="h-[40px] px-4 rounded-xl border border-amber-500/40 text-amber-600 dark:text-amber-400 text-[13.5px] font-bold hover:bg-amber-500/10 transition-colors">
                  Copiar liga del jefe
                </button>
              )}
              {c.pdf && <a href={c.pdf} target="_blank" rel="noopener noreferrer" className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold grid place-items-center hover:bg-surface-2 transition-colors">↓ PDF</a>}
              {c.carrito?.length > 0 && <button onClick={() => volverACotizar(c)} className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold hover:bg-surface-2 transition-colors">⟳ Volver a cotizar</button>}
              <span className="ml-auto text-[12.5px] text-mute">
                {c.estado === 'vencida' ? `Venció el ${fechaCorta(c.vence_el)}` : c.atendida_por ? `Te atiende ${c.atendida_por}` : c.vence_el ? `Vigente hasta ${fechaCorta(c.vence_el)}` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
