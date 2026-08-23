/**
 * Permisos por rol: la matriz de capacidades × puestos.
 *
 * Lo que se enciende aquí lo obedece el backend (`ExigeCapacidad`); esta
 * pantalla no es la defensa, es la que DECIDE. Ver
 * docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
 *
 * Se guarda por ROL y no por persona: enciendes algo para "Cajero" y aplica a
 * todos los cajeros. Y solo se guarda lo que DIFIERE de fábrica, así que "¿qué
 * toqué yo?" es el punto dorado y no un diff mental.
 */
import { useCallback, useEffect, useState } from 'react'

import api from '../../lib/api'
import { pedir } from '../../components/Dialogo'
import { type Notify } from '../../store/toast'
import { errorMsg } from './comun'

export type Capacidad = {
  nombre: string; etiqueta: string; descripcion: string
  area: string; nucleo: boolean; nivel_minimo: number | null
}
export type Foto = {
  roles: { nombre: string; nivel: number }[]
  catalogo: Capacidad[]
  fabrica: Record<string, Record<string, boolean>>
  efectivo: Record<string, Record<string, boolean>>
  overrides: { rol: string; capacidad: string; permitido: boolean; por: string; cuando: string }[]
}

/** Clave de una celda: rol + capacidad. El separador es "·" porque ni los roles
 *  ni los nombres del catálogo lo usan; un guion sí aparece en las capacidades. */
const clave = (rol: string, cap: string) => `${rol}·${cap}`

/** Un interruptor de la matriz, o el candado si la capacidad es del núcleo.
 *
 * El `<button role="switch">` no es capricho: un `<div onClick>` pierde foco,
 * teclado y semántica, y aquí son más de ochenta controles. El alto de 44 px da
 * el área de toque aunque el dibujo mida 30×17.
 */
function Celda({ encendido, movida, bloqueada, etiqueta, resaltada, onToggle, onFoco }: {
  encendido: boolean; movida: boolean; bloqueada: boolean
  etiqueta: string; resaltada: boolean; onToggle: () => void; onFoco: () => void
}) {
  if (bloqueada) return (
    <span className={`grid place-items-center h-11 ${resaltada ? 'bg-gold/5' : ''}`}
      title={`${etiqueta} — esta capacidad no se reparte desde aquí`}>
      {/* El candado se VE, no se esconde: verlo bloqueado enseña la regla;
          esconderlo la vuelve un misterio. Y muestra su estado real, encendido
          o apagado, porque "intocable" no es lo mismo que "apagado". */}
      <span className={`w-[30px] h-[17px] rounded-full border border-dashed grid place-items-center
        ${encendido ? 'border-gold/60 bg-gold/10' : 'border-edge'}`}>
        <svg viewBox="0 0 24 24" className={`w-2.5 h-2.5 ${encendido ? 'text-gold' : 'text-mute'}`}
          fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
    </span>
  )
  return (
    <button
      type="button" role="switch" aria-checked={encendido} aria-label={etiqueta}
      onClick={onToggle} onFocus={onFoco} onMouseEnter={onFoco}
      className={`relative grid place-items-center h-11 w-full transition-colors rounded-lg
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60
        ${resaltada ? 'bg-gold/5' : ''}`}
    >
      <span className={`w-[30px] h-[17px] rounded-full relative transition-colors
        ${encendido ? 'bg-gold' : 'bg-ink/15'}`}>
        <span className={`absolute top-[2.5px] w-3 h-3 rounded-full bg-white transition-all
          shadow-[0_1px_2px_rgba(0,0,0,0.2)] ${encendido ? 'left-[15px]' : 'left-[2.5px]'}`} />
      </span>
      {movida && (
        <span className="absolute top-2 right-2.5 w-[5px] h-[5px] rounded-full bg-gold"
          title="Difiere de lo que trae el puesto de fábrica" />
      )}
    </button>
  )
}

