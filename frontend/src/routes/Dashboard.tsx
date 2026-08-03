import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import api from '../lib/api'
import { formatMoney } from '../lib/utils'
import DialogoHost, { confirmar, pedir, elegir } from '../components/Dialogo'

import TicketModal from '../components/TicketModal'
import VentaDetalleModal from '../components/VentaDetalleModal'
import EtiquetaModal from '../components/EtiquetaModal'
import OrdenCartaModal from '../components/OrdenCartaModal'
import CotizacionCartaModal from '../components/CotizacionCartaModal'
import FichaTecnicaModal from '../components/FichaTecnicaModal'
import AsistenteIA from '../components/AsistenteIA'
import AddressAutocomplete from '../components/AddressAutocomplete'
import Dock, { type DockItem } from '../components/ui/dock'
import { formatAddress, addressToFields, type AddressResult } from '../lib/geocoding'
import { REGIMEN_FISCAL, USO_CFDI, RFC_PUBLICO_GENERAL } from '../lib/sat'
import { usePrintSettings, charsPerLine } from '../lib/printSettings'
import { invalidarConfigPublica } from '../lib/configPublica'
import { AnimatePresence, motion } from 'framer-motion'
import { useRecurso, invalidar, type Tema } from '../lib/realtime'
import { useLatidoPanel } from '../lib/latido'
import { conectarAvisos } from '../lib/avisos'
import { CLAVE_NIVEL, recordarAcceso, ProveedorPermisos, usePuede, type Capacidades } from '../lib/acceso'
import { buildTestTicket } from '../lib/escpos'
import { METODOS, metodoSoportado, imprimirTermico, vincularMetodo, metodoVinculado, infoMetodo } from '../lib/printer'
import { useAuth } from '../store/auth'
import ThemeToggle from '../components/ThemeToggle'
import { KpiGrid } from '../components/ui/kpi-grid'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import { descargarBlob } from '../lib/descargar'
import LogoRemali from '../components/ui/logo-remali'
import { waLink } from '../lib/whatsapp'
import { useLang } from '../lib/i18n'

/** Number laxo para métricas: null/''/basura → 0. */
const num = (v: any) => Number(v) || 0

/* ─────────── Tipos ─────────── */
type Option = { id: number; nombre: string }
type Equipo = {
  id?: number
  modelo: string
  descripcion?: string
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  precio_venta?: number | string | null
  imagen?: string | null
  ficha_tecnica?: string | null
  especificaciones?: { etiqueta: string; valor: string }[]
  que_incluye?: string[]
  promo_pct?: number
  categoria?: Option | null
  tipo?: Option | null
  marca?: Option | null
  disponible_venta?: boolean
  disponible_renta?: boolean
  condiciones?: string[]
  stock_disponible?: number
  unidades_total?: number
  unidades_rentadas?: number
}
type Coupon = { id?: number; codigo: string; descuento: number; activo?: boolean }
type Refaccion = {
  id: number; nombre: string; descripcion?: string | null; precio_venta: string
  stock: number; stock_minimo: number; para_venta: boolean; ubicacion?: string
  codigo_barras: string; bajo_stock: boolean; fecha_creacion?: string
}
type OrdenReparacionItem = {
  id: number; origen: 'stock' | 'externa'; refaccion?: number | null; refaccion_nombre?: string
  nombre: string; cantidad: number; costo_unitario: string; subtotal: string
}
type OrdenReparacion = {
  id: number; folio: string; tipo: 'cliente' | 'interna'
  estado: 'recibida' | 'proceso' | 'terminada' | 'entregada'
  cliente_nombre: string; cliente_telefono: string; empresa?: number | null; empresa_nombre?: string
  unidad?: number | null; unidad_codigo?: string; equipo_descripcion: string; numero_serie: string
  diagnostico: string; trabajo_realizado: string; costo_mano_obra: string; notas: string
  items: OrdenReparacionItem[]; total_refacciones: string; total: string
  cliente_display: string; equipo_display: string
  fecha_recibida: string; fecha_entrega?: string | null; actualizado_en?: string
}
type Venta = {
  id: number
  nombre_cliente?: string | null
  empresa?: string | null
  subtotal?: string
  iva?: string
  estado?: string
  total: string
  metodo_pago: string
  fecha: string
  vendedor?: string | null
  telefono_cliente?: string | null
  cuenta?: string | null
  unidad?: { id: number; codigo: string; numero_serie?: string | null; equipo?: string | null } | null
  origen?: { folio: string; resumen: string } | null
}
type RentaActiva = {
  id: number
  inventario: { id: number; codigo?: string; numero_serie?: string | null; equipo?: string | null }
  modalidad: string
  cliente?: string
  telefono_cliente?: string
  direccion: string
  fecha_fin: string
  dias_restantes: number
  vencida: boolean
}
type Notif = {
  id: number
  tipo: 'renta' | 'venta' | 'alerta' | 'inventario' | 'sistema'
  titulo: string
  mensaje: string
  seccion: string
  leida: boolean
  data?: Record<string, any>
  creada: string
}
/** Una partida es de venta o de renta (día/semana/mes); una cotización puede mezclar ambas. */
type Modalidad = 'venta' | 'dia' | 'semana' | 'mes'
const MODALIDADES: { key: Modalidad; label: string; corto: string }[] = [
  { key: 'venta', label: 'Venta', corto: 'Venta' },
  { key: 'dia', label: 'Renta por día', corto: 'Día' },
  { key: 'semana', label: 'Renta por semana', corto: 'Semana' },
  { key: 'mes', label: 'Renta por mes', corto: 'Mes' },
]
const TIPO_COT_LABEL: Record<string, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }

type CotizacionItem = { id: number; descripcion: string; cantidad: number; precio_unitario: string; precio_lista?: string; equipo?: number | null; subtotal: string; modalidad: Modalidad; modalidad_label: string }
type CotizacionFoto = { id: number; imagen: string; orden: number }
type Cotizacion = {
  id: number; folio: string | null; tipo: 'venta' | 'renta' | 'mixta'
  estado: 'borrador' | 'por_autorizar' | 'enviada' | 'aceptada' | 'rechazada' | 'cancelada'
  entrega_prometida?: string | null
  cliente_nombre: string; cliente_telefono: string; cliente_email?: string; empresa?: number | null; empresa_nombre?: string
  vigencia_dias: number; aplica_iva: boolean; notas: string
  items: CotizacionItem[]; fotos?: CotizacionFoto[]; subtotal: string; subtotal_venta: string; subtotal_renta: string; base: string; iva: string; total: string
  cliente_display: string; vigencia_hasta?: string | null; vencida?: boolean; creada: string
  token_publico?: string
  convertida?: boolean; venta_id?: number | null; renta_id?: number | null
  usuario_nombre?: string | null
  autorizada_por?: string | null
  autorizada_en?: string | null
  autorizacion_rechazo?: string
  cancelacion_solicitada?: string | null
  cancelacion_motivo?: string
  usuario?: number | null
  usuario_email?: string | null
  origen?: 'admin' | 'cliente'
  datos_solicitud?: { empresa?: string; obra?: { responsable?: string; direccion?: string; telefono?: string; email?: string } }
  atendida_en?: string | null; atendida_por_nombre?: string | null; escalada_en?: string | null
}

type SolicitudFactura = {
  id: number; tipo: 'venta' | 'renta'; folio_origen: string
  rfc: string; razon_social: string; codigo_postal: string; regimen_fiscal: string; uso_cfdi: string; email: string
  subtotal: string; iva: string; total: string; forma_pago: string; concepto: string
  estado: 'pendiente' | 'facturada' | 'cancelada'; uuid: string; fecha_timbrado?: string | null; notas: string
  cliente_display: string; datos_completos: boolean; fecha_origen?: string | null; creada: string
}

// Métricas autoritativas del dashboard (backend suma ventas + rentas, sin tope).
type DashMetrics = {
  ingresos_hoy?: number
  ingresos_mes?: { ventas: number; rentas: number; total: number }
  ingresos_por_mes?: { label: string; ventas: number; rentas: number; total: number }[]
}



/**
 * Sección donde abre el panel. Administración empieza en el Resumen; el almacén
 * en Inventario, que es su trabajo. Se lee del nivel recordado para no pintar
 * primero una sección que el usuario no puede ver.
 */
function seccionInicial(): Section {
  try {
    return Number(localStorage.getItem(CLAVE_NIVEL) || '0') === 1 ? 'ubicaciones' : 'resumen'
  } catch {
    return 'resumen'
  }
}

/** Descarga la ORDEN CARTA en PDF de una venta/renta. Reemplaza al ticket
 *  térmico (que solo se usa al vender refacciones). Se descarga en vez de abrir
 *  en pestaña porque tras un `await` el navegador bloquea window.open. */
async function abrirOrdenCartaPDF(base: 'ventas' | 'rentas', id: number) {
  try {
    const r = await api.get(`/${base}/${id}/ticket/`, { responseType: 'blob', fondo: true } as never)
    descargarBlob(r.data as Blob, base === 'ventas' ? `orden-venta-${id}.pdf` : `orden-renta-${id}.pdf`)
  } catch { /* el interceptor global ya avisa el error */ }
}

type Section = 'resumen' | 'asistente' | 'equipos' | 'inventario' | 'refacciones' | 'reparaciones' | 'cotizaciones' | 'catalogos' | 'empresas' | 'rentas' | 'ventas' | 'facturacion' | 'adeudos' | 'cupones' | 'notificaciones' | 'perfil' | 'ubicaciones' | 'usuarios' | 'configuracion'

const SECTION_META: Record<Section, { title: string; subtitle: string }> = {
  resumen: { title: 'Resumen', subtitle: 'Monitorea tus métricas y gestiona tu operación.' },
  asistente: { title: 'Asistente IA', subtitle: 'Pregunta en lenguaje natural sobre tus datos del negocio.' },
  equipos: { title: 'Productos', subtitle: 'Administra tu catálogo de maquinaria.' },
  inventario: { title: 'Inventario', subtitle: 'Controla cada unidad física y su estado.' },
  refacciones: { title: 'Refacciones', subtitle: 'Piezas para mantenimiento (y venta ocasional al público).' },
  reparaciones: { title: 'Reparaciones', subtitle: 'Órdenes de servicio: recibe equipos, registra el trabajo y entrega la orden.' },
  cotizaciones: { title: 'Cotizaciones', subtitle: 'Presupuestos para clientes: arma partidas, envía y da seguimiento.' },
  catalogos: { title: 'Clasificación', subtitle: 'Organiza categorías, tipos y marcas.' },
  rentas: { title: 'Rentas', subtitle: 'Gestiona rentas activas, reservas y devoluciones.' },
  ventas: { title: 'Ventas', subtitle: 'Historial de ventas de maquinaria y refacciones.' },
  facturacion: { title: 'Por facturar', subtitle: 'Ventas y rentas que el cliente pidió facturar. Timbra aparte y márcalas.' },
  adeudos: { title: 'Adeudos', subtitle: 'Rentas con saldo pendiente: quién debe, cuánto y desde cuándo. Registra abonos hasta liquidar.' },
  cupones: { title: 'Cupones', subtitle: 'Crea y administra códigos de descuento.' },
  notificaciones: { title: 'Notificaciones', subtitle: 'Eventos operativos y pendientes por resolver.' },
  empresas: { title: 'Empresas', subtitle: 'Clientes registrados y sus obras.' },
  perfil: { title: 'Perfil', subtitle: 'Tu información de cuenta.' },
  ubicaciones: { title: 'Mi jornada', subtitle: 'Dónde está cada máquina y qué espera en el taller.' },
  usuarios: { title: 'Usuarios', subtitle: 'Quién entra al panel y qué puede hacer.' },
  configuracion: { title: 'Configuración', subtitle: 'Tu cuenta, el negocio y cómo te avisamos.' },
}

type Domicilio = {
  calle?: string; numero_exterior?: string; numero_interior?: string
  colonia?: string; municipio?: string; ciudad?: string; entidad?: string
  codigo_postal?: string; pais?: string; referencias?: string
  latitud?: string | null; longitud?: string | null
}
type Obra = Domicilio & {
  id: number; empresa?: number; empresa_nombre?: string; nombre: string
  ubicacion?: string; responsable?: string; telefono?: string
  estado: 'activa' | 'pausada' | 'finalizada'; notas?: string; creada?: string
}
type Empresa = Domicilio & {
  id?: number; nombre: string; rfc?: string; contacto?: string; telefono?: string
  email?: string; regimen_fiscal?: string; uso_cfdi?: string
  direccion?: string; notas?: string; activa?: boolean
  obras?: Obra[]; obras_count?: number; obras_activas?: number
}
/** Saca el mensaje REAL de un error de API. DRF manda errores por campo
 *  (`{"modelo": ["muy largo"]}`), no solo `detail`/`detalle`; leer solo `detail`
 *  hace que el usuario vea un genérico inútil y no sepa qué corregir. */
function errorMsg(err: any, fallback = 'Ocurrió un error'): string {
  const d = err?.response?.data
  if (!d) return err?.message || fallback
  if (typeof d === 'string') return d
  if (d.detail || d.detalle) return d.detail || d.detalle
  const partes: string[] = []
  for (const [campo, val] of Object.entries(d)) {
    const txt = Array.isArray(val) ? val.join(' ') : String(val)
    partes.push(campo === 'non_field_errors' ? txt : `${campo}: ${txt}`)
  }
  return partes.length ? partes.join(' · ') : fallback
}

/** Una empresa desactivada conserva su historial pero no debe poder elegirse
 *  para operaciones nuevas (rentas, ventas, cotizaciones, órdenes). */
const empresasActivas = (l: Empresa[]) => l.filter(e => e.activa !== false)

/* ─────────── Helpers UI ─────────── */
const input =
  'w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)] ${className}`}>{children}</div>
}

/* ════════════════════════════════════════
   COMMAND PALETTE (⌘K / Alt+K)
════════════════════════════════════════ */
type PaletteRes = { key: string; group: string; label: string; sub?: string; badge?: string; run: () => void }

function CommandPalette({ equipos, unidades, rentas, ventas, go, onClose }: {
  equipos: Equipo[]; unidades: Unidad[]; rentas: RentaActiva[]; ventas: Venta[]
  go: (s: Section) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const { t } = useLang()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setIdx(0) }, [q])

  const n = q.trim().toLowerCase()
  const results: PaletteRes[] = []

  // Navegación a módulos
  ;(Object.keys(SECTION_META) as Section[]).forEach(s => {
    const title = t(`sec.${s}.title`)
    if (!n || title.toLowerCase().includes(n)) results.push({ key: 'nav-' + s, group: t('palette.goto'), label: title, sub: t(`sec.${s}.sub`), run: () => go(s) })
  })

  if (n) {
    equipos.filter(e => (e.modelo || '').toLowerCase().includes(n)).slice(0, 6).forEach(e =>
      results.push({ key: 'eq-' + e.id, group: 'Productos', label: e.modelo, sub: [e.categoria?.nombre, e.marca?.nombre].filter(Boolean).join(' · ') || '—', run: () => go('equipos') }))
    unidades.filter(u => (u.codigo || '').toLowerCase().includes(n) || (u.numero_serie || '').toLowerCase().includes(n)).slice(0, 6).forEach(u =>
      results.push({ key: 'un-' + u.id, group: 'Inventario', label: u.codigo || '—', sub: u.equipo_modelo || u.equipo_info?.modelo || '', badge: u.estado, run: () => go('inventario') }))
    rentas.filter(r => (r.cliente || '').toLowerCase().includes(n) || (r.inventario?.codigo || '').toLowerCase().includes(n)).slice(0, 5).forEach(r =>
      results.push({ key: 'rt-' + r.id, group: 'Rentas', label: r.cliente || 'Cliente', sub: `${r.inventario?.equipo || ''} · ${r.inventario?.codigo || ''}`, run: () => go('rentas') }))
    ventas.filter(v => (v.nombre_cliente || '').toLowerCase().includes(n) || (v.unidad?.codigo || '').toLowerCase().includes(n)).slice(0, 5).forEach(v =>
      results.push({ key: 'vt-' + v.id, group: 'Ventas', label: v.nombre_cliente || 'Cliente general', sub: `${v.unidad?.equipo || 'Refacciones'} · $${v.total}`, run: () => go('ventas') }))
  }

  const safeIdx = results.length ? Math.min(idx, results.length - 1) : 0
  const run = (r?: PaletteRes) => { if (r) { r.run(); onClose() } }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[safeIdx]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="modal-in fixed inset-0 z-[100] bg-black/30 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[560px] bg-surface/65 backdrop-blur-2xl backdrop-saturate-150 border border-white/15 rounded-2xl shadow-[0_24px_70px_rgba(17,24,39,0.45)] ring-1 ring-inset ring-white/10 overflow-hidden">
        {/* brillo superior tipo cristal */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/12 to-transparent" />
        <div className="relative flex items-center gap-3 px-4 py-3.5 border-b border-edge/50">
          <svg className="w-4 h-4 text-mute shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={t('palette.search')} className="flex-1 bg-transparent text-[15px] outline-none placeholder-mute" />
          <span className="text-[11px] font-bold text-mute bg-ink/10 rounded px-1.5 py-0.5 shrink-0">ESC</span>
        </div>
        <div className="relative max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 && <div className="px-4 py-10 text-center text-sm text-mute">Sin resultados para “{q}”.</div>}
          {results.map((r, i) => {
            const showGroup = i === 0 || results[i - 1].group !== r.group
            return (
              <div key={r.key}>
                {showGroup && <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-mute">{r.group}</div>}
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => run(r)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === safeIdx ? 'bg-gold-soft' : 'hover:bg-ink/5'}`}
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-extrabold ${i === safeIdx ? 'bg-gold text-white' : 'bg-ink/10 text-mute'}`}>{r.group[0]}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[14px] font-semibold truncate ${i === safeIdx ? 'text-gold' : 'text-ink'}`}>{r.label}</div>
                    {r.sub && <div className="text-[12px] text-mute truncate">{r.sub}</div>}
                  </div>
                  {r.badge && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-ink/10 text-mute shrink-0">{r.badge}</span>}
                  <span className="text-mute text-xs shrink-0">↵</span>
                </button>
              </div>
            )
          })}
        </div>
        <div className="relative px-4 py-2.5 border-t border-edge/50 flex items-center gap-4 text-[11px] text-mute">
          <span><b className="text-ink">↑↓</b> navegar</span>
          <span><b className="text-ink">↵</b> abrir</span>
          <span><b className="text-ink">esc</b> cerrar</span>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════ */
export default function Dashboard() {
  const { logout } = useAuth()
  const nav = useNavigate()
  // Dónde abre el panel según quién entra. El nivel se recuerda del último
  // acceso porque el perfil llega por red: sin esto, un almacenista vería
  // Resumen (que no puede consultar) hasta que respondiera la API.
  const [section, setSection] = useState<Section>(seccionInicial)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Menú colapsado a solo-iconos (riel), solo en desktop. Se recuerda entre visitas.
  const [colapsado, setColapsado] = useState(() => { try { return localStorage.getItem('admin_sidebar_colapsado') === '1' } catch { return false } })
  const toggleColapsado = () => setColapsado(v => { const n = !v; try { localStorage.setItem('admin_sidebar_colapsado', n ? '1' : '0') } catch { /* modo privado */ } return n })
  const [me, setMe] = useState<{
    id?: number; username?: string; email?: string; avatar_url?: string | null
    is_superuser?: boolean
    puede?: Capacidades
  } | null>(null)
  const [usuarios, setUsuarios] = useState<UsuarioPanel[]>([])

  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [categorias, setCategorias] = useState<Option[]>([])
  const [tipos, setTipos] = useState<Option[]>([])
  const [marcas, setMarcas] = useState<Option[]>([])
  const [metrics, setMetrics] = useState<DashMetrics | null>(null)
  const [rentas, setRentas] = useState<RentaActiva[]>([])
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [refacciones, setRefacciones] = useState<Refaccion[]>([])
  const [ordenes, setOrdenes] = useState<OrdenReparacion[]>([])
  const [ordenAbrir, setOrdenAbrir] = useState<number | null>(null)
  const [solicitudes, setSolicitudes] = useState<SolicitudFactura[]>([])
  const [adeudos, setAdeudos] = useState<AdeudosDatos>({ rentas: [], total: '0', clientes: 0 })
  const [cotAbiertas, setCotAbiertas] = useState(0)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: 'ok' | 'err' | 'info' | 'warning' | 'primary' }[]>([])

  const notifBtnRef = useRef<HTMLButtonElement | null>(null)
  const notifPanelRef = useRef<HTMLDivElement | null>(null)
  const notifCloseTimeoutRef = useRef<number | null>(null)
  const notifMaxIdRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [notifMounted, setNotifMounted] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifPulse, setNotifPulse] = useState(false)
  const [invEquipo, setInvEquipo] = useState<Equipo | null>(null)
  const [pendingEquipoId, setPendingEquipoId] = useState<number | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const { lang, setLang, t } = useLang()
  const cambiarIdioma = (l: 'ES' | 'EN') => { setLang(l); setLangOpen(false) }

  // Atajo de búsqueda: ⌘K (Mac) / Alt+K (Windows) / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.altKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const notify = (msg: string, type: 'ok' | 'err' | 'info' | 'warning' | 'primary' = 'ok') => {
    // Pila de alertas: las nuevas abajo, sin repetidos y con tope de 3.
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(t => {
      if (t.some(x => x.msg === msg)) return t
      return [...t, { id, msg, type }].slice(-3)
    })
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200)
  }

  /* Cargas de DINERO que fallaron. Sin esto, un 500 o un token vencido se ve
     idéntico a "no hay ventas": el admin lee $0 y lo cree. El banner de arriba
     lo hace visible y deja reintentar. Solo aplica a los loaders de dinero;
     los demás (catálogos, notifs) fallan sin consecuencias que engañen. */
  const [cargasFallidas, setCargasFallidas] = useState<string[]>([])
  const marcarCarga = useCallback((k: string, ok: boolean) => {
    setCargasFallidas(prev => {
      const tiene = prev.includes(k)
      if (ok && tiene) return prev.filter(x => x !== k)
      if (!ok && !tiene) return [...prev, k]
      return prev
    })
  }, [])

  const loadUsuarios = useCallback(() => {
    api.get<{ usuarios: UsuarioPanel[] }>('/usuarios/').then(r => setUsuarios(r.data?.usuarios || [])).catch(() => {})
  }, [])
  const loadMetrics = useCallback(() => {
    api.get<DashMetrics>('/dashboard/metricas/').then(r => { setMetrics(r.data || null); marcarCarga('métricas', true) }).catch(err => { const st = err?.response?.status; if (st !== 401 && st !== 403) marcarCarga('métricas', false) })
  }, [marcarCarga])
  const loadEquipos = useCallback(() => {
    api.get<Equipo[]>('/equipos/').then(r => setEquipos(r.data || [])).catch(() => {})
  }, [])
  const loadCatalogos = useCallback(() => {
    api.get<Option[]>('/categorias/').then(r => setCategorias(r.data || [])).catch(() => {})
    api.get<Option[]>('/tipos/').then(r => setTipos(r.data || [])).catch(() => {})
    api.get<Option[]>('/marcas/').then(r => setMarcas(r.data || [])).catch(() => {})
  }, [])
  const loadCoupons = useCallback(() => {
    api.get<Coupon[]>('/cupones/').then(r => setCoupons(r.data || [])).catch(() => {})
  }, [])
  const loadRentas = useCallback(() => {
    api.get<{ rentas: RentaActiva[] }>('/rentas/?estado=activa').then(r => { setRentas(r.data?.rentas || []); marcarCarga('rentas activas', true) }).catch(err => { const st = err?.response?.status; if (st !== 401 && st !== 403) marcarCarga('rentas activas', false) })
  }, [marcarCarga])
  const loadUnidades = useCallback(() => {
    api.get<Unidad[]>('/unidades/').then(r => setUnidades(r.data || [])).catch(() => {})
  }, [])
  const loadRefacciones = useCallback(() => {
    api.get<Refaccion[]>('/refacciones/').then(r => setRefacciones(r.data || [])).catch(() => {})
  }, [])
  const loadOrdenes = useCallback(() => {
    api.get<OrdenReparacion[]>('/reparaciones/').then(r => setOrdenes(r.data || [])).catch(() => {})
  }, [])
  const loadFacturacion = useCallback(() => {
    api.get<SolicitudFactura[]>('/facturacion/solicitudes/').then(r => { setSolicitudes(r.data || []); marcarCarga('facturación', true) }).catch(err => { const st = err?.response?.status; if (st !== 401 && st !== 403) marcarCarga('facturación', false) })
  }, [marcarCarga])
  const loadAdeudos = useCallback(() => {
    api.get<AdeudosDatos>('/rentas/adeudos/').then(r => setAdeudos(r.data || { rentas: [], total: '0', clientes: 0 })).catch(() => {})
  }, [])
  // Solo el conteo de "abiertas" para el badge del menú: la lista completa la
  // pagina el propio módulo de cotizaciones, no el padre.
  const loadCotizaciones = useCallback(() => {
    api.get<{ abiertas: number }>('/cotizaciones/stats/').then(r => { setCotAbiertas(r.data?.abiertas || 0); marcarCarga('cotizaciones', true) }).catch(err => { const st = err?.response?.status; if (st !== 401 && st !== 403) marcarCarga('cotizaciones', false) })
  }, [marcarCarga])
  const loadVentas = useCallback(() => {
    api.get<{ ventas: Venta[] }>('/ventas/lista/').then(r => { setVentas(r.data?.ventas || []); marcarCarga('ventas', true) }).catch(err => { const st = err?.response?.status; if (st !== 401 && st !== 403) marcarCarga('ventas', false) })
  }, [marcarCarga])
  const loadEmpresas = useCallback(() => {
    api.get<Empresa[]>('/empresas/').then(r => setEmpresas(r.data || [])).catch(() => {})
  }, [])
  const loadNotifs = useCallback(() => {
    api.get<{ notificaciones: Notif[]; no_leidas: number }>('/notificaciones/')
      .then(r => {
        const items = (r.data?.notificaciones || []) as Notif[]
        setNotifs(items)
        setNoLeidas(r.data?.no_leidas || 0)
        const maxId = items.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0)
        if (notifMaxIdRef.current && maxId > notifMaxIdRef.current) {
          setNotifPulse(true)
          window.setTimeout(() => setNotifPulse(false), 900)
          // La notificación recién llegada también se asoma como alerta
          // "primary" (campanita gris), sin esperar a abrir el panel.
          const nueva = items.find(n => Number(n.id) === maxId)
          if (nueva) notify(nueva.titulo || 'Nueva notificación', 'primary')
        }
        notifMaxIdRef.current = maxId
      })
      .catch(() => {})
  }, [])


  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mql) return
    const apply = () => setReduceMotion(mql.matches)
    apply()
    mql.addEventListener?.('change', apply)
    return () => mql.removeEventListener?.('change', apply)
  }, [])

  useEffect(() => {
    api.get('/auth/perfil/').then(r => {
      setMe(r.data)
      recordarAcceso(r.data)   // acento y sección para la próxima carga
    }).catch(() => {})
  }, [])


  // Cada conjunto de datos se suscribe a los temas que lo dejan viejo. Cuando
  // una mutación toca uno de esos temas, esto se vuelve a pedir solo: ya no hay
  // que recargar la página para ver los KPIs, el stock o las listas al día.
  useRecurso(['metricas'], loadMetrics)
  useRecurso(['usuarios'], loadUsuarios)
  useRecurso(['equipos'], loadEquipos)
  useRecurso(['catalogos'], loadCatalogos)
  useRecurso(['cupones'], loadCoupons)
  useRecurso(['rentas'], loadRentas)
  useRecurso(['unidades'], loadUnidades)
  useRecurso(['refacciones'], loadRefacciones)
  useRecurso(['reparaciones'], loadOrdenes)
  useRecurso(['facturacion'], loadFacturacion)
  useRecurso(['rentas'], loadAdeudos)   // los abonos tocan Renta: el saldo baja solo
  useRecurso(['notificaciones'], loadNotifs)
  useRecurso(['cotizaciones'], loadCotizaciones)
  // Latido del panel: lo que capturan OTROS (un cliente envía su cotización,
  // otro admin edita un producto o registra una renta) llega solo en ~2 s,
  // y solo se recarga el tema que de verdad cambió.
  useLatidoPanel('/latido/', 2_000, temas => invalidar(...(temas as Tema[])))
  // Errores globales del interceptor (red, 500, permisos) → la pila de alertas.
  useEffect(() => conectarAvisos(m => notify(m, 'err')), [])  // eslint-disable-line react-hooks/exhaustive-deps
  useRecurso(['ventas'], loadVentas)
  useRecurso(['empresas'], loadEmpresas)

  useEffect(() => {
    if (!pendingEquipoId) return
    const e = equipos.find(x => x.id === pendingEquipoId)
    if (!e) return
    setInvEquipo(e)
    setPendingEquipoId(null)
  }, [equipos, pendingEquipoId])

  const catalogosCount = categorias.length + tipos.length + marcas.length
  const rentasActivas = rentas.length
  const usuariosActivos = usuarios.filter(u => u.activo).length
  const esDueno = Boolean(me?.is_superuser)

  /**
   * Capacidades del usuario, según el backend. Sirven para no mostrar secciones
   * que responderían 403: ocultar es cortesía, la autorización real está en la
   * API. Mientras el perfil carga asumimos lo mínimo, para no parpadear
   * mostrando opciones que luego desaparecen.
   */
  const puede = me?.puede
  const puedeVer = (cap: keyof NonNullable<typeof puede>) => Boolean(puede?.[cap])

  // Qué capacidad exige cada sección del menú. Ojo: "vender" y "rentar" son
  // acciones que el técnico sí hace; las secciones de aquí son las LISTAS
  // (historial, montos), que son otra cosa.
  const REQUIERE: Partial<Record<Section, keyof NonNullable<typeof puede>>> = {
    resumen: 'ver_dinero',
    ventas: 'ver_dinero',   // la LISTA de ventas es historial del negocio
    cotizaciones: 'cotizar',
    facturacion: 'facturar',
    adeudos: 'ver_dinero',   // cobranza: dinero, no operación de campo
    empresas: 'ver_dinero',
    cupones: 'editar_catalogo',
    catalogos: 'editar_catalogo',
    // El técnico opera todo desde "Mi jornada"; estos módulos de gestión son para
    // administración. Su acceso por API sigue existiendo (lo usa "Mi jornada"), aquí
    // solo se decide qué aparece en el menú. Por eso van con capacidades de
    // administración, no con las del técnico.
    equipos: 'editar_catalogo',
    inventario: 'editar_catalogo',
    refacciones: 'editar_catalogo',
    rentas: 'ver_dinero',
    reparaciones: 'ver_dinero',
    ubicaciones: 'operar_inventario',   // "Mi jornada": esto sí lo ve el técnico
    usuarios: 'gestionar_usuarios',
  }
  const seccionPermitida = (s: Section) => {
    const cap = REQUIERE[s]
    return !cap || puedeVer(cap)
  }
  const ordenesAbiertas = ordenes.filter(o => o.estado !== 'entregada').length
  const facturasPendientes = solicitudes.filter(s => s.estado === 'pendiente').length
  const cotizacionesAbiertas = cotAbiertas
  const navGroupsTodos: { title?: string; items: { key: Section; label: string; badge?: number; icon: React.ReactNode }[] }[] = [
    {
      items: [
        { key: 'resumen', label: 'Resumen', icon: <><path d="M4 10.5L12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20z" /><path d="M9.5 21.5v-6.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6.8" /></> },
        { key: 'asistente', label: 'Asistente IA', icon: <><path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.5V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" /></> },
      ],
    },
    {
      title: 'navgroup.catalogo',
      items: [
        { key: 'equipos', label: 'Productos', badge: equipos.length, icon: <><path d="M12 3.5l8 4.5-8 4.5-8-4.5z" /><path d="M4 8v9l8 4.5 8-4.5V8" /><path d="M12 12.5v9" /></> },
        { key: 'inventario', label: 'Inventario', badge: unidades.length, icon: <><rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.2" /><rect x="13" y="4.5" width="6.5" height="6.5" rx="1.2" /><rect x="4.5" y="13" width="6.5" height="6.5" rx="1.2" /><rect x="13" y="13" width="6.5" height="6.5" rx="1.2" /></> },
        { key: 'refacciones', label: 'Refacciones', badge: refacciones.length, icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
        { key: 'catalogos', label: 'Clasificación', badge: catalogosCount, icon: <><path d="M7 6.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 21.5H7A1.5 1.5 0 0 1 5.5 20V8A1.5 1.5 0 0 1 7 6.5z" /><path d="M9 11h8M9 15h8M9 19h5" /></> },
      ],
    },
    {
      title: 'navgroup.operacion',
      items: [
        { key: 'ubicaciones', label: 'Mi jornada', icon: <><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></> },
        { key: 'rentas', label: 'Rentas', badge: rentasActivas, icon: <><path d="M7 4.5v2.5M17 4.5v2.5" /><path d="M5.5 8h13" /><path d="M6.5 7.5h11a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" /><path d="M12 13v3l2 1" /></> },
        { key: 'ventas', label: 'Ventas', badge: ventas.length, icon: <><path d="M6.5 9.5h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6z" /><path d="M6.5 9.5l-1.2-5h-3" /><path d="M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" /></> },
        { key: 'reparaciones', label: 'Reparaciones', badge: ordenesAbiertas, icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /><path d="M14 14l6 6" /></> },
        { key: 'cotizaciones', label: 'Cotizaciones', badge: cotizacionesAbiertas, icon: <><path d="M6 3.5h9l3.5 3.5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V8h4.5" /><path d="M8.5 12h7M8.5 15.5h7M8.5 18.5h4" /></> },
        { key: 'facturacion', label: 'Por facturar', badge: facturasPendientes, icon: <><path d="M6 3.5h9l3.5 3.5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V8h4.5" /><path d="M8.5 13h7M8.5 16.5h7" /></> },
        { key: 'adeudos', label: 'Adeudos', badge: adeudos.rentas.length, icon: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-3 .9-3 2.2 0 2.8 6 1.6 6 4.3 0 1.3-1.3 2.2-3 2.2-1.2 0-2.2-.4-2.8-1.2" /></> },
        { key: 'notificaciones', label: 'Notificaciones', badge: noLeidas, icon: <><path d="M15 17h5l-1.3-1.3A2 2 0 0 1 18.1 14V11a6.1 6.1 0 1 0-12.2 0v3a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9.2 17v.8a2.8 2.8 0 0 0 5.6 0V17" /></> },
        { key: 'cupones', label: 'Cupones', badge: coupons.length, icon: <><path d="M7.5 6.5h9a2 2 0 0 1 2 2V10a1.8 1.8 0 0 0 0 4v1.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V14a1.8 1.8 0 0 0 0-4V8.5a2 2 0 0 1 2-2z" /><path d="M12 8.8v6.4" /></> },
      ],
    },
    {
      title: 'navgroup.clientes',
      items: [
        { key: 'empresas', label: 'Empresas', badge: empresas.length, icon: <><path d="M4.5 21.5h15" /><path d="M5.5 21.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16" /><path d="M13.5 9.5h4a1 1 0 0 1 1 1v11" /><path d="M8.5 8h2M8.5 11.5h2M8.5 15h2" /></> },
      ],
    },
    {
      title: 'navgroup.cuenta',
      items: [
        { key: 'usuarios', label: 'Usuarios', badge: usuariosActivos, icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M17.5 20a5.4 5.4 0 0 0-2-4.2" /></> },
        { key: 'configuracion', label: 'Configuración', icon: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" /><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 17.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.5a1.7 1.7 0 0 0 1-1.6v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" /></> },
      ],
    },
  ]

  // Se ocultan las secciones sin permiso, y los grupos que quedan vacíos.
  const navGroups = navGroupsTodos
    .map(g => ({ ...g, items: g.items.filter(it => seccionPermitida(it.key)) }))
    .filter(g => g.items.length > 0)

  // Al llegar el perfil puede resultar que la sección abierta no le corresponde
  // (el panel arranca en Resumen, que el almacén no ve). Lo movemos a la primera
  // que sí puede usar en vez de dejarlo mirando un 403.
  useEffect(() => {
    if (!puede || seccionPermitida(section)) return
    // Para quien anda con las máquinas, "Dónde están" es su pantalla; si no le
    // toca, la primera de su menú, y como último recurso su perfil.
    const destino: Section = seccionPermitida('ubicaciones') ? 'ubicaciones'
      : (navGroups[0]?.items[0]?.key ?? 'perfil')
    setSection(destino)
    // Solo reacciona a que lleguen las capacidades o cambie la sección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puede, section])

  const go = (s: Section) => { setSection(s); setSidebarOpen(false) }
  // Desde Inventario: al enviar una máquina propia a taller se crea la orden interna
  // y saltamos a Reparaciones abriéndola.
  const abrirReparacion = (ordenId: number) => {
    loadOrdenes(); loadUnidades()
    setOrdenAbrir(ordenId)
    go('reparaciones')
  }

  function openFromNotif(n: Notif) {
    if (!n.leida) api.post(`/notificaciones/${n.id}/leer/`).then(loadNotifs).catch(() => {})
    closeNotifPanel()

    // A dónde puede ir esta cuenta. El técnico no entra a Inventario/Productos
    // (es de administración), así que abrir ahí el detalle de un equipo desde una
    // notificación lo dejaba en botones de Rentar/Vender que no son suyos. Si no
    // puede ver la sección destino, cae en su pantalla: Mi jornada, donde está la
    // tarea (ir a recoger la máquina vencida, por ejemplo).
    const inicioPropio: Section = seccionPermitida('ubicaciones')
      ? 'ubicaciones'
      : (navGroups[0]?.items[0]?.key ?? 'perfil')

    const equipoId = Number(n.data?.equipo_id || 0) || null
    if (equipoId && seccionPermitida('equipos')) {
      go('equipos')
      const e = equipos.find(x => x.id === equipoId)
      if (e) setInvEquipo(e)
      else {
        setPendingEquipoId(equipoId)
        loadEquipos()
      }
      return
    }

    if (n.seccion && seccionPermitida(n.seccion as Section)) {
      go(n.seccion as Section)
      return
    }

    go(inicioPropio)
  }

  function closeNotifPanel() {
    setNotifOpen(false)
    if (notifCloseTimeoutRef.current) window.clearTimeout(notifCloseTimeoutRef.current)
    notifCloseTimeoutRef.current = window.setTimeout(() => setNotifMounted(false), reduceMotion ? 0 : 170)
  }

  function openNotifPanel() {
    if (notifCloseTimeoutRef.current) window.clearTimeout(notifCloseTimeoutRef.current)
    setNotifMounted(true)
    requestAnimationFrame(() => setNotifOpen(true))
  }

  function toggleNotifPanel() {
    if (notifMounted && notifOpen) closeNotifPanel()
    else openNotifPanel()
  }

  function marcarTodasNotifs() {
    api.post('/notificaciones/leer-todas/').then(loadNotifs).catch(() => {})
  }

  useEffect(() => {
    if (!notifMounted) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeNotifPanel()
    }

    function onPointerDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (notifBtnRef.current?.contains(t)) return
      if (notifPanelRef.current?.contains(t)) return
      closeNotifPanel()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [notifMounted, reduceMotion])

  const notifsRecientes = [...notifs]
    .sort((a, b) => new Date(b.creada).getTime() - new Date(a.creada).getTime())
    .slice(0, 6)

  return (
    // El acento negro del dueño lo pone `tema-dueno` en <html> (ver index.html y
    // el efecto que carga el perfil). Aquí no se repite: si estuviera en los dos
    // lados, al dejar de ser dueño la clase de arriba se quitaría y esta no.
    <ProveedorPermisos value={puede ?? null}>
    <div className="flex flex-col h-screen bg-app text-ink font-sans overflow-hidden">
      {/* Overlay móvil */}
      {sidebarOpen && (
        <div className="modal-in fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── TOPBAR ─── */}
      <div className="flex-none px-2 pt-2">
        <div className="h-[68px] bg-surface border border-edge rounded-[18px] shadow-[0_1px_3px_rgba(33,29,22,0.04)] flex items-center gap-2 sm:gap-3 px-3 sm:px-5">
          {/* El técnico no ve el hamburguesa en celular: ahí tiene el dock abajo
              con sus tres secciones. Entre 768 y 1024 (tablet, sin dock) sí lo ve.
              Los demás roles, sin cambios (visible hasta lg). */}
          <button onClick={() => setSidebarOpen(true)} className={`${puede?.nivel === 1 ? 'hidden md:flex' : 'flex'} lg:hidden w-9 h-9 rounded-lg items-center justify-center hover:bg-surface-2 text-ink shrink-0`} aria-label="Abrir menú">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          {/* Colapsar/expandir el menú a solo-iconos (desktop), al lado del logo. */}
          <button onClick={toggleColapsado} className="hidden lg:flex w-9 h-9 rounded-lg items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label={colapsado ? 'Expandir menú' : 'Colapsar menú'} title={colapsado ? 'Expandir menú' : 'Colapsar menú'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <LogoRemali className="w-8 h-8 text-ink" />
            <span className="font-extrabold tracking-tight text-[15px] hidden sm:block">REMALI</span>
          </Link>
          <div className="flex-1 min-w-0" />
          <div onClick={() => setPaletteOpen(true)} className="hidden md:flex items-center gap-2 border border-edge rounded-[9px] px-3.5 py-2 bg-app w-full max-w-[420px] min-w-0 hover:border-gold/40 transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5 text-mute shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
            <input ref={searchInputRef} readOnly placeholder={t('top.search')} className="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none placeholder-mute cursor-pointer" />
            <span className="text-[11px] font-bold text-mute bg-surface-2 rounded px-1.5 py-0.5 shrink-0">⌘K</span>
          </div>
          <div className="flex-1 min-w-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Notificaciones */}
            <div className="relative">
              <button
                ref={notifBtnRef}
                onClick={toggleNotifPanel}
                className={`relative w-9 h-9 rounded-lg bg-app hover:bg-surface-2 text-mute hover:text-gold active:scale-95 transition-[color,transform,background-color] duration-150 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 ${notifOpen ? 'text-gold' : ''}`}
                aria-label="Notificaciones" aria-haspopup="dialog" aria-expanded={notifOpen}
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                {noLeidas > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface">{noLeidas > 9 ? '9+' : noLeidas}</span>
                )}
                {notifPulse && <span className="absolute inset-0 rounded-full bg-gold/20 animate-ping pointer-events-none" />}
              </button>

              {notifMounted && (
                <>
                {/* Fondo oscuro solo en móvil: el panel se lee como una capa
                    encima, no como un recuadro flotando sobre el contenido. */}
                <div onClick={closeNotifPanel} aria-hidden="true" className={`fixed inset-0 z-[54] bg-black/40 sm:hidden transition-opacity duration-200 motion-reduce:transition-none ${notifOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
                <div
                  ref={notifPanelRef} role="dialog" aria-label="Notificaciones"
                  className={`fixed inset-x-3 top-[84px] z-[55] origin-top sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:z-[55] sm:origin-top-right rounded-2xl border border-edge bg-surface shadow-[0_20px_50px_rgba(17,24,39,0.18)] overflow-hidden transform-gpu transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${notifOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.96] pointer-events-none'}`}
                >
                  <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-3">
                    <div className="text-lg font-extrabold text-ink">Notificaciones</div>
                    <button onClick={marcarTodasNotifs} className="text-[13px] font-bold text-ink hover:text-gold transition-colors">Marcar todas leídas</button>
                  </div>
                  <div className="max-h-[min(55vh,360px)] overflow-y-auto">
                    {notifsRecientes.length === 0 && (
                      <div className="py-12 text-center px-6">
                        <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3 text-mute">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" /></svg>
                        </div>
                        <p className="text-sm text-mute">No tienes notificaciones.</p>
                      </div>
                    )}
                    {notifsRecientes.map((n, i) => (
                      <div
                        key={n.id}
                        style={notifOpen ? { animationDelay: `${i * 45}ms` } : undefined}
                        className={`${notifOpen ? 'stagger-item' : ''} flex gap-2.5 px-5 py-4 border-b border-edge/60 last:border-b-0 ${!n.leida ? 'bg-gold-soft/30' : ''}`}
                      >
                        <span className="w-[7px] h-[7px] rounded-full shrink-0 mt-[7px]" style={{ background: !n.leida ? 'var(--c-gold)' : 'var(--c-mute)' }} />
                        <button onClick={() => openFromNotif(n)} className="flex-1 min-w-0 text-left">
                          <div className="font-extrabold text-[14.5px] text-ink">{n.titulo}</div>
                          {n.mensaje && <div className="text-[13.5px] text-mute mt-1 leading-snug line-clamp-2">{n.mensaje}</div>}
                          <div className="text-[12.5px] text-mute mt-1.5">{tiempoRelativo(n.creada)}</div>
                        </button>
                        <div className="flex gap-1 shrink-0">
                          {!n.leida && (
                            <button onClick={() => { api.post(`/notificaciones/${n.id}/leer/`).then(loadNotifs).catch(() => {}) }} title="Marcar leída" className="w-[26px] h-[26px] rounded-full bg-surface-2 hover:bg-emerald-500/15 text-emerald-600 flex items-center justify-center text-xs font-bold transition-colors">✓</button>
                          )}
                          <button onClick={() => openFromNotif(n)} title="Abrir" className="w-[26px] h-[26px] rounded-full bg-surface-2 hover:bg-surface text-mute flex items-center justify-center text-xs transition-colors">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { closeNotifPanel(); go('notificaciones') }} className="w-full flex items-center justify-center gap-1.5 py-4 text-[13.5px] font-bold text-mute hover:bg-surface-2 hover:text-ink transition-colors border-t border-edge">
                    <span className="w-3.5 h-3.5 rounded-full border-[1.6px] border-current" /> Ver todas las notificaciones
                  </button>
                </div>
                </>
              )}
            </div>

            {/* Idioma */}
            <div className="relative hidden sm:block">
              <button onClick={() => setLangOpen(o => !o)} className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-edge text-[13px] font-bold hover:bg-surface-2 transition-colors">
                <span>{lang === 'ES' ? '🇲🇽' : '🇺🇸'}</span> {lang} <span className="text-[10px] text-mute">▾</span>
              </button>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setLangOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-40 bg-surface border border-edge rounded-xl shadow-[0_20px_50px_rgba(17,24,39,0.18)] z-[56] overflow-hidden py-1">
                    {(['ES', 'EN'] as const).map(l => (
                      <button key={l} onClick={() => cambiarIdioma(l)} className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-semibold text-left hover:bg-surface-2 transition-colors ${lang === l ? 'text-gold' : 'text-ink'}`}>
                        {l === 'ES' ? '🇲🇽 Español' : '🇺🇸 English'}{lang === l && <span className="ml-auto text-gold">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <ThemeToggle />

            {/* Cuenta */}
            <div className="relative">
              <button onClick={() => setAccountOpen(o => !o)} className="flex items-center gap-2 pl-1.5 pr-2 sm:pr-3 py-1.5 rounded-lg border border-edge hover:bg-surface-2 transition-colors">
                <span className="w-7 h-7 rounded-full bg-surface-2 text-mute font-extrabold text-[11px] flex items-center justify-center shrink-0">{(me?.username?.[0] || 'A').toUpperCase()}</span>
                <span className="text-[13.5px] font-bold hidden sm:block">{me?.username || 'Admin'}</span>
                <span className="text-[10px] text-mute hidden sm:block">▾</span>
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-[250px] bg-surface border border-edge rounded-2xl shadow-[0_20px_50px_rgba(17,24,39,0.18)] z-[56] overflow-hidden">
                    <div className="flex items-center gap-3 p-4">
                      <span className={`w-[42px] h-[42px] rounded-full font-extrabold text-sm flex items-center justify-center shrink-0 ${esDueno ? 'bg-ink text-app' : puede?.nivel ? 'bg-yellow text-[#111827]' : 'bg-surface-2 text-mute'}`}>{(me?.username?.[0] || 'A').toUpperCase()}</span>
                      <div className="min-w-0">
                        <div className="text-[15px] font-extrabold text-ink truncate">{me?.username || 'Admin'}</div>
                        <div className="text-[12.5px] text-mute truncate">{me?.email || 'admin@gmail.com'}</div>
                      </div>
                    </div>
                    {/* El rol no va en este menú: el avatar, el nombre y el correo
                        ya dicen de qué cuenta se trata. Si hace falta, está en el
                        perfil. */}
                    <div className="border-t border-edge py-1">
                      <button onClick={() => { setAccountOpen(false); go('perfil') }} className="w-full flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-ink hover:bg-surface-2 transition-colors">
                        <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>Perfil
                      </button>
                      <button onClick={() => { setAccountOpen(false); go('configuracion') }} className="w-full flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-ink hover:bg-surface-2 transition-colors">
                        <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L16.2 2h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5A7 7 0 0 0 19 12z" /></svg>Configuración
                      </button>
                    </div>
                    <div className="border-t border-edge">
                      <button onClick={() => { logout(); nav('/login') }} className="w-full flex items-center gap-3 px-4 py-3 text-[14px] font-bold text-red-500 hover:bg-red-500/5 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5m0 0l-5-5m5 5H9" /></svg>Cerrar sesión
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <Link to="/" className="text-xs text-mute hover:text-gold transition-colors hidden lg:flex items-center gap-1.5" title="Ver sitio">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </Link>
          </div>
        </div>
      </div>

      {/* ─── CUERPO ─── */}
      <div className="flex-1 flex overflow-hidden">

        {/* SIDEBAR */}
        <aside className={`w-64 ${colapsado ? 'lg:w-[72px]' : 'lg:w-64'} flex-none p-2 fixed lg:static inset-y-0 left-0 z-50 transition-[transform,width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-full bg-surface border border-edge rounded-[20px] shadow-[0_1px_3px_rgba(33,29,22,0.04)] flex flex-col p-3.5 overflow-hidden">
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden self-end text-mute hover:text-ink p-1 mb-1" aria-label="Cerrar menú">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <nav className="flex-1 overflow-y-auto flex flex-col gap-3">
              {navGroups.map((g, gi) => (
                <div key={gi}>
                  {g.title && (
                    <p className={`px-2.5 pb-2 text-[11px] font-bold uppercase tracking-wider text-mute ${colapsado ? 'lg:hidden' : ''}`}>{t(g.title)}</p>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {g.items.map(it => {
                      const active = section === it.key
                      const showBadge = (it.badge ?? 0) > 0
                      return (
                        <button
                          key={it.key}
                          onClick={() => go(it.key)}
                          title={t(`sec.${it.key}.title`)}
                          className={`group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-sm transition-colors ${colapsado ? 'lg:justify-center lg:px-2' : ''} ${
                            active ? 'bg-gold-soft text-gold font-medium' : 'text-ink hover:bg-surface-2 font-normal'
                          }`}
                        >
                          <svg className={`w-[19px] h-[19px] shrink-0 transition-colors ${active ? 'text-gold' : 'text-mute group-hover:text-ink'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            {it.icon}
                          </svg>
                          <span className={`flex-1 text-left ${colapsado ? 'lg:hidden' : ''}`}>{t(`sec.${it.key}.title`)}</span>
                          {showBadge && it.key === 'notificaciones' && (<>
                            <span className={`min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ${colapsado ? 'lg:hidden' : ''}`}>
                              {it.badge! > 9 ? '9+' : it.badge}
                            </span>
                            {/* Colapsado: puntito rojo sobre el icono en lugar del número. */}
                            <span className={`absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-surface hidden ${colapsado ? 'lg:block' : ''}`} />
                          </>)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t border-edge pt-3.5 mt-2">
              <div className={`flex items-center gap-2 px-1 mb-1.5 ${colapsado ? 'lg:justify-center' : ''}`}>
                <img alt="profile-user" src={resolveMediaUrl(me?.avatar_url) || '/assets/user.png'} className="w-8 h-8 rounded-full object-cover bg-surface-2 shrink-0" />
                <div className={`min-w-0 ${colapsado ? 'lg:hidden' : ''}`}>
                  <p className="text-[13px] font-bold text-ink truncate">{me?.username || 'admin'}</p>
                  <p className="text-[11px] text-mute truncate">{me?.email}</p>
                </div>
              </div>
              <button onClick={() => { logout(); nav('/login') }} title="Cerrar sesión" className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[13px] font-semibold text-mute hover:text-red-500 hover:bg-red-500/5 transition-colors ${colapsado ? 'lg:justify-center' : ''}`}>
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5m0 0l-5-5m5 5H9" /></svg>
                <span className={colapsado ? 'lg:hidden' : ''}>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        {/* pb en móvil solo para el técnico: es a quien le sale el dock, y sin
            este respiro el dock taparía el final del contenido. */}
        <main className={`flex-1 overflow-auto min-w-0 ${puede?.nivel === 1 ? 'pb-24 md:pb-0' : ''}`}>
          <div className="p-3 sm:p-4 lg:p-5">
          {/* Encabezado de página: breadcrumb + título + subtítulo */}
          <div className="mb-5">
            <nav className="flex items-center gap-2 text-[13px] font-semibold text-mute mb-3">
              <button onClick={() => go('resumen')} className="hover:text-ink transition-colors" title="Inicio" aria-label="Inicio">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M3 11.4L12 4l9 7.4" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.8V19a1.2 1.2 0 0 0 1.2 1.2h10.6A1.2 1.2 0 0 0 18.5 19V9.8" /></svg>
              </button>
              <span className="text-edge">›</span>
              <span className="text-ink font-bold">{t(`sec.${section}.title`)}</span>
            </nav>
            <h1 className="text-[26px] sm:text-[28px] font-extrabold tracking-tight text-ink leading-tight">{t(`sec.${section}.title`)}</h1>
            <p className="text-[15px] text-mute mt-1.5">{t(`sec.${section}.sub`)}</p>
          </div>

          {/* Cargas de dinero que fallaron: sin este aviso, los totales en $0
              parecen reales. Reintentar relanza solo los loaders afectados. */}
          {cargasFallidas.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13.5px]">
              <svg className="w-[18px] h-[18px] text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" /></svg>
              <span className="text-ink font-semibold">No se pudo cargar: {cargasFallidas.join(', ')}.</span>
              <span className="text-mute">Los totales pueden verse en $0 sin serlo.</span>
              <button
                onClick={() => { loadMetrics(); loadVentas(); loadRentas(); loadFacturacion(); loadCotizaciones() }}
                className="ml-auto px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold hover:bg-amber-500/30 transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}
          {section === 'resumen' && (
            <Resumen
              equipos={equipos} categorias={categorias}
              tipos={tipos} marcas={marcas} coupons={coupons} rentas={rentas}
              unidades={unidades} ventas={ventas} me={me} go={go} metrics={metrics}
            />
          )}
          {section === 'asistente' && <AsistenteIA notify={notify} me={me} />}
          {section === 'equipos' && (
            <EquiposAdmin
              equipos={equipos} categorias={categorias} tipos={tipos} marcas={marcas}
              reload={() => { loadEquipos(); loadUnidades() }} notify={notify}
            />
          )}
          {section === 'inventario' && (
            <InventarioGlobal
              unidades={unidades} equipos={equipos}
              reload={() => { loadUnidades(); loadRentas(); loadRefacciones() }} notify={notify}
              onEnviarTaller={abrirReparacion}
            />
          )}
          {section === 'refacciones' && (
            <RefaccionesAdmin refacciones={refacciones} reload={loadRefacciones} notify={notify} />
          )}
          {section === 'reparaciones' && (
            <ReparacionesAdmin
              ordenes={ordenes} refacciones={refacciones} unidades={unidades} empresas={empresas}
              reload={() => { loadOrdenes(); loadRefacciones(); loadUnidades() }} notify={notify}
              abrirId={ordenAbrir} onAbierto={() => setOrdenAbrir(null)}
            />
          )}
          {section === 'facturacion' && (
            <FacturacionAdmin solicitudes={solicitudes} reload={loadFacturacion} notify={notify} />
          )}
          {section === 'adeudos' && (
            <AdeudosAdmin datos={adeudos} reload={loadAdeudos} notify={notify} />
          )}
          {section === 'cotizaciones' && (
            <CotizacionesAdmin empresas={empresas} notify={notify} irAInventario={() => go('inventario')} />
          )}
          {section === 'catalogos' && (
            <CatalogosAdmin
              categorias={categorias} tipos={tipos} marcas={marcas} equipos={equipos}
              reload={loadCatalogos} notify={notify} go={go}
            />
          )}
          {section === 'rentas' && (
            <RentasAdmin reload={() => { loadRentas(); loadUnidades() }} notify={notify} />
          )}
          {section === 'ventas' && (
            <VentasAdmin ventas={ventas} reload={loadVentas} notify={notify} />
          )}
          {section === 'notificaciones' && (
            <NotificacionesAdmin
              notifs={notifs} reload={loadNotifs} go={go}
              onOpen={openFromNotif}
            />
          )}
          {section === 'cupones' && (
            <CuponesAdmin coupons={coupons} reload={loadCoupons} notify={notify} />
          )}
          {section === 'empresas' && (
            <EmpresasAdmin empresas={empresas} reload={loadEmpresas} notify={notify} />
          )}
          {section === 'ubicaciones' && <UbicacionesAdmin notify={notify} />}
          {section === 'usuarios' && <UsuariosAdmin usuarios={usuarios} reload={loadUsuarios} notify={notify} yoId={me?.id} />}
          {section === 'configuracion' && <ConfiguracionAdmin notify={notify} lang={lang} onLang={cambiarIdioma} />}
          </div>
        </main>
      </div>

      {/* ─── DOCK DEL TÉCNICO (solo móvil) ───
          Solo nivel 1. El admin y el dueño manejan ~15 módulos: no caben en un
          dock, para ellos queda el cajón lateral. El técnico ve tres cosas, así
          que un dock al alcance del pulgar le sirve mejor que un menú que abrir.
          Los items salen de navGroups, que ya está filtrado por rol. */}
      {puede?.nivel === 1 && (
        <Dock
          items={navGroups.flatMap(g => g.items).map<DockItem>(it => ({
            key: it.key,
            // Etiqueta corta: "Notificaciones"/"Configuración" no caben bajo un
            // icono de dock. La larga se queda en el cajón lateral.
            label: ({ ubicaciones: 'Jornada', notificaciones: 'Avisos', configuracion: 'Ajustes' } as Record<string, string>)[it.key] ?? it.label,
            badge: it.badge,
            activo: section === it.key,
            onClick: () => go(it.key),
            icon: (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {it.icon}
              </svg>
            ),
          }))}
        />
      )}

      <DialogoHost />

      {/* ─── ALERTAS: pila (las nuevas abajo), círculo por tipo y barra de vida ─── */}
      {toasts.length > 0 && (
        <div className="fixed top-[76px] right-3 sm:right-5 z-[130] flex flex-col items-end gap-2.5 max-w-[calc(100vw-1.5rem)]">
          {toasts.map(t => (
            <div key={t.id} className="toast-in relative overflow-hidden flex items-center gap-3 pl-3 pr-2.5 py-2.5 rounded-2xl border border-edge bg-alert shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
              <span className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${({ ok: 'bg-emerald-500', err: 'bg-red-500', info: 'bg-violet-500', warning: 'bg-amber-500', primary: 'bg-neutral-400' } as Record<string, string>)[t.type]}`}>
                {t.type === 'ok' && <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                {(t.type === 'err' || t.type === 'info') && <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.5" className="fill-white" /></svg>}
                {t.type === 'warning' && <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2.6" strokeLinecap="round"><path d="M8 12h8" /></svg>}
                {t.type === 'primary' && <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white fill-none" strokeWidth="2"><path d="M15 17h5l-1.3-1.3A2 2 0 0 1 18.1 14V11a6.1 6.1 0 1 0-12.2 0v3a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9.2 17v.8a2.8 2.8 0 0 0 5.6 0V17" /></svg>}
              </span>
              <span className="text-sm font-bold text-ink pr-1">{t.msg}</span>
              <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface transition-colors shrink-0">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
              <span
                className={`absolute left-0 bottom-0 h-[3px] rounded-full ${({ ok: 'bg-emerald-500', err: 'bg-red-500', info: 'bg-violet-500', warning: 'bg-amber-500', primary: 'bg-neutral-400' } as Record<string, string>)[t.type]}`}
                style={{ animation: 'toast-avance 3.2s linear forwards' }}
              />
            </div>
          ))}
        </div>
      )}

      {invEquipo && <InventoryModal equipo={invEquipo} onClose={() => setInvEquipo(null)} notify={notify} />}

      {paletteOpen && (
        <CommandPalette
          equipos={equipos} unidades={unidades} rentas={rentas} ventas={ventas}
          go={go} onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
    </ProveedorPermisos>
  )
}

/* ════════════════════════════════════════
   RESUMEN
════════════════════════════════════════ */
/* (AreaChart eliminado: el Resumen usa los widgets del comp de Claude Design) */

/** Reloj del resumen con dígitos de marcador: cada dígito que cambia RUEDA
 *  (el viejo sale hacia arriba, el nuevo entra desde abajo). Los que no
 *  cambian no se mueven — al cambiar de minuto solo giran los necesarios. */
function RelojVivo({ now }: { now: Date }) {
  let h = now.getHours() % 12
  if (h === 0) h = 12
  const chars = [...`${h}:${String(now.getMinutes()).padStart(2, '0')}`]
  const ampm = now.getHours() < 12 ? 'AM' : 'PM'
  return (
    <div className="flex items-baseline gap-2 mt-5">
      <div className="flex text-[46px] leading-none font-black tracking-[-0.04em] text-[#111827] tabular-nums">
        {chars.map((c, i) => c === ':' ? (
          <span key={`sep-${i}`} className="mx-[2px] -translate-y-[3px]">:</span>
        ) : (
          <span key={`pos-${i}`} className="relative inline-flex overflow-hidden" style={{ height: '1em' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={c}
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '-100%', opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                className="inline-block"
              >
                {c}
              </motion.span>
            </AnimatePresence>
          </span>
        ))}
      </div>
      <span className="text-[16px] font-bold text-[#9CA3AF]">{ampm}</span>
    </div>
  )
}

function Resumen({ equipos, rentas, unidades, ventas, me, go, metrics }: {
  equipos: Equipo[]; categorias: Option[]; tipos: Option[]; marcas: Option[]
  coupons: Coupon[]; rentas: RentaActiva[]; unidades: Unidad[]; ventas: Venta[]
  me: { username?: string; email?: string } | null; go: (s: Section) => void
  metrics: DashMetrics | null
}) {
  const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

  // Reloj en vivo
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const dateStr = now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const nombre = me?.username || 'admin'

  // Inventario por estado
  const total = unidades.length
  const disp = unidades.filter(u => u.estado === 'disponible').length
  const rent = unidades.filter(u => u.estado === 'rentado').length
  const mant = unidades.filter(u => u.estado === 'mantenimiento').length
  const vend = unidades.filter(u => u.estado === 'vendido').length
  const operativas = Math.max(total - vend, 0)
  const availabilityPct = operativas ? Math.round((disp / operativas) * 100) : 0

  // Ingresos
  const ventasActivas = ventas.filter(v => v.estado !== 'cancelada')
  const ingresoDia = equipos.reduce((a, e) => a + num(e.precio_dia), 0)
  const y = now.getFullYear(), mo = now.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hoyStr = `${y}-${pad(mo + 1)}-${pad(now.getDate())}`
  // Ingreso de HOY: cifra autoritativa del backend (ventas + rentas); si aún no
  // llega, respaldo con el cálculo cliente (solo ventas) para no mostrar vacío.
  const ingresosHoy = metrics?.ingresos_hoy ?? ventasActivas.filter(v => (v.fecha || '').slice(0, 10) === hoyStr).reduce((a, v) => a + num(v.total), 0)

  // Ingresos por mes (últimos 6): del backend (ventas + rentas, sin tope). Respaldo cliente.
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const revByMonth = metrics?.ingresos_por_mes
    ? metrics.ingresos_por_mes.map(m => ({ label: m.label, total: m.total }))
    : Array.from({ length: 6 }, (_, i) => {
      const d = new Date(y, mo - (5 - i), 1)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      const t = ventasActivas.filter(v => (v.fecha || '').slice(0, 7) === key).reduce((a, v) => a + num(v.total), 0)
      return { label: MESES[d.getMonth()], total: t }
    })
  const maxRev = Math.max(1, ...revByMonth.map(r => r.total))
  const ingresosTotales = revByMonth.reduce((a, r) => a + r.total, 0)
  const mesesPositivos = revByMonth.filter(r => r.total > 0).length

  // Movimientos recientes (rentas + ventas)
  const moves = [
    ...rentas.map(r => ({ name: r.inventario.equipo || 'Equipo', code: r.inventario.codigo || '', status: r.vencida ? 'Vencida' : 'Rentado', color: r.vencida ? '#C23B3B' : '#2B5FAD', bg: r.vencida ? '#FCE9E9' : '#E7EFFB', ts: r.fecha_fin || '' })),
    ...ventas.map(v => ({ name: v.unidad?.equipo || 'Venta mostrador', code: v.unidad?.codigo || '', status: v.estado === 'cancelada' ? 'Cancelada' : 'Vendido', color: v.estado === 'cancelada' ? '#C23B3B' : '#8A631E', bg: v.estado === 'cancelada' ? '#FCE9E9' : '#F7ECD9', ts: v.fecha || '' })),
  ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 4)

  const overviewStats = [
    { label: 'Ingreso potencial/día', value: money0(ingresoDia) },
    { label: 'Unidades disponibles', value: String(disp) },
    { label: 'Rentas activas', value: String(rentas.length) },
    { label: 'Ventas del catálogo', value: String(ventasActivas.length) },
  ]

  // Paleta SUAVE solo para la gráfica: la dona y esta leyenda comparten los
  // mismos --chart-* (azul aciano / verde menta / gris lavanda). Las insignias
  // de las tablas siguen con los tokens fuertes (necesitan contraste), por eso
  // los colores de chart van aparte.
  const indicators = [
    { label: 'Disponibles', sub: 'Listas para operar', value: String(disp), color: 'var(--chart-green)' },
    { label: 'Rentadas', sub: 'En obra', value: String(rent), color: 'var(--chart-blue)' },
    { label: 'Mantenimiento', sub: 'En taller', value: String(mant), color: 'var(--chart-gray)' },
  ]

  /** Dona repartida por estado. Sin unidades queda un anillo gris, no un hueco. */
  const donaGradiente = (() => {
    const total = disp + rent + mant
    if (!total) return 'conic-gradient(var(--c-surface-2) 0deg 360deg)'
    const gLibre = (disp / total) * 360
    const gRenta = gLibre + (rent / total) * 360
    return `conic-gradient(var(--chart-green) 0deg ${gLibre}deg, var(--chart-blue) ${gLibre}deg ${gRenta}deg, var(--chart-gray) ${gRenta}deg 360deg)`
  })()

  // Tareas rápidas (persisten en el navegador)
  const [tasks, setTasks] = useState<{ id: number; text: string; done: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem('remali_tasks') || '[]') } catch { return [] }
  })
  const [taskTab, setTaskTab] = useState<'pend' | 'done'>('pend')
  const [taskInput, setTaskInput] = useState('')
  useEffect(() => { localStorage.setItem('remali_tasks', JSON.stringify(tasks)) }, [tasks])
  const addTask = () => { const t = taskInput.trim(); if (!t) return; setTasks(p => [...p, { id: Date.now(), text: t, done: false }]); setTaskInput('') }
  const toggleTask = (id: number) => setTasks(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t))
  const delTask = (id: number) => setTasks(p => p.filter(t => t.id !== id))
  const visibleTasks = tasks.filter(t => taskTab === 'pend' ? !t.done : t.done)

  // Calendario del mes actual
  const firstDow = new Date(y, mo, 1).getDay()
  const daysInMonth = new Date(y, mo + 1, 0).getDate()
  const today = now.getDate()
  const calCells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const monthLabel = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  const panel = 'bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)]'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2.5 items-start">
      {/* ── Columna izquierda ── */}
      <div className="flex flex-col gap-2.5 min-w-0">
        {/* Hero */}
        <div className="rounded-2xl px-8 py-7 flex items-center justify-between gap-4" style={{ background: 'linear-gradient(120deg,#FFFFFF,#DCE9FB)' }}>
          <div className="min-w-0">
            <div className="text-[26px] font-extrabold text-[#111827]">Bienvenido, {nombre}</div>
            <div className="text-[14.5px] text-[#6B7280] mt-1.5">Listo para gestionar tu inventario hoy.</div>
            <RelojVivo now={now} />
            <div className="text-[13.5px] text-[#6B7280] mt-1 capitalize">{dateStr}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[12.5px] font-bold tracking-wide text-gold">INGRESOS HOY</div>
            <div className="text-[30px] font-extrabold text-[#111827] mt-2">{money0(ingresosHoy)}</div>
            <div className="text-[13px] font-bold text-[#1F7A4D] mt-1">{ventasActivas.length} ventas totales</div>
          </div>
        </div>

        {/* 4 tarjetas de stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {overviewStats.map((s, i) => (
            <div key={i} className={`${panel} px-4 py-4`}>
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-[34px] h-[34px] rounded-[9px] bg-app flex items-center justify-center">
                  <div className="w-[11px] h-[11px] rounded-[3px] bg-gold" />
                </div>
                <div className="flex gap-0.5">
                  <span className="w-[3px] h-[3px] rounded-full bg-[#D1D5DB]" /><span className="w-[3px] h-[3px] rounded-full bg-[#D1D5DB]" /><span className="w-[3px] h-[3px] rounded-full bg-[#D1D5DB]" />
                </div>
              </div>
              <div className="text-[12.5px] font-semibold text-mute mb-1.5">{s.label}</div>
              <div className="text-[22px] font-extrabold text-ink">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tareas rápidas + Calendario */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div className={`${panel} p-5`}>
            <div className="text-base font-extrabold text-ink">Tareas rápidas</div>
            <div className="text-[13px] text-mute mt-1 mb-4">Gestiona tus pendientes del día</div>
            <div className="flex border border-edge rounded-[9px] overflow-hidden mb-4">
              {(['pend', 'done'] as const).map(t => (
                <button key={t} onClick={() => setTaskTab(t)} className={`flex-1 py-2.5 text-[13px] font-bold transition-colors ${taskTab === t ? 'bg-gold text-white' : 'text-mute hover:bg-surface-2'}`}>
                  {t === 'pend' ? 'Pendientes' : 'Completadas'}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mb-4">
              <input value={taskInput} onChange={e => setTaskInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()} placeholder="Agregar una tarea..." className="flex-1 border border-edge rounded-lg px-3 py-2.5 text-[13.5px] bg-app text-ink placeholder-mute focus:outline-none focus:border-gold/50" />
              <button onClick={addTask} className="w-10 h-10 rounded-lg bg-gold text-white flex items-center justify-center text-lg font-bold hover:opacity-90 shrink-0">+</button>
            </div>
            {visibleTasks.length === 0 ? (
              <div className="text-center py-6 text-mute text-[13.5px]">No hay tareas {taskTab === 'pend' ? 'pendientes' : 'completadas'}</div>
            ) : (
              <div className="space-y-1">
                {visibleTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-2 group">
                    <button onClick={() => toggleTask(t.id)} className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 text-[11px] ${t.done ? 'bg-gold border-gold text-white' : 'border-edge'}`}>{t.done ? '✓' : ''}</button>
                    <span className={`flex-1 text-[13.5px] ${t.done ? 'line-through text-mute' : 'text-ink'}`}>{t.text}</span>
                    <button onClick={() => delTask(t.id)} className="text-mute opacity-0 group-hover:opacity-100 hover:text-red-500 text-xs">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`${panel} p-5`}>
            <div className="mb-4">
              <div className="text-base font-extrabold text-ink">Calendario</div>
              <div className="text-[13px] text-mute mt-1 capitalize">{dateStr}</div>
            </div>
            <div className="text-center text-sm font-bold capitalize mb-3">{monthLabel}</div>
            <div className="grid grid-cols-7 gap-0.5 text-[11px] font-bold text-mute text-center mb-1.5">
              {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {calCells.map((d, i) => (
                <div key={i} className={`text-center py-1.5 rounded-md text-[13px] font-semibold ${d === today ? 'bg-gold text-white' : d ? 'text-ink hover:bg-surface-2' : ''}`}>{d || ''}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Movimientos recientes */}
        <div className={`${panel} overflow-hidden`}>
          <div className="px-5 py-5 border-b border-edge">
            <div className="text-base font-extrabold text-ink">Movimientos recientes</div>
            <div className="text-[13px] text-mute mt-1">Últimas rentas y ventas registradas</div>
          </div>
          <div className="grid grid-cols-[1.6fr_1fr_1.1fr] px-5 py-2.5 text-[11.5px] font-bold tracking-wide text-mute border-b border-edge">
            <div>EQUIPO</div><div>ESTADO</div><div>ACTUALIZADO</div>
          </div>
          {moves.length === 0 && <div className="px-5 py-8 text-center text-mute text-sm">Sin movimientos aún.</div>}
          {moves.map((m, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_1fr_1.1fr] items-center px-5 py-3.5 border-b border-edge hover:bg-surface-2">
              <div className="flex items-center gap-2.5 font-bold text-sm text-ink min-w-0">
                <div className="w-[30px] h-[30px] rounded-lg bg-surface-2 shrink-0" />
                <span className="truncate">{m.name} <span className="font-mono text-[11px] text-mute font-normal">{m.code}</span></span>
              </div>
              <div><span className="text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap" style={{ color: m.color, background: m.bg }}>{m.status}</span></div>
              <div className="text-[13px] text-mute font-mono">{(m.ts || '').slice(0, 10) || '—'}</div>
            </div>
          ))}
        </div>

        {/* Mapa de actividad */}
        <div className={`${panel} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-base font-extrabold text-ink">Mapa de actividad</div>
              <div className="text-[13px] text-mute mt-1">Ubicación de rentas activas</div>
            </div>
            <button onClick={() => go('rentas')} className="text-[13px] font-bold text-gold hover:opacity-80">Ver detalle</button>
          </div>
          <div className="h-[180px] rounded-[10px] flex items-center justify-center font-mono text-[12.5px] text-mute" style={{ background: 'repeating-linear-gradient(45deg,#EFF0F3,#EFF0F3 10px,#F8F9FB 10px,#F8F9FB 20px)' }}>[ {rentas.length} rentas activas en obra ]</div>
        </div>
      </div>

      {/* ── Columna derecha ── */}
      <div className="flex flex-col gap-2.5 min-w-0">
        {/* Indicadores (dona) */}
        <div className={`${panel} p-5`}>
          <div className="text-base font-extrabold text-ink">Indicadores</div>
          <div className="text-[13px] text-mute mt-1 mb-5">Rendimiento operativo</div>
          {/* La dona reparte las unidades en sus tres estados, con el mismo color
              que la leyenda de abajo. Antes pintaba "disponibles" de dorado, que
              es el color de mantenimiento: el color contradecía el dato. */}
          <div className="flex justify-center mb-5">
            <div className="w-[150px] h-[150px] rounded-full flex items-center justify-center"
              style={{ background: donaGradiente }}
              role="img"
              aria-label={`${availabilityPct}% disponibles: ${disp} disponibles, ${rent} rentadas, ${mant} en mantenimiento`}>
              <div className="w-[110px] h-[110px] rounded-full bg-surface flex flex-col items-center justify-center">
                <span className="text-[26px] font-extrabold text-ink leading-none">{availabilityPct}%</span>
                <span className="text-[10.5px] text-mute mt-1">disponible</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {indicators.map((ind, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ind.color }} />
                  <div>
                    <div className="text-[13.5px] font-bold text-ink">{ind.label}</div>
                    <div className="text-[11.5px] text-mute">{ind.sub}</div>
                  </div>
                </div>
                <div className="text-[13.5px] font-extrabold" style={{ color: ind.color }}>{ind.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ingresos por mes */}
        <div className={`${panel} p-5`}>
          <div className="text-base font-extrabold text-ink">Ingresos por mes</div>
          <div className="text-[13px] text-mute mt-1 mb-4">Últimos 6 meses</div>
          <div className="flex items-end gap-1.5 h-[120px] mb-4">
            {revByMonth.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                {/* El mes en curso lleva el acento del tema; los anteriores, el
                    mismo color atenuado. Así las barras siguen al panel del dueño. */}
                <div className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max(4, (b.total / maxRev) * 100)}%`,
                    backgroundColor: 'var(--chart-blue)',
                    opacity: i === revByMonth.length - 1 ? 1 : 0.34,
                  }} />
                <div className="text-[11px] text-mute font-semibold">{b.label}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 border-t border-edge pt-4">
            <div><div className="text-[19px] font-extrabold text-ink">{money0(ingresosTotales)}</div><div className="text-[11.5px] text-mute mt-1">Ingresos totales</div></div>
            <div><div className="text-[19px] font-extrabold text-[#1F7A4D]">{mesesPositivos}/6</div><div className="text-[11.5px] text-mute mt-1">Meses con ingresos</div></div>
            <div><div className="text-[19px] font-extrabold text-ink">{money0(maxRev)}</div><div className="text-[11.5px] text-mute mt-1">Mejor mes</div></div>
          </div>
        </div>

        {/* Inventario por estado */}
        <div className={`${panel} p-5`}>
          <div className="text-base font-extrabold text-ink">Inventario por estado</div>
          <div className="text-[13px] text-mute mt-1 mb-5">Distribución actual</div>
          <div className="flex items-end gap-1 h-[110px] mb-3.5">
            {[{ l: 'Disp.', v: disp, c: '#1F7A4D' }, { l: 'Rent.', v: rent, c: '#2B5FAD' }, { l: 'Mant.', v: mant, c: '#B8872E' }, { l: 'Vend.', v: vend, c: '#9CA3AF' }].map((b, i) => {
              const mx = Math.max(1, disp, rent, mant, vend)
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="w-full rounded-t-md" style={{ height: `${Math.max(6, (b.v / mx) * 100)}%`, background: b.c }} />
                  <div className="text-[10.5px] text-mute font-semibold">{b.l}</div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-1.5 border-t border-edge pt-4">
            <div><div className="text-[19px] font-extrabold text-ink">{availabilityPct}%</div><div className="text-[11.5px] text-mute mt-1">Disponibilidad</div></div>
            <div><div className="text-[19px] font-extrabold text-ink">{total}</div><div className="text-[11.5px] text-mute mt-1">Total unidades</div></div>
            <div><div className="text-[19px] font-extrabold text-ink">{rentas.length}</div><div className="text-[11.5px] text-mute mt-1">En renta</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   EQUIPOS CRUD
════════════════════════════════════════ */
function EquiposAdmin({ equipos, categorias, tipos, marcas, reload, notify }: {
  equipos: Equipo[]; categorias: Option[]; tipos: Option[]; marcas: Option[]
  reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {

  // Clasificación exprés desde la lista: tres toques (categoría → tipo → marca)
  // con los modales de la casa, sin abrir el formulario completo.
  async function clasificarEquipo(e: Equipo) {
    const pedirUno = async (titulo: string, lista: Option[], actualId?: number) => {
      const sel = await elegir({
        titulo, mensaje: e.modelo,
        opciones: [
          ...lista.map(o => ({ valor: String(o.id), label: o.nombre, detalle: o.id === actualId ? 'Actual' : undefined })),
          { valor: '', label: 'Sin asignar' },
        ],
      })
      return sel === null ? null : (sel[0] || '')
    }
    const cat = await pedirUno('Categoría', categorias, e.categoria?.id); if (cat === null) return
    const tip = await pedirUno('Tipo', tipos, e.tipo?.id); if (tip === null) return
    const mar = await pedirUno('Marca', marcas, e.marca?.id); if (mar === null) return
    try {
      await api.patch(`/equipos/${e.id}/`, {
        categoria_id: cat ? Number(cat) : null,
        tipo_id: tip ? Number(tip) : null,
        marca_id: mar ? Number(mar) : null,
      })
      notify('Clasificación guardada')
      reload()
    } catch { notify('No se pudo guardar la clasificación', 'err') }
  }
  const empty: Equipo = { modelo: '', descripcion: '', precio_dia: '', precio_semana: '', precio_mes: '', precio_venta: '', especificaciones: [], que_incluye: [], promo_pct: 0 }
  const [form, setForm] = useState<Equipo>(empty)
  // Helpers del editor de especificaciones técnicas (etiqueta → valor)
  const specs = form.especificaciones || []
  const setSpecs = (s: { etiqueta: string; valor: string }[]) => setForm(f => ({ ...f, especificaciones: s }))
  const addSpec = () => setSpecs([...specs, { etiqueta: '', valor: '' }])
  const setSpec = (i: number, k: 'etiqueta' | 'valor', v: string) => setSpecs(specs.map((s, j) => j === i ? { ...s, [k]: v } : s))
  const removeSpec = (i: number) => setSpecs(specs.filter((_, j) => j !== i))
  // Sugerencias rápidas (las de una ficha típica de generador/maquinaria)
  const SPEC_SUGERIDAS = ['Frecuencia', 'Peso bruto', 'Dimensiones', 'Tipo de motor', 'Sistema de arranque', 'Potencia del motor', 'Capacidad de aceite', 'Modelo de motor', 'Voltaje', 'Potencia nominal', 'Capacidad de combustible', 'Nivel de ruido']
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [fichaFile, setFichaFile] = useState<File | null>(null)
  const [previewFicha, setPreviewFicha] = useState(false)
  const [saving, setSaving] = useState(false)
  const [invEquipo, setInvEquipo] = useState<Equipo | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cond, setCond] = useState<'nueva' | 'seminueva'>('seminueva')
  const [cantidad, setCantidad] = useState('1')
  const editing = Boolean(form.id)

  const filtrados = equipos.filter(e => {
    if (!q.trim()) return true
    const t = `${e.modelo} ${e.categoria?.nombre || ''} ${e.marca?.nombre || ''} ${e.tipo?.nombre || ''}`.toLowerCase()
    return t.includes(q.trim().toLowerCase())
  })
  const totalDisponibles = equipos.reduce((a, e) => a + (e.stock_disponible ?? 0), 0)
  const sinPrecio = equipos.filter(e => !num(e.precio_dia) && !num(e.precio_venta)).length

  const puede = usePuede()
  const puedeEditar = puede('editar_catalogo')   // el técnico consulta el catálogo, no lo cambia

  function openNew() { setForm(empty); setImageFile(null); setFichaFile(null); setCond('seminueva'); setCantidad('1'); setFormOpen(true) }
  function openEdit(e: Equipo) { setForm({ ...e }); setCond(((e as any).condicion as 'nueva' | 'seminueva') || 'nueva'); setImageFile(null); setFichaFile(null); setFormOpen(true) }

  async function save() {
    if (!form.modelo.trim()) { notify('El modelo es obligatorio', 'err'); return }
    // Venta exige al menos una característica (con ella se arma la ficha del cliente).
    if (cond === 'nueva' && !(form.especificaciones || []).some(s => s.etiqueta.trim() && s.valor.trim())) {
      notify('Un equipo de venta necesita al menos una característica', 'err'); return
    }
    setSaving(true)
    const fd = new FormData()
    fd.append('modelo', form.modelo)
    if (form.descripcion) fd.append('descripcion', form.descripcion)
    // La condición define el modo del equipo: nueva = venta, seminueva = renta.
    fd.append('condicion', cond)
    // Nueva solo se vende: no se mandan precios de renta aunque hayan quedado escritos.
    const soloVenta = cond === 'nueva'
    const camposPrecio = soloVenta
      ? (['precio_venta'] as const)
      : (['precio_dia', 'precio_semana', 'precio_mes', 'precio_venta'] as const)
    for (const k of camposPrecio) {
      const v = form[k]
      if (v !== '' && v != null) fd.append(k, String(v))
    }
    if (form.categoria?.id) fd.append('categoria_id', String(form.categoria.id))
    if (form.tipo?.id) fd.append('tipo_id', String(form.tipo.id))
    if (form.marca?.id) fd.append('marca_id', String(form.marca.id))
    if (imageFile) fd.append('imagen', imageFile)
    if (fichaFile) fd.append('ficha_tecnica', fichaFile)
    // Especificaciones técnicas (el backend descarta las filas incompletas)
    fd.append('especificaciones', JSON.stringify(
      (form.especificaciones || []).filter(s => s.etiqueta.trim() && s.valor.trim())
    ))
    // "Qué incluye": una línea por punto (formato libre "Título: detalle")
    fd.append('que_incluye', JSON.stringify((form.que_incluye || []).map(l => l.trim()).filter(Boolean)))
    fd.append('promo_pct', String(Math.max(0, Math.min(90, Number(form.promo_pct) || 0))))

    try {
      const method = editing ? 'patch' : 'post'
      const url = editing ? `/equipos/${form.id}/` : '/equipos/'
      const res = await api({ method, url, data: fd })

      // Al CREAR: generar las unidades de inventario en UNA llamada atómica
      // (el backend crea las N o ninguna; ya no es un bucle que traga errores).
      if (!editing) {
        const equipoId = res.data?.id
        const n = Math.max(1, Math.min(100, Number(cantidad) || 1))
        if (equipoId) {
          try {
            const u = await api.post(`/equipos/${equipoId}/unidades/`, { condicion: cond, cantidad: n })
            const creadas = u.data?.cantidad ?? n
            notify(`Producto creado · ${creadas} unidad${creadas > 1 ? 'es' : ''} en inventario`)
          } catch {
            // El producto sí se creó; fallaron las unidades. Se dice la verdad.
            notify('Producto creado, pero no se pudieron generar las unidades. Agrégalas desde Inventario.', 'err')
          }
        } else {
          notify('Producto creado')
        }
      } else {
        notify('Producto actualizado')
      }
      setForm(empty); setImageFile(null); setFichaFile(null); setFormOpen(false); reload()
    } catch (err: any) {
      notify(errorMsg(err, 'Error al guardar'), 'err')
    } finally {
      setSaving(false)
    }
  }

  function del(id?: number) {
    if (!id || !confirm('¿Eliminar este producto?')) return
    api.delete(`/equipos/${id}/`)
      .then(() => { notify('Producto eliminado'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al eliminar', 'err'))
  }

  const sel = (opts: Option[], current: Option | null | undefined, onPick: (o: Option | null) => void, placeholder: string) => (
    <select
      value={current?.id || ''}
      onChange={e => { const id = Number(e.target.value); onPick(id ? { id, nombre: opts.find(o => o.id === id)?.nombre || '' } : null) }}
      className={input}
    >
      <option value="" className="bg-surface">{placeholder}</option>
      {opts.map(o => <option key={o.id} value={o.id} className="bg-surface">{o.nombre}</option>)}
    </select>
  )

  const kpis = [
    { label: 'Productos', value: equipos.length },
    { label: 'Unidades disponibles', value: totalDisponibles },
    { label: 'Sin precio', value: sinPrecio, warn: sinPrecio > 0 },
  ]

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <KpiGrid
        items={kpis.map(k => ({
          label: k.label,
          value: k.value,
          tone: (k as any).warn ? 'danger' : 'default',
          emphasis: Boolean((k as any).warn),
        }))}
      />

      {/* Tabla de productos */}
      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-edge flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="font-bold text-ink shrink-0">Productos <span className="text-mute font-normal">({filtrados.length})</span></h2>
          <div className="flex-1 flex items-center gap-3 sm:justify-end">
            <div className="relative flex-1 sm:max-w-xs">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto..."
                className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
            </div>
            {puedeEditar && (
              <button onClick={openNew} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                <span className="hidden sm:inline">Nuevo producto</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Producto</th>
                <th className="font-semibold px-3 py-3">Clasificación</th>
                <th className="font-semibold px-3 py-3">Condición</th>
                <th className="font-semibold px-3 py-3 text-right">Precio/día</th>
                <th className="font-semibold px-3 py-3 text-right">Venta</th>
                <th className="font-semibold px-3 py-3 text-center">Unidades</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtrados.map(e => {
                const disp = e.stock_disponible ?? 0
                const total = e.unidades_total ?? disp
                return (
                  <tr key={e.id} className="hover:bg-surface-2 transition-colors group">
                    {/* Producto */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-lg bg-surface-2 overflow-hidden shrink-0">
                          {e.imagen && <img src={resolveMediaUrl(e.imagen)} alt={e.modelo} className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink truncate">{e.modelo}</p>
                          {e.descripcion && <p className="text-xs text-mute truncate max-w-[220px]">{e.descripcion}</p>}
                        </div>
                      </div>
                    </td>
                    {/* Clasificación: clic para asignarla ahí mismo, sin abrir el formulario */}
                    <td className="px-3 py-3">
                      {(e.categoria || e.tipo || e.marca) ? (
                        <button onClick={() => clasificarEquipo(e)} className="text-left group/cl" title="Cambiar clasificación">
                          <p className="text-xs text-ink group-hover/cl:text-gold transition-colors">{e.categoria?.nombre || '—'}</p>
                          <p className="text-[11px] text-mute">{[e.marca?.nombre, e.tipo?.nombre].filter(Boolean).join(' · ') || '—'}</p>
                        </button>
                      ) : (
                        <button onClick={() => clasificarEquipo(e)} className="text-[11px] px-2.5 py-1 rounded-md border border-dashed border-edge text-mute hover:text-gold hover:border-gold/50 transition-colors">
                          Asignar
                        </button>
                      )}
                    </td>
                    {/* Condición */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(e.condiciones || []).includes('nueva') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold uppercase">Nuevo</span>}
                        {(e.condiciones || []).includes('seminueva') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-bold uppercase">Semin.</span>}
                        {!(e.condiciones || []).length && <span className="text-[11px] text-mute">—</span>}
                      </div>
                    </td>
                    {/* Precio día */}
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-sm font-semibold text-price">${num(e.precio_dia).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </td>
                    {/* Venta */}
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-sm text-ink">{num(e.precio_venta) ? `$${num(e.precio_venta).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</span>
                    </td>
                    {/* Unidades (cada máquina es una pieza única, no stock fungible) */}
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <span className="text-sm font-bold text-ink">{total}</span>
                      <span className="text-[11px] text-mute"> und.</span>
                      <p className={`text-[10px] font-semibold ${disp > 0 ? 'text-emerald-500' : 'text-mute'}`}>{disp} disp.</p>
                    </td>
                    {/* Acciones */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setInvEquipo(e)} title="Inventario" className="px-3 py-1.5 rounded-lg bg-gold-soft text-gold text-xs font-semibold hover:bg-gold/20 transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                          <span className="hidden lg:inline">Inventario</span>
                        </button>
                        <button onClick={() => openEdit(e)} title="Editar" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button onClick={() => del(e.id)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtrados.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-mute">{q ? 'Sin resultados para tu búsqueda.' : 'Aún no hay productos.'}</p>
              {!q && puedeEditar && <button onClick={openNew} className="mt-3 text-sm font-semibold text-gold hover:opacity-80">+ Crear el primero</button>}
            </div>
          )}
        </div>
      </Card>

      {/* Panel lateral de formulario (crear/editar): se desliza desde la derecha
          y deja visible la lista detrás — el contexto no se pierde. */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={() => setFormOpen(false)}>
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="fixed inset-y-0 right-0 w-full sm:max-w-[600px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0">
              <h2 className="font-bold text-ink">{editing ? 'Editar producto' : 'Nuevo producto'}</h2>
              <button onClick={() => setFormOpen(false)} className="text-mute hover:text-ink p-1" aria-label="Cerrar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className={label}>Modelo *</label>
                <input className={input} value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} placeholder="Ej. Mezcladora 9ft³" autoFocus />
              </div>
              <div>
                <label className={label}>Descripción</label>
                <textarea className={`${input} resize-none`} rows={2} value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Características del equipo" />
              </div>
              {/* Al crear: la condición define qué precios aplican (nueva = solo venta) */}
              <div className="rounded-2xl border border-gold/20 bg-gold-soft/50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gold mb-1">Condición</p>
                <p className="text-xs text-mute mb-3"><b>Nueva</b> → se vende. <b>Seminueva</b> → se renta. Define en qué sección del catálogo aparece.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Condición</label>
                    <select className={input} value={cond} onChange={e => setCond(e.target.value as any)}>
                      <option value="seminueva" className="bg-surface">Seminueva (renta)</option>
                      <option value="nueva" className="bg-surface">Nueva (venta)</option>
                    </select>
                  </div>
                  {!editing && (
                    <div>
                      <label className={label}>Cantidad de unidades</label>
                      <input type="number" min={1} max={100} className={input} value={cantidad} onChange={e => setCantidad(e.target.value)} />
                    </div>
                  )}
                </div>
              </div>

              {/* Renta → precios de renta; venta → solo su precio de venta. El precio
                  de venta de un equipo de RENTA es interno (el público no lo ve). */}
              <div className="grid grid-cols-2 gap-3">
                {cond === 'seminueva' && (<>
                  <div><label className={label}>Precio / día</label><input type="number" className={input} value={form.precio_dia ?? ''} onChange={e => setForm({ ...form, precio_dia: e.target.value })} placeholder="0.00" /></div>
                  <div><label className={label}>Precio / semana</label><input type="number" className={input} value={form.precio_semana ?? ''} onChange={e => setForm({ ...form, precio_semana: e.target.value })} placeholder="0.00" /></div>
                  <div><label className={label}>Precio / mes</label><input type="number" className={input} value={form.precio_mes ?? ''} onChange={e => setForm({ ...form, precio_mes: e.target.value })} placeholder="0.00" /></div>
                </>)}
                <div className={cond === 'seminueva' ? '' : 'col-span-2'}>
                  <label className={label}>Precio venta{cond === 'seminueva' ? ' (interno)' : ''}</label>
                  <input type="number" className={input} value={form.precio_venta ?? ''} onChange={e => setForm({ ...form, precio_venta: e.target.value })} placeholder="0.00" />
                </div>
                {cond === 'nueva' && (
                  <p className="col-span-2 text-[11px] text-mute -mt-1">Las <b>nuevas</b> solo se venden, por eso no se piden precios de renta.</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div><label className={label}>Categoría</label>{sel(categorias, form.categoria, o => setForm({ ...form, categoria: o }), 'Selecciona categoría')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>Tipo</label>{sel(tipos, form.tipo, o => setForm({ ...form, tipo: o }), 'Tipo')}</div>
                  <div><label className={label}>Marca</label>{sel(marcas, form.marca, o => setForm({ ...form, marca: o }), 'Marca')}</div>
                </div>
              </div>
              <div>
                <label className={label}>Imagen <span className="text-mute font-normal normal-case">(JPG, PNG, WebP)</span></label>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" onChange={e => setImageFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-gold-soft file:text-gold file:text-xs file:font-semibold hover:file:bg-gold/20 file:cursor-pointer" />
                {editing && form.imagen && !imageFile && (
                  <img src={resolveMediaUrl(form.imagen)} alt="" className="mt-3 w-20 h-20 object-cover rounded-lg" />
                )}
              </div>
              {/* La ficha técnica (PDF) es solo para equipos de VENTA. */}
              {cond === 'nueva' && (
              <div>
                <label className={label}>Ficha técnica <span className="text-mute font-normal normal-case">(PDF — la que descarga el cliente)</span></label>
                <input type="file" accept="application/pdf,.pdf" onChange={e => setFichaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-gold-soft file:text-gold file:text-xs file:font-semibold hover:file:bg-gold/20 file:cursor-pointer" />
                {fichaFile
                  ? <p className="mt-2 text-[11px] text-emerald-600">Nueva ficha: {fichaFile.name}</p>
                  : (editing && form.ficha_tecnica && (
                    <a href={resolveMediaUrl(form.ficha_tecnica)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gold hover:underline">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Ver ficha actual
                    </a>
                  ))}
              </div>
              )}

              {/* Especificaciones técnicas: se muestran en la página del producto */}
              <div className="rounded-2xl border border-edge p-4">
                <div className="flex items-center justify-between mb-1">
                  <label className={`${label} !mb-0`}>Especificaciones técnicas{cond === 'nueva' && <span className="text-red-400"> *</span>}</label>
                  <span className="text-[11px] text-mute">{cond === 'nueva' ? 'Obligatorias para venta' : 'Se muestran en la ficha del producto'}</span>
                </div>
                {specs.length > 0 && (
                  <div className="space-y-2 mt-3">
                    {specs.map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input list="spec-sugeridas" className={`${input} flex-1`} value={s.etiqueta} onChange={e => setSpec(i, 'etiqueta', e.target.value)} placeholder="Etiqueta (ej. Frecuencia)" />
                        <input className={`${input} flex-1`} value={s.valor} onChange={e => setSpec(i, 'valor', e.target.value)} placeholder="Valor (ej. 60 Hz)" />
                        <button type="button" onClick={() => removeSpec(i)} title="Quitar" className="shrink-0 w-9 h-9 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <datalist id="spec-sugeridas">{SPEC_SUGERIDAS.map(s => <option key={s} value={s} />)}</datalist>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button type="button" onClick={addSpec} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold hover:opacity-80">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                    Agregar especificación
                  </button>
                  {form.modelo.trim() && (
                    <button type="button" onClick={() => setPreviewFicha(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-gold transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                      Vista previa de ficha
                    </button>
                  )}
                </div>
              </div>

              {/* Promo por equipo: porcentaje de descuento (0 = sin promo) */}
              <div className="rounded-2xl border border-edge p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className={`${label} !mb-0`}>Descuento de promoción</label>
                    <p className="text-[11px] text-mute mt-0.5">Porcentaje que se descuenta del precio. Deja 0 si no hay promoción.</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input type="number" min={0} max={90} className={`${input} !w-20 text-center`} value={form.promo_pct ?? 0}
                      onChange={e => setForm(f => ({ ...f, promo_pct: Number(e.target.value) }))} />
                    <span className="text-lg font-bold text-mute">%</span>
                  </div>
                </div>
                {Number(form.promo_pct) > 0 && (
                  <p className="text-[12px] text-gold mt-2.5">
                    El cliente verá la etiqueta roja «PROMO −{Math.min(90, Math.max(0, Number(form.promo_pct) || 0))}%», el precio ya
                    rebajado y el precio original tachado. Ej.: $1,000 queda en ${(1000 * (1 - Math.min(90, Math.max(0, Number(form.promo_pct) || 0)) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2 })}.
                  </p>
                )}
              </div>

              {/* Qué incluye: lista que se muestra en la pestaña del detalle público */}
              <div className="rounded-2xl border border-edge p-4">
                <div className="flex items-center justify-between mb-1">
                  <label className={`${label} !mb-0`}>Qué incluye</label>
                  <span className="text-[11px] text-mute">Una línea por punto · "Título: detalle"</span>
                </div>
                <textarea rows={4} className={`${input} mt-2 resize-y`} value={(form.que_incluye || []).join('\n')}
                  onChange={e => setForm(f => ({ ...f, que_incluye: e.target.value.split('\n') }))}
                  placeholder={'Punta y cincel plano: encastre hex 1-1/8\"\nMaletín metálico: con espacio para accesorios'} />
              </div>

            </div>
            <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
              <button onClick={() => setFormOpen(false)} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                {editing ? 'Guardar' : 'Crear producto'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {invEquipo && <InventoryModal equipo={invEquipo} onClose={() => setInvEquipo(null)} notify={notify} />}
      {previewFicha && (
        <FichaTecnicaModal
          equipo={{ modelo: form.modelo, descripcion: form.descripcion, imagen: form.imagen, especificaciones: specs, categoria: form.categoria, tipo: form.tipo, marca: form.marca, condicion: cond, que_incluye: form.que_incluye }}
          onClose={() => setPreviewFicha(false)}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   GESTIÓN DE INVENTARIO (unidades + QR + renta/venta)
════════════════════════════════════════ */
type Unidad = {
  id: number
  codigo: string
  numero_serie: string | null
  condicion: 'nueva' | 'seminueva'
  estado: 'disponible' | 'rentado' | 'mantenimiento' | 'vendido'
  ubicacion_actual: string
  puede_rentarse: boolean
  puede_venderse: boolean
  equipo?: number
  equipo_modelo?: string
  equipo_info?: {
    id: number; modelo: string; imagen: string | null
    precio_dia: string | null; precio_semana: string | null; precio_mes: string | null; precio_venta: string | null
    condicion?: 'nueva' | 'seminueva'; modo?: 'venta' | 'renta'
  } | null
  renta_activa: null | {
    id: number; cliente: string; telefono_cliente: string; direccion: string
    modalidad: string; fecha_fin: string; dias_restantes: number; vencida: boolean
  }
}

// Construye un objeto Equipo ligero desde la info que trae la unidad (vista global)
function equipoFromUnit(u: Unidad): Equipo {
  const e = u.equipo_info
  return {
    id: e?.id ?? u.equipo,
    modelo: e?.modelo || u.equipo_modelo || 'Equipo',
    imagen: e?.imagen ?? null,
    precio_dia: e?.precio_dia ?? null,
    precio_semana: e?.precio_semana ?? null,
    precio_mes: e?.precio_mes ?? null,
    precio_venta: e?.precio_venta ?? null,
  }
}

const pillBase = 'inline-flex items-center gap-2 h-5 px-2 rounded-full border bg-surface text-[10px] font-semibold tracking-tight'
const pillTones = {
  emerald: { wrap: 'border-emerald-500/25 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  blue: { wrap: 'border-blue-500/25 text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  amber: { wrap: 'border-amber-500/25 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  neutral: { wrap: 'border-edge text-mute', dot: 'bg-mute' },
} as const

function Pill({ tone, label }: { tone: keyof typeof pillTones; label: string }) {
  const t = pillTones[tone]
  return (
    <span className={`${pillBase} ${t.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
      <span className="leading-none">{label}</span>
    </span>
  )
}

function estadoLabel(v: Unidad['estado']) {
  if (v === 'disponible') return 'Disponible'
  if (v === 'rentado') return 'Rentado'
  if (v === 'mantenimiento') return 'Mantenimiento'
  if (v === 'vendido') return 'Vendido'
  return v
}

function condLabel(v: Unidad['condicion']) {
  return v === 'nueva' ? 'Nueva' : 'Seminueva'
}

function pillEstado(v: Unidad['estado']) {
  if (v === 'disponible') return <Pill tone="emerald" label={estadoLabel(v)} />
  if (v === 'rentado') return <Pill tone="blue" label={estadoLabel(v)} />
  if (v === 'mantenimiento') return <Pill tone="amber" label={estadoLabel(v)} />
  return <Pill tone="neutral" label={estadoLabel(v)} />
}

function pillCond(v: Unidad['condicion']) {
  return v === 'nueva' ? <Pill tone="emerald" label={condLabel(v)} /> : <Pill tone="blue" label={condLabel(v)} />
}

function BannerConcretando() {
  const [p, setP] = useState(leerCotParaRenta())
  if (!p) return null
  return (
    <div className="mx-6 mt-3 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-[color:var(--c-renta)]/40 bg-[color:var(--c-renta)]/10 text-[color:var(--c-renta)] text-[12.5px] font-bold">
      <span>Concretando {p.folio || 'cotización'} · {p.cliente || 'cliente'} — elige la unidad y tócale Rentar</span>
      <button onClick={() => { fijarCotParaRenta(null); setP(null) }} aria-label="Cancelar vínculo" className="hover:opacity-70 shrink-0">✕</button>
    </div>
  )
}

function InventoryModal({ equipo, onClose, notify }: {
  equipo: Equipo; onClose: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newCond, setNewCond] = useState<'nueva' | 'seminueva'>('seminueva')
  const [newSerie, setNewSerie] = useState('')
  const [qrUnit, setQrUnit] = useState<Unidad | null>(null)
  const [rentUnit, setRentUnit] = useState<Unidad | null>(null)
  const [sellUnit, setSellUnit] = useState<Unidad | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<Unidad[]>(`/equipos/${equipo.id}/unidades/`)
      .then(r => setUnidades(r.data || []))
      .catch(() => setUnidades([]))
      .finally(() => setLoading(false))
  }, [equipo.id])
  useEffect(() => { load() }, [load])

  const puedeAlta = usePuede()('alta_inventario')

  function addUnit() {
    setAdding(true)
    api.post(`/equipos/${equipo.id}/unidades/`, { condicion: newCond, numero_serie: newSerie.trim() || null })
      .then(() => { notify('Unidad agregada'); setNewSerie(''); load() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al agregar', 'err'))
      .finally(() => setAdding(false))
  }

  function delUnit(u: Unidad) {
    if (!confirm(`¿Eliminar la unidad ${u.codigo}?`)) return
    api.delete(`/unidades/${u.id}/`)
      .then(() => { notify('Unidad eliminada'); load() })
      .catch(err => notify(err?.response?.data?.detail || err?.response?.data?.[0] || 'No se puede eliminar', 'err'))
  }

  function devolver(u: Unidad) {
    if (!u.renta_activa) return
    api.post(`/rentas/${u.renta_activa.id}/devolver/`)
      .then(() => { notify('Equipo devuelto'); load() })
      .catch(() => notify('Error al devolver', 'err'))
  }

  const counts = {
    disponible: unidades.filter(u => u.estado === 'disponible').length,
    rentado: unidades.filter(u => u.estado === 'rentado').length,
    vendido: unidades.filter(u => u.estado === 'vendido').length,
  }

  return (
    <div className="modal-in fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-start justify-center p-0 sm:p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full sm:max-w-5xl sm:rounded-3xl rounded-t-3xl border border-edge sm:my-auto max-h-[92vh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-edge flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-surface-2 overflow-hidden shrink-0">
              {equipo.imagen && <img src={resolveMediaUrl(equipo.imagen)} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-black text-ink truncate">Inventario · {equipo.modelo}</h2>
              <div className="flex gap-2 mt-1 text-[11px] font-mono">
                <span className="text-emerald-500">{counts.disponible} disp.</span>
                <span className="text-blue-500">{counts.rentado} rentado</span>
                <span className="text-mute">{counts.vendido} vendido</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1 shrink-0" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Agregar unidad: aumenta el patrimonio, solo administración */}
        {puedeAlta && <div className="px-6 py-4 border-b border-edge bg-surface-2/40">
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={newCond} onChange={e => setNewCond(e.target.value as any)} className={`${input} sm:w-40`}>
              <option value="seminueva" className="bg-surface">Seminueva</option>
              <option value="nueva" className="bg-surface">Nueva</option>
            </select>
            <input className={input} value={newSerie} onChange={e => setNewSerie(e.target.value)} placeholder="N° de serie (opcional)" />
            <button onClick={addUnit} disabled={adding} className="shrink-0 px-5 py-2.5 rounded-xl bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap">
              + Agregar unidad
            </button>
          </div>
          <p className="text-[11px] text-mute mt-2">
            Las unidades <b>nuevas</b> solo se venden. Las <b>seminuevas</b> se rentan y venden.
          </p>
        </div>}
        <BannerConcretando />

        {/* Lista de unidades */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-sm text-mute text-center py-8">Cargando…</p>}
          {!loading && unidades.length === 0 && (
            <p className="text-sm text-mute text-center py-8">
              {puedeAlta ? 'Sin unidades. Agrega la primera ↑' : 'Este producto no tiene unidades registradas.'}
            </p>
          )}
          {unidades.map(u => (
            <div key={u.id} className="border border-edge rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-ink">{u.codigo}</span>
                    {pillEstado(u.estado)}
                    {pillCond(u.condicion)}
                  </div>
                  <p className="text-xs text-mute mt-1">
                    {u.numero_serie ? `Serie: ${u.numero_serie} · ` : ''}Ubicación: {u.ubicacion_actual}
                  </p>
                  {u.renta_activa && (
                    <div className="mt-2 text-xs bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                      <p className="text-blue-500 font-semibold flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        {u.renta_activa.cliente || 'Cliente'}
                        {u.renta_activa.telefono_cliente && <span className="text-mute font-normal">· {u.renta_activa.telefono_cliente}</span>}
                      </p>
                      <p className="text-mute mt-0.5">Ubicación: {u.renta_activa.direccion}</p>
                      <p className={`mt-0.5 ${u.renta_activa.vencida ? 'text-red-400 font-semibold' : 'text-mute'}`}>
                        {u.renta_activa.vencida ? '⚠ Vencida — recoger' : `Vence ${u.renta_activa.fecha_fin} (${u.renta_activa.dias_restantes}d)`}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setQrUnit(u)} title="QR" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" /></svg>
                  </button>
                  {u.estado === 'rentado' && (
                    <button onClick={() => devolver(u)} className="px-3 h-8 rounded-lg border border-blue-500/30 text-blue-500 text-xs font-semibold hover:bg-blue-500/10 transition-colors">Devolver</button>
                  )}
                  {u.puede_rentarse && (
                    <button onClick={() => setRentUnit(u)} className="btn-renta px-3 h-8 rounded-full text-xs font-bold">Rentar</button>
                  )}
                  {u.puede_venderse && (
                    <button onClick={() => setSellUnit(u)} className="px-3 h-8 rounded-lg bg-gold text-black text-xs font-bold hover:opacity-90 transition-opacity">Vender</button>
                  )}
                  {u.estado === 'disponible' && (
                    <button onClick={() => delUnit(u)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {qrUnit && <QRModal unit={qrUnit} equipo={equipo} onClose={() => setQrUnit(null)} />}
      {rentUnit && <RentModal unit={rentUnit} equipo={equipo} onClose={() => setRentUnit(null)} onDone={() => { setRentUnit(null); load() }} notify={notify} />}
      {sellUnit && <SellModal unit={sellUnit} equipo={equipo} onClose={() => setSellUnit(null)} onDone={() => { setSellUnit(null); load() }} notify={notify} />}
    </div>
  )
}

/* ── QR de la unidad ── */
function QRModal({ unit, equipo, onClose }: { unit: Unidad; equipo: Equipo; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  // URL viva: al escanear, el teléfono abre la ficha de la unidad.
  const payload = `${window.location.origin}/u/${unit.codigo}`
  useEffect(() => {
    QRCode.toDataURL(payload, { width: 320, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setDataUrl).catch(() => setDataUrl(''))
  }, [payload])

  function download() {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `QR-${unit.codigo}.png`
    a.click()
  }

  return (
    <div className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-edge rounded-3xl p-8 max-w-xs w-full text-center">
        <h3 className="font-black text-ink mb-1">{unit.codigo}</h3>
        <p className="text-xs text-mute mb-5">{equipo.modelo}{unit.numero_serie ? ` · ${unit.numero_serie}` : ''}</p>
        <div className="bg-white rounded-2xl p-4 inline-block">
          {dataUrl ? <img src={dataUrl} alt="QR" className="w-48 h-48" /> : <div className="w-48 h-48 animate-pulse bg-neutral-200 rounded" />}
        </div>
        <p className="text-[11px] text-mute mt-4">Escanea para identificar la unidad y su estado.</p>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cerrar</button>
          <button onClick={download} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">Descargar</button>
        </div>
      </div>
    </div>
  )
}

/* ── Captura fiscal reutilizable (para "El cliente pedirá factura") ── */
type FacturaData = { rfc: string; razon_social: string; codigo_postal: string; regimen_fiscal: string; uso_cfdi: string; email: string }
const FACTURA_VACIA: FacturaData = { rfc: '', razon_social: '', codigo_postal: '', regimen_fiscal: '', uso_cfdi: '', email: '' }

function FacturaFields({ requiere, onRequiere, factura, onFactura, empresaNombre }: {
  requiere: boolean; onRequiere: (v: boolean) => void
  factura: FacturaData; onFactura: (f: FacturaData) => void
  empresaNombre?: string
}) {
  const set = (k: keyof FacturaData, v: string) => onFactura({ ...factura, [k]: v })
  const flbl = 'block text-[10.5px] font-bold tracking-[0.4px] text-mute mb-1.5'
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-bold text-ink">El cliente pedirá factura</p>
          <p className="text-[12px] text-mute mt-0.5">Se guarda en “Por facturar” para timbrarla aparte.</p>
        </div>
        <button
          type="button" role="switch" aria-checked={requiere} onClick={() => onRequiere(!requiere)}
          className={`relative w-10 h-[22px] rounded-full flex-none transition-colors ${requiere ? 'bg-[#2B6CF6]' : 'bg-ink/15'}`}
          aria-label="El cliente pedirá factura"
        >
          <span className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all ${requiere ? 'left-[20px]' : 'left-[2px]'}`} />
        </button>
      </div>
      {requiere && (
        <div className="border-t border-edge mt-3.5 pt-3.5">
          {empresaNombre ? (
            <p className="text-[12px] text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">Se usarán los datos fiscales guardados de <b>{empresaNombre}</b>.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={flbl}>RFC</label><input className={`${input} font-mono`} value={factura.rfc} onChange={e => set('rfc', e.target.value.toUpperCase())} placeholder="XAXX010101000" /></div>
                <div><label className={flbl}>C.P.</label><input className={input} value={factura.codigo_postal} onChange={e => set('codigo_postal', e.target.value)} placeholder="00000" inputMode="numeric" /></div>
              </div>
              <div><label className={flbl}>RAZÓN SOCIAL</label><input className={input} value={factura.razon_social} onChange={e => set('razon_social', e.target.value)} placeholder="Razón social del cliente" /></div>
              <div>
                <label className={flbl}>RÉGIMEN FISCAL</label>
                <select className={input} value={factura.regimen_fiscal} onChange={e => set('regimen_fiscal', e.target.value)}>
                  <option value="">Selecciona…</option>
                  {REGIMEN_FISCAL.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={flbl}>USO DE CFDI</label>
                <select className={input} value={factura.uso_cfdi} onChange={e => set('uso_cfdi', e.target.value)}>
                  <option value="">Selecciona…</option>
                  {USO_CFDI.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
                </select>
              </div>
              <div><label className={flbl}>EMAIL <span className="text-mute/70 font-normal">(opcional)</span></label><input type="email" className={input} value={factura.email} onChange={e => set('email', e.target.value)} placeholder="Para enviar la factura" /></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Valida los datos fiscales de mostrador; devuelve mensaje de error o null.
function validarFactura(requiere: boolean, empresaId: string, f: FacturaData): string | null {
  if (!requiere || empresaId) return null
  const faltan: string[] = []
  if (!f.rfc.trim()) faltan.push('RFC')
  if (!f.razon_social.trim()) faltan.push('Razón social')
  if (!f.codigo_postal.trim()) faltan.push('CP')
  if (!f.regimen_fiscal) faltan.push('Régimen')
  if (!f.uso_cfdi) faltan.push('Uso CFDI')
  return faltan.length ? `Para facturar falta: ${faltan.join(', ')}` : null
}

/* ── Registrar renta ── */
function RentModal({ unit, equipo, onClose, onDone, notify }: {
  unit: Unidad; equipo: Equipo; onClose: () => void; onDone: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [cliente, setCliente] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [modalidad, setModalidad] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [duracion, setDuracion] = useState('1')
  const [fechaInicio, setFechaInicio] = useState(hoy)
  const [descuento, setDescuento] = useState('')
  const [deposito, setDeposito] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [obras, setObras] = useState<Obra[]>([])
  const [obraId, setObraId] = useState('')
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [clientes, setClientes] = useState<{ id: number; nombre: string; empresa?: string }[]>([])
  const [usuarioId, setUsuarioId] = useState('')
  // ¿Venimos de "Concretar renta" de una cotización? Precarga y liga.
  const [deCot, setDeCot] = useState(leerCotParaRenta())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/empresas/').then(r => setEmpresas(Array.isArray(r.data) ? r.data : (r.data?.results || []))).catch(() => {})
    // Cuentas de cliente, para vincular la renta a su panel ("Tus rentas").
    api.get<{ clientes: { id: number; nombre: string; empresa?: string }[] }>('/clientes-lookup/').then(r => setClientes(r.data.clientes || [])).catch(() => {})
    // Datos de la cotización que se está concretando (si aplica).
    const puente = leerCotParaRenta()
    if (puente) {
      if (puente.cliente) setCliente(puente.cliente)
      if (puente.telefono) setTelefono(puente.telefono)
      if (puente.direccion) setDireccion(puente.direccion)
      if (puente.usuario_id) setUsuarioId(String(puente.usuario_id))
      if (puente.modalidad) setModalidad(puente.modalidad)
      if (puente.duracion) setDuracion(String(puente.duracion))
    }
  }, [])
  useEffect(() => {
    if (!empresaId) { setObras([]); setObraId(''); return }
    api.get(`/empresas/${empresaId}/obras/`).then(r => setObras(Array.isArray(r.data) ? r.data : (r.data?.results || []))).catch(() => setObras([]))
  }, [empresaId])

  // Al elegir empresa: rellena con el contacto/teléfono/domicilio guardados.
  function elegirEmpresa(id: string) {
    setEmpresaId(id); setObraId('')
    const em = empresas.find(e => String(e.id) === id)
    if (em) {
      setCliente(em.contacto || em.nombre || '')
      setTelefono(em.telefono || '')
      setDireccion(em.direccion || '')
    }
  }
  // Al elegir obra: rellena con el ENCARGADO de la obra, su teléfono y la ubicación.
  function elegirObra(id: string) {
    setObraId(id)
    const o = obras.find(ob => String(ob.id) === id)
    if (o) {
      if (o.responsable) setCliente(o.responsable)
      if (o.telefono) setTelefono(o.telefono)
      if (o.ubicacion) setDireccion(o.ubicacion)
    }
  }

  const precio = modalidad === 'dia' ? equipo.precio_dia : modalidad === 'semana' ? equipo.precio_semana : equipo.precio_mes
  const total = Math.max(0, (Number(precio) || 0) * (Number(duracion) || 1) - (Number(descuento) || 0))
  const ivaRenta = requiereFactura ? Math.round(total * 0.16 * 100) / 100 : 0
  const totalConIva = total + ivaRenta
  const esReserva = fechaInicio > hoy

  function submit() {
    if ((!cliente.trim() && !empresaId) || !direccion.trim()) { notify('Cliente (o empresa) y dirección son obligatorios', 'err'); return }
    const errFactura = validarFactura(requiereFactura, empresaId, factura)
    if (errFactura) { notify(errFactura, 'err'); return }
    setBusy(true)
    api.post('/rentas/crear/', {
      inventario_id: unit.id, modalidad, duracion: Number(duracion) || 1,
      cliente: cliente.trim(), telefono_cliente: telefono.trim(), direccion: direccion.trim(),
      fecha_inicio: fechaInicio || undefined,
      empresa_id: empresaId || undefined, obra_id: obraId || undefined, usuario_id: usuarioId || undefined,
      cotizacion_id: deCot?.id || undefined,
      descuento: Number(descuento) || 0, deposito: Number(deposito) || 0,
      requiere_factura: requiereFactura, factura,
    })
      .then(res => {
        const est = res.data?.renta?.estado
        fijarCotParaRenta(null)   // puente consumido: la renta quedó ligada
        notify(est === 'reservada' ? 'Reserva registrada' : 'Renta registrada')
        const id = res.data?.renta?.id
        if (id) abrirOrdenCartaPDF('rentas', id)   // orden carta en PDF (ya no ticket térmico)
        onDone()
      })
      .catch(err => notify(err?.response?.data?.detalle || 'Error al rentar', 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-ink">{esReserva ? 'Reservar' : 'Rentar'} {unit.codigo}</h3>
            <p className="text-xs text-mute mt-0.5">{equipo.modelo}</p>
            {deCot && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full bg-[color:var(--c-renta)]/10 text-[color:var(--c-renta)]">
                Concretando {deCot.folio || 'cotización'} · {deCot.cliente || 'cliente'}
                <button onClick={() => { fijarCotParaRenta(null); setDeCot(null) }} aria-label="Quitar vínculo" className="hover:opacity-70">✕</button>
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
        <div className="space-y-3">
          <div>
            <label className={label}>Empresa (cliente registrado)</label>
            <select className={input} value={empresaId} onChange={e => elegirEmpresa(e.target.value)}>
              <option value="" className="bg-surface">— Cliente de mostrador —</option>
              {empresasActivas(empresas).map(em => <option key={em.id} value={em.id} className="bg-surface">{em.nombre}</option>)}
            </select>
          </div>
          {empresaId && obras.length > 0 && (
            <div>
              <label className={label}>Obra</label>
              <select className={input} value={obraId} onChange={e => elegirObra(e.target.value)}>
                <option value="" className="bg-surface">— Sin obra —</option>
                {obras.map(o => <option key={o.id} value={o.id} className="bg-surface">{o.nombre}</option>)}
              </select>
            </div>
          )}
          {clientes.length > 0 && (
            <div>
              <label className={label}>Cuenta del cliente <span className="text-mute font-normal normal-case">(opcional — para que la vea en "Tus rentas")</span></label>
              <select className={input} value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
                <option value="" className="bg-surface">— Sin vincular —</option>
                {clientes.map(c => <option key={c.id} value={c.id} className="bg-surface">{c.nombre}{c.empresa ? ` — ${c.empresa}` : ''}</option>)}
              </select>
            </div>
          )}
          <div><label className={label}>{obraId ? 'Encargado de la obra' : 'Cliente'} {empresaId ? '' : '*'}</label><input className={input} value={cliente} onChange={e => setCliente(e.target.value)} placeholder={obraId ? 'Encargado' : 'Nombre del cliente'} /></div>
          <div><label className={label}>Teléfono{obraId ? ' del encargado' : ''}</label><input className={input} value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="555-..." /></div>
          <div><label className={label}>Dirección / ubicación de obra *</label><input className={input} value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Dónde estará el equipo" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Modalidad</label>
              <select className={input} value={modalidad} onChange={e => setModalidad(e.target.value as any)}>
                <option value="dia" className="bg-surface">Por día</option>
                <option value="semana" className="bg-surface">Por semana</option>
                <option value="mes" className="bg-surface">Por mes</option>
              </select>
            </div>
            <div><label className={label}>Duración</label><input type="number" min={1} className={input} value={duracion} onChange={e => setDuracion(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Fecha de inicio</label><input type="date" min={hoy} className={input} value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} /></div>
            <div><label className={label}>Descuento</label><InputDinero valor={descuento} onValor={setDescuento} /></div>
          </div>
          <div><label className={label}>Depósito / garantía</label><InputDinero valor={deposito} onValor={setDeposito} /></div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} empresaNombre={empresaId ? empresas.find(e => String(e.id) === empresaId)?.nombre : undefined} />
          {Number(precio) <= 0 && (
            <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Este equipo no tiene precio {modalidad === 'dia' ? 'por día' : modalidad === 'semana' ? 'por semana' : 'por mes'} configurado: el total sale en $0. Cárgalo en el producto o elige otra modalidad.
            </p>
          )}
          {esReserva && <p className="text-[11px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">Inicia el {fechaInicio}: se guarda como <b>reserva</b> y no ocupa la unidad hasta esa fecha.</p>}
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            {requiereFactura ? (<>
              <div className="flex items-center justify-between text-xs text-mute"><span>Renta{Number(descuento) > 0 ? ' (con descuento)' : ''} sin IVA</span><span>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaRenta.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total con IVA</span><span className="text-lg font-black text-price">${totalConIva.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            </>) : (
              <div className="flex items-center justify-between"><span className="text-sm text-mute">Total{Number(descuento) > 0 ? ' (con descuento)' : ''}</span><span className="text-lg font-black text-price">${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            )}
          </div>
        </div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn-renta px-7 py-2.5 rounded-full text-sm font-bold">{esReserva ? 'Reservar' : 'Registrar renta'}</button>
        </div>
      </motion.div>
    </div>
  )
}

/* ── Registrar venta ── */
function SellModal({ unit, equipo, onClose, onDone, notify }: {
  unit: Unidad; equipo: Equipo; onClose: () => void; onDone: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [cliente, setCliente] = useState('')
  const [telefono, setTelefono] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [total, setTotal] = useState(String(equipo.precio_venta ?? ''))
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/empresas/').then(r => setEmpresas(Array.isArray(r.data) ? r.data : (r.data?.results || []))).catch(() => {})
  }, [])

  // Al elegir empresa: rellena comprador y teléfono con los datos guardados.
  function elegirEmpresa(id: string) {
    setEmpresaId(id)
    const em = empresas.find(e => String(e.id) === id)
    if (em) {
      setCliente(em.contacto || em.nombre || '')
      setTelefono(em.telefono || '')
    }
  }

  // El precio se captura SIN IVA. En VENTAS el IVA (16%) se suma SIEMPRE
  // (a diferencia de la renta). El toggle de factura solo controla la bandeja.
  const precioNum = Number(total) || 0
  const ivaNum = Math.round(precioNum * 0.16 * 100) / 100
  const totalConIva = precioNum + ivaNum

  function submit() {
    if (precioNum <= 0) { notify('El precio debe ser mayor a 0', 'err'); return }
    const errFactura = validarFactura(requiereFactura, empresaId, factura)
    if (errFactura) { notify(errFactura, 'err'); return }
    setBusy(true)
    api.post(`/unidades/${unit.id}/vender/`, {
      nombre_cliente: cliente.trim(), telefono_cliente: telefono.trim(),
      metodo_pago: metodo, empresa_id: empresaId || undefined, total: precioNum,
      requiere_factura: requiereFactura, factura,
    })
      .then(res => {
        notify('Venta registrada')
        const id = res.data?.venta?.id
        if (id) abrirOrdenCartaPDF('ventas', id)   // orden carta en PDF (ya no ticket térmico)
        onDone()
      })
      .catch(err => notify(err?.response?.data?.detalle || 'Error al vender', 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-ink">Vender {unit.codigo}</h3>
            <p className="text-xs text-mute mt-0.5">{equipo.modelo} · {unit.condicion}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
        <div className="space-y-3">
          <div>
            <label className={label}>Empresa (cliente registrado)</label>
            <select className={input} value={empresaId} onChange={e => elegirEmpresa(e.target.value)}>
              <option value="" className="bg-surface">— Cliente de mostrador —</option>
              {empresasActivas(empresas).map(em => <option key={em.id} value={em.id} className="bg-surface">{em.nombre}</option>)}
            </select>
          </div>
          <div><label className={label}>Cliente</label><input className={input} value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del comprador" /></div>
          <div><label className={label}>Teléfono</label><input className={input} value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="555-..." /></div>
          <div>
            <label className={label}>Método de pago</label>
            <select className={input} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
              <option value="efectivo" className="bg-surface">Efectivo</option>
              <option value="tarjeta" className="bg-surface">Tarjeta</option>
              <option value="transferencia" className="bg-surface">Transferencia</option>
            </select>
          </div>
          <div><label className={label}>Precio (sin IVA)</label><InputDinero valor={total} onValor={setTotal} placeholder="16,500" /></div>
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-mute"><span>Precio (sin IVA)</span><span>${precioNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total con IVA</span><span className="text-lg font-black text-price">${totalConIva.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
          </div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} empresaNombre={empresaId ? empresas.find(e => String(e.id) === empresaId)?.nombre : undefined} />
        </div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="px-7 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">Registrar venta</button>
        </div>
      </motion.div>
    </div>
  )
}

/* ════════════════════════════════════════
   MÓDULO INVENTARIO (vista global de unidades)
════════════════════════════════════════ */
function InventarioGlobal({ unidades, equipos, reload, notify, onEnviarTaller }: {
  unidades: Unidad[]; equipos: Equipo[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
  onEnviarTaller: (ordenId: number) => void
}) {
  const [estado, setEstado] = useState<'' | 'disponible' | 'rentado' | 'mantenimiento' | 'vendido'>('')
  const [equipoFiltro, setEquipoFiltro] = useState<string>('')
  const [search, setSearch] = useState('')
  const [labelUnit, setLabelUnit] = useState<Unidad | null>(null)
  const [rentUnit, setRentUnit] = useState<Unidad | null>(null)
  const [sellUnit, setSellUnit] = useState<Unidad | null>(null)
  const [mantUnit, setMantUnit] = useState<Unidad | null>(null)

  const filtered = unidades.filter(u => {
    if (estado && u.estado !== estado) return false
    if (equipoFiltro && String(u.equipo) !== equipoFiltro) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${u.codigo} ${u.numero_serie || ''} ${u.equipo_modelo || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const counts = {
    total: unidades.length,
    disponible: unidades.filter(u => u.estado === 'disponible').length,
    rentado: unidades.filter(u => u.estado === 'rentado').length,
    mantenimiento: unidades.filter(u => u.estado === 'mantenimiento').length,
    vendido: unidades.filter(u => u.estado === 'vendido').length,
  }

  function devolver(u: Unidad) {
    if (!u.renta_activa) return
    api.post(`/rentas/${u.renta_activa.id}/devolver/`).then(() => { notify('Equipo devuelto'); reload() }).catch(() => notify('Error', 'err'))
  }

  function liberarMant(u: Unidad) {
    api.post(`/unidades/${u.id}/mantenimiento/`, { accion: 'salir' })
      .then(() => { notify('Unidad liberada de mantenimiento'); reload() })
      .catch(() => notify('Error', 'err'))
  }

  const chip = (val: typeof estado, lbl: string, n: number) => (
    <button onClick={() => setEstado(val)} className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors flex items-center gap-2 ${estado === val ? 'bg-gold text-black' : 'bg-surface-2 text-mute hover:text-ink'}`}>
      {lbl}<span className={`px-1.5 rounded ${estado === val ? 'bg-black/15' : 'bg-edge'}`}>{n}</span>
    </button>
  )

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <KpiGrid
        gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        items={[
          { label: 'Total unidades', value: counts.total, tone: 'default' },
          { label: 'Disponibles', value: counts.disponible, tone: 'success' },
          { label: 'Rentadas', value: counts.rentado, tone: 'info' },
          { label: 'Mantenimiento', value: counts.mantenimiento, tone: 'warning' },
          { label: 'Vendidas', value: counts.vendido, tone: 'muted' },
        ]}
      />

      <Card className="overflow-hidden">
        {/* Filtros / toolbar */}
        <div className="px-5 py-4 border-b border-edge flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {chip('', 'Todas', counts.total)}
            {chip('disponible', 'Disponibles', counts.disponible)}
            {chip('rentado', 'Rentadas', counts.rentado)}
            {chip('mantenimiento', 'Mantenimiento', counts.mantenimiento)}
            {chip('vendido', 'Vendidas', counts.vendido)}
          </div>
          <div className="flex gap-2 flex-1 lg:justify-end">
            <select value={equipoFiltro} onChange={e => setEquipoFiltro(e.target.value)} className={`${input} sm:w-48`}>
              <option value="" className="bg-surface">Todos los productos</option>
              {equipos.map(e => <option key={e.id} value={e.id} className="bg-surface">{e.modelo}</option>)}
            </select>
            <input className={`${input} sm:w-56`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar código o serie…" />
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Etiqueta / Código</th>
                <th className="font-semibold px-3 py-3">Producto</th>
                <th className="font-semibold px-3 py-3">Condición</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-3 py-3">Ubicación / Cliente</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtered.map(u => (
                <tr key={u.id} className={`hover:bg-surface-2 transition-colors ${u.renta_activa?.vencida ? 'bg-red-500/5' : ''}`}>
                  {/* Código */}
                  <td className="px-5 py-3">
                    <span className="font-mono font-bold text-ink text-sm">{u.codigo}</span>
                    {u.numero_serie && <p className="text-[11px] text-mute">Serie {u.numero_serie}</p>}
                  </td>
                  {/* Producto */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-surface-2 overflow-hidden shrink-0">
                        {u.equipo_info?.imagen && <img src={resolveMediaUrl(u.equipo_info.imagen)} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <span className="text-sm text-ink truncate">{u.equipo_modelo}</span>
                    </div>
                  </td>
                  {/* Condición */}
                  <td className="px-3 py-3">
                    {pillCond(u.condicion)}
                  </td>
                  {/* Estado */}
                  <td className="px-3 py-3">
                    {pillEstado(u.estado)}
                    {u.estado === 'rentado' && u.renta_activa && (
                      <p className={`text-[11px] mt-1 ${u.renta_activa.vencida ? 'text-red-500 font-semibold' : 'text-mute'}`}>
                        {u.renta_activa.vencida ? '⚠ Vencida' : `${u.renta_activa.dias_restantes}d restantes`}
                      </p>
                    )}
                  </td>
                  {/* Ubicación / Cliente */}
                  <td className="px-3 py-3 max-w-[220px]">
                    {u.estado === 'rentado' && u.renta_activa ? (
                      <p className="text-xs text-mute truncate">{u.renta_activa.cliente || 'Cliente'} · {u.renta_activa.direccion}</p>
                    ) : (
                      <p className="text-xs text-mute truncate">{u.ubicacion_actual || '—'}</p>
                    )}
                  </td>
                  {/* Acciones */}
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setLabelUnit(u)} title="Etiqueta / Imprimir" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /></svg>
                      </button>
                      {u.estado === 'rentado' && <button onClick={() => devolver(u)} className="px-3 h-8 rounded-lg border border-blue-500/30 text-blue-500 text-xs font-semibold hover:bg-blue-500/10 transition-colors">Devolver</button>}
                      {u.estado === 'mantenimiento' && <button onClick={() => liberarMant(u)} title="Liberar manualmente (sin orden)" className="px-3 h-8 rounded-lg border border-amber-500/40 text-amber-500 text-xs font-semibold hover:bg-amber-500/10 transition-colors">Liberar</button>}
                      {u.estado === 'disponible' && (
                        <button onClick={() => setMantUnit(u)} title="Enviar a taller (crea orden de reparación)" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-amber-500 hover:border-amber-500/40 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 00-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 005.6-5.6l-2.5 2.5-2.1-2.1 2.5-2.5z" /></svg>
                        </button>
                      )}
                      {u.puede_rentarse && <button onClick={() => setRentUnit(u)} className="btn-renta px-3 h-8 rounded-full text-xs font-bold">Rentar</button>}
                      {u.puede_venderse && <button onClick={() => setSellUnit(u)} className="px-3 h-8 rounded-lg bg-gold text-black text-xs font-bold hover:opacity-90 transition-opacity">Vender</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-mute py-14 text-center">No hay unidades con estos filtros.</p>}
        </div>
      </Card>

      {labelUnit && <LabelModal unit={labelUnit} onClose={() => setLabelUnit(null)} />}
      {rentUnit && <RentModal unit={rentUnit} equipo={equipoFromUnit(rentUnit)} onClose={() => setRentUnit(null)} onDone={() => { setRentUnit(null); reload() }} notify={notify} />}
      {sellUnit && <SellModal unit={sellUnit} equipo={equipoFromUnit(sellUnit)} onClose={() => setSellUnit(null)} onDone={() => { setSellUnit(null); reload() }} notify={notify} />}
      {mantUnit && <EnviarTallerModal unit={mantUnit} onClose={() => setMantUnit(null)} onCreated={(id) => { setMantUnit(null); reload(); onEnviarTaller(id) }} notify={notify} />}
    </div>
  )
}

/* ════════════════════════════════════════
   ENVIAR A TALLER (crea orden de reparación interna)
════════════════════════════════════════ */
function EnviarTallerModal({ unit, onClose, onCreated, notify }: {
  unit: Unidad; onClose: () => void; onCreated: (ordenId: number) => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [diag, setDiag] = useState('')
  const [busy, setBusy] = useState(false)
  const modelo = unit.equipo_modelo || unit.equipo_info?.modelo || 'Equipo'

  function submit() {
    setBusy(true)
    api.post<OrdenReparacion>('/reparaciones/', { tipo: 'interna', unidad: unit.id, diagnostico: diag.trim() })
      .then(r => { notify(`Orden ${r.data.folio} creada · unidad en taller`); onCreated(r.data.id) })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo crear la orden', 'err'))
      .finally(() => setBusy(false))
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface rounded-[18px] w-full sm:max-w-[640px] my-4 sm:my-auto overflow-hidden shadow-[0_24px_60px_rgba(33,29,22,0.2)] border border-edge">
        {/* Header */}
        <div className="px-[26px] pt-6 pb-[18px] border-b border-edge flex items-start justify-between gap-3">
          <div>
            <div className="text-[18px] font-extrabold text-ink leading-tight">Enviar a taller</div>
            <div className="text-[12.5px] text-mute mt-[3px]">Crea una orden de servicio interna</div>
          </div>
          <span className="font-mono text-[11px] font-bold text-gold bg-gold-soft px-[11px] py-[5px] rounded-md shrink-0">{unit.codigo}</span>
        </div>

        {/* Equipo / Estado */}
        <div className="px-[26px] py-5 flex items-center gap-4 border-b border-edge">
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] font-bold tracking-[0.5px] text-mute mb-1">EQUIPO</div>
            <div className="text-[14px] font-bold text-ink truncate">{modelo}</div>
          </div>
          <div className="w-px h-[30px] bg-edge shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] font-bold tracking-[0.5px] text-mute mb-1">ESTADO</div>
            <div className="text-[14px] font-bold text-ink">Disponible <span className="text-edge">→</span> <span className="text-gold">Mantenimiento</span></div>
          </div>
        </div>

        {/* Motivo */}
        <div className="px-[26px] pt-5 pb-1.5">
          <div className="text-[10.5px] font-bold tracking-[0.5px] text-mute mb-2">FALLA / MOTIVO (OPCIONAL)</div>
          <textarea value={diag} onChange={e => setDiag(e.target.value)} placeholder="Ej. No arranca, fuga de aceite, servicio preventivo…" autoFocus
            className="w-full min-h-[76px] border border-edge rounded-[9px] px-3.5 py-3 text-[13.5px] bg-surface-2 text-ink placeholder-mute resize-y focus:outline-none focus:border-gold focus:bg-surface transition-colors" />
        </div>

        {/* Acciones */}
        <div className="flex gap-2.5 px-[26px] pt-5 pb-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-[9px] border border-edge text-ink font-bold text-[13.5px] hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-3 rounded-[9px] bg-gold text-white font-bold text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
            Crear orden y enviar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ════════════════════════════════════════
   ETIQUETA IMPRIMIBLE CON QR (para pegar en la máquina)
════════════════════════════════════════ */
function LabelModal({ unit, onClose }: { unit: Unidad; onClose: () => void }) {
  const [qr, setQr] = useState('')
  const modelo = unit.equipo_modelo || unit.equipo_info?.modelo || 'Equipo'
  // URL viva: la etiqueta impresa lleva a la ficha de la unidad.
  const payload = `${window.location.origin}/u/${unit.codigo}`

  useEffect(() => {
    QRCode.toDataURL(payload, { width: 240, margin: 0, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQr).catch(() => setQr(''))
  }, [payload])

  function imprimir() {
    const w = window.open('', '_blank', 'width=480,height=320')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>${unit.codigo}</title>
      <style>
        @page { size: 70mm 40mm; margin: 0; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
        .lbl { width: 70mm; height: 40mm; padding: 4mm; display: flex; gap: 4mm; align-items: center; border: 1px solid #000; }
        .info { flex: 1; min-width: 0; }
        .brand { font-size: 8pt; letter-spacing: 2px; font-weight: 800; }
        .model { font-size: 10pt; font-weight: 700; margin: 1mm 0; }
        .code { font-size: 18pt; font-weight: 900; font-family: monospace; }
        .cond { font-size: 7pt; text-transform: uppercase; color: #444; }
        img { width: 26mm; height: 26mm; }
      </style></head>
      <body onload="setTimeout(function(){window.print()},250)">
        <div class="lbl">
          <div class="info">
            <div class="brand">REMALI</div>
            <div class="model">${modelo}</div>
            <div class="code">${unit.codigo}</div>
            <div class="cond">${unit.condicion}${unit.numero_serie ? ' · ' + unit.numero_serie : ''}</div>
          </div>
          <img src="${qr}" alt="QR" />
        </div>
      </body></html>`)
    w.document.close()
    w.focus()
  }

  return (
    <div className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-edge rounded-3xl p-7 max-w-sm w-full">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-gold mb-4">Etiqueta de identificación</p>

        {/* Vista previa de la etiqueta (estilo sticker, siempre claro) */}
        <div className="rounded-xl bg-white text-black border border-black/10 p-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black tracking-[0.2em]">REMALI</p>
            <p className="text-sm font-bold truncate">{modelo}</p>
            <p className="text-2xl font-black font-mono leading-tight">{unit.codigo}</p>
            <p className="text-[10px] uppercase text-neutral-500">{unit.condicion}{unit.numero_serie ? ` · ${unit.numero_serie}` : ''}</p>
          </div>
          <div className="w-24 h-24 bg-white shrink-0">
            {qr ? <img src={qr} alt="QR" className="w-full h-full" /> : <div className="w-full h-full animate-pulse bg-neutral-200 rounded" />}
          </div>
        </div>

        <p className="text-[11px] text-mute mt-4">Escanea el QR para identificar la unidad, su producto y estado. Imprime y pega en la máquina.</p>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cerrar</button>
          <button onClick={imprimir} disabled={!qr} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /></svg>
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   MÓDULO RENTAS
════════════════════════════════════════ */
type MovimientoRenta = { entregada?: boolean; recogida?: boolean; en?: string | null; por?: string | null }

type RentaFull = RentaActiva & {
  entrega?: MovimientoRenta; recoleccion?: MovimientoRenta
  cuenta?: string | null
  pagos?: { fecha: string; monto: string; metodo: string; por?: string }[]
  pagado?: string; saldo?: string
  factura_estado?: string | null
  estado?: string; modalidad: string; duracion?: number
  fecha_inicio?: string; fecha_devolucion_real?: string | null
  total?: string; subtotal?: string; precio_unitario?: string; descuento?: string; deposito?: string; recargo?: string
  cliente_nombre?: string
  empresa?: { id: number; nombre: string } | null
  obra?: { id: number; nombre: string; responsable?: string; telefono?: string; ubicacion?: string } | null
  creado_en?: string
}
function RentasAdmin({ reload, notify }: { reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void }) {
  const [estado, setEstado] = useState<'reservada' | 'activa' | 'finalizada' | 'cancelada'>('activa')
  const [rentas, setRentas] = useState<RentaFull[]>([])
  const [loading, setLoading] = useState(true)
  const [verRenta, setVerRenta] = useState<RentaFull | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ rentas: RentaFull[] }>(`/rentas/?estado=${estado}`).then(r => setRentas(r.data?.rentas || [])).catch(() => setRentas([])).finally(() => setLoading(false))
  }, [estado])
  useEffect(() => { load() }, [load])

  function devolver(r: RentaFull) {
    if (!confirm(`¿Marcar como devuelto el equipo de ${r.cliente_nombre || r.cliente || 'cliente'}?`)) return
    api.post(`/rentas/${r.id}/devolver/`).then(() => { notify('Equipo devuelto'); load(); reload() }).catch(e => notify(e?.response?.data?.detalle || 'Error', 'err'))
  }

  function cancelar(r: RentaFull) {
    if (!confirm(`¿Cancelar esta ${r.estado === 'reservada' ? 'reserva' : 'renta'}? Se liberará la unidad.`)) return
    api.post(`/rentas/${r.id}/cancelar/`).then(() => { notify('Renta cancelada'); load(); reload() }).catch(e => notify(e?.response?.data?.detalle || 'Error', 'err'))
  }

  const vencidas = rentas.filter(r => r.vencida).length
  const porVencer = rentas.filter(r => !r.vencida && (r.dias_restantes ?? 99) <= 2).length

  return (
    <div className="space-y-5">
      {verRenta && <RentaDetalleModal renta={verRenta} onClose={() => setVerRenta(null)} onTicket={() => abrirOrdenCartaPDF('rentas', verRenta.id)} />}
      {/* KPIs */}
      <KpiGrid
        items={[
          { label: estado === 'activa' ? 'Rentas activas' : estado === 'reservada' ? 'Reservas' : estado === 'cancelada' ? 'Canceladas' : 'Finalizadas', value: rentas.length, tone: 'default' },
          { label: 'Por vencer (≤2d)', value: porVencer, tone: 'warning', emphasis: porVencer > 0 },
          { label: 'Vencidas', value: vencidas, tone: 'danger', emphasis: vencidas > 0 },
        ]}
      />

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-edge flex items-center justify-between flex-wrap gap-3">
          <div className="flex p-1 rounded-full border border-edge bg-surface-2 flex-wrap">
            {(['activa', 'reservada', 'finalizada', 'cancelada'] as const).map(s => (
              <button key={s} onClick={() => setEstado(s)} className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${estado === s ? 'bg-gold text-black' : 'text-mute hover:text-ink'}`}>
                {s === 'activa' ? 'Activas' : s === 'reservada' ? 'Reservas' : s === 'finalizada' ? 'Finalizadas' : 'Canceladas'}
              </button>
            ))}
          </div>
          {estado === 'activa' && vencidas > 0 && (
            <span className="px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 text-xs font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />{vencidas} vencida{vencidas > 1 ? 's' : ''} por recoger
            </span>
          )}
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Equipo</th>
                <th className="font-semibold px-3 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Ubicación</th>
                <th className="font-semibold px-3 py-3">Periodo</th>
                <th className="font-semibold px-3 py-3">Vencimiento</th>
                <th className="font-semibold px-5 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {rentas.map(r => (
                <tr key={r.id} className={`hover:bg-surface-2 transition-colors ${r.vencida ? 'bg-red-500/5' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-ink truncate">{r.inventario.equipo}</p>
                    <p className="font-mono text-[11px] text-mute">{r.inventario.codigo}</p>
                  </td>
                  <td className="px-3 py-3 max-w-[220px]">
                    <p className="text-sm text-ink truncate">
                      {r.obra
                        ? (r.obra.responsable || r.cliente || r.empresa?.nombre || 'Encargado')
                        : (r.cliente || r.empresa?.nombre || r.cliente_nombre || 'Cliente')}
                    </p>
                  </td>
                  <td className="px-3 py-3 max-w-[200px]"><p className="text-xs text-mute truncate">{r.direccion}</p></td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p className="text-xs text-ink capitalize">{r.modalidad}</p>
                    <p className="text-[11px] text-mute font-mono">{r.fecha_inicio || ''} → {r.fecha_fin}</p>
                    {r.total && <p className="text-[11px] text-price font-semibold">${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {estado === 'activa' ? (
                      <span className={`text-xs font-bold ${r.vencida ? 'text-red-500' : (r.dias_restantes ?? 9) <= 2 ? 'text-amber-500' : 'text-mute'}`}>
                        {r.vencida ? '⚠ Vencida' : `${r.dias_restantes}d restantes`}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-surface-2 text-mute font-semibold uppercase">
                        {estado === 'reservada' ? 'Reservada' : estado === 'cancelada' ? 'Cancelada' : 'Finalizada'}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setVerRenta(r)} title="Ver detalle de la renta" className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-edge text-mute text-xs font-semibold hover:text-ink hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                        Ver
                      </button>
                      <button onClick={() => abrirOrdenCartaPDF('rentas', r.id)} title="Descargar orden carta (PDF)" className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-edge text-mute text-xs font-semibold hover:text-ink hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
                        Orden PDF
                      </button>
                      {estado === 'activa' && (
                        <button onClick={() => devolver(r)} title="Marcar la renta como devuelta" className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-renta/30 text-renta text-xs font-semibold hover:bg-renta/10 hover:border-renta/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-renta/30 transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                          Marcar devuelto
                        </button>
                      )}
                      {(estado === 'activa' || estado === 'reservada') && (
                        <button onClick={() => cancelar(r)} title="Cancelar la renta" className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-500/10 hover:border-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="text-sm text-mute py-14 text-center">Cargando…</p>}
          {!loading && rentas.length === 0 && <p className="text-sm text-mute py-14 text-center">Sin rentas {estado === 'activa' ? 'activas' : 'en el historial'}.</p>}
        </div>
      </Card>
    </div>
  )
}

/* ─── Modal: detalle de renta (ventana "Ver") ─── */
type Evidencia = { id: number; momento: 'entrega' | 'devolucion'; momento_label: string; imagen: string; nota: string; subida_por: string | null; creada: string }

/** Fotos del equipo al entregarlo y al recibirlo, agrupadas por momento. */
function EvidenciasRenta({ rentaId }: { rentaId: number }) {
  const [fotos, setFotos] = useState<Evidencia[]>([])
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<Evidencia | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const cargar = useCallback(() => {
    api.get<{ evidencias: Evidencia[] }>(`/rentas/${rentaId}/evidencias/`)
      .then(r => setFotos(r.data?.evidencias || [])).catch(() => {})
  }, [rentaId])
  useEffect(() => { cargar() }, [cargar])

  function subir(momento: 'entrega' | 'devolucion', ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (!files.length) return
    const fd = new FormData()
    fd.append('momento', momento)
    files.forEach(f => fd.append('imagenes', f))
    setError(''); setSubiendo(momento)
    api.post(`/rentas/${rentaId}/evidencias/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(() => cargar())
      .catch(err => setError(errorMsg(err, 'No se pudieron subir las fotos')))
      .finally(() => setSubiendo(null))
  }
  function borrar(id: number) {
    if (!confirm('¿Quitar esta foto? Es evidencia del estado del equipo.')) return
    api.delete(`/rentas/${rentaId}/evidencias/${id}/`)
      .then(() => cargar())
      .catch(err => setError(errorMsg(err, 'No se pudo quitar')))
  }

  const bloque = (momento: 'entrega' | 'devolucion', titulo: string) => {
    const suyas = fotos.filter(f => f.momento === momento)
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-bold text-ink">{titulo} <span className="text-mute font-normal">({suyas.length})</span></p>
          <button onClick={() => inputs.current[momento]?.click()} disabled={subiendo === momento}
            className="text-[11.5px] font-bold text-gold hover:opacity-80 disabled:opacity-50">
            {subiendo === momento ? 'Subiendo…' : '+ Agregar fotos'}
          </button>
          <input ref={el => { inputs.current[momento] = el }} type="file" accept="image/*" multiple className="hidden" onChange={e => subir(momento, e)} />
        </div>
        {suyas.length === 0 ? (
          <button onClick={() => inputs.current[momento]?.click()}
            className="w-full py-5 rounded-[10px] border border-dashed border-edge text-[12px] text-mute hover:text-ink hover:border-gold/50 transition-colors">
            Sin fotos todavía
          </button>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {suyas.map(f => (
              <div key={f.id} className="relative group aspect-square rounded-[9px] overflow-hidden border border-edge bg-surface-2">
                <button onClick={() => setZoom(f)} className="w-full h-full" title={f.nota || 'Ver foto'}>
                  <img src={resolveMediaUrl(f.imagen)} alt={f.nota || titulo} className="w-full h-full object-cover" />
                </button>
                <button onClick={() => borrar(f.id)} aria-label="Quitar foto"
                  className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {bloque('entrega', 'Al entregar')}
      {bloque('devolucion', 'Al recibir de vuelta')}
      {error && <p className="text-[12px] text-red-500">{error}</p>}
      {zoom && createPortal(
        <div className="modal-in fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          <div className="max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={resolveMediaUrl(zoom.imagen)} alt={zoom.nota} className="w-full max-h-[80vh] object-contain rounded-xl" />
            <p className="text-center text-[12.5px] text-white/80 mt-3">
              {zoom.momento_label}
              {zoom.nota ? ` · ${zoom.nota}` : ''}
              {' · '}{new Date(zoom.creada).toLocaleString('es-MX')}
              {zoom.subida_por ? ` · ${zoom.subida_por}` : ''}
            </p>
          </div>
        </div>, document.body)}
    </div>
  )
}

/** Dinero mientras se escribe: "2000" se ve "2,000" (y "$" fijo a la
 *  izquierda). Solo acepta dígitos y UN punto decimal; el valor que guarda
 *  es crudo ("2000.50") para que las cuentas no carguen comas. Pieza de la
 *  casa: úsala en todo campo de cantidades. */
function formatearDinero(crudo: string) {
  if (!crudo) return ''
  const [ent, dec] = crudo.split('.')
  const entFmt = ent ? Number(ent).toLocaleString('en-US') : ''
  return dec !== undefined ? `${entFmt}.${dec.slice(0, 2)}` : entFmt
}
function InputDinero({ valor, onValor, placeholder = '0', autoFocus, className = '', disabled }: {
  valor: string; onValor: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string; disabled?: boolean
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute font-bold text-sm pointer-events-none">$</span>
      <input
        value={formatearDinero(valor)} autoFocus={autoFocus} disabled={disabled}
        inputMode="decimal" placeholder={placeholder}
        onChange={e => {
          let limpio = e.target.value.replace(/[^\d.]/g, '')
          const i = limpio.indexOf('.')
          if (i !== -1) limpio = limpio.slice(0, i + 1) + limpio.slice(i + 1).replace(/\./g, '').slice(0, 2)
          onValor(limpio)
        }}
        className="w-full bg-surface-2 border border-edge rounded-xl pl-8 pr-3.5 py-2.5 text-sm font-bold text-ink tabular-nums placeholder-mute focus:outline-none focus:border-gold/50 transition-colors disabled:opacity-60"
      />
    </div>
  )
}

/** Registrar abono: TODO en un solo modal — monto (con comas), método y fecha. */
function AbonoModal({ saldo, onClose, onRegistrar }: {
  saldo: number; onClose: () => void
  onRegistrar: (monto: number, metodo: string, fecha: string) => Promise<void>
}) {
  const money = formatMoney
  const hoyISO = new Date().toLocaleDateString('sv-SE')
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [fecha, setFecha] = useState(hoyISO)
  const [guardando, setGuardando] = useState(false)
  const n = Number(monto) || 0

  return createPortal(
    <div className="modal-in fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-surface border border-edge rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.3)] p-6">
        <h3 className="font-black text-ink">Registrar abono</h3>
        <p className="text-[12.5px] text-mute mt-1">Saldo actual: <b className="text-ink">{money(saldo)}</b></p>

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">¿Cuánto entrega?</label>
        <InputDinero valor={monto} onValor={setMonto} autoFocus placeholder="2,000" />
        {n > saldo && (
          <p className="text-[12px] text-red-500 font-semibold mt-1.5">El abono no puede ser mayor al saldo ({money(saldo)}).</p>
        )}

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">Método</label>
        <div className="grid grid-cols-3 gap-2">
          {(['efectivo', 'tarjeta', 'transferencia'] as const).map(m => (
            <button key={m} onClick={() => setMetodo(m)}
              className={`h-10 rounded-xl border text-[12.5px] font-bold capitalize transition-colors ${metodo === m ? 'bg-ink text-app border-ink' : 'border-edge text-mute hover:text-ink hover:bg-surface-2'}`}>
              {m}
            </button>
          ))}
        </div>

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">Fecha del abono</label>
        <input type="date" value={fecha} max={hoyISO} onChange={e => setFecha(e.target.value)}
          className="w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:border-gold/50 transition-colors" />
        <p className="text-[11px] text-mute mt-1">Cámbiala si se te pasó registrarlo ese día; no puede ser futura.</p>

        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={onClose} className="px-5 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button disabled={n <= 0 || n > saldo || guardando}
            onClick={async () => { setGuardando(true); try { await onRegistrar(n, metodo, fecha) } finally { setGuardando(false) } }}
            className="px-6 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40">
            {guardando ? 'Guardando…' : n > 0 ? `Registrar ${money(n)}` : 'Registrar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RentaDetalleModal({ renta: r, onClose, onTicket }: { renta: RentaFull; onClose: () => void; onTicket: () => void }) {
  const money = formatMoney
  // Cuenta de cliente vinculada; se puede asignar o cambiar aquí mismo,
  // para las rentas que se registraron sin elegirla.
  const [cuenta, setCuenta] = useState<string | null>(r.cuenta ?? null)
  // Pagos: muchos clientes conocidos pagan DESPUÉS; aquí se abonan.
  const [pagos, setPagos] = useState(r.pagos || [])
  const [pagado, setPagado] = useState(Number(r.pagado || 0))
  const [saldo, setSaldo] = useState(Number(r.saldo ?? r.total ?? 0))
  const [abonando, setAbonando] = useState(false)
  async function guardarAbono(monto: number, metodo: string, fecha: string) {
    try {
      const resp = await api.post<{ renta: RentaFull }>(`/rentas/${r.id}/abonos/`, { monto, metodo, fecha: fecha || undefined })
      setPagos(resp.data.renta.pagos || [])
      setPagado(Number(resp.data.renta.pagado || 0))
      setSaldo(Number(resp.data.renta.saldo || 0))
      setAbonando(false)
    } catch { /* el interceptor avisa */ }
  }
  // Bandeja de facturación: el timbrado es externo; desde aquí solo se manda.
  const [factura, setFactura] = useState<string | null>(r.factura_estado ?? null)
  const [mandandoFactura, setMandandoFactura] = useState(false)
  async function mandarPorFacturar() {
    setMandandoFactura(true)
    try {
      await api.post(`/rentas/${r.id}/por-facturar/`, {})
      setFactura('pendiente')
    } catch (e) {
      const detalle = (e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle
      if (detalle) await confirmar({ titulo: 'Facturación', mensaje: detalle, aceptar: 'Entendido' })
    } finally { setMandandoFactura(false) }
  }
  const [liga, setLiga] = useState('')
  const [genLiga, setGenLiga] = useState(false)
  const [copiado, setCopiado] = useState(false)
  async function generarLiga() {
    setGenLiga(true)
    try {
      const res = await api.post<{ ruta: string }>(`/rentas/${r.id}/vinculo/`, {}, { fondo: true } as never)
      setLiga(`${window.location.origin}${res.data.ruta}`)
    } catch { /* el interceptor ya avisa */ } finally { setGenLiga(false) }
  }
  async function vincularCuenta() {
    try {
      const rc = await api.get<{ clientes: { id: number; nombre: string; empresa?: string }[] }>('/clientes-lookup/')
      const lista = rc.data.clientes || []
      if (!lista.length) { await confirmar({ titulo: 'Sin cuentas', mensaje: 'Aún no hay cuentas de cliente registradas en el sistema.', aceptar: 'Entendido' }); return }
      const sel = await elegir({
        titulo: 'Vincular a una cuenta',
        mensaje: 'La renta aparecerá en "Tus rentas" del cliente que elijas.',
        opciones: lista.map(c => ({ valor: String(c.id), label: c.nombre, detalle: c.empresa || undefined })),
      })
      if (!sel || !sel[0]) return
      const res = await api.post<{ cuenta: string | null }>(`/rentas/${r.id}/vincular/`, { usuario_id: Number(sel[0]) })
      setCuenta(res.data?.cuenta || null)
    } catch { /* el interceptor ya avisa el error */ }
  }
  const esObra = !!r.obra
  const encargado = esObra ? (r.obra?.responsable || r.cliente) : undefined
  const cliente = !esObra ? (r.cliente || r.cliente_nombre) : undefined
  const telefono = esObra ? (r.obra?.telefono || r.telefono_cliente) : r.telefono_cliente
  const sub = Number(r.subtotal || 0)
  const tot = Number(r.total || 0)
  const rec = Number(r.recargo || 0)
  const desc = Number(r.descuento || 0)
  const dep = Number(r.deposito || 0)
  const iva = Math.max(0, Math.round((tot - sub - rec) * 100) / 100)
  const modLabel = ({ dia: 'Por día', semana: 'Por semana', mes: 'Por mes' } as Record<string, string>)[r.modalidad] || r.modalidad
  const chip = (r.estado === 'activa' && r.vencida)
    ? { label: 'VENCIDA', cls: 'bg-red-500/10 text-red-500' }
    : (({
        activa: { label: 'ACTIVA', cls: 'bg-blue-500/10 text-blue-600' },
        reservada: { label: 'RESERVADA', cls: 'bg-blue-500/10 text-blue-600' },
        finalizada: { label: 'FINALIZADA', cls: 'bg-emerald-500/10 text-emerald-600' },
        cancelada: { label: 'CANCELADA', cls: 'bg-red-500/10 text-red-500' },
      } as Record<string, { label: string; cls: string }>)[r.estado || 'activa'] || { label: (r.estado || '—').toUpperCase(), cls: 'bg-surface-2 text-mute' })

  const Field = ({ label, value, full, labelCls }: { label: string; value?: React.ReactNode; full?: boolean; labelCls?: string }) => (
    value ? (
      <div className={full ? 'col-span-2' : ''}>
        <p className={`text-[12px] ${labelCls || 'text-mute'}`}>{label}</p>
        <p className="text-[13.5px] font-bold text-ink break-words leading-snug mt-0.5">{value}</p>
      </div>
    ) : null
  )
  const Titulo = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-3">{children}</p>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-0 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-full sm:max-w-[720px] bg-surface rounded-none sm:rounded-[16px] shadow-[0_24px_60px_rgba(33,29,22,0.2)] min-h-screen sm:min-h-0 sm:my-auto sm:max-h-[92vh] flex flex-col overflow-hidden border-0 sm:border border-edge">
        {/* Header */}
        <div className="px-6 sm:px-[26px] pt-[22px] pb-[18px] border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10.5px] font-bold tracking-[0.5px] text-mute">DETALLE DE RENTA</span>
              <span className={`text-[10.5px] px-2.5 py-[3px] rounded-md font-bold ${chip.cls}`}>{chip.label}</span>
              {factura && (
                <span className={`text-[10.5px] px-2.5 py-[3px] rounded-md font-bold ${factura === 'facturada' ? 'bg-violet-500/10 text-violet-600' : 'bg-amber-500/10 text-amber-600'}`}>
                  {factura === 'facturada' ? 'FACTURADA' : 'POR FACTURAR'}
                </span>
              )}
            </div>
            <h2 className="text-[20px] font-extrabold text-ink truncate">{r.inventario.equipo || 'Equipo'}</h2>
            <p className="font-mono text-[12.5px] text-mute mt-0.5">{r.inventario.codigo}{r.inventario.numero_serie ? ` · S/N ${r.inventario.numero_serie}` : ''}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* CLIENTE */}
          <div className="px-6 sm:px-[26px] py-[18px] border-b border-edge">
            <Titulo>CLIENTE</Titulo>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {r.empresa && <Field label="Empresa" value={r.empresa.nombre} />}
              {r.obra && <Field label="Obra" value={r.obra.nombre} />}
              {encargado && <Field label="Encargado" value={encargado} />}
              {cliente && <Field label="Cliente" value={cliente} />}
              {telefono && <Field label="Teléfono" value={telefono} />}
              <Field label="Ubicación / entrega" value={r.obra?.ubicacion || r.direccion} full />
              <div className="col-span-2 pt-2 border-t border-edge space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] text-mute">Cuenta en el sistema</p>
                    <p className={`text-[13.5px] font-bold mt-0.5 truncate ${cuenta ? 'text-ink' : 'text-mute'}`}>{cuenta || 'Sin vincular'}</p>
                  </div>
                  <button onClick={vincularCuenta} className="shrink-0 px-3.5 py-2 rounded-[9px] border border-edge text-[12px] font-bold text-ink hover:border-gold/50 hover:text-gold transition-colors">
                    {cuenta ? 'Cambiar' : 'Vincular cuenta'}
                  </button>
                </div>
                {/* Liga: el cliente la abre y liga la renta a SU cuenta (un solo
                    uso, 30 días). Con cuenta YA vinculada no hay nada que ligar:
                    ni liga vieja ni botón de generar. */}
                {cuenta ? null : liga ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input readOnly value={liga} onFocus={e => e.currentTarget.select()} className="flex-1 bg-app border border-edge rounded-[9px] px-3 py-2 text-[11px] text-ink outline-none" />
                      <button onClick={async () => { try { await navigator.clipboard.writeText(liga); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* noop */ } }} className="shrink-0 px-3 py-2 rounded-[9px] bg-gold text-black text-[12px] font-bold">{copiado ? '✓' : 'Copiar'}</button>
                    </div>
                    {(() => {
                      const tel = (telefono || '').replace(/\D/g, ''); const num = tel.length === 10 ? '52' + tel : tel
                      const msg = `Hola, aquí tienes tu renta en REMALI. Ábrela para guardarla en tu cuenta:\n${liga}`
                      return <a href={`https://wa.me/${num}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2 rounded-[9px] bg-[#25D366] text-white text-[12px] font-bold hover:opacity-90 transition-opacity"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.15-1.7-.84-2-.94-.26-.1-.45-.15-.64.15-.19.29-.74.94-.9 1.13-.17.19-.33.22-.62.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.5.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.08-.15-.64-1.55-.88-2.12-.23-.56-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38s1.02 2.76 1.17 2.95c.15.19 2.01 3.07 4.87 4.3.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12 2a10 10 0 00-8.6 15.06L2 22l5.06-1.33A10 10 0 1012 2z"/></svg>Enviar por WhatsApp</a>
                    })()}
                  </div>
                ) : (
                  <button onClick={generarLiga} disabled={genLiga} className="text-[12px] font-semibold text-mute hover:text-gold transition-colors disabled:opacity-50">
                    {genLiga ? 'Generando…' : '＋ Generar liga para que el cliente la vincule solo'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RENTA */}
          <div className="px-6 sm:px-[26px] py-[18px] border-b border-edge">
            <Titulo>RENTA</Titulo>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Modalidad" value={`${modLabel}${r.duracion ? ` (${r.duracion})` : ''}`} />
              <Field label="Inicio" value={r.fecha_inicio || '—'} />
              <Field label={r.estado === 'activa' && !r.vencida ? 'Vencimiento' : 'Vencimiento'} value={r.fecha_fin} />
              {r.estado === 'activa' && (
                <Field label="Estado" value={r.vencida ? 'Vencida' : `${r.dias_restantes} día(s) restantes`} labelCls={r.vencida ? 'text-red-500' : 'text-mute'} />
              )}
              {r.fecha_devolucion_real && <Field label="Devolución real" value={r.fecha_devolucion_real} labelCls="text-emerald-600" />}
            </div>

            {/* Quién movió el equipo y cuándo: lo confirma el técnico en campo */}
            {(r.entrega || r.recoleccion) && (
              <div className="mt-4 pt-4 border-t border-edge grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Entrega"
                  value={r.entrega?.entregada
                    ? <>{new Date(r.entrega.en!).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{r.entrega.por ? <span className="text-mute font-normal"> · {r.entrega.por}</span> : null}</>
                    : <span className="text-amber-600 dark:text-amber-500">Sin confirmar</span>} />
                <Field label="Recolección"
                  value={r.recoleccion?.recogida
                    ? <>{new Date(r.recoleccion.en!).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{r.recoleccion.por ? <span className="text-mute font-normal"> · {r.recoleccion.por}</span> : null}</>
                    : <span className="text-mute">Pendiente</span>} />
              </div>
            )}
          </div>

          {/* MONTOS */}
          <div className="px-6 sm:px-[26px] py-[18px]">
            <Titulo>MONTOS</Titulo>
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-mute">Precio {modLabel.toLowerCase()}</span><span className="text-ink font-semibold">{money(r.precio_unitario)}</span></div>
              {desc > 0 && <div className="flex justify-between"><span className="text-mute">Descuento</span><span className="text-red-500 font-semibold">− {money(desc)}</span></div>}
              {(iva > 0 || rec > 0) && <div className="flex justify-between"><span className="text-mute">Subtotal</span><span className="text-ink font-semibold">{money(sub)}</span></div>}
              {iva > 0 && <div className="flex justify-between"><span className="text-mute">IVA (16%)</span><span className="text-ink font-semibold">{money(iva)}</span></div>}
              {rec > 0 && <div className="flex justify-between"><span className="text-mute">Recargo por retraso</span><span className="text-amber-600 font-semibold">{money(rec)}</span></div>}
              <div className="flex justify-between pt-2.5 mt-1.5 border-t border-edge text-[16px] font-extrabold"><span className="text-ink">Total</span><span className="text-price">{money(tot)}</span></div>
              {dep > 0 && <div className="flex justify-between pt-1"><span className="text-mute text-[12px]">Depósito en garantía</span><span className="text-mute text-[12px]">{money(dep)}</span></div>}
            </div>

            {/* PAGOS: abonos del cliente y saldo (muchos pagan después) */}
            <div className="mt-4 pt-4 border-t border-edge">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold">PAGOS</p>
                {saldo <= 0 && tot > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>Pagada</span>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 whitespace-nowrap">Por cobrar {money(saldo)}</span>
                )}
              </div>
              {pagos.length > 0 && (
                <div className="space-y-1 text-[12.5px] mb-2">
                  {pagos.map((p, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span className="text-mute">{new Date(p.fecha.length === 10 ? `${p.fecha}T12:00:00` : p.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} · <span className="capitalize">{p.metodo}</span>{p.por ? ` · ${p.por}` : ''}</span>
                      <span className="text-ink font-semibold tabular-nums">{money(Number(p.monto))}</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 pt-1 border-t border-edge">
                    <span className="text-mute font-semibold">Pagado</span>
                    <span className="text-ink font-bold tabular-nums">{money(pagado)}</span>
                  </div>
                </div>
              )}
              {abonando && <AbonoModal saldo={saldo} onClose={() => setAbonando(false)} onRegistrar={guardarAbono} />}
              {r.estado !== 'cancelada' && saldo > 0 && (
                <button onClick={() => setAbonando(true)}
                  className="mt-1 px-3.5 py-2 rounded-[9px] border border-edge text-[12px] font-bold text-ink hover:border-gold/50 hover:text-gold transition-colors">
                  + Registrar abono
                </button>
              )}
            </div>
          </div>

          {/* FACTURACIÓN: el timbrado es externo; aquí solo se manda a la bandeja */}
          <div className="px-6 sm:px-[26px] py-[18px] border-t border-edge">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold">FACTURACIÓN</p>
                <p className="text-[12px] text-mute mt-1 leading-relaxed">
                  {factura === 'facturada'
                    ? 'Factura emitida; quedó registrada en la bandeja.'
                    : factura
                      ? 'Está en la bandeja Por facturar. Se timbra afuera y ahí se marca.'
                      : 'Si el cliente pide factura, mándala a la bandeja: sus datos fiscales se toman de su cuenta.'}
                </p>
              </div>
              {!factura && r.estado !== 'cancelada' && (
                <button onClick={mandarPorFacturar} disabled={mandandoFactura}
                  className="px-3.5 py-2 rounded-[9px] border border-amber-500/40 bg-amber-500/10 text-[12px] font-bold text-amber-700 dark:text-amber-500 hover:bg-amber-500/20 transition-colors whitespace-nowrap disabled:opacity-50">
                  {mandandoFactura ? 'Mandando…' : 'Mandar a Por facturar'}
                </button>
              )}
            </div>
          </div>

          {/* EVIDENCIA: respalda en qué estado salió y en qué estado volvió */}
          <div className="px-6 sm:px-[26px] py-[18px] border-t border-edge">
            <Titulo>EVIDENCIA DEL EQUIPO</Titulo>
            <p className="text-[12px] text-mute -mt-1.5 mb-4">
              {dep > 0
                ? `Respalda por qué retienes o devuelves el depósito de ${money(dep)}.`
                : 'Deja constancia del estado en que salió y en que regresó el equipo.'}
            </p>
            <EvidenciasRenta rentaId={r.id} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-[26px] py-5 border-t border-edge flex items-center gap-2.5 shrink-0">
          <button onClick={onClose} className="flex-1 h-11 rounded-[9px] border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors">Cerrar</button>
          <button onClick={onTicket} className="flex-1 h-11 rounded-[9px] bg-gold text-black text-[13.5px] font-bold hover:brightness-95 transition-all">Orden carta (PDF)</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ════════════════════════════════════════
   MÓDULO VENTAS
════════════════════════════════════════ */
function VentasAdmin({ ventas, reload, notify }: { ventas: Venta[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void }) {
  const [q, setQ] = useState('')
  const [detalle, setDetalle] = useState<Venta | null>(null)

  function cancelar(v: Venta) {
    if (!confirm(`¿Cancelar la venta #${v.id}? Se devolverá la máquina a inventario y se repondrá el stock.`)) return
    api.post(`/ventas/${v.id}/cancelar/`).then(() => { notify('Venta cancelada'); reload() }).catch(e => notify(e?.response?.data?.detalle || 'Error', 'err'))
  }
  const totalVendido = ventas.reduce((a, v) => a + (Number(v.total) || 0), 0)
  const maquinaria = ventas.filter(v => v.unidad)
  const ticket = ventas.length ? totalVendido / ventas.length : 0

  const filtradas = ventas.filter(v => {
    if (!q.trim()) return true
    const t = `${v.nombre_cliente || ''} ${v.unidad?.equipo || ''} ${v.unidad?.codigo || ''}`.toLowerCase()
    return t.includes(q.trim().toLowerCase())
  })

  const metodoStyle: Record<string, string> = {
    efectivo: 'bg-emerald-500/10 text-emerald-500',
    tarjeta: 'bg-blue-500/10 text-blue-500',
    transferencia: 'bg-violet-500/10 text-violet-500',
  }

  return (
    <div className="space-y-5">
      {detalle && <VentaDetalleModal venta={detalle} onClose={() => setDetalle(null)} onChanged={reload} notify={notify} />}
      {/* KPIs */}
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Ventas totales', value: String(ventas.length), tone: 'default' },
          { label: 'De maquinaria', value: String(maquinaria.length), tone: 'muted' },
          { label: 'Monto total', value: `$${totalVendido.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, tone: 'gold' },
          { label: 'Ticket promedio', value: `$${ticket.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, tone: 'default' },
        ]}
      />

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-edge flex items-center gap-3 flex-wrap">
          <h3 className="font-bold text-ink shrink-0">Historial de ventas <span className="text-mute font-normal">({filtradas.length})</span></h3>
          <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente o equipo..."
              className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={reload} className="text-xs text-mute hover:text-gold transition-colors shrink-0">Actualizar</button>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Equipo / Unidad</th>
                <th className="font-semibold px-3 py-3">Fecha</th>
                <th className="font-semibold px-3 py-3">Pago</th>
                <th className="font-semibold px-3 py-3">Vendedor</th>
                <th className="font-semibold px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtradas.map(v => (
                <tr key={v.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold flex items-center justify-center shrink-0 font-black text-sm">{(v.nombre_cliente?.[0] || '#').toUpperCase()}</span>
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-ink truncate block">{v.nombre_cliente || 'Cliente general'}</span>
                        {v.cuenta && (
                          <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-medium truncate flex items-center gap-1">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M7.5 7.5l-1 1a3.5 3.5 0 000 5l1 1m9-9l1 1a3.5 3.5 0 010 5l-1 1"/></svg>
                            Ligada a {v.cuenta}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {v.unidad ? (
                      <><p className="text-sm text-ink truncate">{v.unidad.equipo}</p><p className="font-mono text-[11px] text-mute">{v.unidad.codigo}</p></>
                    ) : v.origen ? (
                      <><p className="text-sm text-ink truncate">{v.origen.resumen || 'Venta desde cotización'}</p><p className="font-mono text-[11px] text-mute">{v.origen.folio} · sin unidad asignada</p></>
                    ) : <span className="text-xs text-mute">—</span>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-mute">{new Date(v.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase ${metodoStyle[v.metodo_pago] || 'bg-surface-2 text-mute'}`}>{v.metodo_pago}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-mute">{v.vendedor || '—'}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <div className="text-right">
                        <span className={`text-sm font-black ${v.estado === 'cancelada' ? 'text-mute line-through' : 'text-price'}`}>${(Number(v.total) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        {v.iva && <p className="text-[10px] text-mute">IVA ${Number(v.iva).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>}
                        {v.estado === 'cancelada' && <p className="text-[10px] text-red-500 font-semibold uppercase">Cancelada</p>}
                      </div>
                      <button onClick={() => setDetalle(v)} title="Ver detalle" aria-label="Ver detalle de la venta" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 transition-colors flex items-center justify-center shrink-0">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                      {v.estado !== 'cancelada' && (
                        <button onClick={() => cancelar(v)} title="Cancelar venta" aria-label="Cancelar venta" className="w-8 h-8 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-colors flex items-center justify-center shrink-0">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length === 0 && <p className="text-sm text-mute py-14 text-center">{q ? 'Sin resultados.' : 'Sin ventas registradas.'}</p>}
        </div>
      </Card>
    </div>
  )
}

/* ════════════════════════════════════════
   MÓDULO NOTIFICACIONES
════════════════════════════════════════ */
const notifMeta: Record<Notif['tipo'], { color: string; icon: React.ReactNode }> = {
  alerta: { color: 'text-red-500 bg-red-500/10', icon: <><path d="M12 4.2l9 16.3H3z" /><path d="M12 9v4" /><path d="M12 16.9h.01" /></> },
  renta: { color: 'text-blue-500 bg-blue-500/10', icon: <><path d="M7 4.5v2.5M17 4.5v2.5" /><path d="M5.5 8h13" /><path d="M6.5 7.5h11a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" /><path d="M12 13v3l2 1" /></> },
  venta: { color: 'text-gold bg-gold-soft', icon: <><path d="M6.5 9.5h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6z" /><path d="M6.5 9.5l-1.2-5h-3" /></> },
  inventario: { color: 'text-mute bg-surface-2', icon: <><rect x="5" y="5" width="6.25" height="6.25" rx="1.1" /><rect x="12.75" y="5" width="6.25" height="6.25" rx="1.1" /><rect x="5" y="12.75" width="6.25" height="6.25" rx="1.1" /><rect x="12.75" y="12.75" width="6.25" height="6.25" rx="1.1" /></> },
  sistema: { color: 'text-mute bg-surface-2', icon: <><path d="M12 7.5v5l3 1.8" /><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></> },
}

function notifVisual(n: Notif) {
  const base = notifMeta[n.tipo] || notifMeta.sistema
  if (n.tipo === 'inventario') {
    const t = (n.titulo || '').toLowerCase()
    if (t.includes('mantenimiento')) {
      return {
        color: 'text-amber-500 bg-amber-500/10',
        icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></>,
      }
    }
    if (t.includes('finalizado') || t.includes('disponible')) {
      return {
        color: 'text-emerald-500 bg-emerald-500/10',
        icon: <><path d="M5.2 12.8l3.2 3.2L18.8 5.6" /></>,
      }
    }
  }
  return base
}

function tiempoRelativo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}

function NotificacionesAdmin({ notifs, reload, go, onOpen }: {
  notifs: Notif[]; reload: () => void; go: (s: Section) => void; onOpen?: (n: Notif) => void
}) {
  const [tab, setTab] = useState<'todas' | 'sin_leer'>('todas')
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<Notif['tipo'] | 'todas'>('todas')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const counts = (['alerta', 'renta', 'venta', 'inventario', 'sistema'] as const).reduce((acc, t) => {
    acc[t] = notifs.filter(n => n.tipo === t).length
    return acc
  }, {} as Record<Notif['tipo'], number>)

  const noLeidas = notifs.filter(n => !n.leida).length

  const visibles = notifs
    .filter(n => (tab === 'sin_leer' ? !n.leida : true))
    .filter(n => (tipo === 'todas' ? true : n.tipo === tipo))
    .filter(n => {
      const needle = q.trim().toLowerCase()
      if (!needle) return true
      return `${n.titulo || ''} ${n.mensaje || ''}`.toLowerCase().includes(needle)
    })

  // En el timeline, selectedId = fila expandida (se alterna al hacer clic)
  const dotColor: Record<Notif['tipo'], string> = {
    alerta: '#C23B3B', renta: '#2B5FAD', venta: '#B8872E', inventario: '#6B7280', sistema: '#9CA3AF',
  }

  const typeLabel: Record<Notif['tipo'], string> = {
    alerta: 'Alerta',
    renta: 'Renta',
    venta: 'Venta',
    inventario: 'Inventario',
    sistema: 'Sistema',
  }

  const typePill: Record<Notif['tipo'], string> = {
    alerta: 'bg-red-500/10 text-red-500',
    renta: 'bg-blue-500/10 text-blue-500',
    venta: 'bg-gold-soft text-gold',
    inventario: 'bg-surface-2 text-mute',
    sistema: 'bg-surface-2 text-mute',
  }

  const marcarTodas = () => {
    api.post('/notificaciones/leer-todas/').then(reload).catch(() => {})
  }

  const marcarLeida = (n: Notif) => {
    if (n.leida) return
    api.post(`/notificaciones/${n.id}/leer/`).then(reload).catch(() => {})
  }

  const abrir = (n: Notif) => {
    marcarLeida(n)
    if (onOpen) onOpen(n)
    else if (n.seccion) go(n.seccion as Section)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* El eyebrow "Centro de actividad" y su descripción se quitaron: la sección
          ya tiene su título y subtítulo arriba, repetirlo era relleno. Quedan las
          acciones, alineadas a la derecha. */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-end gap-3">
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={reload}
            className="h-10 px-4 rounded-xl border border-edge bg-surface-2 text-sm font-semibold text-ink hover:border-gold/40 hover:text-gold transition-colors active:scale-[0.98]"
          >
            Actualizar
          </button>
          {noLeidas > 0 && (
            <button
              onClick={marcarTodas}
              className="h-10 px-4 rounded-xl bg-gold text-black text-sm font-black hover:opacity-90 transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]"
            >
              Marcar todas
            </button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-edge">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex p-1 rounded-full border border-edge bg-surface-2">
                <button
                  onClick={() => setTab('todas')}
                  className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${tab === 'todas' ? 'bg-surface text-ink' : 'text-mute hover:text-ink'}`}
                >
                  Todas <span className="ml-1 text-mute">{notifs.length}</span>
                </button>
                <button
                  onClick={() => setTab('sin_leer')}
                  className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${tab === 'sin_leer' ? 'bg-surface text-ink' : 'text-mute hover:text-ink'}`}
                >
                  Sin leer <span className="ml-1 text-mute">{noLeidas}</span>
                </button>
              </div>
              <div className="relative w-full sm:w-[320px]">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" strokeLinecap="round" /></svg>
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Buscar notificaciones…"
                  className="w-full bg-surface-2 border border-edge rounded-xl pl-9 pr-3 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
              {(['todas', 'alerta', 'renta', 'venta', 'inventario', 'sistema'] as const).map((t) => {
                const active = tipo === t
                const pill = t === 'todas' ? 'bg-surface-2 text-ink' : typePill[t]
                const count = t === 'todas' ? notifs.length : counts[t]
                return (
                  <button
                    key={t}
                    onClick={() => setTipo(t as any)}
                    className={`h-9 px-3 rounded-full border text-xs font-semibold transition-colors active:scale-[0.98] ${
                      active ? 'border-gold/40 text-ink bg-surface' : 'border-edge hover:border-gold/25'
                    }`}
                  >
                    <span className={`px-2 py-0.5 rounded-full ${pill}`}>{t === 'todas' ? 'Todas' : typeLabel[t]}</span>
                    <span className="ml-2 text-mute tabular-nums">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {visibles.length === 0 && (
            <div className="py-16 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3 text-mute">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" /></svg>
              </div>
              <p className="text-sm text-mute">{tab === 'sin_leer' ? 'No tienes notificaciones sin leer.' : 'No tienes notificaciones.'}</p>
            </div>
          )}

          {visibles.map((n, i) => {
            const meta = notifVisual(n)
            const expanded = n.id === selectedId
            const unread = !n.leida
            const isLast = i === visibles.length - 1
            return (
              <div key={n.id} className="flex gap-2">
                {/* Riel del timeline */}
                <div className="flex flex-col items-center w-3.5 shrink-0">
                  <span className="w-3 h-3 rounded-full shrink-0 mt-[22px]" style={{ background: dotColor[n.tipo] }} />
                  {!isLast && <span className="w-0.5 flex-1 bg-edge" />}
                </div>
                <div className="flex-1 min-w-0 pb-1.5">
                  <button
                    onClick={() => setSelectedId(expanded ? n.id * -1 : n.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-3.5 rounded-xl text-left transition-colors ${unread ? 'bg-gold-soft/30 hover:bg-gold-soft/50' : 'hover:bg-surface-2'}`}
                  >
                    <span className={`w-[38px] h-[38px] rounded-[9px] border border-edge/50 flex items-center justify-center shrink-0 ${meta.color}`}>
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{meta.icon}</svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[14.5px] truncate ${unread ? 'font-extrabold text-ink' : 'font-semibold text-ink'}`}>{n.titulo}</span>
                        {unread && <span className="w-[7px] h-[7px] rounded-full bg-gold shrink-0" />}
                      </div>
                      <div className="text-[13px] text-mute mt-0.5">{typeLabel[n.tipo]} · {tiempoRelativo(n.creada)}</div>
                    </div>
                    <span className="text-[13px] font-semibold text-mute shrink-0">{expanded ? 'Cerrar' : 'Ver'}</span>
                  </button>
                  {expanded && (
                    <div className="mx-1 mt-1.5 p-5 bg-surface border border-edge rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        {!n.leida ? <span className="text-[11px] font-bold text-gold bg-gold-soft px-2 py-0.5 rounded-md uppercase">Nuevo</span> : <span />}
                        <span className="text-[12.5px] text-mute font-mono">{new Date(n.creada).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {n.mensaje && <div className="text-[14.5px] leading-relaxed text-ink mb-4 whitespace-pre-wrap">{n.mensaje}</div>}
                      <div className="flex gap-1.5">
                        {!n.leida && <button onClick={() => marcarLeida(n)} className="flex-1 py-2.5 rounded-[9px] border border-edge font-bold text-[13px] hover:bg-surface-2 transition-colors">Marcar leído</button>}
                        {n.seccion && <button onClick={() => abrir(n)} className="flex-1 py-2.5 rounded-[9px] bg-gold text-white font-bold text-[13px] hover:opacity-90 transition-opacity">Abrir</button>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/* ════════════════════════════════════════
   CATÁLOGOS CRUD (Categorías / Tipos / Marcas)
════════════════════════════════════════ */
function CatalogosAdmin({ categorias, tipos, marcas, equipos, reload, notify, go }: {
  categorias: Option[]; tipos: Option[]; marcas: Option[]; equipos: Equipo[]
  reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void; go: (s: Section) => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [verSinClasificar, setVerSinClasificar] = useState(false)
  // Conteo de uso por producto para cada etiqueta
  const count = (pick: (e: Equipo) => number | undefined) => {
    const m = new Map<number, number>()
    equipos.forEach(e => { const id = pick(e); if (id != null) m.set(id, (m.get(id) || 0) + 1) })
    return m
  }
  const usoCat = count(e => e.categoria?.id)
  const usoTipo = count(e => e.tipo?.id)
  const usoMarca = count(e => e.marca?.id)

  const blocks = [
    { title: 'Categorías', singular: 'categoría', endpoint: '/categorias/', data: categorias, uso: usoCat, accent: 'text-gold bg-gold-soft', icon: <path d="M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z" /> },
    { title: 'Tipos', singular: 'tipo', endpoint: '/tipos/', data: tipos, uso: usoTipo, accent: 'text-blue-500 bg-blue-500/10', icon: <path d="M7 7h10M7 12h10M7 17h6M4 4h16v16H4z" /> },
    { title: 'Marcas', singular: 'marca', endpoint: '/marcas/', data: marcas, uso: usoMarca, accent: 'text-violet-500 bg-violet-500/10', icon: <path d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /> },
  ]
  // Productos incompletos + qué etiqueta les falta a cada uno (para poder actuar).
  const sinClasificarList = equipos
    .filter(e => !e.categoria || !e.tipo || !e.marca)
    .map(e => ({
      e,
      faltan: [!e.categoria && 'Categoría', !e.tipo && 'Tipo', !e.marca && 'Marca'].filter(Boolean) as string[],
    }))
  const sinClasificar = sinClasificarList.length

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-gold text-[12px] font-bold tracking-wide mb-2">— TAXONOMÍA DEL CATÁLOGO</p>
          <p className="text-[15px] text-mute max-w-2xl leading-relaxed">
            Organiza tus productos en <b className="text-ink">categorías</b>, <b className="text-ink">tipos</b> y <b className="text-ink">marcas</b>. Cada etiqueta muestra cuántos productos la usan.
          </p>
        </div>
        {sinClasificar > 0 && (
          <button onClick={() => setVerSinClasificar(v => !v)} title="Ver cuáles son"
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-[9px] text-[13px] font-bold hover:brightness-95 transition-[filter]" style={{ background: '#FBEBD9', color: '#B8681C' }}>
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: '#B8681C' }} />
            {sinClasificar} producto{sinClasificar > 1 ? 's' : ''} sin clasificar
            <svg className={`w-3.5 h-3.5 transition-transform ${verSinClasificar ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
      </div>

      {/* Detalle: qué productos están sin clasificar y qué les falta */}
      {sinClasificar > 0 && verSinClasificar && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#F0D6B8' }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ background: '#FBEBD9', borderColor: '#F0D6B8' }}>
            <p className="text-[13px] font-bold" style={{ color: '#B8681C' }}>Productos sin clasificar ({sinClasificar})</p>
            <button onClick={() => go('equipos')} className="shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-gold text-black text-xs font-bold hover:brightness-95 transition-[filter]">
              Ir a Productos
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div className="divide-y divide-edge max-h-64 overflow-y-auto bg-surface">
            {sinClasificarList.map(({ e, faltan }) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <p className="text-sm text-ink truncate">{e.modelo || `Producto #${e.id}`}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {faltan.map(f => (
                    <span key={f} className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md" style={{ background: '#FBEBD9', color: '#B8681C' }}>
                      Falta {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-2.5 items-start">
        {/* Selector de columna */}
        <div className="flex lg:flex-col gap-1 overflow-x-auto">
          {blocks.map((b, i) => (
            <button key={b.endpoint} onClick={() => setActiveIdx(i)} className={`flex items-center gap-2.5 p-4 rounded-xl border text-left transition-colors shrink-0 lg:shrink ${i === activeIdx ? 'bg-surface border-gold/40 shadow-[0_1px_3px_rgba(33,29,22,0.04)]' : 'bg-surface border-edge hover:border-gold/25'}`}>
              <span className={`w-[34px] h-[34px] rounded-[9px] flex items-center justify-center shrink-0 ${b.accent}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7">{b.icon}</svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-extrabold text-ink whitespace-nowrap">{b.title}</div>
                <div className="text-[12.5px] text-mute mt-0.5 whitespace-nowrap">{b.data.length} etiquetas</div>
              </div>
              {i === activeIdx && <span className="w-[7px] h-[7px] rounded-full bg-gold shrink-0" />}
            </button>
          ))}
          {sinClasificar > 0 && (
            <button onClick={() => setVerSinClasificar(true)} title="Ver cuáles son"
              className="hidden lg:block text-left mt-2 p-4 rounded-xl text-[13px] font-semibold leading-snug hover:brightness-95 transition-[filter]" style={{ background: '#FBEBD9', color: '#B8681C' }}>
              <div className="flex items-center gap-1.5 font-bold mb-1"><span className="w-[7px] h-[7px] rounded-full" style={{ background: '#B8681C' }} />Sin clasificar</div>
              {sinClasificar} producto{sinClasificar > 1 ? 's' : ''} aún sin categoría, tipo o marca. <span className="underline">Ver cuáles →</span>
            </button>
          )}
        </div>

        {/* Panel de detalle */}
        <div className="min-w-0">
          <CatalogBlock key={blocks[activeIdx].endpoint} {...blocks[activeIdx]} reload={reload} notify={notify} />
        </div>
      </div>
    </div>
  )
}

function CatalogBlock({ title, singular, endpoint, data, uso, accent, icon, reload, notify }: {
  title: string; singular: string; endpoint: string; data: Option[]; uso: Map<number, number>; accent: string; icon: React.ReactNode
  reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [nombre, setNombre] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')

  const visibles = data.filter(o => !search.trim() || o.nombre.toLowerCase().includes(search.trim().toLowerCase()))
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

  function add() {
    const v = nombre.trim()
    if (!v) return
    setBusy(true)
    api.post(endpoint, { nombre: v })
      .then(() => { notify(`${cap(singular)} agregada`); setNombre(''); reload() })
      .catch(err => notify(err?.response?.data?.nombre?.[0] || 'Error al agregar', 'err'))
      .finally(() => setBusy(false))
  }

  function guardarRename(id: number) {
    const v = editVal.trim()
    if (!v) { setEditId(null); return }
    api.patch(`${endpoint}${id}/`, { nombre: v })
      .then(() => { notify('Renombrado'); setEditId(null); reload() })
      .catch(err => notify(err?.response?.data?.nombre?.[0] || 'Error al renombrar', 'err'))
  }

  function del(o: Option) {
    const n = uso.get(o.id) || 0
    if (n > 0) { notify(`"${o.nombre}" está en uso por ${n} producto${n > 1 ? 's' : ''}`, 'err'); return }
    if (!confirm(`¿Eliminar "${o.nombre}"?`)) return
    api.delete(`${endpoint}${o.id}/`)
      .then(() => { notify('Eliminado'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'No se puede eliminar (en uso)', 'err'))
  }

  return (
    <Card className="overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-edge flex items-center gap-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7">{icon}</svg>
        </span>
        <h2 className="font-bold text-ink flex-1">{title}</h2>
        <span className="text-xs font-bold px-2 py-1 rounded-md bg-surface-2 text-mute tabular-nums">{data.length}</span>
      </div>

      <div className="p-5 space-y-3">
        {/* Agregar */}
        <div className="flex gap-2">
          <input className={input} value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={`Nueva ${singular}`} />
          <button onClick={add} disabled={busy}
            className="shrink-0 w-10 h-[42px] rounded-xl bg-gold text-black font-black hover:opacity-90 active:scale-[0.96] transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 flex items-center justify-center">
            {busy ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : '+'}
          </button>
        </div>
        {/* Buscar (si hay muchas) */}
        {data.length > 6 && (
          <input className={`${input} text-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Filtrar ${title.toLowerCase()}…`} />
        )}
      </div>

      {/* Lista */}
      <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[440px] overflow-y-auto">
        {visibles.map((o, i) => {
          const n = uso.get(o.id) || 0
          return (
            <div key={o.id} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              className="stagger-item relative flex items-center gap-2 px-3.5 py-3 rounded-[10px] border border-edge hover:bg-surface-2 hover:border-gold/25 transition-colors duration-150 group">
              {editId === o.id ? (
                <>
                  <input autoFocus className="flex-1 bg-surface-2 border border-gold/40 rounded-md px-2 py-1 text-sm text-ink focus:outline-none"
                    value={editVal} onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') guardarRename(o.id); if (e.key === 'Escape') setEditId(null) }} />
                  <button onClick={() => guardarRename(o.id)} className="text-emerald-500 hover:opacity-80 active:scale-90 transition-transform duration-100 p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></button>
                  <button onClick={() => setEditId(null)} className="text-mute hover:text-ink active:scale-90 transition-transform duration-100 p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink truncate">{o.nombre}</span>
                  {/* Conteo de uso (oculto en hover para dar espacio a acciones) */}
                  <span className={`text-[11px] font-mono tabular-nums shrink-0 transition-opacity duration-150 group-hover:opacity-0 ${n > 0 ? 'text-mute' : 'text-mute/50'}`}>
                    {n} prod.
                  </span>
                  <div className="flex items-center absolute right-5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button onClick={() => { setEditId(o.id); setEditVal(o.nombre) }} title="Renombrar" className="text-mute hover:text-gold active:scale-90 transition-transform duration-100 p-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button onClick={() => del(o)} title={n > 0 ? `En uso (${n})` : 'Eliminar'} className={`active:scale-90 transition-transform duration-100 p-1 ${n > 0 ? 'text-mute/40 cursor-not-allowed' : 'text-mute hover:text-red-400'}`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {visibles.length === 0 && <p className="text-xs text-mute py-6 text-center">{search ? 'Sin coincidencias' : 'Vacío — agrega la primera ↑'}</p>}
      </div>
    </Card>
  )
}

/* ════════════════════════════════════════
   CUPONES CRUD
════════════════════════════════════════ */
function CuponesAdmin({ coupons, reload, notify }: {
  coupons: Coupon[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [codigo, setCodigo] = useState('')
  const [percent, setPercent] = useState('')
  const [busy, setBusy] = useState(false)

  function add() {
    const code = codigo.trim()
    const pct = Math.max(0, Math.min(100, Number(percent) || 0))
    if (!code) { notify('Código obligatorio', 'err'); return }
    setBusy(true)
    api.post('/cupones/', { codigo: code, descuento: pct / 100, activo: true })
      .then(() => { notify('Cupón creado'); setCodigo(''); setPercent(''); reload() })
      .catch(err => notify(err?.response?.data?.codigo?.[0] || 'Error al crear', 'err'))
      .finally(() => setBusy(false))
  }

  function del(id?: number) {
    if (!id || !confirm('¿Eliminar cupón?')) return
    api.delete(`/cupones/${id}/`).then(() => { notify('Cupón eliminado'); reload() }).catch(() => notify('Error', 'err'))
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <Card className="p-6 h-fit">
        <h2 className="font-bold text-ink mb-5">Nuevo cupón</h2>
        <div className="space-y-4">
          <div>
            <label className={label}>Código</label>
            <input className={input} value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="VERANO2026" />
          </div>
          <div>
            <label className={label}>Descuento (%)</label>
            <input type="number" min={0} max={100} className={input} value={percent} onChange={e => setPercent(e.target.value)} placeholder="15" />
          </div>
          <button onClick={add} disabled={busy}
            className="w-full py-3 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-colors disabled:opacity-50">
            Crear cupón
          </button>
        </div>
      </Card>

      <div className="lg:col-span-2">
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-edge">
            <h2 className="font-bold text-ink">Cupones <span className="text-mute font-normal">({coupons.length})</span></h2>
          </div>
          <div className="divide-y divide-edge">
            {coupons.map(c => (
              <div key={c.id} className="flex items-center justify-between px-6 py-4 hover:bg-surface-2 transition-colors group">
                <div className="flex items-center gap-4">
                  <span className="px-3 py-1.5 rounded-lg bg-gold-soft text-gold font-mono font-bold text-sm">{c.codigo}</span>
                  <span className="text-sm text-mute">{Math.round((c.descuento || 0) * 100)}% descuento</span>
                  {c.activo === false && <span className="text-xs text-mute">(inactivo)</span>}
                </div>
                <button onClick={() => del(c.id)} className="px-3 py-1.5 rounded-lg border border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all">Eliminar</button>
              </div>
            ))}
            {coupons.length === 0 && <p className="text-sm text-mute py-16 text-center">Sin cupones aún.</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   MÓDULO EMPRESAS → OBRAS
════════════════════════════════════════ */
const obraEstadoStyle: Record<string, string> = {
  activa: 'bg-emerald-500/10 text-emerald-500',
  pausada: 'bg-amber-500/10 text-amber-500',
  finalizada: 'bg-surface-2 text-mute',
}

function EmpresasAdmin({ empresas, reload, notify }: {
  empresas: Empresa[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [q, setQ] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<Empresa>({ nombre: '' })
  const [busqueda, setBusqueda] = useState('')
  const [errores, setErrores] = useState<Record<string, boolean>>({})
  const [obrasEmpresa, setObrasEmpresa] = useState<Empresa | null>(null)
  const editing = Boolean(form.id)

  // Campo con error: etiqueta y borde en rojo; se limpia al escribir.
  const lblErr = (k: string) => (errores[k] ? `${label} !text-red-500` : label)
  const inpErr = (k: string) => (errores[k] ? `${input} !border-red-500` : input)
  const setCampo = (k: keyof Empresa, v: any) => {
    setForm(f => ({ ...f, [k]: v }))
    if (errores[k as string]) setErrores(p => ({ ...p, [k]: false }))
  }
  const Requerido = ({ k }: { k: string }) => (errores[k] ? <p className="text-[11px] text-red-500 mt-1">Campo obligatorio</p> : null)
  // Autocompletado: al elegir una dirección se llenan los campos del domicilio.
  function fillDireccion(a: AddressResult) {
    const campos = addressToFields(a)
    setForm(f => ({ ...f, ...campos }))
    setBusqueda(formatAddress(a))
    setErrores(p => ({ ...p, calle: false, colonia: false, municipio: false, entidad: false, codigo_postal: false }))
  }

  const filtradas = empresas.filter(e => {
    if (!q.trim()) return true
    const t = `${e.nombre} ${e.contacto || ''} ${e.email || ''} ${(e.obras || []).map(o => o.nombre).join(' ')}`.toLowerCase()
    return t.includes(q.trim().toLowerCase())
  })
  const totalObras = empresas.reduce((a, e) => a + (e.obras_count ?? (e.obras?.length || 0)), 0)
  const obrasActivas = empresas.reduce((a, e) => a + (e.obras_activas ?? 0), 0)

  function openNew() { setForm({ nombre: '', activa: true, pais: 'México' }); setBusqueda(''); setErrores({}); setFormOpen(true) }
  function openEdit(e: Empresa) { setForm({ ...e }); setBusqueda(e.direccion || ''); setErrores({}); setFormOpen(true) }

  // Campos obligatorios al crear un cliente facturable (CFDI + domicilio fiscal).
  const REQUERIDOS: [string, string][] = [
    ['nombre', 'Razón social'], ['rfc', 'RFC'], ['regimen_fiscal', 'Régimen fiscal'], ['uso_cfdi', 'Uso CFDI'],
    ['contacto', 'Contacto'], ['telefono', 'Teléfono'],
    ['calle', 'Calle'], ['colonia', 'Colonia'], ['municipio', 'Municipio'], ['entidad', 'Estado'], ['codigo_postal', 'CP'],
  ]

  function save() {
    if (!editing) {
      const faltan = REQUERIDOS.filter(([k]) => !((form as any)[k] || '').trim())
      setErrores(Object.fromEntries(faltan.map(([k]) => [k, true])))
      if (faltan.length) { notify(`Falta: ${faltan.map(([, l]) => l).join(', ')}`, 'err'); return }
    } else if (!form.nombre.trim()) {
      setErrores({ nombre: true })
      notify('La razón social es obligatoria', 'err'); return
    }
    const body: any = {
      nombre: form.nombre.trim(), rfc: (form.rfc || '').trim().toUpperCase(),
      regimen_fiscal: form.regimen_fiscal || '', uso_cfdi: form.uso_cfdi || '',
      contacto: (form.contacto || '').trim(), telefono: (form.telefono || '').trim(), email: form.email || '',
      calle: (form.calle || '').trim(), numero_exterior: (form.numero_exterior || '').trim(),
      numero_interior: (form.numero_interior || '').trim(), colonia: (form.colonia || '').trim(),
      municipio: (form.municipio || '').trim(), ciudad: (form.ciudad || '').trim(),
      entidad: (form.entidad || '').trim(), codigo_postal: (form.codigo_postal || '').trim(),
      pais: (form.pais || 'México').trim(), referencias: (form.referencias || '').trim(),
      latitud: form.latitud ?? null, longitud: form.longitud ?? null,
      notas: form.notas || '', activa: form.activa ?? true,
    }
    const req = editing ? api.patch(`/empresas/${form.id}/`, body) : api.post('/empresas/', body)
    req.then(() => { notify(editing ? 'Empresa actualizada' : 'Empresa creada'); setFormOpen(false); reload() })
      .catch(err => {
        const d = err?.response?.data || {}
        const primer = Object.values(d)[0] as any
        const msg = Array.isArray(primer) ? primer[0] : (d.detalle || 'Error al guardar')
        notify(msg, 'err')
      })
  }

  function del(e: Empresa) {
    if (!confirm(`¿Eliminar "${e.nombre}" y todas sus obras?`)) return
    api.delete(`/empresas/${e.id}/`)
      .then(() => { notify('Empresa eliminada'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al eliminar', 'err'))
  }

  // Alternativa no destructiva al borrado: conserva el historial y la saca de
  // los selectores de renta/venta/cotización.
  function toggleActiva(e: Empresa) {
    const activar = e.activa === false
    if (!activar && !confirm(`¿Desactivar "${e.nombre}"?\n\nDejará de aparecer al crear rentas, ventas y cotizaciones, pero conservas todo su historial.`)) return
    api.patch(`/empresas/${e.id}/`, { activa: activar })
      .then(() => { notify(activar ? 'Empresa activada' : 'Empresa desactivada'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al actualizar', 'err'))
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <KpiGrid
        items={[
          { label: 'Empresas', value: empresas.length, tone: 'default' },
          { label: 'Obras totales', value: totalObras, tone: 'muted' },
          { label: 'Obras activas', value: obrasActivas, tone: 'success' },
        ]}
      />

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-edge flex items-center gap-3 flex-wrap">
          <h2 className="font-bold text-ink shrink-0">Empresas <span className="text-mute font-normal">({filtradas.length})</span></h2>
          <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar empresa u obra..."
              className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={openNew} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">Nueva empresa</span>
          </button>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Empresa</th>
                <th className="font-semibold px-3 py-3">Contacto</th>
                <th className="font-semibold px-3 py-3">Obras</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtradas.map(e => (
                <tr key={e.id} className={`hover:bg-surface-2 transition-colors group ${e.activa === false ? 'opacity-55' : ''}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-black text-sm ${e.activa === false ? 'bg-ink/10 text-mute' : 'bg-gold-soft text-gold'}`}>{e.nombre[0]?.toUpperCase()}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-bold text-ink truncate">{e.nombre}</p>
                          {e.activa === false && <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-ink/10 text-mute">Inactiva</span>}
                        </div>
                        {e.rfc && <p className="text-[11px] text-mute font-mono">{e.rfc}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {e.contacto && <p className="text-sm text-ink truncate">{e.contacto}</p>}
                    <p className="text-[11px] text-mute truncate">{[e.telefono, e.email].filter(Boolean).join(' · ') || '—'}</p>
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => setObrasEmpresa(e)} className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-gold transition-colors">
                      <span className="min-w-6 h-6 px-2 rounded-md bg-surface-2 text-mute text-xs font-bold flex items-center justify-center">{e.obras_count ?? (e.obras?.length || 0)}</span>
                      obras
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setObrasEmpresa(e)} className="px-3 h-8 rounded-lg bg-gold-soft text-gold text-xs font-semibold hover:bg-gold/20 transition-colors">Obras</button>
                      <button onClick={() => openEdit(e)} title="Editar" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button onClick={() => toggleActiva(e)} title={e.activa === false ? 'Activar empresa' : 'Desactivar (conserva el historial)'} className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" d="M12 3.5v8" /><path strokeLinecap="round" d="M6.8 7.2a7.5 7.5 0 1 0 10.4 0" /></svg>
                      </button>
                      <button onClick={() => del(e)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-mute">{q ? 'Sin resultados.' : 'Aún no hay empresas.'}</p>
              {!q && <button onClick={openNew} className="mt-3 text-sm font-semibold text-gold hover:opacity-80">+ Registrar la primera</button>}
            </div>
          )}
        </div>
      </Card>

      {/* Modal empresa */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={() => setFormOpen(false)}>
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(ev: React.MouseEvent) => ev.stopPropagation()}
            className="fixed inset-y-0 right-0 w-full sm:max-w-[640px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0 bg-surface">
              <h2 className="font-bold text-ink">{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button onClick={() => setFormOpen(false)} className="text-mute hover:text-ink p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* ── Datos fiscales ── */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gold mb-3">Datos fiscales</p>
                <div className="space-y-3">
                  <div><label className={lblErr('nombre')}>Razón social / Nombre *</label><input className={inpErr('nombre')} value={form.nombre} onChange={e => setCampo('nombre', e.target.value)} placeholder="Ej. FEMZA S.A. de C.V." autoFocus /><Requerido k="nombre" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lblErr('rfc')}>RFC *</label>
                      <input className={`${inpErr('rfc')} font-mono`} value={form.rfc || ''} onChange={e => setCampo('rfc', e.target.value.toUpperCase())} placeholder="XAXX010101000" />
                      <div className="flex justify-between"><Requerido k="rfc" /><button type="button" onClick={() => setCampo('rfc', RFC_PUBLICO_GENERAL)} className="text-[11px] text-gold hover:underline mt-1">Público general</button></div>
                    </div>
                    <div>
                      <label className={label}>Email</label>
                      <input type="email" className={input} value={form.email || ''} onChange={e => setCampo('email', e.target.value)} placeholder="correo@empresa.com" />
                    </div>
                    <div>
                      <label className={lblErr('regimen_fiscal')}>Régimen fiscal *</label>
                      <select className={inpErr('regimen_fiscal')} value={form.regimen_fiscal || ''} onChange={e => setCampo('regimen_fiscal', e.target.value)}>
                        <option value="">— Selecciona —</option>
                        {REGIMEN_FISCAL.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
                      </select>
                      <Requerido k="regimen_fiscal" />
                    </div>
                    <div>
                      <label className={lblErr('uso_cfdi')}>Uso CFDI *</label>
                      <select className={inpErr('uso_cfdi')} value={form.uso_cfdi || ''} onChange={e => setCampo('uso_cfdi', e.target.value)}>
                        <option value="">— Selecciona —</option>
                        {USO_CFDI.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
                      </select>
                      <Requerido k="uso_cfdi" />
                    </div>
                    <div><label className={lblErr('contacto')}>Contacto *</label><input className={inpErr('contacto')} value={form.contacto || ''} onChange={e => setCampo('contacto', e.target.value)} placeholder="Persona" /><Requerido k="contacto" /></div>
                    <div><label className={lblErr('telefono')}>Teléfono *</label><input className={inpErr('telefono')} value={form.telefono || ''} onChange={e => setCampo('telefono', e.target.value)} placeholder="555-..." /><Requerido k="telefono" /></div>
                  </div>
                </div>
              </div>

              {/* ── Domicilio fiscal ── */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gold mb-3">Domicilio fiscal</p>
                <div className="space-y-3">
                  <div>
                    <label className={label}>Buscar dirección</label>
                    <AddressAutocomplete value={busqueda} onChange={setBusqueda} onSelect={fillDireccion} placeholder="Escribe para autocompletar (calle, colonia, CP…)" />
                    <p className="text-[11px] text-mute mt-1">Elige una sugerencia y se llenan los campos; puedes ajustarlos.</p>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    <div className="col-span-4"><label className={lblErr('calle')}>Calle *</label><input className={inpErr('calle')} value={form.calle || ''} onChange={e => setCampo('calle', e.target.value)} /><Requerido k="calle" /></div>
                    <div className="col-span-1"><label className={label}>No. ext</label><input className={input} value={form.numero_exterior || ''} onChange={e => setCampo('numero_exterior', e.target.value)} placeholder="S/N" /></div>
                    <div className="col-span-1"><label className={label}>No. int</label><input className={input} value={form.numero_interior || ''} onChange={e => setCampo('numero_interior', e.target.value)} /></div>
                    <div className="col-span-4"><label className={lblErr('colonia')}>Colonia *</label><input className={inpErr('colonia')} value={form.colonia || ''} onChange={e => setCampo('colonia', e.target.value)} /><Requerido k="colonia" /></div>
                    <div className="col-span-2"><label className={lblErr('codigo_postal')}>C.P. *</label><input className={inpErr('codigo_postal')} value={form.codigo_postal || ''} onChange={e => setCampo('codigo_postal', e.target.value)} inputMode="numeric" /><Requerido k="codigo_postal" /></div>
                    <div className="col-span-3"><label className={lblErr('municipio')}>Municipio *</label><input className={inpErr('municipio')} value={form.municipio || ''} onChange={e => setCampo('municipio', e.target.value)} /><Requerido k="municipio" /></div>
                    <div className="col-span-3"><label className={label}>Ciudad</label><input className={input} value={form.ciudad || ''} onChange={e => setCampo('ciudad', e.target.value)} /></div>
                    <div className="col-span-3"><label className={lblErr('entidad')}>Estado *</label><input className={inpErr('entidad')} value={form.entidad || ''} onChange={e => setCampo('entidad', e.target.value)} /><Requerido k="entidad" /></div>
                    <div className="col-span-3"><label className={label}>País</label><input className={input} value={form.pais || 'México'} onChange={e => setCampo('pais', e.target.value)} /></div>
                  </div>
                  {form.latitud && form.longitud && <p className="text-[11px] text-mute">{Number(form.latitud).toFixed(5)}, {Number(form.longitud).toFixed(5)}</p>}
                </div>
              </div>

              <div><label className={label}>Notas</label><textarea className={`${input} resize-none`} rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Información adicional" /></div>
            </div>
            <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
              <button onClick={() => setFormOpen(false)} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
              <button onClick={save} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150">{editing ? 'Guardar' : 'Crear cliente'}</button>
            </div>
          </motion.div>
        </div>
      )}

      {obrasEmpresa && <ObrasModal empresa={obrasEmpresa} onClose={() => setObrasEmpresa(null)} onChanged={reload} notify={notify} />}
    </div>
  )
}

/* ── Modal de obras de una empresa ── */
function ObrasModal({ empresa, onClose, onChanged, notify }: {
  empresa: Empresa; onClose: () => void; onChanged: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Partial<Obra>>({ nombre: '', estado: 'activa' })
  const [busqueda, setBusqueda] = useState('')
  const [errores, setErrores] = useState<Record<string, boolean>>({})

  // Borde rojo + aviso "Obligatorio"; se limpia al escribir.
  const inpErr = (k: string) => (errores[k] ? `${input} !border-red-500` : input)
  const setCampo = (k: keyof Obra, v: any) => {
    setDraft(d => ({ ...d, [k]: v }))
    if (errores[k as string]) setErrores(p => ({ ...p, [k]: false }))
  }
  const Requerido = ({ k }: { k: string }) => (errores[k] ? <p className="text-[11px] text-red-500 mt-1">Obligatorio</p> : null)
  function fillUbicacion(a: AddressResult) {
    const campos = addressToFields(a)
    setDraft(d => ({ ...d, ...campos }))
    setBusqueda(formatAddress(a))
    setErrores(p => ({ ...p, calle: false, colonia: false, municipio: false, entidad: false, codigo_postal: false }))
  }

  const load = useCallback(() => {
    setLoading(true)
    api.get<Obra[]>(`/empresas/${empresa.id}/obras/`).then(r => setObras(r.data || [])).catch(() => setObras([])).finally(() => setLoading(false))
  }, [empresa.id])
  useEffect(() => { load() }, [load])

  function startNew() { setDraft({ nombre: '', responsable: '', telefono: '', estado: 'activa', pais: 'México' }); setBusqueda(''); setErrores({}); setEditId('new') }
  function startEdit(o: Obra) { setDraft({ ...o }); setBusqueda(o.ubicacion || ''); setErrores({}); setEditId(o.id) }

  const REQUERIDOS: [string, string][] = [
    ['nombre', 'Nombre de la obra'], ['responsable', 'Responsable'], ['telefono', 'Teléfono'],
    ['calle', 'Calle'], ['colonia', 'Colonia'], ['municipio', 'Municipio'], ['entidad', 'Estado'], ['codigo_postal', 'CP'],
  ]

  function saveDraft() {
    if (editId === 'new') {
      const faltan = REQUERIDOS.filter(([k]) => !((draft as any)[k] || '').trim())
      setErrores(Object.fromEntries(faltan.map(([k]) => [k, true])))
      if (faltan.length) { notify(`Falta: ${faltan.map(([, l]) => l).join(', ')}`, 'err'); return }
    } else if (!draft.nombre?.trim()) {
      setErrores({ nombre: true })
      notify('Nombre de obra obligatorio', 'err'); return
    }
    const body: any = {
      nombre: (draft.nombre || '').trim(), responsable: (draft.responsable || '').trim(), telefono: (draft.telefono || '').trim(),
      calle: (draft.calle || '').trim(), numero_exterior: (draft.numero_exterior || '').trim(), numero_interior: (draft.numero_interior || '').trim(),
      colonia: (draft.colonia || '').trim(), municipio: (draft.municipio || '').trim(), ciudad: (draft.ciudad || '').trim(),
      entidad: (draft.entidad || '').trim(), codigo_postal: (draft.codigo_postal || '').trim(), pais: (draft.pais || 'México').trim(),
      referencias: (draft.referencias || '').trim(), latitud: draft.latitud ?? null, longitud: draft.longitud ?? null,
      estado: draft.estado || 'activa', notas: draft.notas || '',
    }
    const req = editId === 'new' ? api.post(`/empresas/${empresa.id}/obras/`, body) : api.patch(`/obras/${editId}/`, body)
    req.then(() => { notify(editId === 'new' ? 'Obra agregada' : 'Obra actualizada'); setEditId(null); load(); onChanged() })
      .catch(err => {
        const d = err?.response?.data || {}
        const primer = Object.values(d)[0] as any
        notify(Array.isArray(primer) ? primer[0] : (d.detalle || 'Error al guardar'), 'err')
      })
  }

  function delObra(o: Obra) {
    if (!confirm(`¿Eliminar la obra "${o.nombre}"?`)) return
    api.delete(`/obras/${o.id}/`)
      .then(() => { notify('Obra eliminada'); load(); onChanged() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al eliminar', 'err'))
  }

  return (
    <div className="modal-in fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm flex items-start justify-center p-0 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[820px] my-0 sm:my-auto bg-surface border border-edge rounded-none sm:rounded-2xl min-h-screen sm:min-h-0 max-h-screen sm:max-h-[88vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-gold">Obras de</p>
            <h2 className="font-black text-ink truncate">{empresa.nombre}</h2>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1 shrink-0"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {/* Formulario obra (alta/edición) */}
        <div className="px-6 py-4 border-b border-edge bg-surface-2/40">
          {editId ? (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-4"><input className={inpErr('nombre')} value={draft.nombre || ''} onChange={e => setCampo('nombre', e.target.value)} placeholder="Nombre de la obra *" autoFocus /><Requerido k="nombre" /></div>
                <select className={`${input} col-span-2`} value={draft.estado} onChange={e => setDraft(d => ({ ...d, estado: e.target.value as Obra['estado'] }))}>
                  <option value="activa" className="bg-surface">Activa</option>
                  <option value="pausada" className="bg-surface">Pausada</option>
                  <option value="finalizada" className="bg-surface">Finalizada</option>
                </select>
                <div className="col-span-3"><input className={inpErr('responsable')} value={draft.responsable || ''} onChange={e => setCampo('responsable', e.target.value)} placeholder="Responsable *" /><Requerido k="responsable" /></div>
                <div className="col-span-3"><input className={inpErr('telefono')} value={draft.telefono || ''} onChange={e => setCampo('telefono', e.target.value)} placeholder="Teléfono del responsable *" /><Requerido k="telefono" /></div>
              </div>

              <div>
                <AddressAutocomplete value={busqueda} onChange={setBusqueda} onSelect={fillUbicacion} placeholder="Buscar dirección de la obra…" />
                <p className="text-[11px] text-mute mt-1">Elige una sugerencia y se llenan los campos.</p>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-4"><input className={inpErr('calle')} value={draft.calle || ''} onChange={e => setCampo('calle', e.target.value)} placeholder="Calle *" /><Requerido k="calle" /></div>
                <div className="col-span-1"><input className={input} value={draft.numero_exterior || ''} onChange={e => setCampo('numero_exterior', e.target.value)} placeholder="Ext" /></div>
                <div className="col-span-1"><input className={input} value={draft.numero_interior || ''} onChange={e => setCampo('numero_interior', e.target.value)} placeholder="Int" /></div>
                <div className="col-span-4"><input className={inpErr('colonia')} value={draft.colonia || ''} onChange={e => setCampo('colonia', e.target.value)} placeholder="Colonia *" /><Requerido k="colonia" /></div>
                <div className="col-span-2"><input className={inpErr('codigo_postal')} value={draft.codigo_postal || ''} onChange={e => setCampo('codigo_postal', e.target.value)} placeholder="C.P. *" inputMode="numeric" /><Requerido k="codigo_postal" /></div>
                <div className="col-span-3"><input className={inpErr('municipio')} value={draft.municipio || ''} onChange={e => setCampo('municipio', e.target.value)} placeholder="Municipio *" /><Requerido k="municipio" /></div>
                <div className="col-span-3"><input className={inpErr('entidad')} value={draft.entidad || ''} onChange={e => setCampo('entidad', e.target.value)} placeholder="Estado *" /><Requerido k="entidad" /></div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setEditId(null)} className="px-4 py-2 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
                <button onClick={saveDraft} className="flex-1 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">{editId === 'new' ? 'Agregar obra' : 'Guardar'}</button>
              </div>
            </div>
          ) : (
            <button onClick={startNew} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 active:scale-[0.99] transition-[transform,opacity] duration-150">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              Agregar obra
            </button>
          )}
        </div>

        {/* Lista de obras */}
        <div className="flex-1 overflow-y-auto divide-y divide-edge">
          {loading && <p className="text-sm text-mute py-10 text-center">Cargando…</p>}
          {!loading && obras.length === 0 && <p className="text-sm text-mute py-10 text-center">Esta empresa aún no tiene obras.</p>}
          {obras.map(o => (
            <div key={o.id} className="flex items-center gap-3 px-6 py-3.5 hover:bg-surface-2 transition-colors group">
              <span className="w-9 h-9 rounded-lg bg-surface-2 text-mute flex items-center justify-center shrink-0">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path d="M3 21h18M6 21V8l6-4 6 4v13" /><path d="M9 21v-5h6v5" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-ink truncate">{o.nombre}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase ${obraEstadoStyle[o.estado]}`}>{o.estado}</span>
                </div>
                <p className="text-xs text-mute truncate">{[o.ubicacion, o.responsable, o.telefono].filter(Boolean).join(' · ') || 'Sin detalles'}</p>
              </div>
              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => startEdit(o)} className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold transition-colors flex items-center justify-center"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                <button onClick={() => delObra(o)} className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   PERFIL DE USUARIO
════════════════════════════════════════ */
type Perfil = {
  username?: string
  email?: string
  first_name?: string
  last_name?: string
  is_staff?: boolean
  groups?: string[]
  puede?: Capacidades
  telefono?: string
  puesto?: string
  bio?: string
  avatar_url?: string | null
}

/* ════════════════════════════════════════
   REFACCIONES
════════════════════════════════════════ */
function VenderRefaccionModal({ refaccion, notify, onClose, onSold }: {
  refaccion: Refaccion; notify: (m: string, t?: 'ok' | 'err') => void; onClose: () => void; onSold: (ventaId: number) => void
}) {
  const [cant, setCant] = useState('1')
  const [cliente, setCliente] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [busy, setBusy] = useState(false)
  const cantN = Math.max(1, Number(cant) || 1)
  // Ventas: el IVA (16%) se suma SIEMPRE. El toggle de factura solo va a la bandeja.
  const total = (Number(refaccion.precio_venta) || 0) * cantN
  const ivaRef = Math.round(total * 0.16 * 100) / 100
  const totalConIva = total + ivaRef

  function submit() {
    if (cantN > refaccion.stock) { notify(`Solo hay ${refaccion.stock} en stock`, 'err'); return }
    const errFactura = validarFactura(requiereFactura, '', factura)
    if (errFactura) { notify(errFactura, 'err'); return }
    setBusy(true)
    api.post('/ventas/mostrador/', { nombre_cliente: cliente.trim(), metodo_pago: metodo, items: [{ refaccion_id: refaccion.id, cantidad: cantN }], requiere_factura: requiereFactura, factura })
      .then(res => { notify('Venta registrada'); const id = res.data?.venta?.id; if (id) onSold(id); else onClose() })
      .catch(err => notify(err?.response?.data?.detalle || 'Error al vender', 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-edge rounded-3xl p-6 max-w-sm w-full shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        <h3 className="font-black text-ink mb-1">Vender refacción</h3>
        <p className="text-xs text-mute mb-5">{refaccion.nombre} · stock {refaccion.stock} · <span className="font-mono">{refaccion.codigo_barras}</span></p>
        <div className="space-y-3">
          <div><label className={label}>Cantidad</label><input type="number" min={1} max={refaccion.stock} className={input} value={cant} onChange={e => setCant(e.target.value)} /></div>
          <div><label className={label}>Cliente (opcional)</label><input className={input} value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del comprador" /></div>
          <div>
            <label className={label}>Método de pago</label>
            <select className={input} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
              <option value="efectivo" className="bg-surface">Efectivo</option>
              <option value="tarjeta" className="bg-surface">Tarjeta</option>
              <option value="transferencia" className="bg-surface">Transferencia</option>
            </select>
          </div>
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-mute"><span>Precio (sin IVA)</span><span>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaRef.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total con IVA</span><span className="text-lg font-black text-price">${totalConIva.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
          </div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} />
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">Registrar venta</button>
        </div>
      </div>
    </div>
  )
}

function RefaccionesAdmin({ refacciones, reload, notify }: {
  refacciones: Refaccion[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const empty = { nombre: '', descripcion: '', precio_venta: '', stock: '0', stock_minimo: '0', para_venta: false, ubicacion: '', codigo_barras: '' }
  const [q, setQ] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Refaccion | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<any>(empty)
  const [labelRef, setLabelRef] = useState<Refaccion | null>(null)
  const [sellRef, setSellRef] = useState<Refaccion | null>(null)
  const [ticketVentaId, setTicketVentaId] = useState<number | null>(null)

  const filtradas = refacciones.filter(r => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${r.nombre} ${r.codigo_barras} ${r.descripcion || ''}`.toLowerCase().includes(t)
  })
  const bajoStock = refacciones.filter(r => r.bajo_stock).length
  const paraVenta = refacciones.filter(r => r.para_venta).length
  const valorInv = refacciones.reduce((a, r) => a + num(r.precio_venta) * num(r.stock), 0)

  function openNew() { setEditing(null); setForm(empty); setFormOpen(true) }
  function openEdit(r: Refaccion) {
    setEditing(r)
    setForm({ nombre: r.nombre, descripcion: r.descripcion || '', precio_venta: r.precio_venta, stock: String(r.stock), stock_minimo: String(r.stock_minimo), para_venta: r.para_venta, ubicacion: r.ubicacion || '', codigo_barras: r.codigo_barras || '' })
    setFormOpen(true)
  }

  function save() {
    if (!form.nombre.trim()) { notify('El nombre es obligatorio', 'err'); return }
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(), descripcion: (form.descripcion || '').trim(),
      precio_venta: num(form.precio_venta), stock: num(form.stock), stock_minimo: num(form.stock_minimo),
      para_venta: !!form.para_venta, ubicacion: (form.ubicacion || '').trim(),
      codigo_barras: (form.codigo_barras || '').trim(),
    }
    const req = editing ? api.patch(`/refacciones/${editing.id}/`, payload) : api.post('/refacciones/', payload)
    req.then(() => { notify(editing ? 'Refacción actualizada' : 'Refacción agregada'); setFormOpen(false); reload() })
      .catch(err => notify(err?.response?.data?.codigo_barras?.[0] || err?.response?.data?.detalle || 'Error al guardar', 'err'))
      .finally(() => setSaving(false))
  }

  function del(r: Refaccion) {
    if (!confirm(`¿Eliminar "${r.nombre}"?`)) return
    api.delete(`/refacciones/${r.id}/`)
      .then(() => { notify('Refacción eliminada'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'No se pudo eliminar (¿en una venta?)', 'err'))
  }

  return (
    <div className="space-y-4">
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Refacciones', value: String(refacciones.length), tone: 'default' },
          { label: 'Bajo stock', value: String(bajoStock), tone: 'danger', emphasis: bajoStock > 0 },
          { label: 'Para venta', value: String(paraVenta), tone: 'gold' },
          { label: 'Valor inventario', value: `$${valorInv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, tone: 'default' },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-edge flex-wrap">
          <h3 className="font-bold text-ink shrink-0">Refacciones <span className="text-mute font-normal">({filtradas.length})</span></h3>
          <div className="flex-1" />
          <div className="relative w-full sm:w-64">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre o código…" className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={openNew} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">Nueva refacción</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Refacción</th>
                <th className="font-semibold px-3 py-3">Código de barras</th>
                <th className="font-semibold px-3 py-3">Precio</th>
                <th className="font-semibold px-3 py-3">Stock</th>
                <th className="font-semibold px-3 py-3">Uso</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtradas.map(r => (
                <tr key={r.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-ink">{r.nombre}</p>
                    {r.ubicacion && <p className="text-[11px] text-mute">{r.ubicacion}</p>}
                  </td>
                  <td className="px-3 py-3 font-mono text-[13px] text-mute whitespace-nowrap">{r.codigo_barras}</td>
                  <td className="px-3 py-3 text-sm font-bold text-price whitespace-nowrap">${num(r.precio_venta).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`text-sm font-bold ${r.bajo_stock ? 'text-red-500' : 'text-ink'}`}>{r.stock}</span>
                    {r.bajo_stock && <span className="ml-2 text-[10px] font-bold uppercase text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">Bajo</span>}
                  </td>
                  <td className="px-3 py-3">
                    {r.para_venta
                      ? <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-gold-soft text-gold whitespace-nowrap">Venta + Mant.</span>
                      : <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-surface-2 text-mute whitespace-nowrap">Mantenimiento</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => (r.stock > 0 ? setSellRef(r) : notify('Sin stock', 'err'))} title="Vender al público" className="h-8 px-3 rounded-lg border border-emerald-500/30 text-emerald-500 text-xs font-semibold hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="12" cy="12" r="2.2" /></svg>
                        Vender
                      </button>
                      <button onClick={() => setLabelRef(r)} title="Imprimir etiqueta de código de barras" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7v10M7 7v10M9.5 7v10M12.5 7v10M15 7v10M17.5 7v10M20 7v10" /></svg>
                      </button>
                      <button onClick={() => openEdit(r)} title="Editar" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button onClick={() => del(r)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length === 0 && <p className="text-sm text-mute py-14 text-center">{q ? 'Sin resultados.' : 'Sin refacciones. Agrega la primera con “Nueva refacción”.'}</p>}
        </div>
      </Card>

      {formOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={() => setFormOpen(false)}>
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
          >
            <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0">
              <h2 className="font-bold text-ink">{editing ? 'Editar refacción' : 'Nueva refacción'}</h2>
              <button onClick={() => setFormOpen(false)} className="text-mute hover:text-ink p-1" aria-label="Cerrar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div><label className={label}>Nombre *</label><input className={input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Filtro de aceite" autoFocus /></div>
              <div><label className={label}>Descripción</label><textarea className={`${input} resize-none`} rows={2} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Detalle / compatibilidad" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Precio de venta{(form as any).condicion === 'seminueva' && <span className="text-mute font-normal"> · interno, el cliente NO lo ve</span>}</label><input type="number" className={input} value={form.precio_venta} onChange={e => setForm({ ...form, precio_venta: e.target.value })} placeholder="0.00" /></div>
                <div><label className={label}>Ubicación (taller)</label><input className={input} value={form.ubicacion} onChange={e => setForm({ ...form, ubicacion: e.target.value })} placeholder="Estante / caja" /></div>
                <div><label className={label}>Stock</label><input type="number" min={0} className={input} value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></div>
                <div><label className={label}>Stock mínimo (alerta)</label><input type="number" min={0} className={input} value={form.stock_minimo} onChange={e => setForm({ ...form, stock_minimo: e.target.value })} /></div>
              </div>
              <div>
                <label className={label}>Código de barras</label>
                <input className={`${input} font-mono`} value={form.codigo_barras} onChange={e => setForm({ ...form, codigo_barras: e.target.value })} placeholder="Escanéalo o déjalo vacío" />
                <p className="text-[11px] text-mute mt-1.5">Si la refacción ya trae código, escríbelo o escanéalo. Si lo dejas <b>vacío</b>, el sistema genera uno único automáticamente.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.para_venta}
                onClick={() => setForm({ ...form, para_venta: !form.para_venta })}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge cursor-pointer hover:bg-surface-2 transition-colors text-left"
              >
                <span className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${form.para_venta ? 'bg-gold' : 'bg-surface-2 border border-edge'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.para_venta ? 'translate-x-5' : ''}`} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">También se vende al público</span>
                  <span className="block text-[11px] text-mute">Por defecto las refacciones son solo para mantenimiento.</span>
                </span>
              </button>
            </div>
            <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
              <button onClick={() => setFormOpen(false)} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                {editing ? 'Guardar' : 'Agregar'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {labelRef && <EtiquetaModal refaccion={labelRef} onClose={() => setLabelRef(null)} />}
      {sellRef && <VenderRefaccionModal refaccion={sellRef} notify={notify} onClose={() => setSellRef(null)} onSold={(id) => { setSellRef(null); reload(); setTicketVentaId(id) }} />}
      {ticketVentaId && <TicketModal url={`/ventas/${ticketVentaId}/comprobante/`} onClose={() => setTicketVentaId(null)} />}
    </div>
  )
}

/* ════════════════════════════════════════
   REPARACIONES — Órdenes de servicio
════════════════════════════════════════ */
const OR_ESTADOS: { key: OrdenReparacion['estado']; label: string; cls: string; dot: string }[] = [
  { key: 'recibida', label: 'Recibida', cls: 'bg-blue-500/10 text-blue-500', dot: '#2B5FAD' },
  { key: 'proceso', label: 'En proceso', cls: 'bg-gold-soft text-gold', dot: '#B8872E' },
  { key: 'terminada', label: 'Terminada', cls: 'bg-emerald-500/10 text-emerald-500', dot: '#1F7A4D' },
  { key: 'entregada', label: 'Entregada', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
]
const orEstadoMeta = (e: string) => OR_ESTADOS.find(x => x.key === e) || OR_ESTADOS[0]
const orMoney = formatMoney
// Una MÁQUINA PROPIA no se "recibe" ni se "entrega": sus estados son internos y su
// total es un COSTO (no un cobro). Estas ayudas diferencian el flujo por tipo.
const OR_LABEL_INTERNA: Record<string, string> = { recibida: 'Abierta', proceso: 'En reparación', terminada: 'Terminada', entregada: 'Terminada' }
const orLabel = (e: string, tipo?: string) => tipo === 'interna' ? (OR_LABEL_INTERNA[e] || e) : (OR_ESTADOS.find(x => x.key === e)?.label || e)
const orPasos = (tipo?: string) => tipo === 'interna' ? OR_ESTADOS.filter(x => x.key !== 'entregada') : OR_ESTADOS
const esFinal = (o: { tipo: string; estado: string }) => o.tipo === 'interna' ? o.estado === 'terminada' : o.estado === 'entregada'

function ReparacionesAdmin({ ordenes, refacciones, unidades, empresas, reload, notify, abrirId, onAbierto }: {
  ordenes: OrdenReparacion[]; refacciones: Refaccion[]; unidades: Unidad[]; empresas: Empresa[]
  reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
  abrirId?: number | null; onAbierto?: () => void
}) {
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todas' | OrdenReparacion['estado']>('todas')
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [detalle, setDetalle] = useState<OrdenReparacion | null>(null)
  const [carta, setCarta] = useState<OrdenReparacion | null>(null)

  // Apertura automática de una orden (p.ej. recién creada desde Inventario)
  useEffect(() => {
    if (!abrirId) return
    const found = ordenes.find(o => o.id === abrirId)
    if (found) { setDetalle(found); onAbierto?.() }
    else { api.get<OrdenReparacion>(`/reparaciones/${abrirId}/`).then(r => setDetalle(r.data)).catch(() => {}).finally(() => onAbierto?.()) }
  }, [abrirId, ordenes, onAbierto])

  const abiertas = ordenes.filter(o => !esFinal(o)).length
  // Facturado = solo lo que se cobra a CLIENTES; las internas son costo, no ingreso.
  const facturado = ordenes.filter(o => o.tipo !== 'interna' && o.estado === 'entregada').reduce((a, o) => a + (Number(o.total) || 0), 0)
  const costoInterno = ordenes.filter(o => o.tipo === 'interna' && o.estado === 'terminada').reduce((a, o) => a + (Number(o.total) || 0), 0)

  const filtradas = ordenes.filter(o => {
    if (filtro !== 'todas' && o.estado !== filtro) return false
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${o.folio} ${o.cliente_display} ${o.equipo_display} ${o.empresa_nombre || ''}`.toLowerCase().includes(t)
  })

  const fechaCorta = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—')

  return (
    <div className="space-y-4">
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Órdenes totales', value: String(ordenes.length), tone: 'default' },
          { label: 'Abiertas', value: String(abiertas), tone: 'gold', emphasis: abiertas > 0 },
          { label: 'Facturado (clientes)', value: orMoney(facturado), tone: 'default' },
          { label: 'Costo interno', value: orMoney(costoInterno), tone: 'default' },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-edge flex-wrap">
          <h3 className="font-bold text-ink shrink-0">Órdenes de reparación <span className="text-mute font-normal">({filtradas.length})</span></h3>
          <div className="flex-1" />
          <div className="relative w-full sm:w-64">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio, cliente o equipo…" className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={() => setNuevaOpen(true)} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">Nueva orden</span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge flex-wrap">
          {([['todas', 'Todas'], ...OR_ESTADOS.map(e => [e.key, e.label] as const)] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setFiltro(k as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filtro === k ? 'bg-ink text-surface' : 'bg-surface-2 text-mute hover:text-ink'}`}>
              {lbl}{k !== 'todas' && <span className="ml-1.5 opacity-70">{ordenes.filter(o => o.estado === k).length}</span>}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Folio</th>
                <th className="font-semibold px-3 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Equipo</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Recibida</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtradas.map(o => {
                const m = orEstadoMeta(o.estado)
                return (
                  <tr key={o.id} className="hover:bg-surface-2 transition-colors cursor-pointer" onClick={() => setDetalle(o)}>
                    <td className="px-5 py-3 font-mono text-[13px] font-bold text-ink whitespace-nowrap">{o.folio}</td>
                    <td className="px-3 py-3">
                      {o.tipo === 'interna'
                        ? <p className="text-sm font-medium text-mute italic">Máquina propia</p>
                        : <>
                          <p className="text-sm font-semibold text-ink">{o.cliente_display}</p>
                          {o.cliente_telefono && <p className="text-[11px] text-mute">{o.cliente_telefono}</p>}
                        </>}
                    </td>
                    <td className="px-3 py-3 text-sm text-ink max-w-[220px] truncate">{o.equipo_display}</td>
                    <td className="px-3 py-3"><span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{orLabel(o.estado, o.tipo)}</span></td>
                    <td className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap">{orMoney(o.total)}</td>
                    <td className="px-3 py-3 text-[13px] text-mute whitespace-nowrap">{fechaCorta(o.fecha_recibida)}</td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setDetalle(o)} className="h-8 px-3 rounded-lg border border-edge text-mute text-xs font-semibold hover:text-ink hover:border-gold/40 transition-colors">Abrir</button>
                        <button onClick={() => setCarta(o)} title="Imprimir orden (Carta)" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path d="M6 9V4h12v5M6 18H4v-6a2 2 0 012-2h12a2 2 0 012 2v6h-2M8 14h8v6H8z" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtradas.length === 0 && <p className="text-sm text-mute py-14 text-center">{q || filtro !== 'todas' ? 'Sin órdenes con ese criterio.' : 'Aún no hay órdenes. Crea la primera con “Nueva orden”.'}</p>}
        </div>
      </Card>

      {nuevaOpen && (
        <NuevaOrdenModal
          empresas={empresas} unidades={unidades} notify={notify}
          onClose={() => setNuevaOpen(false)}
          onCreated={(o) => { setNuevaOpen(false); reload(); setDetalle(o) }}
        />
      )}
      {detalle && (
        <OrdenDetalleModal
          orden={detalle} refacciones={refacciones} notify={notify}
          onClose={() => setDetalle(null)}
          onChanged={reload}
          onPrint={(o) => setCarta(o)}
        />
      )}
      {carta && <OrdenCartaModal orden={carta} onClose={() => setCarta(null)} />}
    </div>
  )
}

function NuevaOrdenModal({ empresas, unidades, notify, onClose, onCreated }: {
  empresas: Empresa[]; unidades: Unidad[]; notify: (m: string, t?: 'ok' | 'err') => void
  onClose: () => void; onCreated: (o: OrdenReparacion) => void
}) {
  const [tipo, setTipo] = useState<'cliente' | 'interna'>('cliente')
  const [form, setForm] = useState({ cliente_nombre: '', cliente_telefono: '', empresa: '', unidad: '', equipo_descripcion: '', numero_serie: '', diagnostico: '' })
  const [saving, setSaving] = useState(false)

  function crear() {
    if (tipo === 'cliente' && !form.cliente_nombre.trim() && !form.empresa) { notify('Indica el nombre del cliente o la empresa', 'err'); return }
    if (tipo === 'cliente' && !form.equipo_descripcion.trim()) { notify('Describe el equipo del cliente', 'err'); return }
    if (tipo === 'interna' && !form.unidad) { notify('Selecciona la unidad propia', 'err'); return }
    setSaving(true)
    const payload: any = { tipo, diagnostico: form.diagnostico.trim() }
    if (tipo === 'interna') {
      payload.unidad = Number(form.unidad)
    } else {
      payload.cliente_nombre = form.cliente_nombre.trim()
      payload.cliente_telefono = form.cliente_telefono.trim()
      payload.equipo_descripcion = form.equipo_descripcion.trim()
      payload.numero_serie = form.numero_serie.trim()
      if (form.empresa) payload.empresa = Number(form.empresa)
    }
    api.post<OrdenReparacion>('/reparaciones/', payload)
      .then(r => { notify(`Orden ${r.data.folio} creada`); onCreated(r.data) })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo crear la orden', 'err'))
      .finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <h2 className="font-bold text-ink">Nueva orden de reparación</h2>
          <button onClick={onClose} className="text-mute hover:text-ink p-1" aria-label="Cerrar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTipo('cliente')} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${tipo === 'cliente' ? 'border-gold bg-gold-soft text-gold' : 'border-edge text-mute hover:text-ink'}`}>Equipo de cliente</button>
            <button onClick={() => setTipo('interna')} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${tipo === 'interna' ? 'border-gold bg-gold-soft text-gold' : 'border-edge text-mute hover:text-ink'}`}>Máquina propia</button>
          </div>

          {tipo === 'cliente' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Cliente</label><input className={input} value={form.cliente_nombre} onChange={e => setForm({ ...form, cliente_nombre: e.target.value })} placeholder="Nombre del cliente" autoFocus /></div>
                <div><label className={label}>Teléfono</label><input className={input} value={form.cliente_telefono} onChange={e => setForm({ ...form, cliente_telefono: e.target.value })} placeholder="Opcional" /></div>
              </div>
              <div>
                <label className={label}>Empresa (opcional)</label>
                <select className={input} value={form.empresa} onChange={e => setForm({ ...form, empresa: e.target.value })}>
                  <option value="">— Cliente particular —</option>
                  {empresasActivas(empresas).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={label}>Equipo del cliente *</label><input className={input} value={form.equipo_descripcion} onChange={e => setForm({ ...form, equipo_descripcion: e.target.value })} placeholder="Ej. Compresor Truper 100L" /></div>
                <div className="col-span-2"><label className={label}>Número de serie</label><input className={input} value={form.numero_serie} onChange={e => setForm({ ...form, numero_serie: e.target.value })} placeholder="Opcional" /></div>
              </div>
            </>
          ) : (
            <div>
              <label className={label}>Unidad propia *</label>
              <select className={input} value={form.unidad} onChange={e => setForm({ ...form, unidad: e.target.value })} autoFocus>
                <option value="">— Selecciona una unidad —</option>
                {/* Solo máquinas de RENTA (seminuevas). Las nuevas se venden, no se reparan aquí. */}
                {unidades.filter(u => (u.equipo_info?.modo ?? (u.condicion === 'seminueva' ? 'renta' : 'venta')) === 'renta').map(u => <option key={u.id} value={u.id}>{u.codigo} · {u.equipo_modelo || u.equipo_info?.modelo || ''}</option>)}
              </select>
              <p className="text-[11px] text-mute mt-1.5">Solo máquinas de <b>renta</b> (las nuevas se venden, no se reparan aquí). No requiere datos de cliente.</p>
            </div>
          )}

          <div><label className={label}>Falla reportada / diagnóstico inicial</label><textarea className={`${input} resize-none`} rows={3} value={form.diagnostico} onChange={e => setForm({ ...form, diagnostico: e.target.value })} placeholder="Qué reporta el cliente / síntomas" /></div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={crear} disabled={saving} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
            Crear orden
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function OrdenDetalleModal({ orden, refacciones, notify, onClose, onChanged, onPrint }: {
  orden: OrdenReparacion; refacciones: Refaccion[]; notify: (m: string, t?: 'ok' | 'err') => void
  onClose: () => void; onChanged: () => void; onPrint: (o: OrdenReparacion) => void
}) {
  const [o, setO] = useState<OrdenReparacion>(orden)
  const [trabajo, setTrabajo] = useState(orden.trabajo_realizado || '')
  const [diag, setDiag] = useState(orden.diagnostico || '')
  const [mano, setMano] = useState(String(Number(orden.costo_mano_obra) || 0))
  const [notas, setNotas] = useState(orden.notas || '')
  const [savingInfo, setSavingInfo] = useState(false)
  const [busy, setBusy] = useState(false)

  // Alta de refacción
  const [origen, setOrigen] = useState<'stock' | 'externa'>('stock')
  const [refId, setRefId] = useState('')
  const [extNombre, setExtNombre] = useState('')
  const [extCosto, setExtCosto] = useState('')
  const [cant, setCant] = useState('1')

  const disponibles = refacciones.filter(r => r.stock > 0)

  function apply(nuevo: OrdenReparacion) { setO(nuevo); onChanged() }

  function guardarInfo() {
    setSavingInfo(true)
    api.patch<OrdenReparacion>(`/reparaciones/${o.id}/`, {
      diagnostico: diag, trabajo_realizado: trabajo, costo_mano_obra: Number(mano) || 0, notas,
    })
      .then(r => { apply(r.data); notify('Orden actualizada') })
      .catch(() => notify('No se pudo guardar', 'err'))
      .finally(() => setSavingInfo(false))
  }

  function cambiarEstado(estado: OrdenReparacion['estado']) {
    api.patch<OrdenReparacion>(`/reparaciones/${o.id}/`, { estado })
      .then(r => { apply(r.data); notify(`Estado: ${orLabel(estado, o.tipo)}`) })
      .catch(() => notify('No se pudo cambiar el estado', 'err'))
  }

  function agregarItem() {
    const c = Math.max(1, Number(cant) || 1)
    if (origen === 'stock') {
      if (!refId) { notify('Selecciona una refacción del inventario', 'err'); return }
    } else if (!extNombre.trim()) { notify('Escribe el nombre de la pieza', 'err'); return }
    setBusy(true)
    const payload: any = origen === 'stock'
      ? { origen: 'stock', refaccion_id: Number(refId), cantidad: c }
      : { origen: 'externa', nombre: extNombre.trim(), costo_unitario: Number(extCosto) || 0, cantidad: c }
    api.post<OrdenReparacion>(`/reparaciones/${o.id}/items/`, payload)
      .then(r => { apply(r.data); setRefId(''); setExtNombre(''); setExtCosto(''); setCant('1'); notify('Refacción agregada') })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo agregar', 'err'))
      .finally(() => setBusy(false))
  }

  function quitarItem(itemId: number) {
    api.delete<OrdenReparacion>(`/reparaciones/${o.id}/items/${itemId}/`)
      .then(r => { apply(r.data); notify('Refacción quitada') })
      .catch(() => notify('No se pudo quitar', 'err'))
  }

  const pasos = orPasos(o.tipo)
  const curIdx = pasos.findIndex(e => e.key === o.estado)
  const totalOrden = (Number(o.total_refacciones) || 0) + (Number(mano) || 0)
  const inp = 'w-full border border-edge rounded-[9px] px-[13px] py-[11px] text-[13px] bg-surface-2 text-ink placeholder-mute focus:outline-none focus:border-gold focus:bg-surface transition-colors'
  const inpSide = 'w-full border border-edge rounded-[9px] px-[13px] py-[11px] text-[13.5px] bg-surface text-ink placeholder-mute focus:outline-none focus:border-gold transition-colors'
  const capLabel = 'text-[11px] font-bold tracking-[0.5px] text-mute'

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-0 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-full sm:max-w-[1080px] bg-surface rounded-none sm:rounded-[18px] shadow-[0_24px_60px_rgba(33,29,22,0.2)] min-h-screen sm:min-h-0 sm:my-auto sm:max-h-[92vh] flex flex-col overflow-hidden border-0 sm:border border-edge">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-7 pt-[22px] pb-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-mono text-[18px] font-extrabold text-ink">{o.folio}</span>
            <span className="text-[12.5px] text-mute truncate">{o.equipo_display}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {/* Stepper */}
        <div className="px-7 pb-5 border-b border-edge flex items-center overflow-x-auto shrink-0">
          {pasos.map((e, i) => {
            const done = i <= curIdx
            return (
              <div key={e.key} className="flex items-center flex-none">
                <button onClick={() => cambiarEstado(e.key)} className="flex items-center gap-2 flex-none group">
                  <span className={`w-[22px] h-[22px] rounded-full border-[1.5px] text-[11px] font-extrabold flex items-center justify-center transition-colors ${done ? 'bg-ink border-ink text-surface' : 'bg-surface border-edge text-mute group-hover:border-ink'}`}>{i + 1}</span>
                  <span className={`text-[12.5px] font-bold whitespace-nowrap transition-colors ${done ? 'text-ink' : 'text-mute group-hover:text-ink'}`}>{orLabel(e.key, o.tipo)}</span>
                </button>
                {i < pasos.length - 1 && <div className={`h-[1.5px] w-[60px] mx-2.5 shrink-0 ${i < curIdx ? 'bg-ink' : 'bg-edge'}`} />}
              </div>
            )
          })}
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto flex flex-col md:flex-row">
          {/* Columna principal */}
          <div className="flex-1 p-[26px] md:border-r border-edge min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-5">
              <div>
                <div className={`${capLabel} mb-2`}>FALLA REPORTADA / DIAGNÓSTICO</div>
                <textarea value={diag} onChange={e => setDiag(e.target.value)} className={`${inp} min-h-[72px] resize-y`} />
              </div>
              <div>
                <div className={`${capLabel} mb-2`}>TRABAJO REALIZADO</div>
                <textarea value={trabajo} onChange={e => setTrabajo(e.target.value)} placeholder="Describe lo que se le hizo al equipo" className={`${inp} min-h-[72px] resize-y`} />
              </div>
            </div>

            <div className={`${capLabel} mb-2`}>REFACCIONES Y MATERIALES</div>
            {o.items.length === 0 ? (
              <div className="border border-edge rounded-[9px] px-4 py-3.5 text-center text-[13px] text-mute bg-surface-2 mb-2.5">Sin refacciones. Agrega del inventario o compradas aparte.</div>
            ) : (
              <div className="border border-edge rounded-[9px] overflow-hidden mb-2.5">
                {o.items.map(it => (
                  <div key={it.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-edge last:border-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${it.origen === 'stock' ? 'bg-blue-500/10 text-blue-500' : 'bg-amber-500/10 text-amber-600'}`}>{it.origen === 'stock' ? 'Inventario' : 'Aparte'}</span>
                    <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-ink truncate">{it.nombre}</p><p className="text-[11px] text-mute">{it.cantidad} × {orMoney(it.costo_unitario)}</p></div>
                    <span className="text-[13px] font-bold text-ink whitespace-nowrap">{orMoney(it.subtotal)}</span>
                    <button onClick={() => quitarItem(it.id)} title="Quitar" className="w-7 h-7 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center shrink-0"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                  </div>
                ))}
              </div>
            )}

            {/* Agregar refacción */}
            <div className="border border-edge rounded-[9px] p-[13px]">
              <div className="flex gap-2 mb-2.5">
                <button onClick={() => setOrigen('stock')} className={`flex-1 py-[9px] rounded-[7px] text-[13px] font-bold border-[1.5px] transition-colors ${origen === 'stock' ? 'border-gold text-gold bg-gold-soft' : 'border-edge text-ink hover:bg-surface-2'}`}>Del inventario</button>
                <button onClick={() => setOrigen('externa')} className={`flex-1 py-[9px] rounded-[7px] text-[13px] font-bold border-[1.5px] transition-colors ${origen === 'externa' ? 'border-gold text-gold bg-gold-soft' : 'border-edge text-ink hover:bg-surface-2'}`}>Comprada / pedida aparte</button>
              </div>
              {origen === 'stock' ? (
                <div className="flex gap-2 mb-2.5">
                  <select value={refId} onChange={e => setRefId(e.target.value)} className="flex-1 border border-edge rounded-[7px] px-[11px] py-[9px] text-[13px] bg-surface-2 text-ink focus:outline-none focus:border-gold">
                    <option value="">Selecciona una refacción…</option>
                    {disponibles.map(r => <option key={r.id} value={r.id}>{r.nombre} · {orMoney(r.precio_venta)} · stock {r.stock}</option>)}
                  </select>
                  <input type="number" min={1} value={cant} onChange={e => setCant(e.target.value)} title="Cantidad" className="w-[70px] border border-edge rounded-[7px] px-[11px] py-[9px] text-[13px] bg-surface-2 text-ink text-center focus:outline-none focus:border-gold" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 mb-2.5">
                  <input value={extNombre} onChange={e => setExtNombre(e.target.value)} placeholder="Nombre de la pieza (pedida aparte)" className="border border-edge rounded-[7px] px-[11px] py-[9px] text-[13px] bg-surface-2 text-ink placeholder-mute focus:outline-none focus:border-gold" />
                  <input type="number" value={extCosto} onChange={e => setExtCosto(e.target.value)} placeholder="Costo c/u" className="sm:w-28 border border-edge rounded-[7px] px-[11px] py-[9px] text-[13px] bg-surface-2 text-ink placeholder-mute focus:outline-none focus:border-gold" />
                  <input type="number" min={1} value={cant} onChange={e => setCant(e.target.value)} title="Cantidad" className="sm:w-[70px] border border-edge rounded-[7px] px-[11px] py-[9px] text-[13px] bg-surface-2 text-ink text-center focus:outline-none focus:border-gold" />
                </div>
              )}
              <button onClick={agregarItem} disabled={busy} className="w-full py-2.5 rounded-[7px] border border-dashed border-edge text-mute font-bold text-[13px] hover:text-ink hover:border-gold/50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <span className="w-3.5 h-3.5 border-2 border-mute/40 border-t-mute rounded-full animate-spin" /> : '+'} Agregar refacción
              </button>
            </div>
          </div>

          {/* Panel lateral */}
          <div className="md:w-[260px] flex-none p-5 bg-surface-2">
            <div className={`${capLabel} mb-2`}>MANO DE OBRA ($)</div>
            <input type="number" value={mano} onChange={e => setMano(e.target.value)} placeholder="0.00" className={`${inpSide} mb-3.5`} />
            <div className={`${capLabel} mb-2`}>NOTAS INTERNAS</div>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional" className={`${inpSide} mb-5`} />

            <div className={`${capLabel} mb-2.5`}>RESUMEN</div>
            <div className="flex justify-between text-[12.5px] text-mute mb-1.5"><span>Refacciones</span><span>{orMoney(o.total_refacciones)}</span></div>
            <div className="flex justify-between text-[12.5px] text-mute mb-3.5"><span>Mano de obra</span><span>{orMoney(mano)}</span></div>
            <div className="border-t border-edge pt-3 flex justify-between text-[17px] font-extrabold text-ink mb-[18px]"><span>{o.tipo === 'interna' ? 'Costo interno' : 'Total'}</span><span className="text-price">{orMoney(totalOrden)}</span></div>

            <div className="flex flex-col gap-2">
              <button onClick={guardarInfo} disabled={savingInfo} className="py-[11px] rounded-[9px] bg-gold text-white font-bold text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {savingInfo ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
                Guardar cambios
              </button>
              <button onClick={() => onPrint({ ...o, trabajo_realizado: trabajo, diagnostico: diag, notas, costo_mano_obra: String(Number(mano) || 0), total: String(totalOrden) })} className="py-[11px] rounded-[9px] border border-edge text-ink font-bold text-[13.5px] hover:bg-surface transition-colors">
                Imprimir orden (Carta)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ════════════════════════════════════════
   ADEUDOS — cobranza: rentas con saldo pendiente
════════════════════════════════════════ */
type AdeudosDatos = { rentas: RentaFull[]; total: string; clientes: number }

/* La deuda se agrupa por la identidad MÁS FUERTE que tenga la renta: cuenta
   vinculada primero, empresa después, y el nombre de mostrador al final. Así
   un cliente sin cuenta con tres rentas es UNA fila con su total, no tres
   sueltas — que es de lo que se trata "llevar el control de su deuda". */
type GrupoAdeudo = {
  clave: string
  nombre: string
  tipo: 'cuenta' | 'empresa' | 'mostrador'
  telefono: string
  total: number
  rentas: RentaFull[]
}
function agruparAdeudos(rentas: RentaFull[]): GrupoAdeudo[] {
  const mapa = new Map<string, GrupoAdeudo>()
  for (const r of rentas) {
    let clave: string, nombre: string, tipo: GrupoAdeudo['tipo']
    if (r.cuenta) { clave = `u:${r.cuenta.toLowerCase()}`; nombre = r.cuenta; tipo = 'cuenta' }
    else if (r.empresa?.id) { clave = `e:${r.empresa.id}`; nombre = r.empresa.nombre; tipo = 'empresa' }
    else {
      const n = (r.cliente || r.cliente_nombre || '').trim()
      clave = `n:${n.toLowerCase() || r.id}`; nombre = n || 'Sin nombre'; tipo = 'mostrador'
    }
    let g = mapa.get(clave)
    if (!g) { g = { clave, nombre, tipo, telefono: '', total: 0, rentas: [] }; mapa.set(clave, g) }
    g.rentas.push(r)
    g.total += Number(r.saldo || 0)
    if (!g.telefono && r.telefono_cliente) g.telefono = r.telefono_cliente
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total)
}

const TIPO_ADEUDO: Record<GrupoAdeudo['tipo'], { label: string; cls: string }> = {
  cuenta: { label: 'Cuenta', cls: 'bg-gold-soft text-gold' },
  empresa: { label: 'Empresa', cls: 'bg-blue-500/10 text-blue-600' },
  mostrador: { label: 'Sin cuenta', cls: 'bg-surface-2 text-mute' },
}
const CHIP_RENTA_ADEUDO: Record<string, { label: string; cls: string }> = {
  activa: { label: 'ACTIVA', cls: 'bg-blue-500/10 text-blue-600' },
  reservada: { label: 'RESERVADA', cls: 'bg-blue-500/10 text-blue-600' },
  finalizada: { label: 'EQUIPO DEVUELTO', cls: 'bg-surface-2 text-mute' },
}

function AdeudosAdmin({ datos, reload, notify }: {
  datos: AdeudosDatos; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const money = formatMoney
  const [ver, setVer] = useState<RentaFull | null>(null)
  const [abonando, setAbonando] = useState<RentaFull | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  const grupos = useMemo(() => agruparAdeudos(datos.rentas), [datos.rentas])
  const toggle = (clave: string) => setAbiertos(s => {
    const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n
  })

  async function registrarAbono(monto: number, metodo: string, fecha: string) {
    if (!abonando) return
    try {
      await api.post(`/rentas/${abonando.id}/abonos/`, { monto, metodo, fecha: fecha || undefined })
      notify(`Abono de ${money(monto)} registrado`)
      setAbonando(null)
      reload()
    } catch { /* el interceptor avisa */ }
  }

  return (
    <div className="space-y-5">
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-3"
        items={[
          { label: 'Por cobrar', value: money(Number(datos.total)), tone: 'gold' },
          { label: 'Clientes que deben', value: String(grupos.length), tone: 'default' },
          { label: 'Rentas con adeudo', value: String(datos.rentas.length), tone: 'muted' },
        ]}
      />

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-14 text-center">
          <p className="text-[16px] font-bold text-ink">Nadie debe nada</p>
          <p className="text-[13px] text-mute mt-1">Cuando una renta quede con saldo, aparece aquí hasta liquidarse.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(g => {
            const abierto = abiertos.has(g.clave)
            const tipo = TIPO_ADEUDO[g.tipo]
            const inicial = (g.nombre.trim()[0] || '?').toUpperCase()
            return (
              <div key={g.clave} className="rounded-2xl border border-edge bg-surface overflow-hidden">
                {/* Cabecera de la PERSONA: su total de deuda de un vistazo. */}
                <button onClick={() => toggle(g.clave)}
                  className="w-full flex items-center gap-3.5 px-4 sm:px-5 py-4 text-left hover:bg-surface-2/40 transition-colors">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-surface-2 grid place-items-center text-[15px] font-black text-ink">{inicial}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-extrabold text-ink truncate">{g.nombre}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tipo.cls}`}>{tipo.label}</span>
                    </div>
                    <p className="text-[12px] text-mute mt-0.5 truncate">
                      {g.rentas.length} {g.rentas.length === 1 ? 'renta' : 'rentas'} con saldo
                      {g.telefono ? ` · ${g.telefono}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-mute">Debe</p>
                    <p className="text-[19px] font-black text-red-600 dark:text-red-400 tabular-nums leading-tight">{money(g.total)}</p>
                  </div>
                  <svg className={`w-4 h-4 shrink-0 text-mute transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>

                {/* Desglose: cada renta suya, con su acción de abono. */}
                {abierto && (
                  <div className="border-t border-edge divide-y divide-edge">
                    {g.rentas.map(r => {
                      const chip = CHIP_RENTA_ADEUDO[r.estado || ''] || { label: (r.estado || '—').toUpperCase(), cls: 'bg-surface-2 text-mute' }
                      return (
                        <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5 bg-surface-2/30">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13.5px] font-bold text-ink truncate">{r.inventario.equipo || 'Equipo'}</span>
                              <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${chip.cls}`}>{chip.label}</span>
                            </div>
                            <p className="text-[11.5px] font-mono text-mute mt-0.5 truncate">{r.inventario.codigo}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-mute">Pagó {money(Number(r.pagado || 0))} de {money(Number(r.total || 0))}</p>
                            <p className="text-[15px] font-extrabold text-red-600 dark:text-red-400 tabular-nums leading-tight">{money(Number(r.saldo || 0))}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => setAbonando(r)}
                              className="h-8 px-3 rounded-lg bg-gold text-black text-[12px] font-bold hover:brightness-95 transition-all whitespace-nowrap">
                              + Abono
                            </button>
                            <button onClick={() => setVer(r)}
                              className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">
                              Ver
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {abonando && (
        <AbonoModal saldo={Number(abonando.saldo || 0)} onClose={() => setAbonando(null)} onRegistrar={registrarAbono} />
      )}
      {ver && (
        <RentaDetalleModal renta={ver} onClose={() => { setVer(null); reload() }} onTicket={() => abrirOrdenCartaPDF('rentas', ver.id)} />
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   POR FACTURAR — bandeja de solicitudes de factura (CFDI)
════════════════════════════════════════ */
const FORMA_PAGO_LABEL: Record<string, string> = {
  '01': '01 · Efectivo', '02': '02 · Cheque', '03': '03 · Transferencia',
  '04': '04 · Tarjeta de crédito', '28': '28 · Tarjeta de débito', '99': '99 · Por definir',
}
const FACT_ESTADOS: { key: SolicitudFactura['estado']; label: string; cls: string; dot: string }[] = [
  { key: 'pendiente', label: 'Pendiente', cls: 'bg-amber-500/10 text-amber-600', dot: '#B8872E' },
  { key: 'facturada', label: 'Facturada', cls: 'bg-emerald-500/10 text-emerald-600', dot: '#1F7A4D' },
  { key: 'cancelada', label: 'Cancelada', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
]
const factEstadoMeta = (e: string) => FACT_ESTADOS.find(x => x.key === e) || FACT_ESTADOS[0]

function FacturacionAdmin({ solicitudes, reload, notify }: {
  solicitudes: SolicitudFactura[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todas' | SolicitudFactura['estado']>('pendiente')
  const [detalle, setDetalle] = useState<SolicitudFactura | null>(null)

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente')
  const facturadas = solicitudes.filter(s => s.estado === 'facturada')
  const montoPend = pendientes.reduce((a, s) => a + (Number(s.total) || 0), 0)
  const montoFact = facturadas.reduce((a, s) => a + (Number(s.total) || 0), 0)

  const filtradas = solicitudes.filter(s => {
    if (filtro !== 'todas' && s.estado !== filtro) return false
    const t = q.trim().toLowerCase()
    if (!t) return true
    return `${s.folio_origen} ${s.razon_social} ${s.rfc} ${s.uuid} ${s.concepto}`.toLowerCase().includes(t)
  })

  const fechaCorta = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—')

  function exportar() {
    const params: any = {}
    if (filtro !== 'todas') params.estado = filtro
    if (q.trim()) params.q = q.trim()
    api.get('/facturacion/export/', { params, responseType: 'blob' })
      .then(res => {
        const url = URL.createObjectURL(res.data as Blob)
        const a = document.createElement('a'); a.href = url; a.download = 'por_facturar.csv'; a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => notify('No se pudo exportar', 'err'))
  }

  return (
    <div className="space-y-4">
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Pendientes de facturar', value: String(pendientes.length), tone: 'gold', emphasis: pendientes.length > 0 },
          { label: 'Monto pendiente', value: orMoney(montoPend), tone: 'default' },
          { label: 'Facturadas', value: String(facturadas.length), tone: 'default' },
          { label: 'Monto facturado', value: orMoney(montoFact), tone: 'default' },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-edge flex-wrap">
          <h3 className="font-bold text-ink shrink-0">Por facturar <span className="text-mute font-normal">({filtradas.length})</span></h3>
          <div className="flex-1" />
          <div className="relative w-full sm:w-56">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar RFC, cliente, folio…" className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={exportar} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge flex-wrap">
          {([['todas', 'Todas'], ...FACT_ESTADOS.map(e => [e.key, e.label] as const)] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setFiltro(k as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filtro === k ? 'bg-ink text-surface' : 'bg-surface-2 text-mute hover:text-ink'}`}>
              {lbl}{k !== 'todas' && <span className="ml-1.5 opacity-70">{solicitudes.filter(s => s.estado === k).length}</span>}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Origen</th>
                <th className="font-semibold px-3 py-3">Cliente / RFC</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Fecha</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {filtradas.map(s => {
                const m = factEstadoMeta(s.estado)
                return (
                  <tr key={s.id} className="hover:bg-surface-2 transition-colors cursor-pointer" onClick={() => setDetalle(s)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-ink">{s.folio_origen}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-2 text-mute uppercase">{s.tipo}</span>
                      </div>
                      <p className="text-[11px] text-mute truncate max-w-[200px]">{s.concepto}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-sm font-semibold text-ink truncate max-w-[200px]">{s.cliente_display}</p>
                      <p className="text-[11px] text-mute font-mono">{s.rfc || '—'}</p>
                    </td>
                    <td className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap">{orMoney(s.total)}</td>
                    <td className="px-3 py-3 text-[13px] text-mute whitespace-nowrap">{fechaCorta(s.fecha_origen)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
                      {s.estado === 'pendiente' && !s.datos_completos && <p className="text-[10px] text-red-500 mt-1">Datos incompletos</p>}
                    </td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setDetalle(s)} className="h-8 px-3 rounded-lg border border-edge text-mute text-xs font-semibold hover:text-ink hover:border-gold/40 transition-colors">
                        {s.estado === 'pendiente' ? 'Facturar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtradas.length === 0 && <p className="text-sm text-mute py-14 text-center">{q || filtro !== 'todas' ? 'Sin solicitudes con ese criterio.' : 'No hay solicitudes de factura todavía.'}</p>}
        </div>
      </Card>

      {detalle && <SolicitudFacturaModal solicitud={detalle} notify={notify} onClose={() => setDetalle(null)} onChanged={reload} />}
    </div>
  )
}

function SolicitudFacturaModal({ solicitud, notify, onClose, onChanged }: {
  solicitud: SolicitudFactura; notify: (m: string, t?: 'ok' | 'err') => void; onClose: () => void; onChanged: () => void
}) {
  const [s, setS] = useState<SolicitudFactura>(solicitud)
  const [uuid, setUuid] = useState(solicitud.uuid || '')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof SolicitudFactura, v: string) => setS(prev => ({ ...prev, [k]: v }))
  const facturada = s.estado === 'facturada'

  function guardarDatos() {
    setBusy(true)
    api.patch<SolicitudFactura>(`/facturacion/solicitudes/${s.id}/`, {
      rfc: s.rfc, razon_social: s.razon_social, codigo_postal: s.codigo_postal,
      regimen_fiscal: s.regimen_fiscal, uso_cfdi: s.uso_cfdi, email: s.email, forma_pago: s.forma_pago, notas: s.notas,
    })
      .then(r => { setS(r.data); notify('Datos actualizados'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo guardar', 'err'))
      .finally(() => setBusy(false))
  }
  function marcarFacturada() {
    if (!uuid.trim()) { notify('Captura el folio fiscal (UUID)', 'err'); return }
    setBusy(true)
    api.post<SolicitudFactura>(`/facturacion/solicitudes/${s.id}/facturada/`, { uuid: uuid.trim(), notas: s.notas })
      .then(r => { setS(r.data); notify('Marcada como facturada'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'Error', 'err'))
      .finally(() => setBusy(false))
  }
  function reabrir() {
    setBusy(true)
    api.post<SolicitudFactura>(`/facturacion/solicitudes/${s.id}/reabrir/`, {})
      .then(r => { setS(r.data); setUuid(''); notify('Regresada a pendiente'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'Error', 'err'))
      .finally(() => setBusy(false))
  }

  const copiarDatos = () => {
    const txt = [
      `RFC: ${s.rfc}`, `Razón social: ${s.razon_social}`, `CP: ${s.codigo_postal}`,
      `Régimen: ${s.regimen_fiscal}`, `Uso CFDI: ${s.uso_cfdi}`, `Email: ${s.email}`,
      `Subtotal: ${s.subtotal}`, `IVA: ${s.iva}`, `Total: ${s.total}`,
      `Forma de pago: ${s.forma_pago}`, `Concepto: ${s.concepto}`,
    ].join('\n')
    navigator.clipboard?.writeText(txt).then(() => notify('Datos copiados'), () => {})
  }

  const m = factEstadoMeta(s.estado)
  return (
    <div className="modal-in fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[820px] bg-surface border border-edge rounded-2xl overflow-hidden sm:my-auto max-h-[92vh] flex flex-col shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-ink">{s.folio_origen}</span>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
            </div>
            <p className="text-[12px] text-mute mt-0.5">{s.concepto}</p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1 shrink-0"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Importes */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface-2 py-2"><p className="text-[10px] uppercase text-mute">Subtotal</p><p className="text-sm font-bold text-ink">{orMoney(s.subtotal)}</p></div>
            <div className="rounded-lg bg-surface-2 py-2"><p className="text-[10px] uppercase text-mute">IVA 16%</p><p className="text-sm font-bold text-ink">{orMoney(s.iva)}</p></div>
            <div className="rounded-lg bg-gold-soft py-2"><p className="text-[10px] uppercase text-mute">Total</p><p className="text-sm font-extrabold text-price">{orMoney(s.total)}</p></div>
          </div>

          {/* Receptor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gold">Datos del receptor</p>
              <button onClick={copiarDatos} className="text-[11px] text-gold hover:underline">Copiar datos</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={`${input} font-mono`} value={s.rfc} onChange={e => set('rfc', e.target.value.toUpperCase())} placeholder="RFC" disabled={facturada} />
              <input className={input} value={s.codigo_postal} onChange={e => set('codigo_postal', e.target.value)} placeholder="C.P." disabled={facturada} />
              <input className={`${input} col-span-2`} value={s.razon_social} onChange={e => set('razon_social', e.target.value)} placeholder="Razón social" disabled={facturada} />
              <select className={input} value={s.regimen_fiscal} onChange={e => set('regimen_fiscal', e.target.value)} disabled={facturada}>
                <option value="">Régimen fiscal</option>
                {REGIMEN_FISCAL.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
              </select>
              <select className={input} value={s.uso_cfdi} onChange={e => set('uso_cfdi', e.target.value)} disabled={facturada}>
                <option value="">Uso CFDI</option>
                {USO_CFDI.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
              </select>
              <input type="email" className={`${input} col-span-2`} value={s.email} onChange={e => set('email', e.target.value)} placeholder="Email" disabled={facturada} />
              <select className={`${input} col-span-2`} value={s.forma_pago} onChange={e => set('forma_pago', e.target.value)} disabled={facturada}>
                <option value="">Forma de pago (SAT)</option>
                {Object.entries(FORMA_PAGO_LABEL).map(([code, lbl]) => <option key={code} value={code} className="bg-surface">{lbl}</option>)}
              </select>
            </div>
            {!facturada && <button onClick={guardarDatos} disabled={busy} className="mt-2 w-full py-2 rounded-lg border border-edge text-ink text-xs font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50">Guardar datos</button>}
          </div>

          {/* Timbrado */}
          {facturada ? (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
              <p className="text-[11px] uppercase text-mute">Folio fiscal (UUID)</p>
              <p className="text-sm font-mono font-bold text-ink break-all">{s.uuid}</p>
              {s.fecha_timbrado && <p className="text-[11px] text-mute mt-1">Timbrada el {new Date(s.fecha_timbrado).toLocaleString('es-MX')}</p>}
            </div>
          ) : (
            <div>
              <label className={label}>Folio fiscal (UUID) — al timbrar en tu PAC</label>
              <input className={`${input} font-mono`} value={uuid} onChange={e => setUuid(e.target.value)} placeholder="Ej. 3F2504E0-4F89-11D3-9A0C-0305E82C3301" />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cerrar</button>
          {facturada
            ? <button onClick={reabrir} disabled={busy} className="flex-1 py-2.5 rounded-full border border-amber-500/40 text-amber-600 text-sm font-semibold hover:bg-amber-500/10 transition-colors disabled:opacity-50">Reabrir</button>
            : <button onClick={marcarFacturada} disabled={busy} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">{busy ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}Marcar facturada</button>}
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   COTIZACIONES — presupuestos para clientes
════════════════════════════════════════ */
const COT_ESTADOS: { key: Cotizacion['estado']; label: string; cls: string; dot: string }[] = [
  { key: 'borrador', label: 'Borrador', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
  { key: 'enviada', label: 'Enviada', cls: 'bg-blue-500/10 text-blue-500', dot: '#2B5FAD' },
  { key: 'aceptada', label: 'Aceptada', cls: 'bg-emerald-500/10 text-emerald-600', dot: '#1F7A4D' },
  { key: 'rechazada', label: 'Rechazada', cls: 'bg-red-500/10 text-red-500', dot: '#B91C1C' },
  { key: 'cancelada', label: 'Cancelada', cls: 'bg-red-500/10 text-red-500', dot: '#7F1D1D' },
]
const cotEstadoMeta = (e: string) =>
  e === 'por_autorizar'
    // En autorización interna del cliente: visible para el admin, pero no es suya.
    ? { key: 'por_autorizar' as const, label: 'Por autorizar', cls: 'bg-amber-500/10 text-amber-600', dot: '#B45309' }
    : COT_ESTADOS.find(x => x.key === e) || COT_ESTADOS[0]

type CotStats = { total: number; borrador: number; enviada: number; aceptada: number; rechazada: number; vencida: number; abiertas: number; monto_aceptado: string }
type PaginaCot = { count: number; next: string | null; previous: string | null; results: Cotizacion[] }
const COT_PAGE_SIZE = 25

/** Lista de cotizaciones: paginada y filtrada EN EL SERVIDOR, para que aguante
 *  miles sin cargar todo al navegador. Los conteos vienen del endpoint de stats. */
/* Puente cotización→renta: la cotización aceptada que se está concretando.
   Vive a nivel módulo para no enhebrar props por medio panel; el RentModal
   la lee al montar y la limpia al registrar. */
type CotParaRenta = { id: number; folio: string | null; cliente: string; telefono: string; direccion: string; usuario_id: number | null; modalidad?: 'dia' | 'semana' | 'mes' | null; duracion?: number | null }
let cotParaRenta: CotParaRenta | null = null
const COT_RENTA_KEY = 'remali_cot_para_renta'
function leerCotParaRenta(): CotParaRenta | null {
  if (cotParaRenta) return cotParaRenta
  try { cotParaRenta = JSON.parse(sessionStorage.getItem(COT_RENTA_KEY) || 'null') } catch { cotParaRenta = null }
  return cotParaRenta
}
function fijarCotParaRenta(v: CotParaRenta | null) {
  cotParaRenta = v
  try { v ? sessionStorage.setItem(COT_RENTA_KEY, JSON.stringify(v)) : sessionStorage.removeItem(COT_RENTA_KEY) } catch { /* privado */ }
}

function CotizacionesAdmin({ empresas, notify, irAInventario }: {
  empresas: Empresa[]; notify: (m: string, t?: 'ok' | 'err' | 'info') => void; irAInventario?: () => void
}) {
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'vencida' | Cotizacion['estado']>('todas')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PaginaCot>({ count: 0, next: null, previous: null, results: [] })
  const [stats, setStats] = useState<CotStats | null>(null)
  const [cargando, setCargando] = useState(false)
  const [detalle, setDetalle] = useState<Cotizacion | null>(null)
  const [recienCreada, setRecienCreada] = useState(false)
  const [creando, setCreando] = useState(false)
  const [carta, setCarta] = useState<Cotizacion | null>(null)

  const cargarStats = useCallback(() => {
    api.get<CotStats>('/cotizaciones/stats/').then(r => setStats(r.data)).catch(() => {})
  }, [])
  const cargarLista = useCallback(() => {
    setCargando(true)
    const params = new URLSearchParams({ page: String(page) })
    if (qDebounced.trim()) params.set('q', qDebounced.trim())
    if (filtro !== 'todas') params.set('estado', filtro)
    api.get<PaginaCot>(`/cotizaciones/?${params.toString()}`)
      .then(r => setData(r.data)).catch(() => {}).finally(() => setCargando(false))
  }, [page, qDebounced, filtro])
  const recargar = useCallback(() => { cargarLista(); cargarStats() }, [cargarLista, cargarStats])

  // Búsqueda con debounce: al teclear se espera un poco y se vuelve a la página 1.
  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [filtro])           // cambiar de pestaña → página 1
  useEffect(() => { cargarLista() }, [cargarLista])   // montaje + cambios de página/búsqueda/filtro
  useEffect(() => { cargarStats() }, [cargarStats])   // conteos al montar

  function crearNueva() {
    setCreando(true)
    api.post<Cotizacion>('/cotizaciones/', { tipo: 'venta', aplica_iva: true, vigencia_dias: 15 })
      .then(r => { setRecienCreada(true); setDetalle(r.data) })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo crear', 'err'))
      .finally(() => setCreando(false))
  }

  const fechaCorta = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—')
  const totalPaginas = Math.max(1, Math.ceil(data.count / COT_PAGE_SIZE))
  const cuenta = (k: string): number | undefined => (stats ? (stats as any)[k] : undefined)
  const pestanas: { key: string; label: string; n?: number }[] = [
    { key: 'todas', label: 'Todas', n: stats?.total },
    ...COT_ESTADOS.map(e => ({ key: e.key, label: e.label, n: cuenta(e.key) })),
    { key: 'vencida', label: 'Vencidas', n: stats?.vencida },
  ]

  return (
    <div className="space-y-4">
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Cotizaciones', value: stats ? String(stats.total) : '—', tone: 'default' },
          { label: 'Abiertas', value: stats ? String(stats.abiertas) : '—', tone: 'gold', emphasis: (stats?.abiertas ?? 0) > 0 },
          { label: 'Aceptadas', value: stats ? String(stats.aceptada) : '—', tone: 'default' },
          { label: 'Monto aceptado', value: orMoney(stats?.monto_aceptado ?? 0), tone: 'default' },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-edge flex-wrap">
          <h3 className="font-bold text-ink shrink-0">Cotizaciones <span className="text-mute font-normal">({data.count})</span></h3>
          <div className="flex-1" />
          <div className="relative w-full sm:w-56">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio o cliente…" className="w-full bg-surface-2 border border-edge rounded-full pl-9 pr-3 py-2 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
          <button onClick={crearNueva} disabled={creando} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-60">
            {creando
              ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>}
            <span className="hidden sm:inline">Nueva cotización</span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge flex-wrap">
          {pestanas.map(p => (
            <button key={p.key} onClick={() => setFiltro(p.key as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filtro === p.key
                ? (p.key === 'vencida' ? 'bg-red-600 text-white' : 'bg-ink text-surface')
                : 'bg-surface-2 text-mute hover:text-ink'}`}>
              {p.label}{p.n !== undefined && <span className="ml-1.5 opacity-70">{p.n}</span>}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Folio</th>
                <th className="font-semibold px-3 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Tipo</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Vigencia</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {data.results.map(c => {
                const m = cotEstadoMeta(c.estado)
                return (
                  <tr key={c.id} className="hover:bg-surface-2 transition-colors cursor-pointer" onClick={() => setDetalle(c)}>
                    <td className="px-5 py-3 font-mono text-[13px] font-bold text-ink whitespace-nowrap">{c.folio || <span className="text-mute font-sans font-semibold">Borrador</span>}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{c.cliente_display}</p>
                        {c.origen === 'cliente' && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">Cliente</span>}
                      </div>
                      {c.cliente_telefono && <p className="text-[11px] text-mute">{c.cliente_telefono}</p>}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-mute">{TIPO_COT_LABEL[c.tipo] || c.tipo}</td>
                    <td className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap">{orMoney(c.total)}</td>
                    <td className={`px-3 py-3 text-[13px] whitespace-nowrap ${c.vencida ? 'text-red-600 dark:text-red-500 font-semibold' : 'text-mute'}`}>{fechaCorta(c.vigencia_hasta)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
                        {c.vencida && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-500">Vencida</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setDetalle(c)} className="h-8 px-3 rounded-lg border border-edge text-mute text-xs font-semibold hover:text-ink hover:border-gold/40 transition-colors">Abrir</button>
                        <button onClick={() => setCarta(c)} title="Imprimir cotización" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold hover:border-gold/40 transition-colors flex items-center justify-center">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path d="M6 9V4h12v5M6 18H4v-6a2 2 0 012-2h12a2 2 0 012 2v6h-2M8 14h8v6H8z" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data.results.length === 0 && <p className="text-sm text-mute py-14 text-center">{cargando ? 'Cargando…' : (qDebounced || filtro !== 'todas' ? 'Sin cotizaciones con ese criterio.' : 'Aún no hay cotizaciones. Crea la primera con “Nueva cotización”.')}</p>}
        </div>

        {data.count > COT_PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-edge">
            <span className="text-[12px] text-mute">Página {page} de {totalPaginas} · {data.count} en total</span>
            <div className="flex gap-2">
              <button disabled={!data.previous || cargando} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-edge text-xs font-semibold text-ink hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-40">Anterior</button>
              <button disabled={!data.next || cargando} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-edge text-xs font-semibold text-ink hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        )}
      </Card>

      {detalle && <CotizacionDetalleModal cotizacion={detalle} empresas={empresas} recienCreada={recienCreada} notify={notify} onConcretarRenta={irAInventario} onClose={() => { setDetalle(null); setRecienCreada(false); recargar() }} onChanged={recargar} onPrint={(c) => setCarta(c)} onConvertida={(id) => { setDetalle(null); setRecienCreada(false); recargar(); abrirOrdenCartaPDF('ventas', id) }} />}
      {carta && <CotizacionCartaModal cotizacion={carta} onClose={() => setCarta(null)} />}
    </div>
  )
}

/** Control segmentado con indicador deslizante (estilo iOS). Columnas iguales
 *  para posicionar el indicador por índice sin medir el DOM; anima al cambiar. */
function Segmentado({ opciones, valor, onChange, disabled, className = '' }: {
  opciones: { key: string; label: string }[]
  valor: string; onChange: (k: string) => void; disabled?: boolean; className?: string
}) {
  const idx = opciones.findIndex(o => o.key === valor)
  return (
    <div className={`relative grid w-full rounded-xl border border-edge bg-surface-2 p-1 ${disabled ? 'opacity-60' : ''} ${className}`}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
      {idx >= 0 && (
        <span aria-hidden className="absolute top-1 bottom-1 rounded-lg bg-ink shadow-sm"
          style={{ left: 4, width: `calc((100% - 8px) / ${opciones.length})`, transform: `translateX(${idx * 100}%)`, transition: 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)' }} />
      )}
      {opciones.map(o => (
        <button key={o.key} type="button" disabled={disabled} onClick={() => onChange(o.key)}
          className={`relative z-10 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors active:scale-[0.98] disabled:active:scale-100 ${valor === o.key ? 'text-surface' : 'text-mute hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Switch (toggle) con el mismo estilo que el resto del sistema: pista azul y
 *  perilla que desliza. Mejor objetivo de toque en móvil que un checkbox. */
function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full flex-none transition-colors active:scale-95 disabled:opacity-50 ${checked ? 'bg-[#2B6CF6]' : 'bg-ink/15'}`}>
      <span className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all ${checked ? 'left-[20px]' : 'left-[2px]'}`} />
    </button>
  )
}

function CotizacionDetalleModal({ cotizacion, empresas, recienCreada, notify, onClose, onChanged, onPrint, onConvertida, onConcretarRenta }: {
  cotizacion: Cotizacion; empresas: Empresa[]; recienCreada?: boolean; notify: (m: string, t?: 'ok' | 'err' | 'info') => void
  onClose: () => void; onChanged: () => void; onPrint: (c: Cotizacion) => void; onConvertida: (ventaId: number) => void; onConcretarRenta?: () => void
}) {
  // Vincular/cambiar la cuenta de la tienda dueña de esta cotización.
  async function vincularCuentaCot() {
    if (c.items.length === 0) { notify('Agrega partidas antes de vincular a una cuenta', 'err'); return }
    try {
      const rc = await api.get<{ clientes: { id: number; nombre: string; empresa?: string }[] }>('/clientes-lookup/')
      const lista = rc.data.clientes || []
      if (!lista.length) { await confirmar({ titulo: 'Sin cuentas', mensaje: 'Aún no hay cuentas de cliente en el sistema.', aceptar: 'Entendido' }); return }
      const sel = await elegir({
        titulo: 'Vincular a una cuenta',
        mensaje: 'El cliente verá esta cotización en "Mis cotizaciones" y podrá aceptarla.',
        opciones: lista.map(cl => ({ valor: String(cl.id), label: cl.nombre, detalle: cl.empresa || undefined })),
      })
      if (!sel || !sel[0]) return
      await api.post(`/cotizaciones/${cotizacion.id}/vincular/`, { usuario_id: Number(sel[0]) })
      notify('Cotización vinculada a la cuenta')
      onChanged()
    } catch { notify('No se pudo vincular', 'err') }
  }

  /* Vincular por LIGA (lo que escala con cientos de clientes): se genera un
     enlace de un solo uso, se manda por WhatsApp, y al abrirlo con su sesión
     la cotización cae en SU cuenta — sin buscar en ningún selector. */
  const [ligaVinculo, setLigaVinculo] = useState('')
  const [ligaCopiada, setLigaCopiada] = useState(false)
  const [generandoLiga, setGenerandoLiga] = useState(false)
  async function generarLigaVinculo() {
    if (!cotizacion.id || c.items.length === 0) { notify('Agrega partidas antes de generar la liga: vincular una cotización vacía no sirve de nada', 'err'); return }
    if (ligaVinculo || generandoLiga) return
    setGenerandoLiga(true)
    try {
      const r = await api.post<{ ruta: string }>(`/cotizaciones/${cotizacion.id}/vinculo/`, {}, { fondo: true } as never)
      setLigaVinculo(`${window.location.origin}${r.data.ruta}`)
    } catch (e: any) {
      notify(e?.response?.data?.detalle || 'No se pudo generar la liga', 'err')
    } finally { setGenerandoLiga(false) }
  }
  async function copiarLigaVinculo() {
    try {
      await navigator.clipboard.writeText(ligaVinculo)
      setLigaCopiada(true)
      setTimeout(() => setLigaCopiada(false), 1800)
    } catch { notify('No se pudo copiar; selecciona el texto a mano', 'err') }
  }
  function waVinculo() {
    const msg = `Hola${clienteNombre ? ' ' + clienteNombre : ''}, te preparé la cotización ${c.folio}. Ábrela con tu cuenta para verla en "Mis cotizaciones" y aceptarla cuando gustes:\n${ligaVinculo}`
    const tel = (clienteTel || '').replace(/\D/g, '')
    return `https://wa.me/${tel.length === 10 ? '52' + tel : tel}?text=${encodeURIComponent(msg)}`
  }
  const [c, setC] = useState<Cotizacion>(cotizacion)
  const [notas, setNotas] = useState(cotizacion.notas || '')
  const [email, setEmail] = useState(cotizacion.cliente_email || '')
  const [clienteNombre, setClienteNombre] = useState(cotizacion.cliente_nombre || '')
  const [clienteTel, setClienteTel] = useState(cotizacion.cliente_telefono || '')
  const [empresaSel, setEmpresaSel] = useState(String(cotizacion.empresa || ''))
  const [vigencia, setVigencia] = useState(String(cotizacion.vigencia_dias || 15))
  const [aplicaIva, setAplicaIva] = useState(cotizacion.aplica_iva)
  const [savingInfo, setSavingInfo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fotos, setFotos] = useState<CotizacionFoto[]>(cotizacion.fotos || [])
  const [subiendoFotos, setSubiendoFotos] = useState(false)
  const [zoomFoto, setZoomFoto] = useState<CotizacionFoto | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const fotoInput = useRef<HTMLInputElement>(null)

  function apply(nuevo: Cotizacion) { setC(nuevo); onChanged() }

  // Cierre: si es un borrador recién creado y quedó vacío (sin partidas, sin
  // cliente ni fotos), se descarta para no dejar cotizaciones huérfanas.
  function cerrar() {
    // Una cotización sin cliente o sin conceptos no tiene sentido: un borrador
    // recién creado así NO se conserva. Con datos parciales se pregunta antes de
    // descartar; totalmente vacío se descarta en silencio.
    if (recienCreada) {
      const sinCliente = !clienteNombre.trim() && !empresaSel
      const sinConceptos = c.items.length === 0
      if (sinCliente || sinConceptos) {
        const algo = clienteNombre.trim() || empresaSel || c.items.length > 0 || fotos.length > 0
        const faltan = [sinCliente && 'el nombre del cliente', sinConceptos && 'al menos un concepto'].filter(Boolean).join(' y ')
        if (algo && !confirm(`No se puede guardar la cotización sin ${faltan}. ¿Descartarla?`)) return
        api.delete(`/cotizaciones/${c.id}/`).then(() => onChanged()).catch(() => {})
        onClose()
        return
      }
    }
    if (!bloqueada) {
      // Guardar en silencio los datos del cliente/notas/vigencia si cambiaron,
      // para no perderlos al cerrar sin haber pulsado "Guardar".
      const dirty = notas !== (c.notas || '') || email.trim() !== (c.cliente_email || '')
        || clienteNombre.trim() !== (c.cliente_nombre || '') || clienteTel.trim() !== (c.cliente_telefono || '')
        || (Number(vigencia) || 15) !== c.vigencia_dias || aplicaIva !== c.aplica_iva
      if (dirty) {
        api.patch(`/cotizaciones/${c.id}/`, {
          notas, cliente_email: email.trim(), cliente_nombre: clienteNombre.trim(), cliente_telefono: clienteTel.trim(),
          vigencia_dias: Number(vigencia) || 15, aplica_iva: aplicaIva,
        }).then(() => onChanged()).catch(() => {})
      }
    }
    onClose()
  }
  // Tipo de la cotización: solo se elige mientras está vacía; con partidas se
  // deriva de sus modalidades (venta/renta/mixta).
  function cambiarTipo(tipo: string) {
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, { tipo })
      .then(r => apply(r.data))
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar el tipo'), 'err'))
  }
  function cambiarEmpresa(id: string) {
    setEmpresaSel(id)
    const em = empresas.find(x => String(x.id) === id)
    const payload: any = { empresa: id ? Number(id) : null }
    // Al elegir una empresa, el cliente ES la empresa: se rellenan sus datos y el
    // nombre queda bloqueado (no se captura otro). El teléfono va solo a dígitos.
    if (em) {
      const tel = (em.telefono || '').replace(/\D/g, '').slice(0, 10)
      setClienteNombre(em.nombre || ''); payload.cliente_nombre = em.nombre || ''
      setClienteTel(tel); payload.cliente_telefono = tel
      if (em.email) { setEmail(em.email); payload.cliente_email = em.email }
    }
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, payload)
      .then(r => apply(r.data))
      .catch(err => notify(errorMsg(err, 'No se pudo asignar la empresa'), 'err'))
  }

  function guardarInfo() {
    // Un borrador nuevo no se guarda incompleto (sin cliente o sin conceptos).
    if (recienCreada && (!(clienteNombre.trim() || empresaSel) || c.items.length === 0)) {
      notify('Agrega el nombre del cliente y al menos un concepto', 'err'); return
    }
    setSavingInfo(true)
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, {
      notas, cliente_email: email.trim(), cliente_nombre: clienteNombre.trim(), cliente_telefono: clienteTel.trim(),
      vigencia_dias: Number(vigencia) || 15, aplica_iva: aplicaIva,
    })
      .then(r => { apply(r.data); notify('Cotización guardada'); onClose() })
      .catch(() => notify('No se pudo guardar', 'err'))
      .finally(() => setSavingInfo(false))
  }
  function cambiarEstado(estado: Cotizacion['estado'], extra?: Record<string, unknown>) {
    // Para marcarla como Enviada o Aceptada debe tener cliente y conceptos.
    if ((estado === 'enviada' || estado === 'aceptada') && (!(clienteNombre.trim() || empresaSel) || c.items.length === 0)) {
      notify('Agrega el nombre del cliente y al menos un concepto primero', 'err'); return
    }
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, { estado, ...(extra || {}) })
      .then(r => {
        apply(r.data)
        notify(`Estado: ${cotEstadoMeta(estado).label}`)
        // El siguiente paso natural: comprometer fecha y hora de entrega.
        if (estado === 'aceptada' && !r.data.entrega_prometida) notify('Ahora indica la fecha y hora de entrega prometida', 'info')
      })
      .catch(async err => {
        // Venció: los precios ya no están garantizados. Respetarlos es una
        // decisión humana — se confirma y se reintenta con la marca.
        if (err?.response?.data?.codigo === 'vencida') {
          const ok = await confirmar({
            titulo: 'Cotización vencida',
            mensaje: `${err.response.data.detalle} ¿Aceptarla respetando esos precios?`,
            aceptar: 'Sí, respetar precios',
            cancelar: 'Mejor no',
          })
          if (ok) cambiarEstado(estado, { confirmar_vencida: true })
          return
        }
        notify(err?.response?.data?.detalle || 'No se pudo cambiar el estado', 'err')
      })
  }
  /* Concretar la RENTA de una cotización aceptada: se cuelga la cotización
     al puente y se manda al admin a Inventario a elegir la unidad; el
     RentModal llega precargado y liga la renta a esta cotización. */
  function concretarRenta() {
    // La partida de renta ya dice modalidad y cuántos periodos: se precargan
    // para que el RentModal llegue armado y solo falte elegir la unidad.
    const partida = c.items.find(i => i.modalidad === 'dia' || i.modalidad === 'semana' || i.modalidad === 'mes')
    fijarCotParaRenta({
      id: c.id, folio: c.folio,
      cliente: clienteNombre || c.cliente_display || '',
      telefono: clienteTel || c.cliente_telefono || '',
      direccion: c.datos_solicitud?.obra?.direccion || '',
      usuario_id: c.usuario ?? null,
      modalidad: (partida?.modalidad as 'dia' | 'semana' | 'mes' | undefined) || null,
      duracion: partida?.cantidad || null,
    })
    notify(`Elige la unidad y tócale Rentar: quedará ligada a la ${c.folio || 'cotización'}`, 'info')
    onClose()
    onConcretarRenta?.()
  }

  function aprobarCancelacion() {
    api.post(`/cotizaciones/${c.id}/aprobar-cancelacion/`, {})
      .then(() => { notify('Cancelación aprobada'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo aprobar', 'err'))
  }
  // Entrega prometida: editable en cualquier momento; el cliente la ve al recargar.
  function guardarEntrega(v: string) {
    const iso = v ? new Date(v).toISOString() : null
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, { entrega_prometida: iso })
      .then(r => { apply(r.data); notify(iso ? 'Entrega prometida guardada' : 'Entrega prometida quitada') })
      .catch(() => notify('No se pudo guardar la entrega', 'err'))
  }
  function atender() {
    api.post<{ cotizacion: Cotizacion }>(`/cotizaciones/${c.id}/atender/`, {})
      .then(r => { apply(r.data.cotizacion); notify('La estás atendiendo') })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo tomar', 'err'))
  }
  // "+ Agregar partida": del CATÁLOGO (el servidor pone el precio de la web,
  // con su promo) o LIBRE (flete, operador, un servicio — a mano).
  async function agregarItem() {
    setBusy(true)
    try {
      type EqMin = { id: number; modelo: string; precio_venta?: string | number | null; precio_dia?: string | number | null; precio_semana?: string | number | null; precio_mes?: string | number | null }
      const r = await api.get<EqMin[]>('/equipos/', { fondo: true } as never)
      const eqs = Array.isArray(r.data) ? r.data : []
      const hint = (e: EqMin) => {
        const partes: string[] = []
        if (Number(e.precio_venta)) partes.push(`Venta ${orMoney(Number(e.precio_venta))}`)
        if (Number(e.precio_dia)) partes.push(`Día ${orMoney(Number(e.precio_dia))}`)
        else if (Number(e.precio_semana)) partes.push(`Semana ${orMoney(Number(e.precio_semana))}`)
        return partes.join(' · ') || 'Sin precio en la web'
      }
      const sel = await elegir({
        titulo: 'Agregar partida',
        mensaje: 'Del catálogo se cotiza con el precio de la web; la partida libre es para conceptos a mano.',
        opciones: [
          ...eqs.map(e => ({ valor: String(e.id), label: e.modelo, detalle: hint(e) })),
          { valor: 'libre', label: 'Partida libre', detalle: 'Concepto y precio a mano (flete, operador…)' },
        ],
      })
      if (!sel || !sel[0]) return
      const payload = sel[0] === 'libre'
        ? { descripcion: 'Nueva partida', cantidad: 1, precio_unitario: 0, modalidad: c.tipo === 'renta' ? 'dia' : 'venta' }
        : { equipo_id: Number(sel[0]), cantidad: 1, modalidad: c.tipo === 'renta' ? 'dia' : '' }
      const res = await api.post<Cotizacion>(`/cotizaciones/${c.id}/items/`, payload)
      apply(res.data)
    } catch (err) {
      const d = (err as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle
      if (d) notify(d, 'err')
    } finally {
      setBusy(false)
    }
  }
  // Edición en línea de una partida: manda solo el campo que cambió.
  function editarItem(itemId: number, campo: 'descripcion' | 'cantidad' | 'precio_unitario', valor: string | number) {
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/items/${itemId}/`, { [campo]: valor })
      .then(r => apply(r.data))
      .catch(err => notify(errorMsg(err, 'No se pudo actualizar la partida'), 'err'))
  }
  function cambiarModalidad(itemId: number, m: Modalidad) {
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/items/${itemId}/modalidad/`, { modalidad: m })
      .then(r => apply(r.data))
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo cambiar', 'err'))
  }
  function quitarItem(itemId: number) {
    api.delete<Cotizacion>(`/cotizaciones/${c.id}/items/${itemId}/`)
      .then(r => { apply(r.data); notify('Partida quitada') })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo quitar', 'err'))
  }
  async function convertir() {
    if (c.convertida && c.venta_id) { onConvertida(c.venta_id); return }
    if (c.estado !== 'aceptada') { notify('Marca la cotización como “Aceptada” antes de convertirla en venta', 'err'); return }
    if (!clienteNombre.trim() && !empresaSel) { notify('Agrega el nombre del cliente antes de convertir', 'err'); return }
    if (c.items.length === 0) { notify('Agrega al menos una partida antes de convertir', 'err'); return }
    const aviso = c.tipo === 'mixta'
      ? `¿Crear la venta con las partidas de venta (${orMoney(c.subtotal_venta)})?\n\nLas partidas de renta NO se incluyen: esas se concretan desde Rentas eligiendo unidad y fechas.`
      : '¿Convertir esta cotización en venta? Se creará la venta con estas partidas y su ticket.'
    if (!(await confirmar({ titulo: 'Convertir en venta', mensaje: aviso, aceptar: 'Convertir' }))) return
    setBusy(true)
    const rMet = await elegir({
      titulo: 'Método de pago principal',
      opciones: [
        { valor: 'efectivo', label: 'Efectivo' },
        { valor: 'tarjeta', label: 'Tarjeta' },
        { valor: 'transferencia', label: 'Transferencia' },
      ],
    })
    if (!rMet || !rMet[0]) return
    const met = rMet[0]
    // Pago combinado: monto parcial del método principal; el resto con otro método.
    let pagos: { metodo: string; monto: number }[] = []
    const totalNum = Math.round(Number(c.total) * 100) / 100
    const parcial = ((await pedir({
      titulo: '¿Pago combinado?',
      mensaje: `Monto pagado con ${met}. Vacío = todo el total ($${totalNum}) con ${met}.`,
      placeholder: 'Ej. 10000', inputMode: 'decimal',
    })) || '').trim()
    if (parcial) {
      const monto = Math.round(Number(parcial.replace(/[^0-9.]/g, '')) * 100) / 100
      const resto = Math.round((totalNum - monto) * 100) / 100
      if (!(monto > 0) || resto <= 0) { notify('Monto parcial no válido (debe ser mayor a 0 y menor al total)', 'err'); return }
      const rMet2 = await elegir({
        titulo: `Método del resto ($${resto})`,
        opciones: [
          { valor: 'efectivo', label: 'Efectivo' },
          { valor: 'tarjeta', label: 'Tarjeta' },
          { valor: 'transferencia', label: 'Transferencia' },
        ].filter(o => o.valor !== met),
      })
      if (!rMet2 || !rMet2[0]) return
      const met2 = rMet2[0]
      pagos = [{ metodo: met, monto }, { metodo: met2, monto: resto }]
    }
    // Unidades físicas que se entregan: se marcan vendidas en la conversión,
    // y el inventario y el catálogo público quedan cuadrados solos.
    const unidadIds: number[] = []
    try {
      const ru = await api.get<{ id: number; codigo: string; numero_serie?: string; estado: string; equipo_info?: { modelo?: string } }[]>('/unidades/')
      const disp = (ru.data || []).filter(u => u.estado === 'disponible')
      if (disp.length) {
        const sel = await elegir({
          titulo: '¿Qué unidad(es) se entregan?',
          mensaje: 'Se marcan vendidas y el catálogo se actualiza solo.',
          multiple: true, vacioLabel: 'Asignar después',
          opciones: disp.map(u => ({
            valor: String(u.id),
            label: `${u.codigo} — ${u.equipo_info?.modelo || 'Equipo'}`,
            detalle: u.numero_serie ? `S/N ${u.numero_serie}` : undefined,
          })),
        })
        if (sel === null) return
        unidadIds.push(...sel.map(Number))
      }
    } catch { /* sin lista: se convierte y la unidad se marca después */ }
    api.post(`/cotizaciones/${c.id}/convertir/`, { metodo_pago: met, pagos, unidad_ids: unidadIds })
      .then(r => { notify(r.data?.detalle || 'Convertida a venta'); onConvertida(r.data.venta_id) })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo convertir', 'err'))
      .finally(() => setBusy(false))
  }

  // Las fotos van aparte de "Guardar": se suben/quitan al momento (multipart), y
  // se reflejan en `c` para que la carta y el PDF que se imprimen las lleven.
  function subirFotos(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (!files.length) return
    const fd = new FormData()
    files.forEach(f => fd.append('imagenes', f))
    setSubiendoFotos(true)
    api.post<{ fotos: CotizacionFoto[] }>(`/cotizaciones/${c.id}/fotos/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(r => {
        const nuevas = [...fotos, ...(r.data?.fotos || [])]
        setFotos(nuevas); setC(p => ({ ...p, fotos: nuevas })); onChanged()
        notify(`${r.data?.fotos?.length || 0} foto(s) agregada(s)`)
      })
      .catch(err => notify(errorMsg(err, 'No se pudieron subir las fotos'), 'err'))
      .finally(() => setSubiendoFotos(false))
  }
  function quitarFoto(id: number) {
    api.delete(`/cotizaciones/${c.id}/fotos/${id}/`)
      .then(() => {
        const nuevas = fotos.filter(f => f.id !== id)
        setFotos(nuevas); setC(p => ({ ...p, fotos: nuevas })); onChanged()
      })
      .catch(err => notify(errorMsg(err, 'No se pudo quitar la foto'), 'err'))
  }
  // Descarga el PDF de reportlab (el mismo del correo), no una recreación del
  // HTML: lo que baja el admin y lo que recibe el cliente son idénticos.
  function descargarPDF() {
    if (!(clienteNombre.trim() || empresaSel) || c.items.length === 0) {
      notify('Agrega el cliente y al menos un concepto para generar el PDF', 'err'); return
    }
    setDescargando(true)
    api.get(`/cotizaciones/${c.id}/pdf/`, { responseType: 'blob' })
      .then(r => descargarBlob(r.data as Blob, `${c.folio || 'cotizacion'}.pdf`))
      .catch(() => notify('No se pudo descargar el PDF', 'err'))
      .finally(() => setDescargando(false))
  }
  // Enviar por correo: guarda primero (para que el servidor tenga el correo
  // actual) y luego manda el PDF adjunto. El envío la marca como "Enviada".
  function enviarCorreo() {
    if (!email.trim()) { notify('Agrega el correo del cliente para enviarla', 'err'); return }
    if (!(clienteNombre.trim() || empresaSel) || c.items.length === 0) { notify('Falta el cliente o los conceptos', 'err'); return }
    setEnviando(true)
    api.patch(`/cotizaciones/${c.id}/`, { cliente_email: email.trim(), cliente_nombre: clienteNombre.trim(), cliente_telefono: clienteTel.trim(), notas, vigencia_dias: Number(vigencia) || 15, aplica_iva: aplicaIva })
      .then(() => api.post<{ detalle: string; cotizacion: Cotizacion }>(`/cotizaciones/${c.id}/enviar/`, {}))
      .then(r => { apply(r.data.cotizacion); notify(r.data.detalle || 'Cotización enviada') })
      .catch(err => notify(errorMsg(err, 'No se pudo enviar'), 'err'))
      .finally(() => setEnviando(false))
  }

  const m = cotEstadoMeta(c.estado)
  // Ya convertida en venta: queda de solo lectura. Es el respaldo de esa venta,
  // y editar partidas/precios desincronizaría su total y su ticket.
  const bloqueada = Boolean(c.convertida)
  // Los conceptos que armó EL CLIENTE no se tocan: son su pedido, no una
  // captura del panel. El admin solo edita partidas de sus propias cotizaciones.
  const conceptosBloqueados = bloqueada || c.origen === 'cliente'
  // Identidad de la solicitud (nombre/tel/correo): también es del cliente.
  const identidadBloqueada = c.origen === 'cliente'
  const sub = Number(c.subtotal) || 0
  // Venta: el precio ya incluye IVA → se desglosa. Renta: IVA solo si hay factura.
  const esVenta = c.tipo === 'venta'
  const baseMonto = esVenta ? sub / 1.16 : sub
  const ivaMonto = esVenta ? sub - sub / 1.16 : (aplicaIva ? sub * 0.16 : 0)
  const totalMonto = baseMonto + ivaMonto
  // Debe tener cliente (nombre o empresa) y al menos un concepto para poder
  // imprimirse o descargarse: un documento sin eso no sirve.
  const completa = (clienteNombre.trim() !== '' || Boolean(empresaSel)) && c.items.length > 0
  // Link público del PDF (para compartir por WhatsApp) y el mensaje armado.
  const linkPdf = c.token_publico ? `${window.location.origin}/api/cotizaciones/publica/${c.token_publico}/pdf/` : ''
  const msgWa = `Hola ${(clienteNombre.trim() || c.cliente_display || '').trim()}, le comparto su cotización ${c.folio} por ${orMoney(totalMonto)}${linkPdf ? `. Puede verla aquí: ${linkPdf}` : ''}.`
  const waHref = (completa && clienteTel.trim().length === 10 && linkPdf) ? waLink(clienteTel.trim(), msgWa) : ''
  // Celda editable en línea: parece texto, muestra fondo/anillo al enfocar.
  const celda = 'w-full bg-transparent rounded-md px-2 py-1.5 text-sm text-ink placeholder-mute focus:outline-none focus:bg-surface-2 focus:ring-1 focus:ring-gold/40 transition disabled:opacity-60'
  const labelCot = 'block text-[10.5px] font-bold uppercase tracking-[0.09em] text-mute mb-2'
  // La fecha de entrega existe hasta que hay trato: aceptada (o autorizada,
  // que cae directo en aceptada). Antes de eso no hay nada que prometer.
  const verEntrega = c.estado === 'aceptada' || Boolean(c.entrega_prometida)
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-start justify-center p-0 sm:p-6 overflow-y-auto modal-in" onClick={cerrar}>
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-full sm:max-w-5xl my-0 sm:my-auto bg-surface border border-edge rounded-none sm:rounded-2xl shadow-[0_20px_50px_rgba(33,29,22,0.18)] min-h-screen sm:min-h-0 sm:max-h-[92vh] flex flex-col sm:overflow-hidden">
        <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-edge flex items-start justify-between gap-4 bg-surface shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono font-bold text-ink text-lg tracking-tight">{c.folio || <span className="text-mute font-sans text-[15px]">Sin folio · nace al enviarla</span>}</span>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
            </div>
            <p className="text-[14px] text-mute truncate mt-1">{c.cliente_display} · {TIPO_COT_LABEL[c.tipo] || c.tipo}</p>
          </div>
          <div className="flex items-start gap-3 sm:gap-4 shrink-0">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-mute">Total</p>
              <p className="text-xl sm:text-[27px] font-extrabold text-ink tabular-nums leading-tight">{orMoney(totalMonto)}</p>
            </div>
            <button onClick={cerrar} className="text-mute hover:text-ink hover:bg-surface-2 p-1.5 rounded-lg transition active:scale-90 mt-0.5" aria-label="Cerrar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
          </div>
        </div>

        <div className="px-5 sm:px-7 py-6 space-y-7 bg-surface flex-1 sm:overflow-y-auto">
          {bloqueada && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM16 11V7a4 4 0 00-8 0v4" /></svg>
              <p className="text-[12.5px] text-ink leading-relaxed">
                Esta cotización ya se convirtió en {c.renta_id && !c.venta_id ? 'renta' : 'venta'}, así que quedó <b>bloqueada</b>. Es su respaldo; para cambiar algo, hazlo en la {c.renta_id && !c.venta_id ? 'renta' : 'venta'}.
              </p>
            </div>
          )}
          {c.origen === 'cliente' && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-600">Solicitud del cliente</p>
                <div className="flex items-center gap-2">
                  {c.atendida_por_nombre
                    ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>Atendida por {c.atendida_por_nombre}</span>
                    : <button onClick={atender} className="px-3 h-8 rounded-lg border border-blue-500/40 text-blue-600 text-xs font-bold hover:bg-blue-500/10 transition-colors">La estoy atendiendo</button>}
                  {c.cliente_telefono && waLink(c.cliente_telefono, `Hola ${c.cliente_display}, te contactamos de REMALI sobre tu solicitud de cotización ${c.folio}.`) && (
                    <a href={waLink(c.cliente_telefono, `Hola ${c.cliente_display}, te contactamos de REMALI sobre tu solicitud de cotización ${c.folio}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-[#25D366] text-white text-xs font-bold hover:opacity-90 transition-opacity shrink-0">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                      Responder por WhatsApp
                    </a>
                  )}
                </div>
              </div>
              {/* Ficha en bloques (etiqueta arriba, dato abajo): el "label: valor"
                  corrido dejaba las dos columnas disparejas y costaba escanear. */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3.5">
                {([
                  ['Empresa', c.datos_solicitud?.empresa],
                  ['Responsable de obra', c.datos_solicitud?.obra?.responsable],
                  ['Tel. de obra', c.datos_solicitud?.obra?.telefono],
                  ['Email', c.cliente_email],
                  ['Dirección de obra', c.datos_solicitud?.obra?.direccion],
                  ['Email de obra', c.datos_solicitud?.obra?.email],
                ] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className={k.startsWith('Dirección') || k.startsWith('Email') ? 'col-span-2 lg:col-span-1' : ''}>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">{k}</p>
                    <p className="text-[13px] font-bold text-ink mt-0.5 break-words leading-snug">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Estado (ancho) + Entrega y Tipo en columnas parejas. En tableta el
              estado toma su propia fila; en escritorio los tres van en una. */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${verEntrega ? 'lg:grid-cols-[minmax(0,1fr)_230px_230px]' : 'lg:grid-cols-[minmax(0,1fr)_230px]'} gap-5 lg:gap-6 items-start`}>
            <div className="sm:col-span-2 lg:col-span-1 min-w-0">
              <p className={labelCot}>Estado</p>
              {/* SOLO LECTURA: se ven todas las etapas y en cuál va; los cambios
                  ocurren por acciones (botones, autorización del jefe, conversión,
                  aprobación de cancelación) — nunca tocando esta barra. */}
              <div className="grid w-full rounded-xl border border-edge bg-surface-2 p-1"
                style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                {[
                  { key: 'borrador', label: 'Borrador' },
                  { key: c.estado === 'por_autorizar' ? 'por_autorizar' : 'enviada', label: c.estado === 'por_autorizar' ? 'Por autorizar' : 'Enviada' },
                  { key: 'aceptada', label: 'Aceptada' },
                  { key: c.estado === 'cancelada' ? 'cancelada' : 'rechazada', label: c.estado === 'cancelada' ? 'Cancelada' : 'Rechazada' },
                ].map(e => (
                  <span key={e.key} className={`text-center px-2 py-1.5 rounded-lg text-[13px] font-bold transition-colors ${
                    c.estado === e.key
                      ? (e.key === 'rechazada' || e.key === 'cancelada' ? 'bg-red-600 text-white' : e.key === 'por_autorizar' ? 'bg-amber-500 text-black' : 'bg-ink text-app')
                      : 'text-mute'
                  }`}>{e.label}</span>
                ))}
              </div>

              {/* Acciones que SÍ mueven el estado, según dónde va */}
              {!bloqueada && c.estado === 'borrador' && (
                <button onClick={() => cambiarEstado('enviada')} className="mt-2.5 h-10 px-4 rounded-full bg-ink text-app text-[13px] font-bold hover:opacity-90 transition active:scale-[0.98]">
                  Marcar como enviada
                </button>
              )}
              {!bloqueada && c.estado === 'enviada' && (c.origen === 'cliente' ? (
                /* Tubería AUTOMÁTICA (la mandó el cliente): administración solo
                   confirma disponibilidad; el aviso a su campanita sale solo y
                   después nada más falta fecha/hora de entrega y convertir. */
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => cambiarEstado('aceptada')} className="h-10 px-4 rounded-full bg-emerald-600 text-white text-[13px] font-bold hover:bg-emerald-700 transition active:scale-[0.98]">
                    Hay disponibilidad — aceptar
                  </button>
                  <button onClick={() => cambiarEstado('rechazada')} className="h-10 px-4 rounded-full text-red-600 dark:text-red-400 text-[13px] font-bold hover:bg-red-500/10 transition active:scale-[0.98]">
                    Sin disponibilidad
                  </button>
                </div>
              ) : (
                /* Tubería MANUAL (la capturaste tú para alguien sin cuenta):
                   el estado sigue lo que el cliente diga por teléfono/WhatsApp. */
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => cambiarEstado('aceptada')} className="h-10 px-4 rounded-full bg-emerald-600 text-white text-[13px] font-bold hover:bg-emerald-700 transition active:scale-[0.98]">
                    El cliente la aceptó
                  </button>
                  <button onClick={() => cambiarEstado('rechazada')} className="h-10 px-4 rounded-full text-red-600 dark:text-red-400 text-[13px] font-bold hover:bg-red-500/10 transition active:scale-[0.98]">
                    Rechazar
                  </button>
                </div>
              ))}
              {!bloqueada && c.estado === 'aceptada' && (c.tipo === 'renta' || c.tipo === 'mixta') && (
                <button onClick={concretarRenta}
                  className="mt-2.5 h-10 px-4 rounded-full btn-renta text-[13px] font-bold transition active:scale-[0.98]">
                  Concretar renta →
                </button>
              )}
              {/* Vino autorizada por el jefe del cliente: dinero ya aprobado. */}
              {c.autorizada_por && !c.autorizacion_rechazo && (
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[12.5px] font-bold">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                  Autorizada por {c.autorizada_por}{c.autorizada_en ? ` · ${new Date(c.autorizada_en).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : ''} — lista para concretar
                </div>
              )}
            </div>
            {verEntrega && <div className="min-w-0">
              <p className={labelCot}>Entrega prometida</p>
              {/* Display propio + input nativo superpuesto (opacity-0): conserva el
                  selector del sistema pero sin el "mm/dd/yyyy" nativo, que rompía
                  la línea visual del resto de campos. */}
              <div className="relative">
                <input type="datetime-local" aria-label="Fecha y hora de entrega prometida"
                  value={c.entrega_prometida ? (() => { const d = new Date(c.entrega_prometida); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` })() : ''}
                  onChange={e => guardarEntrega(e.target.value)}
                  className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:light] dark:[color-scheme:dark]" />
                <div className={`${input} pointer-events-none flex items-center justify-between gap-2 peer-focus:border-gold/60 ${c.entrega_prometida ? 'text-ink' : 'text-mute'}`}>
                  <span className="truncate">{c.entrega_prometida
                    ? new Date(c.entrega_prometida).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                    : 'Elegir fecha y hora'}</span>
                  {!c.entrega_prometida && <svg className="w-4 h-4 shrink-0 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path strokeLinecap="round" d="M3 9h18M8 3v3m8-3v3" /></svg>}
                </div>
                {c.entrega_prometida && (
                  <button type="button" onClick={() => guardarEntrega('')} aria-label="Quitar fecha de entrega"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-md text-mute hover:text-ink hover:bg-surface transition-colors active:scale-90">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
              </div>
            </div>}
            <div className="min-w-0">
              <p className={labelCot}>Tipo</p>
              <Segmentado
                opciones={[{ key: 'venta', label: 'Venta' }, { key: 'renta', label: 'Renta' }]}
                valor={c.tipo}
                onChange={cambiarTipo}
                disabled={bloqueada || c.items.length > 0}
              />
              {c.tipo === 'mixta' && <p className="text-[11px] text-mute mt-1.5">Mixta: venta + renta.</p>}
              {c.items.length > 0 && c.tipo !== 'mixta' && <p className="text-[11px] text-mute mt-1.5">Se define por las partidas.</p>}
            </div>
          </div>

          {/* El cliente pidió cancelar: visible ANTES que nada; tú decides. */}
          {c.cancelacion_solicitada && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
              <p className="text-[13.5px] font-bold text-red-700 dark:text-red-300">
                {c.estado === 'cancelada' ? 'El cliente CANCELÓ esta cotización' : 'El cliente solicitó CANCELAR esta cotización'}
                <span className="font-semibold text-red-600/80 dark:text-red-400/80"> · {new Date(c.cancelacion_solicitada).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </p>
              {c.cancelacion_motivo && <p className="text-[13px] text-red-600 dark:text-red-400 mt-1">Motivo: {c.cancelacion_motivo}</p>}
              {c.estado === 'cancelada' ? (
                <p className="text-[12px] text-mute mt-1.5">Cancelada: estado final. Si el cliente la necesita de nuevo, que vuelva a cotizar.</p>
              ) : (
                <button onClick={aprobarCancelacion}
                  className="mt-2.5 h-9 px-4 rounded-full bg-red-600 text-white text-[12.5px] font-bold hover:bg-red-700 transition active:scale-[0.98]">
                  Aprobar cancelación
                </button>
              )}
            </div>
          )}

          {/* Datos del cliente (arriba): para corregir un nombre/teléfono mal
              capturado sin tener que rehacer la cotización. */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className={labelCot}>Cliente</p>
              {/* Vincular la cotización a una cuenta de la tienda: el cliente
                  la ve en "Mis cotizaciones" y ÉL decide aceptarla. */}
              {!bloqueada && (c.usuario_nombre ? (
                <button onClick={vincularCuentaCot}
                  className="mb-2 text-[12px] font-bold text-gold hover:opacity-80 transition-opacity">
                  Cambiar cuenta
                </button>
              ) : (
                <div className="mb-2 flex items-center gap-3">
                  <button onClick={generarLigaVinculo} disabled={generandoLiga}
                    title={c.items.length === 0 ? 'Primero agrega las partidas' : undefined}
                    className={`text-[12px] font-bold transition-opacity disabled:opacity-50 ${c.items.length === 0 ? 'text-mute cursor-not-allowed' : 'text-gold hover:opacity-80'}`}>
                    {ligaVinculo ? '✓ Liga generada' : generandoLiga ? 'Generando…' : '+ Vincular por liga'}
                  </button>
                  <button onClick={vincularCuentaCot} className="text-[11px] font-semibold text-mute hover:text-ink transition-colors">
                    o elegir de la lista
                  </button>
                </div>
              ))}
            </div>
            {ligaVinculo && !c.usuario_nombre && (
              <div className="mb-3 flex items-center gap-2.5 bg-surface-2 border border-edge rounded-xl px-3 py-2.5">
                <span className="flex-1 min-w-0 text-[12.5px] text-mute overflow-hidden text-ellipsis whitespace-nowrap">{ligaVinculo.replace(/^https?:\/\//, '')}</span>
                <button onClick={copiarLigaVinculo} className="h-8 px-3 shrink-0 rounded-lg border border-edge bg-surface text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">
                  {ligaCopiada ? '✓ Copiada' : 'Copiar'}
                </button>
                <a href={waVinculo()} target="_blank" rel="noopener noreferrer"
                  className="h-8 px-3 shrink-0 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[12px] font-bold inline-flex items-center hover:bg-emerald-500/25 transition-colors">
                  WhatsApp
                </a>
              </div>
            )}
            {c.usuario_nombre && (
              /* Vino de una cuenta de la tienda: la identidad es del cliente,
                 no se recaptura. Los campos de abajo quedan para ajustes de
                 contacto; el nombre de la cuenta manda. */
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-gold/40 bg-gold-soft/40 px-4 py-3">
                <span className="w-9 h-9 rounded-full bg-gold text-black grid place-items-center font-extrabold text-[13px]">
                  {c.usuario_nombre.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-ink truncate">Cliente de la tienda: {c.usuario_nombre}</p>
                  <p className="text-[12px] text-mute truncate">{c.usuario_email || 'sin correo'} · sus datos vienen de su perfil</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select disabled={bloqueada || identidadBloqueada || !!c.usuario_nombre} title={c.usuario_nombre || identidadBloqueada ? 'La identidad la puso el cliente: no se cambia por una empresa' : undefined} value={empresaSel} onChange={e => cambiarEmpresa(e.target.value)} className={`${input} sm:col-span-2 disabled:opacity-60`}>
                <option value="">— Cliente particular —</option>
                {empresasActivas(empresas).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
              <input disabled={bloqueada || identidadBloqueada || !!empresaSel || !!c.usuario_nombre} value={clienteNombre} onChange={e => setClienteNombre(e.target.value)}
                title={empresaSel ? 'El nombre lo define la empresa seleccionada' : undefined}
                className={`${input} disabled:opacity-60`} placeholder="Nombre del cliente" />
              <div>
                <input type="tel" inputMode="numeric" maxLength={10} disabled={bloqueada || identidadBloqueada} value={clienteTel}
                  onChange={e => setClienteTel(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className={`${input} disabled:opacity-60`} placeholder="Teléfono (10 dígitos)" />
                {clienteTel.length > 0 && clienteTel.length < 10 && <p className="text-[11px] text-red-600 dark:text-red-500 mt-1">Deben ser 10 dígitos.</p>}
              </div>
              <input type="email" disabled={bloqueada || identidadBloqueada} value={email} onChange={e => setEmail(e.target.value)} className={`${input} sm:col-span-2 disabled:opacity-60`} placeholder="Correo (cliente@correo.com)" />
            </div>
            {identidadBloqueada && !bloqueada && (
              <p className="text-[11.5px] text-mute mt-2">El nombre, teléfono y correo los puso el cliente en su solicitud — se corrigen desde su cuenta.</p>
            )}
          </div>

          {/* Partidas: tabla editable en línea */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-3">
              <p className={`${labelCot} mb-0`}>Partidas</p>
              {conceptosBloqueados && !bloqueada
                ? <span className="text-[12px] font-semibold text-gold">Las armó el cliente — solo lectura</span>
                : !bloqueada && <span className="text-[12px] text-mute">Toca cualquier celda para editar</span>}
            </div>
            <div className="rounded-xl border border-edge overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  {/* Encabezado de columnas */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-2 border-b border-edge text-[10.5px] font-bold uppercase tracking-[0.06em] text-mute">
                    <div className="flex-1 min-w-0 pl-2">Concepto</div>
                    <div className="w-32 shrink-0">Modalidad</div>
                    <div className="w-16 shrink-0 text-center">Cant</div>
                    <div className="w-28 shrink-0 text-right pr-2">P. Unit</div>
                    <div className="w-6 shrink-0" />
                  </div>
                  {c.items.length === 0 && <div className="px-5 py-6 text-center text-[13px] text-mute">Sin partidas todavía.</div>}
                  {c.items.map(it => (
                    <div key={it.id} className="flex items-center gap-2 px-3 border-b border-edge last:border-0">
                      <div className="flex-1 min-w-0 py-1">
                        <input key={`${it.id}-${it.descripcion}`} defaultValue={it.descripcion} disabled={conceptosBloqueados} placeholder="Concepto"
                          onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.descripcion) editarItem(it.id, 'descripcion', v) }}
                          className={celda} />
                      </div>
                      <div className="w-32 shrink-0 py-1">
                        <select value={it.modalidad} disabled={conceptosBloqueados} title="¿Se vende o se renta?"
                          onChange={e => cambiarModalidad(it.id, e.target.value as Modalidad)}
                          className={`${celda} cursor-pointer font-medium`}>
                          {MODALIDADES.map(mm => <option key={mm.key} value={mm.key} className="bg-surface text-ink">{mm.corto}</option>)}
                        </select>
                      </div>
                      <div className="w-16 shrink-0 py-1">
                        <input type="number" min={1} defaultValue={it.cantidad} disabled={conceptosBloqueados}
                          onBlur={e => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== it.cantidad) editarItem(it.id, 'cantidad', v) }}
                          className={`${celda} text-center`} />
                      </div>
                      <div className="w-28 shrink-0 py-1">
                        <input key={`${it.id}-${it.precio_unitario}`} type="number" min={0} step="0.01" defaultValue={it.precio_unitario} disabled={conceptosBloqueados}
                          onBlur={e => { const v = Number(e.target.value) || 0; if (v !== Number(it.precio_unitario)) editarItem(it.id, 'precio_unitario', v) }}
                          className={`${celda} text-right font-bold tabular-nums`} />
                        {Number(it.precio_lista) > 0 && Number(it.precio_unitario) !== Number(it.precio_lista) && (
                          /* Se capturó un precio distinto al de la web: la
                             desviación se ve, no se esconde. */
                          <p className={`text-[10px] text-right pr-2 pb-1 font-bold ${Number(it.precio_unitario) < Number(it.precio_lista) ? 'text-amber-600' : 'text-blue-600'}`}>
                            lista {orMoney(Number(it.precio_lista))} · {Number(it.precio_unitario) < Number(it.precio_lista) ? '−' : '+'}{Math.abs(Math.round((Number(it.precio_unitario) - Number(it.precio_lista)) / Number(it.precio_lista) * 100))}%
                          </p>
                        )}
                      </div>
                      <div className="w-6 shrink-0 flex justify-center">
                        {!conceptosBloqueados && (
                          <button onClick={() => quitarItem(it.id)} title="Quitar" className="text-red-500 hover:bg-red-500/10 rounded p-1 transition active:scale-90">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!conceptosBloqueados && (
                    <button onClick={agregarItem} disabled={busy} className="w-full flex items-center gap-2 px-5 py-3 text-[13px] font-bold text-gold hover:bg-gold-soft/60 transition active:scale-[0.995] disabled:opacity-50 border-t border-edge">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                      Agregar partida
                    </button>
                  )}
                </div>
              </div>
            </div>

            {c.tipo === 'mixta' && (
              <p className="text-[11px] text-mute mt-2.5 leading-relaxed">
                Lleva venta y renta: <b className="text-ink tabular-nums">{orMoney(c.subtotal_venta)}</b> de venta y <b className="text-ink tabular-nums">{orMoney(c.subtotal_renta)}</b> de renta. Al convertir se crea la venta; la renta se concreta desde Rentas.
              </p>
            )}

            {/* Totales (derecha) + enviar al cliente (izquierda, aprovechando el hueco) */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-5 mt-5">
              {!bloqueada && (
                <div className="order-2 sm:order-1">
                  <p className={labelCot}>Enviar al cliente</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={enviarCorreo} disabled={enviando || !completa || !email.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-ink text-surface text-sm font-bold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50">
                      {enviando
                        ? <span className="w-4 h-4 border-2 border-surface/30 border-t-surface rounded-full animate-spin" />
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4z" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 6 8-6" /></svg>}
                      Enviar por correo
                    </button>
                    {waHref
                      ? <a href={waHref} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#25D366] text-white text-sm font-bold hover:opacity-90 transition active:scale-[0.98]">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                          WhatsApp
                        </a>
                      : <span title="Agrega el teléfono (10 dígitos) del cliente" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#25D366]/40 text-white text-sm font-bold opacity-60 cursor-not-allowed">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                          WhatsApp
                        </span>}
                  </div>
                  <p className="text-[11px] text-mute mt-1.5 max-w-[340px]">Por correo va el PDF adjunto; por WhatsApp, un enlace para verlo. Enviar por correo la marca como “Enviada”.</p>
                </div>
              )}
              <div className="order-1 sm:order-2 w-full sm:max-w-[320px] sm:ml-auto space-y-2.5">
                <div className="flex items-center justify-between text-[14px]"><span className="text-mute">Subtotal</span><span className="text-ink tabular-nums font-medium">{orMoney(baseMonto)}</span></div>
                <div className="flex items-center justify-between text-[14px] pb-2.5 border-b border-edge">
                  {esVenta ? (
                    /* Venta: el precio ya trae IVA, se desglosa siempre (sin toggle). */
                    <span className="text-mute">IVA (16%) <span className="text-[11px]">· incluido</span></span>
                  ) : (
                    /* Renta: el IVA es opcional según si el cliente pide factura. */
                    <div className={`flex items-center gap-2.5 ${bloqueada ? 'opacity-60' : ''}`}>
                      <Switch checked={aplicaIva} disabled={bloqueada} onChange={setAplicaIva} label="¿Factura? (suma IVA)" />
                      <span className="text-mute">¿Factura? (+IVA)</span>
                    </div>
                  )}
                  <span className="text-ink tabular-nums font-medium">{orMoney(ivaMonto)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-ink font-bold text-[15px]">Total</span>
                  <span className="text-[22px] font-extrabold text-price tabular-nums leading-none">{orMoney(totalMonto)}</span>
                </div>
                {esVenta && <div className="flex items-center justify-between text-[11.5px] text-mute"><span>Pago de contado (−5%)</span><span className="tabular-nums">{orMoney(totalMonto * 0.95)}</span></div>}
              </div>
            </div>
          </div>

          {/* Vigencia */}
          <div>
            <label className={labelCot}>Vigencia</label>
            <div className="relative sm:max-w-[220px]">
              <input type="number" min={1} disabled={bloqueada} value={vigencia} onChange={e => setVigencia(e.target.value)} className={`${input} pr-14 disabled:opacity-60`} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mute text-sm pointer-events-none">días</span>
            </div>
            <p className="text-[11.5px] text-mute mt-2">Los datos del cliente y la vigencia se guardan con “Guardar”. El envío por correo se conectará más adelante.</p>
          </div>

          {/* Notas */}
          <div>
            <label className={labelCot}>Notas</label>
            <textarea className={`${input} resize-none disabled:opacity-60`} rows={3} disabled={bloqueada} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Condiciones, entrega, etc." />
          </div>

          {/* Fotos: apoyo visual del equipo. Se guardan al instante y salen en
              la carta y el PDF del cliente. */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-3">
              <label className={`${labelCot} mb-0`}>Fotos ({fotos.length})</label>
              {!bloqueada && (
                <button type="button" onClick={() => fotoInput.current?.click()} disabled={subiendoFotos || fotos.length >= 10}
                  className="text-[12px] font-bold text-gold hover:opacity-80 transition active:scale-95 disabled:opacity-50">
                  {subiendoFotos ? 'Subiendo…' : '+ Agregar fotos'}
                </button>
              )}
              <input ref={fotoInput} type="file" accept="image/*" multiple className="hidden" onChange={subirFotos} />
            </div>
            {fotos.length === 0 ? (
              bloqueada ? (
                <p className="text-[12px] text-mute">Sin fotos.</p>
              ) : (
                <button type="button" onClick={() => fotoInput.current?.click()} disabled={subiendoFotos}
                  className="w-full py-6 rounded-xl border border-dashed border-edge text-[12px] text-mute hover:text-ink hover:border-gold/50 transition-colors disabled:opacity-50">
                  Agrega imágenes del equipo para que salgan en la cotización.
                </button>
              )
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {fotos.map(f => (
                  <div key={f.id} className="relative group aspect-square rounded-[9px] overflow-hidden border border-edge bg-surface-2">
                    <button type="button" onClick={() => setZoomFoto(f)} className="w-full h-full" title="Ver foto">
                      <img src={resolveMediaUrl(f.imagen)} alt="Foto de la cotización" className="w-full h-full object-cover" />
                    </button>
                    {!bloqueada && (
                      <button type="button" onClick={() => quitarFoto(f.id)} aria-label="Quitar foto"
                        className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!bloqueada && fotos.length > 0 && <p className="text-[11px] text-mute mt-2">Hasta 10 fotos. Aparecen en la carta y el PDF del cliente.</p>}
          </div>

        </div>

        <div className="px-5 sm:px-7 py-3.5 border-t border-edge flex flex-col sm:flex-row sm:items-center gap-2.5 bg-surface shrink-0">
          {/* Documentos del cliente (izquierda) */}
          <div className="grid grid-cols-2 sm:flex gap-2 sm:mr-auto">
            <button onClick={() => onPrint({ ...c, notas, vigencia_dias: Number(vigencia) || 15, aplica_iva: aplicaIva, base: String(baseMonto), iva: String(ivaMonto), total: String(totalMonto) })} disabled={!completa} title={!completa ? 'Agrega cliente y al menos un concepto' : undefined} className="py-2.5 sm:px-4 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path d="M6 9V4h12v5M6 18H4v-6a2 2 0 012-2h12a2 2 0 012 2v6h-2M8 14h8v6H8z" /></svg>
              Imprimir
            </button>
            <button onClick={descargarPDF} disabled={descargando || !completa} title={!completa ? 'Agrega cliente y al menos un concepto' : undefined} className="py-2.5 sm:px-4 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              {descargando
                ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
                : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>}
              Descargar PDF
            </button>
          </div>

          {/* Guardar */}
          {!bloqueada && (
            <button onClick={guardarInfo} disabled={savingInfo} className="w-full sm:w-auto sm:min-w-[110px] py-2.5 px-5 rounded-full border border-edge text-ink font-bold text-sm hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              {savingInfo ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" /> : null}
              Guardar
            </button>
          )}

          {/* Acción de negocio */}
          {c.convertida ? (
            <button onClick={convertir} disabled={busy} className="w-full sm:w-auto py-2.5 px-5 rounded-full text-sm font-bold transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5L20 6" /></svg>
              Ver ticket de venta
            </button>
          ) : c.tipo === 'renta' ? (
            <div className="w-full sm:w-auto py-2.5 px-4 rounded-full border border-edge text-mute text-[12px] font-medium flex items-center justify-center text-center" title="Las cotizaciones de renta se concretan creando la renta">
              Concreta esta renta desde Rentas
            </div>
          ) : c.estado !== 'aceptada' ? (
            <div className="w-full sm:w-auto py-2.5 px-4 rounded-full border border-edge text-mute text-[12px] font-medium flex items-center justify-center text-center" title="Marca la cotización como “Aceptada” para poder convertirla en venta">
              Acéptala para convertir a venta
            </div>
          ) : (
            <button onClick={convertir} disabled={busy} className="w-full sm:w-auto py-2.5 px-5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5L20 6" /></svg>
              {c.tipo === 'mixta' ? `Convertir la venta (${orMoney(c.subtotal_venta)})` : 'Convertir a venta'}
            </button>
          )}
        </div>
      </div>

      {zoomFoto && createPortal(
        <div className="modal-in fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClick={() => setZoomFoto(null)}>
          <img src={resolveMediaUrl(zoomFoto.imagen)} alt="Foto de la cotización" onClick={e => e.stopPropagation()}
            className="max-w-3xl w-full max-h-[85vh] object-contain rounded-xl" />
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   EL DÍA DEL TÉCNICO: dónde está el equipo y qué hay en taller
════════════════════════════════════════ */
type Urgencia = 'vencida' | 'hoy' | 'reparar' | 'manana' | 'proxima'
type TipoTarea = 'entregar' | 'recoger' | 'reparar' | 'entrega_prometida'

type Tarea = {
  tipo: TipoTarea; urgencia: Urgencia; etiqueta: string
  adeudo?: string | null
  equipo: string; codigo: string; numero_serie?: string
  // Campos de renta (entregar / recoger)
  renta_id?: number; lugar?: string; obra?: string | null
  contacto?: string; telefono?: string; empresa?: string | null
  fecha_fin?: string; evidencias?: { entrega: number; devolucion: number }
  // Campos de reparación
  orden_id?: number; folio?: string; orden_tipo?: string; estado?: string
  de_quien?: string; falla?: string; dias_en_taller?: number
}
type ResumenTareas = { total: number; entregar: number; recoger: number; reparar: number; vencidas: number; proximas: number }

// Cada tipo de tarea tiene su color e ícono: se distingue de un vistazo sin leer.
const TAREA_META: Record<TipoTarea, { label: string; anillo: string; icono: React.ReactNode }> = {
  entregar: { label: 'Entregar', anillo: 'bg-gold-soft text-gold',
    icono: <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></> },
  recoger: { label: 'Recoger', anillo: 'bg-[var(--c-renta)]/12 text-[var(--c-renta)]',
    icono: <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></> },
  reparar: { label: 'Reparar', anillo: 'bg-surface-2 text-mute',
    icono: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
  // Entrega PROMETIDA: cotización aceptada con fecha de HOY, aún sin convertir a
  // renta/venta. Es un compromiso informativo (sin renta_id), no una acción.
  entrega_prometida: { label: 'Prometida', anillo: 'bg-gold-soft text-gold',
    icono: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></> },
}
// La urgencia tiñe solo la etiqueta de tiempo, no todo el card: el ruido cansa.
const URGENCIA_TXT: Record<Urgencia, string> = {
  vencida: 'text-red-600 dark:text-red-500', hoy: 'text-amber-600 dark:text-amber-500',
  reparar: 'text-mute', manana: 'text-ink', proxima: 'text-mute',
}

function UbicacionesAdmin({ notify }: { notify: (m: string, t?: 'ok' | 'err') => void }) {
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [resumen, setResumen] = useState<ResumenTareas>({ total: 0, entregar: 0, recoger: 0, reparar: 0, vencidas: 0, proximas: 0 })
  const [cargando, setCargando] = useState(true)
  const [hoja, setHoja] = useState<Tarea | null>(null)      // sábana de entrega/recolección con fotos
  const [trabajando, setTrabajando] = useState<number | null>(null)

  const cargar = useCallback(() => {
    api.get<{ tareas: Tarea[]; resumen: ResumenTareas }>('/rentas/tareas/')
      .then(r => { setTareas(r.data?.tareas || []); if (r.data?.resumen) setResumen(r.data.resumen) })
      .catch(() => notify('No se pudo cargar', 'err'))
      .finally(() => setCargando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRecurso(['rentas', 'reparaciones'], cargar)

  /* Tiempo real ENTRE usuarios: el bus solo avisa dentro del mismo navegador,
     así que la renta que el admin crea en su máquina no llegaría sola al
     teléfono del técnico. Sondeo silencioso cada 20 s (rentas/tareas/ está en
     SIN_INDICADOR: no enciende el loader global) y al volver a la pestaña. */
  useEffect(() => {
    const id = window.setInterval(cargar, 20_000)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Las "próximas" (entregas a futuro) se separan: son planeación, no lo de hoy.
  const pendientes = tareas.filter(t => t.urgencia !== 'proxima')
  const proximas = tareas.filter(t => t.urgencia === 'proxima')

  return (
    <div className="max-w-2xl mx-auto space-y-2.5">
      {/* Un resumen de una línea, no un tablero. El técnico quiere el número, no gráficas. */}
      <div className="bg-surface border border-edge rounded-2xl px-5 sm:px-6 py-5">
        {cargando ? (
          // Esqueleto con la forma del resumen (línea + dos chips): el técnico ve
          // lo que va a llegar y la espera se siente más corta que un "Cargando…".
          <div aria-busy="true" aria-label="Cargando tu jornada">
            <div className="h-4 w-2/3 rounded-md bg-surface-2 animate-pulse" />
            <div className="flex gap-2 mt-3.5">
              <div className="h-6 w-24 rounded-full bg-surface-2 animate-pulse" />
              <div className="h-6 w-20 rounded-full bg-surface-2 animate-pulse" />
            </div>
          </div>
        ) : resumen.total === 0 ? (
          // Vacío que dice qué significa estar en cero, con un icono en verde
          // "disponible". Sin emoji.
          <div className="flex items-center gap-3.5">
            <span className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-libre/12 text-libre">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <div>
              <p className="text-[15px] font-black text-ink leading-tight">Vas al día</p>
              <p className="text-[13px] text-mute mt-0.5">Sin entregas, recolecciones ni reparaciones pendientes.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[15px] text-ink">
              Tienes <b className="font-black">{pendientes.length}</b> {pendientes.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}
              {/* La coma va FUERA del span: es puntuación normal, no parte del
                  rojo. Solo "N vencida(s)" se pinta. */}
              {resumen.vencidas > 0 && <>, <span className="text-red-600 dark:text-red-500 font-bold">{resumen.vencidas} vencida{resumen.vencidas > 1 ? 's' : ''}</span></>}.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {resumen.entregar > 0 && <TareaResumenChip n={resumen.entregar} label="entregar" tipo="entregar" />}
              {resumen.recoger > 0 && <TareaResumenChip n={resumen.recoger} label="recoger" tipo="recoger" />}
              {resumen.reparar > 0 && <TareaResumenChip n={resumen.reparar} label="reparar" tipo="reparar" />}
            </div>
          </>
        )}
      </div>

      {/* La lista de tareas: una acción por card. */}
      {pendientes.map((t, i) => (
        <TareaCard key={`${t.tipo}-${t.renta_id ?? t.orden_id}-${i}`} t={t}
          onEntregar={() => setHoja(t)} onReparar={() => t.orden_id && setTrabajando(t.orden_id)} />
      ))}

      {/* Próximas: se agenda, no urge. Colapsadas visualmente. */}
      {/* space-y-2.5 en el contenedor: las próximas se apilaban pegadas, sin el
          gap que sí tienen las pendientes por vivir en el contenedor de arriba. */}
      {proximas.length > 0 && (
        <div className="pt-2 space-y-2.5">
          <p className="text-[12px] font-bold text-mute uppercase tracking-wide px-1 mb-2">Próximas ({proximas.length})</p>
          {proximas.map((t, i) => (
            <TareaCard key={`prox-${t.renta_id}-${i}`} t={t} atenuada
              onEntregar={() => setHoja(t)} onReparar={() => {}} />
          ))}
        </div>
      )}

      {hoja && (
        <EntregaHoja tarea={hoja} onClose={() => setHoja(null)} onHecho={() => { setHoja(null); cargar() }} notify={notify} />
      )}
      {trabajando !== null && (
        <TallerTrabajoModal ordenId={trabajando} onClose={() => setTrabajando(null)} onCambio={cargar} notify={notify} />
      )}
    </div>
  )
}

function TareaResumenChip({ n, label, tipo }: { n: number; label: string; tipo: TipoTarea }) {
  const meta = TAREA_META[tipo] ?? TAREA_META.entregar
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-bold ${meta.anillo}`}>
      {n} por {label}
    </span>
  )
}

function TareaCard({ t, atenuada, onEntregar, onReparar }: {
  t: Tarea; atenuada?: boolean; onEntregar: () => void; onReparar: () => void
}) {
  // Fallback defensivo: si el backend emite un tipo de tarea que este panel aún
  // no conoce, se degrada con un estilo genérico en vez de tumbar TODO el panel
  // (un tipo sin entrada aquí reventaba con "undefined.anillo" → pantalla 500).
  const meta = TAREA_META[t.tipo] ?? TAREA_META.entregar
  const tel = (t.telefono || '').replace(/\D+/g, '')
  const esCampo = t.tipo === 'entregar' || t.tipo === 'recoger' || t.tipo === 'entrega_prometida'
  const fotos = t.tipo === 'recoger' ? (t.evidencias?.devolucion ?? 0) : (t.evidencias?.entrega ?? 0)

  // Borde rojo tenue solo si está vencida: dirige el ojo a lo urgente sin pintar
  // todo el card (el ruido cansa). Borde completo, no franja lateral.
  return (
    <div className={`bg-surface border rounded-2xl overflow-hidden ${t.urgencia === 'vencida' ? 'border-red-500/35' : 'border-edge'} ${atenuada ? 'opacity-70' : ''}`}>
      <div className="px-5 sm:px-6 py-4">
        <div className="flex items-start gap-3.5">
          <span className={`shrink-0 w-11 h-11 rounded-full grid place-items-center ${meta.anillo}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{meta.icono}</svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-mute">{meta.label}</span>
              <span className={`text-[12.5px] font-bold text-right ${URGENCIA_TXT[t.urgencia]}`}>{t.etiqueta}</span>
            </div>
            <h3 className="text-[15px] font-black text-ink mt-0.5 leading-tight">{t.equipo}</h3>
            <p className="text-[12px] font-mono text-mute">{t.codigo}{t.numero_serie ? ` · ${t.numero_serie}` : ''}</p>

            {esCampo ? (
              <div className="mt-2 space-y-0.5">
                <p className="text-[13.5px] text-ink flex items-start gap-1.5">
                  <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                  {t.obra ? <span><b className="font-bold">{t.obra}</b> · {t.lugar}</span> : t.lugar}
                </p>
                {t.contacto && <p className="text-[12.5px] text-mute pl-5">{t.contacto}{t.empresa ? ` · ${t.empresa}` : ''}</p>}
                {/* Adeudo: la única cifra que el técnico SÍ ve — al recoger, cobra. */}
                {t.tipo === 'recoger' && t.adeudo && (
                  <p className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[13px] font-bold text-red-600 dark:text-red-400">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M12 7v6" /><circle cx="12" cy="17" r="0.6" className="fill-current" /></svg>
                    Adeudo: cobrar ${Number(t.adeudo).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-[12.5px] text-mute">{t.de_quien}{t.orden_tipo === 'interna' ? '' : ''} · {t.folio}</p>
                {t.falla && <p className="text-[13.5px] text-ink mt-1 leading-snug">{t.falla}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra de acciones: llamar / mapa a la izquierda, la acción principal a la derecha */}
      <div className="px-5 sm:px-6 py-3 bg-surface-2/40 border-t border-edge flex items-center gap-2">
        {esCampo && tel && (
          <a href={`tel:${tel}`} aria-label="Llamar" className="shrink-0 w-9 h-9 rounded-lg grid place-items-center border border-edge bg-surface text-ink hover:border-gold/40 hover:text-gold active:scale-95 transition-[transform,border-color,color] duration-150 motion-reduce:active:scale-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>
          </a>
        )}
        {esCampo && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.lugar || '')}`} target="_blank" rel="noopener noreferrer" aria-label="Cómo llegar"
            className="shrink-0 w-9 h-9 rounded-lg grid place-items-center border border-edge bg-surface text-ink hover:border-gold/40 hover:text-gold active:scale-95 transition-[transform,border-color,color] duration-150 motion-reduce:active:scale-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          </a>
        )}
        {esCampo && t.tipo !== 'entrega_prometida' && (
          <span className="text-[11.5px] text-mute pl-1">
            {fotos > 0 ? `${fotos} foto${fotos > 1 ? 's' : ''}` : 'Sin fotos'}
          </span>
        )}
        <div className="flex-1" />
        {t.tipo === 'reparar' ? (
          <button onClick={onReparar} className="btn-acento h-9 px-4 rounded-full text-[13px] font-bold">Trabajar</button>
        ) : t.tipo === 'entrega_prometida' ? (
          // Compromiso informativo: todavía no es renta/venta, no hay nada que "entregar" en el sistema.
          <span className="text-[12px] text-mute pl-1 font-medium">Compromiso de hoy</span>
        ) : (
          <button onClick={onEntregar} className={`${t.tipo === 'recoger' ? 'btn-renta' : 'btn-acento'} h-9 px-4 rounded-full text-[13px] font-bold`}>
            {t.tipo === 'recoger' ? 'Recoger' : 'Entregar'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Sábana de entrega / recolección: captura fotos ANTES de confirmar ── */
function EntregaHoja({ tarea, onClose, onHecho, notify }: {
  tarea: Tarea; onClose: () => void; onHecho: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const esRecoger = tarea.tipo === 'recoger'
  const momento = esRecoger ? 'devolucion' : 'entrega'
  const [fotos, setFotos] = useState<File[]>([])
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const previews = useMemo(() => fotos.map(f => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews])

  function agregar(ev: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (nuevos.length) setFotos(f => [...f, ...nuevos].slice(0, 12))
  }

  // Sube las fotos (si hay) y luego marca la entrega/recolección. Si la subida
  // falla, NO se marca: la evidencia es parte del acto, no un extra.
  async function confirmar(conFotos: boolean) {
    setOcupado(true)
    try {
      if (conFotos && fotos.length) {
        const fd = new FormData()
        fd.append('momento', momento)
        if (nota.trim()) fd.append('nota', nota.trim())
        fotos.forEach(f => fd.append('imagenes', f))
        await api.post(`/rentas/${tarea.renta_id}/evidencias/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      const url = esRecoger ? `/rentas/${tarea.renta_id}/devolver/` : `/rentas/${tarea.renta_id}/entregar/`
      const body = esRecoger ? {} : { entregado: true }
      const r = await api.post(url, body)
      notify(r.data?.detalle || (esRecoger ? 'Equipo recogido' : 'Entrega confirmada'))
      onHecho()
    } catch (err) {
      notify(errorMsg(err, 'No se pudo completar'), 'err')
    } finally {
      setOcupado(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.45)] backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[520px] bg-surface rounded-t-3xl sm:rounded-2xl shadow-[0_-8px_40px_rgba(33,29,22,0.2)] sm:shadow-[0_24px_60px_rgba(33,29,22,0.25)] max-h-[92vh] flex flex-col overflow-hidden border-t sm:border border-edge">
        <div className="px-6 pt-5 pb-4 border-b border-edge flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-ink">{esRecoger ? 'Recoger' : 'Entregar'} · {tarea.equipo}</h2>
            <p className="text-[12.5px] text-mute mt-0.5 truncate">{tarea.codigo}{tarea.lugar ? ` · ${tarea.lugar}` : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-[9px] grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
          <div>
            <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-1">FOTOS DEL EQUIPO</p>
            <p className="text-[12.5px] text-mute mb-3">
              {esRecoger ? 'Cómo regresó la máquina. Respalda el estado por si hay reclamo.' : 'El estado en que sale. Es tu respaldo si el cliente reporta un daño.'}
            </p>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={agregar} />
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => inputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-edge grid place-items-center text-mute hover:text-gold hover:border-gold/50 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M12 8v8M8 12h8" strokeLinecap="round" /><rect x="3" y="5" width="18" height="15" rx="2.5" /><path d="M8 5l1.5-2h5L16 5" /></svg>
              </button>
              {previews.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-edge">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => setFotos(f => f.filter((_, j) => j !== i))} aria-label="Quitar"
                    className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/60 text-white grid place-items-center">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-2 block">NOTA (OPCIONAL)</label>
            <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. Rayón en la tapa, tanque lleno…"
              className="w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
          </div>
        </div>

        <div className="px-6 py-5 border-t border-edge">
          {/* El camino esperado es CON fotos: el botón principal se activa al
              tener al menos una. Sin fotos es una decisión explícita, abajo. */}
          <button onClick={() => confirmar(true)} disabled={ocupado || fotos.length === 0}
            className={`${esRecoger ? 'btn-renta' : 'btn-acento'} w-full h-12 rounded-full text-[14px] font-black`}>
            {ocupado ? 'Guardando…'
              : fotos.length ? `Confirmar con ${fotos.length} foto${fotos.length > 1 ? 's' : ''}`
              : (esRecoger ? 'Confirmar recolección' : 'Confirmar entrega')}
          </button>
          {fotos.length === 0 ? (
            <button onClick={() => { if (confirm('¿Seguro sin fotos? Sin evidencia no hay respaldo si el cliente reclama un daño.')) confirmar(false) }} disabled={ocupado}
              className="w-full mt-2.5 h-9 text-[13px] font-semibold text-mute hover:text-ink transition-colors">
              {esRecoger ? 'Recoger sin fotos' : 'Entregar sin fotos'}
            </button>
          ) : (
            <p className="text-center text-[12px] text-mute mt-2.5">Toca una foto para quitarla, o agrega más arriba.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Trabajar una reparación ──
   Una reparación es un PROCESO, no un instante: se empieza, se trabaja (a veces
   varios días) y solo al final queda lista. El flujo lo refleja —
   recibida → en proceso → terminada — y terminar exige describir qué se hizo,
   para que no sea un botón que se toca en segundos. */
type OrdenDetalle = {
  id: number; folio: string; tipo: string; estado: string
  equipo_display?: string; cliente_display?: string; diagnostico?: string
  trabajo_realizado?: string
  items: { id: number; origen: string; nombre: string; cantidad: number; refaccion?: number | null }[]
}
type RefaccionPick = { id: number; nombre: string; stock: number }

const ESTADO_ORDEN: Record<string, { label: string; cls: string }> = {
  recibida: { label: 'Sin empezar', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-500' },
  proceso: { label: 'En proceso', cls: 'bg-[var(--c-renta)]/12 text-[var(--c-renta)]' },
  terminada: { label: 'Terminada', cls: 'bg-emerald-500/10 text-emerald-600' },
  entregada: { label: 'Entregada', cls: 'bg-surface-2 text-mute' },
}

function TallerTrabajoModal({ ordenId, onClose, onCambio, notify }: {
  ordenId: number; onClose: () => void; onCambio: () => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [orden, setOrden] = useState<OrdenDetalle | null>(null)
  const [refs, setRefs] = useState<RefaccionPick[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [trabajo, setTrabajo] = useState('')          // qué se hizo (se guarda al terminar / al cerrar)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    api.get<OrdenDetalle>(`/reparaciones/${ordenId}/`)
      .then(r => { setOrden(r.data); setTrabajo(r.data.trabajo_realizado || '') })
      .catch(() => notify('No se pudo abrir la orden', 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId])
  useEffect(() => { cargar() }, [cargar])
  const cargarRefs = useCallback(() => {
    api.get<RefaccionPick[]>('/refacciones/', { params: { q: busqueda } })
      .then(r => setRefs(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [busqueda])
  useEffect(() => { cargarRefs() }, [cargarRefs])

  const estado = orden?.estado
  const enProceso = estado === 'proceso'
  const recibida = estado === 'recibida'

  function guardarTrabajo() {
    // Persiste la nota de avance sin cambiar de estado. Silencioso: es autosave.
    if (!orden || (orden.trabajo_realizado || '') === trabajo) return Promise.resolve()
    return api.patch(`/reparaciones/${ordenId}/`, { trabajo_realizado: trabajo })
      .then(() => onCambio()).catch(() => {})
  }
  function agarrar(ref: RefaccionPick) {
    if (ref.stock < 1) { notify(`No queda "${ref.nombre}" en inventario`, 'err'); return }
    setOcupado(true)
    api.post(`/reparaciones/${ordenId}/items/`, { origen: 'stock', refaccion_id: ref.id, cantidad: 1 })
      .then(r => { setOrden(o => o ? { ...o, items: r.data.items, estado: r.data.estado } : r.data); cargarRefs(); notify(`${ref.nombre} tomado del inventario`); onCambio() })
      .catch(err => notify(errorMsg(err, 'No se pudo registrar'), 'err'))
      .finally(() => setOcupado(false))
  }
  function quitar(itemId: number) {
    api.delete(`/reparaciones/${ordenId}/items/${itemId}/`)
      .then(r => { setOrden(o => o ? { ...o, items: r.data.items } : r.data); cargarRefs(); onCambio() })
      .catch(err => notify(errorMsg(err, 'No se pudo quitar'), 'err'))
  }
  function empezar() {
    setOcupado(true)
    api.patch(`/reparaciones/${ordenId}/`, { estado: 'proceso' })
      .then(() => { notify('Reparación iniciada'); onCambio(); cargar() })
      .catch(err => notify(errorMsg(err, 'No se pudo iniciar'), 'err'))
      .finally(() => setOcupado(false))
  }
  function terminar() {
    if (trabajo.trim().length < 4) { notify('Escribe qué le hiciste antes de terminar.', 'err'); return }
    if (!confirm('¿La máquina ya quedó lista para entregar?\n\nAl terminar sale de tus pendientes.')) return
    setOcupado(true)
    api.patch(`/reparaciones/${ordenId}/`, { estado: 'terminada', trabajo_realizado: trabajo.trim() })
      .then(() => { notify('Reparación terminada'); onCambio(); onClose() })
      .catch(err => notify(errorMsg(err, 'No se pudo terminar'), 'err'))
      .finally(() => setOcupado(false))
  }
  async function cerrar() {
    await guardarTrabajo()   // no perder el avance escrito
    onClose()
  }

  const est = estado ? ESTADO_ORDEN[estado] : undefined

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClick={cerrar}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[560px] bg-surface rounded-t-3xl sm:rounded-2xl shadow-[0_-8px_40px_rgba(33,29,22,0.2)] sm:shadow-[0_24px_60px_rgba(33,29,22,0.25)] max-h-[92vh] flex flex-col overflow-hidden border-t sm:border border-edge">
        <div className="px-6 pt-5 pb-4 border-b border-edge flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10.5px] font-bold tracking-[0.5px] text-mute">REPARACIÓN</span>
              {est && <span className={`text-[10.5px] px-2 py-[3px] rounded-md font-bold ${est.cls}`}>{est.label}</span>}
            </div>
            <h2 className="text-lg font-black text-ink truncate">{orden?.equipo_display || 'Equipo'}</h2>
            <p className="text-[12.5px] text-mute mt-0.5">
              {orden?.folio}{orden ? ` · ${orden.tipo === 'interna' ? 'Máquina propia' : orden.cliente_display || 'De cliente'}` : ''}
            </p>
          </div>
          <button onClick={cerrar} aria-label="Cerrar" className="w-8 h-8 rounded-[9px] grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
          {orden?.diagnostico && (
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-1.5">FALLA REPORTADA</p>
              <p className="text-[13.5px] text-ink leading-snug">{orden.diagnostico}</p>
            </div>
          )}

          {recibida ? (
            // Sin empezar: lo único que toca es arrancarla. Nada de "terminar" aquí.
            <div className="rounded-xl bg-surface-2 px-4 py-4 text-center">
              <p className="text-[13.5px] text-ink font-semibold">Aún no la has empezado.</p>
              <p className="text-[12.5px] text-mute mt-1 max-w-[42ch] mx-auto">
                Márcala como iniciada cuando te pongas a trabajarla. No tienes que terminarla hoy — puedes seguir mañana.
              </p>
            </div>
          ) : (
            <>
              {/* Refacciones usadas */}
              <div>
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-2">REFACCIONES USADAS</p>
                {orden && orden.items.length === 0 ? (
                  <p className="text-[13px] text-mute">Nada todavía. Abajo tomas lo que ocupes del inventario.</p>
                ) : (
                  <div className="space-y-1.5">
                    {orden?.items.map(it => (
                      <div key={it.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface-2">
                        <span className="text-sm text-ink flex-1 truncate">{it.nombre}</span>
                        <span className="text-[13px] font-mono text-mute">×{it.cantidad}</span>
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded text-mute">{it.origen === 'stock' ? 'Inventario' : 'Aparte'}</span>
                        <button onClick={() => quitar(it.id)} aria-label="Quitar" className="w-7 h-7 rounded-lg grid place-items-center text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tomar del inventario */}
              <div>
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-2">TOMAR DEL INVENTARIO</p>
                <div className="relative mb-2">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar refacción…"
                    className="w-full bg-surface-2 border border-edge rounded-xl pl-9 pr-3 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {refs.length === 0 && <p className="text-[13px] text-mute px-1 py-2">Sin resultados.</p>}
                  {refs.map(ref => (
                    <button key={ref.id} onClick={() => agarrar(ref)} disabled={ocupado || ref.stock < 1}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-edge hover:border-gold/40 disabled:opacity-40 transition-colors text-left">
                      <span className="text-sm text-ink flex-1 truncate">{ref.nombre}</span>
                      <span className={`text-[12px] ${ref.stock < 1 ? 'text-red-500' : 'text-mute'}`}>{ref.stock} en stock</span>
                      <span className="text-gold font-black text-lg leading-none">+</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Qué se hizo: obligatorio para terminar */}
              <div>
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-2">¿QUÉ LE HICISTE?</p>
                <textarea value={trabajo} onChange={e => setTrabajo(e.target.value)} onBlur={guardarTrabajo} rows={3}
                  placeholder="Ej. Cambié el filtro y limpié el carburador. Probada y funcionando."
                  className="w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors resize-none" />
                <p className="text-[12px] text-mute mt-1.5">Se guarda solo. Descríbelo antes de marcarla terminada.</p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-5 border-t border-edge">
          {recibida ? (
            <button onClick={empezar} disabled={ocupado} className="btn-acento w-full h-12 rounded-full text-[14px] font-black">
              {ocupado ? 'Guardando…' : 'Empezar reparación'}
            </button>
          ) : enProceso ? (
            <>
              <button onClick={terminar} disabled={ocupado || trabajo.trim().length < 4}
                className="btn-acento w-full h-12 rounded-full text-[14px] font-black">
                {ocupado ? 'Guardando…' : 'Marcar terminada'}
              </button>
              <button onClick={cerrar} disabled={ocupado}
                className="w-full mt-2.5 h-9 text-[13px] font-semibold text-mute hover:text-ink transition-colors">
                Seguir después
              </button>
            </>
          ) : (
            <button onClick={cerrar} className="w-full h-11 rounded-full border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors">Cerrar</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ════════════════════════════════════════
   MÓDULO USUARIOS
════════════════════════════════════════ */
type UsuarioPanel = {
  id: number; username: string; nombre: string; first_name: string; last_name: string
  email: string; rol: string | null; es_admin: boolean; es_superusuario: boolean
  activo: boolean; telefono: string; puesto: string
  email_verificado?: boolean; datos_completos?: boolean; perfil_verificado?: boolean
  ultimo_acceso: string | null; creado: string
}

/**
 * Color del rol. El superusuario va en negro sólido: es el máximo nivel y debe
 * distinguirse de un vistazo. Los demás roles usan el amarillo de la tienda.
 *
 * En tema oscuro el negro se invierte a claro (`bg-ink text-app` lo hace solo):
 * un chip #111827 sobre el panel #161618 tiene 1.02:1 de contraste, o sea
 * invisible. El amarillo no se invierte porque es el mismo en ambos temas y
 * lleva texto negro (9.8:1).
 */
function estiloRol(u: UsuarioPanel) {
  if (u.es_superusuario) return { label: 'Dueño', cls: 'bg-ink text-app' }
  if (u.rol === 'Cliente') return { label: 'Cliente', cls: 'bg-surface-2 text-mute' }
  if (u.rol) return { label: u.rol, cls: 'bg-yellow text-[#111827]' }
  return { label: 'Sin rol', cls: 'bg-surface-2 text-mute' }
}

/** Un cliente es quien SOLO tiene el grupo Cliente; todo lo demás es equipo
 *  (incluye cuentas sin rol: se crearon para el panel y están a medio dar de alta). */
function esCliente(u: UsuarioPanel) {
  return u.rol === 'Cliente' && !u.es_superusuario
}

/** Mismo criterio para el avatar de iniciales. */
function estiloAvatar(u: UsuarioPanel) {
  if (u.es_superusuario) return 'bg-ink text-app'
  if (u.rol) return 'bg-yellow text-[#111827]'
  return 'bg-surface-2 text-mute'
}

function iniciales(u: UsuarioPanel) {
  const base = (u.nombre || u.username).trim().split(/\s+/)
  return ((base[0]?.[0] || '') + (base[1]?.[0] || '')).toUpperCase() || u.username.slice(0, 2).toUpperCase()
}

function hace(iso: string | null) {
  if (!iso) return 'Nunca ha entrado'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'Ahora mismo'
  if (min < 60) return `Hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.floor(h / 24)
  return d < 30 ? `Hace ${d} día${d > 1 ? 's' : ''}` : new Date(iso).toLocaleDateString('es-MX')
}

type OpcionMenu = { label: string; onClick: () => void; icono?: React.ReactNode; peligro?: boolean; deshabilitado?: boolean; razon?: string }

/**
 * Menú "…" de una fila. Va en portal con posición fija a propósito: la tabla
 * vive dentro de un contenedor con overflow, y un menú absoluto quedaría
 * recortado por él.
 */
function MenuFila({ opciones }: { opciones: OpcionMenu[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)

  const abrir = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }

  useEffect(() => {
    if (!pos) return
    const cerrar = () => setPos(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPos(null); btn.current?.focus() } }
    // `true` en scroll: también captura el de la tabla, no solo el de la ventana.
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
      window.removeEventListener('keydown', esc)
    }
  }, [pos])

  return (
    <>
      <button ref={btn} onClick={() => (pos ? setPos(null) : abrir())} aria-haspopup="menu" aria-expanded={!!pos} aria-label="Más acciones"
        className="w-8 h-8 rounded-lg grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setPos(null)} />
          <div role="menu" style={{ top: pos.top, right: pos.right }}
            className="fixed z-[71] min-w-[230px] bg-surface border border-edge rounded-2xl shadow-[0_16px_40px_rgba(33,29,22,0.18)] p-2">
            {opciones.map((o, i) => (
              <button key={i} role="menuitem" disabled={o.deshabilitado}
                title={o.deshabilitado ? o.razon : undefined}
                onClick={() => { setPos(null); o.onClick() }}
                className={`w-full flex items-center gap-3 text-left px-3.5 py-3 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${o.peligro ? 'text-red-500 hover:bg-red-500/10 disabled:hover:bg-transparent' : 'text-ink hover:bg-surface-2'}`}>
                {o.icono && <span className="shrink-0 w-[18px] h-[18px] grid place-items-center">{o.icono}</span>}
                {o.label}
              </button>
            ))}
          </div>
        </>, document.body)}
    </>
  )
}

function UsuariosAdmin({ usuarios, reload, notify, yoId }: {
  usuarios: UsuarioPanel[]; reload: () => void; notify: (m: string, t?: 'ok' | 'err') => void; yoId?: number
}) {
  // Filtros del directorio (aplican en vivo sobre la pestaña activa)
  const [f, setF] = useState({ q: '', correo: '', tel: '', desde: '', hasta: '' })
  const hayFiltros = Object.values(f).some(Boolean)
  const [editando, setEditando] = useState<UsuarioPanel | null>(null)
  const [viendo, setViendo] = useState<UsuarioPanel | null>(null)
  const [creando, setCreando] = useState(false)
  const [roles, setRoles] = useState<string[]>([])

  useEffect(() => {
    api.get<{ roles: string[] }>('/usuarios/roles/').then(r => setRoles((r.data?.roles || []).filter(x => x !== 'Cliente'))).catch(() => {})
  }, [])

  const activos = usuarios.filter(u => u.activo)
  const admins = activos.filter(u => u.es_admin)
  // Dos mundos separados: el equipo que opera el panel y los clientes de la tienda.
  const [grupo, setGrupo] = useState<'todos' | 'equipo' | 'clientes'>('todos')
  const [asignando, setAsignando] = useState<UsuarioPanel | null>(null)
  const equipo = usuarios.filter(u => !esCliente(u))
  const clientes = usuarios.filter(esCliente)
  const sinVerificar = clientes.filter(u => !u.email_verificado).length
  const filtrados = (grupo === 'todos' ? usuarios : grupo === 'equipo' ? equipo : clientes).filter(u => {
    if (f.q.trim() && !`${u.nombre} ${u.username} ${u.rol || ''} ${u.puesto}`.toLowerCase().includes(f.q.toLowerCase().trim())) return false
    if (f.correo.trim() && !(u.email || '').toLowerCase().includes(f.correo.toLowerCase().trim())) return false
    if (f.tel.trim() && !(u.telefono || '').replace(/\D/g, '').includes(f.tel.replace(/\D/g, ''))) return false
    if (f.desde && (!u.creado || new Date(u.creado) < new Date(f.desde))) return false
    if (f.hasta) { const h = new Date(f.hasta); h.setHours(23, 59, 59, 999); if (!u.creado || new Date(u.creado) > h) return false }
    return true
  })
  const verificados = clientes.filter(u => u.email_verificado).length
  const inactivos = usuarios.length - activos.length
  // En "Todos" la tabla muestra ambos mundos con un separador de sección.
  const equipoF = filtrados.filter(u => !esCliente(u))
  const clientesF = filtrados.filter(esCliente)
  const filas: (UsuarioPanel | { sep: string })[] = grupo === 'todos'
    ? [
        ...(equipoF.length ? [{ sep: `Equipo de trabajo (${equipoF.length})` }] : []), ...equipoF,
        ...(clientesF.length ? [{ sep: `Clientes (${clientesF.length})` }] : []), ...clientesF,
      ]
    : filtrados

  async function desactivar(u: UsuarioPanel) {
    const ok = await confirmar({
      titulo: esCliente(u) ? `Eliminar a ${u.nombre}` : `Quitarle el acceso a ${u.nombre}`,
      mensaje: 'No se borra su historial: cotizaciones, rentas y ventas se conservan. Solo deja de poder entrar.',
      aceptar: esCliente(u) ? 'Eliminar' : 'Quitar acceso', tono: 'peligro',
    })
    if (!ok) return
    api.delete(`/usuarios/${u.id}/`)
      .then(() => { notify(`${u.nombre} ya no puede entrar`); reload() })
      .catch(err => notify(errorMsg(err, 'No se pudo desactivar'), 'err'))
  }
  // Contraseña sin abrir el editor: la info del cliente no se toca desde aquí.
  async function passwordExpres(u: UsuarioPanel) {
    const nueva = await pedir({
      titulo: `Nueva contraseña para ${u.nombre}`,
      mensaje: 'Mínimo 8 caracteres. Anótala y dásela en persona; el sistema no se la manda por correo.',
      placeholder: 'Nueva contraseña',
    })
    if (nueva === null) return
    if (nueva.trim().length < 8) { notify('La contraseña debe tener al menos 8 caracteres', 'err'); return }
    api.patch(`/usuarios/${u.id}/`, { password: nueva.trim() })
      .then(() => notify(`Contraseña nueva para ${u.nombre}`))
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar'), 'err'))
  }
  async function marcarVerificacion(u: UsuarioPanel, valor: boolean) {
    const ok = await confirmar({
      titulo: valor ? `Marcar verificado a ${u.nombre}` : `Marcar como no verificado`,
      mensaje: valor
        ? 'Su correo quedará como confirmado y podrá iniciar sesión.'
        : `${u.nombre} tendrá que confirmar su correo de nuevo para poder entrar.`,
      aceptar: 'Confirmar', tono: valor ? 'normal' : 'peligro',
    })
    if (!ok) return
    api.patch(`/usuarios/${u.id}/`, { email_verificado: valor })
      .then(() => { notify(valor ? 'Correo marcado como verificado' : 'Marcado como no verificado'); reload() })
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar'), 'err'))
  }
  function reactivar(u: UsuarioPanel) {
    api.patch(`/usuarios/${u.id}/`, { activo: true })
      .then(() => { notify(`${u.nombre} puede entrar de nuevo`); reload() })
      .catch(err => notify(errorMsg(err, 'No se pudo reactivar'), 'err'))
  }

  const th = 'text-left text-[13px] font-bold text-ink px-5 sm:px-6 py-4 whitespace-nowrap'
  const td = 'px-5 sm:px-6 py-5 align-middle'

  return (
    <div className="max-w-6xl space-y-2.5">
      {/* Encabezado: quién tiene acceso y quién manda */}
      <div className="bg-surface border border-edge rounded-2xl px-6 sm:px-7 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-ink">Usuarios</h2>
            <p className="text-sm text-mute mt-1 max-w-[62ch]">
              Quién puede entrar al panel y qué puede hacer.{' '}
              {admins.length === 1
                ? <span className="text-ink font-semibold">Solo una cuenta administra el sistema; considera dejar otra por si pierdes el acceso.</span>
                : `${admins.length} cuentas administran el sistema.`}
            </p>
          </div>
          <button onClick={() => setCreando(true)} className="btn-acento shrink-0 inline-flex items-center gap-2 h-11 pl-4 pr-5 rounded-full text-[14px] font-bold">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Agregar usuario
          </button>
        </div>

      </div>

      {/* KPIs del directorio */}
      <KpiGrid
        gridClassName="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Usuarios totales', value: String(usuarios.length), helper: `${equipo.length} de equipo · ${clientes.length} clientes` },
          { label: 'Sin acceso', value: String(inactivos), tone: inactivos > 0 ? 'danger' : 'muted', emphasis: inactivos > 0 },
          { label: 'Clientes sin verificar', value: String(sinVerificar), tone: sinVerificar > 0 ? 'warning' : 'muted', emphasis: sinVerificar > 0 },
          { label: 'Clientes verificados', value: String(verificados), tone: 'success' },
        ]}
      />

      {/* Filtros */}
      <div className="bg-surface border border-edge rounded-2xl px-5 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            ['q', 'Nombre o usuario', 'Filtrar por nombre'],
            ['correo', 'Correo', 'Filtrar por correo'],
            ['tel', 'Teléfono', 'Filtrar por teléfono'],
          ] as const).map(([k, etiqueta, ph]) => (
            <div key={k}>
              <label className="block text-[12px] font-semibold text-mute mb-1.5">{etiqueta}</label>
              <input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph}
                className="w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] font-semibold text-mute mb-1.5">Desde</label>
              <input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })}
                className="w-full bg-surface-2 border border-edge rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-gold/50 transition-colors" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-mute mb-1.5">Hasta</label>
              <input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })}
                className="w-full bg-surface-2 border border-edge rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-gold/50 transition-colors" />
            </div>
          </div>
        </div>
        {hayFiltros && (
          <div className="flex justify-end mt-3">
            <button onClick={() => setF({ q: '', correo: '', tel: '', desde: '', hasta: '' })}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-edge text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" /></svg>
              Limpiar filtros ({filtrados.length} resultado{filtrados.length === 1 ? '' : 's'})
            </button>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-surface border border-edge rounded-2xl">
        <div className="px-4 sm:px-5 py-3.5 border-b border-edge flex flex-wrap items-center justify-between gap-3">
          <div className="flex border border-edge rounded-xl overflow-hidden shrink-0">
            {([['todos', `Todos (${usuarios.length})`], ['equipo', `Equipo de trabajo (${equipo.length})`], ['clientes', `Clientes (${clientes.length})`]] as const).map(([g, etiqueta]) => (
              <button key={g} onClick={() => setGrupo(g)}
                className={`px-4 py-2.5 text-[13px] font-bold transition-colors ${grupo === g ? 'bg-ink text-app' : 'text-mute hover:text-ink hover:bg-surface-2'}`}>
                {etiqueta}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-mute">{filtrados.length} de {(grupo === 'todos' ? usuarios : grupo === 'equipo' ? equipo : clientes).length}</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-ink font-semibold">{hayFiltros ? 'Nadie coincide con esos filtros' : grupo === 'clientes' ? 'Aún no hay clientes registrados' : 'Aún no hay más cuentas'}</p>
            <p className="text-[13px] text-mute mt-1.5 max-w-[46ch] mx-auto">
              {hayFiltros ? 'Afloja alguno de los filtros o límpialos para ver todo.' : 'Agrega a quien trabaje contigo para que registre rentas y ventas con su propio nombre.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-2 border-b border-edge">
                  {/* w-full en Usuario + w-px en las demás: la primera absorbe el
                      sobrante y el resto se ajusta a su contenido, así la tabla
                      no se desborda en pantallas chicas. */}
                  <th scope="col" className={`${th} w-full`}>Usuario</th>
                  {grupo !== 'equipo' && <th scope="col" className={`${th} hidden md:table-cell w-px`}>Correo</th>}
                  <th scope="col" className={`${th} hidden xl:table-cell w-px`}>Teléfono</th>
                  <th scope="col" className={`${th} hidden sm:table-cell w-px`}>Estado</th>
                  <th scope="col" className={`${th} hidden lg:table-cell w-px`}>Registro</th>
                  {grupo !== 'clientes' && <th scope="col" className={`${th} hidden xl:table-cell w-px`}>Último acceso</th>}
                  <th scope="col" className={`${th} text-right w-px`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {filas.map((item, idx) => {
                  if ('sep' in item) {
                    return (
                      <tr key={`sep-${idx}`} className="bg-surface-2/70">
                        <td colSpan={99} className="px-5 sm:px-6 py-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-mute">{item.sep}</td>
                      </tr>
                    )
                  }
                  const u = item
                  const rol = estiloRol(u)
                  const soyYo = u.id === yoId
                  return (
                    <tr key={u.id} className={`transition-colors hover:bg-surface-2 ${u.activo ? '' : 'opacity-55'}`}>
                      {/* max-w-0 es lo que permite que `truncate` funcione dentro de una tabla. */}
                      <td className={`${td} max-w-0`}>
                        <div className="flex items-center gap-3.5">
                          <div className={`shrink-0 w-10 h-10 rounded-full grid place-items-center text-[13px] font-black ${estiloAvatar(u)}`}>
                            {iniciales(u)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-ink truncate">{u.nombre}</span>
                              {soyYo && <span className="shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-mute">Tú</span>}
                              {!u.activo && <span className="shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">Sin acceso</span>}
                            </div>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${rol.cls}`}>{rol.label}</span>
                              {u.puesto && <span className="text-[12px] text-mute truncate">{u.puesto}</span>}
                            </div>
                            {/* En pantallas chicas las columnas se esconden: el dato baja aquí. */}
                            {esCliente(u) && <p className="md:hidden text-[12px] text-mute truncate mt-1">{u.email || u.username}</p>}
                          </div>
                        </div>
                      </td>
                      {/* nowrap: con `w-px` la columna se encoge al mínimo y un
                          teléfono con espacios se partiría en varias líneas. */}
                      {grupo !== 'equipo' && (
                        <td className={`${td} hidden md:table-cell whitespace-nowrap`}>
                          <span className="text-[13.5px] text-ink">{u.email || <span className="text-mute">—</span>}</span>
                        </td>
                      )}
                      <td className={`${td} hidden xl:table-cell whitespace-nowrap`}>
                        <span className="text-[13.5px] text-ink font-mono">{u.telefono || <span className="text-mute font-sans">—</span>}</span>
                      </td>
                      {/* Estado: acceso al sistema y, en clientes, si su correo es real */}
                      <td className={`${td} hidden sm:table-cell`}>
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          {/* En clientes el "Activo" verde sobra (casi todos lo están);
                              solo se señala la excepción: Inactivo en rojo. */}
                          {u.activo ? (!esCliente(u) && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Activo</span>
                          )) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-500 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Inactivo</span>
                          )}
                          {esCliente(u) && (
                            u.email_verificado ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 whitespace-nowrap" title="Confirmó su correo con el link">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                                Verificado
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-600 whitespace-nowrap" title="Aún no abre el link de confirmación: no puede iniciar sesión">Sin verificar</span>
                            )
                          )}
                        </div>
                      </td>
                      <td className={`${td} hidden lg:table-cell whitespace-nowrap`}>
                        <span className="text-[13px] text-mute">{u.creado ? new Date(u.creado).toLocaleDateString('es-MX') : '—'}</span>
                      </td>
                      {grupo !== 'clientes' && (
                        <td className={`${td} hidden xl:table-cell`}>
                          <span className="text-[13px] text-mute whitespace-nowrap">{hace(u.ultimo_acceso)}</span>
                        </td>
                      )}
                      <td className={`${td} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setViendo(u)}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
                            <span className="hidden sm:inline">Ver</span>
                          </button>
                          {!esCliente(u) && (
                            <button onClick={() => setEditando(u)}
                              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /></svg>
                              <span className="hidden sm:inline">Editar</span>
                            </button>
                          )}
                          <MenuFila
                            opciones={esCliente(u) ? [
                              // El cliente es dueño de su información: aquí solo
                              // contraseña, verificación y eliminación.
                              { label: 'Cambiar contraseña', icono: <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M13.5 6.5l3 3" /></svg>, onClick: () => passwordExpres(u) },
                              u.email_verificado
                                ? { label: 'Marcar como no verificado', icono: <svg className="w-[16px] h-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>, onClick: () => marcarVerificacion(u, false) }
                                : { label: 'Marcar como verificado', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>, onClick: () => marcarVerificacion(u, true) },
                              u.activo
                                ? { label: 'Eliminar', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M18 7l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" /><path d="M10 11v6M14 11v6" /></svg>, onClick: () => desactivar(u), peligro: true }
                                : { label: 'Devolver acceso', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" /></svg>, onClick: () => reactivar(u) },
                            ] : [
                              { label: 'Cambiar contraseña', icono: <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M13.5 6.5l3 3" /></svg>, onClick: () => setEditando(u) },
                              { label: 'Asignar rol', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>, onClick: () => setAsignando(u), deshabilitado: u.es_superusuario, razon: 'El dueño no cambia de rol' },
                              u.activo
                                ? { label: 'Quitar acceso', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M18 7l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" /><path d="M10 11v6M14 11v6" /></svg>, onClick: () => desactivar(u), peligro: true, deshabilitado: soyYo, razon: 'No puedes quitarte tu propio acceso' }
                                : { label: 'Devolver acceso', icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" /></svg>, onClick: () => reactivar(u) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {(creando || editando) && (
        <UsuarioModal usuario={editando} roles={roles} soyYo={editando?.id === yoId}
          onClose={() => { setCreando(false); setEditando(null) }}
          onSaved={(msg) => { notify(msg); setCreando(false); setEditando(null); reload() }}
          notify={notify} />
      )}

      {viendo && (
        <UsuarioDetalle u={viendo} soyYo={viendo.id === yoId}
          onClose={() => setViendo(null)}
          onEditar={() => { const u = viendo; setViendo(null); setEditando(u) }} />
      )}

      {asignando && (
        <AsignarRolModal u={asignando} roles={roles.filter(r => r !== 'Cliente')}
          onClose={() => setAsignando(null)}
          onSaved={(msg) => { notify(msg); setAsignando(null); reload() }}
          notify={notify} />
      )}
    </div>
  )
}

/* ── Asignar rol (pills de un solo elegido, como el directorio de referencia) ── */
function AsignarRolModal({ u, roles, onClose, onSaved, notify }: {
  u: UsuarioPanel; roles: string[]; onClose: () => void
  onSaved: (m: string) => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [sel, setSel] = useState<string>(u.rol || '')
  const [guardando, setGuardando] = useState(false)

  function guardar() {
    setGuardando(true)
    api.patch(`/usuarios/${u.id}/`, { rol: sel })
      .then(() => onSaved(sel ? `${u.nombre} ahora es ${sel}` : `${u.nombre} quedó sin rol`))
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar el rol'), 'err'))
      .finally(() => setGuardando(false))
  }

  const Pill = ({ valor, etiqueta }: { valor: string; etiqueta: string }) => {
    const activo = sel === valor
    return (
      <button onClick={() => setSel(valor)}
        className={`inline-flex items-center gap-2 h-10 px-4 rounded-full border text-[13.5px] font-bold transition-colors ${
          activo ? 'bg-ink text-app border-ink' : 'bg-surface border-edge text-ink hover:bg-surface-2'
        }`}>
        {activo
          ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          : <span className="w-3.5 h-3.5 rounded-full border-2 border-current opacity-40" />}
        {etiqueta}
      </button>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[520px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <h2 className="font-bold text-ink">Asignar rol</h2>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-[9px] grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 sm:px-7 py-6">
          {/* Quién es */}
          <div className="flex items-center gap-3.5 bg-surface-2 border border-edge rounded-2xl px-4 py-3.5">
            <div className={`shrink-0 w-12 h-12 rounded-full grid place-items-center text-[15px] font-black ${estiloAvatar(u)}`}>{iniciales(u)}</div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ink truncate">{u.nombre}</p>
              <p className="text-[13px] text-mute truncate">{u.email || u.username}</p>
            </div>
          </div>

          <p className="text-[13px] font-extrabold uppercase tracking-[0.5px] text-ink mt-6 mb-3">Roles disponibles</p>
          <div className="flex flex-wrap gap-2">
            {roles.map(r => <Pill key={r} valor={r} etiqueta={r} />)}
            <Pill valor="" etiqueta="Sin rol" />
          </div>
          {sel === '' && <p className="text-[12px] text-mute mt-3">Sin rol la cuenta existe pero no puede entrar al panel.</p>}
        </div>

        <div className="px-6 sm:px-7 py-4 border-t border-edge flex justify-end gap-2.5 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={guardar} disabled={guardando || sel === (u.rol || '')}
            className="px-7 py-2.5 rounded-full bg-ink text-app text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40">
            {guardando ? 'Guardando…' : 'Actualizar rol'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

/* ── Ficha completa de un usuario (el "ojo" de la tabla) ── */
function UsuarioDetalle({ u, soyYo, onClose, onEditar }: {
  u: UsuarioPanel; soyYo?: boolean; onClose: () => void; onEditar: () => void
}) {
  const rol = estiloRol(u)
  const Dato = ({ k, v, mono }: { k: string; v?: React.ReactNode; mono?: boolean }) => (
    <div className="flex items-start gap-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.5px] text-mute">{k}</p>
        <p className={`text-[14px] font-bold text-ink mt-0.5 break-words ${mono ? 'font-mono text-[13.5px]' : ''}`}>{v || <span className="text-mute font-sans font-normal">—</span>}</p>
      </div>
    </div>
  )
  const Chip = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>{children}</span>
  )
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <h2 className="font-bold text-ink">Detalle de usuario</h2>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-[9px] grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Héroe: quién es y en qué estado está */}
          <div className="px-6 sm:px-7 py-6 border-b border-edge">
            <div className="flex items-center gap-4">
              <div className={`shrink-0 w-16 h-16 rounded-full grid place-items-center text-[20px] font-black ${estiloAvatar(u)}`}>{iniciales(u)}</div>
              <div className="min-w-0">
                <p className="text-[18px] font-black text-ink leading-tight break-words">{u.nombre}{soyYo && <span className="ml-2 align-middle text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-mute">Tú</span>}</p>
                <p className="text-[13px] text-mute mt-0.5 break-all">@{u.username}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-4">
              <Chip cls={rol.cls}>{rol.label}</Chip>
              {u.activo
                ? <Chip cls="bg-emerald-500/10 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Activo</Chip>
                : <Chip cls="bg-red-500/10 text-red-500"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Inactivo</Chip>}
              {esCliente(u) && (u.email_verificado
                ? <Chip cls="border border-emerald-500/30 bg-emerald-500/5 text-emerald-600"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>Correo verificado</Chip>
                : <Chip cls="border border-amber-500/30 bg-amber-500/5 text-amber-600">Sin verificar</Chip>)}
              {esCliente(u) && u.datos_completos && <Chip cls="bg-surface-2 text-mute">Perfil completo</Chip>}
            </div>
          </div>

          {/* Datos de la cuenta */}
          <div className="px-6 sm:px-7 py-5 border-b border-edge">
            <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-1">DATOS DE LA CUENTA</p>
            <div className="divide-y divide-edge">
              <Dato k="Usuario" v={u.username} mono />
              <Dato k="Nombre completo" v={u.nombre} />
              <Dato k="Rol" v={rol.label} />
              {u.puesto && <Dato k="Puesto" v={u.puesto} />}
              <Dato k="Cuenta creada" v={u.creado ? new Date(u.creado).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined} />
              <Dato k="Último acceso" v={hace(u.ultimo_acceso)} />
            </div>
          </div>

          {/* Contacto */}
          <div className="px-6 sm:px-7 py-5">
            <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold mb-1">CONTACTO</p>
            <div className="divide-y divide-edge">
              <Dato k="Correo" v={u.email} mono />
              <Dato k="Teléfono" v={u.telefono} mono />
            </div>
          </div>
        </div>

        <div className="px-6 sm:px-7 py-4 border-t border-edge flex justify-end gap-2.5 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cerrar</button>
          {/* La info del cliente es suya: el admin no la edita */}
          {!esCliente(u) && <button onClick={onEditar} className="px-7 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">Editar</button>}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

function UsuarioModal({ usuario, roles, soyYo, onClose, onSaved, notify }: {
  usuario: UsuarioPanel | null; roles: string[]; soyYo?: boolean
  onClose: () => void; onSaved: (m: string) => void; notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const nuevo = !usuario
  const [f, setF] = useState({
    username: usuario?.username || '', first_name: usuario?.first_name || '', last_name: usuario?.last_name || '',
    email: usuario?.email || '', rol: usuario?.rol || '', telefono: usuario?.telefono || '',
    puesto: usuario?.puesto || '', password: '',
  })
  const [guardando, setGuardando] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))

  function guardar() {
    setGuardando(true)
    const pedir = nuevo
      ? api.post('/usuarios/', f)
      : api.patch(`/usuarios/${usuario!.id}/`, {
          first_name: f.first_name, last_name: f.last_name, email: f.email,
          rol: f.rol, telefono: f.telefono, puesto: f.puesto,
        })
    pedir
      .then(() => onSaved(nuevo ? `${f.first_name || f.username} ya puede entrar` : 'Cambios guardados'))
      .catch(err => notify(errorMsg(err, 'No se pudo guardar'), 'err'))
      .finally(() => setGuardando(false))
  }
  function cambiarPassword() {
    if (f.password.length < 8) { notify('La contraseña debe tener al menos 8 caracteres', 'err'); return }
    api.patch(`/usuarios/${usuario!.id}/`, { password: f.password })
      .then(() => { notify(`Contraseña nueva para ${usuario!.nombre}`); set('password', '') })
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar'), 'err'))
  }

  const campo = 'w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
  const etiqueta = 'block text-[12px] font-semibold text-mute mb-1.5'

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-lg font-black text-ink">{nuevo ? 'Agregar usuario' : usuario!.nombre}</h2>
            <p className="text-[13px] text-mute mt-0.5">
              {nuevo ? 'Tendrá su propia cuenta para entrar al panel.' : `Cuenta ${usuario!.username}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-[9px] grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 sm:px-7 py-5 space-y-5 overflow-y-auto flex-1">
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={etiqueta}>Nombre</label><input className={campo} value={f.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Pedro" /></div>
            <div><label className={etiqueta}>Apellido</label><input className={campo} value={f.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Ruiz" /></div>
          </div>

          {nuevo && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={etiqueta}>Usuario para entrar</label>
                <input className={campo} value={f.username} onChange={e => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="pedro" autoComplete="off" />
              </div>
              <div>
                <label className={etiqueta}>Contraseña</label>
                <input className={campo} type="text" value={f.password} onChange={e => set('password', e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={etiqueta}>Correo</label><input className={campo} type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="pedro@ejemplo.com" /></div>
            <div><label className={etiqueta}>Teléfono</label><input className={campo} value={f.telefono} onChange={e => set('telefono', e.target.value)} placeholder="744..." /></div>
          </div>

          <div>
            <label className={etiqueta}>Rol</label>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <button key={r} type="button" onClick={() => set('rol', r)} disabled={soyYo && f.rol === 'Administrador' && r !== 'Administrador'}
                  aria-pressed={f.rol === r}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-bold border transition-all active:scale-[0.98] ${f.rol === r ? 'bg-yellow border-transparent text-[#111827]' : 'bg-surface-2 border-edge text-ink hover:border-gold/40'} disabled:opacity-40 disabled:hover:border-edge`}>
                  {r}
                </button>
              ))}
            </div>
            {/* Qué implica cada rol, con las palabras del negocio. Es lo mismo
                que impone la API; aquí solo se explica. */}
            <div className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed">
              {f.rol === 'Administrador' ? (
                <>
                  <p className="text-ink font-bold mb-1">Administrador</p>
                  <p className="text-mute">Opera todo el negocio: rentas, ventas, cotizaciones, facturación, inventario y catálogo. Ve los montos y las métricas.</p>
                  <p className="text-mute mt-1.5">No puede gestionar usuarios ni cambiar la configuración del negocio: eso es solo tuyo.</p>
                </>
              ) : f.rol === 'Técnico' ? (
                <>
                  <p className="text-ink font-bold mb-1">Técnico</p>
                  <p className="text-mute">Entrega, recoge y repara. Ve dónde está cada máquina, con quién y cuándo se recoge; marca los regresos, sube las fotos de entrega y devolución, y trabaja las órdenes de taller.</p>
                  <p className="text-mute mt-1.5">No ve montos ni crea rentas o ventas.</p>
                </>
              ) : f.rol ? (
                <p className="text-mute">Rol personalizado: entra al panel con los permisos que le hayas dado a ese grupo.</p>
              ) : (
                <p className="text-mute">Sin rol la cuenta existe pero <b className="text-ink">no puede entrar al panel</b>. Elige uno arriba.</p>
              )}
              {soyYo && f.rol === 'Administrador' && <p className="text-mute mt-1.5">No puedes quitarte a ti mismo el acceso de administrador.</p>}
            </div>
          </div>

          <div><label className={etiqueta}>Puesto</label><input className={campo} value={f.puesto} onChange={e => set('puesto', e.target.value)} placeholder="Técnico de servicio, asesor de ventas…" /></div>

          {!nuevo && (
            <div className="pt-5 border-t border-edge">
              <label className={etiqueta}>Cambiar su contraseña</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input className={`${campo} flex-1`} type="text" value={f.password} onChange={e => set('password', e.target.value)} placeholder="Nueva contraseña, mínimo 8 caracteres" autoComplete="new-password" />
                <button onClick={cambiarPassword} disabled={!f.password}
                  className="shrink-0 h-[42px] px-4 rounded-xl border border-edge bg-surface-2 text-[13px] font-bold text-ink hover:border-gold/40 disabled:opacity-40 transition-colors">
                  Cambiar
                </button>
              </div>
              <p className="text-[12px] text-mute mt-2">Anótala y dásela en persona; el sistema no se la manda por correo.</p>
            </div>
          )}
        </div>

        <div className="px-6 sm:px-7 py-5 border-t border-edge flex items-center justify-end gap-2.5 shrink-0">
          <button onClick={onClose} className="px-6 h-11 rounded-[10px] border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={guardar} disabled={guardando || (nuevo && (!f.username || f.password.length < 8))}
            className="px-7 h-11 rounded-[10px] bg-gold text-black text-[13.5px] font-black hover:brightness-95 active:scale-[0.98] disabled:opacity-40 transition-all">
            {guardando ? 'Guardando…' : nuevo ? 'Crear cuenta' : 'Guardar cambios'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

type ConfigSitio = {
  whatsapp_principal: string
  whatsapp_respaldos: { label: string; number: string }[]
  negocio_nombre: string; negocio_telefono: string; negocio_direccion: string
  negocio_email: string; negocio_web: string
  negocio_rfc: string; negocio_representante: string; negocio_footer: string
  cotizacion_condiciones: string; cotizacion_condiciones_renta: string; datos_bancarios: string; cotizacion_cierre: string
}
type CorreoAviso = { id: number; email: string; etiqueta: string; verificado: boolean; creado: string }

/* ── Piezas compartidas de Configuración ──
   Una superficie por pestaña, secciones separadas por divisores. Nada de
   tarjetas dentro de tarjetas: el borde ya lo pone el contenedor. */

function Panel({ titulo, desc, children }: { titulo?: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-edge rounded-2xl overflow-hidden">
      {titulo && (
        <header className="px-6 sm:px-7 pt-6 pb-5 border-b border-edge">
          <h3 className="text-base font-black text-ink">{titulo}</h3>
          {desc && <p className="text-[13px] text-mute mt-1 max-w-[68ch] leading-relaxed">{desc}</p>}
        </header>
      )}
      <div className="divide-y divide-edge">{children}</div>
    </section>
  )
}

/** Fila de ajuste: qué es, a la izquierda; con qué se cambia, a la derecha. */
function Ajuste({ titulo, desc, children, apilado, pie }: {
  titulo: string; desc?: React.ReactNode; children?: React.ReactNode; apilado?: boolean; pie?: React.ReactNode
}) {
  return (
    <div className="px-6 sm:px-7 py-5">
      <div className={apilado ? '' : 'flex items-start justify-between gap-6 flex-wrap'}>
        <div className="min-w-0 max-w-[58ch]">
          <p className="text-sm font-black text-ink">{titulo}</p>
          {desc && <p className="text-[13px] text-mute mt-1 leading-relaxed">{desc}</p>}
        </div>
        {children && <div className={apilado ? 'mt-4' : 'shrink-0'}>{children}</div>}
      </div>
      {pie && <div className="mt-3">{pie}</div>}
    </div>
  )
}

const campoCfg = 'w-full bg-surface-2 border border-edge rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
const btnPrimario = 'btn-acento h-11 px-5 rounded-full text-[13.5px] font-black'
const btnSecundario = 'h-11 px-5 rounded-[10px] border border-edge bg-surface-2 text-[13.5px] font-bold text-ink hover:border-gold/40 disabled:opacity-40 transition-colors'

/** Configuración editable del sitio: WhatsApp, datos del negocio y correos de aviso. */
function NegocioAdmin({ notify }: { notify: (m: string, t?: 'ok' | 'err') => void }) {
  const vacia: ConfigSitio = { whatsapp_principal: '', whatsapp_respaldos: [], negocio_nombre: '', negocio_telefono: '', negocio_direccion: '', negocio_email: '', negocio_web: '', negocio_rfc: '', negocio_representante: '', negocio_footer: '', cotizacion_condiciones: '', cotizacion_condiciones_renta: '', datos_bancarios: '', cotizacion_cierre: '' }
  const [cfg, setCfg] = useState<ConfigSitio>(vacia)
  const [guardado, setGuardado] = useState<ConfigSitio>(vacia)   // lo último confirmado por el servidor
  const [correos, setCorreos] = useState<CorreoAviso[]>([])
  const [nuevoCorreo, setNuevoCorreo] = useState({ email: '', etiqueta: '' })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<ConfigSitio>('/config/')
      .then(r => { const c = { ...vacia, ...r.data }; setCfg(c); setGuardado(c) })
      .catch(() => {})
    api.get<CorreoAviso[]>('/config/correos/').then(r => setCorreos(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: keyof ConfigSitio, v: any) => setCfg(c => ({ ...c, [k]: v }))
  const resp = cfg.whatsapp_respaldos || []
  const setResp = (r: { label: string; number: string }[]) => set('whatsapp_respaldos', r)
  const hayCambios = JSON.stringify(cfg) !== JSON.stringify(guardado)

  function guardar() {
    setSaving(true)
    api.patch<ConfigSitio>('/config/', cfg)
      .then(r => {
        const c = { ...vacia, ...r.data }
        setCfg(c); setGuardado(c)
        invalidarConfigPublica()   // tickets, fichas y tienda toman los datos nuevos al instante
        notify('Configuración guardada')
      })
      .catch(err => notify(errorMsg(err, 'No se pudo guardar'), 'err'))
      .finally(() => setSaving(false))
  }
  function agregarCorreo() {
    const email = nuevoCorreo.email.trim()
    if (!email) { notify('Escribe un correo', 'err'); return }
    setBusy(true)
    api.post('/config/correos/', { email, etiqueta: nuevoCorreo.etiqueta.trim() })
      .then(r => {
        notify(r.data?.verificacion_enviada ? 'Le enviamos el correo de confirmación' : 'Correo agregado, pero no se pudo enviar la confirmación', r.data?.verificacion_enviada ? 'ok' : 'err')
        setNuevoCorreo({ email: '', etiqueta: '' }); load()
      })
      .catch(err => notify(errorMsg(err, 'No se pudo agregar'), 'err'))
      .finally(() => setBusy(false))
  }
  function reenviar(id: number) {
    api.post(`/config/correos/${id}/reenviar/`)
      .then(r => notify(r.data?.enviado ? 'Confirmación reenviada' : 'No se pudo enviar', r.data?.enviado ? 'ok' : 'err'))
      .catch(() => notify('No se pudo reenviar', 'err'))
  }
  function eliminarCorreo(c: CorreoAviso) {
    if (!confirm(`¿Dejar de avisar a ${c.email}?`)) return
    api.delete(`/config/correos/${c.id}/`).then(() => { notify('Ya no recibirá avisos'); load() }).catch(() => notify('No se pudo quitar', 'err'))
  }

  const sinVerificar = correos.filter(c => !c.verificado).length

  return (
    <div className="space-y-2.5 pb-24">
      <Panel titulo="WhatsApp" desc="El número principal es el que ve el cliente en la tienda. Los de respaldo son la referencia de tu equipo para dar seguimiento.">
        <Ajuste titulo="Número principal" desc="Aparece en el botón de WhatsApp de la tienda y en el acuse que recibe el cliente.">
          <input className={`${campoCfg} sm:w-56`} value={cfg.whatsapp_principal} onChange={e => set('whatsapp_principal', e.target.value)} placeholder="7443737201" inputMode="numeric" />
        </Ajuste>

        <Ajuste titulo="Números de respaldo" desc="No se muestran al cliente. Sirven para que otra persona pueda retomar una solicitud." apilado
          pie={
            <button onClick={() => setResp([...resp, { label: `Respaldo ${resp.length + 1}`, number: '' }])}
              className="inline-flex items-center gap-1.5 text-[13px] font-black text-gold hover:opacity-80 transition-opacity">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              Agregar respaldo
            </button>
          }>
          {resp.length === 0
            ? <p className="text-[13px] text-mute">Ninguno por ahora.</p>
            : (
              <div className="space-y-2 w-full">
                {resp.map((r, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className={`${campoCfg} flex-1`} value={r.label} onChange={e => setResp(resp.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Quién es" />
                    <input className={`${campoCfg} flex-1`} value={r.number} onChange={e => setResp(resp.map((x, j) => j === i ? { ...x, number: e.target.value } : x))} placeholder="7441234567" inputMode="numeric" />
                    <button onClick={() => setResp(resp.filter((_, j) => j !== i))} aria-label="Quitar respaldo"
                      className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
        </Ajuste>
      </Panel>

      <Panel titulo="Datos del negocio" desc="Se imprimen en tickets, fichas técnicas y cotizaciones. Son los mismos en todas las computadoras.">
        <Ajuste titulo="Nombre" desc="Encabeza cada documento que entregas.">
          <input className={`${campoCfg} sm:w-72`} value={cfg.negocio_nombre} onChange={e => set('negocio_nombre', e.target.value)} placeholder="REMALI" />
        </Ajuste>
        <Ajuste titulo="Teléfono" desc="El que ve el cliente en la cotización si tiene dudas.">
          <input className={`${campoCfg} sm:w-56`} value={cfg.negocio_telefono} onChange={e => set('negocio_telefono', e.target.value)} placeholder="744 373 7201" />
        </Ajuste>
        <Ajuste titulo="Correo" desc="Aparece en el encabezado de la cotización.">
          <input type="email" className={`${campoCfg} sm:w-72`} value={cfg.negocio_email} onChange={e => set('negocio_email', e.target.value)} placeholder="contacto@remali.mx" />
        </Ajuste>
        <Ajuste titulo="Página web">
          <input className={`${campoCfg} sm:w-56`} value={cfg.negocio_web} onChange={e => set('negocio_web', e.target.value)} placeholder="remali.mx" />
        </Ajuste>
        <Ajuste titulo="Dirección" apilado>
          <input className={campoCfg} value={cfg.negocio_direccion} onChange={e => set('negocio_direccion', e.target.value)} placeholder="Calle, colonia, ciudad" />
        </Ajuste>
        <Ajuste titulo="RFC" desc="Solo si facturas. Se omite del documento cuando está vacío.">
          <input className={`${campoCfg} sm:w-56 font-mono`} value={cfg.negocio_rfc} onChange={e => set('negocio_rfc', e.target.value.toUpperCase())} placeholder="XAXX010101000" />
        </Ajuste>
        <Ajuste titulo="Representante (firma)" desc="Nombre que firma la cotización al pie. Si lo dejas vacío, no se muestra la firma.">
          <input className={`${campoCfg} sm:w-72`} value={cfg.negocio_representante} onChange={e => set('negocio_representante', e.target.value)} placeholder="C.P. Nombre Apellido" />
        </Ajuste>
        <Ajuste titulo="Pie del ticket" desc="La última línea del comprobante.">
          <input className={`${campoCfg} sm:w-72`} value={cfg.negocio_footer} onChange={e => set('negocio_footer', e.target.value)} placeholder="¡Gracias por su preferencia!" />
        </Ajuste>
      </Panel>

      <Panel titulo="Cotizaciones · condiciones y pago" desc="Aparecen en la carta y en el PDF que recibe el cliente. Puedes usar varias líneas.">
        <Ajuste titulo="Condiciones · VENTA" desc="Anticipo, saldo, descuentos. Salen en las cotizaciones de venta." apilado>
          <textarea className={`${campoCfg} resize-y min-h-[84px]`} rows={3} value={cfg.cotizacion_condiciones}
            onChange={e => set('cotizacion_condiciones', e.target.value)}
            placeholder={'Anticipo del 60% para iniciar el pedido; el resto contra entrega.\nPago de contado: 5% de descuento.'} />
        </Ajuste>
        <Ajuste titulo="Condiciones · RENTA" desc="Uso, mantenimiento y responsabilidad. Salen en las cotizaciones de renta." apilado>
          <textarea className={`${campoCfg} resize-y min-h-[120px]`} rows={5} value={cfg.cotizacion_condiciones_renta}
            onChange={e => set('cotizacion_condiciones_renta', e.target.value)}
            placeholder={'El equipo se entrega limpio; de lo contrario, cargo de $300 + IVA.\nVerificar aceite a diario. Cambio de aceite cada 25 h…'} />
        </Ajuste>
        <Ajuste titulo="Datos bancarios" desc="Banco, titular, cuenta y CLABE. Si lo dejas vacío, no se muestra." apilado>
          <textarea className={`${campoCfg} resize-y min-h-[84px]`} rows={4} value={cfg.datos_bancarios}
            onChange={e => set('datos_bancarios', e.target.value)}
            placeholder={'Titular: Nombre o razón social\nBanco: XYZ\nCuenta: 0000000000\nCLABE: 000000000000000000'} />
        </Ajuste>
        <Ajuste titulo="Despedida" desc="Frase de cortesía al final de la cotización. Si la dejas vacía, no se muestra." apilado>
          <textarea className={`${campoCfg} resize-y min-h-[72px]`} rows={2} value={cfg.cotizacion_cierre}
            onChange={e => set('cotizacion_cierre', e.target.value)}
            placeholder={'En espera de que lo anterior merezca su conformidad…'} />
        </Ajuste>
      </Panel>

      <Panel titulo="Avisos por correo"
        desc="Reciben un correo en cuanto un cliente manda una solicitud. Solo los confirmados reciben avisos: así un correo mal escrito no se traga los pendientes en silencio.">
        <Ajuste titulo="Quién recibe los avisos"
          desc={sinVerificar > 0
            ? <>Hay <b className="text-ink">{sinVerificar} sin confirmar</b>; esos todavía no reciben nada.</>
            : correos.length > 0 ? 'Todos confirmados.' : undefined}
          apilado>
          <div className="w-full space-y-2">
            {correos.length === 0 && <p className="text-[13px] text-mute">Nadie configurado. Sin esto, las solicitudes solo aparecen dentro del panel.</p>}
            {correos.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{c.email}</p>
                  {c.etiqueta && <p className="text-[12px] text-mute truncate">{c.etiqueta}</p>}
                </div>
                {c.verificado
                  ? <span className="shrink-0 text-[10px] uppercase font-semibold px-2 py-1 rounded bg-emerald-500/10 text-emerald-600">Confirmado</span>
                  : <>
                      <span className="shrink-0 text-[10px] uppercase font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-700 dark:text-amber-500">Sin confirmar</span>
                      <button onClick={() => reenviar(c.id)} className="shrink-0 text-[12px] font-black text-gold hover:opacity-80 transition-opacity">Reenviar</button>
                    </>}
                <button onClick={() => eliminarCorreo(c)} aria-label={`Quitar ${c.email}`}
                  className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        </Ajuste>

        <Ajuste titulo="Agregar un correo" desc="Le mandamos un enlace para que confirme. Hasta que lo abra, no recibe avisos." apilado>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <input className={`${campoCfg} flex-1`} type="email" value={nuevoCorreo.email} onChange={e => setNuevoCorreo({ ...nuevoCorreo, email: e.target.value })} placeholder="correo@ejemplo.com" />
            <input className={`${campoCfg} sm:w-44`} value={nuevoCorreo.etiqueta} onChange={e => setNuevoCorreo({ ...nuevoCorreo, etiqueta: e.target.value })} placeholder="Quién es" />
            <button onClick={agregarCorreo} disabled={busy || !nuevoCorreo.email.trim()} className={`${btnPrimario} shrink-0`}>
              {busy ? 'Enviando…' : 'Agregar'}
            </button>
          </div>
        </Ajuste>
      </Panel>

      {/* Barra de guardado: aparece solo cuando hay algo pendiente. */}
      {hayCambios && (
        <div className="fixed bottom-0 inset-x-0 sm:left-auto sm:right-6 sm:bottom-6 z-40 px-4 pb-4 sm:p-0 pointer-events-none">
          <div className="pointer-events-auto mx-auto sm:mx-0 max-w-md sm:max-w-none flex items-center gap-3 bg-surface border border-edge rounded-2xl shadow-[0_12px_32px_rgba(33,29,22,0.16)] px-4 py-3">
            <p className="text-[13px] text-ink font-semibold flex-1 sm:flex-none sm:mr-2">Tienes cambios sin guardar</p>
            <button onClick={() => setCfg(guardado)} className="h-9 px-3.5 rounded-lg text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">Descartar</button>
            <button onClick={guardar} disabled={saving} className={`${btnPrimario} h-9 px-4 text-[13px]`}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ConfiguracionAdmin({ notify, lang, onLang }: {
  notify: (m: string, t?: 'ok' | 'err') => void; lang: 'ES' | 'EN'; onLang: (l: 'ES' | 'EN') => void
}) {
  const { t } = useLang()
  const puede = usePuede()
  const [tab, setTab] = useState<'perfil' | 'negocio' | 'seguridad' | 'preferencias'>('perfil')
  const [pw, setPw] = useState({ actual: '', nueva: '', confirma: '' })
  const [savingPw, setSavingPw] = useState(false)

  // "Negocio y contacto" edita datos del negocio: solo el dueño. Mostrarla a
  // quien no puede editarla solo produce un 403 al abrirla.
  type TabKey = 'perfil' | 'negocio' | 'seguridad' | 'preferencias'
  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'perfil', label: t('cfg.perfil'), icon: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></> },
    ...(puede('configurar_negocio') ? [{ key: 'negocio' as TabKey, label: 'Negocio y contacto', icon: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></> }] : []),
    { key: 'seguridad', label: t('cfg.seguridad'), icon: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> },
    { key: 'preferencias', label: t('cfg.preferencias'), icon: <><path d="M4 7h11M18 7h2M4 12h2M9 12h11M4 17h11M18 17h2" /><circle cx="16" cy="7" r="2" /><circle cx="7" cy="12" r="2" /><circle cx="16" cy="17" r="2" /></> },
  ]

  function cambiarPassword() {
    if (!pw.actual || !pw.nueva) { notify('Completa los campos', 'err'); return }
    if (pw.nueva !== pw.confirma) { notify('Las contraseñas no coinciden', 'err'); return }
    setSavingPw(true)
    api.post('/auth/password/', { password_actual: pw.actual, password_nueva: pw.nueva })
      .then(() => { notify('Contraseña actualizada'); setPw({ actual: '', nueva: '', confirma: '' }) })
      .catch(e => notify(e?.response?.data?.detalle || e?.response?.data?.detail || 'No se pudo cambiar la contraseña', 'err'))
      .finally(() => setSavingPw(false))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[228px_1fr] gap-2.5 items-start max-w-5xl">
      {/* Navegación de pestañas */}
      <nav className="bg-surface border border-edge rounded-2xl p-2 flex lg:flex-col gap-0.5 overflow-x-auto">
        {tabs.map(tb => {
          const activa = tab === tb.key
          return (
            <button key={tb.key} onClick={() => setTab(tb.key)} aria-current={activa ? 'page' : undefined}
              className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-[13.5px] font-bold text-left transition-colors whitespace-nowrap ${activa ? 'bg-gold-soft text-gold' : 'text-ink hover:bg-surface-2'}`}>
              <svg className={`w-[18px] h-[18px] shrink-0 ${activa ? 'text-gold' : 'text-mute'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{tb.icon}</svg>
              {tb.label}
            </button>
          )
        })}
      </nav>

      <div className="min-w-0">
        {tab === 'perfil' && <PerfilAdmin notify={notify} />}

        {tab === 'negocio' && <NegocioAdmin notify={notify} />}

        {tab === 'seguridad' && (
          <Panel titulo="Cambiar contraseña" desc="Al cambiarla seguirás con la sesión iniciada aquí, pero tendrás que entrar de nuevo en tus otros dispositivos.">
            <Ajuste titulo="Contraseña actual" apilado>
              <input type="password" className={`${campoCfg} sm:max-w-sm`} value={pw.actual} onChange={e => setPw({ ...pw, actual: e.target.value })} placeholder="La que usas ahora" autoComplete="current-password" />
            </Ajuste>
            <Ajuste titulo="Contraseña nueva" desc={pw.nueva && pw.nueva.length < 8 ? 'Muy corta: usa al menos 8 caracteres.' : 'Al menos 8 caracteres.'} apilado>
              <div className="grid sm:grid-cols-2 gap-3">
                <input type="password" className={campoCfg} value={pw.nueva} onChange={e => setPw({ ...pw, nueva: e.target.value })} placeholder="Nueva contraseña" autoComplete="new-password" />
                <input type="password" className={campoCfg} value={pw.confirma} onChange={e => setPw({ ...pw, confirma: e.target.value })} placeholder="Repítela" autoComplete="new-password" />
              </div>
              {pw.confirma && pw.nueva !== pw.confirma && <p className="text-[13px] text-red-500 mt-2">No coinciden.</p>}
            </Ajuste>
            <div className="px-6 sm:px-7 py-5 flex justify-end">
              <button onClick={cambiarPassword} disabled={savingPw || !pw.actual || pw.nueva.length < 8 || pw.nueva !== pw.confirma} className={btnPrimario}>
                {savingPw ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </Panel>
        )}

        {tab === 'preferencias' && (
          <div className="space-y-2.5">
            <Panel titulo={t('cfg.preferencias')} desc={t('cfg.preferencias.desc')}>
              <Ajuste titulo={t('cfg.idioma')} desc={t('cfg.idioma.desc')}>
                <div className="flex border border-edge rounded-lg overflow-hidden">
                  {(['ES', 'EN'] as const).map(l => (
                    <button key={l} onClick={() => onLang(l)} aria-pressed={lang === l}
                      className={`px-4 py-2 text-[13px] font-bold transition-colors ${lang === l ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`}>{l}</button>
                  ))}
                </div>
              </Ajuste>
              <Ajuste titulo={t('cfg.tema')} desc={t('cfg.tema.desc')}>
                <ThemeToggle />
              </Ajuste>
            </Panel>

            <PrintSettingsCard notify={notify} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Ajustes de impresión (métodos de conexión + papel, sin driver) ── */
function PrintSettingsCard({ notify }: { notify: (m: string, t?: 'ok' | 'err') => void }) {
  const [ps, setPs] = usePrintSettings()
  const [vinculada, setVinculada] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ vendorId: string; productId: string; nombre?: string } | null>(null)
  const metodo = ps.method
  const soporta = metodoSoportado(metodo)

  const refrescar = useCallback(() => {
    setInfo(null); setVinculada(false)
    if (metodo === 'navegador') return
    metodoVinculado(metodo).then(v => { setVinculada(v); if (v) infoMetodo(metodo).then(setInfo) })
  }, [metodo])
  useEffect(() => { refrescar() }, [refrescar])

  async function vincular() {
    try { await vincularMetodo(metodo); notify('Impresora vinculada'); refrescar() }
    catch (e: any) { notify(e?.name === 'NotFoundError' ? 'No se seleccionó impresora' : (e?.message || 'No se pudo vincular'), 'err') }
  }
  async function prueba() {
    setBusy(true)
    try { await imprimirTermico(buildTestTicket(charsPerLine(ps.thermalWidth)), { method: metodo, baud: ps.baud }); notify('Prueba enviada') }
    catch (e: any) { notify(e?.name === 'NotFoundError' ? 'No se seleccionó impresora' : (e?.message || 'No se pudo imprimir'), 'err') }
    finally { setBusy(false) }
  }
  async function probarVelocidades() {
    setBusy(true)
    const bauds = [9600, 115200, 19200, 38400]
    const w = charsPerLine(ps.thermalWidth)
    try {
      for (const b of bauds) {
        notify(`Probando ${b} baud…`)
        try { await imprimirTermico(buildTestTicket(w, 'REMALI', `VEL ${b}`), { method: 'serial', baud: b }) } catch { /* sigue */ }
        await new Promise(r => setTimeout(r, 1500))
      }
      notify('Listo. Pon la velocidad del ticket que salió BIEN.', 'ok')
    } catch (e: any) { notify(e?.message || 'Error al probar', 'err') } finally { setBusy(false) }
  }

  const seg = (activo: boolean) => `px-3.5 py-2 text-[13px] font-bold transition-colors ${activo ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`

  return (
    <Panel titulo="Impresión" desc="Estos ajustes son de esta computadora: cada caja tiene su propia impresora.">
      <Ajuste titulo="Cómo se conecta" desc="Depende del modelo. Si uno no funciona, prueba otro." apilado>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
          {METODOS.map(m => {
            const ok = metodoSoportado(m.key); const activo = metodo === m.key
            return (
              <button key={m.key} disabled={!ok} onClick={() => setPs({ method: m.key })} aria-pressed={activo}
                className={`text-left rounded-xl border p-3 transition-colors ${activo ? 'border-gold/40 bg-gold-soft' : 'border-edge bg-surface-2 hover:border-gold/40'} ${!ok ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <div className={`text-[13px] font-black ${activo ? 'text-gold' : 'text-ink'}`}>{m.label}</div>
                <div className="text-[11.5px] text-mute mt-0.5 leading-tight">{m.desc}</div>
                {!ok && <div className="text-[11px] text-amber-700 dark:text-amber-500 mt-1">Solo Chrome, Edge o Brave</div>}
              </button>
            )
          })}
        </div>
      </Ajuste>

      <Ajuste titulo="Ancho del ticket" desc="El papel que carga tu impresora térmica.">
        <div className="flex border border-edge rounded-lg overflow-hidden">
          {([58, 80] as const).map(w => <button key={w} onClick={() => setPs({ thermalWidth: w })} aria-pressed={ps.thermalWidth === w} className={seg(ps.thermalWidth === w)}>{w} mm</button>)}
        </div>
      </Ajuste>

      <Ajuste titulo="Tamaño de documentos" desc="Para órdenes y cotizaciones impresas en hoja completa.">
        <div className="flex border border-edge rounded-lg overflow-hidden">
          {(['carta', 'a4'] as const).map(d => <button key={d} onClick={() => setPs({ docSize: d })} aria-pressed={ps.docSize === d} className={seg(ps.docSize === d)}>{d === 'carta' ? 'Carta' : 'A4'}</button>)}
        </div>
      </Ajuste>

      {metodo === 'serial' && (
        <Ajuste titulo="Velocidad del puerto serie" desc="Si imprime símbolos raros, casi siempre es esto.">
          <select className="bg-surface-2 border border-edge rounded-lg px-3 py-2.5 text-[13px] text-ink" value={ps.baud} onChange={e => setPs({ baud: Number(e.target.value) })}>
            {[9600, 19200, 38400, 115200].map(b => <option key={b} value={b} className="bg-surface">{b} baud</option>)}
          </select>
        </Ajuste>
      )}

      <Ajuste titulo="Velocidad de impresión"
        desc="Ajústala hasta que la animación del ticket termine justo cuando la impresora termina. Una POS58 ronda los 50-90 mm/s."
        apilado>
        <div className="w-full">
          <div className="flex items-center gap-3">
            <input type="range" min={30} max={120} step={5} value={ps.printSpeed} onChange={e => setPs({ printSpeed: Number(e.target.value) })}
              aria-label="Velocidad de impresión en milímetros por segundo" className="flex-1 accent-[var(--c-gold)]" />
            <span className="text-[13px] font-mono text-ink w-20 text-right">{ps.printSpeed} mm/s</span>
          </div>
        </div>
      </Ajuste>

      <Ajuste titulo="Encabezado del ticket"
        desc={<>Sale de <b className="text-ink">Negocio y contacto</b>, así es igual en todas las computadoras. Ahora imprime <b className="text-ink">{ps.negocio.nombre}</b>{ps.negocio.telefono ? ` · ${ps.negocio.telefono}` : ''}.</>} />

      <Ajuste titulo="Tu impresora"
        desc={metodo === 'navegador'
          ? 'Se imprime con el diálogo del navegador y el driver del sistema. Funciona en cualquier navegador; ahí eliges impresora o guardas PDF.'
          : !soporta ? 'Este método necesita Chrome, Edge o Brave. Cambia a "Navegador / PDF" o abre el sistema en uno de esos.'
          : metodo === 'usb' ? 'WebUSB: impresoras clase USB-printer (POS58 y genéricas). Conéctala y elígela.'
          : 'Web Serial: impresoras que exponen puerto COM (CH340, FTDI).'}
        apilado>
        {metodo !== 'navegador' && soporta && (
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              <span className={`w-2 h-2 rounded-full shrink-0 ${vinculada ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-ink font-semibold">{vinculada ? 'Vinculada' : 'Sin vincular'}{info?.nombre ? ` · ${info.nombre}` : ''}</span>
            </div>
            {info && <p className="text-[12px] font-mono text-mute">VID {info.vendorId} · PID {info.productId}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={vincular} className={btnSecundario}>{vinculada ? 'Cambiar impresora' : 'Vincular impresora'}</button>
              <button onClick={prueba} disabled={busy} className={btnPrimario}>{busy ? 'Enviando…' : 'Imprimir prueba'}</button>
              {metodo === 'serial' && (
                <button onClick={probarVelocidades} disabled={busy} className={btnSecundario}>{busy ? 'Probando…' : 'Probar velocidades'}</button>
              )}
            </div>
            <p className="text-[12px] text-mute max-w-[58ch]">¿No imprime? Prueba el otro método de arriba. Si tienes instalado el driver del fabricante, usa Navegador / PDF.</p>
          </div>
        )}
      </Ajuste>
    </Panel>
  )
}

function PerfilAdmin({ notify }: { notify: (m: string, t?: 'ok' | 'err') => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [form, setForm] = useState<Perfil>({})
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api.get<Perfil>('/auth/perfil/').then(r => { setPerfil(r.data); setForm(r.data) }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  function onPickAvatar(file: File | null) {
    setAvatarFile(file)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(file ? URL.createObjectURL(file) : null)
  }

  function save() {
    setSaving(true)
    const fd = new FormData()
    for (const k of ['first_name', 'last_name', 'email', 'telefono', 'puesto', 'bio'] as const) {
      fd.append(k, String(form[k] ?? ''))
    }
    if (avatarFile) fd.append('avatar', avatarFile)
    api.patch('/auth/perfil/', fd)
      .then(r => { setPerfil(r.data); setForm(r.data); setAvatarFile(null); setPreview(null); notify('Perfil actualizado') })
      .catch(err => notify(err?.response?.data?.email?.[0] || 'Error al guardar', 'err'))
      .finally(() => setSaving(false))
  }

  // El rol lo nombra el backend; deducirlo de is_staff mostraba "Administrador"
  // a cuentas que no lo son.
  const rol = perfil?.puede?.rol || perfil?.groups?.[0] || 'Sin rol'
  const initial = (perfil?.first_name?.[0] || perfil?.username?.[0] || perfil?.email?.[0] || 'U').toUpperCase()
  const avatarSrc = preview || perfil?.avatar_url || null
  const fullName = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(' ') || perfil?.username

  const inputG = 'w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 text-[15px] text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
  const labelG = 'block text-[13px] font-semibold text-mute mb-2'
  const cambios = JSON.stringify(form) !== JSON.stringify(perfil || {}) || !!avatarFile

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Héroe: quién eres, en grande */}
      <Card className="p-7 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="relative shrink-0 mx-auto sm:mx-0">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-surface-2 border border-edge flex items-center justify-center">
              {avatarSrc ? (
                <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-4xl font-black text-gold">{initial}</span>
              )}
            </div>
            <label className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-gold text-black flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity border-[3px] border-surface" title="Cambiar foto">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              <input type="file" accept="image/*" className="hidden" onChange={e => onPickAvatar(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="text-[24px] font-black text-ink leading-tight truncate">{fullName}</h2>
            <p className="text-[14px] text-mute mt-1 truncate">{perfil?.email || '—'}</p>
            {avatarFile && <p className="mt-1.5 text-[12px] text-gold font-semibold">Nueva foto seleccionada — guarda para aplicar.</p>}
          </div>
          <span className="shrink-0 mx-auto sm:mx-0 inline-flex px-3.5 py-1.5 rounded-full bg-gold-soft text-gold text-[12.5px] font-bold uppercase tracking-wide">{rol}</span>
        </div>
      </Card>

      {/* Información personal, amplia y en dos columnas */}
      <Card className="p-7 sm:p-8">
        <h2 className="text-[17px] font-black text-ink">Información personal</h2>
        <p className="text-[13px] text-mute mt-1 mb-6">Estos datos aparecen en el panel y en los documentos que emites.</p>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className={labelG}>Nombre</label>
            <input className={inputG} value={form.first_name || ''} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="Tu nombre" />
          </div>
          <div>
            <label className={labelG}>Apellido</label>
            <input className={inputG} value={form.last_name || ''} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="Tu apellido" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelG}>Correo electrónico</label>
            <input type="email" className={inputG} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="tu@correo.com" />
          </div>
          <div>
            <label className={labelG}>Teléfono</label>
            <input className={inputG} value={form.telefono || ''} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="744 000 0000" />
          </div>
          <div>
            <label className={labelG}>Puesto</label>
            <input className={inputG} value={form.puesto || ''} onChange={e => setForm({ ...form, puesto: e.target.value })} placeholder="Ej. Gerente" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelG}>Bio</label>
            <textarea className={`${inputG} resize-none`} rows={3} value={form.bio || ''} onChange={e => setForm({ ...form, bio: e.target.value })} placeholder="Algo sobre ti" />
          </div>
        </div>

        <div className="mt-7 pt-6 border-t border-edge flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button onClick={() => { setForm(perfil || {}); onPickAvatar(null) }} disabled={!cambios}
            className="px-6 py-3 rounded-full border border-edge text-mute text-sm font-semibold hover:text-ink transition-colors disabled:opacity-40">
            Descartar
          </button>
          <button onClick={save} disabled={saving || !cambios}
            className="px-7 py-3 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
            Guardar cambios
          </button>
        </div>
      </Card>
    </div>
  )
}
