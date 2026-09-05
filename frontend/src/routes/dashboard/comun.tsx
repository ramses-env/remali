/* eslint-disable react-refresh/only-export-components -- Este archivo es, a
   propósito, tipos + helpers + los cuatro átomos de interfaz que comparten
   todas las secciones. Separar los átomos en otro archivo solo para contentar
   a Fast Refresh partiría en dos cosas que siempre se editan juntas (una
   `Pill` y el `pillEstado` que la elige), y el precio es que editar ESTE
   archivo recargue la página en vez de refrescar en caliente. Las secciones,
   que son las que se editan a diario, sí exportan solo su componente. */
/**
 * Piezas compartidas del panel.
 *
 * El panel vivía entero en Dashboard.tsx: 11 mil líneas en UN archivo, que el
 * navegador bajaba completo para entrar a cualquier seccion. Ahora cada area
 * grande viaja en su propio archivo y se descarga cuando se abre; aqui quedan
 * los tipos, los helpers y los atomos de interfaz que TODAS comparten, para que
 * no haya dos definiciones del mismo boton ni dos formas del mismo tipo.
 *
 * Regla: esto NO importa de las secciones. Solo al reves.
 */
import { useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import { createPortal } from 'react-dom'
import api from '../../lib/api'
import { formatMoney } from '../../lib/utils'
import { type Capacidades } from '../../lib/acceso'
import { type Notify } from '../../store/toast'
import { descargarBlob } from '../../lib/descargar'

/** Number laxo para métricas: null/''/basura → 0. */
export const num = (v: any) => Number(v) || 0

/* ─────────── Tipos ─────────── */
export type Option = { id: number; nombre: string }
export type Equipo = {
  id?: number
  modelo: string
  descripcion?: string
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
  precio_venta?: number | string | null
  /** Meses de garantía al comprador. 3 por defecto, ajustable por máquina. */
  garantia_meses?: number | string | null
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
  dias_entrega_pedido?: number | string | null
}
export type Coupon = { id?: number; codigo: string; descuento: number; activo?: boolean; expira?: string | null; motivo?: string }
export type Refaccion = {
  id: number; nombre: string; descripcion?: string | null; precio_venta: string
  stock: number; stock_minimo: number; para_venta: boolean; ubicacion?: string
  codigo_barras: string; bajo_stock: boolean; fecha_creacion?: string
}
export type OrdenReparacionItem = {
  id: number; origen: 'stock' | 'externa'; refaccion?: number | null; refaccion_nombre?: string
  nombre: string; cantidad: number; costo_unitario: string; subtotal: string
}
export type OrdenReparacion = {
  id: number; folio: string; tipo: 'cliente' | 'interna'
  estado: 'recibida' | 'proceso' | 'terminada' | 'entregada'
  cliente_nombre: string; cliente_telefono: string; empresa?: number | null; empresa_nombre?: string
  unidad?: number | null; unidad_codigo?: string; equipo_descripcion: string; numero_serie: string
  diagnostico: string; trabajo_realizado: string; costo_mano_obra: string; notas: string
  items: OrdenReparacionItem[]; total_refacciones: string; total: string
  cliente_display: string; equipo_display: string; cuenta?: string | null
  fecha_recibida: string; fecha_entrega?: string | null; actualizado_en?: string
}
export type Venta = {
  id: number
  folio?: string | null
  nombre_cliente?: string | null
  empresa?: string | null
  subtotal?: string
  iva?: string
  estado?: string
  total: string
  metodo_pago: string
  fecha: string
  /** Los abonos con su fecha: el ingreso se cuenta el día que entró el dinero. */
  pagos?: { fecha: string; monto: string; metodo: string; por?: string }[]
  vendedor?: string | null
  telefono_cliente?: string | null
  cuenta?: string | null
  unidad?: { id: number; codigo: string; numero_serie?: string | null; equipo?: string | null } | null
  /** Una entrada por máquina. `unidad` es la primera; esto son todas. */
  maquinas?: { id: number; unidad_id: number | null; codigo: string | null; numero_serie?: string | null; equipo?: string | null; precio: string; entregada: boolean }[]
  origen?: { folio: string; resumen: string } | null
}
export type RentaActiva = {
  id: number
  inventario: { id: number; codigo?: string; numero_serie?: string | null; equipo?: string | null; equipo_id?: number | null }
  modalidad: string
  cliente?: string
  telefono_cliente?: string
  direccion: string
  fecha_fin: string
  dias_restantes: number
  /** Horas exactas para recogerla; negativo = de atraso. Una renta de un día no
   *  se puede contar en días: "1d restante" no distingue entre las 24 horas y
   *  los últimos veinte minutos. */
  horas_restantes?: number
  /** Si YA toca avisar. Lo decide el backend con un umbral proporcional a la
   *  renta (el último cuarto del tiempo, tope 2 días), y por eso no se vuelve a
   *  calcular aquí: con "≤ 2 días" a mano, una renta de un día salía en amarillo
   *  desde el minuto en que se registraba. */
  por_vencer?: boolean
  /** En qué va DE VERDAD, que no es el `estado`: una renta programada para hoy
   *  vive como 'activa' —la unidad ya está comprometida— pero la máquina sigue
   *  en la bodega. La fase lo dice sin tocar los estados que usan reportes y
   *  filtros. */
  fase?: 'reservada' | 'por_entregar' | 'en_camino' | 'activa' | 'vencida' | 'finalizada' | 'cancelada'
  fase_label?: string
  cancelable_por_cliente?: boolean
  en_ruta?: { salio: boolean; en: string | null; por: string | null }
  vencida: boolean
}
export type Notif = {
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
export type Modalidad = 'venta' | 'dia' | 'semana' | 'mes'
export const MODALIDADES: { key: Modalidad; label: string; corto: string }[] = [
  { key: 'venta', label: 'Venta', corto: 'Venta' },
  { key: 'dia', label: 'Renta por día', corto: 'Día' },
  { key: 'semana', label: 'Renta por semana', corto: 'Semana' },
  { key: 'mes', label: 'Renta por mes', corto: 'Mes' },
]
export const TIPO_COT_LABEL: Record<string, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }

export type CotizacionItem = {
  id: number; descripcion: string; cantidad: number; duracion?: number
  precio_unitario: string; precio_lista?: string; equipo?: number | null
  subtotal: string; modalidad: Modalidad; modalidad_label: string
  /** Unidades libres de ese equipo AHORA, contadas por el servidor al pedir la
   *  cotización. `null` = la partida no cuelga del catálogo (texto libre). */
  unidades_libres?: number | null
}
export type CotizacionFoto = { id: number; imagen: string; orden: number }
export type Cotizacion = {
  id: number; folio: string | null; tipo: 'venta' | 'renta' | 'mixta'
  estado: 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'cancelada'
  entrega_prometida?: string | null
  cliente_nombre: string; cliente_telefono: string; cliente_email?: string; empresa?: number | null; empresa_nombre?: string
  vigencia_dias: number; aplica_iva: boolean; notas: string
  /** Pidió factura y no tenemos con qué timbrársela. Se calcula en vivo contra
   *  su perfil: si los llena después de cotizar, deja de faltar solo. */
  faltan_datos_fiscales?: boolean
  items: CotizacionItem[]; fotos?: CotizacionFoto[]; subtotal: string; subtotal_venta: string; subtotal_renta: string; base: string; iva: string; total: string
  cliente_display: string; vigencia_hasta?: string | null; vencida?: boolean; creada: string
  token_publico?: string
  convertida?: boolean; venta_id?: number | null; renta_id?: number | null
  usuario_nombre?: string | null
  autorizada_por?: string | null
  autorizada_en?: string | null
  /** Cuándo pasó a estado "aceptada". Distinto de `autorizada_en`, que es
   *  cuando el JEFE del cliente la aprobó desde la liga: una cotización que
   *  administración marca aceptada a mano no tiene autorización pero sí
   *  aceptación, y sin este sello no había forma de saber cuándo ocurrió. */
  aceptada_en?: string | null
  cancelacion_solicitada?: string | null
  cancelacion_motivo?: string
  usuario?: number | null
  usuario_email?: string | null
  origen?: 'admin' | 'cliente'
  datos_solicitud?: { empresa?: string; obra?: { responsable?: string; direccion?: string; telefono?: string; email?: string } }
  atendida_en?: string | null; atendida_por_nombre?: string | null; escalada_en?: string | null
}

export type SolicitudFactura = {
  id: number; tipo: 'venta' | 'renta'; folio_origen: string
  rfc: string; razon_social: string; codigo_postal: string; regimen_fiscal: string; uso_cfdi: string; email: string
  subtotal: string; iva: string; total: string; forma_pago: string; concepto: string
  estado: 'pendiente' | 'facturada' | 'cancelada'; uuid: string; fecha_timbrado?: string | null; notas: string
  cliente_display: string; datos_completos: boolean; fecha_origen?: string | null; creada: string
}

// Métricas autoritativas del dashboard (backend suma ventas + rentas, sin tope).
export type DashMetrics = {
  ingresos_hoy?: number
  ingresos_mes?: { ventas: number; rentas: number; total: number }
  ingresos_por_mes?: { label: string; ventas: number; rentas: number; total: number }[]
  /** Serie DIARIA de los últimos 30 días (con los ceros dentro) + el mismo
   *  tramo corrido 30 días atrás, que es contra lo que se compara. */
  ingresos_por_dia?: { fecha: string; ventas: number; rentas: number; total: number }[]
  ingresos_periodo_previo?: number
  /** Los seis modelos que más dinero dejaron en el tramo, con su mezcla. */
  top_equipos?: { modelo: string; ventas: number; rentas: number; total: number }[]
  /** Cuántas unidades estuvieron rentadas cada día, y de cuántas había. */
  ocupacion_por_dia?: { fecha: string; rentadas: number; flota: number }[]
}



/** Descarga la ORDEN CARTA en PDF de una venta/renta. Reemplaza al ticket
 *  térmico (que solo se usa al vender refacciones). Se descarga en vez de abrir
 *  en pestaña porque tras un `await` el navegador bloquea window.open. */
export async function abrirOrdenCartaPDF(base: 'ventas' | 'rentas', id: number) {
  try {
    const r = await api.get(`/${base}/${id}/ticket/`, { responseType: 'blob', fondo: true } as never)
    descargarBlob(r.data as Blob, base === 'ventas' ? `orden-venta-${id}.pdf` : `orden-renta-${id}.pdf`)
  } catch { /* el interceptor global ya avisa el error */ }
}

/** Descarga un reporte CSV (abre en Excel) respetando los filtros que se pasen. */
export async function descargarReporte(url: string, params: Record<string, string>, archivo: string, notify: Notify) {
  try {
    const r = await api.get(url, { params, responseType: 'blob', fondo: true } as never)
    descargarBlob(r.data as Blob, archivo)
    notify('Reporte descargado')
  } catch {
    notify('No se pudo generar el reporte', 'err')
  }
}

/** Botón de exportar, consistente en las vistas de dinero. */
/** Una opción del menú "…" de una fila. */
export type OpcionMenu = {
  label: string; onClick: () => void; icono?: React.ReactNode
  peligro?: boolean; deshabilitado?: boolean; razon?: string
}

/**
 * Menú de acciones de una fila. Va en portal con posición fija a propósito: la
 * tabla vive dentro de un contenedor con overflow, y un menú absoluto quedaría
 * recortado por él.
 *
 * `etiqueta` cambia el disparador: sin ella son los tres puntos de siempre; con
 * ella, una píldora con su flecha ("Acciones ▾"), que es lo que pide una tabla
 * de pocas filas donde el menú es LA acción y no un extra escondido.
 */
export function MenuFila({ opciones, etiqueta }: { opciones: OpcionMenu[]; etiqueta?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement | null>(null)

  const abrir = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const right = Math.max(8, window.innerWidth - r.right)
    const estimado = opciones.length * 50 + 16   // alto aproximado del menú
    const espacioAbajo = window.innerHeight - r.bottom
    // Si no cabe abajo pero sí arriba, abre hacia ARRIBA (evita que se corte "Eliminar").
    if (espacioAbajo < estimado + 12 && r.top > espacioAbajo) {
      setPos({ bottom: window.innerHeight - r.top + 6, right })
    } else {
      setPos({ top: r.bottom + 6, right })
    }
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
      <button ref={btn} onClick={() => (pos ? setPos(null) : abrir())} aria-haspopup="menu" aria-expanded={!!pos}
        aria-label={etiqueta ? undefined : 'Más acciones'}
        className={etiqueta
          ? 'inline-flex items-center gap-2 h-9 pl-4 pr-3 rounded-full bg-surface-2 border border-edge text-[13px] font-semibold text-ink hover:border-gold/40 transition-colors'
          : 'w-8 h-8 rounded-lg grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors'}>
        {etiqueta ? (
          <>
            {etiqueta}
            <svg className={`w-4 h-4 text-mute transition-transform ${pos ? 'rotate-180' : ''}`} viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </>
        ) : (
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        )}
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setPos(null)} />
          <div role="menu" style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            className="fixed z-[71] min-w-[230px] max-h-[70vh] overflow-y-auto bg-surface border border-edge rounded-2xl shadow-[0_16px_40px_rgba(33,29,22,0.18)] p-2">
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


export function BotonExportar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Descargar reporte (CSV para Excel)"
      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-edge text-[13px] font-semibold text-ink hover:bg-surface-2 transition-colors whitespace-nowrap">
      <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
      Exportar
    </button>
  )
}

