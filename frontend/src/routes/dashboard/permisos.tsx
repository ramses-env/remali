/**
 * Puestos y permisos: la lista de puestos y la hoja de cada uno.
 *
 * Lo que se enciende aquí lo obedece el backend (`ExigeCapacidad`); esta
 * pantalla no es la defensa, es la que DECIDE. Ver
 * docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
 *
 * Se guarda por PUESTO y no por persona: enciendes algo para "Cajero" y aplica
 * a todos los cajeros. Y solo se guarda lo que DIFIERE de fábrica, así que "¿qué
 * toqué yo?" es el punto dorado y no un diff mental.
 *
 * El dueño inventa los puestos que quiera y les pone el nombre que quiera. Los
 * cuatro base tampoco están amarrados a su nombre —se pueden renombrar—, porque
 * los permisos se guardan contra la CLAVE del puesto (`Rol.clave`), no contra lo
 * que se lee en pantalla.
 *
 * Una sola vista: la lista de puestos, y cada uno se abre para repartirle sus
 * capacidades. Hubo una segunda —una matriz con todos los puestos en el mismo
 * renglón para contestar "¿quién puede facturar?"— y se retiró: con cinco
 * puestos, la lista contesta lo mismo y no hay dos lugares donde cambiar el
 * mismo dato.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

import api from '../../lib/api'
import Modal from '../../components/Modal'
import { confirmar, pedir } from '../../components/Dialogo'
import { KpiGrid } from '../../components/ui/kpi-grid'
import { type Notify } from '../../store/toast'
import { errorMsg, hace, MenuFila } from './comun'

export type Capacidad = {
  nombre: string; etiqueta: string; descripcion: string
  area: string; nucleo: boolean; nivel_minimo: number | null
}
/** Un puesto. `clave` es su identidad interna —con la que se guardan los
 *  permisos— y `nombre` lo que se lee: renombrarlo no mueve una sola casilla. */
export type Rol = {
  clave: string; nombre: string; nivel: number; protegido: boolean
  usuarios: number; creado_en: string | null; actualizado_en: string | null
}
export type Foto = {
  roles: Rol[]
  catalogo: Capacidad[]
  /** Indexados por CLAVE, no por nombre. */
  fabrica: Record<string, Record<string, boolean>>
  efectivo: Record<string, Record<string, boolean>>
  overrides: { rol: string; capacidad: string; permitido: boolean; por: string; cuando: string }[]
  /** Cuánta gente se quedó sin panel al borrar un puesto. */
  sin_acceso?: number
}

export type Movimiento = {
  rol: string; capacidad: string; etiqueta: string; detalle: string
  anterior: boolean | null; nuevo: boolean | null
  quien: string; rol_quien: string; cuando: string
}

/** Un cambio listo para mandar al servidor. */
type Cambio = { rol: string; capacidad: string; permitido: boolean }


/* ─────────── Los puestos, con cara ─────────── */

/** Un icono por puesto. No es adorno: en una lista de cuatro renglones que se
 *  parecen, la silueta es lo que se reconoce antes de leer. */
const ICONO_ROL: Record<string, React.ReactNode> = {
  gestor: <><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  administrador: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  cajero: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  tecnico: <path d="M14.7 6.3a4 4 0 0 1-5 5L4 17v3h3l5.7-5.7a4 4 0 0 1 5-5l-2.5-2.5 2.2-2.2a4 4 0 0 0-2.7 1.7Z" />,
}
const DESCRIPCION_ROL: Record<string, string> = {
  gestor: 'Administración delegada: opera el negocio sin ver sus cuentas.',
  administrador: 'Todo el negocio: ventas, rentas, cotizaciones y facturación.',
  cajero: 'Mostrador: cobra, vende y cierra su turno.',
  tecnico: 'Campo y taller: entrega, recoge y repara.',
}

/** Lo que se lee bajo el nombre del puesto. Los que crea el dueño no traen
 *  descripción escrita en el código —los inventó él—, así que dicen lo único
 *  cierto sobre ellos: cuánta gente los tiene. */
const descripcionDe = (r: Rol) =>
  DESCRIPCION_ROL[r.clave]
  || (r.usuarios === 0 ? 'Puesto tuyo. Todavía no lo tiene nadie.'
    : `Puesto tuyo · ${r.usuarios} ${r.usuarios === 1 ? 'persona' : 'personas'}`)

