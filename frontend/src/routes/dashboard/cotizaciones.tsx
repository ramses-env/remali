/**
 * Cotizaciones: la lista y el detalle (que es donde vive el grueso — partidas,
 * fotos, conversion a renta o a venta, envio al cliente).
 *
 * Es la seccion mas larga del panel; separada, la caja y el inventario dejaron
 * de bajarla para nada.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useRecurso } from '../../lib/realtime'
import Modal from '../../components/Modal'
import { createPortal } from 'react-dom'
import api from '../../lib/api'
import Paginador from '../../components/ui/paginador'
import { confirmar, pedir } from '../../components/Dialogo'
import CotizacionCartaModal from '../../components/CotizacionCartaModal'
import { type Notify } from '../../store/toast'
import { KpiGrid } from '../../components/ui/kpi-grid'
import { Monto } from '../../components/ui/numero'
import resolveMediaUrl from '../../lib/resolveMediaUrl'
import { descargarBlob } from '../../lib/descargar'
import { waLink } from '../../lib/whatsapp'
import {
  COT_ESTADOS, COT_PAGE_SIZE, Card, type CotStats, type Cotizacion,
  BuscarCuenta, CardBarra, CeldaDinero, type CotizacionFoto, type CuentaCliente, type Empresa,
  EstadoVacio, FilasEsqueleto, FiltroChips,
  MODALIDADES, type Modalidad, type PaginaCot,
  Segmentado, SelectorPeriodo, Switch, TIPO_COT_LABEL, type Unidad,
  abrirOrdenCartaPDF, conPasoActual, cotEstadoEfectivo, cotEstadoMeta, empresasActivas, errorMsg,
  fijarCotEnCurso, pasosDeCotizacion,
  input, MenuFila, orMoney, pedirRenta,
} from './comun'
import {
  Avatar, Bloque, BTN_DOC, Dato, DocsHoja, Hito, Migas, Pasos,
} from './hoja'
import { descargarCSV } from './hoja-csv'
import { diasParaVencer, fechaLarga } from './hoja-fechas'
import { NuevoPedidoModal, type PedidoDesde } from './hojas'
import { SelectorMaquina, type EleccionMaquina } from './selector-maquina'
import { anotarFallo } from '../../lib/fallo'

/** Traduce el error de carga a algo que diga QUÉ hacer. Un 403 aquí casi
 *  siempre significa "esta pestaña ya no trae la sesión del panel". */
function motivoCarga(err: any): string {
  const status = err?.response?.status
  if (status === 403) return 'Tu sesión no tiene permiso para ver cotizaciones. Vuelve a entrar con tu cuenta del panel.'
  if (!err?.response) return 'Sin conexión con el servidor. Revisa tu internet.'
  if (status >= 500) return 'El servidor falló al traer las cotizaciones.'
  return 'No se pudieron cargar las cotizaciones.'
}

type PropsCot = {
  empresas: Empresa[]; notify: Notify; irAInventario?: () => void
  irARentas?: (rentaId: number) => void
  irAVentas?: (ventaId: number) => void
}

/** La dirección de la HOJA de una cotización (el "Ver" del menú).
 *
 *  El modal se quedó donde estaba —es el escritorio para trabajarla, con la
 *  lista viva detrás—, y esto es lo que le faltaba al lado: una vista de sólo
 *  lectura con su propio enlace. Recargar no la cierra, "atrás" funciona, y
 *  mandarle a un compañero "revisa la COT-2026-0004" ya no es de palabra. */
const rutaCot = (id: number) => `/dashboard/cotizaciones/${id}`

export default function CotizacionesAdmin(props: PropsCot) {
  const { pathname } = useLocation()
  const id = Number(pathname.replace(/^\/dashboard\/cotizaciones\/?/, '').split('/')[0])
  /* Se monta UNA de las dos, no la lista con la hoja encima: al volver, la
     lista se recarga sola y trae ya el estado que dejó la cotización. La `key`
     es el id para que saltar de una cotización a otra parta de cero en vez de
     arrastrar lo de la anterior. */
  if (Number.isFinite(id) && id > 0) return <CotizacionVista key={id} id={id} {...props} />
  return <ListaCotizaciones {...props} />
}

