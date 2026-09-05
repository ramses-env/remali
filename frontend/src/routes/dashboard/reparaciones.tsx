/**
 * Reparaciones: ordenes de servicio (recibir un equipo, registrar el trabajo,
 * cobrar refacciones y entregar). El alta de la orden se comparte con Mi
 * jornada y por eso vive en ./nueva-orden.
 *
 * Dos puertas a una orden, como en cotizaciones: el MODAL es el escritorio
 * donde se trabaja (con la lista viva detrás) y la HOJA —`/dashboard/
 * reparaciones/<id>`— es la vista de sólo lectura, con su propio enlace.
 */
import { useEffect, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Modal from '../../components/Modal'
import { createPortal } from 'react-dom'
import api from '../../lib/api'
import { descargarBlob } from '../../lib/descargar'
import OrdenCartaModal from '../../components/OrdenCartaModal'
import { type Notify } from '../../store/toast'
import { KpiGrid } from '../../components/ui/kpi-grid'
import Paginador from '../../components/ui/paginador'
import { usePaginado } from '../../components/ui/usar-paginado'
import { Monto } from '../../components/ui/numero'
import {
  Card, CardBarra, EstadoVacio, FilasEsqueleto, FiltroChips, InputDinero, type Empresa, MenuFila, OR_ESTADOS,
  type OrdenReparacion, type Refaccion,
  type Unidad, esFinal, orEstadoMeta, orLabel, orMoney,
  orPasos,
} from './comun'
import {
  Avatar, Bloque, BTN_DOC, Dato, DocsHoja, Hito, Migas, Pasos,
} from './hoja'
import { descargarCSV } from './hoja-csv'
import { diasEntre, fechaLarga } from './hoja-fechas'
import { NuevaOrdenModal } from './nueva-orden'
import { anotarFallo } from '../../lib/fallo'

type PropsRep = {
  ordenes: OrdenReparacion[]; refacciones: Refaccion[]; unidades: Unidad[]; empresas: Empresa[]
  /** La lista todavía viene en camino: el vacío no es un vacío de verdad. */
  cargando?: boolean
  reload: () => void; notify: Notify
  abrirId?: number | null; onAbierto?: () => void
}

/** La dirección de la hoja de una orden (el "Ver" del menú de la fila). */
const rutaOrden = (id: number) => `/dashboard/reparaciones/${id}`

/** Un icono de máquina, para cuando la orden NO es de un cliente: unas
 *  iniciales inventadas sobre "Máquina propia" mentirían. */
const ICONO_MAQUINA = (
  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18h4l2-5 3 7 2-9 2 5h5" /><rect x="2.5" y="4" width="19" height="16" rx="2.5" />
  </svg>
)

/** Qué tanto avanzó la orden por su camino. Ojo con la MÁQUINA PROPIA: sus
 *  pasos son tres (no se "entrega" a nadie), así que el porcentaje se calcula
 *  sobre los pasos que esa orden sí recorre — no sobre los cuatro de siempre. */
/** En qué escalón va. Un estado que NO está en la lista de esa orden cae al
 *  último y no al primero: le pasa a la máquina propia marcada 'entregada'
 *  —un estado que su camino de tres pasos no contempla—, y pintarla en el
 *  escalón 1 diría que apenas entró al taller. */
function indicePaso(pasos: { key: string }[], estado: string): number {
  const i = pasos.findIndex(p => p.key === estado)
  return i < 0 ? pasos.length - 1 : i
}

export default function ReparacionesAdmin(props: PropsRep) {
  const { pathname } = useLocation()
  const id = Number(pathname.replace(/^\/dashboard\/reparaciones\/?/, '').split('/')[0])
  /* Se monta UNA de las dos, no la lista con la hoja encima. La `key` es el id
     para que saltar de una orden a otra parta de cero. */
  if (Number.isFinite(id) && id > 0) return <OrdenVista key={id} id={id} {...props} />
  return <ListaReparaciones {...props} />
}

function ListaReparaciones({ ordenes, refacciones, unidades, empresas, reload, notify, abrirId, onAbierto, cargando }: PropsRep) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todas' | OrdenReparacion['estado']>('todas')
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [detalle, setDetalle] = useState<OrdenReparacion | null>(null)
  const [carta, setCarta] = useState<OrdenReparacion | null>(null)

  /* Dos puertas a propósito: "Abrir" es el escritorio (el modal, con la lista
     detrás) y "Ver" es la hoja completa en su propia dirección. */
  const abrir = (o: OrdenReparacion) => setDetalle(o)
  const ver = (o: OrdenReparacion) => nav(rutaOrden(o.id))

  // Apertura automática de una orden (p.ej. recién creada desde Inventario)
  useEffect(() => {
    if (!abrirId) return
    const found = ordenes.find(o => o.id === abrirId)
    if (found) { setDetalle(found); onAbierto?.() }
    else { api.get<OrdenReparacion>(`/reparaciones/${abrirId}/`).then(r => setDetalle(r.data)).catch(anotarFallo).finally(() => onAbierto?.()) }
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

  // El historial del taller no se archiva: cada equipo que entra deja su orden
  // para siempre. Se pagina la tabla; las cifras de arriba (abiertas, facturado,
  // costo interno) siguen leyendo TODAS las órdenes, que es lo que preguntan.
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtradas, undefined, [q, filtro])

  const fechaCorta = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—')

  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          { label: 'Órdenes', value: ordenes.length, tone: 'default', helper: `${ordenes.length - abiertas} ya cerradas`, icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
          {
            label: 'Abiertas', value: abiertas, tone: 'gold', emphasis: abiertas > 0,
            helper: abiertas ? 'equipos adentro del taller ahora' : 'el taller está al día',
            progreso: ordenes.length ? abiertas / ordenes.length : 0,
            icon: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></>,
          },
          { label: 'Facturado', value: <Monto valor={facturado} />, tone: 'default', helper: 'trabajo cobrado a clientes', icon: <><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></> },
          { label: 'Costo interno', value: <Monto valor={costoInterno} />, tone: 'default', helper: 'lo que costó reparar máquina propia', icon: <><path d="M3 20V9l6 4V9l6 4V4h5v16z" /></> },
        ]}
      />

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
        <CardBarra titulo="Órdenes de reparación" cuenta={filtradas.length}>
          <div className="relative w-full sm:w-64">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
            <input aria-label="Buscar folio, cliente o equipo" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio, cliente o equipo…" className="campo campo-sm pl-10" />
          </div>
          <button onClick={() => setNuevaOpen(true)} className="btn-acento shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13.5px] font-bold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">Nueva orden</span>
          </button>
        </CardBarra>

        <FiltroChips
          className="px-4 py-3 border-b border-edge"
          valor={filtro}
          onChange={v => setFiltro(v as any)}
          opciones={[
            { valor: 'todas', label: 'Todas', cuenta: ordenes.length },
            ...OR_ESTADOS.map(e => ({ valor: e.key as string, label: e.label, cuenta: ordenes.filter(o => o.estado === e.key).length })),
          ]}
        />

        <div className="overflow-x-auto">
          <table className="tabla-panel w-full min-w-[980px] text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.09em] text-mute border-b border-edge">
                <th className="font-semibold px-5 py-3">Cliente</th>
                <th className="font-semibold px-3 py-3">Folio #</th>
                <th className="font-semibold px-3 py-3">Equipo</th>
                <th className="font-semibold px-3 py-3">Estado</th>
                <th className="font-semibold px-3 py-3 text-center">Días</th>
                <th className="font-semibold px-3 py-3 text-right">Total</th>
                <th className="font-semibold px-3 py-3">Recibida</th>
                <th className="font-semibold px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {enPantalla.map(o => {
                const m = orEstadoMeta(o.estado)
                const interna = o.tipo === 'interna'
                const dias = diasEntre(o.fecha_recibida, esFinal(o) ? (o.fecha_entrega || o.actualizado_en) : null)
                return (
                  <tr key={o.id} className="hover:bg-surface-2 transition-colors cursor-pointer" onClick={() => abrir(o)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar nombre={o.cliente_display} icono={interna ? ICONO_MAQUINA : undefined} />
                        <div className="min-w-0">
                          {interna
                            ? <p className="text-sm font-semibold text-mute italic">Máquina propia</p>
                            : <p className="text-sm font-semibold text-ink truncate">{o.cliente_display}</p>}
                          <p className="text-[11.5px] text-mute truncate tabular-nums">
                            {interna ? (o.empresa_nombre || 'Del taller') : (o.cliente_telefono || 'Sin teléfono')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-col="Folio" className="px-3 py-3 font-mono text-[13px] font-bold text-ink whitespace-nowrap">#{o.folio}</td>
                    <td data-col="Equipo" className="px-3 py-3 text-[13.5px] text-ink max-w-[220px] truncate"><span>{o.equipo_display}</span></td>
                    {/* La insignia sola. El anillo de progreso que iba a su
                        izquierda decía lo mismo con otro dibujo —y en una
                        columna de tabla, un porcentaje sin escala no se lee: se
                        ve un círculo a medio pintar y hay que adivinarlo. El
                        avance sigue estando, con sus pasos, dentro de la orden. */}
                    <td data-col="Estado" className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{orLabel(o.estado, o.tipo)}</span>
                    </td>
                    {/* Cuánto lleva el equipo adentro. Es el dato que decide a
                        cuál orden correrle, y no estaba en ninguna columna. */}
                    <td data-col="Días" className="px-3 py-3 text-center">
                      <span className={`text-[13px] tabular-nums font-semibold ${!esFinal(o) && (dias ?? 0) >= 7 ? 'text-taller-ink' : 'text-mute'}`}>
                        {dias === null ? '—' : dias}
                      </span>
                    </td>
                    <td data-col="Total" className="px-3 py-3 text-sm font-bold text-price text-right whitespace-nowrap"><span>{orMoney(o.total)}</span></td>
                    <td data-col="Recibida" className="px-3 py-3 text-[13px] text-mute whitespace-nowrap"><span>{fechaCorta(o.fecha_recibida)}</span></td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end">
                        <MenuFila
                          etiqueta="Acciones"
                          opciones={[
                            { label: 'Ver', onClick: () => ver(o), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></svg> },
                            { label: 'Abrir para editar', onClick: () => abrir(o), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> },
                            { label: 'Ver la orden en carta', onClick: () => setCarta(o), icono: <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg> },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtradas.length === 0 && (cargando ? <FilasEsqueleto filas={5} columnas={4} /> : (
            <EstadoVacio
              titulo={q || filtro !== 'todas' ? 'Sin órdenes con ese criterio' : 'El taller está limpio'}
              mensaje={q || filtro !== 'todas'
                ? 'Cambia el filtro de estado o borra la búsqueda.'
                : 'Cada equipo que entra a reparación lleva su orden: qué traía, qué se le hizo y cuánto costó.'}
              icono={<><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></>}
              accion={!q && filtro === 'todas' ? <button onClick={() => setNuevaOpen(true)} className="btn-acento h-9 px-4 rounded-full text-[13px] font-bold">Nueva orden</button> : undefined}
            />
          ))}
        </div>
        <Paginador {...pagProps} nombre="órdenes" />
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

/**
 * La orden de SOLO LECTURA, en su propia dirección.
 *
 * Quién la lee: el del mostrador con el cliente enfrente preguntando "¿ya está
 * mi máquina?". Por eso mandan DOS cosas y el resto se hunde:
 *
 *   1. El total — lo que va a pagar.
 *   2. Los DÍAS EN EL TALLER — lo propio de una reparación. Un equipo adentro
 *      es un equipo que no trabaja: para el cliente son días parado, y para la
 *      rentadora una unidad que no cobra. Esa cuenta no estaba en ningún lado.
 */
function OrdenVista({ id, notify }: PropsRep & { id: number }) {
  const nav = useNavigate()
  const [o, setO] = useState<OrdenReparacion | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [carta, setCarta] = useState<OrdenReparacion | null>(null)
  const [bajando, setBajando] = useState(false)

  const cargar = useCallback(() => {
    api.get<OrdenReparacion>(`/reparaciones/${id}/`)
      .then(r => { setO(r.data); setFallo(null) })
      .catch(err => setFallo(err?.response?.status === 404
        ? 'Esta orden ya no existe: la borraron, o el enlace está mal.'
        : err?.response?.status === 403
          ? 'Tu sesión no tiene permiso para ver reparaciones. Vuelve a entrar con tu cuenta del panel.'
          : 'No se pudo cargar la orden.'))
  }, [id])
  useEffect(cargar, [cargar])

  const volver = () => nav('/dashboard/reparaciones')

  function bajarPDF() {
    if (!o) return
    setBajando(true)
    api.get(`/reparaciones/${o.id}/pdf/`, { responseType: 'blob' })
      .then(r => descargarBlob(r.data as Blob, `${o.folio || 'orden'}.pdf`))
      .catch(() => notify('No se pudo descargar el PDF', 'err'))
      .finally(() => setBajando(false))
  }

  /* El CSV es la orden COMO RENGLONES: la cabecera arriba, una fila por
     refacción, y los totales al final — la forma en que alguien la pega en su
     hoja de cálculo para sumarla con otras. Se arma aquí porque el dato ya está
     en pantalla. */
  function bajarCSV() {
    if (!o) return
    const filas: (string | number)[][] = [
      ['Folio', o.folio],
      ['Tipo', o.tipo === 'interna' ? 'Máquina propia' : 'Equipo de cliente'],
      ['Cliente', o.tipo === 'interna' ? 'Máquina propia' : o.cliente_display],
      ['Teléfono', o.tipo === 'interna' ? '' : (o.cliente_telefono || '')],
      ['Equipo', o.equipo_display],
      ['Unidad', o.unidad_codigo || ''],
      ['Número de serie', o.numero_serie || ''],
      ['Estado', orLabel(o.estado, o.tipo)],
      ['Recibida', new Date(o.fecha_recibida).toLocaleString('es-MX')],
      ['Entregada', o.fecha_entrega ? new Date(o.fecha_entrega).toLocaleString('es-MX') : 'Todavía no'],
      ['Días en el taller', diasEntre(o.fecha_recibida, esFinal(o) ? (o.fecha_entrega || o.actualizado_en) : null) ?? ''],
      ['Falla reportada', o.diagnostico || ''],
      ['Trabajo realizado', o.trabajo_realizado || ''],
      [],
      ['#', 'Refacción', 'Origen', 'Cantidad', 'Costo unitario', 'Importe'],
      ...o.items.map((it, i) => [
        i + 1, it.nombre, it.origen === 'stock' ? 'Del inventario' : 'Comprada aparte',
        it.cantidad, Number(it.costo_unitario) || 0, Number(it.subtotal) || 0,
      ]),
      [],
      ['', '', '', '', 'Mano de obra', Number(o.costo_mano_obra) || 0],
      ['', '', '', '', 'Refacciones', Number(o.total_refacciones) || 0],
      ['', '', '', '', o.tipo === 'interna' ? 'Costo interno' : 'Total', Number(o.total) || 0],
    ]
    descargarCSV(`${o.folio || 'orden'}.csv`, filas)
  }

  if (fallo) {
    return (
      <div className="space-y-4">
        <Migas seccion="reparaciones" etiqueta="Reparaciones" folio={`#${id}`} onInicio={() => nav('/dashboard/resumen')} onSeccion={volver} />
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <span className="text-sm text-ink flex-1">{fallo}</span>
          <button onClick={cargar} className="text-sm font-bold text-gold-ink dark:text-gold hover:underline">Reintentar</button>
          <button onClick={volver} className="text-sm font-bold text-ink hover:underline">Volver a la lista</button>
        </div>
      </div>
    )
  }
  if (!o) {
    return (
      <div className="grid place-items-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" aria-label="Cargando la orden" />
      </div>
    )
  }

  const m = orEstadoMeta(o.estado)
  const interna = o.tipo === 'interna'
  const cerrada = esFinal(o)
  const pasos = orPasos(o.tipo)
  const paso = cerrada ? pasos.length - 1 : indicePaso(pasos, o.estado)
  const dias = diasEntre(o.fecha_recibida, cerrada ? (o.fecha_entrega || o.actualizado_en) : null)
  const mano = Number(o.costo_mano_obra) || 0
  const refs = Number(o.total_refacciones) || 0

  return (
    <div className="space-y-4">
      <Migas seccion="reparaciones" etiqueta="Reparaciones" folio={`#${o.folio}`} onInicio={() => nav('/dashboard/resumen')} onSeccion={volver} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[26px] sm:text-[28px] font-extrabold tracking-tight text-ink leading-tight font-mono">#{o.folio}</h1>
          <p className="text-[13.5px] text-mute mt-1.5">Recibida el {fechaLarga(o.fecha_recibida)}</p>
        </div>
        {/* Lo que se lleva uno de aquí: el documento para el cliente y los
            datos para su hoja de cálculo. Para EDITAR se vuelve a la lista por
            las migas y se usa "Abrir para editar" de la fila — la hoja es de
            consulta y no se pretende que sea otra cosa. */}
        <DocsHoja onPDF={bajarPDF} onCSV={bajarCSV} bajando={bajando} />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        {/* ── Columna ancha: en qué va, de quién es y qué se le hizo ── */}
        <div className="space-y-4">
          <Bloque>
            <div className="flex items-center gap-2 flex-wrap mb-5">
              <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2.5 py-1 rounded-full ${m.cls}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{orLabel(o.estado, o.tipo)}</span>
              <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-mute">{interna ? 'Máquina propia' : 'Equipo de cliente'}</span>
              {!cerrada && (dias ?? 0) >= 7 && (
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-amber-500/12 text-taller-ink">{dias} días adentro</span>
              )}
            </div>
            <Pasos pasos={pasos.map(p => orLabel(p.key, o.tipo))} paso={paso} />
          </Bloque>

          {/* Cliente y equipo en UNA tarjeta: es el mismo dato —de quién es la
              máquina y cuál es—, y separarlos dejaba dos medias hojas vacías. */}
          <Bloque titulo={interna ? 'El equipo' : 'Cliente y equipo'}>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <div className="flex items-center gap-3">
                  <Avatar nombre={o.cliente_display} icono={interna ? ICONO_MAQUINA : undefined} />
                  <div className="min-w-0">
                    <p className={`text-[15px] font-bold truncate leading-tight ${interna ? 'text-mute italic' : 'text-ink'}`}>
                      {interna ? 'Máquina propia' : o.cliente_display}
                    </p>
                    {o.empresa_nombre && <p className="text-[12px] text-mute truncate mt-0.5">{o.empresa_nombre}</p>}
                  </div>
                </div>
                {!interna && (
                  <div className="mt-3.5 space-y-1.5">
                    <p className="flex items-center gap-2 text-[13px] text-mute min-w-0">
                      <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5c0 8 6 14 14 14l1.8-3.2-4.2-2-2 2a13 13 0 0 1-6.4-6.4l2-2-2-4.2z" /></svg>
                      <span className="truncate tabular-nums">{o.cliente_telefono || <span className="italic">Sin teléfono</span>}</span>
                    </p>
                    {o.cuenta && (
                      <p className="flex items-center gap-2 text-[13px] text-emerald-600 dark:text-emerald-400 font-semibold min-w-0">
                        <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                        <span className="truncate">Sigue la orden desde la cuenta de {o.cuenta}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="sm:border-l sm:border-edge sm:pl-6 space-y-3">
                <Dato etiqueta="Equipo">{o.equipo_display}</Dato>
                {o.unidad_codigo && <Dato etiqueta="Unidad"><span className="font-mono">{o.unidad_codigo}</span></Dato>}
                {o.numero_serie && <Dato etiqueta="Número de serie"><span className="font-mono break-all">{o.numero_serie}</span></Dato>}
              </div>
            </div>
          </Bloque>

          <div className="grid sm:grid-cols-2 gap-4 items-start">
            <Bloque titulo="Falla reportada">
              <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">
                {o.diagnostico || <span className="text-mute italic">Sin diagnóstico capturado.</span>}
              </p>
            </Bloque>
            <Bloque titulo="Trabajo realizado">
              <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">
                {o.trabajo_realizado || <span className="text-mute italic">Todavía no se registra el trabajo.</span>}
              </p>
            </Bloque>
          </div>

          {/* Libro de cuentas, no ficha de producto: de dónde salió la pieza,
              cuántas, a cómo, y el importe alineado con cifras tabulares. */}
          <Bloque titulo="Refacciones y materiales" extra={`${o.items.length} ${o.items.length === 1 ? 'pieza' : 'piezas'}`}>
            {o.items.length === 0 ? (
              <p className="text-[13px] text-mute py-8 text-center">Sin refacciones: el trabajo fue sólo mano de obra.</p>
            ) : (
              <ul className="divide-y divide-edge border-y border-edge">
                {o.items.map((it, i) => (
                  <li key={it.id} className="flex items-baseline gap-3 py-3">
                    <span aria-hidden="true" className="shrink-0 w-5 text-[11px] font-bold text-mute tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-ink leading-snug">{it.nombre}</p>
                      <p className="text-[12px] text-mute mt-0.5 tabular-nums">
                        {orMoney(it.costo_unitario)} × {it.cantidad}
                        <span aria-hidden="true" className="mx-1.5 text-mute/70">·</span>
                        <span className="font-sans">{it.origen === 'stock' ? 'Del inventario' : 'Comprada aparte'}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-[14.5px] font-bold text-ink tabular-nums">{orMoney(it.subtotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>

          {o.notas && (
            <Bloque titulo="Notas internas">
              <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">{o.notas}</p>
            </Bloque>
          )}
        </div>

        {/* ── Columna angosta: el dinero, el tiempo adentro y el historial ── */}
        <div className="space-y-4">
          <Bloque>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">
              {interna ? 'Costo interno' : 'Total de la orden'}
            </p>
            {/* EL foco de la pantalla. Una sola cosa en dorado por vista. */}
            <p className="text-[34px] font-extrabold text-price tabular-nums leading-none mt-2 tracking-tight">{orMoney(o.total)}</p>
            <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3 space-y-2">
              <p className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-mute">Mano de obra</span>
                <span className="text-ink font-semibold tabular-nums">{orMoney(mano)}</span>
              </p>
              <p className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-mute">Refacciones</span>
                <span className="text-ink font-semibold tabular-nums">{orMoney(refs)}</span>
              </p>
              <p className="flex items-baseline justify-between gap-3 text-[13.5px] pt-2 border-t border-edge">
                <span className="text-ink font-bold">{interna ? 'Costo' : 'Total'}</span>
                <span className="text-ink font-bold tabular-nums">{orMoney(o.total)}</span>
              </p>
            </div>
            <p className="text-[12px] text-mute mt-3 leading-relaxed">
              {interna
                ? 'Máquina propia: esto es COSTO del taller, no un cobro. No entra en lo facturado.'
                : 'Es lo que se le cobra al cliente al entregar.'}
            </p>
          </Bloque>

          {/* El tiempo adentro. Un equipo en el taller es un equipo que no
              trabaja: para el cliente son días parado y para la rentadora una
              unidad que no cobra. Es lo propio de una reparación, y no estaba. */}
          <Bloque>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">En el taller</p>
            <p className={`text-[17px] font-bold mt-1.5 ${!cerrada && (dias ?? 0) >= 7 ? 'text-taller-ink' : 'text-ink'}`}>
              {dias === null ? '—'
                : cerrada
                  ? `Estuvo ${dias} ${dias === 1 ? 'día' : 'días'}`
                  : dias === 0 ? 'Entró hoy' : `Lleva ${dias} ${dias === 1 ? 'día' : 'días'}`}
            </p>
            <div className="mt-4 pt-4 border-t border-edge space-y-3">
              <Dato etiqueta="Recibida">{fechaLarga(o.fecha_recibida)}</Dato>
              {o.fecha_entrega
                ? <Dato etiqueta={interna ? 'Terminada' : 'Entregada'}>{fechaLarga(o.fecha_entrega)}</Dato>
                : <Dato etiqueta={interna ? 'Terminada' : 'Entregada'}><span className="text-mute font-medium">Todavía no</span></Dato>}
            </div>
          </Bloque>

          {/* El documento va ANTES del historial: es acción. Una sola puerta —la
              vista previa ya trae dentro imprimir. */}
          <Bloque titulo="El documento">
            <button onClick={() => setCarta(o)} className={`${BTN_DOC} w-full`}>
              <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>
              Ver la orden en carta
            </button>
          </Bloque>

          <Bloque titulo="Historial">
            <ol>
              <Hito tono="hecho" titulo="Equipo recibido" cuando={o.fecha_recibida} />
              {o.estado !== 'recibida' && <Hito tono="hecho" titulo={orLabel(o.estado, o.tipo)} cuando={o.actualizado_en} nota={o.actualizado_en ? undefined : 'Sin fecha registrada'} />}
              <Hito
                tono={cerrada ? 'hecho' : 'pendiente'}
                titulo={interna ? 'Terminada' : 'Entregada al cliente'}
                cuando={o.fecha_entrega || undefined}
                nota={o.fecha_entrega ? undefined : 'Falta'}
                ultimo
              />
            </ol>
          </Bloque>
        </div>
      </div>

      {carta && <OrdenCartaModal orden={carta} onClose={() => setCarta(null)} />}
    </div>
  )
}

function OrdenDetalleModal({ orden, refacciones, notify, onClose, onChanged, onPrint }: {
  orden: OrdenReparacion; refacciones: Refaccion[]; notify: Notify
  onClose: () => void; onChanged: () => void; onPrint: (o: OrdenReparacion) => void
}) {
  const [o, setO] = useState<OrdenReparacion>(orden)
  const [trabajo, setTrabajo] = useState(orden.trabajo_realizado || '')
  const [diag, setDiag] = useState(orden.diagnostico || '')
  const [mano, setMano] = useState(String(Number(orden.costo_mano_obra) || 0))
  const [notas, setNotas] = useState(orden.notas || '')
  const [clienteNombre, setClienteNombre] = useState(orden.cliente_nombre || '')
  const [clienteTel, setClienteTel] = useState(orden.cliente_telefono || '')
  const [savingInfo, setSavingInfo] = useState(false)
  const [busy, setBusy] = useState(false)
  // Liga de vinculación a la cuenta del cliente (un solo uso).
  const [liga, setLiga] = useState('')
  const [ligaCopiada, setLigaCopiada] = useState(false)
  const [generandoLiga, setGenerandoLiga] = useState(false)

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
    // Cliente/teléfono solo aplican a órdenes de equipo de cliente (no a máquina propia).
    const extra = o.tipo === 'cliente' ? { cliente_nombre: clienteNombre.trim(), cliente_telefono: clienteTel.trim() } : {}
    api.patch<OrdenReparacion>(`/reparaciones/${o.id}/`, {
      diagnostico: diag, trabajo_realizado: trabajo, costo_mano_obra: Number(mano) || 0, notas, ...extra,
    })
      .then(r => { apply(r.data); notify('Orden actualizada') })
      .catch(() => notify('No se pudo guardar', 'err'))
      .finally(() => setSavingInfo(false))
  }

  async function generarLiga() {
    if (liga || generandoLiga) return
    setGenerandoLiga(true)
    try {
      const r = await api.post<{ ruta: string }>(`/reparaciones/${o.id}/vinculo/`, {}, { fondo: true } as never)
      setLiga(`${window.location.origin}${r.data.ruta}`)
    } catch (e: any) {
      notify(e?.response?.data?.detalle || 'No se pudo generar la liga', 'err')
    } finally { setGenerandoLiga(false) }
  }
  async function copiarLiga() {
    try { await navigator.clipboard.writeText(liga); setLigaCopiada(true); setTimeout(() => setLigaCopiada(false), 1800) }
    catch { notify('No se pudo copiar; selecciona el texto a mano', 'err') }
  }

  function cambiarEstado(estado: OrdenReparacion['estado']) {
    api.patch<OrdenReparacion>(`/reparaciones/${o.id}/`, { estado })
      .then(r => { apply(r.data); notify(`Estado: ${orLabel(estado, o.tipo)}`, 'info') })
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
      .then(r => { apply(r.data); notify('Refacción quitada', 'neutro') })
      .catch(() => notify('No se pudo quitar', 'err'))
  }

  const pasos = orPasos(o.tipo)
  const curIdx = pasos.findIndex(e => e.key === o.estado)
  const totalOrden = (Number(o.total_refacciones) || 0) + (Number(mano) || 0)
  const inp = 'campo'
  const inpSide = 'campo bg-surface'
  const capLabel = 'text-[11px] font-bold tracking-[0.5px] text-mute'

  return createPortal(
    <Modal className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-start justify-center p-0 sm:p-6 overflow-y-auto" onClose={onClose} label="Detalle de la orden de reparación">
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
                <textarea aria-label="Diagnóstico" value={diag} onChange={e => setDiag(e.target.value)} className={`${inp} campo-area`} />
              </div>
              <div>
                <div className={`${capLabel} mb-2`}>TRABAJO REALIZADO</div>
                <textarea aria-label="Describe lo que se le hizo al equipo" value={trabajo} onChange={e => setTrabajo(e.target.value)} placeholder="Describe lo que se le hizo al equipo" className={`${inp} campo-area`} />
              </div>
            </div>

            <div className={`${capLabel} mb-2`}>REFACCIONES Y MATERIALES</div>
            {o.items.length === 0 ? (
              <div className="border border-edge rounded-[9px] px-4 py-3.5 text-center text-[13px] text-mute bg-surface-2 mb-2.5">Sin refacciones. Agrega del inventario o compradas aparte.</div>
            ) : (
              <div className="border border-edge rounded-[9px] overflow-hidden mb-2.5">
                {o.items.map(it => (
                  <div key={it.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-edge last:border-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${it.origen === 'stock' ? 'bg-blue-500/10 text-blue-500' : 'bg-amber-500/10 text-taller-ink'}`}>{it.origen === 'stock' ? 'Inventario' : 'Aparte'}</span>
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
                <button onClick={() => setOrigen('stock')} className={`flex-1 py-[9px] rounded-[7px] text-[13px] font-bold border-[1.5px] transition-colors ${origen === 'stock' ? 'border-gold text-gold-ink bg-gold-soft' : 'border-edge text-ink hover:bg-surface-2'}`}>Del inventario</button>
                <button onClick={() => setOrigen('externa')} className={`flex-1 py-[9px] rounded-[7px] text-[13px] font-bold border-[1.5px] transition-colors ${origen === 'externa' ? 'border-gold text-gold-ink bg-gold-soft' : 'border-edge text-ink hover:bg-surface-2'}`}>Comprada / pedida aparte</button>
              </div>
              {origen === 'stock' ? (
                <div className="flex gap-2 mb-2.5">
                  <select aria-label="Refacción del stock" value={refId} onChange={e => setRefId(e.target.value)} className="campo campo-sm flex-1 w-auto">
                    <option value="">Selecciona una refacción…</option>
                    {disponibles.map(r => <option key={r.id} value={r.id}>{r.nombre} · {orMoney(r.precio_venta)} · stock {r.stock}</option>)}
                  </select>
                  <input aria-label="Cantidad" type="number" min={1} value={cant} onChange={e => setCant(e.target.value)} title="Cantidad" className="campo campo-sm w-[70px] px-2 text-center" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 mb-2.5">
                  <input aria-label="Nombre de la pieza (pedida aparte)" value={extNombre} onChange={e => setExtNombre(e.target.value)} placeholder="Nombre de la pieza (pedida aparte)" className="campo campo-sm" />
                  <InputDinero etiqueta="Costo c/u" compacto valor={extCosto} onValor={setExtCosto} placeholder="Costo c/u" className="sm:w-32" />
                  <input aria-label="Cantidad" type="number" min={1} value={cant} onChange={e => setCant(e.target.value)} title="Cantidad" className="campo campo-sm sm:w-[70px] px-2 text-center" />
                </div>
              )}
              <button onClick={agregarItem} disabled={busy} className="w-full py-2.5 rounded-[7px] border border-dashed border-edge text-mute font-bold text-[13px] hover:text-ink hover:border-gold/50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                {busy ? <span className="w-3.5 h-3.5 border-2 border-mute/40 border-t-mute rounded-full animate-spin" /> : '+'} Agregar refacción
              </button>
            </div>
          </div>

          {/* Panel lateral */}
          <div className="md:w-[260px] flex-none p-5 bg-surface-2">
            {o.tipo === 'cliente' && (
              <div className="mb-5">
                <div className={`${capLabel} mb-2`}>CLIENTE</div>
                <input aria-label="Nombre del cliente" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre del cliente" className={`${inpSide} mb-2`} />
                <input aria-label="Teléfono (10 dígitos)" value={clienteTel} onChange={e => setClienteTel(e.target.value)} inputMode="numeric" maxLength={10} placeholder="Teléfono (10 dígitos)" className={inpSide} />
                {/* Vincular a su cuenta: liga de un solo uso, como ventas/rentas. */}
                {o.cuenta ? (
                  <p className="mt-2.5 text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4"><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                    En la cuenta de {o.cuenta}
                  </p>
                ) : !liga ? (
                  <button onClick={generarLiga} disabled={generandoLiga}
                    className="mt-2.5 w-full py-2 rounded-[9px] border border-edge text-ink text-[12.5px] font-bold hover:bg-surface transition-colors disabled:opacity-50">
                    {generandoLiga ? 'Generando…' : 'Vincular a una cuenta'}
                  </button>
                ) : (
                  <div className="mt-2.5">
                    <p className="text-[11px] text-mute mb-1.5">Mándale esta liga al cliente; al abrirla con su cuenta, la orden aparece en “Mis reparaciones”.</p>
                    <div className="flex gap-1.5">
                      <input aria-label="Liga para compartir" readOnly value={liga} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 bg-surface border border-edge rounded-[8px] px-2.5 py-1.5 text-[11px] text-ink outline-none" />
                      <button onClick={copiarLiga} className={`px-2.5 py-1.5 rounded-[8px] text-[12px] font-bold border transition-colors ${ligaCopiada ? 'border-emerald-500/50 text-emerald-600' : 'border-edge text-ink hover:bg-surface'}`}>{ligaCopiada ? '✓' : 'Copiar'}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className={`${capLabel} mb-2`}>MANO DE OBRA ($)</div>
            <InputDinero etiqueta="Mano de obra" valor={mano} onValor={setMano} placeholder="0.00" className="mb-3.5" inputClassName={inpSide} />
            <div className={`${capLabel} mb-2`}>NOTAS INTERNAS</div>
            <input aria-label="Notas internas" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional" className={`${inpSide} mb-5`} />

            <div className={`${capLabel} mb-2.5`}>RESUMEN</div>
            <div className="flex justify-between text-[12.5px] text-mute mb-1.5"><span>Refacciones</span><span>{orMoney(o.total_refacciones)}</span></div>
            <div className="flex justify-between text-[12.5px] text-mute mb-3.5"><span>Mano de obra</span><span>{orMoney(mano)}</span></div>
            <div className="border-t border-edge pt-3 flex justify-between text-[17px] font-extrabold text-ink mb-[18px]"><span>{o.tipo === 'interna' ? 'Costo interno' : 'Total'}</span><span className="text-price">{orMoney(totalOrden)}</span></div>

            <div className="flex flex-col gap-2">
              <button onClick={guardarInfo} disabled={savingInfo} className="py-[11px] rounded-[9px] bg-gold text-gold-on font-bold text-[13.5px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
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
    </Modal>,
    document.body,
  )
}