export type Section = 'resumen' | 'caja' | 'equipos' | 'inventario' | 'refacciones' | 'reparaciones' | 'cotizaciones' | 'catalogos' | 'clientes' | 'rentas' | 'ventas' | 'pedidos' | 'facturacion' | 'adeudos' | 'cupones' | 'perfil' | 'ubicaciones' | 'equipo' | 'permisos' | 'configuracion'

export const SECTION_META: Record<Section, { title: string; subtitle: string }> = {
  resumen: { title: 'Resumen', subtitle: 'Monitorea tus métricas y gestiona tu operación.' },
  caja: { title: 'Caja', subtitle: 'Cobra en el mostrador: refacciones, y maquinaria o rentas si están encendidas.' },
  equipos: { title: 'Productos', subtitle: 'Administra tu catálogo de maquinaria.' },
  inventario: { title: 'Inventario', subtitle: 'Controla cada unidad física y su estado.' },
  refacciones: { title: 'Refacciones', subtitle: 'Piezas para mantenimiento (y venta ocasional al público).' },
  reparaciones: { title: 'Reparaciones', subtitle: 'Órdenes de servicio: recibe equipos, registra el trabajo y entrega la orden.' },
  cotizaciones: { title: 'Cotizaciones', subtitle: 'Presupuestos para clientes: arma partidas, envía y da seguimiento.' },
  catalogos: { title: 'Clasificación', subtitle: 'Organiza categorías, tipos y marcas.' },
  rentas: { title: 'Rentas', subtitle: 'Gestiona rentas activas, reservas y devoluciones.' },
  ventas: { title: 'Ventas', subtitle: 'Historial de ventas de maquinaria y refacciones.' },
  pedidos: { title: 'Pedidos y apartados', subtitle: 'Ventas con anticipo: apartados y sobre pedidos. Cobra el saldo y entrega cuando llegue.' },
  facturacion: { title: 'Por facturar', subtitle: 'Ventas y rentas que el cliente pidió facturar. Timbra aparte y márcalas.' },
  adeudos: { title: 'Adeudos', subtitle: 'Rentas con saldo pendiente: quién debe, cuánto y desde cuándo. Registra abonos hasta liquidar.' },
  cupones: { title: 'Cupones', subtitle: 'Crea y administra códigos de descuento.' },
  clientes: { title: 'Clientes', subtitle: 'El padrón: a quién le vendes y le rentas, tenga cuenta o no.' },
  perfil: { title: 'Perfil', subtitle: 'Tu información de cuenta.' },
  ubicaciones: { title: 'Mi jornada', subtitle: 'Dónde está cada máquina y qué espera en el taller.' },
  equipo: { title: 'Equipo', subtitle: 'Quién entra al panel y con qué puesto.' },
  permisos: { title: 'Permisos', subtitle: 'Qué puede hacer cada puesto. Lo que cambies aquí aplica a todos los de ese rol.' },
  configuracion: { title: 'Configuración', subtitle: 'Tu cuenta, el negocio y cómo te avisamos.' },
}

