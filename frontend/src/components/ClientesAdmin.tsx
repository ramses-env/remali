/**
 * Sección Clientes — el padrón del negocio.
 *
 * Va en archivo propio, y no dentro de Dashboard.tsx, a propósito: ese archivo
 * ya pasa de 9,900 líneas y meterle una sección más lo empeora para todos.
 *
 * Una diferencia con Empresas que importa: esta sección es de NIVEL 1. El
 * cajero y el asesor la ven, porque el mostrador es quien más necesita saber
 * quién es el cliente que tiene enfrente. Lo que sí queda restringido a
 * administración son los datos fiscales, que salen impresos en la factura.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { soloTelefono } from '../lib/utils'
import { KpiGrid } from './ui/kpi-grid'
import { REGIMEN_FISCAL, USO_CFDI } from '../lib/sat'
import type { Capacidades } from '../lib/acceso'
import ModalBase from './Modal'

const input =
  'w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)] ${className}`}>{children}</div>
}

export type ClienteFila = {
  id: number
  tipo: 'fisica' | 'moral'
  tipo_display: string
  nombre: string
  telefono: string
  email: string
  rfc: string
  activo: boolean
  requiere_revision: boolean
  revision_motivo: string
  contactos_total: number
  documentos_total: number
}

type ContactoFicha = {
  id: number
  nombre: string
  telefono: string
  email: string
  puesto: string
  principal: boolean
  tiene_cuenta: boolean
  cuenta_correo: string | null
}

type ObraFicha = { id: number; nombre: string; responsable: string; ubicacion: string; estado: string }

export type ClienteFicha = ClienteFila & {
  razon_social: string; regimen_fiscal: string; uso_cfdi: string; cp_fiscal: string; email_fiscal: string
  direccion: string; calle: string; numero_exterior: string; numero_interior: string
  colonia: string; municipio: string; ciudad: string; entidad: string; codigo_postal: string
  notas: string; creado: string
  contactos: ContactoFicha[]
  obras: ObraFicha[]
  tiene_cuenta: boolean
}

type DocumentoCuenta = {
  tipo: 'venta' | 'renta' | 'cotizacion' | 'reparacion'
  id: number; folio: string; fecha: string
  concepto: string; total: string; saldo: string; estado: string
}

type Cuenta = {
  saldo: string; credito_a_favor: string; neto: string
  tiene_adeudo: boolean; tiene_credito: boolean
  documentos: DocumentoCuenta[]
}

type Suelto = {
  id: number; nombre: string; telefono: string; email: string; creado: string
  pista: { id: number; nombre: string; documentos: number } | null
}

type Comprobante = {
  id: number; tipo: string; tipo_display: string; nota: string
  vence: string | null; vigente: boolean; subido_en: string; subido_por: string
  archivo?: string | null
}

const POR_PAGINA = 25

const pesos = (v: string | number) =>
  `$${Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`

const ETIQUETA_DOC: Record<DocumentoCuenta['tipo'], string> = {
  venta: 'Venta', renta: 'Renta', cotizacion: 'Cotización', reparacion: 'Reparación',
}

type Notify = (m: string, t?: 'ok' | 'err') => void

export default function ClientesAdmin({ puede, notify, reloadBadge }: {
  puede?: Capacidades
  notify: Notify
  reloadBadge?: () => void
}) {
  const [filas, setFilas] = useState<ClienteFila[]>([])
  const [total, setTotal] = useState(0)
  const [enRevision, setEnRevision] = useState(0)
  const [desde, setDesde] = useState(0)
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<'' | 'fisica' | 'moral'>('')
  const [soloRevision, setSoloRevision] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [ficha, setFicha] = useState<ClienteFicha | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [sueltos, setSueltos] = useState<Suelto[]>([])
  const [verBandeja, setVerBandeja] = useState(false)

  const puedeEditar = Boolean(puede?.editar_clientes)
  const puedeFiscales = (puede?.nivel ?? 0) >= 2

  const cargar = useCallback(() => {
    setCargando(true)
    const p = new URLSearchParams({ limite: String(POR_PAGINA), desde: String(desde) })
    if (q.trim()) p.set('q', q.trim())
    if (tipo) p.set('tipo', tipo)
    if (soloRevision) p.set('revision', '1')
    api.get(`/clientes/?${p}`)
      .then(r => {
        setFilas(r.data?.clientes || [])
        setTotal(r.data?.total || 0)
        setEnRevision(r.data?.en_revision || 0)
      })
      .catch(() => notify('No se pudo cargar el padrón', 'err'))
      .finally(() => setCargando(false))
  }, [q, tipo, soloRevision, desde, notify])

  // La búsqueda espera a que dejes de escribir: sin esto son seis consultas
  // mientras tecleas un teléfono.
  const primeraCarga = useRef(true)
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; cargar(); return }
    const t = setTimeout(cargar, 300)
    return () => clearTimeout(t)
  }, [cargar])

  // Cualquier filtro nuevo vuelve a la primera página: quedarse en la página 4
  // de un resultado que ahora tiene 2 renglones se ve como si no hubiera nada.
  useEffect(() => { setDesde(0) }, [q, tipo, soloRevision])

  const cargarSueltos = useCallback(() => {
    api.get<{ contactos: Suelto[] }>('/clientes/sin-vincular/')
      .then(r => setSueltos(r.data?.contactos || []))
      .catch(() => setSueltos([]))
  }, [])
  useEffect(() => { cargarSueltos() }, [cargarSueltos])

  function vincular(contactoId: number, clienteId: number) {
    api.post(`/clientes/${clienteId}/vincular/`, { contacto_id: contactoId })
      .then(() => { notify('Cuenta vinculada'); cargarSueltos(); cargar() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo vincular', 'err'))
  }

  function abrir(id: number) {
    api.get(`/clientes/${id}/`)
      .then(r => setFicha(r.data))
      .catch(() => notify('No se pudo abrir la ficha', 'err'))
  }

  function trasGuardar(msg: string) {
    notify(msg)
    setFormOpen(false)
    cargar()
    reloadBadge?.()
  }

  const pagina = Math.floor(desde / POR_PAGINA) + 1
  const paginas = Math.max(Math.ceil(total / POR_PAGINA), 1)

  return (
    <div className="space-y-5">
      <KpiGrid
        items={[
          { label: 'Clientes', value: String(total) },
          { label: 'Requieren revisión', value: String(enRevision), tone: enRevision ? 'danger' : 'default', emphasis: enRevision > 0 },
        ]}
      />

      {verBandeja && sueltos.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-edge">
            <h2 className="font-bold text-ink">Cuentas sin vincular <span className="text-mute font-normal">({sueltos.length})</span></h2>
            <p className="text-[13px] text-mute mt-0.5">
              Se registraron en la tienda y todavía no sabemos de quién son. El teléfono
              es una pista, no una decisión: tú vinculas.
            </p>
          </div>
          <ul className="divide-y divide-edge">
            {sueltos.map(s2 => (
              <li key={s2.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{s2.nombre}</p>
                  <p className="text-[12.5px] text-mute truncate">
                    {[s2.email, s2.telefono].filter(Boolean).join(' · ') || '—'}
                  </p>
                  {s2.pista && (
                    <p className="text-[12.5px] mt-1 text-ink">
                      Ese teléfono ya es de <b>{s2.pista.nombre}</b>
                      <span className="text-mute"> · {s2.pista.documentos} documentos</span>
                    </p>
                  )}
                </div>
                {puedeEditar && s2.pista && (
                  <button
                    onClick={() => vincular(s2.id, s2.pista!.id)}
                    className="shrink-0 btn-acento h-9 px-4 rounded-full text-[13px] font-black"
                  >
                    Vincular con {s2.pista.nombre}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-edge flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="font-bold text-ink shrink-0">
            Padrón <span className="text-mute font-normal">({total})</span>
          </h2>

          <div className="flex-1 flex flex-wrap items-center gap-2 sm:justify-end">
            <input
              className={`${input} sm:max-w-xs`}
              placeholder="Nombre, teléfono o RFC…"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Buscar en el padrón"
            />
            <select className={`${input} sm:w-auto`} value={tipo} onChange={e => setTipo(e.target.value as any)} aria-label="Tipo de cliente">
              <option value="">Todos</option>
              <option value="fisica">Personas</option>
              <option value="moral">Empresas</option>
            </select>
            <button
              onClick={() => setSoloRevision(v => !v)}
              className={`h-11 px-4 rounded-[10px] border text-[13px] font-bold transition-colors ${
                soloRevision ? 'border-gold/50 bg-gold-soft text-ink' : 'border-edge bg-surface-2 text-mute hover:text-ink'
              }`}
            >
              Revisión{enRevision ? ` · ${enRevision}` : ''}
            </button>
            {sueltos.length > 0 && (
              <button
                onClick={() => setVerBandeja(v => !v)}
                className={`h-11 px-4 rounded-[10px] border text-[13px] font-bold transition-colors ${
                  verBandeja ? 'border-gold/50 bg-gold-soft text-ink' : 'border-edge bg-surface-2 text-mute hover:text-ink'
                }`}
              >
                Cuentas nuevas · {sueltos.length}
              </button>
            )}
            {puedeEditar && (
              <button onClick={() => setFormOpen(true)} className="btn-acento h-11 px-5 rounded-full text-[13.5px] font-black">
                Nuevo cliente
              </button>
            )}
          </div>
        </div>

        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-mute">Cargando…</p>
        ) : filas.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-ink font-semibold mb-1">
              {q || tipo || soloRevision ? 'Nada con esos filtros' : 'Todavía no hay clientes'}
            </p>
            <p className="text-[13px] text-mute">
              {q || tipo || soloRevision
                ? 'Prueba con otro nombre o teléfono.'
                : 'Da de alta el primero, o deja que se vayan sumando conforme vendas.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-edge">
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Teléfono</th>
                  <th className="px-5 py-3 font-medium">Contactos</th>
                  <th className="px-5 py-3 font-medium">Documentos</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map(c => (
                  <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-surface-2/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <button onClick={() => abrir(c.id)} className="text-left group">
                        <span className="font-semibold text-ink group-hover:text-gold-ink transition-colors">{c.nombre}</span>
                        <span className="block text-[12px] text-mute">
                          {c.tipo_display}{c.rfc ? ` · ${c.rfc}` : ''}{c.activo === false ? ' · inactivo' : ''}
                        </span>
                      </button>
                      {c.requiere_revision && (
                        <span
                          title={c.revision_motivo}
                          className="inline-block mt-1 px-2 py-0.5 rounded-full bg-gold-soft text-[10.5px] font-bold uppercase tracking-wide text-ink"
                        >
                          Revisar
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-mute tabular-nums">{c.telefono || '—'}</td>
                    <td className="px-5 py-3.5 text-mute tabular-nums">{c.contactos_total}</td>
                    <td className="px-5 py-3.5 text-mute tabular-nums">{c.documentos_total}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => abrir(c.id)} className="text-[13px] font-bold text-mute hover:text-ink transition-colors">
                        Ver ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="px-5 py-3 border-t border-edge flex items-center justify-between text-[13px]">
            <span className="text-mute">Página {pagina} de {paginas}</span>
            <div className="flex gap-2">
              <button
                disabled={desde === 0}
                onClick={() => setDesde(d => Math.max(d - POR_PAGINA, 0))}
                className="h-9 px-4 rounded-[10px] border border-edge bg-surface-2 font-bold text-ink disabled:opacity-40 transition-colors"
              >Anterior</button>
              <button
                disabled={desde + POR_PAGINA >= total}
                onClick={() => setDesde(d => d + POR_PAGINA)}
                className="h-9 px-4 rounded-[10px] border border-edge bg-surface-2 font-bold text-ink disabled:opacity-40 transition-colors"
              >Siguiente</button>
            </div>
          </div>
        )}
      </Card>

      {formOpen && (
        <FormularioCliente
          puedeFiscales={puedeFiscales}
          notify={notify}
          onClose={() => setFormOpen(false)}
          onSaved={() => trasGuardar('Cliente dado de alta')}
        />
      )}

      {ficha && (
        <FichaCliente
          ficha={ficha}
          puedeEditar={puedeEditar}
          puedeFiscales={puedeFiscales}
          notify={notify}
          onClose={() => setFicha(null)}
          onChanged={() => { abrir(ficha.id); cargar() }}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   ALTA
   ════════════════════════════════════════ */
