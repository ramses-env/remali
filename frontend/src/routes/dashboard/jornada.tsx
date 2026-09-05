/**
 * Mi jornada: la pantalla del tecnico —donde esta cada maquina, que entrega
 * hoy y que espera en el taller—. Administracion casi no entra aqui, y el
 * tecnico casi no entra a las demas: separarlas beneficia a los dos.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import Modal from '../../components/Modal'
import { createPortal } from 'react-dom'
import api from '../../lib/api'
import { confirmar, } from '../../components/Dialogo'
import { } from 'framer-motion'
import { useRecurso } from '../../lib/realtime'
import { usePuede } from '../../lib/acceso'
import { formatMoney } from '../../lib/utils'
import { type Notify } from '../../store/toast'
import {
  AbonoModal, type Empresa, type Unidad, errorMsg,
} from './comun'
import { NuevaOrdenModal } from './nueva-orden'
import { anotarFallo } from '../../lib/fallo'

/* ════════════════════════════════════════
   EL DÍA DEL TÉCNICO: dónde está el equipo y qué hay en taller
════════════════════════════════════════ */
type Urgencia = 'vencida' | 'hoy' | 'reparar' | 'manana' | 'proxima'
type TipoTarea = 'entregar' | 'recoger' | 'reparar' | 'entrega_prometida'

type Tarea = {
  tipo: TipoTarea; urgencia: Urgencia; etiqueta: string
  adeudo?: string | null
  /** Lo que falta para poder RECOGER (piso de liquidación). NO es el adeudo:
   *  el adeudo es todo lo que debe, esto es lo único que frena la recolección. */
  falta_liquidar?: string | null
  equipo: string; codigo: string; numero_serie?: string
  // Campos de renta (entregar / recoger)
  renta_id?: number; lugar?: string; obra?: string | null
  /** Si el chofer ya salió con el equipo. Mientras sea falso, el cliente
   *  todavía puede cancelar por su cuenta: por eso el botón "Voy en camino"
   *  existe y va ANTES del de entregar. */
  en_camino?: boolean
  contacto?: string; telefono?: string; empresa?: string | null
  fecha_fin?: string; evidencias?: { entrega: number; devolucion: number }
  // Campos de reparación
  orden_id?: number; folio?: string; orden_tipo?: string; estado?: string
  de_quien?: string; falla?: string; dias_en_taller?: number
}
type ResumenTareas = { total: number; entregar: number; recoger: number; reparar: number; vencidas: number; proximas: number }