export default function PermisosAdmin({ notify }: { notify: Notify }) {
  const [foto, setFoto] = useState<Foto | null>(null)
  const [error, setError] = useState('')
  /** Lo que el dueño movió y todavía no guarda. Valor = destino del interruptor. */
  const [pendientes, setPendientes] = useState<Record<string, boolean>>({})
  const [filtro, setFiltro] = useState<'todas' | 'cambiadas' | 'encendidas'>('todas')
  /** Fila y columna bajo el cursor o el foco: la cruz de lectura. En una rejilla
   *  de cien celdas el error no es escoger mal, es encender el de junto. */
  const [cruz, setCruz] = useState<{ cap: string; rol: string } | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(() => {
    api.get<Foto>('/permisos/')
      .then(r => { setFoto(r.data); setError('') })
      .catch(e => setError(errorMsg(e, 'No se pudieron cargar los permisos.')))
  }, [])
  useEffect(() => { cargar() }, [cargar])

  /** Estado que se ve en pantalla: lo guardado, con lo pendiente encima. */
  const valor = (rol: string, cap: string) => {
    const p = pendientes[clave(rol, cap)]
    return p !== undefined ? p : Boolean(foto?.efectivo[rol]?.[cap])
  }
  /** ¿Difiere de fábrica? Es el punto dorado, y también lo que el filtro busca. */
  const movida = (rol: string, cap: string) =>
    valor(rol, cap) !== Boolean(foto?.fabrica[rol]?.[cap])

  const alternar = (rol: string, cap: string) => {
    const destino = !valor(rol, cap)
    setPendientes(prev => {
      const sig = { ...prev }
      // Si vuelve a lo guardado, deja de ser un cambio pendiente: la barra no
      // debe prometer "1 cambio" cuando el dueño ya se arrepintió a mano.
      if (destino === Boolean(foto?.efectivo[rol]?.[cap])) delete sig[clave(rol, cap)]
      else sig[clave(rol, cap)] = destino
      return sig
    })
  }

  if (error) return (
    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3">
      <span className="text-sm text-ink flex-1">{error}</span>
      <button onClick={cargar} className="shrink-0 text-sm font-bold text-gold hover:underline">Reintentar</button>
    </div>
  )
  if (!foto) return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 rounded-xl bg-surface-2 animate-pulse" />
      ))}
    </div>
  )

  const cambios = Object.entries(pendientes).map(([k, permitido]) => {
    const [rol, capacidad] = k.split('·')
    return { rol, capacidad, permitido }
  })
  /** Los cambios en palabras: "Cajero: cotizar y ver la operación". Un contador
   *  a secas no deja revisar lo que se está a punto de firmar. */
  const resumen = foto.roles.map(r => {
    const suyos = cambios.filter(c => c.rol === r.nombre)
      .map(c => foto.catalogo.find(x => x.nombre === c.capacidad)?.etiqueta.toLowerCase())
      .filter(Boolean)
    return suyos.length ? `${r.nombre}: ${suyos.join(' y ')}` : ''
  }).filter(Boolean).join(' · ')

  const guardar = async () => {
    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} de permisos. Teclea tus 6 dígitos para confirmarlo.`,
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return          // se arrepintió: no se toca nada
    setGuardando(true)
    try {
      const r = await api.post<Foto>('/permisos/', { cambios, codigo })
      setFoto(r.data)
      setPendientes({})                  // solo en el camino bueno: si falla, no se pierde nada
      notify('Permisos actualizados', 'ok')
    } catch (e) {
      notify(errorMsg(e), 'err')         // el tipo SIEMPRE se declara: el default sale verde
    } finally {
      setGuardando(false)
    }
  }

  const areas = [...new Set(foto.catalogo.map(c => c.area))]
  const visibles = (caps: Capacidad[]) => caps.filter(c =>
    filtro === 'todas' ? true
      : filtro === 'cambiadas' ? foto.roles.some(r => movida(r.nombre, c.nombre))
        : foto.roles.some(r => valor(r.nombre, c.nombre)))
  const FILTROS: { key: typeof filtro; label: string }[] = [
    { key: 'todas', label: 'Todas' },
    { key: 'cambiadas', label: 'Solo lo que cambié' },
    { key: 'encendidas', label: 'Solo encendidas' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 rounded-xl border border-edge bg-surface p-1">
          {FILTROS.map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              aria-pressed={filtro === f.key}
              className={`text-[11px] font-semibold rounded-lg px-3 py-1.5 transition-colors
                ${filtro === f.key ? 'bg-gold text-gold-on' : 'text-mute hover:text-ink'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-mute flex-1 min-w-[220px]">
          El Dueño no aparece: lo puede todo, siempre. Lo del candado no se reparte desde aquí.
        </p>
      </div>

      <div className="rounded-xl border border-edge bg-surface overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[1fr_repeat(4,64px)] bg-surface-2 border-b border-edge sticky top-0 z-20">
            <div className="px-3.5 py-2.5 text-[10px] font-semibold tracking-wider text-mute sticky left-0 bg-surface-2">
              CAPACIDAD
            </div>
            {foto.roles.map(r => (
              <div key={r.nombre} className={`py-2 text-center transition-colors
                ${cruz?.rol === r.nombre ? 'bg-gold/5' : ''}`}>
                <div className="text-[11px] font-semibold text-ink">{r.nombre}</div>
                {/* Contador vivo: se mueve mientras se toca, y responde de un
                    vistazo "¿al final qué le dejé?". */}
                <div className="text-[10px] text-mute tabular-nums">
                  {foto.catalogo.filter(c => valor(r.nombre, c.nombre)).length}/{foto.catalogo.length}
                </div>
              </div>
            ))}
          </div>

          {areas.map(area => {
            const caps = visibles(foto.catalogo.filter(c => c.area === area))
            if (!caps.length) return null
            return (
              <div key={area}>
                <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1.5 border-t border-edge sticky left-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{area}</span>
                  <i className="flex-1 h-px bg-edge" />
                </div>
                {caps.map(c => (
                  <div key={c.nombre}
                    onMouseEnter={() => setCruz({ cap: c.nombre, rol: '' })}
                    onMouseLeave={() => setCruz(null)}
                    className={`grid grid-cols-[1fr_repeat(4,64px)] items-center border-t border-edge transition-colors
                      ${cruz?.cap === c.nombre ? 'bg-gold/5' : ''}`}>
                    <div className={`px-3.5 py-2 sticky left-0 z-10 ${cruz?.cap === c.nombre ? 'bg-surface' : 'bg-surface'}`}>
                      <span className="block text-[11.5px] font-medium text-ink">{c.etiqueta}</span>
                      {/* La explicación llega cuando hace falta: pintarla en las
                          26 filas a la vez mataría la densidad, que es lo que
                          hace útil a esta pantalla. */}
                      {cruz?.cap === c.nombre && (
                        <span className="block text-[10px] text-mute mt-0.5 leading-snug">{c.descripcion}</span>
                      )}
                    </div>
                    {foto.roles.map(r => (
                      <Celda key={r.nombre}
                        encendido={valor(r.nombre, c.nombre)}
                        movida={movida(r.nombre, c.nombre)}
                        bloqueada={c.nucleo}
                        etiqueta={`${c.etiqueta} — ${r.nombre}`}
                        resaltada={cruz?.cap === c.nombre && cruz?.rol === r.nombre}
                        onToggle={() => alternar(r.nombre, c.nombre)}
                        onFoco={() => setCruz({ cap: c.nombre, rol: r.nombre })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {cambios.length > 0 && (
        <div className="sticky bottom-4 mt-3 flex items-center justify-between gap-3 rounded-xl
                        border border-gold/30 bg-surface px-3 py-2.5 shadow-[0_1px_3px_rgba(33,29,22,0.04)]">
          <p className="text-[12px] text-ink font-medium min-w-0">
            <span className="text-gold tabular-nums">{cambios.length}</span>{' '}
            {cambios.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
            <span className="block text-[10px] text-mute font-normal mt-0.5 truncate">{resumen}</span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setPendientes({})} disabled={guardando}
              className="text-[11px] font-semibold text-mute border border-edge rounded-lg px-3.5 py-2 disabled:opacity-60">
              Descartar
            </button>
            <button onClick={guardar} disabled={guardando}
              className="text-[11px] font-semibold bg-gold text-gold-on rounded-lg px-3.5 py-2 disabled:opacity-60">
              {guardando ? 'Guardando…' : 'Guardar con mi código'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