function FormularioCliente({ puedeFiscales, notify, onClose, onSaved }: {
  puedeFiscales: boolean; notify: Notify; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    tipo: 'moral' as 'fisica' | 'moral',
    nombre: '', telefono: '', email: '',
    razon_social: '', rfc: '', regimen_fiscal: '', uso_cfdi: '', cp_fiscal: '', email_fiscal: '',
    contacto_nombre: '', contacto_telefono: '', contacto_puesto: '',
    notas: '',
  })
  const [guardando, setGuardando] = useState(false)
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  function guardar() {
    if (!f.nombre.trim()) { notify('El cliente necesita un nombre', 'err'); return }
    setGuardando(true)
    const body: Record<string, unknown> = {
      tipo: f.tipo,
      nombre: f.nombre.trim(),
      telefono: f.telefono,
      email: f.email.trim(),
      notas: f.notas.trim(),
    }
    if (puedeFiscales) {
      Object.assign(body, {
        razon_social: f.razon_social.trim(), rfc: f.rfc.trim().toUpperCase(),
        regimen_fiscal: f.regimen_fiscal, uso_cfdi: f.uso_cfdi,
        cp_fiscal: f.cp_fiscal, email_fiscal: f.email_fiscal.trim(),
      })
    }
    if (f.contacto_nombre.trim()) {
      body.contacto = {
        nombre: f.contacto_nombre.trim(),
        telefono: f.contacto_telefono,
        puesto: f.contacto_puesto.trim(),
      }
    }
    api.post('/clientes/', body)
      .then(() => onSaved())
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo guardar', 'err'))
      .finally(() => setGuardando(false))
  }

  return (
    <Modal titulo="Nuevo cliente" onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <span className={label}>Tipo</span>
          <div className="flex gap-2">
            {([['moral', 'Empresa / constructora'], ['fisica', 'Persona']] as const).map(([v, t]) => (
              <button
                key={v}
                onClick={() => set('tipo', v)}
                className={`h-11 px-4 rounded-[10px] border text-[13px] font-bold transition-colors ${
                  f.tipo === v ? 'border-gold/50 bg-gold-soft text-ink' : 'border-edge bg-surface-2 text-mute hover:text-ink'
                }`}
              >{t}</button>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="cli-nombre">
            {f.tipo === 'moral' ? 'Nombre comercial' : 'Nombre completo'}
          </label>
          <input id="cli-nombre" className={input} value={f.nombre} onChange={e => set('nombre', e.target.value)}
                 placeholder={f.tipo === 'moral' ? 'Constructora del Bajío' : 'Jesús Ramírez'} />
        </div>

        <div>
          <label className={label} htmlFor="cli-tel">Teléfono</label>
          <input aria-label="Teléfono" id="cli-tel" className={input} value={f.telefono} inputMode="numeric"
                 onChange={e => set('telefono', soloTelefono(e.target.value))} placeholder="7441234567" />
        </div>
        <div>
          <label className={label} htmlFor="cli-email">Correo</label>
          <input aria-label="Correo" id="cli-email" className={input} type="email" value={f.email}
                 onChange={e => set('email', e.target.value)} />
        </div>

        {puedeFiscales && (
          <>
            <p className="sm:col-span-2 text-[11px] uppercase tracking-wide text-mute pt-2 border-t border-edge">
              Datos fiscales — opcionales, se pueden llenar después
            </p>
            <div>
              <label className={label} htmlFor="cli-razon">Razón social</label>
              <input aria-label="Razón social" id="cli-razon" className={input} value={f.razon_social} onChange={e => set('razon_social', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="cli-rfc">RFC</label>
              <input aria-label="RFC" id="cli-rfc" className={`${input} uppercase`} value={f.rfc} onChange={e => set('rfc', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="cli-regimen">Régimen fiscal</label>
              <select aria-label="Régimen fiscal" id="cli-regimen" className={input} value={f.regimen_fiscal} onChange={e => set('regimen_fiscal', e.target.value)}>
                <option value="">—</option>
                {REGIMEN_FISCAL.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="cli-uso">Uso del CFDI</label>
              <select aria-label="Uso del CFDI" id="cli-uso" className={input} value={f.uso_cfdi} onChange={e => set('uso_cfdi', e.target.value)}>
                <option value="">—</option>
                {USO_CFDI.map(u => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </div>
          </>
        )}

        <p className="sm:col-span-2 text-[11px] uppercase tracking-wide text-mute pt-2 border-t border-edge">
          Contacto principal — si lo dejas vacío se usa el nombre de arriba
        </p>
        <div>
          <label className={label} htmlFor="cli-cnombre">Nombre</label>
          <input aria-label="Nombre" id="cli-cnombre" className={input} value={f.contacto_nombre}
                 onChange={e => set('contacto_nombre', e.target.value)} placeholder="Laura Méndez" />
        </div>
        <div>
          <label className={label} htmlFor="cli-ctel">Teléfono</label>
          <input aria-label="Teléfono" id="cli-ctel" className={input} value={f.contacto_telefono} inputMode="numeric"
                 onChange={e => set('contacto_telefono', soloTelefono(e.target.value))} />
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="cli-notas">Notas</label>
          <textarea aria-label="Notas" id="cli-notas" className={input} rows={2} value={f.notas} onChange={e => set('notas', e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-5">
        <button onClick={onClose} className="h-11 px-5 rounded-[10px] border border-edge bg-surface-2 text-[13.5px] font-bold text-ink">
          Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-acento h-11 px-5 rounded-full text-[13.5px] font-black disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Dar de alta'}
        </button>
      </div>
    </Modal>
  )
}

/* ════════════════════════════════════════
   FICHA
   ════════════════════════════════════════ */
function FichaCliente({ ficha, puedeEditar, puedeFiscales, notify, onClose, onChanged }: {
  ficha: ClienteFicha; puedeEditar: boolean; puedeFiscales: boolean
  notify: Notify; onClose: () => void; onChanged: () => void
}) {
  const [nuevoContacto, setNuevoContacto] = useState(false)
  const [nc, setNc] = useState({ nombre: '', telefono: '', puesto: '' })
  const [cuenta, setCuenta] = useState<Cuenta | null>(null)
  const [docs, setDocs] = useState<Comprobante[]>([])

  useEffect(() => {
    api.get<Cuenta>(`/clientes/${ficha.id}/estado-cuenta/`)
      .then(r => setCuenta(r.data))
      .catch(() => setCuenta(null))
    api.get<{ documentos: Comprobante[] }>(`/clientes/${ficha.id}/documentos/`)
      .then(r => setDocs(r.data?.documentos || []))
      .catch(() => setDocs([]))
  }, [ficha.id])

  function agregarContacto() {
    if (!nc.nombre.trim()) { notify('El contacto necesita un nombre', 'err'); return }
    api.post(`/clientes/${ficha.id}/contactos/`, nc)
      .then(() => { notify('Contacto agregado'); setNuevoContacto(false); setNc({ nombre: '', telefono: '', puesto: '' }); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo agregar', 'err'))
  }

  function resolverRevision() {
    api.patch(`/clientes/${ficha.id}/`, { requiere_revision: false })
      .then(() => { notify('Marcado como revisado'); onChanged() })
      .catch(() => notify('No se pudo actualizar', 'err'))
  }

  return (
    <Modal titulo={ficha.nombre} onClose={onClose}>
      <p className="text-[13px] text-mute -mt-2 mb-4">
        {ficha.tipo_display}
        {ficha.rfc ? ` · ${ficha.rfc}` : ''}
        {ficha.telefono ? ` · ${ficha.telefono}` : ''}
      </p>

      {ficha.requiere_revision && (
        <div className="mb-5 p-4 rounded-xl bg-gold-soft border border-gold/30">
          <p className="text-[13px] font-bold text-ink mb-1">Requiere revisión</p>
          <p className="text-[13px] text-mute mb-3">{ficha.revision_motivo || 'Sin motivo registrado.'}</p>
          {puedeEditar && (
            <button onClick={resolverRevision} className="h-9 px-4 rounded-[10px] border border-edge bg-surface text-[13px] font-bold text-ink">
              Ya lo revisé
            </button>
          )}
        </div>
      )}

      {/* Estado de cuenta: es lo primero que se pregunta de un cliente */}
      {cuenta && (cuenta.tiene_adeudo || cuenta.tiene_credito) && (
        <section className="mb-6 rounded-xl border border-edge bg-surface-2 p-4">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-[10.5px] uppercase tracking-wide text-mute">Le debe a REMALI</dt>
              <dd className="text-lg font-black text-ink tabular-nums">{pesos(cuenta.saldo)}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase tracking-wide text-mute">REMALI le debe</dt>
              <dd className="text-lg font-black tabular-nums text-[color:var(--c-libre)]">{pesos(cuenta.credito_a_favor)}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase tracking-wide text-mute">Neto</dt>
              <dd className="text-lg font-black text-ink tabular-nums">{pesos(cuenta.neto)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Historial: la respuesta a "¿qué ha hecho este señor con nosotros?" */}
      {cuenta && cuenta.documentos.length > 0 && (
        <section className="mb-6">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-2">
            Historial ({cuenta.documentos.length})
          </h3>
          <ul className="divide-y divide-edge border border-edge rounded-xl overflow-hidden">
            {cuenta.documentos.map(d => (
              <li key={`${d.tipo}-${d.id}`} className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-surface-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink truncate">
                    <span className="text-mute font-normal">{ETIQUETA_DOC[d.tipo]}</span> {d.folio}
                  </p>
                  <p className="text-[12px] text-mute truncate">{d.concepto} · {d.estado}</p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {d.total && <p className="text-[13px] font-semibold text-ink">{pesos(d.total)}</p>}
                  {Number(d.saldo) > 0 && (
                    <p className="text-[12px] font-bold text-[color:var(--c-price)]">debe {pesos(d.saldo)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Contactos */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium">
            Contactos ({ficha.contactos.length})
          </h3>
          {puedeEditar && !nuevoContacto && (
            <button onClick={() => setNuevoContacto(true)} className="text-[13px] font-bold text-mute hover:text-ink transition-colors">
              + Agregar
            </button>
          )}
        </div>

        {ficha.contactos.length === 0 && <p className="text-[13px] text-mute">Sin contactos.</p>}
        <ul className="space-y-2">
          {ficha.contactos.map(c => (
            <li key={c.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-surface-2 border border-edge">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  {c.nombre}
                  {c.principal && <span className="ml-2 text-[10.5px] uppercase tracking-wide text-mute font-bold">principal</span>}
                </p>
                <p className="text-[12.5px] text-mute truncate">
                  {[c.puesto, c.telefono, c.email].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              {c.tiene_cuenta && (
                <span
                  title={c.cuenta_correo || ''}
                  className="shrink-0 px-2 py-0.5 rounded-full bg-gold-soft text-[10.5px] font-bold uppercase tracking-wide text-ink"
                >
                  Con cuenta
                </span>
              )}
            </li>
          ))}
        </ul>

        {nuevoContacto && (
          <div className="mt-3 p-3 rounded-xl border border-edge bg-surface-2 grid sm:grid-cols-3 gap-2">
            <input aria-label="Nombre" className={input} placeholder="Nombre" value={nc.nombre}
                   onChange={e => setNc(p => ({ ...p, nombre: e.target.value }))} />
            <input aria-label="Teléfono" className={input} placeholder="Teléfono" inputMode="numeric" value={nc.telefono}
                   onChange={e => setNc(p => ({ ...p, telefono: soloTelefono(e.target.value) }))} />
            <input aria-label="Puesto" className={input} placeholder="Puesto" value={nc.puesto}
                   onChange={e => setNc(p => ({ ...p, puesto: e.target.value }))} />
            <div className="sm:col-span-3 flex justify-end gap-2">
              <button onClick={() => setNuevoContacto(false)} className="h-9 px-4 rounded-[10px] border border-edge bg-surface text-[13px] font-bold text-ink">
                Cancelar
              </button>
              <button onClick={agregarContacto} className="btn-acento h-9 px-4 rounded-full text-[13px] font-black">
                Agregar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Obras */}
      <section className="mb-6">
        <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-2">
          Obras ({ficha.obras.length})
        </h3>
        {ficha.obras.length === 0 ? (
          <p className="text-[13px] text-mute">Sin obras registradas.</p>
        ) : (
          <ul className="space-y-2">
            {ficha.obras.map(o => (
              <li key={o.id} className="p-3 rounded-xl bg-surface-2 border border-edge">
                <p className="text-sm font-semibold text-ink">{o.nombre}</p>
                <p className="text-[12.5px] text-mute">
                  {[o.responsable, o.ubicacion].filter(Boolean).join(' · ') || '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Comprobantes: lo que hay que revisar ANTES de entregar una máquina cara */}
      <section className="mb-6">
        <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-2">
          Comprobantes ({docs.length})
        </h3>
        {docs.length === 0 ? (
          <p className="text-[13px] text-mute">
            Sin comprobantes. {puedeFiscales ? 'Súbelos desde el admin por ahora.' : ''}
          </p>
        ) : (
          <ul className="space-y-2">
            {docs.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-2 border border-edge">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{d.tipo_display}</p>
                  <p className="text-[12.5px] text-mute truncate">
                    {d.vence ? `Vence ${d.vence}` : 'No caduca'}
                    {d.nota ? ` · ${d.nota}` : ''}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {!d.vigente && (
                    <span className="px-2 py-0.5 rounded-full bg-[color:var(--c-price)]/10 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--c-price)]">
                      Vencido
                    </span>
                  )}
                  {/* La liga solo llega si quien mira es administración: adentro hay INEs. */}
                  {d.archivo && (
                    <a href={d.archivo} target="_blank" rel="noreferrer"
                       className="text-[13px] font-bold text-mute hover:text-ink transition-colors">
                      Abrir
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Fiscales: solo administración los ve completos */}
      {puedeFiscales && (
        <section className="mb-2">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-2">Datos fiscales</h3>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
            {([
              ['Razón social', ficha.razon_social],
              ['RFC', ficha.rfc],
              ['Régimen', ficha.regimen_fiscal],
              ['Uso CFDI', ficha.uso_cfdi],
              ['CP fiscal', ficha.cp_fiscal],
              ['Correo fiscal', ficha.email_fiscal],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-edge py-1">
                <dt className="text-mute">{k}</dt>
                <dd className="text-ink font-medium text-right truncate">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {ficha.notas && (
        <section className="pt-4 border-t border-edge">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-1">Notas</h3>
          <p className="text-[13px] text-ink whitespace-pre-line">{ficha.notas}</p>
        </section>
      )}
    </Modal>
  )
}

/* ─────────── Modal ─────────── */
/* Envoltura local: conserva la firma `<Modal titulo=… onClose=…>` que usan las
   pantallas de este archivo, pero el comportamiento (foco atrapado, Escape,
   scroll bloqueado, devolver el foco al abridor) lo pone la primitiva común.
   Antes esto tenía rol y Escape propios pero ni trampa de foco ni scroll lock,
   así que el Tab se escapaba al padrón de atrás. No cierra al tocar fuera: son
   formularios de alta y edición de clientes, y perderlos de un clic cuesta caro. */
function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <ModalBase
      onClose={onClose}
      label={titulo}
      cerrarAlTocarFuera={false}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
    >
      <div className="w-full max-w-2xl bg-surface border border-edge rounded-2xl shadow-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-black text-ink">{titulo}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-mute hover:text-ink text-2xl leading-none transition-colors">
            ×
          </button>
        </div>
        {children}
      </div>
    </ModalBase>
  )
}