export type Domicilio = {
  calle?: string; numero_exterior?: string; numero_interior?: string
  colonia?: string; municipio?: string; ciudad?: string; entidad?: string
  codigo_postal?: string; pais?: string; referencias?: string
  latitud?: string | null; longitud?: string | null
}
export type Obra = Domicilio & {
  id: number; empresa?: number; empresa_nombre?: string; nombre: string
  ubicacion?: string; responsable?: string; telefono?: string
  estado: 'activa' | 'pausada' | 'finalizada'; notas?: string; creada?: string
}
export type Empresa = Domicilio & {
  id?: number; nombre: string; rfc?: string; contacto?: string; telefono?: string
  email?: string; regimen_fiscal?: string; uso_cfdi?: string
  direccion?: string; notas?: string; activa?: boolean
  obras?: Obra[]; obras_count?: number; obras_activas?: number
}
/** Saca el mensaje REAL de un error de API. DRF manda errores por campo
 *  (`{"modelo": ["muy largo"]}`), no solo `detail`/`detalle`; leer solo `detail`
 *  hace que el usuario vea un genérico inútil y no sepa qué corregir. */
export function errorMsg(err: any, fallback = 'Ocurrió un error'): string {
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
export const empresasActivas = (l: Empresa[]) => l.filter(e => e.activa !== false)

/* ─────────── Helpers UI ─────────── */
/** La clase de TODOS los campos del panel. El aspecto vive en `.campo`
 *  (index.css); esto es solo el nombre con el que lo piden las pantallas. */
export const input = 'campo'
export const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

/** La tarjeta de la casa. Acepta `ref` —React 19 lo pasa como una prop más—
 *  porque el pie de paginación necesita subir a la cabecera de SU tabla al
 *  cambiar de página, y la tabla vive dentro de una de estas. */
export function Card({ children, className = '', ref }: {
  children: React.ReactNode; className?: string; ref?: React.Ref<HTMLDivElement>
}) {
  return <div ref={ref} className={`bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)] ${className}`}>{children}</div>
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA BARRA DE UNA TARJETA — título, contador y acciones

   El renglón de arriba de casi todas las tablas del panel se escribía a mano en
   cada sección: mismos 40px de alto, mismo borde inferior, y aun así con cinco
   paddings distintos conviviendo. Aquí vive UNA vez.

   El contador va pegado al título y no en una esquina: "Rentas · 24" se lee
   como una frase; separados, el ojo tiene que emparejarlos.
   ═══════════════════════════════════════════════════════════════════════════ */
export function CardBarra({ titulo, cuenta, children, className = '' }: {
  titulo?: React.ReactNode
  /** Cuántos hay. Se pinta como insignia junto al título. */
  cuenta?: number
  /** Filtros, buscador, botones: lo que la sección necesite a la derecha. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`px-4 sm:px-5 py-3.5 border-b border-edge flex items-center justify-between flex-wrap gap-3 ${className}`}>
      {titulo != null ? (
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[14px] font-bold text-ink tracking-[-0.01em] truncate">{titulo}</h3>
          {typeof cuenta === 'number' && (
            <span className="shrink-0 text-[11px] font-bold text-mute tabular-nums bg-surface-2 border border-edge rounded-full px-2 py-0.5">
              {cuenta}
            </span>
          )}
        </div>
      ) : null}
      {/* Sin título, los controles mandan y se reparten el ancho ellos solos: si
          quedara un hueco a la izquierda (un <div/> vacío), `justify-between`
          los empujaría todos a la derecha contra el borde. */}
      {children ? <div className={`flex items-center gap-2 flex-wrap ${titulo == null ? 'w-full justify-between' : ''}`}>{children}</div> : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUSCAR UNA CUENTA PARA VINCULAR

   Antes esto era la lista COMPLETA de cuentas metida en el diálogo de elegir.
   Con veinte clientes se veía bien; con cuatrocientos es una tira infinita en
   la que hay que cazar un nombre a ojo, justo con alguien esperando enfrente.

   Aquí se teclea y se busca en el servidor: nombre, teléfono, correo o empresa.
   El teléfono importa tanto como el nombre —en el mostrador se pregunta "¿a qué
   número?"— y es lo único que no se escribe de dos formas distintas.

   Detalles que hacen que no estorbe:
   · 280 ms de espera antes de consultar. Sin eso, "Rojas" son cinco peticiones
     y los resultados llegan desordenados: se pinta el de "Roj" después del de
     "Rojas" y la lista parpadea con lo que ya no buscabas.
   · Cada respuesta trae su número de turno; si llega una vieja, se tira. Es el
     mismo problema anterior por el otro lado, el que el debounce no cubre.
   · Con el campo vacío NO se pide nada: la lista completa es justo lo que se
     está quitando. Se pide desde el segundo carácter.
   ═══════════════════════════════════════════════════════════════════════════ */
export type CuentaCliente = {
  id: number
  nombre: string
  username: string
  email?: string
  telefono?: string
  empresa?: string
}

export function BuscarCuenta({ onElegir, onCancelar, titulo, mensaje }: {
  onElegir: (c: CuentaCliente) => void
  onCancelar: () => void
  titulo: string
  mensaje?: string
}) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<CuentaCliente[]>([])
  const [cargando, setCargando] = useState(false)
  const [buscado, setBuscado] = useState(false)
  const turno = useRef(0)

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) { setLista([]); setBuscado(false); setCargando(false); return }
    setCargando(true)
    const mio = ++turno.current
    const t = setTimeout(() => {
      api.get<{ clientes: CuentaCliente[] }>('/clientes-lookup/', { params: { q: texto }, fondo: true } as never)
        .then(r => {
          if (mio !== turno.current) return   // llegó tarde: ya hay una búsqueda más nueva
          setLista(r.data?.clientes || [])
          setBuscado(true)
        })
        .catch(() => { if (mio === turno.current) { setLista([]); setBuscado(true) } })
        .finally(() => { if (mio === turno.current) setCargando(false) })
    }, 280)
    return () => clearTimeout(t)
  }, [q])

  return createPortal(
    <div className="modal-in fixed inset-0 z-[70] bg-black/45 flex items-start sm:items-center justify-center p-4 pt-[12vh] sm:pt-4" onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={titulo}
        className="w-full sm:max-w-[460px] bg-surface border border-edge rounded-2xl shadow-[0_24px_60px_rgba(17,24,39,0.28)] overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[17px] font-extrabold text-ink">{titulo}</h2>
          {mensaje && <p className="text-[13px] text-mute mt-1 leading-snug">{mensaje}</p>}
          <div className="relative mt-3.5">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              aria-label="Buscar cuenta por nombre o teléfono"
              placeholder="Nombre, teléfono o correo…"
              className="campo pl-10" />
          </div>
        </div>

        <div className="max-h-[46vh] overflow-y-auto border-t border-edge">
          {q.trim().length < 2 ? (
            <p className="px-5 py-8 text-center text-[13px] text-mute">Escribe un nombre o un teléfono para buscar.</p>
          ) : cargando ? (
            <div className="py-2"><FilasEsqueleto filas={3} columnas={1} /></div>
          ) : lista.length === 0 && buscado ? (
            <p className="px-5 py-8 text-center text-[13px] text-mute">Nadie coincide con «{q.trim()}».</p>
          ) : (
            <div className="divide-y divide-edge">
              {lista.map(c => (
                <button key={c.id} onClick={() => onElegir(c)}
                  className="w-full text-left px-5 py-3 hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:bg-surface-2">
                  <p className="text-[14px] font-bold text-ink truncate">{c.nombre}</p>
                  {/* El teléfono va con los números tabulares y primero: es el
                      dato con el que se confirma que es esta persona y no otra
                      con el mismo nombre. */}
                  <p className="text-[12.5px] text-mute truncate">
                    {[c.telefono, c.empresa, c.email].filter(Boolean).join(' · ') || c.username}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-edge flex justify-end">
          <button onClick={onCancelar} className="h-9 px-4 rounded-full border border-edge text-[13px] font-semibold text-ink hover:bg-surface-2 transition-colors">Cancelar</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHIPS DE FILTRO — "Todas · Recibida 3 · En diagnóstico 1 · Entregada 12"

   El primo del control segmentado, para cuando las opciones son muchas y traen
   cuenta. La diferencia no es estética: con siete estados una pastilla
   deslizante se vuelve ilegible, y aquí lo que importa es ver de un golpe
   CUÁNTAS hay en cada uno, no dónde estás parado.

   Dos arreglos sobre lo que había copiado en cuatro secciones:

   · ALTO. Estaba en 28px; el dedo pide 40 como mínimo. Ahora mide 34 y la fila
     tiene su propio espacio, así que dos chips vecinos no comparten borde.
   · NO SE ENVUELVE, SE DESLIZA. En celular siete chips se partían en tres
     renglones que empujaban la tabla fuera de la pantalla. Ahora la fila rueda
     en horizontal, que es lo que el pulgar espera de una fila de filtros.
   ═══════════════════════════════════════════════════════════════════════════ */
export function FiltroChips<T extends string>({ valor, onChange, opciones, className = '', tonoActivo }: {
  valor: T
  onChange: (v: T) => void
  opciones: { valor: T; label: string; cuenta?: number }[]
  className?: string
  /** Casi siempre el chip elegido va en tinta. `peligro` es la excepción para
   *  el filtro que señala un problema (una cotización vencida): si se pintara
   *  como los demás, elegirlo perdería justo el dato que lo distingue. */
  tonoActivo?: (valor: T) => 'ink' | 'peligro'
}) {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto no-scrollbar ${className}`} role="group" aria-label="Filtros">
      {opciones.map(o => {
        const activo = o.valor === valor
        return (
          <button
            key={o.valor}
            onClick={() => onChange(o.valor)}
            aria-pressed={activo}
            className={`shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full text-[12px] font-bold whitespace-nowrap border transition-[background-color,color,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 ${
              activo
                ? (tonoActivo?.(o.valor) === 'peligro'
                  ? 'bg-[var(--c-vencida)] text-white border-transparent'
                  : 'bg-ink text-app border-transparent')
                : 'bg-surface-2 text-mute border-edge hover:text-ink hover:border-[color-mix(in_oklab,var(--c-ink)_20%,var(--c-border))]'
            }`}
          >
            {o.label}
            {typeof o.cuenta === 'number' && (
              <span className={`tabular-nums text-[11px] ${activo ? 'opacity-65' : 'opacity-70'}`}>{o.cuenta}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ESTADO VACÍO

   "Sin rentas activas." en gris centrado era todo lo que había. Un vacío así no
   se distingue de una carga que falló, y es la primera pantalla que ve alguien
   el día que estrena el sistema — el peor momento para que el panel parezca
   roto.

   Lleva un dibujo tenue (ubica), una frase que dice QUÉ falta y, cuando existe,
   el botón que lo resuelve ahí mismo.
   ═══════════════════════════════════════════════════════════════════════════ */
export function EstadoVacio({ titulo, mensaje, icono, accion, className = '' }: {
  titulo: string
  mensaje?: string
  /** Trazos de un <svg> 24×24, como los del menú. */
  icono?: React.ReactNode
  accion?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`py-14 px-6 text-center ${className}`}>
      <div aria-hidden="true" className="w-12 h-12 rounded-2xl border border-edge bg-surface-2 grid place-items-center mx-auto mb-3.5 text-mute">
        <svg className="w-[22px] h-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {icono || <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>}
        </svg>
      </div>
      <p className="text-[14.5px] font-bold text-ink">{titulo}</p>
      {mensaje && <p className="text-[13px] text-mute mt-1.5 max-w-[46ch] mx-auto leading-relaxed text-pretty">{mensaje}</p>}
      {accion && <div className="mt-4 flex items-center justify-center gap-2">{accion}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ESQUELETO DE TABLA

   Sustituye a "Cargando…". La palabra no dice cuánto falta ni qué va a llegar;
   el esqueleto dibuja la forma exacta de la tabla que viene, así que cuando los
   datos entran no hay salto —el renglón ya estaba donde va a estar—. Eso es
   también lo que evita el CLS.

   El pulso es de OPACIDAD, no de fondo: nada se mueve de sitio y respeta a
   quien pidió menos movimiento (se queda quieto, en el tono medio).
   ═══════════════════════════════════════════════════════════════════════════ */
export function Esqueleto({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" style={style} className={`block rounded-md bg-surface-2 animate-pulse motion-reduce:animate-none ${className}`} />
}

export function FilasEsqueleto({ filas = 5, columnas = 4 }: { filas?: number; columnas?: number }) {
  /* Anchos DISPAREJOS a propósito. Barras todas iguales se leen como una rejilla
     de carga genérica; desparejas se leen como texto que todavía no llega, que
     es exactamente lo que son. El patrón es fijo (no aleatorio) para que no
     baile en cada repintado. */
  const anchos = [72, 54, 86, 46, 64, 38, 80, 58]
  return (
    <div className="divide-y divide-edge" role="status" aria-label="Cargando">
      <span className="sr-only">Cargando resultados…</span>
      {Array.from({ length: filas }).map((_, f) => (
        /* Las filas de abajo se desvanecen: la lista se pierde en la niebla en
           vez de cortarse en seco, y de paso el ojo se queda arriba, donde van
           a aparecer los primeros datos. */
        <div key={f} className="flex items-center gap-4 px-5 py-[18px]" style={{ opacity: Math.max(0.25, 1 - f * 0.14) }}>
          {Array.from({ length: columnas }).map((__, c) => (
            <div key={c} className="flex-1 min-w-0">
              <Esqueleto className="h-3" style={{ width: `${anchos[(f * columnas + c) % anchos.length]}%` }} />
              {c === 0 && <Esqueleto className="h-2.5 mt-2" style={{ width: '46%' }} />}
            </div>
          ))}
          <div className="hidden sm:block w-20 shrink-0">
            <Esqueleto className="h-7 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ════════════════════════════════════════
   GESTIÓN DE INVENTARIO (unidades + QR + renta/venta)
════════════════════════════════════════ */
export type Unidad = {
  id: number
  codigo: string
  numero_serie: string | null
  condicion: 'nueva' | 'seminueva'
  estado: 'disponible' | 'rentado' | 'mantenimiento' | 'vendido'
  ubicacion_actual: string
  puede_rentarse: boolean
  puede_venderse: boolean
  /** Permiso para rentar una unidad NUEVA (sustitución, demanda extraordinaria). */
  autorizada_para_renta?: boolean
  /** Quién dio ese permiso, cuándo y por qué. `null` si no está autorizada o si
   *  la autorización es anterior a que se guardara el rastro. */
  autorizacion_renta?: { en: string; por: string | null; nota: string } | null
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
    horas_restantes?: number; por_vencer?: boolean
  }
}

/* ¿Esta unidad es de las que se rentan?
   Pregunta por la CONDICIÓN, no por `puede_rentarse`: ese es falso en cuanto la
   unidad deja de estar disponible, así que una seminueva YA RENTADA saldría como
   "no rentable" y la pestaña "Rentadas" diría 0 con el filtro encendido. Una
   nueva solo entra si alguien la autorizó (sustitución, demanda extraordinaria). */
export const seRenta = (u: Unidad) => u.condicion === 'seminueva' || Boolean(u.autorizada_para_renta)

// Construye un objeto Equipo ligero desde la info que trae la unidad (vista global)
export function equipoFromUnit(u: Unidad): Equipo {
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

export const pillBase = 'inline-flex items-center gap-2 h-5 px-2 rounded-full border bg-surface text-[10px] font-semibold tracking-tight'
export const pillTones = {
  emerald: { wrap: 'border-emerald-500/25 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  blue: { wrap: 'border-blue-500/25 text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  amber: { wrap: 'border-amber-500/25 text-taller-ink', dot: 'bg-amber-500' },
  neutral: { wrap: 'border-edge text-mute', dot: 'bg-mute' },
} as const

export function Pill({ tone, label }: { tone: keyof typeof pillTones; label: string }) {
  const t = pillTones[tone]
  return (
    <span className={`${pillBase} ${t.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
      <span className="leading-none">{label}</span>
    </span>
  )
}

export function estadoLabel(v: Unidad['estado']) {
  if (v === 'disponible') return 'Disponible'
  if (v === 'rentado') return 'Rentado'
  if (v === 'mantenimiento') return 'Mantenimiento'
  if (v === 'vendido') return 'Vendido'
  return v
}

export function condLabel(v: Unidad['condicion']) {
  return v === 'nueva' ? 'Nueva' : 'Seminueva'
}

export function pillEstado(v: Unidad['estado']) {
  if (v === 'disponible') return <Pill tone="emerald" label={estadoLabel(v)} />
  if (v === 'rentado') return <Pill tone="blue" label={estadoLabel(v)} />
  if (v === 'mantenimiento') return <Pill tone="amber" label={estadoLabel(v)} />
  return <Pill tone="neutral" label={estadoLabel(v)} />
}

export function pillCond(v: Unidad['condicion']) {
  return v === 'nueva' ? <Pill tone="emerald" label={condLabel(v)} /> : <Pill tone="blue" label={condLabel(v)} />
}

/* ── Captura fiscal reutilizable (para "El cliente pedirá factura") ── */
export type FacturaData = { rfc: string; razon_social: string; codigo_postal: string; regimen_fiscal: string; uso_cfdi: string; email: string }
export const FACTURA_VACIA: FacturaData = { rfc: '', razon_social: '', codigo_postal: '', regimen_fiscal: '', uso_cfdi: '', email: '' }

export function FacturaFields({ requiere, onRequiere, empresaNombre }: {
  requiere: boolean; onRequiere: (v: boolean) => void
  // Se reciben por compatibilidad con los 3 usos, pero ya NO se editan aquí:
  // los datos fiscales se capturan al timbrar (en "Por facturar"), no al crear.
  factura: FacturaData; onFactura: (f: FacturaData) => void
  empresaNombre?: string
}) {
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
            <p className="text-[12px] text-mute bg-surface-2 border border-edge rounded-lg px-3 py-2.5 leading-relaxed">
              Se marcará como <b className="text-ink">Por facturar</b>. Los datos fiscales (RFC, razón social, uso de CFDI…) se capturan al timbrarla en <b className="text-ink">Facturación</b>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Valida los datos fiscales de mostrador; devuelve mensaje de error o null.
// Los datos fiscales YA NO se piden al crear la renta/venta: al activar el switch
// la solicitud se guarda en "Por facturar" (datos_completos=false) y se completan
// al timbrarla en Facturación. Se conserva la firma para no tocar los 3 usos; ya
// nunca bloquea el registro.
export function validarFactura(_requiere: boolean, _empresaId: string, _f: FacturaData): string | null {
  return null
}

/* ════════════════════════════════════════
   MÓDULO RENTAS
════════════════════════════════════════ */
export type MovimientoRenta = { entregada?: boolean; recogida?: boolean; en?: string | null; por?: string | null }

export type RentaFull = RentaActiva & {
  entrega?: MovimientoRenta; recoleccion?: MovimientoRenta
  cuenta?: string | null
  usuario_id?: number | null
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
/* ─── Modal: detalle de renta (ventana "Ver") ─── */
export type Evidencia = { id: number; momento: 'entrega' | 'devolucion'; momento_label: string; imagen: string; nota: string; subida_por: string | null; creada: string }

/* ═══════════════════════════════════════════════════════════════════════════
   EL CAMPO DE DINERO

   Todo importe del panel se teclea aquí: precios del producto, costo de una
   refacción, mano de obra, anticipo, abono, lo que se recibe en la caja.

   Por qué no es un `<input type="number">`, que era lo que había: ese control
   NO admite comas —el navegador considera "17,500" un valor inválido y lo
   descarta—, así que el cajero tecleaba 100000 y veía `100000`. Seis dígitos
   pegados no se leen: hay que contarlos con el dedo, y confundir 10,000 con
   100,000 en un mostrador cuesta dinero. De paso el `type="number"` traía las
   flechitas del navegador y hacía scroll sobre el campo cambiando la cifra.

   Aquí el separador de miles se pinta MIENTRAS se escribe y lo que se guarda
   es el número crudo ("17500.50"), para que ninguna cuenta cargue comas.

   El cursor se queda donde estaba. Suena a detalle y es la razón por la que
   estos campos se sienten rotos: al meter una coma el texto se alarga y el
   cursor salta al final, así que corregir un dígito en medio de "1,204,500" es
   imposible. Se resuelve contando DÍGITOS —no caracteres— antes del cursor y
   volviendo a esa misma cuenta después de formatear.
   ═══════════════════════════════════════════════════════════════════════════ */

/** "2000" → "2,000"; "2000.5" → "2,000.5". Deja el decimal a medio escribir en
 *  paz (un "1200." no se convierte en "1200" mientras el dedo va al 5). */
export function formatearDinero(crudo: string) {
  if (!crudo) return ''
  const [ent, dec] = crudo.split('.')
  const entFmt = ent ? Number(ent).toLocaleString('en-US') : ''
  return dec !== undefined ? `${entFmt}.${dec.slice(0, 2)}` : entFmt
}

/** Solo dígitos y UN punto, con dos decimales como tope. */
function limpiarDinero(txt: string) {
  let limpio = txt.replace(/[^\d.]/g, '')
  const i = limpio.indexOf('.')
  if (i !== -1) limpio = limpio.slice(0, i + 1) + limpio.slice(i + 1).replace(/\./g, '').slice(0, 2)
  return limpio
}

export function InputDinero({
  valor, onValor, placeholder = '0', autoFocus, className = '', disabled,
  compacto, inputClassName = '', onKeyDown, id, etiqueta, ref,
}: {
  valor: string; onValor: (v: string) => void; placeholder?: string
  autoFocus?: boolean; className?: string; disabled?: boolean
  /** Alto de 40px en vez de 48: barras de filtros y renglones de tabla. */
  compacto?: boolean
  inputClassName?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  id?: string
  /** Para lectores de pantalla cuando no hay <label> visible al lado. */
  etiqueta?: string
  ref?: React.Ref<HTMLInputElement>
}) {
  const propio = useRef<HTMLInputElement | null>(null)
  /** Dónde dejar el cursor después de que React repinte con el valor nuevo.
   *  Se guarda como CUENTA DE DÍGITOS, que es lo único que sobrevive a que el
   *  formateo meta o quite comas. */
  const digitosAntes = useRef<number | null>(null)

  useEffect(() => {
    const el = propio.current
    const n = digitosAntes.current
    if (!el || n === null) return
    digitosAntes.current = null
    // Avanza por el texto ya formateado hasta haber pasado `n` dígitos.
    const txt = el.value
    let vistos = 0, pos = 0
    while (pos < txt.length && vistos < n) {
      if (/[\d.]/.test(txt[pos])) vistos++
      pos++
    }
    el.setSelectionRange(pos, pos)
  })

  return (
    <div className={`relative ${className}`}>
      <span className={`absolute ${compacto ? 'left-3' : 'left-3.5'} top-1/2 -translate-y-1/2 text-mute font-bold text-sm pointer-events-none`}>$</span>
      <input
        id={id}
        ref={el => { propio.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el }}
        aria-label={etiqueta || placeholder || 'Monto'}
        value={formatearDinero(valor)} autoFocus={autoFocus} disabled={disabled}
        inputMode="decimal" placeholder={placeholder} onKeyDown={onKeyDown}
        onChange={e => {
          const el = e.target
          const cursor = el.selectionStart ?? el.value.length
          // Cuántos dígitos hay a la izquierda del cursor: esa cuenta es la que
          // se restaura, no la posición en caracteres (las comas la mueven).
          digitosAntes.current = (el.value.slice(0, cursor).match(/[\d.]/g) || []).length
          onValor(limpiarDinero(el.value))
        }}
        className={`campo ${compacto ? 'campo-sm pl-8' : 'pl-9'} font-bold tabular-nums ${inputClassName}`}
      />
    </div>
  )
}

/** El mismo campo, pero para una CELDA de tabla que confirma al salir.
 *
 *  La partida de una cotización no puede guardar en cada tecla —serían diez
 *  peticiones para teclear "17,500"—, así que aquí se escribe libre y se manda
 *  al salir del campo o con Enter. Lo que no cambia es que las comas se ven
 *  mientras se teclea: es el mismo `formatearDinero` de todo el panel.
 *
 *  `key` desde fuera (con el valor del servidor) lo vuelve a montar cuando el
 *  dato cambió por otra vía; sin eso, el texto de la celda se quedaría con lo
 *  que se escribió antes de un error. */
export function CeldaDinero({ valor, onConfirmar, disabled, className = '', etiqueta }: {
  valor: number | string
  onConfirmar: (n: number) => void
  disabled?: boolean
  className?: string
  etiqueta?: string
}) {
  const [txt, setTxt] = useState(() => {
    const n = Number(valor) || 0
    return n ? String(n) : ''
  })
  const confirmar = () => {
    const n = Number(txt) || 0
    if (n !== (Number(valor) || 0)) onConfirmar(n)
  }
  return (
    <input
      aria-label={etiqueta}
      value={formatearDinero(txt)}
      disabled={disabled}
      inputMode="decimal"
      onChange={e => setTxt(limpiarDinero(e.target.value))}
      onBlur={confirmar}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={className}
    />
  )
}

/** Registrar abono: TODO en un solo modal — monto (con comas), método y fecha. */
export function AbonoModal({ saldo, onClose, onRegistrar, aviso }: {
  saldo: number; onClose: () => void
  onRegistrar: (monto: number, metodo: string, fecha: string) => Promise<void>
  /** Contexto de por qué se está cobrando (p. ej. cuánto falta para poder
   *  cerrar una devolución). Va bajo el monto porque es lo que decide la cifra
   *  que hay que teclear. */
  aviso?: string
}) {
  const money = formatMoney
  const hoyISO = new Date().toLocaleDateString('sv-SE')
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [fecha, setFecha] = useState(hoyISO)
  const [guardando, setGuardando] = useState(false)
  /* Por qué el error se pinta AQUÍ y no en un toast: el rechazo casi siempre
     habla de un campo de este formulario ("el abono es mayor al saldo", "la
     fecha no puede ser futura"), así que el mensaje tiene que estar junto al
     campo que hay que corregir y el modal tiene que seguir abierto con lo ya
     capturado. Cerrarlo y avisar por fuera obliga a teclearlo todo de nuevo. */
  const [error, setError] = useState('')
  const n = Number(monto) || 0

  /* Tocar cualquier campo borra el error: dejarlo puesto mientras el operador
     ya corrigió el monto hace que un mensaje viejo parezca el de ahora. */
  const editar = <T,>(set: (v: T) => void) => (v: T) => { setError(''); set(v) }

  return createPortal(
    <Modal className="modal-in fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClose={onClose} label="Registrar abono">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-surface border border-edge rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.3)] p-6">
        <h3 className="font-black text-ink">Registrar abono</h3>
        <p className="text-[12.5px] text-mute mt-1">Saldo actual: <b className="text-ink">{money(saldo)}</b></p>

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">¿Cuánto entrega?</label>
        <InputDinero valor={monto} onValor={editar(setMonto)} autoFocus placeholder="2,000" />
        {n > saldo && (
          <p className="text-[12px] text-red-500 font-semibold mt-1.5">El abono no puede ser mayor al saldo ({money(saldo)}).</p>
        )}
        {aviso && (
          <p className="text-[12px] text-mute mt-1.5 leading-snug">{aviso}</p>
        )}

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">Método</label>
        <div className="grid grid-cols-3 gap-2">
          {(['efectivo', 'tarjeta', 'transferencia'] as const).map(m => (
            <button key={m} onClick={() => editar(setMetodo)(m)}
              className={`h-10 rounded-xl border text-[12.5px] font-bold capitalize transition-colors ${metodo === m ? 'bg-ink text-app border-ink' : 'border-edge text-mute hover:text-ink hover:bg-surface-2'}`}>
              {m}
            </button>
          ))}
        </div>

        <label className="block text-[12px] font-semibold text-mute mt-4 mb-1.5">Fecha del abono</label>
        <input aria-label="Fecha del abono" type="date" value={fecha} max={hoyISO} onChange={e => editar(setFecha)(e.target.value)}
          className="campo" />
        <p className="text-[11px] text-mute mt-1">Cámbiala si se te pasó registrarlo ese día; no puede ser futura.</p>

        {error && (
          <p role="alert" className="text-[12.5px] text-red-500 font-semibold mt-4 leading-snug">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={onClose} className="px-5 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button disabled={n <= 0 || n > saldo || guardando}
            onClick={async () => {
              setGuardando(true)
              setError('')
              try {
                await onRegistrar(n, metodo, fecha)
              } catch (e) {
                /* El backend rechaza por seis razones distintas y cada una trae
                   su explicación en `detalle` (renta cancelada, método no
                   válido, monto mayor al saldo, fecha futura…). Antes se perdían
                   todas: el interceptor de api.ts solo avisa de red caída y de
                   5xx, así que un 400 —o un 403 por permisos— dejaba el botón
                   volviendo a su sitio y ni una palabra en pantalla. */
                setError(errorMsg(e, 'No se pudo registrar el abono.'))
              } finally {
                setGuardando(false)
              }
            }}
            className="px-6 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40">
            {guardando ? 'Guardando…' : n > 0 ? `Registrar ${money(n)}` : 'Registrar'}
          </button>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

/* ════════════════════════════════════════
   MÓDULO VENTAS
════════════════════════════════════════ */
export const MESES_PERIODO = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Selector de periodo (mes + año) para acotar los listados por ejercicio.
 *  Manda el filtro al servidor: nunca se trae más de un año a la vez. */
export function SelectorPeriodo({ anio, mes, onAnio, onMes, className = '' }: {
  anio: number; mes: number; onAnio: (a: number) => void; onMes: (m: number) => void; className?: string
}) {
  const actual = new Date().getFullYear()
  const anios = Array.from({ length: 5 }, (_, i) => actual - i)
  const sel = 'campo campo-sm w-auto font-semibold'
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className}`}>
      <select value={mes} onChange={e => onMes(Number(e.target.value))} className={sel} aria-label="Mes">
        {MESES_PERIODO.map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
      <select value={anio} onChange={e => onAnio(Number(e.target.value))} className={sel} aria-label="Año">
        {anios.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  )
}

/* ════════════════════════════════════════
   PERFIL DE USUARIO
════════════════════════════════════════ */
export type Perfil = {
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
  /** El dibujo por rol. Va siempre, haya foto o no: es la segunda capa del
   *  avatar (foto → rol → inicial). */
  avatar_url_rol?: string | null
}

/* ════════════════════════════════════════
   REPARACIONES — Órdenes de servicio
════════════════════════════════════════ */
export const OR_ESTADOS: { key: OrdenReparacion['estado']; label: string; cls: string; dot: string }[] = [
  { key: 'recibida', label: 'Recibida', cls: 'bg-blue-500/10 text-blue-500', dot: '#2B5FAD' },
  { key: 'proceso', label: 'En proceso', cls: 'bg-gold-soft text-gold-ink', dot: '#B8872E' },
  { key: 'terminada', label: 'Terminada', cls: 'bg-emerald-500/10 text-emerald-500', dot: '#1F7A4D' },
  { key: 'entregada', label: 'Entregada', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
]
export const orEstadoMeta = (e: string) => OR_ESTADOS.find(x => x.key === e) || OR_ESTADOS[0]
export const orMoney = formatMoney
// Una MÁQUINA PROPIA no se "recibe" ni se "entrega": sus estados son internos y su
// total es un COSTO (no un cobro). Estas ayudas diferencian el flujo por tipo.
export const OR_LABEL_INTERNA: Record<string, string> = { recibida: 'Abierta', proceso: 'En reparación', terminada: 'Terminada', entregada: 'Terminada' }
export const orLabel = (e: string, tipo?: string) => tipo === 'interna' ? (OR_LABEL_INTERNA[e] || e) : (OR_ESTADOS.find(x => x.key === e)?.label || e)
export const orPasos = (tipo?: string) => tipo === 'interna' ? OR_ESTADOS.filter(x => x.key !== 'entregada') : OR_ESTADOS
export const esFinal = (o: { tipo: string; estado: string }) => o.tipo === 'interna' ? o.estado === 'terminada' : o.estado === 'entregada'

/* ════════════════════════════════════════
   ADEUDOS — cobranza: rentas con saldo pendiente
════════════════════════════════════════ */
export type AdeudosDatos = { rentas: RentaFull[]; total: string; clientes: number }
// Apartado / sobre pedido (venta con anticipo). Espejo de _serialize_pedido en el backend.
export type Pedido = {
  id: number; folio: string | null; nombre_cliente: string; telefono_cliente: string
  empresa: string | null; cuenta: string | null; estado: string; sobre_pedido: boolean
  total: string; pagado: string; saldo: string
  pagos: { fecha: string; monto: string; metodo: string; por?: string }[]
  metodo_pago: string; anticipo_nota: string | null; fecha: string
  fecha_estimada_entrega: string | null; pedido_fase: string; entregada_en: string | null
  /** El respaldo que el PROVEEDOR le dio a REMALI por esta máquina. Es a quien
   *  se le reclama si llega defectuosa — distinto de la garantía que REMALI le
   *  da al cliente, que nace sola al vender. */
  garantia_proveedor?: { meses: number; nota: string } | null
  entregada_por: string | null
  vendedor: string | null; equipo: string | null; equipo_id: number | null
  unidad: { id: number; codigo: string; equipo: string | null } | null
  /** Las máquinas del pedido: cuáles llegaron y cuáles se esperan. */
  maquinas?: { id: number; unidad_id: number | null; codigo: string | null; numero_serie?: string | null; equipo?: string | null; precio: string; entregada: boolean }[]
}
export type PedidosDatos = { pedidos: Pedido[]; total: string; clientes: number }

/* ════════════════════════════════════════
   COTIZACIONES — presupuestos para clientes
════════════════════════════════════════ */
export const COT_ESTADOS: { key: Cotizacion['estado']; label: string; cls: string; dot: string }[] = [
  { key: 'borrador', label: 'Borrador', cls: 'bg-surface-2 text-mute', dot: '#6B7280' },
  { key: 'enviada', label: 'Enviada', cls: 'bg-blue-500/10 text-blue-500', dot: '#2B5FAD' },
  { key: 'aceptada', label: 'Aceptada', cls: 'bg-emerald-500/10 text-emerald-600', dot: '#1F7A4D' },
  { key: 'rechazada', label: 'Rechazada', cls: 'bg-red-500/10 text-red-500', dot: '#B91C1C' },
  { key: 'cancelada', label: 'Cancelada', cls: 'bg-red-500/10 text-red-500', dot: '#7F1D1D' },
]
export const cotEstadoMeta = (e: string) => COT_ESTADOS.find(x => x.key === e) || COT_ESTADOS[0]

/** Meta EFECTIVA del estado: la que se pinta.
 *
 *  `estado` nunca pasa de 'aceptada' — vender no mueve el enum. La conversión es
 *  un hecho aparte (`convertida`, que el serializer calcula desde
 *  `conversiones`/`rentas_convertidas`), así que una cotización ya vendida se
 *  listaba y se rotulaba como "Aceptada": el mismo verde de una que todavía
 *  puede caerse. Aquí gana el hecho.
 *
 *  "Concretada" va en verde SÓLIDO y "Aceptada" en verde tenue: mismo matiz
 *  porque son la misma familia (esto va bien), distinta intensidad porque una
 *  ya cerró y la otra sigue abierta. En una columna que se recorre de un
 *  vistazo, dos tintes iguales serían dos estados indistinguibles.
 *
 *  El FILTRO no pasa por aquí: la barra de pestañas manda `estado=` al servidor,
 *  que razona con el enum crudo — y así debe seguir. */
export function cotEstadoEfectivo(
  c: Pick<Cotizacion, 'estado' | 'convertida' | 'venta_id' | 'renta_id'>,
): { label: string; cls: string; dot: string } {
  const cerrada = c.estado === 'cancelada' || c.estado === 'rechazada'
  const concretada = Boolean(c.convertida || c.venta_id || c.renta_id)
  if (concretada && !cerrada) {
    return { label: 'Concretada', cls: 'bg-emerald-600 text-white', dot: '#FFFFFF' }
  }
  return cotEstadoMeta(c.estado)
}

/** `monto_aceptado` es OPCIONAL a propósito: el backend lo omite a quien no
 *  tiene `ver_dinero` (suma TODAS las aceptadas del periodo, que ya son las
 *  cuentas del negocio). Ausente ≠ cero: sin el campo, el KPI no se pinta. */
export type CotStats = { total: number; borrador: number; enviada: number; aceptada: number; rechazada: number; vencida: number; abiertas: number; monto_aceptado?: string }
export type PaginaCot = { count: number; next: string | null; previous: string | null; results: Cotizacion[] }
export const COT_PAGE_SIZE = 25

/** Lista de cotizaciones: paginada y filtrada EN EL SERVIDOR, para que aguante
 *  miles sin cargar todo al navegador. Los conteos vienen del endpoint de stats. */
/* Puente cotización→inventario: la cotización aceptada que se está concretando.
   Vive a nivel módulo para no enhebrar props por medio panel; la hoja (RentModal
   o SellModal) la lee al montar y la limpia al registrar.

   Sirve a los DOS propósitos. Nació solo para renta —de ahí el nombre viejo,
   `cotParaRenta`— y la venta se resolvía aparte, encadenando ventanitas dentro
   de la cotización. Eran dos experiencias distintas para la misma tarea: elegir
   la máquina que pidió el cliente y cobrarla. Ahora las dos pasan por
   Inventario, filtrado a lo que el cliente cotizó, y `proposito` decide el
   verbo, el filtro y a qué hoja se entra. */
/* La cola de la cotización vive en `cot-cola.ts`: es lógica pura y allá se
   puede comprobar sin arrastrar React. Se reexporta para que las pantallas
   sigan pidiéndole todo a `comun`. */
export { pasosDeCotizacion, conPasoActual, siguientePaso, progresoCot, nombreDePartida } from './cot-cola'
export type { PasoCot, CotEnCurso, Proposito } from './cot-cola'
// Import propio: los `export ... from` no traen los nombres al ámbito de ESTE
// archivo, y aquí abajo se siguen usando en las firmas del puente.
import type { CotEnCurso, Proposito } from './cot-cola'

export let cotEnCurso: CotEnCurso | null = null
/* Qué renta abrir al aterrizar en la sección. Mismo patrón que el puente de
   cotización→renta: sessionStorage para que sobreviva al cambio de sección sin
   meter la navegación en el estado global. */
export const RENTA_ABRIR_KEY = 'remali_renta_abrir'
export function fijarRentaAAbrir(id: number | null) {
  llegaDeTraspaso = id !== null
  try { id ? sessionStorage.setItem(RENTA_ABRIR_KEY, String(id)) : sessionStorage.removeItem(RENTA_ABRIR_KEY) } catch { /* privado */ }
}
/* Si la renta se abre por un traspaso, su modal entra desde la derecha (el otro
   extremo del mismo movimiento). Abierta a mano desde la lista, entra centrada
   como cualquier otro modal: no venías de ningún lado.
   Se lee con `tomarLlegaDeTraspaso()` —de un solo uso, como el resto de los
   puentes— porque desde otro módulo no se puede asignar a un import. */
let llegaDeTraspaso = false
export function tomarLlegaDeTraspaso() {
  const v = llegaDeTraspaso
  llegaDeTraspaso = false
  return v
}

export function tomarRentaAAbrir(): number | null {
  try {
    const v = sessionStorage.getItem(RENTA_ABRIR_KEY)
    if (v) sessionStorage.removeItem(RENTA_ABRIR_KEY)   // de un solo uso
    return v ? Number(v) : null
  } catch { return null }
}

/* Qué venta abrir al aterrizar en la sección. Gemelo del puente de rentas: al
   registrar una venta te deja PARADO EN ELLA —con su folio, su saldo y sus
   abonos— en vez de dejarte en la pantalla anterior adivinando si se guardó. */
export const VENTA_ABRIR_KEY = 'remali_venta_abrir'
export function fijarVentaAAbrir(id: number | null) {
  try { id ? sessionStorage.setItem(VENTA_ABRIR_KEY, String(id)) : sessionStorage.removeItem(VENTA_ABRIR_KEY) } catch { /* privado */ }
}
export function tomarVentaAAbrir(): number | null {
  try {
    const v = sessionStorage.getItem(VENTA_ABRIR_KEY)
    if (v) sessionStorage.removeItem(VENTA_ABRIR_KEY)   // de un solo uso
    return v ? Number(v) : null
  } catch { return null }
}

/* La renta pedida desde otra pantalla, ya en vuelo. Se dispara al hacer clic —no
   al montar la sección—, así la red corre DEBAJO de la animación de salida en vez
   de después: al aterrizar, la renta suele estar lista y el viaje se lee como un
   solo gesto en vez de tres cortes. */
export let rentaEnVuelo: { id: number; promesa: Promise<RentaFull | null> } | null = null
export function pedirRenta(id: number) {
  rentaEnVuelo = {
    id,
    promesa: api.get<{ rentas: RentaFull[] }>('/rentas/?estado=todas')
      .then(r => (r.data?.rentas || []).find(x => x.id === id) ?? null)
      .catch(() => null),
  }
}
export function tomarRentaEnVuelo(id: number) {
  const v = rentaEnVuelo && rentaEnVuelo.id === id ? rentaEnVuelo.promesa : null
  rentaEnVuelo = null
  return v
}

export const COT_EN_CURSO_KEY = 'remali_cot_en_curso'
export function leerCotEnCurso(): CotEnCurso | null {
  if (cotEnCurso) return cotEnCurso
  try { cotEnCurso = JSON.parse(sessionStorage.getItem(COT_EN_CURSO_KEY) || 'null') } catch { cotEnCurso = null }
  return cotEnCurso
}
/** La cotización en curso, pero solo si viene a hacer lo que preguntas. Evita
 *  que la hoja de venta se precargue con un puente de renta y al revés. */
export function leerCotEnCursoPara(proposito: Proposito): CotEnCurso | null {
  const v = leerCotEnCurso()
  return v && v.proposito === proposito ? v : null
}
/* Quién quiere enterarse de que el puente cambió.
   Un SET, no una ranura: el banner de Inventario y el de la hoja pueden estar
   montados a la vez, y con una sola ranura el segundo le roba el aviso al
   primero y al desmontarse la deja en null. Esa lección ya la pagó el bus de
   avisos globales; no se repite. */
const oyentesCot = new Set<() => void>()
export function suscribirCot(fn: () => void) {
  oyentesCot.add(fn)
  return () => { oyentesCot.delete(fn) }
}

export function fijarCotEnCurso(v: CotEnCurso | null) {
  cotEnCurso = v
  try { v ? sessionStorage.setItem(COT_EN_CURSO_KEY, JSON.stringify(v)) : sessionStorage.removeItem(COT_EN_CURSO_KEY) } catch { /* privado */ }
  // Sin esto, al pasar a la segunda máquina el letrero seguiría anunciando la
  // primera: se leía UNA vez al montar y nunca más.
  oyentesCot.forEach(fn => fn())
}

/** Control segmentado con indicador deslizante (estilo iOS). Columnas iguales
 *  para posicionar el indicador por índice sin medir el DOM; anima al cambiar. */
export function Segmentado({ opciones, valor, onChange, disabled, className = '', forma = 'bloque' }: {
  opciones: { key: string; label: string; cuenta?: number }[]
  valor: string; onChange: (k: string) => void; disabled?: boolean; className?: string
  /** `bloque` es el de los formularios: ocupa el ancho, esquinas de tarjeta.
   *  `pastilla` es el de las barras de tabla: se ciñe a su contenido, redondo
   *  entero y con el dorado del sistema, porque ahí NO es un campo que se
   *  llena sino un filtro de lo que estás viendo. */
  forma?: 'bloque' | 'pastilla'
}) {
  const idx = opciones.findIndex(o => o.key === valor)
  const pastilla = forma === 'pastilla'
  return (
    <div
      role="tablist"
      className={`relative grid border border-edge bg-surface-2 p-1 ${pastilla ? 'w-auto rounded-full' : 'w-full rounded-xl'} ${disabled ? 'opacity-60' : ''} ${className}`}
      style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}
    >
      {/* La pastilla activa se DESLIZA. No es adorno: el viaje dice de cuál
          pestaña vienes y a cuál llegaste, que es justo lo que un cambio de
          color no puede decir. Viaja con `transform` —nada de animar left— y
          quien pidió menos movimiento la ve aparecer ya puesta. */}
      {idx >= 0 && (
        <span aria-hidden
          className={`absolute top-1 bottom-1 motion-reduce:transition-none ${pastilla ? 'rounded-full bg-gold shadow-[0_1px_3px_rgba(33,29,22,0.18)]' : 'rounded-lg bg-ink shadow-sm'}`}
          style={{ left: 4, width: `calc((100% - 8px) / ${opciones.length})`, transform: `translateX(${idx * 100}%)`, transition: 'transform 220ms cubic-bezier(0.23, 1, 0.32, 1)' }} />
      )}
      {opciones.map(o => (
        <button key={o.key} type="button" role="tab" aria-selected={valor === o.key} disabled={disabled} onClick={() => onChange(o.key)}
          className={`relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors active:scale-[0.98] disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 ${
            pastilla ? 'px-4 h-8 rounded-full text-[12.5px]' : 'px-4 py-1.5 rounded-lg text-[13px]'
          } ${valor === o.key ? (pastilla ? 'text-gold-on' : 'text-surface') : 'text-mute hover:text-ink'}`}>
          {o.label}
          {typeof o.cuenta === 'number' && (
            <span className="text-[11px] tabular-nums opacity-65">{o.cuenta}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Switch (toggle) con el mismo estilo que el resto del sistema: pista azul y
 *  perilla que desliza. Mejor objetivo de toque en móvil que un checkbox. */
export function Switch({ checked, onChange, disabled, label }: {
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

/* ════════════════════════════════════════
   MÓDULO USUARIOS
════════════════════════════════════════ */
export type UsuarioPanel = {
  id: number; username: string; nombre: string; first_name: string; last_name: string
  email: string; rol: string | null; es_admin: boolean; es_superusuario: boolean
  activo: boolean; telefono: string; puesto: string
  email_verificado?: boolean; datos_completos?: boolean; perfil_verificado?: boolean
  /** Su foto. `avatar_url` SIEMPRE trae algo —cae al dibujo del rol—, así que
   *  para saber si subió una de verdad hay que mirar `tiene_foto`. */
  avatar_url?: string | null
  tiene_foto?: boolean
  /** ¿Ya tiene su PIN de 6 dígitos para autorizar acciones delicadas? */
  tiene_codigo?: boolean
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
export function estiloRol(u: UsuarioPanel) {
  if (u.es_superusuario) return { label: 'Dueño', cls: 'bg-ink text-app' }
  if (u.rol === 'Cliente') return { label: 'Cliente', cls: 'bg-surface-2 text-mute' }
  if (u.rol) return { label: u.rol, cls: 'bg-yellow text-[#111827]' }
  return { label: 'Sin rol', cls: 'bg-surface-2 text-mute' }
}

/** Un cliente es quien SOLO tiene el grupo Cliente; todo lo demás es equipo
 *  (incluye cuentas sin rol: se crearon para el panel y están a medio dar de alta). */
export function esCliente(u: UsuarioPanel) {
  return u.rol === 'Cliente' && !u.es_superusuario
}

/** Mismo criterio para el avatar de iniciales. */
export function estiloAvatar(u: UsuarioPanel) {
  if (u.es_superusuario) return 'bg-ink text-app'
  if (u.rol) return 'bg-yellow text-[#111827]'
  return 'bg-surface-2 text-mute'
}

export function iniciales(u: UsuarioPanel) {
  const base = (u.nombre || u.username).trim().split(/\s+/)
  return ((base[0]?.[0] || '') + (base[1]?.[0] || '')).toUpperCase() || u.username.slice(0, 2).toUpperCase()
}

export function hace(iso: string | null) {
  if (!iso) return 'Nunca ha entrado'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'Ahora mismo'
  if (min < 60) return `Hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.floor(h / 24)
  return d < 30 ? `Hace ${d} día${d > 1 ? 's' : ''}` : new Date(iso).toLocaleDateString('es-MX')
}

export function Panel({ titulo, desc, children }: { titulo?: string; desc?: string; children: React.ReactNode }) {
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