// Cada tipo de tarea tiene su color e ícono: se distingue de un vistazo sin leer.
const TAREA_META: Record<TipoTarea, { label: string; anillo: string; icono: React.ReactNode }> = {
  entregar: { label: 'Entregar', anillo: 'bg-gold-soft text-gold-ink',
    icono: <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></> },
  recoger: { label: 'Recoger', anillo: 'bg-[var(--c-renta)]/12 text-[var(--c-renta)]',
    icono: <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></> },
  reparar: { label: 'Reparar', anillo: 'bg-surface-2 text-mute',
    icono: <><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z" /></> },
  // Entrega PROMETIDA: cotización aceptada con fecha de HOY, aún sin convertir a
  // renta/venta. Es un compromiso informativo (sin renta_id), no una acción.
  entrega_prometida: { label: 'Prometida', anillo: 'bg-gold-soft text-gold-ink',
    icono: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></> },
}
// La urgencia tiñe solo la etiqueta de tiempo, no todo el card: el ruido cansa.
const URGENCIA_TXT: Record<Urgencia, string> = {
  vencida: 'text-red-600 dark:text-red-500', hoy: 'text-taller-ink dark:text-taller-ink',
  reparar: 'text-mute', manana: 'text-ink', proxima: 'text-mute',
}

export default function UbicacionesAdmin({ notify, empresas, unidades, onOrdenCreada }: {
  notify: Notify
  /* Para recibir una máquina en taller sin salir de aquí. El técnico no tiene la
     sección Reparaciones —sería duplicarle el día— pero sí recibe máquinas. */
  empresas: Empresa[]; unidades: Unidad[]
  onOrdenCreada: () => void
}) {
  // Administración VE el tablero pero no lo toca: sin `jornada_campo` no hay
  // botones de entregar/recoger, no se abre la sábana de fotos ni el modal de
  // taller. Que el admin pudiera entregar desde aquí, sin estar en la obra ni
  // tener las fotos, era pedir un desastre. Corregir sigue siendo posible, pero
  // desde Rentas, donde el acto es deliberado.
  const puede = usePuede()
  const soloLectura = !puede('jornada_campo')
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [resumen, setResumen] = useState<ResumenTareas>({ total: 0, entregar: 0, recoger: 0, reparar: 0, vencidas: 0, proximas: 0 })
  const [cargando, setCargando] = useState(true)
  const [hoja, setHoja] = useState<Tarea | null>(null)      // sábana de entrega/recolección con fotos
  const [trabajando, setTrabajando] = useState<number | null>(null)
  const [recibiendo, setRecibiendo] = useState(false)   // alta de orden de taller

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

  /* "Voy en camino": el sello que cierra la cancelación del cliente.
     Se marca al cargar la camioneta, no al llegar. Optimista no: se espera la
     respuesta y se recarga, porque de esta marca depende que el cliente pueda o
     no cancelar, y enseñar un "en camino" que no llegó al servidor dejaría al
     técnico creyendo que ya nadie le puede cancelar el viaje. */
  const marcarEnCamino = async (t: Tarea) => {
    if (!t.renta_id) return
    try {
      const r = await api.post(`/rentas/${t.renta_id}/en-camino/`, { en_camino: true })
      notify(r.data?.detalle || 'Marcada en camino')
      cargar()
    } catch (err) {
      notify(errorMsg(err, 'No se pudo marcar la salida'), 'err')
    }
  }

  // Las "próximas" (entregas a futuro) se separan: son planeación, no lo de hoy.
  const pendientes = tareas.filter(t => t.urgencia !== 'proxima')
  const proximas = tareas.filter(t => t.urgencia === 'proxima')

  return (
    <div className="max-w-2xl mx-auto space-y-2.5">
      {/* Recibir una máquina en taller. Va aquí y no en una sección aparte: el
          técnico ya trabaja sus órdenes desde este tablero, y darle además la
          sección Reparaciones sería mostrarle su mismo día en otra pantalla.
          Es el MISMO modal de alta que usa administración, montado donde él
          está parado. `soloLectura` lo esconde para quien solo supervisa. */}
      {!soloLectura && puede('reparar') && (
        <div className="flex justify-end">
          <button onClick={() => setRecibiendo(true)}
            className="h-10 px-4 rounded-xl border border-edge bg-surface text-[13px] font-bold text-ink hover:border-gold/40 transition-colors inline-flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Recibir máquina
          </button>
        </div>
      )}

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

      {soloLectura && (
        <p className="px-4 py-3 rounded-xl bg-surface-2 border border-edge text-[13px] text-mute">
          Vista de supervisión: aquí solo se mira. Para entregar, recoger o subir fotos, entra a <b className="text-ink">Rentas</b>.
        </p>
      )}

      {/* La lista de tareas: una acción por card. */}
      {pendientes.map((t, i) => (
        <TareaCard key={`${t.tipo}-${t.renta_id ?? t.orden_id}-${i}`} t={t} soloLectura={soloLectura}
          onEntregar={() => setHoja(t)} onReparar={() => t.orden_id && setTrabajando(t.orden_id)}
          onEnCamino={() => marcarEnCamino(t)} />
      ))}

      {/* Próximas: se agenda, no urge. Colapsadas visualmente. */}
      {/* space-y-2.5 en el contenedor: las próximas se apilaban pegadas, sin el
          gap que sí tienen las pendientes por vivir en el contenedor de arriba. */}
      {proximas.length > 0 && (
        <div className="pt-2 space-y-2.5">
          <p className="text-[12px] font-bold text-mute uppercase tracking-wide px-1 mb-2">Próximas ({proximas.length})</p>
          {proximas.map((t, i) => (
            <TareaCard key={`prox-${t.renta_id}-${i}`} t={t} atenuada soloLectura={soloLectura}
              onEntregar={() => setHoja(t)} onReparar={() => {}} onEnCamino={() => marcarEnCamino(t)} />
          ))}
        </div>
      )}

      {/* Los `!soloLectura` son cinturón: hoy sin botones nadie los abre, pero un
          camino nuevo que llame a setHoja no debe destapar la sábana de fotos. */}
      {hoja && !soloLectura && (
        <EntregaHoja tarea={hoja} onClose={() => setHoja(null)} onHecho={() => { setHoja(null); cargar() }} notify={notify} />
      )}
      {trabajando !== null && !soloLectura && (
        <TallerTrabajoModal ordenId={trabajando} onClose={() => setTrabajando(null)} onCambio={cargar} notify={notify} />
      )}

      {recibiendo && (
        <NuevaOrdenModal
          empresas={empresas} unidades={unidades} notify={notify}
          onClose={() => setRecibiendo(false)}
          onCreated={() => {
            setRecibiendo(false)
            // La orden nueva entra a su jornada como una tarea más: no hay que
            // mandarlo a otra pantalla a buscarla.
            cargar()
            onOrdenCreada()
          }}
        />
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

function TareaCard({ t, atenuada, soloLectura, onEntregar, onReparar, onEnCamino }: {
  t: Tarea; atenuada?: boolean; soloLectura?: boolean
  onEntregar: () => void; onReparar: () => void; onEnCamino: () => void
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
          <a href={`tel:${tel}`} aria-label="Llamar" className="shrink-0 w-9 h-9 rounded-lg grid place-items-center border border-edge bg-surface text-ink hover:border-gold/40 hover:text-gold-ink active:scale-95 transition-[transform,border-color,color] duration-150 motion-reduce:active:scale-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>
          </a>
        )}
        {esCampo && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.lugar || '')}`} target="_blank" rel="noopener noreferrer" aria-label="Cómo llegar"
            className="shrink-0 w-9 h-9 rounded-lg grid place-items-center border border-edge bg-surface text-ink hover:border-gold/40 hover:text-gold-ink active:scale-95 transition-[transform,border-color,color] duration-150 motion-reduce:active:scale-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          </a>
        )}
        {esCampo && t.tipo !== 'entrega_prometida' && (
          <span className="text-[11.5px] text-mute pl-1">
            {fotos > 0 ? `${fotos} foto${fotos > 1 ? 's' : ''}` : 'Sin fotos'}
          </span>
        )}
        <div className="flex-1" />
        {soloLectura ? (
          // Supervisión: en vez del botón, qué se espera de esta tarea. Sin botón
          // fantasma que se vea deshabilitado y invite a picarlo.
          <span className="text-[12px] text-mute pl-1 font-medium">
            {t.tipo === 'reparar' ? 'En taller'
              : t.tipo === 'entrega_prometida' ? 'Compromiso de hoy'
              : t.tipo === 'recoger' ? 'Por recoger' : 'Por entregar'}
          </span>
        ) : t.tipo === 'reparar' ? (
          <button onClick={onReparar} className="btn-acento h-9 px-4 rounded-full text-[13px] font-bold">Trabajar</button>
        ) : t.tipo === 'entrega_prometida' ? (
          // Compromiso informativo: todavía no es renta/venta, no hay nada que "entregar" en el sistema.
          <span className="text-[12px] text-mute pl-1 font-medium">Compromiso de hoy</span>
        ) : (
          <div className="flex items-center gap-2">
            {/* "Voy en camino" es lo primero que se toca, al cargar la
                camioneta: hasta ese momento el cliente puede cancelar solo y
                nadie sale en balde. Ya marcado, se queda como sello —no como
                botón— para que nadie lo vuelva a picar por costumbre. */}
            {t.tipo === 'entregar' && (
              t.en_camino ? (
                <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-renta/40 bg-renta/10 text-renta text-[12.5px] font-bold">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17V7h11v10M14 10h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></svg>
                  En camino
                </span>
              ) : (
                <button onClick={onEnCamino} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-edge text-ink text-[12.5px] font-bold hover:border-renta/50 hover:text-renta transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17V7h11v10M14 10h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></svg>
                  Voy en camino
                </button>
              )
            )}
            <button onClick={onEntregar} className={`${t.tipo === 'recoger' ? 'btn-renta' : 'btn-acento'} h-9 px-4 rounded-full text-[13px] font-bold`}>
              {t.tipo === 'recoger' ? 'Recoger' : 'Entregar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Sábana de entrega / recolección: captura fotos ANTES de confirmar ── */
function EntregaHoja({ tarea, onClose, onHecho, notify }: {
  tarea: Tarea; onClose: () => void; onHecho: () => void; notify: Notify
}) {
  const esRecoger = tarea.tipo === 'recoger'
  const momento = esRecoger ? 'devolucion' : 'entrega'
  const [fotos, setFotos] = useState<File[]>([])
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /* ── Cobrar al recoger ──
     Al técnico se le pedía cobrar y no se le daba dónde anotarlo: su tarjeta
     decía "Adeudo: cobrar $2,000" y esta hoja no tenía campo de pago. El
     AbonoModal vivía en Rentas y en Adeudos, dos secciones que su rol no ve.
     Aquí queda a la mano, en el momento en que el dinero cambia de manos.
     `saldo` es lo que queda por cobrar; baja con cada abono sin recargar. */
  const [saldo, setSaldo] = useState(Number(tarea.adeudo || 0))
  /* Lo que FRENA la recolección, que ya no es el saldo entero: la máquina se
     recoge con el piso de liquidación cubierto (75% del total de fábrica) y el
     resto se va a cobranza. Pedirle al técnico el adeudo completo cuando con
     menos ya se la lleva le hace pedir de más y perder el cobro. */
  const [falta, setFalta] = useState(Number(tarea.falta_liquidar || 0))
  const [cobrando, setCobrando] = useState(false)
  const puedeCobrar = usePuede()('ver_montos_operacion')
  const hayQueCobrar = esRecoger && saldo > 0 && !!tarea.renta_id && puedeCobrar
  /* El botón de confirmar NUNCA se frena por dinero. Lo hacía, y estaba mal:
     el técnico se quedaba varado en la obra con la máquina sin poder subirla,
     esperando una autorización que solo puede dar un administrador desde la
     oficina —y el código de autorización es PERSONAL, así que dictárselo por
     teléfono lo vaciaría de sentido—. Peor: el recargo por retraso seguía
     corriendo, subiendo el piso al día siguiente.
     Ahora se recoge siempre; `falta` solo sirve para SUGERIR el cobro. */
  const faltaCobrar = esRecoger && falta > 0

  async function registrarAbono(monto: number, metodo: string, fecha: string) {
    /* Las dos cifras se releen de la RESPUESTA, no se restan aquí. Restar en el
       navegador es lo que hacía que la pantalla dijera un saldo y el servidor
       otro en cuanto algo más lo movía (la garantía aplicándose, otra persona
       cobrando). La cuenta buena es la del backend. */
    const r = await api.post<{ renta?: { saldo?: string; falta_liquidar?: string } }>(
      `/rentas/${tarea.renta_id}/abonos/`, { monto, metodo, fecha: fecha || undefined })
    const saldoNuevo = Number(r.data?.renta?.saldo ?? Math.max(0, saldo - monto))
    const faltaNueva = Number(r.data?.renta?.falta_liquidar ?? Math.max(0, falta - monto))
    setSaldo(saldoNuevo)
    setFalta(faltaNueva)
    setCobrando(false)
    notify(faltaNueva <= 0
      ? (saldoNuevo > 0 ? 'Ya puedes recoger; el resto queda en cobranza' : 'Adeudo liquidado')
      : 'Abono registrado')
  }

  const previews = useMemo(() => fotos.map(f => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews])

  function agregar(ev: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (nuevos.length) setFotos(f => [...f, ...nuevos].slice(0, 12))
  }

  // Sube las fotos (si hay) y luego marca la entrega/recolección. Si la subida
  // falla, NO se marca: la evidencia es parte del acto, no un extra.
  async function enviarEntrega(conFotos: boolean) {
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
    <Modal className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.45)] backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClose={onClose} label="Hoja de entrega">
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
            <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-1">FOTOS DEL EQUIPO</p>
            <p className="text-[12.5px] text-mute mb-3">
              {esRecoger ? 'Cómo regresó la máquina. Respalda el estado por si hay reclamo.' : 'El estado en que sale. Es tu respaldo si el cliente reporta un daño.'}
            </p>
            <input aria-label="Fotos de la entrega" ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={agregar} />
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => inputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-edge grid place-items-center text-mute hover:text-gold-ink hover:border-gold/50 transition-colors">
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

          {hayQueCobrar && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3.5">
              <p className="text-[11px] font-extrabold tracking-[0.5px] text-taller-ink mb-1">POR COBRAR</p>
              <p className="text-[13px] text-ink">
                El cliente debe <b>${saldo.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b> de esta renta.
              </p>
              <p className="text-[12px] text-mute mt-0.5">Se liquida al recoger: cóbralo aquí y la recolección se destraba.</p>
              <button onClick={() => setCobrando(true)}
                className="mt-3 h-10 px-5 rounded-full btn-acento text-[13px] font-black">
                Registrar cobro
              </button>
            </div>
          )}
          {esRecoger && falta === 0 && Number(tarea.falta_liquidar || 0) > 0 && (
            <p className="text-[13px] font-semibold text-libre">
              {saldo > 0
                ? `✓ Ya puedes recoger. Quedan ${formatMoney(saldo)} en cobranza.`
                : '✓ Adeudo liquidado. Puedes recoger.'}
            </p>
          )}

          <div>
            <label className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-2 block">NOTA (OPCIONAL)</label>
            <input aria-label="NOTA (OPCIONAL)" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. Rayón en la tapa, tanque lleno…"
              className="campo" />
          </div>
        </div>

        <div className="px-6 py-5 border-t border-edge">
          {/* El camino esperado es CON fotos: el botón principal se activa al
              tener al menos una. Sin fotos es una decisión explícita, abajo. */}
          <button onClick={() => enviarEntrega(true)} disabled={ocupado || fotos.length === 0}
            className={`${esRecoger ? 'btn-renta' : 'btn-acento'} w-full h-12 rounded-full text-[14px] font-black disabled:opacity-40`}>
            {ocupado ? 'Guardando…'
              : fotos.length ? `Confirmar con ${fotos.length} foto${fotos.length > 1 ? 's' : ''}`
              : (esRecoger ? 'Confirmar recolección' : 'Confirmar entrega')}
          </button>
          {faltaCobrar ? (
            <p className="text-center text-[12px] text-mute mt-2.5">
              {puedeCobrar
                ? `Ideal: cobrar $${falta.toLocaleString('en-US', { minimumFractionDigits: 2 })} antes de cerrar. Puedes recoger de todos modos; el saldo va a cobranza y administración recibe el aviso.`
                : 'Esta renta trae saldo. Puedes recogerla; queda en cobranza.'}
            </p>
          ) : fotos.length === 0 ? (
            <button onClick={async () => { if (await confirmar({ titulo: '¿Entregar sin fotos?', mensaje: 'Sin evidencia no hay respaldo si el cliente reclama un daño.', aceptar: 'Sin fotos', cancelar: 'Tomar fotos', tono: 'peligro' })) enviarEntrega(false) }}
              className="w-full mt-2.5 h-9 text-[13px] font-semibold text-mute hover:text-ink transition-colors">
              {esRecoger ? 'Recoger sin fotos' : 'Entregar sin fotos'}
            </button>
          ) : (
            <p className="text-center text-[12px] text-mute mt-2.5">Toca una foto para quitarla, o agrega más arriba.</p>
          )}
        </div>
      </div>

      {cobrando && (
        <AbonoModal
          saldo={saldo}
          onClose={() => setCobrando(false)}
          onRegistrar={registrarAbono}
        />
      )}
    </Modal>,
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
  recibida: { label: 'Sin empezar', cls: 'bg-amber-500/10 text-taller-ink' },
  proceso: { label: 'En proceso', cls: 'bg-[var(--c-renta)]/12 text-[var(--c-renta)]' },
  terminada: { label: 'Terminada', cls: 'bg-emerald-500/10 text-emerald-600' },
  entregada: { label: 'Entregada', cls: 'bg-surface-2 text-mute' },
}

function TallerTrabajoModal({ ordenId, onClose, onCambio, notify }: {
  ordenId: number; onClose: () => void; onCambio: () => void; notify: Notify
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
      .then(r => setRefs(Array.isArray(r.data) ? r.data : [])).catch(anotarFallo)
  }, [busqueda])
  useEffect(() => { cargarRefs() }, [cargarRefs])

  const estado = orden?.estado
  const enProceso = estado === 'proceso'
  const recibida = estado === 'recibida'

  function guardarTrabajo() {
    // Persiste la nota de avance sin cambiar de estado. Silencioso: es autosave.
    if (!orden || (orden.trabajo_realizado || '') === trabajo) return Promise.resolve()
    return api.patch(`/reparaciones/${ordenId}/`, { trabajo_realizado: trabajo })
      .then(() => onCambio()).catch(anotarFallo)
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
  async function terminar() {
    if (trabajo.trim().length < 4) { notify('Escribe qué le hiciste antes de terminar.', 'err'); return }
    if (!await confirmar({ titulo: '¿La máquina ya quedó lista para entregar?', mensaje: 'Al terminar sale de tus pendientes.', aceptar: 'Sí, está lista' })) return
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
    <Modal className="fixed inset-0 z-[60] bg-[rgba(33,29,22,0.4)] backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClose={cerrar} label="Detalle de la reparación">
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
              <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-1.5">FALLA REPORTADA</p>
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
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-2">REFACCIONES USADAS</p>
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
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-2">TOMAR DEL INVENTARIO</p>
                <div className="relative mb-2">
                  <svg className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input aria-label="Buscar refacción" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar refacción…"
                    className="campo pl-11" />
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {refs.length === 0 && <p className="text-[13px] text-mute px-1 py-2">Sin resultados.</p>}
                  {refs.map(ref => (
                    <button key={ref.id} onClick={() => agarrar(ref)} disabled={ocupado || ref.stock < 1}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-edge hover:border-gold/40 disabled:opacity-40 transition-colors text-left">
                      <span className="text-sm text-ink flex-1 truncate">{ref.nombre}</span>
                      <span className={`text-[12px] ${ref.stock < 1 ? 'text-red-500' : 'text-mute'}`}>{ref.stock} en stock</span>
                      <span className="text-gold-ink font-black text-lg leading-none">+</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Qué se hizo: obligatorio para terminar */}
              <div>
                <p className="text-[11px] font-extrabold tracking-[0.5px] text-gold-ink mb-2">¿QUÉ LE HICISTE?</p>
                <textarea aria-label="Qué le hiciste al equipo" value={trabajo} onChange={e => setTrabajo(e.target.value)} onBlur={guardarTrabajo} rows={3}
                  placeholder="Ej. Cambié el filtro y limpié el carburador. Probada y funcionando."
                  className="campo campo-area" />
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
    </Modal>,
    document.body
  )
}