function IconoRol({ clave }: { clave: string }) {
  return (
    <span className="shrink-0 w-10 h-10 rounded-xl bg-surface-2 border border-edge grid place-items-center text-mute">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONO_ROL[clave] ?? <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>}
      </svg>
    </span>
  )
}

/* ─────────── La casilla ─────────── */

/** El dibujo de la casilla, sin el control que la envuelve. */
function CajaCasilla({ estado, candado }: { estado: 'on' | 'off' | 'mixto'; candado?: boolean }) {
  if (candado) return (
    /* El candado se VE, no se esconde: verlo bloqueado enseña la regla;
       esconderlo la vuelve un misterio. Y muestra su estado real, encendido o
       apagado, porque "intocable" no es lo mismo que "apagado". */
    <span className={`shrink-0 w-5 h-5 rounded-md border border-dashed grid place-items-center
      ${estado === 'on' ? 'border-gold/60 bg-gold-soft text-gold-ink' : 'border-edge text-mute'}`}>
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </span>
  )
  return (
    <span className={`shrink-0 w-5 h-5 rounded-md border grid place-items-center transition-colors
      ${estado === 'off' ? 'border-mute/50 group-hover:border-gold/50' : 'bg-gold border-gold text-gold-on'}`}>
      {estado === 'on' && (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      )}
      {estado === 'mixto' && <span className="w-2.5 h-[2.5px] rounded-full bg-gold-on" />}
    </span>
  )
}

/** Casilla de tres estados. El `mixto` es el que hace legible un grupo: dice
 *  "aquí adentro hay de las dos" sin tener que abrirlo para enterarse.
 *
 *  Es un `<button role="checkbox">` y no un `<div onClick>` porque en esta hoja
 *  hay más de treinta, y sin foco ni teclado la pantalla solo sirve con ratón.
 *
 *  `bloqueada` es el núcleo: una regla del sistema, y por eso lleva candado en
 *  vez de esconderse.
 *
 *  `className` es para el área de toque: en la matriz el dibujo mide 20 px pero
 *  la celda entera de 44 px tiene que ser clicable, o se falla el tiro.
 */
function Casilla({ estado, bloqueada, etiqueta, onToggle, className = '' }: {
  estado: 'on' | 'off' | 'mixto'; bloqueada?: boolean
  etiqueta: string; onToggle?: () => void; className?: string
}) {
  if (bloqueada) return (
    <span className={`grid place-items-center ${className}`}
      role="checkbox" aria-checked={estado === 'mixto' ? 'mixed' : estado === 'on'} aria-disabled="true"
      aria-label={etiqueta}
      title={`${etiqueta} — esta capacidad no se reparte desde aquí`}>
      <CajaCasilla estado={estado} candado={bloqueada} />
    </span>
  )
  return (
    <button type="button" role="checkbox" aria-checked={estado === 'mixto' ? 'mixed' : estado === 'on'}
      aria-label={etiqueta} onClick={onToggle}
      className={`group grid place-items-center rounded-lg transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`}>
      <CajaCasilla estado={estado} />
    </button>
  )
}

/* ─────────── La hoja de un puesto ─────────── */

/**
 * Todo lo que puede un puesto, por áreas que se abren y se cierran.
 *
 * Nace con las áreas CERRADAS: son veintitantas capacidades y abrirlas todas de
 * golpe convierte la hoja en un scroll donde no se encuentra nada. El renglón
 * del área ya dice lo que hace falta para decidir si vale la pena abrirla:
 * cuántas están encendidas y si el grupo está entero, vacío o a medias.
 */
