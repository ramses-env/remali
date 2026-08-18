import { useEffect, useMemo, useRef, useState } from 'react'
import { useClienteEventos } from '../lib/clienteEventos'
import { useLatido } from '../lib/latido'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, PackageOpen } from 'lucide-react'
import api from '../lib/api'
import Migas from '../components/Migas'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useCart, type Modalidad } from '../store/cart'
import { useToast } from '../store/toast'
import {
  listarBorradores, eliminarBorrador, duplicarBorrador, enviarBorrador, actualizarBorrador,
  mandarAAutorizar, retirarPaquete, migrarBorradoresLocales, reclamarEspacio,
  totalBorrador, resumenBorrador, aLineasDeCarrito, tieneEquiposCaidos,
  MAX_BORRADORES, type Borrador, type Paquete,
} from '../lib/borradores'

type CotMia = {
  folio: string
  estado: string
  estado_label: string
  tipo: string
  total: string
  aplica_iva: boolean
  creada: string
  vence_el: string | null
  items: { descripcion: string; cantidad: number }[]
  carrito: { id: number; title: string; price: number; qty: number; duracion?: number; unit: Modalidad }[]
  pdf: string | null
  atendida_por?: string | null
  /** Nombre de quien la autorizó del lado del cliente, si vino firmada. */
  autorizada_por?: string | null
}

const monoLabel = 'text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase'
const UNIT_TXT: Record<string, string> = { venta: 'compra', dia: 'renta por día', semana: 'renta por semana', mes: 'renta por mes' }
const PILL: Record<string, string> = {
  enviada: 'text-gold-ink border-gold/40 bg-gold-soft/40',
  aceptada: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  rechazada: 'text-red-500 border-red-500/40 bg-red-500/10',
  vencida: 'text-mute border-edge bg-surface-2',
  borrador: 'text-mute border-edge bg-surface-2',
  cancelada: 'text-red-500 border-red-500/40 bg-red-500/10',
}
const LINEA_ESTADO: Record<string, string> = {
  enviada: 'ESPERANDO DISPONIBILIDAD · TE CONTACTAMOS HOY',
  aceptada: 'ACEPTADA · COORDINANDO ENTREGA',
  rechazada: 'NO PROCEDIÓ',
  vencida: 'PRECIOS EXPIRADOS · VUELVE A COTIZAR',
  cancelada: 'CANCELADA A TU SOLICITUD',
}
// Color de la línea "qué sigue" según el estado (igual criterio que los badges).
const LINEA_TONO: Record<string, string> = {
  enviada: 'text-gold-ink',
  aceptada: 'text-emerald-500',
  rechazada: 'text-mute',
  vencida: 'text-mute',
  cancelada: 'text-mute',
}

/** Resumen corto de las líneas de una cotización enviada (para la card y las
 *  filas del lote). */
function resumenCot(c: CotMia): string {
  return (c.carrito?.length
    ? c.carrito.map(l => `${l.qty}× ${l.title} · ${UNIT_TXT[l.unit] || 'compra'}${l.unit !== 'venta' && (l.duracion || 1) > 1 ? ` (${l.duracion} ${({ dia: 'días', semana: 'semanas', mes: 'meses' } as Record<string, string>)[l.unit] || ''})` : ''}`)
    : c.items.map(i => `${i.cantidad}× ${i.descripcion}`)
  ).join(' · ')
}

type ObraCli = { id: number; nombre: string; empresa: string; responsable: string; direccion: string; telefono: string; email: string; predeterminada?: boolean }
type PerfilLote = { first_name?: string; last_name?: string; empresa?: string; email?: string; telefono?: string }

/** Modal: manda uno o varios borradores a autorizar bajo UNA sola liga.
 *  Toma el contacto del perfil y UNA obra (la misma para todas), se las fija a
 *  los borradores y crea el paquete. Mandar uno y mandar tres es el mismo
 *  camino: el paquete de uno no es un caso especial. */
