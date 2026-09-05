/**
 * SELECTOR DE MÁQUINA para una partida de cotización.
 *
 * Antes esto era un `elegir()` genérico: una lista plana con TODAS las máquinas
 * del catálogo, sin buscador, sin foto y sin importar si la máquina se rentaba o
 * se vendía. Pedía `/equipos/` y tiraba a la basura casi todo lo que ese
 * endpoint ya contesta — `ofrece_renta`, `venta_estado`, `renta_disponible`… —
 * quedándose solo con `{id, modelo, precio_*}`. La regla de qué se puede cotizar
 * lleva tiempo viviendo en `Equipo.disponibilidad_detallada`; el selector nunca
 * la miró.
 *
 * Aquí sí:
 *   · RENTA  → solo lo que de verdad se renta (precio por día/semana/mes y una
 *              unidad seminueva viva). Lo que existe pero está TODO rentado
 *              ahorita SÍ aparece, marcado: una cotización es una propuesta con
 *              vigencia de días, y negarte a cotizar hoy una máquina que se
 *              libera el jueves es regalar la renta. El candado de verdad ya
 *              existe al CONCRETAR, no aquí.
 *   · VENTA  → lo que se vende, con o sin existencia. Sin stock, el catálogo ya
 *              lo pasa solo a SOBRE PEDIDO (`venta_estado`), así que se cotiza
 *              igual y se avisa la entrega estimada.
 *   · MIXTA  → las dos cosas.
 *
 * Abajo, fija, la única salida: la PARTIDA LIBRE, para todo lo que no está en el
 * catálogo — la máquina que le compras al proveedor, el flete, el operador.
 * Antes eran dos renglones ("Máquina bajo pedido" y "Partida libre") que hacían
 * lo mismo, y el primero chocaba de nombre con el grupo SOBRE PEDIDO de arriba,
 * que sí es catálogo: tus máquinas con precio de venta y sin stock.
 *
 * El selector solo ELIGE; quien arma el payload sigue siendo la cotización.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import api from '../../lib/api'
import resolveMediaUrl from '../../lib/resolveMediaUrl'
import { orMoney, type Equipo } from './comun'

/** Qué eligió: una máquina del catálogo, o una partida capturada a mano.
 *
 *  Hubo un tercer renglón, "Una máquina que no tienes en catálogo", que hacía
 *  exactamente lo mismo que la partida libre y encima se confundía con el grupo
 *  SOBRE PEDIDO de arriba —que sí es de catálogo, solo que sin stock—. Tres
 *  nombres para dos ideas. Ahora la partida libre carga las dos: la máquina de
 *  proveedor y el flete. */
export type EleccionMaquina =
  | { tipo: 'equipo'; id: number }
  | { tipo: 'libre' }

/** Lo que `/equipos/` contesta y este selector necesita mirar. */
type EquipoSel = Equipo & {
  id: number
  ofrece_venta?: boolean
  ofrece_renta?: boolean
  venta_disponible?: boolean
  renta_disponible?: boolean
  venta_estado?: 'inmediata' | 'sobre_pedido' | 'sin_venta'
  entrega_estimada_dias?: number | null
}

const num = (v: unknown) => Number(v) || 0

/* Los respaldos (`??`) son a propósito: si un día el endpoint deja de mandar la
   bandera, el selector degrada a "tiene precio" en vez de quedarse en blanco. Un
   selector vacío se lee como que la app se rompió. */
const sirveParaRenta = (e: EquipoSel) =>
  typeof e.ofrece_renta === 'boolean'
    ? e.ofrece_renta
    : Boolean(num(e.precio_dia) || num(e.precio_semana) || num(e.precio_mes))

const sirveParaVenta = (e: EquipoSel) =>
  typeof e.ofrece_venta === 'boolean' ? e.ofrece_venta : Boolean(num(e.precio_venta))

/** Sin acentos y en minúsculas: "revolvedora" encuentra "Revolvedóra". */
const plano = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Los precios que aplican al modo, en una línea. */
function precios(e: EquipoSel, modo: Modo): string {
  const partes: string[] = []
  if (modo !== 'venta') {
    if (num(e.precio_dia)) partes.push(`${orMoney(num(e.precio_dia))} día`)
    if (num(e.precio_semana)) partes.push(`${orMoney(num(e.precio_semana))} semana`)
    if (num(e.precio_mes)) partes.push(`${orMoney(num(e.precio_mes))} mes`)
  }
  if (modo !== 'renta' && num(e.precio_venta)) {
    partes.push(`${orMoney(num(e.precio_venta))} venta`)
  }
  return partes.join(' · ') || 'Sin precio de lista'
}