function HojaRol({ rol, foto, onCerrar, onGuardar }: {
  rol: Rol; foto: Foto
  onCerrar: () => void; onGuardar: (cambios: Cambio[]) => Promise<boolean>
}) {
  const clave = rol.clave
  const [pendientes, setPendientes] = useState<Record<string, boolean>>({})
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})
  const [busca, setBusca] = useState('')
  const [guardando, setGuardando] = useState(false)

  const valor = (cap: string) => {
    const p = pendientes[cap]
    return p !== undefined ? p : Boolean(foto.efectivo[clave]?.[cap])
  }
  const movida = (cap: string) => valor(cap) !== Boolean(foto.fabrica[clave]?.[cap])

  /** Poner una capacidad en un valor concreto. Si vuelve a lo guardado deja de
   *  ser un pendiente: el botón no debe prometer "1 cambio" cuando el dueño ya
   *  se arrepintió a mano. */
  const poner = (cap: string, destino: boolean) => setPendientes(prev => {
    const sig = { ...prev }
    if (destino === Boolean(foto.efectivo[clave]?.[cap])) delete sig[cap]
    else sig[cap] = destino
    return sig
  })

  const q = busca.trim().toLowerCase()
  const coincide = (c: Capacidad) =>
    !q || `${c.etiqueta} ${c.descripcion} ${c.area}`.toLowerCase().includes(q)
  const repartibles = foto.catalogo.filter(c => !c.nucleo)
  const areas = [...new Set(foto.catalogo.map(c => c.area))]
    .map(area => ({ area, caps: foto.catalogo.filter(c => c.area === area && coincide(c)) }))
    .filter(a => a.caps.length > 0)

  /** El estado de un montón de capacidades: entero, vacío o a medias. Las del
   *  núcleo no cuentan aquí porque no se pueden mover: si contaran, un grupo con
   *  una sola capacidad bloqueada se vería "a medias" para siempre. */
  const estadoDe = (caps: Capacidad[]): 'on' | 'off' | 'mixto' => {
    const libres = caps.filter(c => !c.nucleo)
    // Un área entera bajo candado no se puede mover: se reporta como está.
    if (!libres.length) return caps.every(c => valor(c.nombre)) ? 'on' : 'off'
    const encendidas = libres.filter(c => valor(c.nombre)).length
    return encendidas === 0 ? 'off' : encendidas === libres.length ? 'on' : 'mixto'
  }
  const alternarGrupo = (caps: Capacidad[]) => {
    const destino = estadoDe(caps) !== 'on'
    caps.filter(c => !c.nucleo).forEach(c => poner(c.nombre, destino))
  }

  const cambios: Cambio[] = Object.entries(pendientes)
    .map(([capacidad, permitido]) => ({ rol: clave, capacidad, permitido }))
  const encendidas = foto.catalogo.filter(c => valor(c.nombre)).length

  const guardar = async () => {
    setGuardando(true)
    const ok = await onGuardar(cambios)
    setGuardando(false)
    if (ok) onCerrar()
  }

  return createPortal(
    /* Modal CENTRADO, y no la sábana lateral del resto del panel: repartir un
       puesto es la tarea, no un detalle de la tabla de atrás. Puesto al centro,
       lo de atrás deja de competir por la atención. */
    <Modal className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6"
      onClose={onCerrar}
      cerrarAlTocarFuera={cambios.length === 0} label={`Permisos de ${rol.nombre}`}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-[720px] max-h-[92vh] sm:max-h-[86vh] bg-surface border border-edge rounded-2xl shadow-[0_24px_60px_rgba(33,29,22,0.28)] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 sm:px-6 py-5 border-b border-edge">
          <IconoRol clave={clave} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-black text-ink leading-tight">Permisos — {rol.nombre}</h3>
            <p className="text-[12px] text-mute mt-0.5">
              {descripcionDe(rol)}
              <span className="tabular-nums"> · {encendidas} de {foto.catalogo.length} encendidas</span>
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
            className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 sm:px-6 py-3 border-b border-edge">
          <div className="relative">
            <svg viewBox="0 0 24 24" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mute" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar una capacidad…" aria-label="Buscar una capacidad"
              className="campo campo-sm pl-10" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-2">
          {/* Todo de un golpe. Va arriba y no al final porque es el atajo del
              caso extremo: dar de alta un puesto nuevo o vaciarlo entero. */}
          {!q && (
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 border border-edge px-4 py-3.5">
              <span className="flex-1 text-[13.5px] font-bold text-ink">Todas las capacidades</span>
              <span className="text-[11px] text-mute tabular-nums">
                {repartibles.filter(c => valor(c.nombre)).length}/{repartibles.length}
              </span>
              <Casilla estado={estadoDe(foto.catalogo)} etiqueta="Todas las capacidades"
                onToggle={() => alternarGrupo(foto.catalogo)} />
            </div>
          )}

          {areas.map(({ area, caps }) => {
            const abierta = abiertas[area] ?? Boolean(q)
            const libres = caps.filter(c => !c.nucleo)
            return (
              <div key={area} className="rounded-xl border border-edge overflow-hidden">
                <div className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${abierta ? 'bg-surface-2' : ''}`}>
                  <button onClick={() => setAbiertas(a => ({ ...a, [area]: !abierta }))}
                    aria-expanded={abierta} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="shrink-0 w-6 h-6 rounded-full border border-edge grid place-items-center text-mute">
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${abierta ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </span>
                    <span className="text-[13.5px] font-bold text-ink truncate">{area}</span>
                    <span className="text-[11px] text-mute tabular-nums shrink-0">
                      {caps.filter(c => valor(c.nombre)).length}/{caps.length}
                    </span>
                  </button>
                  <Casilla estado={estadoDe(caps)} bloqueada={libres.length === 0}
                    etiqueta={`Todo en ${area}`} onToggle={() => alternarGrupo(caps)} />
                </div>

                {abierta && (
                  <ul className="border-t border-edge divide-y divide-edge sm:divide-y-0 sm:grid sm:grid-cols-2">
                    {caps.map(c => (
                      <li key={c.nombre} className="flex items-start gap-3 px-4 py-3">
                        <span className="pt-0.5">
                          <Casilla estado={valor(c.nombre) ? 'on' : 'off'} bloqueada={c.nucleo}
                            etiqueta={c.etiqueta} onToggle={() => poner(c.nombre, !valor(c.nombre))} />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-ink leading-tight">{c.etiqueta}</span>
                            {movida(c.nombre) && (
                              <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-gold"
                                title="Difiere de lo que trae el puesto de fábrica" />
                            )}
                          </span>
                          <span className="block text-[11px] text-mute leading-snug mt-0.5">{c.descripcion}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}

          {areas.length === 0 && (
            <p className="text-[12.5px] text-mute py-6 text-center">Ninguna capacidad se llama así.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-edge bg-surface">
          <p className="text-[11.5px] text-mute min-w-0 truncate">
            {cambios.length === 0
              ? 'Lo del candado no se reparte desde aquí.'
              : <><span className="text-gold-ink font-bold tabular-nums">{cambios.length}</span>
                {cambios.length === 1 ? ' cambio sin guardar' : ' cambios sin guardar'}</>}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCerrar}
              className="h-10 px-4 rounded-full border border-edge text-[13px] font-semibold text-mute hover:text-ink transition-colors">
              Cerrar
            </button>
            <button onClick={guardar} disabled={guardando || cambios.length === 0}
              className="btn-acento h-10 px-5 rounded-full text-[13px] font-bold disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar permisos'}
            </button>
          </div>
        </div>
      </motion.div>
    </Modal>, document.body)
}

/* ─────────── El rastro ─────────── */

/** Quién movió qué, cuándo y de qué a qué.
 *
 * Se lee, no se deshace desde aquí: deshacer es volver a mover la casilla, que
 * a su vez deja su propio renglón. Y se pide solo al abrirlo, porque la
 * pregunta "¿quién le encendió esto al cajero?" llega después del susto, no al
 * entrar a la pantalla.
 */
function Rastro() {
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<Movimiento[] | null>(null)
  const [fallo, setFallo] = useState('')

  useEffect(() => {
    if (!abierto || filas) return
    api.get<{ cambios: Movimiento[] }>('/permisos/bitacora/')
      .then(r => setFilas(r.data.cambios || []))
      .catch(e => setFallo(errorMsg(e, 'No se pudo traer el rastro.')))
  }, [abierto, filas])

  const cuando = (iso: string) => {
    try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
    catch { return iso }
  }
  /** `null` en `anterior`/`nuevo` significa "venía de fábrica" / "se restableció". */
  const estado = (v: boolean | null) => (v === null ? 'de fábrica' : v ? 'encendido' : 'apagado')

  return (
    <div className="rounded-2xl border border-edge bg-surface">
      <button onClick={() => setAbierto(a => !a)} aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 text-left">
        <span className="text-[13px] font-bold text-ink">Rastro de cambios</span>
        <span className="text-[11.5px] text-mute">{abierto ? 'Ocultar' : 'Ver quién movió qué'}</span>
      </button>
      {abierto && (
        <div className="border-t border-edge px-5 sm:px-6 py-4">
          {fallo && <p className="text-[12px] text-mute">{fallo}</p>}
          {!fallo && !filas && <div className="h-10 rounded-lg bg-surface-2 animate-pulse" />}
          {filas?.length === 0 && (
            <p className="text-[12px] text-mute">Nadie ha movido un permiso todavía. Todo está como salió de fábrica.</p>
          )}
          {filas && filas.length > 0 && (
            <ul className="space-y-2">
              {filas.map((f, i) => (
                <li key={i} className="text-[12px] text-mute leading-snug">
                  {/* Sin capacidad, el renglón es del puesto entero: se creó, se
                      renombró o se borró, y ahí no hay "de X a Y" que contar. */}
                  {f.capacidad ? (
                    <>
                      <span className="text-ink font-semibold">{f.etiqueta}</span>
                      {' · '}{f.rol}{' · '}
                      {estado(f.anterior)} → <span className="text-ink">{estado(f.nuevo)}</span>
                    </>
                  ) : (
                    <span className="text-ink font-semibold">{f.detalle || f.etiqueta}</span>
                  )}
                  <span className="block text-[11px] tabular-nums">
                    {f.quien}{f.rol_quien ? ` (${f.rol_quien})` : ''} · {cuando(f.cuando)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/* ─────────── La pantalla ─────────── */

/* ─────────── Ponerle nombre a un puesto ─────────── */

/**
 * Crear un puesto o cambiarle el nombre. Es la misma hoja porque es el mismo
 * dato: lo único que el dueño escribe aquí es un nombre.
 *
 * Renombrar no asusta a nadie a propósito: los permisos se guardan contra la
 * identidad interna del puesto, así que cambiarle el nombre no mueve una sola
 * casilla ni saca a nadie de su lugar. Lo que sí se dice en voz alta es que el
 * nombre nuevo aparece en el selector de usuarios, que es donde se va a ver.
 */
function HojaNombre({ rol, onCerrar, onListo, notify }: {
  rol: Rol | null
  onCerrar: () => void
  onListo: (foto: Foto) => void
  notify: Notify
}) {
  const nuevo = !rol
  const [nombre, setNombre] = useState(rol?.nombre || '')
  const [guardando, setGuardando] = useState(false)

  const limpio = nombre.trim()
  const puedeGuardar = limpio.length >= 3 && limpio !== rol?.nombre

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      const r = nuevo
        ? await api.post<Foto>('/roles/', { nombre: limpio })
        : await api.patch<Foto>(`/roles/${rol!.clave}/`, { nombre: limpio })
      onListo(r.data)
      notify(nuevo ? `Puesto «${limpio}» creado` : `Ahora se llama «${limpio}»`, 'ok')
      onCerrar()
    } catch (err) {
      notify(errorMsg(err, 'No se pudo guardar el puesto.'), 'err')
    } finally {
      setGuardando(false)
    }
  }

  return createPortal(
    <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={onCerrar}
      cerrarAlTocarFuera={!limpio} label={nuevo ? 'Agregar puesto' : `Cambiarle el nombre a ${rol!.nombre}`}>
      <motion.form
        onSubmit={guardar}
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[520px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 sm:px-6 py-5 border-b border-edge">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-black text-ink leading-tight">
              {nuevo ? 'Agregar puesto' : 'Cambiar el nombre'}
            </h3>
            <p className="text-[12px] text-mute mt-0.5">
              {nuevo
                ? 'Nace sin poder nada: entra al panel y de ahí le enciendes lo que le toca.'
                : 'Solo cambia lo que se lee. Sus permisos y su gente se quedan igual.'}
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          <label className="block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide" htmlFor="nombre-puesto">
            Nombre del puesto <span className="text-red-500">*</span>
          </label>
          <input id="nombre-puesto" autoFocus value={nombre} onChange={e => setNombre(e.target.value)}
            maxLength={60} placeholder="Almacenista, Chofer, Supervisor de obra…"
            className="campo" />
          <p className="text-[11.5px] text-mute mt-2 leading-snug">
            Así lo va a ver el equipo, y así aparece al asignarle su puesto a alguien
            en Usuarios. Mínimo tres letras y no se puede repetir.
          </p>

          {nuevo && (
            <div className="mt-5 rounded-xl border border-edge bg-surface-2 px-4 py-3.5">
              <p className="text-[12.5px] font-bold text-ink">Qué va a poder hacer</p>
              <p className="text-[11.5px] text-mute mt-1 leading-snug">
                Nada, todavía. Un puesto nuevo entra al panel y ahí se queda hasta
                que le enciendas capacidades. Se hace así a propósito: heredarle
                las de otro puesto sería cómodo y te llevaría permisos que nunca
                revisaste.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-edge">
          <button type="button" onClick={onCerrar}
            className="h-10 px-4 rounded-full border border-edge text-[13px] font-semibold text-mute hover:text-ink transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={!puedeGuardar || guardando}
            className="btn-acento h-10 px-5 rounded-full text-[13px] font-bold disabled:opacity-50">
            {guardando ? 'Guardando…' : nuevo ? 'Crear puesto' : 'Guardar nombre'}
          </button>
        </div>
      </motion.form>
    </Modal>, document.body)
}

/* ─────────── La pantalla ─────────── */

export default function PermisosAdmin({ notify }: { notify: Notify }) {
  const [foto, setFoto] = useState<Foto | null>(null)
  const [error, setError] = useState('')
  const [busca, setBusca] = useState('')
  /** Qué hoja está abierta: la de permisos de un puesto, o la de su nombre. */
  const [hoja, setHoja] = useState<Rol | null>(null)
  const [nombrando, setNombrando] = useState<{ rol: Rol | null } | null>(null)
  /** Sube al guardar. Es la `key` del rastro: lo remonta para que no se quede
   *  enseñando una lista sin el cambio que se acaba de firmar. */
  const [version, setVersion] = useState(0)

  const cargar = useCallback(() => {
    api.get<Foto>('/permisos/')
      .then(r => { setFoto(r.data); setError('') })
      .catch(e => setError(errorMsg(e, 'No se pudieron cargar los permisos.')))
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const refrescar = useCallback((f: Foto) => { setFoto(f); setVersion(v => v + 1) }, [])

  /**
   * El único camino para escribir permisos, lo pida la hoja o la matriz.
   *
   * Pide el código de 6 dígitos SIEMPRE, y el lote entra completo o no entra:
   * medio lote guardado es peor que ninguno, porque nadie sabría cuál mitad.
   */
  const guardarCambios = useCallback(async (cambios: Cambio[]): Promise<boolean> => {
    if (!cambios.length) return false
    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} de permisos. Teclea tus 6 dígitos para confirmarlo.`,
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return false      // se arrepintió: no se toca nada
    try {
      const r = await api.post<Foto>('/permisos/', { cambios, codigo })
      refrescar(r.data)
      notify('Permisos actualizados', 'ok')
      return true
    } catch (e) {
      notify(errorMsg(e), 'err')           // el tipo SIEMPRE se declara: el default sale verde
      return false
    }
  }, [notify, refrescar])

  if (error) return (
    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3">
      <span className="text-sm text-ink flex-1">{error}</span>
      <button onClick={cargar} className="shrink-0 text-sm font-bold text-gold-ink hover:underline">Reintentar</button>
    </div>
  )
  if (!foto) return (
    <div className="max-w-6xl space-y-2.5" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[92px] rounded-xl bg-surface-2 animate-pulse" />)}
      </div>
      <div className="h-[280px] rounded-2xl bg-surface-2 animate-pulse" />
    </div>
  )

  const rolesEnPantalla = foto.roles.filter(r => {
    const t = busca.trim().toLowerCase()
    return !t || r.nombre.toLowerCase().includes(t) || (r.clave || '').toLowerCase().includes(t)
  })

  /* ── Los números del encabezado ── */
  const repartibles = foto.catalogo.filter(c => !c.nucleo)
  const propios = foto.roles.filter(r => !r.protegido).length
  const ultimo = [...foto.overrides].sort((a, b) => (a.cuando < b.cuando ? 1 : -1))[0]

  /** Lo que ese puesto trae distinto de fábrica: el número que contesta "¿a
   *  quién le anduvieron moviendo?" sin abrir nada. */
  const cambiosDeFabrica = (clave: string) =>
    foto.catalogo.filter(c => !c.nucleo
      && Boolean(foto.efectivo[clave]?.[c.nombre]) !== Boolean(foto.fabrica[clave]?.[c.nombre])).length
  const ultimoDe = (clave: string) =>
    [...foto.overrides].filter(o => o.rol === clave).sort((a, b) => (a.cuando < b.cuando ? 1 : -1))[0]

  /** Devolverle a un puesto exactamente lo que trae de fábrica. Es un lote de
   *  cambios como cualquier otro —pasa por el código y deja bitácora—, no un
   *  borrado silencioso por debajo. */
  const restablecer = (r: Rol) => {
    const cambios = foto.catalogo
      .filter(c => !c.nucleo
        && Boolean(foto.efectivo[r.clave]?.[c.nombre]) !== Boolean(foto.fabrica[r.clave]?.[c.nombre]))
      .map(c => ({ rol: r.clave, capacidad: c.nombre, permitido: Boolean(foto.fabrica[r.clave]?.[c.nombre]) }))
    if (!cambios.length) { notify(`${r.nombre} ya está tal como sale de fábrica`, 'neutro'); return }
    guardarCambios(cambios)
  }

  /**
   * Borrar un puesto. Se avisa con el número de gente enfrente porque es lo que
   * de verdad pasa: no desaparece una fila, se quedan personas sin poder entrar.
   * Dos puertas —confirmar y el código— por lo mismo que las demás cosas que no
   * se deshacen.
   */
  const borrar = async (r: Rol) => {
    const ok = await confirmar({
      titulo: `Borrar el puesto «${r.nombre}»`,
      mensaje: r.usuarios
        ? `${r.usuarios} ${r.usuarios === 1 ? 'persona lo tiene y se queda' : 'personas lo tienen y se quedan'} SIN entrar al panel hasta que les des otro puesto. Sus permisos se borran con él y esto no se deshace.`
        : 'No lo tiene nadie. Sus permisos se borran con él y esto no se deshace.',
      aceptar: 'Sí, borrar el puesto', tono: 'peligro',
    })
    if (!ok) return
    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: `Borrar «${r.nombre}». Teclea tus 6 dígitos para confirmarlo.`,
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return
    try {
      const resp = await api.delete<Foto>(`/roles/${r.clave}/`, { data: { codigo } })
      refrescar(resp.data)
      const sin = resp.data.sin_acceso || 0
      notify(sin
        ? `Puesto borrado · ${sin} ${sin === 1 ? 'cuenta se quedó' : 'cuentas se quedaron'} sin acceso`
        : `Puesto «${r.nombre}» borrado`, sin ? 'warning' : 'ok')
    } catch (e) {
      notify(errorMsg(e, 'No se pudo borrar el puesto.'), 'err')
    }
  }

  const th = 'text-left text-[13px] font-bold text-ink px-5 sm:px-6 py-4 whitespace-nowrap'
  const td = 'px-5 sm:px-6 py-4 align-middle'

  return (
    <div className="max-w-6xl space-y-2.5">
      <div className="bg-surface border border-edge rounded-2xl px-6 sm:px-7 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-ink">Puestos y permisos</h2>
            <p className="text-sm text-mute mt-1 max-w-[62ch]">
              Cada puesto es un trabajo del negocio, y lo que puede hacer se
              reparte capacidad por capacidad. Los cuatro base no se borran; los
              que tú crees, sí.
            </p>
          </div>
          <button onClick={() => setNombrando({ rol: null })}
            className="btn-acento shrink-0 inline-flex items-center gap-2 h-11 pl-4 pr-5 rounded-full text-[14px] font-bold">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Agregar puesto
          </button>
        </div>
      </div>

      <KpiGrid
        items={[
          {
            label: 'Puestos', value: foto.roles.length,
            icon: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></>,
            helper: propios
              ? `${foto.roles.length - propios} base · ${propios} ${propios === 1 ? 'tuyo' : 'tuyos'}`
              : 'Los cuatro base del sistema',
          },
          {
            label: 'Capacidades', value: repartibles.length,
            icon: <><circle cx="8" cy="15" r="3.2" /><path d="m10.4 12.7 7.5-7.5M15.6 7.5l2 2M18 5.1l2 2" /></>,
            helper: 'Todas se reparten, llaves del negocio incluidas',
          },
          {
            label: 'Con gente', value: foto.roles.filter(r => r.usuarios > 0).length,
            tone: 'muted', icon: <><circle cx="12" cy="12" r="9" /><path d="m8.4 12 2.4 2.4 4.8-5" /></>,
            helper: `${foto.roles.reduce((n, r) => n + r.usuarios, 0)} cuentas con puesto`,
          },
          {
            label: 'Cambios', value: String(foto.overrides.length),
            tone: foto.overrides.length ? 'gold' : 'muted', emphasis: foto.overrides.length > 0,
            icon: <><path d="M3 20V9l6 4V9l6 4V4h5v16z" /></>,
            helper: ultimo ? `Último: ${hace(ultimo.cuando)}${ultimo.por ? ` · ${ultimo.por}` : ''}` : 'Todo como salió de fábrica',
          },
        ]}
      />

      {/* Buscar por nombre. Nada más: los puestos de un negocio de maquinaria
          se cuentan con los dedos de una mano, y filtros por fecha sobre cinco
          filas son adorno que estorba. */}
      <div className="bg-surface border border-edge rounded-2xl px-5 sm:px-6 py-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] sm:max-w-xs">
          <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-mute pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" strokeLinecap="round" /></svg>
          <input aria-label="Buscar puesto" value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar puesto…"
            className="campo campo-sm pl-10" />
        </div>
        {busca && (
          <button onClick={() => setBusca('')}
            className="h-10 px-4 rounded-full border border-edge text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
            Limpiar
          </button>
        )}
        <p className="text-[11.5px] text-mute flex-1 min-w-[220px]">
          Abre un puesto para repartirle sus capacidades. Guardar pide tu código de 6 dígitos.
        </p>
      </div>

      {(
        <div className="bg-surface border border-edge rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-surface-2 border-b border-edge">
                  <th className={th}>Puesto</th>
                  <th className={`${th} hidden sm:table-cell`}>Creado</th>
                  <th className={`${th} hidden md:table-cell`}>Actualizado</th>
                  <th className={`${th} text-right`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rolesEnPantalla.map(r => {
                  const encendidas = foto.catalogo.filter(c => Boolean(foto.efectivo[r.clave]?.[c.nombre])).length
                  const movidas = cambiosDeFabrica(r.clave)
                  const ult = ultimoDe(r.clave)
                  return (
                    <tr key={r.clave} className="hover:bg-surface-2/60 transition-colors">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <IconoRol clave={r.clave} />
                          <div className="min-w-0">
                            <button onClick={() => setHoja(r)}
                              className="flex items-center gap-2 text-[14.5px] font-bold text-ink hover:text-gold-ink transition-colors text-left">
                              {r.nombre}
                              {!r.protegido && (
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-mute border border-edge rounded-full px-1.5 py-0.5">
                                  tuyo
                                </span>
                              )}
                              {/* El punto dorado dice "aquí anduvieron moviendo"
                                  sin gastar una columna en ello. */}
                              {movidas > 0 && (
                                <span className="shrink-0 w-[6px] h-[6px] rounded-full bg-gold"
                                  title={`${movidas} ${movidas === 1 ? 'capacidad difiere' : 'capacidades difieren'} de fábrica`} />
                              )}
                            </button>
                            {/* Bajo el nombre va lo que de verdad contesta la
                                pregunta del dueño: qué le dejé y a cuánta gente
                                le aplica. Ocupa el lugar del "web" de la plantilla. */}
                            <span className="block text-[11.5px] text-mute truncate max-w-[42ch] tabular-nums">
                              {encendidas} de {foto.catalogo.length} capacidades
                              {' · '}
                              {r.usuarios === 0 ? 'nadie lo tiene'
                                : `${r.usuarios} ${r.usuarios === 1 ? 'persona' : 'personas'}`}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} hidden sm:table-cell whitespace-nowrap`}>
                        <span className="text-[13px] text-mute">
                          {r.creado_en ? new Date(r.creado_en).toLocaleDateString('es-MX') : '—'}
                        </span>
                      </td>
                      <td className={`${td} hidden md:table-cell whitespace-nowrap`}>
                        {/* El movimiento de PERMISOS manda sobre el del registro:
                            "¿cuándo le cambiaron algo?" es lo que se viene a ver. */}
                        <span className="text-[13px] text-mute">
                          {ult ? hace(ult.cuando)
                            : r.actualizado_en ? new Date(r.actualizado_en).toLocaleDateString('es-MX') : '—'}
                        </span>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="inline-flex justify-end">
                          <MenuFila etiqueta="Acciones" opciones={[
                            {
                              label: 'Ver permisos',
                              onClick: () => setHoja(r),
                              icono: <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
                            },
                            {
                              label: 'Cambiar el nombre',
                              onClick: () => setNombrando({ rol: r }),
                              icono: <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>,
                            },
                            {
                              label: 'Restablecer de fábrica',
                              onClick: () => restablecer(r),
                              deshabilitado: movidas === 0,
                              razon: 'Este puesto ya está tal como sale de fábrica',
                              icono: <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>,
                            },
                            {
                              label: 'Eliminar puesto',
                              onClick: () => borrar(r),
                              deshabilitado: r.protegido,
                              razon: 'Es uno de los cuatro puestos base del sistema',
                              peligro: true,
                              icono: <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
                            },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Rastro key={version} />

      {hoja && (
        <HojaRol rol={hoja} foto={foto} onCerrar={() => setHoja(null)} onGuardar={guardarCambios} />
      )}
      {nombrando && (
        <HojaNombre rol={nombrando.rol} notify={notify}
          onCerrar={() => setNombrando(null)} onListo={refrescar} />
      )}
    </div>
  )
}
