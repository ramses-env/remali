/**
 * Los tres modales de una cuenta de trabajo: verla, editarla y asignarle puesto.
 *
 * Viven aparte de la pantalla que los abre porque son la misma cuenta mirada
 * desde dos lados —la lista de Equipo hoy, mañana quizá la ficha de un
 * cliente—, y duplicarlos sería tener dos formularios que se van separando solos.
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

import api from '../../lib/api'
import Modal from '../../components/Modal'
import { soloTelefono } from '../../lib/utils'
import { type Notify } from '../../store/toast'
import { type UsuarioPanel, errorMsg, estiloAvatar, estiloRol, hace, iniciales } from './comun'

/** Un puesto que se le puede dar a una cuenta. `clave` es la identidad interna:
 *  preguntar por el NOMBRE deja de funcionar en cuanto el dueño lo renombra. */
export type RolAsignable = { clave: string; nombre: string; nivel: number }

/* ─────────── Los átomos del formulario ───────────
   El campo de píldora, la etiqueta, el ojo de la contraseña y los chips de
   puesto viven aquí arriba y no dentro de cada modal: los tres se ven como una
   sola pieza porque comparten estas clases, no porque cada uno las copie. */

const campo = 'campo'
const etiqueta = 'block text-[13px] font-semibold text-ink mb-2'
const btnSecundario = 'px-7 h-11 rounded-full border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors'
const btnPrimario = 'btn-acento px-8 h-11 rounded-full text-[13.5px] font-black'

/** La etiqueta de un campo. El asterisco es solo pintura: quien no ve la
 *  pantalla se entera por el `required` del input, no por el símbolo rojo. */
function Etiqueta({ children, req, htmlFor }: { children: React.ReactNode; req?: boolean; htmlFor?: string }) {
  return (
    <label className={etiqueta} htmlFor={htmlFor}>
      {children}{req && <span className="text-red-400 ml-0.5" aria-hidden>*</span>}
    </label>
  )
}

const IconoOjo = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
const IconoOjoTachado = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round"><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.5 7.7A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5" /><path d="M10 10a2.8 2.8 0 0 0 4 4" /><path d="M3.5 3.5l17 17" /></svg>

/** Contraseña con su ojo. Empieza tapada —el mostrador tiene gente enfrente— y
 *  se destapa de un clic, que es como se lee para dictarla en persona. */
