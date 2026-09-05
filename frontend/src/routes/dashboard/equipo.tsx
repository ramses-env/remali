/**
 * Equipo: las cuentas de trabajo, las que entran al panel.
 *
 * Vive aparte del padrón de Clientes a propósito, y la línea no es "quién tiene
 * cuenta" —esa la cruza el mismo señor solo, el día que se registra en la
 * tienda— sino para qué sirve la cuenta: aquí están los que TRABAJAN, allá los
 * que compran o rentan. La cuenta de un cliente es un dato suyo dentro de su
 * ficha, no una lista aparte.
 *
 * Quién puede QUÉ dentro del panel no se decide aquí: aquí se le da su puesto,
 * y lo que ese puesto puede se reparte en Permisos.
 */
import { useEffect, useState } from 'react'

import api from '../../lib/api'
import { confirmar, pedir } from '../../components/Dialogo'
import { KpiGrid } from '../../components/ui/kpi-grid'
import Paginador from '../../components/ui/paginador'
import { usePaginado } from '../../components/ui/usar-paginado'
import { type Notify } from '../../store/toast'
import {
  type UsuarioPanel, EstadoVacio, FilasEsqueleto, MenuFila, errorMsg, esCliente, estiloRol, hace,
} from './comun'
import {
  type RolAsignable, AsignarRolModal, Avatar, UsuarioDetalle, UsuarioModal,
} from './cuentas-modales'
import { anotarFallo } from '../../lib/fallo'

/* ─────────── Iconos del menú de la fila ─────────── */
const IconoVer = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
const IconoEditar = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /></svg>
const IconoPuesto = <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
const IconoClave = <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M13.5 6.5l3 3" /></svg>
const IconoQuitar = <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M18 7l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" /><path d="M10 11v6M14 11v6" /></svg>
const IconoDevolver = <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5" /></svg>