function AutorizarModal({ seleccion, onClose, onEnviado, notify }: {
  seleccion: Borrador[]
  onClose: () => void
  onEnviado: () => void
  notify: (m: string, kind?: 'x') => void
}) {
  const [perfil, setPerfil] = useState<PerfilLote | null>(null)
  const [obras, setObras] = useState<ObraCli[]>([])
  const [obraId, setObraId] = useState<number | null>(null)
  const [factura, setFactura] = useState(false)
  const [modo, setModo] = useState<'opciones' | 'lista'>(seleccion.length > 1 ? 'opciones' : 'lista')
  const [mensaje, setMensaje] = useState('')
  const [creando, setCreando] = useState(false)
  const [liga, setLiga] = useState<string | null>(null)
  const [copiada, setCopiada] = useState(false)

  useEffect(() => {
    api.get<PerfilLote>('/auth/perfil/').then(r => setPerfil(r.data || {})).catch(() => setPerfil({}))
    api.get<ObraCli[]>('/obras-cliente/').then(r => {
      const list = r.data || []
      setObras(list)
      const pred = list.find(o => o.predeterminada) || list[0]
      if (pred) setObraId(pred.id)
    }).catch(() => {})
  }, [])

  const totalLote = seleccion.reduce((s, b) => s + totalBorrador(b), 0)
  const nombre = `${perfil?.first_name || ''} ${perfil?.last_name || ''}`.trim()
  const obra = obras.find(o => o.id === obraId) || null
  const listo = !!nombre && !!obra && !!(obra.direccion || '').trim()
  const varias = seleccion.length > 1

  async function crear() {
    if (!listo || !obra) return
    setCreando(true)
    try {
      // Los datos de contacto y obra se guardan EN cada borrador antes de
      // congelarlo: es lo que la cotización va a llevar si el jefe la autoriza.
      for (const b of seleccion) {
        await actualizarBorrador(b.id, {
          requiere_factura: factura,
          datos_contacto: {
            nombre,
            empresa: perfil?.empresa || obra.empresa || '',
            email: perfil?.email || '',
            telefono: perfil?.telefono || '',
          },
          obra: {
            responsable: obra.responsable,
            direccion: obra.direccion,
            telefono: obra.telefono,
            email: obra.email,
          },
        })
      }
      const paquete = await mandarAAutorizar(seleccion.map(b => b.id), modo, mensaje.trim())
      setLiga(`${window.location.origin}${paquete.liga}`)
    } catch (e) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo crear la liga', 'x')
    } finally {
      setCreando(false)
    }
  }

  async function copiar() {
    if (!liga) return
    try { await navigator.clipboard.writeText(liga); setCopiada(true); setTimeout(() => setCopiada(false), 2000) } catch { notify('No se pudo copiar', 'x') }
  }

  const wa = liga ? `https://wa.me/?text=${encodeURIComponent(`Hola, te comparto ${seleccion.length === 1 ? 'una cotización' : `${seleccion.length} cotizaciones`} de maquinaria para autorizar. Ábrela, revisa el total y autorízala aquí:\n${liga}`)}` : ''

  return (
    <div className="modal-in fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl border border-edge sm:my-auto max-h-[92vh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        <div className="px-6 py-5 border-b border-edge flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-ink tracking-tight">Mandar a autorizar</h2>
            <p className="text-[13px] text-mute mt-0.5">{seleccion.length} {seleccion.length === 1 ? 'cotización' : 'cotizaciones'} · total {formatMoney(totalLote)}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 text-mute hover:text-ink hover:bg-edge/60 transition-colors flex items-center justify-center" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
          {liga ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-emerald-500/10 p-4">
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">Liga lista para quien autoriza</p>
                <p className="text-[13px] text-mute mt-1">
                  Los precios quedaron congelados 15 días. REMALI solo se entera de lo que se autorice.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface-2 px-3 py-2.5">
                <span className="flex-1 text-[13px] text-mute truncate font-mono">{liga}</span>
                <button onClick={copiar} className="shrink-0 h-9 px-3 rounded-lg bg-gold text-black text-[13px] font-bold hover:opacity-90 transition-opacity">{copiada ? '✓ Copiada' : 'Copiar'}</button>
              </div>
              <a href={wa} target="_blank" rel="noopener noreferrer" className="h-11 rounded-xl bg-[#25D366] text-white text-sm font-bold grid place-items-center hover:opacity-90 transition-opacity">Compartir por WhatsApp</a>
              <button onClick={onEnviado} className="h-11 rounded-xl border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Listo</button>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-edge overflow-hidden">
                {seleccion.map((b, i) => (
                  <div key={b.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-edge' : ''}`}>
                    <span className="text-[13.5px] text-ink truncate">{resumenBorrador(b)}</span>
                    <span className="text-[13.5px] font-bold text-ink shrink-0">{formatMoney(totalBorrador(b))}</span>
                  </div>
                ))}
              </div>

              {varias && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-mute mb-2">¿Qué son estas {seleccion.length}?</p>
                  <div className="flex flex-col gap-2">
                    {([['opciones', 'Opciones de lo mismo', 'Quien autoriza escoge UNA; las demás se descartan.'],
                       ['lista', 'Cosas distintas', 'Puede autorizar las que quiera, cada una por separado.']] as const).map(([k, t, d]) => (
                      <label key={k} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${modo === k ? 'border-gold/60 bg-gold-soft/25' : 'border-edge hover:bg-surface-2'}`}>
                        <input type="radio" name="modo" checked={modo === k} onChange={() => setModo(k)} className="mt-0.5 w-4 h-4 accent-gold" />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-bold text-ink">{t}</span>
                          <span className="block text-[12.5px] text-mute mt-0.5">{d}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-mute mb-1.5">Recado para quien autoriza <span className="normal-case font-normal">(opcional)</span></p>
                <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={2}
                  placeholder="Ej. Es para la obra Norte, la necesitamos el martes."
                  className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors resize-none" />
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-mute mb-1.5">A nombre de</p>
                {nombre
                  ? <p className="text-sm text-ink">{nombre}{perfil?.empresa ? ` · ${perfil.empresa}` : ''}</p>
                  : <p className="text-[13px] text-red-500">Completa tu nombre en tu perfil para mandarla.</p>}
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-mute mb-1.5">Obra{varias ? ' · la misma para todas' : ''}</p>
                {obras.length
                  ? <select value={obraId ?? ''} onChange={e => setObraId(Number(e.target.value))} className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-gold/60 transition-colors">
                      {obras.map(o => <option key={o.id} value={o.id} className="bg-surface">{o.direccion || o.nombre}{o.responsable ? ` · ${o.responsable}` : ''}</option>)}
                    </select>
                  : <p className="text-[13px] text-mute">No tienes obras guardadas. <Link to="/cotizacion" className="text-gold-ink font-semibold">Guarda una en el armador</Link> y regresa.</p>}
              </div>

              <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={factura} onChange={e => setFactura(e.target.checked)} className="w-4 h-4 accent-gold" />
                Necesito factura (suma IVA a las rentas)
              </label>
            </>
          )}
        </div>

        {!liga && (
          <div className="px-6 py-4 border-t border-edge flex items-center justify-between gap-3">
            <button onClick={onClose} className="h-11 px-4 rounded-xl text-mute hover:text-ink hover:bg-surface-2 text-sm font-semibold transition-colors">Cancelar</button>
            <button onClick={crear} disabled={creando || !listo} className="h-11 px-5 rounded-xl bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 btn-acento">
              {creando ? 'Creando…' : 'Crear liga de autorización'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Mis cotizaciones (diseño v2): borradores del cliente (locales, sin enviar)
 *  arriba, y abajo las que ya mandó — con filtros por estado, búsqueda y las
 *  acciones Ver estado / PDF / Volver a cotizar. */
export default function MisCotizaciones() {
  const { token } = useAuth()
  const nav = useNavigate()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const [cots, setCots] = useState<CotMia[]>([])
  const [cargando, setCargando] = useState(true)
  /* ?tab=borradores lo usa la liga de rescate del invitado: llega buscando SUS
     borradores, no la lista de lo que ya mandó. */
  const [params] = useSearchParams()
  const [filtro, setFiltro] = useState<'todas' | 'borradores' | 'enviada' | 'aceptada' | 'vencida'>(
    params.get('tab') === 'borradores' ? 'borradores' : 'todas')
  const [q, setQ] = useState('')

  /* Borradores: viven en el SERVIDOR, en su propia tabla. REMALI no los ve —
     un borrador no existe para el negocio hasta que el cliente lo manda. */
  const [borradores, setBorradores] = useState<Borrador[]>([])
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const [confirmando, setConfirmando] = useState<number | null>(null)
  // Modo lote: marcar varios borradores para mandarlos JUNTOS a autorizar.
  const [seleccionando, setSeleccionando] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [loteAbierto, setLoteAbierto] = useState(false)

  const toggleSel = (id: number) => setSeleccion(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const salirSeleccion = () => { setSeleccionando(false); setSeleccion(new Set()) }
  const recargarBorradores = async () => {
    try {
      const { borradores: bs, paquetes: ps } = await listarBorradores()
      setBorradores(bs)
      setPaquetes(ps)
    } catch { /* la lista de enviadas sigue sirviendo aunque esto falle */ }
  }

  const loteEnviado = () => {
    setLoteAbierto(false)
    salirSeleccion()
    recargarBorradores()
    notify('Mandada a autorizar. Comparte la liga con quien autoriza.')
  }

  // Push real por WebSocket; el latido queda solo como red de seguridad.
  const recargar = useRef(() => {})
  useClienteEventos((evt) => {
    if (evt.topic === 'cotizaciones') recargar.current()
  })
  useLatido('/cotizaciones/latido/', 15_000, () => recargar.current())

  useEffect(() => {
    if (!token) { nav('/login?next=/mis-cotizaciones'); return }
    let vivo = true
    const cargar = (fondo = false) =>
      api.get<{ cotizaciones: CotMia[] }>('/cotizaciones/mias/', { fondo } as never)
        .then(r => { if (vivo) setCots(r.data?.cotizaciones || []) })
        .catch(() => {})
        .finally(() => vivo && setCargando(false))
    cargar()
    recargar.current = () => cargar(true)
    /* Primero se adoptan los borradores que armó como invitado y se suben los
       que quedaron en localStorage de la versión anterior; recién entonces se
       lee la lista, o el cliente vería su taller vacío por un instante. */
    reclamarEspacio()
      .then(() => migrarBorradoresLocales())
      .then(n => { if (n) notify(`Subimos ${n} borrador(es) que tenías guardados en este navegador`) })
      .finally(() => { if (vivo) recargarBorradores() })
    return () => { vivo = false }
  }, [token, nav])

  const lista = useMemo(() => cots
    .filter(c => filtro === 'todas' || c.estado === filtro)
    .filter(c => {
      const t = q.trim().toLowerCase()
      if (!t) return true
      return c.folio.toLowerCase().includes(t) || c.items.some(i => i.descripcion.toLowerCase().includes(t))
    }), [cots, filtro, q])

  /* En el taller solo se ven los que el cliente todavía tiene en sus manos.
     Los ya entregados viven abajo, como cotizaciones con folio. */
  const borradoresVisibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return borradores
      .filter(b => b.estado === 'armando' || b.estado === 'rechazado')
      .filter(b => !t || b.nombre.toLowerCase().includes(t) || b.items.some(i => i.descripcion.toLowerCase().includes(t)))
  }, [borradores, q])

  const paquetesPendientes = useMemo(
    () => paquetes.filter(p => p.estado === 'pendiente'), [paquetes])

  // Qué se muestra: en "Borradores" solo borradores; en "Todas" ambos; en los
  // demás filtros, solo enviadas.
  const mostrarEnviadas = filtro !== 'borradores'
  const mostrarSeccionBorradores = filtro === 'borradores' || (filtro === 'todas' && borradoresVisibles.length > 0)

  function seguirEditando(b: Borrador) {
    dispatch({ type: 'reemplazar', items: aLineasDeCarrito(b) })
    if (tieneEquiposCaidos(b)) notify('Alguno de sus equipos ya no está en el catálogo; lo quitamos', 'x')
    else notify('Borrador cargado — sigue editándolo')
    nav('/cotizacion')
  }

  async function duplicar(b: Borrador) {
    try {
      await duplicarBorrador(b.id)
      await recargarBorradores()
      notify('Copia lista — ajústala y vuelve a mandarla')
    } catch (e) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo duplicar', 'x')
    }
  }

  async function retirar(p: Paquete) {
    try {
      await retirarPaquete(p.id)
      await recargarBorradores()
      notify('Liga retirada: tus borradores volvieron a estar editables')
    } catch {
      notify('No se pudo retirar', 'x')
    }
  }

  /* Envío DIRECTO a REMALI (sin jefe). El servidor ya tiene los datos del
     borrador; si le faltan los de contacto avisa con `faltan_datos` y lo
     mandamos al armador, que es donde se capturan. */
  async function enviarABorradorRemali(b: Borrador) {
    try {
      const { folio } = await enviarBorrador(b.id)
      await recargarBorradores()
      recargar.current()
      notify(`Solicitud enviada · ${folio}`)
    } catch (e) {
      const err = e as { response?: { data?: { detalle?: string; codigo?: string } } }
      if (err?.response?.data?.codigo === 'faltan_datos') {
        nav('/cotizacion', { state: { enviarBorradorId: b.id } })
        return
      }
      notify(err?.response?.data?.detalle || 'No se pudo enviar', 'x')
    }
  }

  // A autorización: abre el modal con este borrador como única selección.
  function autorizarBorradorRemali(b: Borrador) {
    setSeleccion(new Set([b.id]))
    setLoteAbierto(true)
  }

  async function borrar(id: number) {
    try {
      await eliminarBorrador(id)
      await recargarBorradores()
      notify('Borrador borrado')
    } catch {
      notify('No se pudo borrar', 'x')
    } finally {
      setConfirmando(null)
    }
  }

  function volverACotizar(c: CotMia) {
    if (!c.carrito?.length) return
    dispatch({ type: 'reemplazar', items: c.carrito.map((l, idx) => ({ lineId: Date.now() + idx, id: l.id, title: l.title, price: l.price, qty: l.qty, duracion: l.duracion, unit: l.unit })) })
    notify('Cotización cargada de nuevo')
    nav('/cotizacion')
  }

  const fechaCorta = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T12:00' : s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  const fechaHora = (s: string) => {
    const d = new Date(s)
    if (isNaN(d.getTime())) return ''
    return `${d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}`
  }

  const tabs = [
    ['todas', 'Todas', null],
    ['borradores', 'Borradores', borradores.filter(b => b.estado === 'armando' || b.estado === 'rechazado').length],
    ['enviada', 'En revisión', null],
    ['aceptada', 'Aceptadas', null],
    ['vencida', 'Vencidas', null],
  ] as const

  if (cargando) return <div className="bg-app min-h-screen grid place-items-center"><Loader2 className="w-8 h-8 text-gold-ink animate-spin" /></div>

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="contenedor pt-24 pb-16 flex flex-col gap-6">

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mis cotizaciones' }]} /></div>
            <h1 className="text-[34px] sm:text-[44px] font-extrabold tracking-tight leading-none">Mis cotizaciones</h1>
            <p className="text-mute text-[15px] mt-2.5">Tus borradores y las que ya mandaste, en un solo lugar.</p>
          </div>
          <Link to="/equipos" className="h-[48px] px-6 rounded-xl bg-gold text-black text-[15px] font-bold grid place-items-center btn-acento">+ Nueva cotización</Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-nowrap gap-1.5 border border-edge rounded-full p-1 bg-surface max-w-full overflow-x-auto no-scrollbar">
            {tabs.map(([k, l, n]) => {
              const on = filtro === k
              return (
                <button key={k} onClick={() => setFiltro(k)}
                  className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-[13.5px] font-bold whitespace-nowrap transition-colors ${on ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}>
                  <span>{l}</span>
                  {n ? <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${on ? 'bg-black/15 text-black' : 'bg-surface-2 text-mute'}`}>{n}</span> : null}
                </button>
              )
            })}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Folio o equipo…"
            className="flex-1 min-w-[200px] h-[44px] px-4 rounded-xl border border-edge bg-surface text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 transition-colors" />
        </div>

        {/* ── Esperando a quien autoriza (aún NO llegan a REMALI) ── */}
        {paquetesPendientes.length > 0 && filtro !== 'enviada' && filtro !== 'aceptada' && (
          <section className="rounded-[20px] border border-amber-500/30 bg-surface overflow-hidden">
            <div className="px-6 py-5 border-b border-edge">
              <div className="text-[17px] font-bold tracking-tight">Esperando autorización</div>
              <div className="text-[13.5px] text-mute mt-1">
                Ya se las mandaste a quien autoriza. REMALI todavía no las ve: solo se entera de lo que se autorice.
              </div>
            </div>
            {paquetesPendientes.map(pq => {
              const liga = `${window.location.origin}${pq.liga}`
              const n = pq.borradores?.length || 0
              const wa = `https://wa.me/?text=${encodeURIComponent(`Hola, te comparto una cotización de maquinaria para autorizar. Ábrela, revisa el total y autorízala aquí:\n${liga}`)}`
              return (
                <div key={pq.id} className="px-6 py-4 border-t border-edge flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[16.5px] font-bold tracking-tight">{formatMoney(Number(pq.total))}</span>
                      <span className={`text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full whitespace-nowrap border ${pq.vencido ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'}`}>
                        {pq.vencido ? 'Liga vencida' : 'Esperando'}
                      </span>
                      {pq.modo === 'opciones' && n > 1 && (
                        <span className="text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full bg-surface-2 text-mute border border-edge whitespace-nowrap">Escoge una de {n}</span>
                      )}
                    </div>
                    <div className="text-[13.5px] text-mute mt-1.5">
                      {pq.vencido
                        ? 'Los precios que congelamos ya caducaron. Retírala y vuelve a mandarla.'
                        : `Precios congelados${pq.vence_el ? ` hasta el ${fechaCorta(pq.vence_el)}` : ''}.`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {!pq.vencido && <>
                      <button onClick={async () => { try { await navigator.clipboard.writeText(liga); notify('Liga copiada: mándasela a quien autoriza') } catch { notify('No se pudo copiar', 'x') } }}
                        className="h-[40px] px-4 rounded-xl bg-gold-soft text-gold-ink text-[13.5px] font-bold grid place-items-center hover:opacity-85 transition-opacity">Copiar liga</button>
                      <a href={wa} target="_blank" rel="noopener noreferrer" className="h-[40px] px-4 rounded-xl border border-[#25D366]/40 text-[#1c9d4d] dark:text-[#25D366] text-[13.5px] font-bold grid place-items-center hover:bg-[#25D366]/10 transition-colors">WhatsApp</a>
                    </>}
                    <button onClick={() => retirar(pq)} className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold hover:bg-surface-2 transition-colors whitespace-nowrap">Retirar</button>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {/* ── Borradores: el taller privado del cliente ── */}
        {mostrarSeccionBorradores && (
          <section className="rounded-[20px] border border-edge bg-surface overflow-hidden">
            <div className="flex items-center justify-between gap-5 px-6 py-5 border-b border-edge flex-wrap">
              <div className="min-w-0">
                <div className="text-[17px] font-bold tracking-tight">Borradores</div>
                <div className="text-[13.5px] text-mute mt-1">
                  {seleccionando ? 'Marca las cotizaciones que van juntas a autorizar.' : 'Todavía no llegan a REMALI. Cárgalos para seguir editando o mándalos cuando estén listos.'}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {borradoresVisibles.length >= 2 && !q && (
                  <button onClick={() => (seleccionando ? salirSeleccion() : setSeleccionando(true))}
                    className={`text-[13px] font-bold transition-colors ${seleccionando ? 'text-mute hover:text-ink' : 'text-gold-ink hover:opacity-80'}`}>
                    {seleccionando ? 'Cancelar' : 'Seleccionar para lote'}
                  </button>
                )}
                {!seleccionando && <span className="text-[13px] text-mute whitespace-nowrap hidden sm:inline">Precio del día · máx. {MAX_BORRADORES}</span>}
              </div>
            </div>

            {borradoresVisibles.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-[16px] font-bold">{q ? 'Ningún borrador coincide' : 'No tienes borradores'}</div>
                <div className="text-[14px] text-mute mt-1.5">{q ? 'Prueba con otra búsqueda.' : 'Arma una cotización y guárdala para mandarla después.'}</div>
              </div>
            ) : borradoresVisibles.map((b, i) => {
              const sel = seleccion.has(b.id)
              return (
              <div key={b.id} className={`flex items-center justify-between gap-4 px-6 py-4 border-t border-edge flex-wrap transition-colors ${seleccionando && sel ? 'bg-gold-soft/25' : ''}`}>
                <div className={`flex items-center gap-4 min-w-[240px] flex-1 ${seleccionando ? 'cursor-pointer select-none' : ''}`}
                  onClick={seleccionando ? () => toggleSel(b.id) : undefined}>
                  {seleccionando ? (
                    <div className={`w-[42px] h-[42px] shrink-0 rounded-xl grid place-items-center border-2 transition-colors ${sel ? 'bg-gold border-gold text-black' : 'bg-surface-2 border-edge text-transparent'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                  ) : (
                    <div className="w-[42px] h-[42px] shrink-0 rounded-xl grid place-items-center text-[14px] font-bold bg-surface-2 text-mute border border-edge">V{i + 1}</div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[16.5px] font-bold tracking-tight">{formatMoney(totalBorrador(b))}</span>
                      {b.estado === 'rechazado'
                        ? <span title={b.rechazo_motivo} className="text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full bg-red-500/10 text-red-500 border border-red-500/30 whitespace-nowrap">No autorizada</span>
                        : <span className="text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full bg-surface-2 text-mute border border-edge whitespace-nowrap">Sin mandar</span>}
                    </div>
                    <div className="text-[13.5px] text-mute mt-1.5">{resumenBorrador(b)} · {fechaHora(b.creado)}</div>
                    {b.estado === 'rechazado' && b.rechazo_motivo && (
                      <div className="text-[13px] text-red-500 mt-1">Motivo: {b.rechazo_motivo}</div>
                    )}
                  </div>
                </div>
                {!seleccionando && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {b.estado === 'rechazado' ? (
                      <button onClick={() => duplicar(b)} title="Lo que ya juzgaron se queda como registro; trabajas sobre una copia" className="h-[40px] px-4 rounded-xl bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition-opacity whitespace-nowrap btn-acento">Duplicar y corregir</button>
                    ) : (<>
                    <button onClick={() => seguirEditando(b)} className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold hover:bg-surface-2 transition-colors whitespace-nowrap">Seguir editando</button>
                    <button onClick={() => autorizarBorradorRemali(b)} title="Quien autoriza recibe una liga; al autorizarla llega sola a REMALI" className="h-[40px] px-4 rounded-xl border border-gold/40 text-gold-ink text-[13.5px] font-bold hover:bg-gold-soft transition-colors whitespace-nowrap">Mandar a autorizar</button>
                    <button onClick={() => enviarABorradorRemali(b)} className="h-[40px] px-4 rounded-xl bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition-opacity whitespace-nowrap btn-acento">Enviar a REMALI</button>
                    </>)}
                    <button onClick={() => setConfirmando(confirmando === b.id ? null : b.id)} aria-label="Borrar borrador"
                      className="w-[38px] h-[38px] rounded-lg text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors grid place-items-center">
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}

                {!seleccionando && confirmando === b.id && (
                  <div className="w-full flex items-center justify-between gap-4 mt-1 px-4 py-3 rounded-xl bg-red-500/10 flex-wrap">
                    <span className="text-[13.5px] font-medium text-red-600 dark:text-red-400">¿Borrar este borrador? No se puede deshacer.</span>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setConfirmando(null)} className="h-9 px-3.5 rounded-lg text-mute hover:text-ink hover:bg-surface-2 text-[13px] font-semibold transition-colors">Mejor no</button>
                      <button onClick={() => borrar(b.id)} className="h-9 px-3.5 rounded-lg bg-red-500 text-white text-[13px] font-bold hover:bg-red-600 transition-colors whitespace-nowrap">Sí, borrar</button>
                    </div>
                  </div>
                )}
              </div>
              )
            })}

            {seleccionando && borradoresVisibles.length > 0 && (
              <div className="px-6 py-4 border-t border-edge flex items-center justify-between gap-4 flex-wrap bg-surface-2/40">
                <span className="text-[13.5px] text-mute">{seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'} para el lote</span>
                <button onClick={() => setLoteAbierto(true)} disabled={seleccion.size === 0}
                  className="h-[42px] px-5 rounded-xl bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 btn-acento">
                  Mandar lote a autorizar{seleccion.size ? ` (${seleccion.size})` : ''}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Enviadas (viven en el backend) ── */}
        {mostrarEnviadas && (lista.length === 0 ? (
          <div className="rounded-[20px] border border-edge bg-surface px-6 py-16 text-center">
            <PackageOpen className="w-10 h-10 text-mute mx-auto mb-3" />
            <p className="text-lg font-bold">{cots.length === 0 ? (borradores.length ? 'No has enviado ninguna todavía' : 'Aún no tienes cotizaciones') : 'Nada con ese filtro'}</p>
            <p className="text-sm text-mute mt-1.5">{cots.length === 0 ? 'Cuando mandes un borrador a REMALI, aparecerá aquí.' : 'Prueba otro estado o borra la búsqueda.'}</p>
            {cots.length === 0 && borradores.length === 0 && <Link to="/equipos" className="inline-block mt-5 px-6 py-3 rounded-xl bg-gold text-black text-sm font-bold btn-acento">Ver equipos</Link>}
          </div>
        ) : lista.map(c => (
          <div key={c.folio} className="rounded-[20px] border border-edge bg-surface px-6 sm:px-7 py-6 transition-colors hover:border-edge/80">
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[15px] font-bold">{c.folio}</span>
                  <span className={`${monoLabel} !text-inherit px-2.5 py-1 rounded-md border font-bold ${PILL[c.estado] || PILL.borrador}`}>{c.estado_label.toUpperCase()}</span>
                  <span className="text-[13.5px] text-mute">{fechaCorta(c.creada)}</span>
                </div>
                <p className="text-[14px] text-mute mt-2.5 line-clamp-1">{resumenCot(c)}</p>
                <p className={`${monoLabel} !text-inherit mt-2.5 font-semibold ${LINEA_TONO[c.estado] || 'text-mute'}`}>{LINEA_ESTADO[c.estado] || c.estado_label.toUpperCase()}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[24px] font-extrabold tracking-tight text-price leading-none">{formatMoney(c.total)}</p>
                <p className="text-[12.5px] text-mute mt-1.5">{(c.carrito?.reduce((s, l) => s + l.qty, 0) || c.items.reduce((s, i) => s + i.cantidad, 0))} equipo(s){c.tipo === 'venta' ? ' · IVA incluido' : c.aplica_iva ? ' · con IVA' : ' · sin IVA'}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-edge flex flex-wrap items-center gap-2.5">
              <Link to={`/mis-cotizaciones/${c.folio}`} className="h-[40px] px-4 rounded-xl bg-gold-soft text-gold-ink text-[13.5px] font-bold grid place-items-center hover:opacity-85 transition-opacity">Ver estado</Link>
              {c.pdf && <a href={c.pdf} target="_blank" rel="noopener noreferrer" className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold grid place-items-center hover:bg-surface-2 transition-colors">↓ PDF</a>}
              {c.carrito?.length > 0 && <button onClick={() => volverACotizar(c)} className="h-[40px] px-4 rounded-xl border border-edge text-[13.5px] font-semibold hover:bg-surface-2 transition-colors">⟳ Volver a cotizar</button>}
              <span className="ml-auto text-[12.5px] text-mute">
                {c.estado === 'vencida' ? `Venció el ${fechaCorta(c.vence_el)}` : c.atendida_por ? `Te atiende ${c.atendida_por}` : c.vence_el ? `Vigente hasta ${fechaCorta(c.vence_el)}` : ''}
              </span>
            </div>
          </div>
        )))}
      </div>

      {loteAbierto && (
        <AutorizarModal
          seleccion={borradores.filter(b => seleccion.has(b.id))}
          onClose={() => { setLoteAbierto(false); if (!seleccionando) setSeleccion(new Set()) }}
          onEnviado={loteEnviado}
          notify={notify}
        />
      )}
    </div>
  )
}