function CampoClave({ id, valor, onChange, placeholder, className = '' }: {
  id: string; valor: string; onChange: (v: string) => void; placeholder: string; className?: string
}) {
  const [ver, setVer] = useState(false)
  return (
    <div className={`relative ${className}`}>
      <input id={id} className={`${campo} pr-12`} type={ver ? 'text' : 'password'}
        value={valor} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="new-password" />
      <button type="button" onClick={() => setVer(v => !v)} aria-pressed={ver}
        aria-label={ver ? 'Ocultar la contraseña' : 'Ver la contraseña'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full grid place-items-center text-mute hover:text-ink hover:bg-surface transition-colors">
        {ver ? IconoOjoTachado : IconoOjo}
      </button>
    </div>
  )
}

const IconoPalomita = <svg className="w-[15px] h-[15px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>

/** Los puestos, uno solo a la vez.
 *
 *  Es un radiogroup de verdad —un solo tabstop, las flechas se mueven entre
 *  opciones— y no una hilera de botones que se prenden por su cuenta: son
 *  excluyentes, y con `aria-pressed` el lector de pantalla no dice de cuántas
 *  opciones se está eligiendo una. */
export function SelectorPuesto({ roles, valor, onElegir, bloqueado }: {
  roles: RolAsignable[]; valor: string; onElegir: (nombre: string) => void
  /** Puestos que se pintan pero no se pueden elegir (p. ej. quitarte tú mismo
   *  el de administrador). */
  bloqueado?: (r: RolAsignable) => boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // El tabstop cae en el puesto elegido; sin ninguno, en el primero que sirva.
  const iElegido = roles.findIndex(r => r.nombre === valor)
  const foco = iElegido >= 0 ? iElegido : Math.max(0, roles.findIndex(r => !bloqueado?.(r)))

  function teclas(e: React.KeyboardEvent, i: number) {
    const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!paso) return
    e.preventDefault()
    let j = i
    for (let n = 0; n < roles.length; n++) {
      j = (j + paso + roles.length) % roles.length
      if (!bloqueado?.(roles[j])) break
    }
    if (bloqueado?.(roles[j])) return
    onElegir(roles[j].nombre)
    refs.current[j]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="Puesto" className="flex flex-wrap gap-2.5">
      {roles.map((r, i) => {
        const elegido = r.nombre === valor
        return (
          <button key={r.clave || r.nombre} type="button" role="radio" aria-checked={elegido}
            ref={el => { refs.current[i] = el }} tabIndex={i === foco ? 0 : -1}
            disabled={bloqueado?.(r)} onClick={() => onElegir(r.nombre)} onKeyDown={e => teclas(e, i)}
            className={`inline-flex items-center gap-2.5 h-11 pl-4 pr-5 rounded-full text-[13.5px] font-bold border transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${
              elegido
                ? 'btn-acento border-transparent'
                : 'bg-surface-2 border-edge text-ink hover:border-gold/40 disabled:hover:border-edge'
            }`}>
            {elegido
              ? IconoPalomita
              : <span aria-hidden className="w-[15px] h-[15px] rounded-full border-[1.6px] border-current opacity-45 shrink-0" />}
            {r.nombre}
          </button>
        )
      })}
    </div>
  )
}

/* ─────────── Asignar puesto ─────────── */

export function AsignarRolModal({ u, roles, onClose, onSaved, notify }: {
  u: UsuarioPanel; roles: RolAsignable[]
  onClose: () => void; onSaved: () => void; notify: Notify
}) {
  const [rol, setRol] = useState(u.rol || '')
  const [guardando, setGuardando] = useState(false)

  const guardar = () => {
    setGuardando(true)
    api.patch(`/usuarios/${u.id}/`, { rol })
      .then(() => { notify(rol ? `${u.nombre} ahora es ${rol}` : `${u.nombre} se quedó sin puesto`, rol ? 'ok' : 'warning'); onSaved(); onClose() })
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar el puesto'), 'err'))
      .finally(() => setGuardando(false))
  }

  return createPortal(
    <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={onClose} label="Asignar puesto">
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[520px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-edge flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-ink">Puesto de {u.nombre}</h2>
            <p className="text-[13px] text-mute mt-0.5">Define qué puede hacer dentro del panel.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-full grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 sm:px-7 py-5 flex-1 overflow-y-auto">
          {/* A quién se le está dando el puesto. El modal se abre solo al crear
              una cuenta y también desde el menú de una fila cualquiera: sin la
              cara y el correo enfrente, es fácil asignarle el puesto al de
              junto. */}
          <div className="flex items-center gap-3.5 rounded-2xl bg-surface-2 border border-edge px-4 py-3.5">
            <Avatar u={u} size={48} />
            <div className="min-w-0">
              <p className="text-[15px] font-black text-ink truncate">{u.nombre}</p>
              <p className="text-[13px] text-mute truncate">{u.email || u.username}</p>
            </div>
          </div>

          <h3 className="text-[15px] font-black text-ink mt-6 mb-3">Puestos disponibles</h3>
          <SelectorPuesto roles={roles} valor={rol} onElegir={setRol} />

          <p className="text-[12.5px] text-mute mt-4 leading-relaxed">
            Lo que puede cada puesto se reparte en <b className="text-ink">Permisos</b>. Sin puesto,
            la cuenta existe pero <b className="text-ink">no entra al panel</b>.
          </p>
        </div>

        <div className="px-6 sm:px-7 py-5 border-t border-edge flex items-center justify-end gap-2.5">
          <button onClick={onClose} className={btnSecundario}>Cancelar</button>
          <button onClick={guardar} disabled={guardando || rol === (u.rol || '')} className={btnPrimario}>
            {guardando ? 'Guardando…' : 'Guardar puesto'}
          </button>
        </div>
      </motion.div>
    </Modal>, document.body)
}

/* ─────────── Ver la cuenta ─────────── */

/** Un renglón del detalle. Va FUERA del componente: definido adentro, React lo
 *  ve como un componente distinto en cada render y remonta las ocho filas por
 *  cualquier cambio de estado. */
function Dato({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.5px] text-mute">{k}</p>
        <p className={`text-[14px] font-bold text-ink mt-0.5 break-words ${mono ? 'font-mono text-[13.5px]' : ''}`}>
          {v || <span className="text-mute font-sans font-normal">—</span>}
        </p>
      </div>
    </div>
  )
}

export function UsuarioDetalle({ u, soyYo, onClose, onEditar }: {
  u: UsuarioPanel; soyYo?: boolean; onClose: () => void; onEditar: () => void
}) {
  const rol = estiloRol(u)

  return createPortal(
    <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={onClose} label="Detalle de la cuenta">
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[520px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-edge flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar u={u} size={48} />
            <div className="min-w-0">
              <h2 className="text-lg font-black text-ink truncate">{u.nombre}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${rol.cls}`}>{rol.label}</span>
                {soyYo && <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-mute">Tú</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-full grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 sm:px-7 py-2 flex-1 overflow-y-auto divide-y divide-edge">
          <Dato k="Usuario para entrar" v={u.username} mono />
          <Dato k="Correo" v={u.email} />
          <Dato k="Teléfono" v={u.telefono} mono />
          <Dato k="Puesto" v={u.puesto} />
          <Dato k="Acceso" v={u.activo ? 'Activo' : 'Sin acceso'} />
          <Dato k="Código de seguridad" v={u.tiene_codigo ? 'Definido' : 'Sin definir'} />
          <Dato k="Último acceso" v={hace(u.ultimo_acceso)} />
          <Dato k="Alta" v={u.creado ? new Date(u.creado).toLocaleDateString('es-MX') : ''} />
        </div>

        <div className="px-6 sm:px-7 py-5 border-t border-edge flex items-center justify-end gap-2.5">
          <button onClick={onClose} className={btnSecundario}>Cerrar</button>
          <button onClick={onEditar} className={btnPrimario}>Editar</button>
        </div>
      </motion.div>
    </Modal>, document.body)
}

/* ─────────── El avatar ─────────── */

/** La foto de la cuenta, o sus iniciales. La foto es opcional a propósito: el
 *  panel tiene que verse bien el día uno, cuando nadie ha subido ninguna. */
export function Avatar({ u, size = 40 }: { u: UsuarioPanel; size?: number }) {
  const lado = { width: size, height: size }
  if (u.tiene_foto && u.avatar_url) return (
    <img src={u.avatar_url} alt="" style={lado}
      className="shrink-0 rounded-full object-cover border border-edge" />
  )
  return (
    <span style={lado}
      className={`shrink-0 rounded-full grid place-items-center text-[13px] font-black ${estiloAvatar(u)}`}>
      {iniciales(u)}
    </span>
  )
}

/* ─────────── Alta y edición ─────────── */

export function UsuarioModal({ usuario, roles, soyYo, onClose, onSaved, notify }: {
  usuario: UsuarioPanel | null; roles: RolAsignable[]; soyYo?: boolean
  /** `creado` solo viene al dar de alta: con él, el llamador abre el modal
   *  de asignar puesto sin que nadie tenga que buscarlo en la lista. */
  onClose: () => void; onSaved: (m: string, creado?: UsuarioPanel) => void; notify: Notify
}) {
  const nuevo = !usuario
  const [f, setF] = useState({
    username: usuario?.username || '', first_name: usuario?.first_name || '', last_name: usuario?.last_name || '',
    email: usuario?.email || '', rol: usuario?.rol || '', telefono: usuario?.telefono || '',
    puesto: usuario?.puesto || '', password: '', codigo_seguridad: '',
  })
  /** La foto elegida y su vista previa. Se manda solo si la escogieron: sin
   *  archivo, el `PATCH` ni menciona el campo y la que ya tenía se queda. */
  const [foto, setFoto] = useState<File | null>(null)
  const [previa, setPrevia] = useState(usuario?.tiene_foto ? (usuario.avatar_url || '') : '')
  const [guardando, setGuardando] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))

  const puesto = roles.find(r => r.nombre === f.rol)
  // Solo el Administrador (y el Dueño) autoriza acciones sensibles: su PIN es su
  // firma. Se pregunta por la CLAVE porque el puesto se puede renombrar, y el
  // backend impone lo mismo por su lado.
  const esAutoridad = puesto?.clave === 'administrador'

  const elegirFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    if (archivo.size > 5 * 1024 * 1024) { notify('La foto no puede pasar de 5 MB', 'err'); return }
    setFoto(archivo)
    setPrevia(URL.createObjectURL(archivo))
  }

  function guardar() {
    setGuardando(true)
    // Al crear no se manda el puesto ni el PIN: los pide el modal de asignar
    // puesto, que se abre solo en cuanto la cuenta existe.
    const { rol: _rol, codigo_seguridad: _pin, ...alta } = f
    const campos: Record<string, string> = nuevo
      ? { ...alta }
      : {
        first_name: f.first_name, last_name: f.last_name, email: f.email,
        rol: f.rol, telefono: f.telefono, puesto: f.puesto,
        ...(esAutoridad && f.codigo_seguridad ? { codigo_seguridad: f.codigo_seguridad } : {}),
      }
    // Con foto va como formulario; sin ella, JSON de siempre. Mandar todo como
    // multipart convertiría cada campo vacío en la cadena "undefined".
    let cuerpo: FormData | Record<string, string> = campos
    if (foto) {
      const fd = new FormData()
      Object.entries(campos).forEach(([k, v]) => fd.append(k, v ?? ''))
      fd.append('avatar', foto)
      cuerpo = fd
    }
    const peticion = nuevo
      ? api.post('/usuarios/', cuerpo)
      : api.patch(`/usuarios/${usuario!.id}/`, cuerpo)
    peticion
      .then(r => onSaved(
        nuevo ? `Cuenta de ${f.first_name || f.username} creada` : 'Cambios guardados',
        nuevo ? (r.data as UsuarioPanel) : undefined,
      ))
      .catch(err => notify(errorMsg(err, 'No se pudo guardar'), 'err'))
      .finally(() => setGuardando(false))
  }

  function cambiarPassword() {
    if (f.password.length < 8) { notify('La contraseña debe tener al menos 8 caracteres', 'err'); return }
    api.patch(`/usuarios/${usuario!.id}/`, { password: f.password })
      .then(() => { notify(`Contraseña nueva para ${usuario!.nombre}`); set('password', '') })
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar'), 'err'))
  }

  return createPortal(
    <Modal className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClose={onClose}
      cerrarAlTocarFuera={false} label={nuevo ? 'Agregar cuenta de trabajo' : 'Editar cuenta'}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 sm:px-7 pt-6 pb-5 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-lg font-black text-ink">{nuevo ? 'Agregar cuenta de trabajo' : usuario!.nombre}</h2>
            <p className="text-[13px] text-mute mt-0.5">
              {nuevo ? 'Tendrá su propia cuenta para entrar al panel.' : `Cuenta ${usuario!.username}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-full grid place-items-center text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 sm:px-7 py-6 space-y-6 overflow-y-auto flex-1">
          <div>
            <p className={etiqueta}>Foto</p>
            <div className="flex items-center gap-4">
              {previa
                ? <img src={previa} alt="" className="w-20 h-20 rounded-full object-cover border border-edge" />
                : <span className="w-20 h-20 rounded-full bg-surface-2 border border-edge grid place-items-center text-mute">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-4 4 3 3-2 4 3" /></svg>
                </span>}
              <label className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-edge bg-surface-2 text-[13px] font-bold text-ink hover:border-gold/40 transition-colors cursor-pointer">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
                {previa ? 'Cambiar foto' : 'Elegir foto'}
                <input type="file" accept="image/*" className="sr-only" onChange={elegirFoto} />
              </label>
            </div>
            <p className="text-[12px] text-mute mt-2.5">Opcional. Sin foto se usan sus iniciales.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Etiqueta htmlFor="u-nombre">Nombre</Etiqueta>
              <input id="u-nombre" className={campo} value={f.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Pedro" />
            </div>
            <div>
              <Etiqueta htmlFor="u-apellido">Apellido</Etiqueta>
              <input id="u-apellido" className={campo} value={f.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Ruiz" />
            </div>
          </div>

          {nuevo && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Etiqueta htmlFor="u-usuario" req>Usuario para entrar</Etiqueta>
                <input id="u-usuario" required className={campo} value={f.username} onChange={e => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="pedro" autoComplete="off" />
              </div>
              <div>
                <Etiqueta htmlFor="u-clave" req>Contraseña</Etiqueta>
                <CampoClave id="u-clave" valor={f.password} onChange={v => set('password', v)} placeholder="Mínimo 8 caracteres" />
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Etiqueta htmlFor="u-correo">Correo</Etiqueta>
              <input id="u-correo" className={campo} type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="pedro@ejemplo.com" />
            </div>
            {/* Siempre México: no hay selector de país porque no hay decisión
                que tomar, y un desplegable con banderas invita a equivocarse. */}
            <div>
              <Etiqueta htmlFor="u-tel">Teléfono</Etiqueta>
              <div className="flex items-stretch">
                <span className="shrink-0 inline-flex items-center gap-1.5 pl-5 pr-4 rounded-l-full border border-r-0 border-edge bg-surface-2 text-[13px] font-bold text-mute">
                  <span aria-hidden>🇲🇽</span> +52
                </span>
                <input id="u-tel" type="tel" inputMode="numeric" maxLength={10}
                  className={`${campo} rounded-l-none pl-3`} value={f.telefono}
                  onChange={e => set('telefono', soloTelefono(e.target.value))} placeholder="10 dígitos" />
              </div>
            </div>
          </div>

          {/* El puesto NO se pide al dar de alta. Crear la cuenta y repartirle
              permisos son dos decisiones distintas, y juntarlas obliga a
              tomarlas con el empleado enfrente: primero existe la persona,
              después se decide qué puede hacer. Al guardar se abre solo el
              modal de asignar puesto. */}
          {!nuevo && (
          <div>
            <p className={etiqueta}>Puesto</p>
            <SelectorPuesto roles={roles} valor={f.rol} onElegir={v => set('rol', v)}
              bloqueado={r => !!soyYo && esAutoridad && r.clave !== 'administrador'} />
            {/* Qué implica cada puesto, con las palabras del negocio. Es lo mismo
                que impone la API; aquí solo se explica. */}
            <div className="mt-3.5 rounded-2xl bg-surface-2 border border-edge px-4 py-3.5 text-[12.5px] leading-relaxed">
              {puesto?.clave === 'administrador' ? (
                <>
                  <p className="text-ink font-bold mb-1">{puesto.nombre}</p>
                  <p className="text-mute">Opera todo el negocio: rentas, ventas, cotizaciones, facturación, inventario y catálogo. Ve los montos y las métricas.</p>
                  <p className="text-mute mt-1.5">No puede gestionar usuarios ni cambiar la configuración del negocio: eso es solo tuyo.</p>
                </>
              ) : puesto?.clave === 'tecnico' ? (
                <>
                  <p className="text-ink font-bold mb-1">{puesto.nombre}</p>
                  <p className="text-mute">Entrega, recoge y repara. Ve dónde está cada máquina, con quién y cuándo se recoge; marca los regresos, sube las fotos y trabaja las órdenes de taller.</p>
                  <p className="text-mute mt-1.5">No ve montos ni crea rentas o ventas.</p>
                </>
              ) : f.rol ? (
                <p className="text-mute">Entra al panel con lo que le hayas repartido a ese puesto en <b className="text-ink">Permisos</b>.</p>
              ) : (
                <p className="text-mute">Sin puesto la cuenta existe pero <b className="text-ink">no puede entrar al panel</b>. Elige uno arriba.</p>
              )}
              {soyYo && esAutoridad && <p className="text-mute mt-1.5">No puedes quitarte a ti mismo el acceso de administrador.</p>}
            </div>
          </div>
          )}

          {nuevo && (
            <p className="rounded-2xl bg-surface-2 border border-edge px-4 py-3.5 text-[12.5px] text-mute leading-relaxed">
              Al guardar se te pregunta qué <b className="text-ink">puesto</b> le toca.
              Mientras no tenga uno, la cuenta existe pero no entra al panel.
            </p>
          )}

          {!nuevo && esAutoridad && (
            <div>
              <Etiqueta htmlFor="u-pin">Código de seguridad (PIN de 6 dígitos)</Etiqueta>
              <input id="u-pin" className={`${campo} font-mono tracking-[0.3em]`} type="password" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                value={f.codigo_seguridad} onChange={e => set('codigo_seguridad', e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Dejar vacío para no cambiarlo" />
              <p className="text-[12px] text-mute mt-2">Con este PIN autoriza las acciones delicadas: ajustes de precio, anticipos bajos, devoluciones. Es su firma.</p>
            </div>
          )}

          <div>
            <Etiqueta htmlFor="u-cargo">Cargo (cómo se le dice)</Etiqueta>
            <input id="u-cargo" className={campo} value={f.puesto} onChange={e => set('puesto', e.target.value)} placeholder="Técnico de servicio, asesor de ventas…" />
          </div>

          {!nuevo && (
            <div className="pt-5 border-t border-edge">
              <Etiqueta htmlFor="u-clave-nueva">Cambiar su contraseña</Etiqueta>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <CampoClave id="u-clave-nueva" className="flex-1" valor={f.password} onChange={v => set('password', v)}
                  placeholder="Nueva contraseña, mínimo 8 caracteres" />
                <button onClick={cambiarPassword} disabled={!f.password}
                  className="shrink-0 h-12 px-6 rounded-full border border-edge bg-surface-2 text-[13px] font-bold text-ink hover:border-gold/40 disabled:opacity-40 transition-colors">
                  Cambiar
                </button>
              </div>
              <p className="text-[12px] text-mute mt-2.5">Anótala y dásela en persona; el sistema no se la manda por correo.</p>
            </div>
          )}
        </div>

        <div className="px-6 sm:px-7 py-5 border-t border-edge flex items-center justify-end gap-2.5 shrink-0">
          <button onClick={onClose} className={btnSecundario}>Cancelar</button>
          <button onClick={guardar} disabled={guardando || (nuevo && (!f.username || f.password.length < 8))} className={btnPrimario}>
            {guardando ? 'Guardando…' : nuevo ? 'Crear cuenta' : 'Guardar cambios'}
          </button>
        </div>
      </motion.div>
    </Modal>, document.body)
}