export default function EquipoAdmin({ usuarios, reload, notify, yoId, cargando }: {
  usuarios: UsuarioPanel[]; reload: () => void; notify: Notify; yoId?: number
  /** La lista todavía viene en camino: el vacío no es un vacío de verdad. */
  cargando?: boolean
}) {
  const [f, setF] = useState({ q: '', correo: '', tel: '', puesto: '' })
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<UsuarioPanel | null>(null)
  const [viendo, setViendo] = useState<UsuarioPanel | null>(null)
  const [asignando, setAsignando] = useState<UsuarioPanel | null>(null)
  const [roles, setRoles] = useState<RolAsignable[]>([])

  useEffect(() => {
    api.get<{ roles: RolAsignable[] }>('/usuarios/roles/')
      .then(r => setRoles(r.data?.roles || []))
      .catch(anotarFallo)
  }, [])

  const equipo = usuarios.filter(u => !esCliente(u))
  const activos = equipo.filter(u => u.activo)
  const sinPuesto = equipo.filter(u => !u.rol && !u.es_superusuario)
  const sinAcceso = equipo.length - activos.length
  const admins = activos.filter(u => u.es_admin)

  const hayFiltros = Object.values(f).some(Boolean)

  const filtrados = equipo.filter(u => {
    const q = f.q.trim().toLowerCase()
    if (q && !`${u.nombre} ${u.username} ${u.rol || ''} ${u.puesto}`.toLowerCase().includes(q)) return false
    if (f.correo.trim() && !(u.email || '').toLowerCase().includes(f.correo.toLowerCase().trim())) return false
    if (f.tel.trim() && !(u.telefono || '').replace(/\D/g, '').includes(f.tel.replace(/\D/g, ''))) return false
    if (f.puesto && (u.rol || '') !== f.puesto) return false
    return true
  })

  // El pie de la tabla vivía aquí escrito a mano; ahora es la pieza de la casa
  // (`components/ui/paginador`), la misma en todas las tablas del panel. Diez
  // por página: la fila de una cuenta es alta (foto, correo, rol, accesos).
  const { enPantalla, ancla, props: pagProps } = usePaginado(filtrados, 10, [f.q, f.correo, f.tel, f.puesto])

  async function quitarAcceso(u: UsuarioPanel) {
    const ok = await confirmar({
      titulo: `Quitarle el acceso a ${u.nombre}`,
      mensaje: 'No se borra su historial: lo que capturó, cobró y entregó se conserva. Solo deja de poder entrar.',
      aceptar: 'Quitar acceso', tono: 'peligro',
    })
    if (!ok) return
    api.delete(`/usuarios/${u.id}/`)
      .then(() => { notify(`${u.nombre} ya no puede entrar`, 'warning'); reload() })
      .catch(err => notify(errorMsg(err, 'No se pudo quitar el acceso'), 'err'))
  }

  function devolverAcceso(u: UsuarioPanel) {
    api.patch(`/usuarios/${u.id}/`, { activo: true })
      .then(() => { notify(`${u.nombre} puede entrar de nuevo`, 'ok'); reload() })
      .catch(err => notify(errorMsg(err, 'No se pudo reactivar'), 'err'))
  }

  /** Contraseña sin abrir el editor: es lo que se pide cuando alguien la olvidó
   *  a media jornada y hay que resolverlo en el mostrador. */
  async function passwordExpres(u: UsuarioPanel) {
    const nueva = await pedir({
      titulo: `Nueva contraseña para ${u.nombre}`,
      mensaje: 'Mínimo 8 caracteres. Anótala y dásela en persona; el sistema no se la manda por correo.',
      placeholder: 'Nueva contraseña',
    })
    if (nueva === null) return
    if (nueva.trim().length < 8) { notify('La contraseña debe tener al menos 8 caracteres', 'err'); return }
    api.patch(`/usuarios/${u.id}/`, { password: nueva.trim() })
      .then(() => notify(`Contraseña nueva para ${u.nombre}`, 'ok'))
      .catch(err => notify(errorMsg(err, 'No se pudo cambiar'), 'err'))
  }

  const th = 'text-left text-[13px] font-bold text-ink px-5 sm:px-6 py-4 whitespace-nowrap'
  const td = 'px-5 sm:px-6 py-4 align-middle'
  const campo = 'campo campo-sm'
  const etiqueta = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

  return (
    <div className="max-w-6xl space-y-2.5">
      <div className="bg-surface border border-edge rounded-2xl px-6 sm:px-7 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-ink">Equipo</h2>
            <p className="text-sm text-mute mt-1 max-w-[62ch]">
              Quién entra al panel y con qué puesto.{' '}
              {admins.length === 1
                ? <span className="text-ink font-semibold">Solo una cuenta administra el sistema; considera dejar otra por si pierdes el acceso.</span>
                : `${admins.length} cuentas administran el sistema.`}
            </p>
          </div>
          <button onClick={() => setCreando(true)}
            className="btn-acento shrink-0 inline-flex items-center gap-2 h-11 pl-4 pr-5 rounded-full text-[14px] font-bold">
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Agregar cuenta
          </button>
        </div>
      </div>

      <KpiGrid
        items={[
          { label: 'Cuentas', value: equipo.length, helper: `${activos.length} pueden entrar hoy`, icon: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></> },
          {
            label: 'Administradores', value: admins.length,
            tone: admins.length === 1 ? 'warning' : 'success', emphasis: admins.length === 1,
            helper: admins.length === 1 ? 'con uno solo, si pierde el acceso nadie entra' : 'pueden tocarlo todo',
            icon: <><path d="M12 2.8 4.5 6v6c0 4.5 3.2 7.7 7.5 9.2 4.3-1.5 7.5-4.7 7.5-9.2V6z" /></>,
          },
          {
            label: 'Sin puesto', value: sinPuesto.length,
            tone: sinPuesto.length ? 'warning' : 'muted', emphasis: sinPuesto.length > 0,
            helper: sinPuesto.length ? 'Tienen cuenta pero no entran al panel' : 'Todas con su puesto',
            icon: <><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></>,
          },
          {
            label: 'Sin acceso', value: sinAcceso,
            tone: sinAcceso ? 'danger' : 'muted', emphasis: sinAcceso > 0,
            helper: 'Se conserva su historial',
            icon: <><rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
          },
        ]}
      />

      <div className="bg-surface border border-edge rounded-2xl px-5 sm:px-6 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={etiqueta} htmlFor="eq-q">Buscar</label>
            <input id="eq-q" className={campo} value={f.q} onChange={e => setF(s => ({ ...s, q: e.target.value }))} placeholder="Nombre, usuario o puesto" />
          </div>
          <div>
            <label className={etiqueta} htmlFor="eq-correo">Correo</label>
            <input id="eq-correo" className={campo} value={f.correo} onChange={e => setF(s => ({ ...s, correo: e.target.value }))} placeholder="Filtrar por correo" />
          </div>
          <div>
            <label className={etiqueta} htmlFor="eq-tel">Teléfono</label>
            <input id="eq-tel" className={campo} inputMode="numeric" value={f.tel} onChange={e => setF(s => ({ ...s, tel: e.target.value }))} placeholder="Filtrar por teléfono" />
          </div>
          <div>
            <label className={etiqueta} htmlFor="eq-puesto">Puesto</label>
            <select id="eq-puesto" className={campo} value={f.puesto} onChange={e => setF(s => ({ ...s, puesto: e.target.value }))}>
              <option value="">Todos</option>
              {roles.map(r => <option key={r.clave || r.nombre} value={r.nombre}>{r.nombre}</option>)}
            </select>
          </div>
        </div>
        {hayFiltros && (
          <div className="flex items-center justify-between gap-3 mt-3.5">
            <p className="text-[12px] text-mute tabular-nums">
              {filtrados.length} de {equipo.length}
            </p>
            <button onClick={() => setF({ q: '', correo: '', tel: '', puesto: '' })}
              className="h-9 px-4 rounded-full border border-edge text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      <div ref={ancla} className="bg-surface border border-edge rounded-2xl overflow-hidden scroll-mt-24">
        {filtrados.length === 0 ? (cargando ? <FilasEsqueleto filas={4} columnas={3} /> : (
          <EstadoVacio
            titulo={hayFiltros ? 'Nadie coincide con esos filtros' : 'Todavía no hay cuentas de equipo'}
            mensaje={hayFiltros
              ? 'Limpia los filtros de arriba para ver a todo el equipo.'
              : 'Cada persona que entra al panel necesita su propia cuenta con un puesto: así queda claro quién hizo qué.'}
            icono={<><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></>}
          />
        )) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-surface-2 border-b border-edge">
                  <th scope="col" className={`${th} w-full`}>Nombre</th>
                  <th scope="col" className={`${th} hidden md:table-cell w-px`}>Correo</th>
                  <th scope="col" className={`${th} hidden xl:table-cell w-px`}>Teléfono</th>
                  <th scope="col" className={`${th} hidden lg:table-cell w-px`}>Alta</th>
                  <th scope="col" className={`${th} hidden sm:table-cell w-px`}>Último acceso</th>
                  <th scope="col" className={`${th} text-right w-px`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {enPantalla.map(u => {
                  const rol = estiloRol(u)
                  const soyYo = u.id === yoId
                  return (
                    <tr key={u.id} className={`transition-colors hover:bg-surface-2 ${u.activo ? '' : 'opacity-55'}`}>
                      {/* max-w-0 es lo que permite que `truncate` funcione dentro de una tabla. */}
                      <td className={`${td} max-w-0`}>
                        <div className="flex items-center gap-3.5">
                          <Avatar u={u} size={40} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <button onClick={() => setViendo(u)} className="text-sm font-black text-ink truncate hover:text-gold-ink transition-colors">
                                {u.nombre}
                              </button>
                              {soyYo && <span className="shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-surface-2 text-mute">Tú</span>}
                              {!u.activo && <span className="shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">Sin acceso</span>}
                            </div>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${rol.cls}`}>{rol.label}</span>
                              {u.puesto && <span className="text-[12px] text-mute truncate">{u.puesto}</span>}
                            </div>
                            {/* En pantallas chicas la columna del correo se esconde: el dato baja aquí. */}
                            <p className="md:hidden text-[12px] text-mute truncate mt-1">{u.email || u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} hidden md:table-cell whitespace-nowrap`}>
                        <span className="text-[13.5px] text-ink">{u.email || <span className="text-mute">—</span>}</span>
                      </td>
                      {/* nowrap: con `w-px` la columna se encoge al mínimo y un
                          teléfono con espacios se partiría en varias líneas. */}
                      <td className={`${td} hidden xl:table-cell whitespace-nowrap`}>
                        <span className="text-[13.5px] text-ink font-mono">{u.telefono || <span className="text-mute font-sans">—</span>}</span>
                      </td>
                      <td className={`${td} hidden lg:table-cell whitespace-nowrap`}>
                        <span className="text-[13px] text-mute">{u.creado ? new Date(u.creado).toLocaleDateString('es-MX') : '—'}</span>
                      </td>
                      <td className={`${td} hidden sm:table-cell whitespace-nowrap`}>
                        <span className="text-[13px] text-mute">{hace(u.ultimo_acceso)}</span>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="inline-flex justify-end">
                          <MenuFila etiqueta="Acciones" opciones={[
                            { label: 'Ver', icono: IconoVer, onClick: () => setViendo(u) },
                            { label: 'Editar', icono: IconoEditar, onClick: () => setEditando(u) },
                            {
                              label: 'Asignar puesto', icono: IconoPuesto, onClick: () => setAsignando(u),
                              deshabilitado: u.es_superusuario, razon: 'El dueño no cambia de puesto',
                            },
                            { label: 'Cambiar contraseña', icono: IconoClave, onClick: () => passwordExpres(u) },
                            u.activo
                              ? {
                                label: 'Quitar acceso', icono: IconoQuitar, peligro: true,
                                onClick: () => quitarAcceso(u),
                                deshabilitado: soyYo, razon: 'No puedes quitarte tu propio acceso',
                              }
                              : { label: 'Devolver acceso', icono: IconoDevolver, onClick: () => devolverAcceso(u) },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <Paginador {...pagProps} nombre="cuentas" />
      </div>

      {(creando || editando) && (
        <UsuarioModal usuario={editando} roles={roles} soyYo={editando?.id === yoId}
          onClose={() => { setCreando(false); setEditando(null) }}
          onSaved={(msg, creado) => {
            notify(msg, 'ok'); setCreando(false); setEditando(null); reload()
            // Recién creada, la cuenta no entra al panel hasta que tenga puesto.
            // Se abre solo: si se dejara para después, quedaría una cuenta muda
            // que nadie sabe por qué no funciona.
            if (creado) setAsignando(creado)
          }}
          notify={notify} />
      )}

      {viendo && (
        <UsuarioDetalle u={viendo} soyYo={viendo.id === yoId}
          onClose={() => setViendo(null)}
          onEditar={() => { const u = viendo; setViendo(null); setEditando(u) }} />
      )}

      {asignando && (
        <AsignarRolModal u={asignando} roles={roles} notify={notify}
          onClose={() => setAsignando(null)} onSaved={reload} />
      )}
    </div>
  )
}