function ListaCotizaciones({ empresas, notify, irAInventario, irARentas, irAVentas }: PropsCot) {
  const nav = useNavigate()
  /* Dos puertas distintas a propósito. "Abrir" es el modal de siempre: el
     escritorio donde se TRABAJA la cotización sin perder de vista la lista que
     está atrás. "Ver" es la hoja completa en su propia dirección — de sólo
     lectura, para consultarla, enseñarla o mandar el enlace. Meter las dos en
     una sola fue el error del intento anterior. */
  const abrir = (c: Cotizacion) => setDetalle(c)
  const ver = (c: Cotizacion) => nav(rutaCot(c.id))
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'vencida' | Cotizacion['estado']>('todas')
  const [anio, setAnio] = useState<number>(new Date().getFullYear())
  const [mes, setMes] = useState<number>(0)
  const [page, setPage] = useState(1)
  const ancla = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<PaginaCot>({ count: 0, next: null, previous: null, results: [] })
  const [stats, setStats] = useState<CotStats | null>(null)
  const [cargando, setCargando] = useState(false)
  /* Por qué un estado de error y no un catch vacío: cuando la sesión del
     navegador ya no es la del panel (entrar a la tienda como cliente reemplaza
     el token, es el mismo origen), estas dos peticiones responden 403 y la
     pantalla quedaba diciendo "Aún no hay cotizaciones" — que es mentira y
     manda a buscar el problema al lado equivocado. */
  const [fallo, setFallo] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Cotizacion | null>(null)
  const [recienCreada, setRecienCreada] = useState(false)
  const [creando, setCreando] = useState(false)
  const [carta, setCarta] = useState<Cotizacion | null>(null)

  const cargarStats = useCallback(() => {
    const params = new URLSearchParams({ anio: String(anio) })
    if (mes) params.set('mes', String(mes))
    api.get<CotStats>(`/cotizaciones/stats/?${params.toString()}`, { fondo: true })
      .then(r => { setStats(r.data); setFallo(null) })
      .catch(err => setFallo(motivoCarga(err)))
  }, [anio, mes])
  const cargarLista = useCallback(() => {
    setCargando(true)
    const params = new URLSearchParams({ page: String(page), anio: String(anio) })
    if (mes) params.set('mes', String(mes))
    if (qDebounced.trim()) params.set('q', qDebounced.trim())
    if (filtro !== 'todas') params.set('estado', filtro)
    api.get<PaginaCot>(`/cotizaciones/?${params.toString()}`, { fondo: true })
      .then(r => { setData(r.data); setFallo(null) })
      .catch(err => setFallo(motivoCarga(err)))
      .finally(() => setCargando(false))
  }, [page, qDebounced, filtro, anio, mes])
  const recargar = useCallback(() => { cargarLista(); cargarStats() }, [cargarLista, cargarStats])

  // Búsqueda con debounce: al teclear se espera un poco y se vuelve a la página 1.
  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [filtro, anio, mes])  // cambiar de pestaña/periodo → página 1
  /* Montaje, cambios de página/búsqueda/filtro Y —esto es lo que faltaba— cuando
     alguien MÁS toca una cotización: un cliente que manda su solicitud desde la
     tienda, o el compañero que la responde desde otra computadora. El latido del
     panel ya avisaba (el globito del menú sí subía), pero esta lista no estaba
     suscrita al bus, así que la única forma de ver la solicitud nueva era
     recargar la página a mano. Van dos suscripciones y no una porque cada carga
     tiene sus propias dependencias: la lista se rehace al cambiar de página o al
     teclear en el buscador; los conteos, solo al cambiar de periodo. */
  useRecurso(['cotizaciones'], cargarLista)
  useRecurso(['cotizaciones'], cargarStats)

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
        items={[
          { label: 'Cotizaciones', value: stats ? stats.total : '—', tone: 'default', helper: 'emitidas en el ejercicio', icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
          {
            label: 'Abiertas', value: stats ? stats.abiertas : '—', tone: 'gold', emphasis: (stats?.abiertas ?? 0) > 0,
            helper: (stats?.abiertas ?? 0) ? 'esperan respuesta del cliente' : 'ninguna esperando',
            icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
          },
          { label: 'Aceptadas', value: stats ? stats.aceptada : '—', tone: 'default', helper: 'listas para concretar en renta o venta', icon: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12 2.4 2.4 4.8-5" /></> },
          /* El monto solo si vino. A quien no tiene `ver_dinero` el backend le
             OMITE el campo, y pintar `orMoney(0)` le diría "$0.00 aceptado este
             año" —un dato falso— en vez de simplemente no enseñarle el KPI. */
          ...(stats && stats.monto_aceptado === undefined ? [] : [
            { label: 'Monto aceptado', value: stats ? <Monto valor={stats.monto_aceptado ?? 0} /> : '—', tone: 'default' as const },
          ]),
        ]}
      />

      {fallo && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <span className="text-sm text-ink flex-1">{fallo}</span>
          <button onClick={recargar} className="shrink-0 text-sm font-bold text-gold hover:underline">Reintentar</button>
        </div>
      )}

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        <CardBarra titulo="Cotizaciones" cuenta={data.count}>
          <SelectorPeriodo anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} />
          <div className="relative w-full sm:w-56">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input aria-label="Buscar folio o cliente" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio o cliente…" className="campo campo-sm pl-10" />
          </div>
          <button onClick={crearNueva} disabled={creando} className="btn-acento shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13.5px] font-bold disabled:opacity-60">
            {creando
              ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>}
            <span className="hidden sm:inline">Nueva cotización</span>
          </button>
        </CardBarra>

        {/* "Vencida" conserva su rojo cuando está elegida: es el único filtro
            que señala un problema, y perder esa marca lo igualaría con el resto. */}
        <FiltroChips
          className="px-4 py-3 border-b border-edge"
          valor={filtro}
          onChange={v => setFiltro(v as any)}
          opciones={pestanas.map(p => ({ valor: p.key as string, label: p.label, cuenta: p.n }))}
          tonoActivo={k => (k === 'vencida' ? 'peligro' : 'ink')}
        />

        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[980px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.09em] text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Folio #</th>
                <th className="font-semibold px-3 py-3 text-center">Partidas</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-3 py-3">Tipo</th>
                <th className="font-semibold px-3 py-3">Vigencia</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {data.results.map(c => {
                const m = cotEstadoEfectivo(c)
                return (
                  <tr key={c.id} className="hover:bg-surface-2 transition-colors cursor-pointer" onClick={() => abrir(c)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar nombre={c.cliente_display} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-ink truncate">{c.cliente_display}</p>
                            {c.origen === 'cliente' && <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">Cliente</span>}
                          </div>
                          {/* El renglón de abajo es el contacto, no un adorno: es
                              por donde se le responde. Correo primero porque es
                              lo que la cotización usa para enviarse; si no hay,
                              el teléfono. */}
                          <p className="text-[11.5px] text-mute truncate">{c.cliente_email || c.cliente_telefono || 'Sin contacto'}</p>
                        </div>
                      </div>
                    </td>
                    {/* La almohadilla delante NO es adorno: es lo que hace que el folio se
                        lea como un identificador y no como una fecha rara con guiones,
                        y es como se dicta por teléfono. */}
                    <td data-col="Folio" className="px-3 py-3 font-mono text-[13px] font-bold text-ink whitespace-nowrap">{c.folio ? `#${c.folio}` : <span className="text-mute font-sans font-semibold">Borrador</span>}</td>
                    <td data-col="Partidas" className="px-3 py-3 text-[13px] text-mute text-center tabular-nums"><span>{c.items?.length ?? 0}</span></td>
                    <td data-col="Total" className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap"><span>{orMoney(c.total)}</span></td>
                    {/* Solo la etiqueta. Aquí había además un anillo de progreso
                        con el porcentaje de avance (33, 66, 100), y decía lo
                        mismo que la etiqueta de al lado con menos claridad: un
                        "33" obliga a traducirlo a "Enviada", que ya estaba
                        escrito dos centímetros a la derecha. La franja de
                        etapas del DETALLE sigue contando esa historia, que es
                        donde el avance importa. */}
                    <td data-col="Estado" className="px-3 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}</span>
                        {c.vencida && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-500">Vencida</span>}
                      </div>
                    </td>
                    <td data-col="Tipo" className="px-3 py-3 text-[13px] text-mute"><span>{TIPO_COT_LABEL[c.tipo] || c.tipo}</span></td>
                    <td data-col="Vigencia" className={`px-3 py-3 text-[13px] whitespace-nowrap ${c.vencida ? 'text-red-600 dark:text-red-500 font-semibold' : 'text-mute'}`}><span>{fechaCorta(c.vigencia_hasta)}</span></td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end">
                        <MenuFila
                          etiqueta="Acciones"
                          opciones={[
                            { label: 'Ver', onClick: () => ver(c), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></svg> },
                            { label: 'Abrir para editar', onClick: () => abrir(c), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> },
                            { label: 'Ver la orden en carta', onClick: () => setCarta(c), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg> },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data.results.length === 0 && (cargando ? <FilasEsqueleto filas={5} columnas={4} /> : (
            <EstadoVacio
              titulo={fallo ? 'No se pudo cargar la lista' : (qDebounced || filtro !== 'todas') ? 'Sin cotizaciones con ese criterio' : 'Todavía no hay cotizaciones'}
              mensaje={fallo
                ? 'La petición no llegó al servidor. Vuelve a intentarlo en un momento.'
                : (qDebounced || filtro !== 'todas')
                  ? 'Cambia el filtro de arriba o borra la búsqueda.'
                  : 'Una cotización arma el presupuesto por partidas y se le envía al cliente para que la autorice.'}
              icono={fallo
                ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" /></>
                : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>}
            />
          ))}
        </div>

        {/* La lista la pagina el SERVIDOR (`CotizacionPagination`), así que aquí
            solo se le dice al pie en qué página va y él pide la siguiente. */}
        <Paginador pagina={page} paginas={totalPaginas} total={data.count}
          porPagina={COT_PAGE_SIZE} onIr={setPage} ancla={ancla} cargando={cargando}
          nombre="cotizaciones" />
      </Card>

      {detalle && <CotizacionDetalle cotizacion={detalle} empresas={empresas} recienCreada={recienCreada} notify={notify} onConcretarRenta={irAInventario} onConcretarVenta={irAInventario} onVerRenta={irARentas} onClose={() => { setDetalle(null); setRecienCreada(false); recargar() }} onChanged={recargar} onPrint={(c) => setCarta(c)} onConvertida={(id) => { setDetalle(null); setRecienCreada(false); recargar(); abrirOrdenCartaPDF('ventas', id) }} onVerVenta={irAVentas} />}
      {carta && <CotizacionCartaModal cotizacion={carta} onClose={() => setCarta(null)} />}
    </div>
  )
}

/**
 * La cotización de SOLO LECTURA, en su propia dirección. No compite con el
 * modal: el modal es donde se trabaja (con la lista viva detrás), y esto es la
 * hoja para consultarla, enseñársela a alguien de al lado o mandar el enlace.
 *
 * Quién la lee: el del mostrador con el cliente enfrente preguntando "¿en qué
 * quedó mi cotización?". Por eso mandan DOS cosas y el resto se hunde:
 *
 *   1. El total — a lo que va la pregunta.
 *   2. La VIGENCIA — lo único perecedero del sistema. Una venta no caduca; una
 *      cotización sí, y esa fecha es la que decide si todavía se respeta el
 *      precio. Estaba de dato suelto en media tarjeta vacía; ahora es una
 *      cuenta regresiva al lado del dinero.
 *
 * Trae su propia copia del servidor en vez de heredar la fila de la lista, así
 * `/dashboard/cotizaciones/12` funciona pegado en la barra del navegador,
 * recargado, o llegando desde otro lado.
 */
function CotizacionVista({ id, notify, irARentas, irAVentas }: PropsCot & { id: number }) {
  const nav = useNavigate()
  const [c, setC] = useState<Cotizacion | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [carta, setCarta] = useState<Cotizacion | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [bajando, setBajando] = useState(false)

  const cargar = useCallback(() => {
    api.get<Cotizacion>(`/cotizaciones/${id}/`)
      .then(r => { setC(r.data); setFallo(null) })
      .catch(err => setFallo(err?.response?.status === 404
        ? 'Esta cotización ya no existe: la borraron, o el enlace está mal.'
        : motivoCarga(err)))
  }, [id])
  useEffect(cargar, [cargar])
  // Lo que toque otro (el cliente que la acepta, el compañero que la contesta)
  // se ve aquí sin recargar, igual que en la lista.
  useRecurso(['cotizaciones'], cargar)

  const volver = () => nav('/dashboard/cotizaciones')

  function bajarPDF() {
    if (!c) return
    setBajando(true)
    api.get(`/cotizaciones/${c.id}/pdf/`, { responseType: 'blob' })
      .then(r => descargarBlob(r.data as Blob, `${c.folio || 'cotizacion'}.pdf`))
      .catch(() => notify('No se pudo descargar el PDF', 'err'))
      .finally(() => setBajando(false))
  }

  /* El CSV es la cotización COMO RENGLONES: la cabecera arriba, una fila por
     partida, y los totales al final — que es la forma en que alguien la pega en
     su hoja de cálculo para sumarla con otras. Se arma aquí porque el dato ya
     está en pantalla. */
  function bajarCSV() {
    if (!c) return
    const filas: (string | number)[][] = [
      ['Folio', c.folio || 'Borrador'],
      ['Cliente', c.cliente_display],
      ['Teléfono', c.cliente_telefono || ''],
      ['Correo', c.cliente_email || ''],
      ['Tipo', TIPO_COT_LABEL[c.tipo] || c.tipo],
      ['Estado', cotEstadoEfectivo(c).label],
      ['Creada', new Date(c.creada).toLocaleString('es-MX')],
      ['Vence', c.vigencia_hasta ? new Date(c.vigencia_hasta).toLocaleDateString('es-MX') : 'Sin fecha'],
      [],
      ['#', 'Concepto', 'Modalidad', 'Cantidad', 'Días', 'Precio unitario', 'Importe'],
      ...c.items.map((it, i) => [
        i + 1, it.descripcion, it.modalidad_label, it.cantidad, it.duracion || '',
        Number(it.precio_unitario) || 0, Number(it.subtotal) || 0,
      ]),
      [],
      ['', '', '', '', '', 'Subtotal', Number(c.base) || 0],
      ['', '', '', '', '', 'IVA', Number(c.iva) || 0],
      ['', '', '', '', '', 'Total', Number(c.total) || 0],
    ]
    descargarCSV(`${c.folio || 'cotizacion'}.csv`, filas)
  }

  const migas = (folio?: string | null) => (
    <Migas seccion="cotizaciones" etiqueta="Cotizaciones" folio={folio ? `#${folio}` : `#${id}`}
      onInicio={() => nav('/dashboard/resumen')} onSeccion={volver} />
  )

  if (fallo) {
    return (
      <div className="space-y-4">
        {migas(null)}
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <span className="text-sm text-ink flex-1">{fallo}</span>
          <button onClick={cargar} className="text-sm font-bold text-gold-ink dark:text-gold hover:underline">Reintentar</button>
          <button onClick={volver} className="text-sm font-bold text-ink hover:underline">Volver a la lista</button>
        </div>
      </div>
    )
  }
  if (!c) {
    return (
      <div className="grid place-items-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" aria-label="Cargando la cotización" />
      </div>
    )
  }

  const meta = cotEstadoEfectivo(c)
  const cerrada = c.estado === 'cancelada' || c.estado === 'rechazada'
  const concretada = Boolean(c.convertida || c.venta_id || c.renta_id)
  const paso = (cerrada || concretada) ? 3 : c.estado === 'aceptada' ? 2 : c.estado === 'enviada' ? 1 : 0
  const ultimoPaso = cerrada ? (c.estado === 'cancelada' ? 'Cancelada' : 'Rechazada') : 'Concretada'
  const obra = c.datos_solicitud?.obra
  const hayObra = Boolean(obra && (obra.responsable || obra.direccion || obra.telefono || obra.email))
  const fotos = c.fotos || []
  const dias = diasParaVencer(c.vigencia_hasta)
  /* `aplica_iva` NO significa "lleva IVA": significa "el cliente pidió factura",
     y solo manda en la RENTA. En venta el precio ya trae el IVA dentro y se
     desglosa siempre (ver `precios.desglose`). Rotular "sin IVA" mirando la
     bandera ponía "sin IVA" encima de un renglón que decía IVA $4,275.86. */
  const conIva = Number(c.iva || 0) > 0

  return (
    <div className="space-y-4">
      {migas(c.folio)}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[26px] sm:text-[28px] font-extrabold tracking-tight text-ink leading-tight font-mono">
            {c.folio ? `#${c.folio}` : <span className="font-sans text-mute">Borrador sin folio</span>}
          </h1>
          <p className="text-[13.5px] text-mute mt-1.5">
            {c.folio ? '' : 'El folio nace al enviarla · '}{fechaLarga(c.creada)}
          </p>
        </div>
        {/* Lo que se lleva uno de aquí: el documento para el cliente y los
            datos para su hoja de cálculo. Para EDITAR se vuelve a la lista por
            las migas y se usa "Abrir para editar" de la fila — la hoja es de
            consulta y no se pretende que sea otra cosa. */}
        <DocsHoja
          onPDF={bajarPDF} onCSV={bajarCSV} bajando={bajando}
          pdfRazon={c.items.length === 0 ? 'Sin partidas no hay PDF que generar' : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        {/* ── Columna ancha: en qué va, quién la pidió y qué trae ── */}
        <div className="space-y-4">
          <Bloque>
            <div className="flex items-center gap-2 flex-wrap mb-5">
              <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2.5 py-1 rounded-full ${meta.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.dot }} />{meta.label}</span>
              <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-mute">{TIPO_COT_LABEL[c.tipo] || c.tipo}</span>
              {c.origen === 'cliente' && <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-mute">La pidió el cliente</span>}
              {c.vencida && <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-500">Vencida</span>}
            </div>
            <Pasos pasos={['Borrador', 'Enviada', 'Aceptada', ultimoPaso]} paso={paso} cerrada={cerrada} />
          </Bloque>

          {c.cancelacion_solicitada && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4">
              <p className="text-[13.5px] font-bold text-red-700 dark:text-red-300">
                {c.estado === 'cancelada' ? 'El cliente CANCELÓ esta cotización' : 'El cliente pidió CANCELAR esta cotización'}
              </p>
              {c.cancelacion_motivo && <p className="text-[13px] text-red-600 dark:text-red-400 mt-1">Motivo: {c.cancelacion_motivo}</p>}
              {c.estado !== 'cancelada' && <p className="text-[12px] text-mute mt-1.5">Se aprueba desde “Abrir para editar”.</p>}
            </div>
          )}

          {/* Cliente y obra en UNA tarjeta: eran dos, y la de la obra dejaba
              media hoja en blanco a la derecha. Es el mismo dato —a quién se le
              cotiza y a dónde va la máquina—, así que va junto. */}
          <Bloque titulo="Cliente">
            <div className={hayObra ? 'grid sm:grid-cols-2 gap-x-6 gap-y-5' : ''}>
              <div>
                <div className="flex items-center gap-3">
                  <Avatar nombre={c.cliente_display} />
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-ink truncate leading-tight">{c.cliente_display}</p>
                    {c.empresa_nombre && <p className="text-[12px] text-mute truncate mt-0.5">{c.empresa_nombre}</p>}
                  </div>
                </div>
                <div className="mt-3.5 space-y-1.5">
                  <p className="flex items-center gap-2 text-[13px] text-mute min-w-0">
                    <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                    <span className="truncate">{c.cliente_email || <span className="italic">Sin correo</span>}</span>
                  </p>
                  <p className="flex items-center gap-2 text-[13px] text-mute min-w-0">
                    <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5c0 8 6 14 14 14l1.8-3.2-4.2-2-2 2a13 13 0 0 1-6.4-6.4l2-2-2-4.2z" /></svg>
                    <span className="truncate tabular-nums">{c.cliente_telefono || <span className="italic">Sin teléfono</span>}</span>
                  </p>
                  {c.usuario_nombre && (
                    <p className="flex items-center gap-2 text-[13px] text-mute min-w-0">
                      <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><circle cx="12" cy="8" r="3.4" /><path strokeLinecap="round" d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5" /></svg>
                      <span className="truncate">Entra a la tienda como {c.usuario_nombre}</span>
                    </p>
                  )}
                </div>
              </div>

              {hayObra && obra && (
                <div className="sm:border-l sm:border-edge sm:pl-6">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute mb-3">La obra</p>
                  <div className="space-y-3">
                    {obra.responsable && <Dato etiqueta="Responsable">{obra.responsable}</Dato>}
                    {obra.direccion && <Dato etiqueta="Dirección">{obra.direccion}</Dato>}
                    {obra.telefono && <Dato etiqueta="Teléfono"><span className="tabular-nums">{obra.telefono}</span></Dato>}
                    {obra.email && <Dato etiqueta="Correo"><span className="break-all">{obra.email}</span></Dato>}
                  </div>
                </div>
              )}
            </div>
          </Bloque>

          {/* El renglón de partida es un LIBRO DE CUENTAS, no una ficha de
              producto: número, concepto, y el importe alineado a la derecha con
              cifras tabulares para que las columnas cuadren al ojo. Antes cada
              renglón abría con un cuadrito gris de "imagen no disponible" —una
              foto que este endpoint no manda y que nunca iba a llegar. */}
          <Bloque titulo="Lo cotizado" extra={`${c.items.length} ${c.items.length === 1 ? 'partida' : 'partidas'}`}>
            {c.items.length === 0 ? (
              <p className="text-[13px] text-mute py-8 text-center">Todavía no tiene partidas.</p>
            ) : (
              <ul className="divide-y divide-edge border-y border-edge">
                {c.items.map((it, i) => (
                  <li key={it.id} className="flex items-baseline gap-3 py-3">
                    <span aria-hidden="true" className="shrink-0 w-5 text-[11px] font-bold text-mute tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-ink leading-snug">{it.descripcion}</p>
                      <p className="text-[12px] text-mute mt-0.5 tabular-nums">
                        {orMoney(it.precio_unitario)} × {it.cantidad}
                        {it.duracion ? <> × {it.duracion} {it.duracion === 1 ? 'día' : 'días'}</> : null}
                        <span aria-hidden="true" className="mx-1.5 text-mute/70">·</span>
                        <span className="font-sans">{it.modalidad_label}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-[14.5px] font-bold text-ink tabular-nums">{orMoney(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>

          {c.notas && (
            <Bloque titulo="Notas">
              <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">{c.notas}</p>
            </Bloque>
          )}

          {fotos.length > 0 && (
            <Bloque titulo="Fotos" extra={String(fotos.length)}>
              <div className="flex flex-wrap gap-2.5">
                {fotos.map(f => (
                  <button key={f.id} onClick={() => setZoom(f.imagen)} className="w-24 h-24 rounded-lg overflow-hidden border border-edge hover:border-gold/50 transition-colors">
                    <img src={resolveMediaUrl(f.imagen)} alt="Foto de la cotización" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </Bloque>
          )}
        </div>

        {/* ── Columna angosta: el dinero, la caducidad y el historial ── */}
        <div className="space-y-4">
          <Bloque>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">Total de la cotización</p>
            {/* EL foco de la pantalla. Todo lo demás se hunde para que esta
                cifra gane sin gritar: una sola cosa en dorado por vista. */}
            <p className="text-[34px] font-extrabold text-price tabular-nums leading-none mt-2 tracking-tight">{orMoney(c.total)}</p>
            <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3 space-y-2">
              <p className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-mute">Subtotal</span>
                <span className="text-ink font-semibold tabular-nums">{orMoney(c.base)}</span>
              </p>
              <p className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-mute">IVA{conIva ? ' (16%)' : ''}</span>
                <span className="text-ink font-semibold tabular-nums">{orMoney(c.iva)}</span>
              </p>
              <p className="flex items-baseline justify-between gap-3 text-[13.5px] pt-2 border-t border-edge">
                <span className="text-ink font-bold">Total</span>
                <span className="text-ink font-bold tabular-nums">{orMoney(c.total)}</span>
              </p>
            </div>
            <p className="text-[12px] text-mute mt-3 leading-relaxed">
              {conIva
                ? (c.tipo === 'venta'
                  ? 'El precio de venta ya trae el IVA dentro; arriba va desglosado.'
                  : c.aplica_iva ? 'Con factura: el IVA va sumado.' : 'El IVA sale del precio de venta.')
                : 'Sin IVA: la renta va sin factura.'}
              {c.tipo === 'mixta' && <> {orMoney(c.subtotal_venta)} de venta y {orMoney(c.subtotal_renta)} de renta.</>}
            </p>
            {/* Pidió factura y no tiene con qué. Se dice AQUÍ, junto al IVA, y
                no al momento de timbrar: enterarse al final es enterarse con el
                cliente esperando. Al cliente ya se le avisó en su cotización;
                esto es para que administración pueda empujarlo antes. */}
            {c.faltan_datos_fiscales && (
              <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--c-taller)_34%,transparent)] bg-[color-mix(in_oklab,var(--c-taller)_10%,transparent)] px-3 py-2 text-[12px] leading-snug text-taller-ink">
                <svg className="w-4 h-4 shrink-0 mt-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></svg>
                <span><b>Pidió factura pero le faltan sus datos fiscales</b> (RFC, régimen o CP). Ya se le avisó en su cotización; recuérdaselo antes de timbrar.</span>
              </p>
            )}
          </Bloque>

          {/* La vigencia, como cuenta regresiva. Es lo ÚNICO que caduca en todo
              el sistema —una venta no se vence, una cotización sí— y es lo que
              decide si todavía se respeta ese precio. Estaba de dato suelto en
              media tarjeta vacía. */}
          <Bloque>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">Vigencia</p>
            {!c.vigencia_hasta ? (
              <>
                <p className="text-[17px] font-bold text-ink mt-1.5">Sin fecha todavía</p>
                <p className="text-[12.5px] text-mute mt-1">Empieza a correr cuando la envíes: {c.vigencia_dias} días.</p>
              </>
            ) : (
              <>
                <p className={`text-[17px] font-bold mt-1.5 ${dias !== null && dias < 0 ? 'text-red-600 dark:text-red-500' : dias !== null && dias <= 3 ? 'text-taller-ink' : 'text-ink'}`}>
                  {dias === null ? '—'
                    : dias < 0 ? `Venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`
                      : dias === 0 ? 'Vence hoy'
                        : `Faltan ${dias} ${dias === 1 ? 'día' : 'días'}`}
                </p>
                <p className="text-[12.5px] text-mute mt-1">
                  {new Date(c.vigencia_hasta).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </>
            )}
            {(c.atendida_por_nombre || c.entrega_prometida) && (
              <div className="mt-4 pt-4 border-t border-edge space-y-3">
                {c.atendida_por_nombre && <Dato etiqueta="La atiende">{c.atendida_por_nombre}</Dato>}
                {c.entrega_prometida && <Dato etiqueta="Entrega prometida">{fechaLarga(c.entrega_prometida)}</Dato>}
              </div>
            )}
          </Bloque>

          {concretada && (
            <Bloque>
              <p className="text-[13px] text-ink leading-relaxed">
                Ya se concretó en {c.renta_id && !c.venta_id ? <>la <b>renta #{c.renta_id}</b></> : <>la <b>venta #{c.venta_id}</b></>}.
              </p>
              <button
                onClick={() => { if (c.renta_id && !c.venta_id) irARentas?.(c.renta_id); else if (c.venta_id) irAVentas?.(c.venta_id) }}
                className="mt-3 w-full h-10 rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[13px] font-bold hover:bg-emerald-500/10 transition-colors active:scale-[0.98]">
                Ver {c.renta_id && !c.venta_id ? 'la renta' : 'la venta'}
              </button>
            </Bloque>
          )}

          {/* Los documentos van ANTES del historial: son acción, y estaban
              enterrados debajo de una lista que puede crecer sin límite. */}
          <Bloque titulo="El documento">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCarta(c)} disabled={c.items.length === 0} title={c.items.length === 0 ? 'Sin partidas no hay orden que enseñar' : undefined} className={BTN_DOC}>
                <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>
                Ver la orden
              </button>
              <button onClick={bajarPDF} disabled={bajando || c.items.length === 0} title={c.items.length === 0 ? 'Sin partidas no hay PDF que generar' : undefined} className={BTN_DOC}>
                {bajando
                  ? <span className="w-3.5 h-3.5 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />
                  : <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}
                Descargar PDF
              </button>
            </div>
          </Bloque>

          <Bloque titulo="Historial">
            <ol>
              <Hito tono="hecho" titulo="Cotización creada" cuando={c.creada} />
              {c.atendida_en && <Hito tono="hecho" titulo={`La tomó ${c.atendida_por_nombre || 'el equipo'}`} cuando={c.atendida_en} />}
              {c.autorizada_en
                ? <Hito tono="hecho" titulo={`Aceptada${c.autorizada_por ? ` por ${c.autorizada_por}` : ''}`} cuando={c.autorizada_en} />
                /* Sin autorización por liga, el sello de aceptación es el único
                   dato de CUÁNDO dijeron que sí. Se guardaba y no se veía: no
                   se podía saber si aceptaron antes o después de que la
                   cotización venciera, que es la diferencia entre respetar el
                   precio y tener que recotizar. */
                : c.aceptada_en ? <Hito tono="hecho" titulo="Aceptada" cuando={c.aceptada_en} /> : null}
              {c.cancelacion_solicitada && <Hito tono="malo" titulo={c.estado === 'cancelada' ? 'Cancelada por el cliente' : 'El cliente pidió cancelar'} cuando={c.cancelacion_solicitada} nota={c.cancelacion_motivo || undefined} />}
              {concretada && <Hito tono="hecho" titulo={c.renta_id && !c.venta_id ? `Concretada en la renta #${c.renta_id}` : `Concretada en la venta #${c.venta_id}`} />}
              <Hito
                tono={c.vencida ? 'malo' : 'pendiente'}
                titulo={c.vencida ? 'Venció' : 'Vence'}
                cuando={c.vigencia_hasta || undefined}
                nota={c.vigencia_hasta ? undefined : 'Se fija al enviarla'}
                ultimo
              />
            </ol>
          </Bloque>
        </div>
      </div>

      {carta && <CotizacionCartaModal cotizacion={carta} onClose={() => setCarta(null)} />}
      {zoom && createPortal(
        <Modal className="modal-in fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClose={() => setZoom(null)} label="Foto de la cotización">
          <img src={resolveMediaUrl(zoom)} alt="Foto de la cotización" onClick={e => e.stopPropagation()} className="max-w-3xl w-full max-h-[85vh] object-contain rounded-xl" />
        </Modal>,
        document.body,
      )}
    </div>
  )
}

function CotizacionDetalle({ cotizacion, empresas, recienCreada, notify, onClose, onChanged, onPrint, onConvertida, onVerVenta, onConcretarRenta, onConcretarVenta, onVerRenta }: {
  cotizacion: Cotizacion; empresas: Empresa[]; recienCreada?: boolean; notify: Notify
  /** `destino` es a dónde va la navegación tras cerrar: sin él, de vuelta a
   *  la lista. Lo usan las migas para saltar al Resumen guardando primero. */
  onClose: (destino?: string) => void; onChanged: () => void; onPrint: (c: Cotizacion) => void; onConvertida: (ventaId: number) => void
  /** Abre la venta que salió de esta cotización. Al convertir ya no hace falta
   *  —la hoja de venta te deja parado en ella, igual que la renta—, así que
   *  esto es para cuando la cotización YA está convertida y quieres verla. */
  onVerVenta?: (ventaId: number) => void
  onConcretarRenta?: () => void; onVerRenta?: (rentaId: number) => void
  /** Mismo destino que renta: Inventario, filtrado a lo que pidió el cliente. */
  onConcretarVenta?: () => void
}) {
  const [buscandoCuenta, setBuscandoCuenta] = useState(false)

  // Vincular/cambiar la cuenta de la tienda dueña de esta cotización.
  function abrirBuscadorCuenta() {
    if (c.items.length === 0) { notify('Agrega partidas antes de vincular a una cuenta', 'err'); return }
    setBuscandoCuenta(true)
  }
  /* Se busca por nombre o teléfono contra el servidor; ya no se baja la lista
     entera para elegir a ojo. */
  async function vincularCuentaCot(cuenta: CuentaCliente) {
    setBuscandoCuenta(false)
    try {
      await api.post(`/cotizaciones/${cotizacion.id}/vincular/`, { usuario_id: cuenta.id })
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
  // Sobre pedido: si la cotización es de VENTA y su equipo no tiene stock, "convertir"
  // no crea una venta sino un PEDIDO con anticipo (la unidad se asigna cuando llega).
  const [sinStock, setSinStock] = useState<boolean | null>(null)
  const [pedidoDesde, setPedidoDesde] = useState<PedidoDesde | null>(null)
  const itemVenta = c.items.find(i => i.modalidad === 'venta' && i.equipo)
  useEffect(() => {
    let cancel = false
    const eqs = Array.from(new Set(c.items.filter(i => i.modalidad === 'venta' && i.equipo).map(i => i.equipo as number)))
    if (c.tipo === 'renta' || eqs.length === 0) { setSinStock(false); return }
    ;(async () => {
      try {
        for (const eq of eqs) {
          const r = await api.get<Unidad[]>(`/equipos/${eq}/unidades/`, { fondo: true } as never)
          if ((r.data || []).some(u => u.estado === 'disponible')) { if (!cancel) setSinStock(false); return }
        }
        if (!cancel) setSinStock(true)
      } catch { if (!cancel) setSinStock(false) }
    })()
    return () => { cancel = true }
  }, [c.id, c.tipo, c.items.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const [vigencia, setVigencia] = useState(String(cotizacion.vigencia_dias || 15))
  const [aplicaIva, setAplicaIva] = useState(cotizacion.aplica_iva)
  const [savingInfo, setSavingInfo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fotos, setFotos] = useState<CotizacionFoto[]>(cotizacion.fotos || [])
  const [subiendoFotos, setSubiendoFotos] = useState(false)
  const [zoomFoto, setZoomFoto] = useState<CotizacionFoto | null>(null)
  const [enviando, setEnviando] = useState(false)
  const fotoInput = useRef<HTMLInputElement>(null)

  function apply(nuevo: Cotizacion) { setC(nuevo); onChanged() }

  // Cierre: si es un borrador recién creado y quedó vacío (sin partidas, sin
  // cliente ni fotos), se descarta para no dejar cotizaciones huérfanas.
  async function cerrar(destino?: string) {
    // Una cotización sin cliente o sin conceptos no tiene sentido: un borrador
    // recién creado así NO se conserva. Con datos parciales se pregunta antes de
    // descartar; totalmente vacío se descarta en silencio.
    if (recienCreada) {
      const sinCliente = !clienteNombre.trim() && !empresaSel
      const sinConceptos = c.items.length === 0
      if (sinCliente || sinConceptos) {
        const algo = clienteNombre.trim() || empresaSel || c.items.length > 0 || fotos.length > 0
        const faltan = [sinCliente && 'el nombre del cliente', sinConceptos && 'al menos un concepto'].filter(Boolean).join(' y ')
        if (algo && !await confirmar({ titulo: '¿Descartar la cotización?', mensaje: `No se puede guardar sin ${faltan}.`, aceptar: 'Descartar', cancelar: 'Seguir editando', tono: 'peligro' })) return
        api.delete(`/cotizaciones/${c.id}/`).then(() => onChanged()).catch(anotarFallo)
        onClose(destino)
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
        }).then(() => onChanged()).catch(anotarFallo)
      }
    }
    onClose(destino)
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
  /* Rechazar CIERRA la cotización. El propio panel lo dice tres bloques más
     arriba: un registro rechazado "no se edita, ni se envía, ni se convierte".
     Y estaba a un clic sin red, con aspecto de liga — que es justo lo que más
     invita a tocarse por error, sobre todo en el mostrador con un cliente
     enfrente. Ahora pregunta, y la pregunta nombra la consecuencia en vez de
     decir "¿estás seguro?", que no informa nada. */
  async function rechazar() {
    const ok = await confirmar({
      titulo: '¿Rechazar la cotización?',
      mensaje: 'Queda cerrada: ya no se podrá editar, enviar ni convertir en renta o venta. Si el cliente regresa, habrá que cotizar de nuevo.',
      aceptar: 'Sí, rechazar',
      cancelar: 'Mejor no',
      tono: 'peligro',
    })
    if (ok) cambiarEstado('rechazada')
  }

  function cambiarEstado(estado: Cotizacion['estado'], extra?: Record<string, unknown>) {
    // Para marcarla como Enviada o Aceptada debe tener cliente y conceptos.
    if ((estado === 'enviada' || estado === 'aceptada') && (!(clienteNombre.trim() || empresaSel) || c.items.length === 0)) {
      notify('Agrega el nombre del cliente y al menos un concepto primero', 'err'); return
    }
    api.patch<Cotizacion>(`/cotizaciones/${c.id}/`, { estado, ...(extra || {}) })
      .then(r => {
        apply(r.data)
        notify(`Estado: ${cotEstadoMeta(estado).label}`, 'info')
        // Antes aquí se pedía la "entrega prometida". El siguiente paso real es
        // concretar la venta o la renta, y ahí es donde se captura la fecha:
        // pedirla dos veces hacía que un campo opcional pareciera obligatorio.
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
    /* Se van TODAS las máquinas de la cotización, en fila. Antes salía solo la
       primera (`.find()`) y el segundo equipo quedaba huérfano: había que
       acordarse de él y repetir el viaje a mano. Ahora la cola viaja en el
       puente y al cerrar cada renta el sistema te deja en la siguiente. */
    const cola = pasosDeCotizacion(c.items, 'renta')
    const base = {
      id: c.id, folio: c.folio,
      cliente: clienteNombre || c.cliente_display || '',
      telefono: clienteTel || c.cliente_telefono || '',
      direccion: c.datos_solicitud?.obra?.direccion || '',
      usuario_id: c.usuario ?? null,
      proposito: 'renta' as const,
    }
    fijarCotEnCurso(conPasoActual(base, cola, 0))
    const primera = cola[0]
    notify(cola.length > 1
      ? `${cola.length} máquinas por rentar. Empieza con ${primera.equipo_nombre}: elige la unidad y tócale Rentar`
      : primera?.equipo_id
        ? `El cliente pidió ${primera.equipo_nombre}: elige la unidad y tócale Rentar`
        : `Elige la unidad y tócale Rentar: quedará ligada a la ${c.folio || 'cotización'}`, 'info')
    onClose()
    onConcretarRenta?.()
  }

  function aprobarCancelacion() {
    api.post(`/cotizaciones/${c.id}/aprobar-cancelacion/`, {})
      .then(() => { notify('Cancelación aprobada', 'neutro'); onChanged() })
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
      .then(r => { apply(r.data.cotizacion); notify('La estás atendiendo', 'info') })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo tomar', 'err'))
  }
  // "+ Agregar partida": del CATÁLOGO (el servidor pone el precio de la web,
  // con su promo) o LIBRE (flete, operador, un servicio — a mano).
  /* Elegir la máquina ya no es un `elegir()` con todo el catálogo en crudo:
     lo hace `SelectorMaquina`, que filtra por lo que la cotización PUEDE llevar
     (renta / venta+sobre pedido), busca y muestra la foto. Aquí solo queda
     armar el payload, que es lo mismo de siempre. */
  const [eligiendoMaquina, setEligiendoMaquina] = useState(false)

  async function agregarDeSeleccion(sel: EleccionMaquina) {
    setEligiendoMaquina(false)
    setBusy(true)
    try {
      let payload: Record<string, unknown>
      if (sel.tipo === 'libre') {
        /* Todo lo que no está en el catálogo entra por aquí: la máquina que le
           compras al proveedor, el flete, el operador. Se pregunta el concepto
           (obligatorio) y el precio (opcional: en blanco entra en 0 y se ajusta
           tocando la celda, que es como se edita el resto de la tabla).

           Antes esto eran DOS renglones —"Máquina bajo pedido" y "Partida
           libre"— que hacían lo mismo, y el primero encima chocaba de nombre con
           el grupo SOBRE PEDIDO, que sí es de catálogo pero sin stock. */
        const concepto = (await pedir({
          titulo: 'Partida libre',
          mensaje: 'Qué le vas a cobrar. Puede ser una máquina que no tienes en catálogo, un flete, un operador…',
          placeholder: 'Ej. Compactadora Wacker DPU6555',
        }))?.trim()
        if (!concepto) return
        const precioStr = (await pedir({
          titulo: 'Precio (sin IVA)',
          mensaje: `Lo que le cobras al cliente por ${concepto}. Puedes dejarlo en blanco y ponerlo después.`,
          placeholder: 'Ej. 85000',
          inputMode: 'decimal',
        }))?.trim()
        const precio = Math.round(Number((precioStr || '').replace(/[^0-9.]/g, '')) * 100) / 100
        payload = { descripcion: concepto, cantidad: 1, precio_unitario: precio || 0, modalidad: c.tipo === 'renta' ? 'dia' : 'venta' }
      } else {
        payload = { equipo_id: sel.id, cantidad: 1, modalidad: c.tipo === 'renta' ? 'dia' : '' }
      }
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
  function editarItem(itemId: number, campo: 'descripcion' | 'cantidad' | 'duracion' | 'precio_unitario', valor: string | number) {
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
      .then(r => { apply(r.data); notify('Partida quitada', 'neutro') })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo quitar', 'err'))
  }
  /* Concretar la VENTA de una cotización aceptada. Gemelo de concretarRenta():
     mismo puente, mismo Inventario filtrado a lo que pidió el cliente, misma
     hoja precargada al elegir la unidad.

     Antes este botón hacía otra cosa completamente: encadenaba cinco ventanitas
     dentro del modal —método de pago, "¿pago combinado?", monto, método del
     resto, cuáles unidades— sin el inventario a la vista y tirando lo anterior
     con cualquier "Cancelar" a medio camino. Eran dos experiencias distintas
     para la misma tarea: elegir la máquina que el cliente pidió y cobrarla. */
  function concretarVenta() {
    // Ya convertida: no hay nada que concretar. Se abre su venta en vez de
    // volver a bajar el PDF en silencio, que no dice a dónde fue a dar.
    if (c.convertida && c.venta_id) { onVerVenta?.(c.venta_id); onConvertida(c.venta_id); return }
    if (c.estado !== 'aceptada') { notify('Marca la cotización como “Aceptada” antes de convertirla en venta', 'err'); return }
    if (!clienteNombre.trim() && !empresaSel) { notify('Agrega el nombre del cliente antes de convertir', 'err'); return }
    if (c.items.length === 0) { notify('Agrega al menos una partida antes de convertir', 'err'); return }
    // Sin stock → sobre pedido: se recoge el contexto de la cotización y se abre el
    // modal de pedido (crea una venta 'apartada' ligada, no una venta consumada).
    if (sinStock) {
      setPedidoDesde({
        id: c.id,
        equipoId: itemVenta?.equipo || null,
        equipoNombre: itemVenta?.descripcion,
        precio: Number(c.subtotal_venta || c.total) || undefined,
        cliente: clienteNombre.trim() || undefined,
        empresaId: empresaSel ? Number(empresaSel) : null,
      })
      return
    }
    const cola = pasosDeCotizacion(c.items, 'venta')
    if (cola.length === 0) {
      notify('No hay partidas de venta. Las de renta se cierran eligiendo unidad y fechas.', 'err')
      return
    }
    fijarCotEnCurso(conPasoActual({
      id: c.id, folio: c.folio,
      cliente: clienteNombre || c.cliente_display || '',
      telefono: clienteTel || c.cliente_telefono || '',
      direccion: c.datos_solicitud?.obra?.direccion || '',
      usuario_id: c.usuario ?? null,
      proposito: 'venta' as const,
    }, cola, 0))
    /* Una máquina por venta, igual que una máquina por renta. Aquí vivía un
       aviso —"al vender la primera se cierra la cotización y las otras quedan
       fuera"— que era verdad y ya no lo es: las demás siguen en la cola y el
       sistema te va llevando de una a otra. Advertir de algo que ya no pasa
       enseña a ignorar los avisos. */
    const primera = cola[0]
    notify(cola.length > 1
      ? `${cola.length} máquinas por vender. Empieza con ${primera.equipo_nombre}: elige la unidad y tócale Vender`
      : primera.equipo_id
        ? `El cliente pidió ${primera.equipo_nombre}: elige la unidad y tócale Vender`
        : `Elige la unidad y tócale Vender: quedará ligada a la ${c.folio || 'cotización'}`, 'info')
    onClose()
    onConcretarVenta?.()
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
  /* Imprimir y descargar trabajan sobre el PDF del SERVIDOR (reportlab), no
     sobre una recreación del HTML: lo que sale de la impresora es idéntico a lo
     que el cliente recibió por correo. Si el papel y el correo no coinciden, la
     discusión con el cliente la pierde REMALI. */
  const [documento, setDocumento] = useState<'' | 'descarga' | 'impresion'>('')

  function pedirPDF() {
    if (!(clienteNombre.trim() || empresaSel) || c.items.length === 0) {
      notify('Agrega el cliente y al menos un concepto para generar el PDF', 'err')
      return null
    }
    return api.get(`/cotizaciones/${c.id}/pdf/`, { responseType: 'blob' }).then(r => r.data as Blob)
  }

  function descargarPDF() {
    const p = pedirPDF()
    if (!p) return
    setDocumento('descarga')
    p.then(b => descargarBlob(b, `${c.folio || 'cotizacion'}.pdf`))
      .catch(() => notify('No se pudo descargar el PDF', 'err'))
      .finally(() => setDocumento(''))
  }

  /* El PDF se carga en un iframe oculto y se imprime desde ahí. `window.print()`
     a secas mandaría a la impresora el panel entero, que es lo que hacía el
     botón viejo cuando no había una hoja montada. */
  function imprimirPDF() {
    const p = pedirPDF()
    if (!p) return
    setDocumento('impresion')
    p.then(b => {
      const url = URL.createObjectURL(b)
      const marco = document.createElement('iframe')
      marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
      marco.src = url
      marco.onload = () => { marco.contentWindow?.focus(); marco.contentWindow?.print() }
      document.body.appendChild(marco)
      // El diálogo del sistema es modal: el iframe tiene que seguir vivo mientras
      // esté abierto, así que la limpieza va con holgura.
      window.setTimeout(() => { URL.revokeObjectURL(url); marco.remove() }, 60_000)
    })
      .catch(() => notify('No se pudo abrir la impresión', 'err'))
      .finally(() => setDocumento(''))
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

  /* Traspaso a la renta. La petición sale primero (viaja mientras la hoja se
     retira), luego corre la salida, y al terminar se navega: un solo gesto en
     lugar de "desaparece / cambia / aparece". 160ms es la salida del sistema. */
  const [traspasando, setTraspasando] = useState(false)
  function traspasarARenta(rentaId: number) {
    if (traspasando) return
    pedirRenta(rentaId)
    setTraspasando(true)
    const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // La flecha sale (240ms) y la hoja se retira detrás de ella (160ms); se
    // solapan a propósito —el panel arranca a los 90ms— para que se lea como un
    // arrastre y no como dos animaciones en fila.
    window.setTimeout(() => { onVerRenta?.(rentaId); onClose() }, reducido ? 0 : 250)
  }

  // Estado final (cancelada/rechazada): es un registro cerrado — no se edita,
  // ni se envía, ni se convierte; solo se consulta o se imprime.
  const cotCerrada = c.estado === 'cancelada' || c.estado === 'rechazada'
  // Ya convertida en venta, o en un estado final: queda de solo lectura. Editar
  // partidas/precios desincronizaría su total y su ticket, y en una cerrada no aplica.
  const bloqueada = Boolean(c.convertida) || cotCerrada
  // Los conceptos que armó EL CLIENTE no se tocan: son su pedido, no una
  // captura del panel. El admin solo edita partidas de sus propias cotizaciones.
  const conceptosBloqueados = bloqueada || c.origen === 'cliente'
  // Identidad de la solicitud (nombre/tel/correo): también es del cliente.
  const identidadBloqueada = c.origen === 'cliente'
  /* LA HIZO EL CLIENTE. Es la bandera que decide dos bloques enteros:

       · Enviar al cliente (WhatsApp / correo). Existe porque el ADMIN arma
         cotizaciones para mandárselas a alguien — y eso no depende de si esa
         persona tiene cuenta o no. Si la armó el cliente, ya la tiene: él la
         hizo. Los botones sobran.
       · Fotos. Se suben para que el cliente vea cómo es la máquina. Si la armó
         él, la escogió del catálogo de la tienda, con sus fotos delante.

     NO se mira la cuenta. Una cotización que capturaste tú y luego vinculaste
     por liga SÍ lleva botones y SÍ lleva fotos: la hiciste tú, se la estás
     mostrando. Es la misma bandera con la que ya se bloquean los conceptos y la
     identidad más arriba (`conceptosBloqueados`, `identidadBloqueada`). */
  const laHizoElCliente = c.origen === 'cliente'
  /* Subir fotos: solo en las que arma administración (ver la sección ⑧). */
  const puedeSubirFotos = !bloqueada && !laHizoElCliente
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
  const labelSec = 'block text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-ink mb-3'
  /* La entrega prometida solo se muestra donde de verdad alimenta algo:
       · VENTA: nunca. Esas máquinas las recoge el cliente en el mostrador, y el
         backend ya las excluye a propósito de la jornada del técnico
         (renta/views.py). Pedir una hora ahí no le llega a nadie.
       · RENTA sin convertir: sí. Es el único puente entre "el cliente aceptó" y
         "se levantó la renta": es lo que le pone la entrega en el día al técnico.
       · RENTA ya convertida: solo si ya tiene valor, para poder verla o
         corregirla. Vacía desaparece — la fecha real ya se capturó en la hoja de
         la renta, y volver a pedirla ahí era escribir lo mismo dos veces. */
  const yaConcretada = Boolean(c.convertida || c.venta_id || c.renta_id)
  const verEntrega = !esVenta && (
    Boolean(c.entrega_prometida) || (c.estado === 'aceptada' && !yaConcretada)
  )

  /* ── La etapa, de verdad ────────────────────────────────────────────────
     `estado` NUNCA pasa de 'aceptada': vender no mueve el enum. La conversión
     es un hecho aparte —`convertida` lo calcula el serializer desde
     `conversiones`/`rentas_convertidas`— y el propio backend lo dice al
     rechazar una segunda conversión ("una cotización ya convertida quedó en
     'aceptada'", cotizaciones/views.py).

     Por eso los cuatro escalones son el CAMINO BUENO y el último sale del
     hecho, no del enum:

         Borrador → Enviada → Aceptada → Concretada

     Cancelada/rechazada NO es el cuarto escalón: es salirse de la vía. Ocupa
     ese lugar y se pinta en rojo, pero nunca convive con "Concretada" — o
     terminó bien o terminó mal.

     La versión anterior leía solo `c.estado` y heredaba el cuarto escalón de
     la barra vieja, donde significaba "Rechazada". El final bueno no tenía
     casilla: una venta ya hecha se quedaba en 3 de 4 y ese cuarto segmento
     gris decía, en silencio, "todavía puede salir mal". */
  /* Cerrada también aterriza en el último escalón: la salida OCUPA ese lugar.
     Sin esto una cancelada caía al 0 y se pintaba "Borrador" en rojo. */
  const pasoCot = (cotCerrada || yaConcretada) ? 3
    : c.estado === 'aceptada' ? 2
      : c.estado === 'enviada' ? 1 : 0
  const finalCot = cotCerrada
    ? (c.estado === 'cancelada' ? 'Cancelada' : 'Rechazada')
    : 'Concretada'
  const PASOS_COT = ['Borrador', 'Enviada', 'Aceptada', finalCot]
  /* La pastilla del encabezado decía "Aceptada" a dos centímetros del aviso que
     dice "ya se concretó en la venta #118". Se contradecían porque leía el enum
     crudo. Lo resuelve `cotEstadoEfectivo`, el mismo que usan las filas de la
     lista: una sola definición de "qué estado se pinta". */
  const metaCot = cotEstadoEfectivo(c)
  return (
    <Modal className={`fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-start justify-center p-0 sm:p-6 overflow-y-auto ${traspasando ? 'modal-out' : 'modal-in'}`} onClose={() => cerrar()} label="Detalle de la cotización">
      <div onClick={(e: React.MouseEvent) => e.stopPropagation()} className="w-full sm:max-w-5xl my-0 sm:my-auto bg-surface border border-edge rounded-none sm:rounded-2xl shadow-[0_20px_50px_rgba(33,29,22,0.18)] min-h-screen sm:min-h-0 sm:max-h-[92vh] flex flex-col sm:overflow-hidden">
        <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-edge bg-surface shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-mono font-bold text-ink text-lg tracking-tight">{c.folio || <span className="text-mute font-sans text-[15px]">Sin folio · nace al enviarla</span>}</span>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${metaCot.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: metaCot.dot }} />{metaCot.label}</span>
              </div>
              <p className="text-[14px] text-mute truncate mt-1">{c.cliente_display} · {TIPO_COT_LABEL[c.tipo] || c.tipo}</p>
            </div>
            <div className="flex items-start gap-3 sm:gap-4 shrink-0">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-mute">Total</p>
                <p className="text-xl sm:text-[27px] font-extrabold text-price tabular-nums leading-tight">{orMoney(totalMonto)}</p>
              </div>
              <button onClick={() => cerrar()} className="text-mute hover:text-ink hover:bg-surface-2 p-1.5 rounded-lg transition active:scale-90 mt-0.5" aria-label="Cerrar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
          </div>
          {/* La etapa, como franja de progreso. Era una sección del cuerpo con
              cuatro celdas iguales y una rellena — idéntica al `Segmentado` de
              Tipo, que sí se toca, mientras su propio comentario advertía que
              es SOLO LECTURA. Así ya no invita a nada: lo andado queda tenue,
              el escalón actual sólido.

              Y los escalones LLEVAN NOMBRE. Sin ellos el estado se comunicaba
              solo por color y posición: cuatro barritas anónimas donde no había
              manera de saber qué era la cuarta — que es justo lo que escondió
              que una venta ya hecha se quedara en 3 de 4. */}
          <div className="flex gap-1.5 mt-3.5" role="img" aria-label={`Etapa: ${PASOS_COT[pasoCot]}`}>
            {PASOS_COT.map((etiqueta, i) => (
              <div key={etiqueta} className="flex-1 min-w-0">
                <span className={`block h-1 rounded-full transition-colors ${
                  i > pasoCot ? 'bg-edge'
                    : i < pasoCot ? (cotCerrada ? 'bg-red-500/30' : 'bg-ink/25')
                      : (cotCerrada ? 'bg-red-500' : 'bg-ink')
                }`} />
                <span className={`block mt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] truncate transition-colors ${
                  i === pasoCot ? (cotCerrada ? 'text-red-500' : 'text-ink') : 'text-mute'
                }`}>{etiqueta}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 sm:px-7 py-6 space-y-7 bg-surface flex-1 sm:overflow-y-auto">
          {/* ① LO URGENTE ABRE. La cancelación que pide el cliente estaba a
              media hoja, después del estado y del tipo. Es lo más grave que
              puede traer una cotización: va primero. */}
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
          {c.convertida && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM16 11V7a4 4 0 00-8 0v4" /></svg>
              <p className="text-[12.5px] text-ink leading-relaxed">
                Esta cotización ya se concretó en {c.renta_id && !c.venta_id
                  ? <>la <b>renta #{c.renta_id}</b></>
                  : <>la <b>venta #{c.venta_id}</b></>}, así que quedó <b>bloqueada</b> y no se puede volver a concretar.
                Es su respaldo; para cambiar algo, hazlo en la {c.renta_id && !c.venta_id ? 'renta' : 'venta'}.
              </p>
            </div>
          )}
          {cotCerrada && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
              <p className="text-[12.5px] text-ink leading-relaxed">
                Esta cotización está <b>{c.estado === 'cancelada' ? 'cancelada' : 'rechazada'}</b>: es un registro cerrado. Solo se puede consultar o imprimir — no se edita, ni se envía, ni se convierte.
              </p>
            </div>
          )}

          {/* ② LO QUE SIGUE: las acciones que mueven el ESTADO, juntas.

              Enviar vivía debajo de los totales, como si fuera parte de la
              aritmética. Enviar ES la transición borrador → enviada, y sus
              hermanas ("El cliente la aceptó", "Rechazar") ya vivían aquí.

              El pie NO cambia: ahí siguen los documentos, "Guardar" y el paso
              que saca la cotización del módulo (convertir / concretar / ver la
              renta). El reparto queda limpio: el cuerpo decide el destino de
              la cotización; el pie produce papeles y la cierra. */}
          {!bloqueada && (c.estado === 'borrador' || c.estado === 'enviada') && (
            <div className="rounded-xl border border-edge bg-surface-2/60 px-4 py-4">
              <p className={labelSec}>Lo que sigue</p>
              {c.estado === 'borrador' && !laHizoElCliente && (
                <>
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
                  <p className="text-[11.5px] text-mute mt-2 mb-3 max-w-[440px] leading-relaxed">
                    Por correo va el PDF adjunto; por WhatsApp, un enlace para verlo. Enviarla por correo la marca como “Enviada”.
                  </p>
                </>
              )}
              {/* La armó el cliente: mandársela sobra, ya la tiene. Se explica el
                  hueco en vez de dejarlo — un botón que falta sin decir por qué
                  se lee como que algo no cargó. */}
              {c.estado === 'borrador' && laHizoElCliente && (
                <p className="text-[12.5px] text-mute mb-3 max-w-[440px] leading-relaxed">
                  Esta cotización la armó el cliente, así que ya la tiene. No hay que mandársela.
                </p>
              )}
              {c.estado === 'borrador' && (
                <button onClick={() => cambiarEstado('enviada')}
                  className={laHizoElCliente
                    ? 'h-10 px-4 rounded-full bg-ink text-app text-[13px] font-bold hover:opacity-90 transition active:scale-[0.98]'
                    : 'text-[12px] font-bold text-mute hover:text-ink transition-colors'}>
                  {laHizoElCliente ? 'Marcar como enviada' : 'o solo marcarla como enviada'}
                </button>
              )}
              {!bloqueada && c.estado === 'enviada' && (c.origen === 'cliente' ? (
                /* Tubería AUTOMÁTICA (la mandó el cliente): administración solo
                   confirma disponibilidad; el aviso a su campanita sale solo y
                   después nada más falta fecha/hora de entrega y convertir. */
                /* El primario va en DORADO, no en verde: en este producto el
                   verde significa "disponible" como dato (la dona, los chips) y
                   el dorado es lo accionable. Con el verde de primario, el mismo
                   botón decía "El cliente la aceptó" en la otra tubería, donde no
                   hay disponibilidad de por medio: el color ya no significaba
                   nada. La oposición sí/no la cargan la forma y el peso. */
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {/* El botón dice la DECISIÓN, no su consecuencia. El
                      "— aceptar" de antes explicaba lo que pasa por dentro
                      (la cotización cambia a "aceptada"), que es justo lo que
                      el usuario no tiene que pensar: él contesta si hay
                      máquina o no. Y así los dos botones son simétricos, que
                      es lo que los vuelve un sí/no de un vistazo. */}
                  <button onClick={() => cambiarEstado('aceptada')} className="h-10 px-4 rounded-full bg-gold text-black text-[13px] font-bold hover:opacity-90 transition active:scale-[0.98]">
                    Hay disponibilidad
                  </button>
                  <button onClick={rechazar} className="h-10 px-4 rounded-full border border-red-500/40 text-red-600 dark:text-red-400 text-[13px] font-bold hover:bg-red-500/10 transition active:scale-[0.98]">
                    Sin disponibilidad
                  </button>
                </div>
              ) : (
                /* Tubería MANUAL (la capturaste tú para alguien sin cuenta):
                   el estado sigue lo que el cliente diga por teléfono/WhatsApp. */
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button onClick={() => cambiarEstado('aceptada')} className="h-10 px-4 rounded-full bg-gold text-black text-[13px] font-bold hover:opacity-90 transition active:scale-[0.98]">
                    El cliente la aceptó
                  </button>
                  <button onClick={rechazar} className="h-10 px-4 rounded-full border border-red-500/40 text-red-600 dark:text-red-400 text-[13px] font-bold hover:bg-red-500/10 transition active:scale-[0.98]">
                    Rechazar
                  </button>
                </div>
              ))}
              {/* Reenviar: cambiaste un precio y quieres que le vuelva a llegar.
                  Discreto, porque no es el paso que toca. */}
              {c.estado === 'enviada' && !laHizoElCliente && (
                <button onClick={enviarCorreo} disabled={enviando || !completa || !email.trim()}
                  className="mt-3 block text-[12px] font-bold text-gold-ink hover:opacity-80 transition-opacity disabled:opacity-40">
                  {enviando ? 'Reenviando…' : 'Reenviar por correo'}
                </button>
              )}
            </div>
          )}

          {(c.origen === 'cliente' || c.autorizada_por) && (
            /* Era una tarjeta AZUL. En este panel el azul significa "rentada" —en
               la dona, en los chips, en la gráfica de ingresos— y aquí no
               significaba nada: solo competía por atención con el botón que sí
               hay que tocar. Que la cotización venga del cliente lo dice el
               título; no hace falta gastarle un color encima. */
            <div className="rounded-xl border border-edge bg-surface-2/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <p className="text-[11px] font-bold uppercase tracking-wide text-mute">Solicitud del cliente</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Procedencia: quién la firmó del lado del cliente. Vive aquí
                      —no bajo la barra de Estado— porque no habla del estado,
                      habla de dónde vino; y su par natural es "Atendida por". */}
                  {c.autorizada_por && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600" title={c.autorizada_en ? new Date(c.autorizada_en).toLocaleString('es-MX') : undefined}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                      Autorizada por {c.autorizada_por}{c.autorizada_en ? ` · ${new Date(c.autorizada_en).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : ''}
                    </span>
                  )}
                  {c.atendida_por_nombre
                    ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>Atendida por {c.atendida_por_nombre}</span>
                    : <button onClick={atender} className="px-3 h-8 rounded-lg border border-edge text-ink text-xs font-bold hover:border-gold/40 hover:bg-gold-soft transition-colors">La estoy atendiendo</button>}
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

          {buscandoCuenta && (
            <BuscarCuenta
              titulo="Vincular a una cuenta"
              mensaje='El cliente verá esta cotización en "Mis cotizaciones" y podrá aceptarla.'
              onElegir={vincularCuentaCot}
              onCancelar={() => setBuscandoCuenta(false)}
            />
          )}

          {/* Datos del cliente (arriba): para corregir un nombre/teléfono mal
              capturado sin tener que rehacer la cotización. */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className={labelSec}>Cliente</p>
              {/* Vincular la cotización a una cuenta de la tienda: el cliente
                  la ve en "Mis cotizaciones" y ÉL decide aceptarla. */}
              {/* Con cuenta ya vinculada no hay "cambiar": la cotización está
                  en el panel de esa persona, quizá a punto de aceptarla, y
                  moverla se la quitaría sin avisarle. Los duplicados se
                  resuelven fundiendo las fichas en Clientes. */}
              {!bloqueada && (c.usuario_nombre ? (
                <span className="mb-2 text-[11.5px] font-semibold text-mute" title="Para corregirlo, funde las fichas del cliente desde la sección Clientes">
                  Cuenta vinculada
                </span>
              ) : (
                <div className="mb-2 flex items-center gap-3">
                  <button onClick={generarLigaVinculo} disabled={generandoLiga}
                    title={c.items.length === 0 ? 'Primero agrega las partidas' : undefined}
                    className={`text-[12px] font-bold transition-opacity disabled:opacity-50 ${c.items.length === 0 ? 'text-mute cursor-not-allowed' : 'text-gold-ink hover:opacity-80'}`}>
                    {ligaVinculo ? '✓ Liga generada' : generandoLiga ? 'Generando…' : '+ Vincular por liga'}
                  </button>
                  {/* "de la lista" ya no describe lo que pasa: ahora se busca. */}
                  <button onClick={abrirBuscadorCuenta} className="text-[11px] font-semibold text-mute hover:text-ink transition-colors">
                    o buscar la cuenta
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
              <select aria-label="Cuenta del cliente" disabled={bloqueada || identidadBloqueada || !!c.usuario_nombre} title={c.usuario_nombre || identidadBloqueada ? 'La identidad la puso el cliente: no se cambia por una empresa' : undefined} value={empresaSel} onChange={e => cambiarEmpresa(e.target.value)} className={`${input} sm:col-span-2 disabled:opacity-60`}>
                <option value="">— Cliente particular —</option>
                {empresasActivas(empresas).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
              <input aria-label="Nombre del cliente" disabled={bloqueada || identidadBloqueada || !!empresaSel || !!c.usuario_nombre} value={clienteNombre} onChange={e => setClienteNombre(e.target.value)}
                title={empresaSel ? 'El nombre lo define la empresa seleccionada' : undefined}
                className={`${input} disabled:opacity-60`} placeholder="Nombre del cliente" />
              <div>
                <input aria-label="Teléfono (10 dígitos)" type="tel" inputMode="numeric" maxLength={10} disabled={bloqueada || identidadBloqueada} value={clienteTel}
                  onChange={e => setClienteTel(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className={`${input} disabled:opacity-60`} placeholder="Teléfono (10 dígitos)" />
                {clienteTel.length > 0 && clienteTel.length < 10 && <p className="text-[11px] text-red-600 dark:text-red-500 mt-1">Deben ser 10 dígitos.</p>}
              </div>
              <input aria-label="Correo (cliente@correo.com)" type="email" disabled={bloqueada || identidadBloqueada} value={email} onChange={e => setEmail(e.target.value)} className={`${input} sm:col-span-2 disabled:opacity-60`} placeholder="Correo (cliente@correo.com)" />
            </div>
            {identidadBloqueada && !bloqueada && (
              <p className="text-[11.5px] text-mute mt-2">El nombre, teléfono y correo los puso el cliente en su solicitud — se corrigen desde su cuenta.</p>
            )}
          </div>

          {/* ⑤ Partidas: tabla editable en línea. El TIPO se mudó al
              encabezado del bloque — su propia nota decía "Se define por las
              partidas" y estaba tres secciones más arriba. */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <p className={`${labelSec} mb-0`}>Partidas</p>
                {/* `Segmentado` es `w-full` por dentro: en un renglón de flex se
                    estiraría o se iría solo a su línea. El ancho lo pone este
                    contenedor, no una clase que compita con la del componente. */}
                <div className="w-[188px] shrink-0">
                  <Segmentado
                    opciones={[{ key: 'venta', label: 'Venta' }, { key: 'renta', label: 'Renta' }]}
                    valor={c.tipo}
                    onChange={cambiarTipo}
                    disabled={bloqueada || c.items.length > 0}
                  />
                </div>
              </div>
              {conceptosBloqueados && !bloqueada
                ? <span className="text-[12px] font-semibold text-gold-ink">Las armó el cliente — solo lectura</span>
                : !bloqueada && <span className="text-[12px] text-mute">Toca cualquier celda para editar</span>}
            </div>
            {c.items.length > 0 && c.tipo !== 'mixta' && <p className="text-[11px] text-mute mb-2.5">El tipo ya lo definen las partidas.</p>}
            <div className="rounded-xl border border-edge overflow-hidden">
              <div className="overflow-x-auto">
                {/* En celular la partida se apila (concepto arriba, los campitos
                    abajo) para no obligar a scroll horizontal; de md en adelante
                    vuelve a ser la tabla de siempre con su ancho mínimo. */}
                <div className="md:min-w-[640px]">
                  {/* Encabezado de columnas */}
                  <div className="hidden md:flex items-center gap-2 px-3 py-2.5 bg-surface-2 border-b border-edge text-[10.5px] font-bold uppercase tracking-[0.06em] text-mute">
                    <div className="flex-1 min-w-0 pl-2">Concepto</div>
                    <div className="w-32 shrink-0">Modalidad</div>
                    <div className="w-16 shrink-0 text-center" title="Cuántas máquinas">Equipos</div>
                    <div className="w-16 shrink-0 text-center" title="Días / semanas / meses (renta)">Dur.</div>
                    <div className="w-28 shrink-0 text-right pr-2">P. Unit</div>
                    <div className="w-6 shrink-0" />
                  </div>
                  {c.items.length === 0 && <div className="px-5 py-6 text-center text-[13px] text-mute">Sin partidas todavía.</div>}
                  {c.items.map(it => (
                    <div key={it.id} className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 px-3 py-2 md:py-0 border-b border-edge last:border-0">
                      <div className="flex-1 min-w-0 py-1">
                        <input aria-label="Concepto" key={`${it.id}-${it.descripcion}`} defaultValue={it.descripcion} disabled={conceptosBloqueados} placeholder="Concepto"
                          onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.descripcion) editarItem(it.id, 'descripcion', v) }}
                          className={celda} />
                      </div>
                      {/* `md:contents` disuelve este contenedor en escritorio: los
                          campos vuelven a ser hijos directos de la fila y conservan
                          sus anchos de columna. En celular agrupan en su renglón. */}
                      <div className="flex flex-wrap items-end gap-2 md:contents">
                      <div className="w-full md:w-32 shrink-0 py-1">
                        <span className="md:hidden block text-[9.5px] font-bold uppercase tracking-[0.06em] text-mute pl-2">Modalidad</span>
                        <select aria-label="¿Se vende o se renta?" value={it.modalidad} disabled={conceptosBloqueados} title="¿Se vende o se renta?"
                          onChange={e => cambiarModalidad(it.id, e.target.value as Modalidad)}
                          className={`${celda} cursor-pointer font-medium`}>
                          {MODALIDADES.map(mm => <option key={mm.key} value={mm.key} className="bg-surface text-ink">{mm.corto}</option>)}
                        </select>
                      </div>
                      <div className="w-16 shrink-0 py-1">
                        <span className="md:hidden block text-[9.5px] font-bold uppercase tracking-[0.06em] text-mute text-center">Equipos</span>
                        <input aria-label="Cantidad" type="number" min={1} defaultValue={it.cantidad} disabled={conceptosBloqueados} title="Cuántas máquinas"
                          onBlur={e => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== it.cantidad) editarItem(it.id, 'cantidad', v) }}
                          className={`${celda} text-center`} />
                      </div>
                      <div className="w-16 shrink-0 py-1">
                        <span className="md:hidden block text-[9.5px] font-bold uppercase tracking-[0.06em] text-mute text-center">Dur.</span>
                        {/* Duración = periodos de renta; en venta no aplica. */}
                        {it.modalidad === 'venta'
                          ? <div className={`${celda} text-center text-mute cursor-default`}>—</div>
                          : <input aria-label="Duración" key={`${it.id}-dur-${it.duracion}`} type="number" min={1} defaultValue={it.duracion || 1} disabled={conceptosBloqueados}
                              title="Cuántos días / semanas / meses"
                              onBlur={e => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== (it.duracion || 1)) editarItem(it.id, 'duracion', v) }}
                              className={`${celda} text-center`} />}
                      </div>
                      <div className="flex-1 min-w-[96px] md:flex-none md:w-28 shrink-0 py-1">
                        <span className="md:hidden block text-[9.5px] font-bold uppercase tracking-[0.06em] text-mute text-right pr-2">P. Unit</span>
                        <CeldaDinero etiqueta="Precio unitario" key={`${it.id}-${it.precio_unitario}`} valor={it.precio_unitario} disabled={conceptosBloqueados}
                          onConfirmar={v => editarItem(it.id, 'precio_unitario', v)}
                          className={`${celda} text-right font-bold tabular-nums`} />
                        {Number(it.precio_lista) > 0 && Number(it.precio_unitario) !== Number(it.precio_lista) && (
                          /* Se capturó un precio distinto al de la web: la
                             desviación se ve, no se esconde. */
                          <p className={`text-[10px] text-right pr-2 pb-1 font-bold ${Number(it.precio_unitario) < Number(it.precio_lista) ? 'text-taller-ink' : 'text-blue-600'}`}>
                            lista {orMoney(Number(it.precio_lista))} · {Number(it.precio_unitario) < Number(it.precio_lista) ? '−' : '+'}{Math.abs(Math.round((Number(it.precio_unitario) - Number(it.precio_lista)) / Number(it.precio_lista) * 100))}%
                          </p>
                        )}
                      </div>
                      <div className="w-6 shrink-0 flex justify-center py-1 md:py-0">
                        {!conceptosBloqueados && (
                          <button onClick={() => quitarItem(it.id)} title="Quitar" className="text-red-500 hover:bg-red-500/10 rounded p-1 transition active:scale-90">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        )}
                      </div>
                      </div>
                    </div>
                  ))}
                  {!conceptosBloqueados && (
                    <button onClick={() => setEligiendoMaquina(true)} disabled={busy} className="w-full flex items-center gap-2 px-5 py-3 text-[13px] font-bold text-gold-ink hover:bg-gold-soft/60 transition active:scale-[0.995] disabled:opacity-50 border-t border-edge">
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
          </div>

          {/* ⑥ Totales. El encabezado ya lleva el total en 27px; esto de aquí
              es la comprobación de la suma, no un segundo titular, así que va
              en tamaño de dato. Antes salía dos veces y las dos en grande. */}
          <div className="flex justify-end">
            <div className="w-full sm:max-w-[340px] space-y-2.5">
              <div className="flex items-center justify-between text-[14px]"><span className="text-mute">Subtotal</span><span className="text-ink tabular-nums font-medium">{orMoney(baseMonto)}</span></div>
              <div className="flex items-center justify-between text-[14px] pb-2.5 border-b border-edge">
                {/* El interruptor de factura se fue a Condiciones: es una
                    condición del documento, no un renglón de la suma. Aquí
                    solo se dice de dónde sale la cifra. */}
                <span className="text-mute">IVA (16%) <span className="text-[11px]">{esVenta
                  ? '· ya incluido en el precio'
                  : aplicaIva ? '· con factura' : '· sin factura'}</span></span>
                <span className="text-ink tabular-nums font-medium">{orMoney(ivaMonto)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-mute text-[13.5px]">Total</span>
                <span className="text-[17px] font-bold text-ink tabular-nums leading-none">{orMoney(totalMonto)}</span>
              </div>
              {esVenta && <div className="flex items-center justify-between text-[11.5px] text-mute"><span>Pago de contado (−5%)</span><span className="tabular-nums">{orMoney(totalMonto * 0.95)}</span></div>}
            </div>
          </div>

          {/* ⑦ Condiciones: vigencia, factura, entrega y notas andaban en
              cuatro lugares distintos de la hoja —una arriba con el estado,
              otra dentro de los totales, dos sueltas al final— y son lo mismo:
              lo que modifica el documento. */}
          <div>
            <p className={labelSec}>Condiciones</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <label className={labelCot} htmlFor="cot-vigencia">Vigencia</label>
                <div className="relative">
                  <input id="cot-vigencia" type="number" min={1} disabled={bloqueada} value={vigencia} onChange={e => setVigencia(e.target.value)} className={`${input} pr-14 disabled:opacity-60`} />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mute text-sm pointer-events-none">días</span>
                </div>
              </div>
              {/* Venta: el precio ya trae el IVA, no hay nada que decidir.
                  Renta: depende de si el cliente pide factura. */}
              {!esVenta && (
                <div>
                  <p className={labelCot}>¿Lleva factura?</p>
                  <div className={`flex items-center gap-2.5 min-h-[42px] ${bloqueada ? 'opacity-60' : ''}`}>
                    <Switch checked={aplicaIva} disabled={bloqueada} onChange={setAplicaIva} label="¿Factura? (suma IVA)" />
                    <span className="text-[13.5px] text-ink">{aplicaIva ? 'Sí — se le suma el IVA' : 'No — sin IVA'}</span>
                  </div>
                </div>
              )}
              {verEntrega && (
                <div>
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
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={labelCot} htmlFor="cot-notas">Notas</label>
                <textarea id="cot-notas" className={`${input} campo-area disabled:opacity-60`} rows={3} disabled={bloqueada} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Condiciones, entrega, etc." />
              </div>
            </div>
            <p className="text-[11.5px] text-mute mt-3">Los datos del cliente, la vigencia y las notas se guardan con “Guardar”.</p>
          </div>

          {/* ⑧ Fotos: para que el cliente vea CÓMO ES la máquina. Por eso la
              sección entera desaparece cuando la cotización la armó él: la
              escogió del catálogo de la tienda, con sus fotos delante.

              La excepción es que ya tenga fotos —alguien de administración se
              las subió antes de esta regla—. Ahí sí se pintan, porque siguen
              saliendo en la carta y en el PDF: esconderlas dejaría fotos
              invisibles y activas, que es lo peor de los dos mundos. Se pueden
              quitar, pero ya no agregar. El cliente nunca sube fotos: el
              endpoint es `@permission_classes([PuedeCotizar])`. */}
          {(!laHizoElCliente || fotos.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-2 gap-3">
              <label className={`${labelSec} mb-0`}>Fotos ({fotos.length})</label>
              {puedeSubirFotos && (
                <button type="button" onClick={() => fotoInput.current?.click()} disabled={subiendoFotos || fotos.length >= 10}
                  className="text-[12px] font-bold text-gold-ink hover:opacity-80 transition active:scale-95 disabled:opacity-50">
                  {subiendoFotos ? 'Subiendo…' : '+ Agregar fotos'}
                </button>
              )}
              <input aria-label="Fotos de la cotización" ref={fotoInput} type="file" accept="image/*" multiple className="hidden" onChange={subirFotos} />
            </div>
            {fotos.length === 0 ? (
              bloqueada ? (
                <p className="text-[12px] text-mute">Sin fotos.</p>
              ) : (
                <button type="button" onClick={() => fotoInput.current?.click()} disabled={subiendoFotos}
                  className="w-full py-6 rounded-xl border border-dashed border-edge text-[12px] text-mute hover:text-ink hover:border-gold/50 transition-colors disabled:opacity-50">
                  Agrega imágenes del equipo para que el cliente vea cómo es la máquina.
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
            {puedeSubirFotos && fotos.length > 0 && <p className="text-[11px] text-mute mt-2">Hasta 10 fotos. Aparecen en la carta y el PDF del cliente.</p>}
            {laHizoElCliente && fotos.length > 0 && (
              <p className="text-[11px] text-mute mt-2">
                La cotización la armó el cliente, así que no hacen falta fotos: él escogió las máquinas del catálogo. Estas se subieron desde el panel y siguen saliendo en la carta y el PDF{bloqueada ? '.' : ' — quítalas si sobran.'}
              </p>
            )}
          </div>
          )}

        </div>

        <div className="px-5 sm:px-7 py-3.5 border-t border-edge flex flex-col sm:flex-row sm:items-center gap-2.5 bg-surface shrink-0">
          {/* El documento del cliente: UNA puerta, no tres.
              Había "Imprimir" y "Descargar PDF" aquí, y la vista previa que abría
              el primero ya trae dentro esos mismos dos botones — tres caminos
              para dos acciones. Ahora se abre la orden y se decide viéndola:
              nadie imprime a ciegas un documento que va a firmar un cliente. */}
          <div className="grid grid-cols-3 sm:flex gap-2 sm:mr-auto">
            <button onClick={() => onPrint({ ...c, notas, vigencia_dias: Number(vigencia) || 15, aplica_iva: aplicaIva, base: String(baseMonto), iva: String(ivaMonto), total: String(totalMonto) })} disabled={!completa} title={!completa ? 'Agrega cliente y al menos un concepto' : 'Ver la orden en carta antes de imprimirla'} className="py-2.5 sm:px-4 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
              </svg>
              Ver la orden
            </button>
            <button onClick={imprimirPDF} disabled={documento === 'impresion' || !completa} title={!completa ? 'Agrega cliente y al menos un concepto' : undefined} className="py-2.5 sm:px-4 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              {documento === 'impresion'
                ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin shrink-0" />
                : <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>}
              Imprimir
            </button>
            <button onClick={descargarPDF} disabled={documento === 'descarga' || !completa} title={!completa ? 'Agrega cliente y al menos un concepto' : undefined} className="py-2.5 sm:px-4 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
              {documento === 'descarga'
                ? <span className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin shrink-0" />
                : <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}
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

          {/* Acción de negocio: no aplica en estados finales (cancelada/rechazada). */}
          {/* Ya concretada: el botón lleva al comprobante de lo que se hizo.
              Antes decía "Ver ticket" y llamaba a `convertir` para TODAS: con
              una renta el atajo idempotente no aplica (no hay venta_id) y el
              admin caía en el diálogo "Convertir en venta", que no viene a
              cuento. La excepción real es la MIXTA con la renta ya concretada:
              ahí sí falta convertir su parte de venta. */}
          {!cotCerrada && (c.venta_id ? (
            <button onClick={() => onConvertida(c.venta_id as number)} className="w-full sm:w-auto py-2.5 px-5 rounded-full text-sm font-bold transition active:scale-[0.98] flex items-center justify-center gap-2 border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5L20 6" /></svg>
              Ver la orden en carta
            </button>
          ) : c.renta_id && c.tipo !== 'mixta' ? (
            /* Lleva A la renta. Antes bajaba su orden en PDF: dos botones con el
               mismo ícono de descarga, uno al lado del otro, y el que decía
               "Ver" no llevaba a ningún lado. Los documentos están a la
               izquierda; esto es navegación. */
            <button onClick={() => traspasarARenta(c.renta_id as number)} className="w-full sm:w-auto py-2.5 px-5 rounded-full text-sm font-bold transition active:scale-[0.98] flex items-center justify-center gap-2 border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10">
              Ver la renta #{c.renta_id}
              <svg className={`w-4 h-4 shrink-0 ${traspasando ? 'flecha-vuela' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          ) : !bloqueada && c.estado === 'aceptada' && (c.tipo === 'renta' || c.tipo === 'mixta') ? (
            /* Lo que sigue. Estaba arriba, colgando de la barra de Estado, que
               solo informa; las acciones viven en el pie. Y así ocupa el mismo
               lugar que "Ver la renta #N": la acción se convierte en su
               resultado sin que la vista se reacomode. */
            <button onClick={concretarRenta} className="w-full sm:w-auto py-2.5 px-5 rounded-full btn-renta text-sm font-bold transition active:scale-[0.98] flex items-center justify-center gap-2">
              Concretar renta
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          ) : c.tipo === 'renta' ? (
            <div className="w-full sm:w-auto py-2.5 px-4 rounded-full border border-edge text-mute text-[12px] font-medium flex items-center justify-center text-center" title="Acéptala para poder concretar la renta">
              Acéptala primero
            </div>
          ) : c.estado !== 'aceptada' ? (
            <div className="w-full sm:w-auto py-2.5 px-4 rounded-full border border-edge text-mute text-[12px] font-medium flex items-center justify-center text-center" title="Marca la cotización como “Aceptada” para poder convertirla en venta o pedirla sobre pedido">
              Acéptala primero
            </div>
          ) : (
            <button onClick={concretarVenta} disabled={busy} className="w-full sm:w-auto py-2.5 px-5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5L20 6" /></svg>
              {sinStock ? 'Registrar sobre pedido' : c.tipo === 'mixta' ? `Convertir la venta (${orMoney(c.subtotal_venta)})` : 'Convertir a venta'}
            </button>
          ))}
        </div>
      </div>

      {eligiendoMaquina && (
        <SelectorMaquina
          modo={c.tipo}
          onElegir={(sel) => { void agregarDeSeleccion(sel) }}
          onCerrar={() => { setEligiendoMaquina(false) }}
          /* El tipo se puede corregir DESDE el selector mientras la cotización
             siga admitiéndolo — las mismas condiciones que el control de arriba
             (`disabled={bloqueada || c.items.length > 0}`). Una cotización nueva
             nace en 'venta', así que sin esto abres el selector filtrando venta
             aunque vengas a rentar. */
          onCambiarModo={!bloqueada && c.items.length === 0 ? cambiarTipo : undefined}
        />
      )}
      {pedidoDesde && (
        <NuevoPedidoModal
          desde={pedidoDesde}
          empresas={empresas}
          onClose={() => setPedidoDesde(null)}
          onDone={() => { setPedidoDesde(null); onChanged(); onClose() }}
          notify={notify}
        />
      )}
      {zoomFoto && createPortal(
        <Modal className="modal-in fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClose={() => setZoomFoto(null)} label="Foto de la cotización">
          <img src={resolveMediaUrl(zoomFoto.imagen)} alt="Foto de la cotización" onClick={e => e.stopPropagation()}
            className="max-w-3xl w-full max-h-[85vh] object-contain rounded-xl" />
        </Modal>,
        document.body,
      )}
    </Modal>
  )
}