type Modo = 'venta' | 'renta' | 'mixta'
type Tono = 'ok' | 'espera'

const CHIP: Record<Tono, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600',
  espera: 'bg-amber-500/10 text-taller-ink',
}

/** Título de grupo, pegado arriba mientras se recorre la lista. */
function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <p className="sticky top-0 z-10 px-4 py-1.5 bg-surface-2 border-b border-edge text-[10px] font-bold uppercase tracking-[0.08em] text-mute">
      {children}
    </p>
  )
}

function Chip({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${CHIP[tono]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tono === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {children}
    </span>
  )
}

/** Disponibilidad, en palabras. Nunca solo color: se lee de reojo y a contraluz. */
function Disponibilidad({ e, modo }: { e: EquipoSel; modo: Modo }) {
  const chips: React.ReactNode[] = []
  if (modo !== 'venta' && sirveParaRenta(e)) {
    chips.push(
      e.renta_disponible
        ? <Chip key="r" tono="ok">Libre para rentar</Chip>
        : <Chip key="r" tono="espera">
            Rentada ahora{num(e.unidades_rentadas) > 0 ? ` · ${num(e.unidades_rentadas)}` : ''}
          </Chip>,
    )
  }
  if (modo !== 'renta' && sirveParaVenta(e)) {
    const dias = num(e.entrega_estimada_dias ?? e.dias_entrega_pedido)
    chips.push(
      e.venta_estado === 'sobre_pedido' || e.venta_disponible === false
        ? <Chip key="v" tono="espera">Sobre pedido{dias > 0 ? ` · ~${dias} días` : ''}</Chip>
        : <Chip key="v" tono="ok">En existencia{num(e.stock_disponible) > 0 ? ` · ${num(e.stock_disponible)}` : ''}</Chip>,
    )
  }
  return <div className="flex flex-wrap items-center gap-1.5 mt-1">{chips}</div>
}

const ETIQUETA_MODO: Record<Modo, string> = { venta: 'Venta', renta: 'Renta', mixta: 'Venta y renta' }

/* Los dos grupos de cada modo. Ordenar por disponibilidad ya ponía lo entregable
   arriba, pero en silencio: sin encabezado, un renglón de sobre pedido en medio
   de la lista se lee como uno más. Con título, "Sobre pedido" se ve como lo que
   es —un grupo, el que le pides al proveedor— y deja de confundirse con la
   máquina que ni siquiera está en catálogo. */
const GRUPOS: Record<Modo, [string, string]> = {
  venta: ['En existencia', 'Sobre pedido'],
  renta: ['Libres ahora', 'Rentadas ahora'],
  mixta: ['Disponibles ahora', 'Sobre pedido o rentadas'],
}

/** ¿Se puede entregar hoy? Decide en qué grupo cae. */
function entregableHoy(e: EquipoSel, modo: Modo): boolean {
  if (modo === 'renta') return Boolean(e.renta_disponible)
  if (modo === 'venta') return e.venta_estado !== 'sobre_pedido' && e.venta_disponible !== false
  return Boolean(e.renta_disponible) || (e.venta_estado !== 'sobre_pedido' && e.venta_disponible !== false)
}

export function SelectorMaquina({ modo, onElegir, onCerrar, onCambiarModo }: {
  modo: Modo
  onElegir: (eleccion: EleccionMaquina) => void
  onCerrar: () => void
  /* Solo cuando la cotización todavía admite cambiar de tipo (sin partidas y
     sin bloquear). Existe porque una cotización NACE en 'venta' —provisional,
     lo pone el backend— así que abres "Agregar partida" filtrando venta aunque
     vengas a rentar, y el control para corregirlo estaba fuera del selector. */
  onCambiarModo?: (m: 'venta' | 'renta') => void
}) {
  const [equipos, setEquipos] = useState<EquipoSel[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const buscador = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    api.get<EquipoSel[]>('/equipos/', { fondo: true } as never)
      .then(r => { if (vivo) setEquipos(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (vivo) setError(true) })
    return () => { vivo = false }
  }, [])

  const lista = useMemo(() => {
    const base = (equipos ?? []).filter(e =>
      modo === 'renta' ? sirveParaRenta(e)
        : modo === 'venta' ? sirveParaVenta(e)
          : sirveParaRenta(e) || sirveParaVenta(e),
    )
    const busca = plano(q.trim())
    const filtrada = !busca ? base : base.filter(e => plano(
      `${e.modelo} ${e.categoria?.nombre ?? ''} ${e.marca?.nombre ?? ''} ${e.descripcion ?? ''}`,
    ).includes(busca))
    /* Lo que se puede entregar YA va primero. No se esconde nada: se agrupa por
       lo que resuelve hoy, que es lo que el cliente pregunta al teléfono. */
    return {
      ahora: filtrada.filter(e => entregableHoy(e, modo)),
      despues: filtrada.filter(e => !entregableHoy(e, modo)),
      total: filtrada.length,
    }
  }, [equipos, q, modo])

  const fila = 'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors active:scale-[0.995]'
  const [tituloAhora, tituloDespues] = GRUPOS[modo]

  const renglon = (e: EquipoSel) => (
    <button key={e.id} type="button" className={fila} onClick={() => onElegir({ tipo: 'equipo', id: e.id })}>
      {e.imagen
        ? <img src={resolveMediaUrl(e.imagen)} alt="" className="w-12 h-12 rounded-lg object-cover border border-edge shrink-0 bg-surface-2" />
        : <span className="w-12 h-12 rounded-lg border border-edge bg-surface-2 grid place-items-center shrink-0 text-mute" aria-hidden="true">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-5h6v5" /></svg>
          </span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-ink truncate">{e.modelo}</span>
        <span className="block text-[12px] text-mute truncate tabular-nums">{precios(e, modo)}</span>
        <Disponibilidad e={e} modo={modo} />
      </span>
    </button>
  )



  return (
    <Modal
      className="modal-in fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-0 sm:p-6"
      onClose={onCerrar}
      label="Agregar partida a la cotización"
    >
      <div
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-surface border border-edge rounded-none sm:rounded-2xl shadow-[0_20px_50px_rgba(33,29,22,0.18)] h-full sm:h-auto sm:max-h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-edge shrink-0">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-ink">Agregar partida</p>
            {onCambiarModo && modo !== 'mixta' ? (
              <span className="inline-flex rounded-full bg-surface-2 border border-edge p-0.5" role="group" aria-label="Tipo de cotización">
                {(['venta', 'renta'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={modo === m}
                    onClick={() => { if (modo !== m) onCambiarModo(m) }}
                    className={`px-3 py-1 rounded-full text-[11.5px] font-bold transition-colors ${
                      modo === m ? 'bg-ink text-app' : 'text-mute hover:text-ink'
                    }`}
                  >
                    {ETIQUETA_MODO[m]}
                  </button>
                ))}
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface-2 text-mute">
                {ETIQUETA_MODO[modo]}
              </span>
            )}
          </div>
          <div className="relative">
            <svg className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={buscador}
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por modelo, marca o categoría…"
              aria-label="Buscar máquina"
              className="campo pl-11"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-edge">
          {equipos === null && !error && (
            <p className="px-4 py-10 text-center text-[13px] text-mute">Cargando el catálogo…</p>
          )}
          {error && (
            <p className="px-4 py-10 text-center text-[13px] text-mute">
              No se pudo cargar el catálogo. Puedes agregar la partida a mano aquí abajo.
            </p>
          )}
          {equipos !== null && !error && lista.total === 0 && (
            <p className="px-6 py-10 text-center text-[13px] text-mute leading-relaxed">
              {q.trim()
                ? <>Ninguna máquina coincide con “{q.trim()}”.</>
                : modo === 'renta'
                  ? 'No hay máquinas configuradas para renta: necesitan precio por día, semana o mes y una unidad seminueva en inventario.'
                  : 'No hay máquinas configuradas para venta: necesitan precio de venta y una unidad nueva en inventario.'}
              {' '}Puedes agregarla a mano aquí abajo.
            </p>
          )}

          {lista.ahora.length > 0 && <Encabezado>{tituloAhora}</Encabezado>}
          {lista.ahora.map(renglon)}
          {lista.despues.length > 0 && <Encabezado>{tituloDespues}</Encabezado>}
          {lista.despues.map(renglon)}
        </div>

        {/* La salida, una sola: todo lo que no está en el catálogo. */}
        <div className="border-t border-edge bg-surface-2/50 shrink-0">
          <button type="button" className={fila} onClick={() => onElegir({ tipo: 'libre' })}>
            <span className="w-12 h-12 rounded-lg border border-dashed border-edge grid place-items-center shrink-0 text-gold-ink" aria-hidden="true">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h10" /></svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-ink">Partida libre</span>
              <span className="block text-[12px] text-mute">Una máquina que no tienes, flete, operador, maniobras… a mano</span>
            </span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
