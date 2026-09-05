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
import { EstadoVacio, FilasEsqueleto } from '../routes/dashboard/comun'
import Paginador from './ui/paginador'
import { REGIMEN_FISCAL, USO_CFDI } from '../lib/sat'
import type { Capacidades } from '../lib/acceso'
import ModalBase from './Modal'
import { confirmar, pedir } from './Dialogo'

const input = 'campo'
const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

/** Copia local de la tarjeta de la casa (este módulo vive fuera de `dashboard/`).
 *  Acepta `ref` —React 19 lo pasa como una prop más— para que el pie de
 *  paginación pueda subir a la cabecera de la tabla al cambiar de página. */
function Card({ children, className = '', ref }: {
  children: React.ReactNode; className?: string; ref?: React.Ref<HTMLDivElement>
}) {
  return <div ref={ref} className={`bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)] ${className}`}>{children}</div>
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
  /** Cuántos de sus contactos entran a la tienda con su propia cuenta. */
  cuentas_total: number
  tiene_cuenta: boolean
}

type ContactoFicha = {
  id: number
  nombre: string
  telefono: string
  email: string
  puesto: string
  principal: boolean
  /* La cuenta de la tienda es un DATO de esta persona, no otra entidad ni otra
     pantalla: el mismo señor te renta con cuenta o sin ella, y el día que se
     registra no deja de ser el mismo cliente. */
  tiene_cuenta: boolean
  cuenta_correo: string | null
  cuenta_id: number | null
  cuenta_activa: boolean | null
  cuenta_verificada: boolean | null
  cuenta_ultimo_acceso: string | null
}

type ObraFicha = { id: number; nombre: string; responsable: string; ubicacion: string; estado: string }

export type ClienteFicha = ClienteFila & {
  razon_social: string; regimen_fiscal: string; uso_cfdi: string; cp_fiscal: string; email_fiscal: string
  direccion: string; calle: string; numero_exterior: string; numero_interior: string
  colonia: string; municipio: string; ciudad: string; entidad: string; codigo_postal: string
  notas: string; creado: string
  contactos: ContactoFicha[]
  obras: ObraFicha[]
}

type DocumentoCuenta = {
  tipo: 'venta' | 'renta' | 'cotizacion' | 'reparacion'
  id: number; folio: string; fecha: string
  concepto: string; total: string; saldo: string; estado: string
}

type Garantia = {
  id: number; descripcion: string; venta_id: number
  inicia: string; vence: string; meses: number
  vigente: boolean; anulada: boolean; anulada_motivo: string
  /** Negativo = venció hace tantos días. El signo dice si se hace válida. */
  dias_restantes: number
}

type Cuenta = {
  saldo: string; credito_a_favor: string; neto: string
  tiene_adeudo: boolean; tiene_credito: boolean
  documentos: DocumentoCuenta[]
  garantias: Garantia[]
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

import type { Notify } from '../store/toast'

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
  /** '' todos · '1' solo con cuenta · '0' solo los que nunca abrieron una. */
  const [conCuenta, setConCuenta] = useState<'' | '1' | '0'>('')
  const [cargando, setCargando] = useState(true)
  const [ficha, setFicha] = useState<ClienteFicha | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [sueltos, setSueltos] = useState<Suelto[]>([])
  const [verBandeja, setVerBandeja] = useState(false)
  /** La cuenta a la que se le está buscando dueño en el padrón. */
  const [vinculando, setVinculando] = useState<Suelto | null>(null)

  const puedeEditar = Boolean(puede?.editar_clientes)
  // Quitarle el acceso a alguien es del dueño, igual que en Equipo: la ficha lo
  // ofrece porque aquí es donde se ve a la persona, no porque sea otra regla.
  const puedeCuentas = Boolean(puede?.gestionar_usuarios)
  const puedeFiscales = (puede?.nivel ?? 0) >= 2
  // Fusionar mueve historial y saldos de una persona a otra y no se deshace
  // solo: el backend lo pide de nivel 2 (`EsAdministracion`) y aquí se respeta
  // el mismo corte, para no ofrecer un botón que va a rebotar con 403.
  const puedeFusionar = (puede?.nivel ?? 0) >= 2

  const cargar = useCallback(() => {
    setCargando(true)
    // `fondo`: el overlay de pantalla completa no debe taparle el padrón a nadie
    // por recargar una lista. Esta pantalla ya dice por su cuenta que está
    // trabajando (ver `refrescando` más abajo).
    const p = new URLSearchParams({ limite: String(POR_PAGINA), desde: String(desde) })
    if (q.trim()) p.set('q', q.trim())
    if (tipo) p.set('tipo', tipo)
    if (soloRevision) p.set('revision', '1')
    if (conCuenta) p.set('cuenta', conCuenta)
    api.get(`/clientes/?${p}`, { fondo: true })
      .then(r => {
        setFilas(r.data?.clientes || [])
        setTotal(r.data?.total || 0)
        setEnRevision(r.data?.en_revision || 0)
      })
      .catch(() => notify('No se pudo cargar el padrón', 'err'))
      .finally(() => setCargando(false))
  }, [q, tipo, soloRevision, conCuenta, desde, notify])

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
  useEffect(() => { setDesde(0) }, [q, tipo, soloRevision, conCuenta])

  const cargarSueltos = useCallback(() => {
    api.get<{ contactos: Suelto[] }>('/clientes/sin-vincular/', { fondo: true })
      .then(r => setSueltos(r.data?.contactos || []))
      .catch(() => setSueltos([]))
  }, [])
  useEffect(() => { cargarSueltos() }, [cargarSueltos])

  function vincular(contactoId: number, clienteId: number) {
    api.post(`/clientes/${clienteId}/vincular/`, { contacto_id: contactoId })
      .then(() => { notify('Cuenta vinculada', 'ok'); setVinculando(null); cargarSueltos(); cargar() })
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

  const ancla = useRef<HTMLDivElement | null>(null)
  /* PRIMERA carga contra RECARGA, que no se veían igual y se trataban igual.
     Antes, cualquier `cargar()` —teclear en el buscador, pasar de página,
     volver de dar de alta a alguien— cambiaba la tabla entera por un renglón
     que decía "Cargando…": la tarjeta se desplomaba de ochocientos píxeles a
     sesenta y volvía a crecer. Ese era el parpadeo.
     Ahora la tabla SE QUEDA mientras llega lo nuevo, apenas atenuada; el cartel
     de carga es solo para cuando todavía no hay nada que enseñar. */
  const primeraVez = cargando && filas.length === 0
  const refrescando = cargando && filas.length > 0
  const pagina = Math.floor(desde / POR_PAGINA) + 1
  const paginas = Math.max(Math.ceil(total / POR_PAGINA), 1)

  return (
    <div className="space-y-5">
      <KpiGrid
        items={[
          { label: 'Clientes', value: total, helper: 'en el padrón, con cuenta o sin ella', icon: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></> },
          {
            label: 'Por revisar', value: enRevision,
            tone: enRevision ? 'danger' : 'default', emphasis: enRevision > 0,
            helper: enRevision ? 'datos incompletos o duplicados' : 'ninguno con pendientes',
            icon: <><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4m0 4h.01" /></>,
          },
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
                {/* La pista es el ATAJO, no el único camino. Antes el botón
                    existía solo cuando el teléfono de la cuenta ya estaba en el
                    padrón: una cuenta registrada con puro correo —que son la
                    mayoría— se quedaba sin nada que tocar, contradiciendo el
                    "tú vinculas" del encabezado. */}
                {puedeEditar && (
                  <div className="shrink-0 flex flex-wrap items-center gap-2">
                    {s2.pista && (
                      <button
                        onClick={() => vincular(s2.id, s2.pista!.id)}
                        className="btn-acento h-9 px-4 rounded-full text-[13px] font-black"
                      >
                        Vincular con {s2.pista.nombre}
                      </button>
                    )}
                    <button
                      onClick={() => setVinculando(s2)}
                      className="h-9 px-4 rounded-full border border-edge text-[13px] font-bold text-ink hover:bg-surface-2 transition-colors"
                    >
                      {s2.pista ? 'Otro cliente…' : 'Vincular con…'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card ref={ancla} className="overflow-hidden scroll-mt-24">
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
            {/* Tres estados en un botón, no dos: "todos" es el normal, y
                querer ver SOLO los que nunca abrieron cuenta es tan útil como
                ver solo los que sí —son a los que hay que llamarles—. */}
            <button
              onClick={() => setConCuenta(v => (v === '' ? '1' : v === '1' ? '0' : ''))}
              className={`h-11 px-4 rounded-[10px] border text-[13px] font-bold transition-colors ${
                conCuenta ? 'border-gold/50 bg-gold-soft text-ink' : 'border-edge bg-surface-2 text-mute hover:text-ink'
              }`}
            >
              {conCuenta === '1' ? 'Con cuenta' : conCuenta === '0' ? 'Sin cuenta' : 'Cuenta: todos'}
            </button>
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

        {primeraVez ? (
          <FilasEsqueleto filas={5} columnas={3} />
        ) : filas.length === 0 ? (
          <EstadoVacio
            titulo={q || tipo || soloRevision || conCuenta ? 'Nada con esos filtros' : 'Todavía no hay clientes'}
            mensaje={q || tipo || soloRevision || conCuenta
              ? 'Prueba con otro nombre o teléfono.'
              : 'Da de alta el primero, o deja que se vayan sumando conforme vendas.'}
            icono={<><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.6-5.2" /></>}
          />
        ) : (
          // Atenuada, no ausente: se nota que está trabajando y la tabla no se
          // mueve un pixel. `aria-busy` lo dice para quien no ve la opacidad.
          <div className={`overflow-x-auto transition-opacity duration-150 ${refrescando ? 'opacity-55' : ''}`}
            aria-busy={refrescando}>
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
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 empty:mt-0">
                        {/* Se marca al que SÍ tiene cuenta y no al que no: los
                            que nunca abrieron una son la mayoría del padrón, y
                            ponerle una etiqueta a cada renglón sería ruido. */}
                        {c.tiene_cuenta && (
                          <span
                            title={c.cuentas_total > 1
                              ? `${c.cuentas_total} de sus contactos entran a la tienda con su cuenta`
                              : 'Entra a la tienda con su cuenta'}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-2 border border-edge text-[10.5px] font-bold uppercase tracking-wide text-mute"
                          >
                            <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
                            </svg>
                            Con cuenta{c.cuentas_total > 1 ? ` · ${c.cuentas_total}` : ''}
                          </span>
                        )}
                        {c.requiere_revision && (
                          <span
                            title={c.revision_motivo}
                            className="inline-block px-2 py-0.5 rounded-full bg-gold-soft text-[10.5px] font-bold uppercase tracking-wide text-ink"
                          >
                            Revisar
                          </span>
                        )}
                      </div>
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

        {/* El padrón lo pagina el SERVIDOR (`desde`/`limite`): el pie dice en qué
            página va y traduce el número de página al corrimiento. */}
        <Paginador pagina={pagina} paginas={paginas} total={total} porPagina={POR_PAGINA}
          onIr={n => setDesde((n - 1) * POR_PAGINA)} ancla={ancla} cargando={cargando}
          nombre="clientes" />
      </Card>

      {formOpen && (
        <FormularioCliente
          puedeFiscales={puedeFiscales}
          notify={notify}
          onClose={() => setFormOpen(false)}
          onSaved={() => trasGuardar('Cliente dado de alta')}
        />
      )}

      {vinculando && (
        <ElegirCliente
          titulo={`¿De quién es la cuenta de ${vinculando.nombre}?`}
          ayuda="Elige el cliente del padrón al que pertenece. Desde ese momento verá el historial completo de ese cliente al entrar a la tienda."
          notify={notify}
          onElegir={c => vincular(vinculando.id, c.id)}
          onClose={() => setVinculando(null)}
        />
      )}

      {ficha && (
        <FichaCliente
          ficha={ficha}
          puedeEditar={puedeEditar}
          puedeFiscales={puedeFiscales}
          puedeFusionar={puedeFusionar}
          puedeCuentas={puedeCuentas}
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
          <textarea aria-label="Notas" id="cli-notas" className={`${input} campo-area`} rows={2} value={f.notas} onChange={e => set('notas', e.target.value)} />
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
function FichaCliente({ ficha, puedeEditar, puedeFiscales, puedeFusionar, puedeCuentas, notify, onClose, onChanged }: {
  ficha: ClienteFicha; puedeEditar: boolean; puedeFiscales: boolean; puedeFusionar: boolean; puedeCuentas: boolean
  notify: Notify; onClose: () => void; onChanged: () => void
}) {
  const [nuevoContacto, setNuevoContacto] = useState(false)
  const [nc, setNc] = useState({ nombre: '', telefono: '', puesto: '' })
  const [fusionando, setFusionando] = useState(false)

  /** Trae la ficha duplicada AQUÍ: la abierta es la que sobrevive.
   *
   *  Se pregunta dos veces a propósito. La primera confirma qué se mueve y qué
   *  le pasa al origen; la segunda pide el motivo, que se escribe en las notas
   *  de las DOS fichas junto con quién y cuándo. Una fusión mal hecha no se
   *  deshace sola, y sin ese renglón nadie puede reconstruir qué pasó. */
  async function fundirAqui(origen: ClienteFila) {
    const ok = await confirmar({
      titulo: `Fundir "${origen.nombre}" en ${ficha.nombre}`,
      mensaje: `Sus ventas, rentas, cotizaciones, reparaciones, obras y contactos pasan a esta ficha. "${origen.nombre}" se desactiva —no se borra— y deja de aparecer en el padrón.`,
      aceptar: 'Fundir aquí', tono: 'peligro',
    })
    if (!ok) return
    const motivo = await pedir({
      titulo: '¿Por qué se funden?',
      mensaje: 'Queda escrito en las notas de las dos fichas, con tu nombre y la fecha.',
      placeholder: 'Ej. Se dio de alta dos veces',
    })
    if (motivo === null) return
    api.post(`/clientes/${ficha.id}/fusionar/`, { origen_id: origen.id, motivo: motivo.trim() })
      .then(() => { notify(`"${origen.nombre}" se fundió aquí`, 'ok'); setFusionando(false); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo fusionar', 'err'))
  }

  /** Quitarle o devolverle el acceso a la cuenta de este contacto.
   *
   * Es la MISMA API que usa Equipo (`/usuarios/<id>/`), porque es la misma
   * cuenta: lo único que cambia es desde dónde se mira. Y no se borra, se
   * desactiva —igual que en todo el sistema—, porque su historial de compras y
   * rentas tiene que seguir en pie aunque ya no entre. */
  async function cambiarAcceso(c: ContactoFicha) {
    if (!c.cuenta_id) return
    const devolver = c.cuenta_activa === false
    if (!devolver) {
      const ok = await confirmar({
        titulo: `Quitarle el acceso a ${c.nombre}`,
        mensaje: 'Dejará de poder entrar a la tienda con su cuenta. Su historial de compras y rentas se conserva completo.',
        aceptar: 'Quitar acceso', tono: 'peligro',
      })
      if (!ok) return
    }
    const peticion = devolver
      ? api.patch(`/usuarios/${c.cuenta_id}/`, { activo: true })
      : api.delete(`/usuarios/${c.cuenta_id}/`)
    peticion
      .then(() => { notify(devolver ? `${c.nombre} puede entrar de nuevo` : `${c.nombre} ya no puede entrar`, devolver ? 'ok' : 'warning'); onChanged() })
      .catch(err => notify(err?.response?.data?.detalle || 'No se pudo cambiar el acceso', 'err'))
  }
  const [cuenta, setCuenta] = useState<Cuenta | null>(null)
  /** Qué tipo de movimiento se está mirando. '' = todos. */
  const [tipoDoc, setTipoDoc] = useState<'' | DocumentoCuenta['tipo']>('')
  const docsVisibles = (cuenta?.documentos || []).filter(d => !tipoDoc || d.tipo === tipoDoc)
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

      {/* Estado de cuenta: es lo primero que se pregunta de un cliente.
          Se muestra SIEMPRE, también en ceros. Antes solo salía con adeudo o
          crédito, y "no hay tarjeta" se lee como "no se ha calculado": quien
          va a entregar una máquina cara necesita ver el cero, no la ausencia
          de un número. */}
      {cuenta && (
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

      {/* GARANTÍAS. Van antes del historial y aparte de él: no son un documento
          —no tienen folio, total ni saldo— sino una fecha límite, y contestan la
          pregunta que llega al mostrador con la máquina en la mano: "se me
          descompuso, ¿todavía tengo garantía?". Se enseñan también las vencidas,
          porque "venció hace cuatro meses" contesta igual de bien. */}
      {cuenta && cuenta.garantias?.length > 0 && (
        <section className="mb-6">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-2">
            Garantías ({cuenta.garantias.filter(g => g.vigente).length} vigente{cuenta.garantias.filter(g => g.vigente).length === 1 ? '' : 's'} de {cuenta.garantias.length})
          </h3>
          <ul className="space-y-2">
            {cuenta.garantias.map(g => (
              <li key={g.id} className={`flex items-start justify-between gap-3 p-3 rounded-xl border ${
                g.vigente
                  ? 'border-[color-mix(in_oklab,var(--c-libre)_34%,transparent)] bg-[color-mix(in_oklab,var(--c-libre)_7%,transparent)]'
                  : 'border-edge bg-surface-2'}`}>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink truncate">{g.descripcion}</p>
                  <p className="text-[12px] text-mute truncate">
                    {g.meses} mes{g.meses === 1 ? '' : 'es'} · venta {g.venta_id ? `#${g.venta_id}` : '—'}
                    {g.anulada && g.anulada_motivo ? ` · anulada: ${g.anulada_motivo}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {/* El número que decide: si es válida y por cuánto tiempo. */}
                  <p className={`text-[13px] font-bold tabular-nums ${g.vigente ? 'text-[color:var(--c-libre)]' : 'text-mute'}`}>
                    {g.anulada ? 'Anulada'
                      : g.vigente ? `${g.dias_restantes} día${g.dias_restantes === 1 ? '' : 's'}`
                        : `venció hace ${Math.abs(g.dias_restantes)} d`}
                  </p>
                  <p className="text-[11.5px] text-mute tabular-nums">{g.vence}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Historial: la respuesta a "¿qué ha hecho este señor con nosotros?" */}
      {cuenta && cuenta.documentos.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium">
              Movimientos ({docsVisibles.length}{tipoDoc ? ` de ${cuenta.documentos.length}` : ''})
            </h3>
          </div>
          {/* Filtrar por tipo: con un cliente de cuarenta movimientos, "¿qué me
              ha rentado?" no se contesta leyendo una tira mezclada. Solo salen
              los tipos que ESTE cliente tiene: ofrecer "Reparaciones (0)" es
              hacerle tocar un filtro que no lleva a ningún lado. */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mb-2.5">
            {([['', 'Todos'], ...(['renta', 'venta', 'cotizacion', 'reparacion'] as const)
              .filter(t => cuenta.documentos.some(d => d.tipo === t))
              .map(t => [t, ETIQUETA_DOC[t]] as const)] as const).map(([k, etiqueta]) => {
              const n = k ? cuenta.documentos.filter(d => d.tipo === k).length : cuenta.documentos.length
              const activo = tipoDoc === k
              return (
                <button key={k || 'todos'} onClick={() => setTipoDoc(k as typeof tipoDoc)} aria-pressed={activo}
                  className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-bold whitespace-nowrap border transition-colors ${
                    activo ? 'bg-ink text-app border-transparent'
                      : 'bg-surface-2 text-mute border-edge hover:text-ink'}`}>
                  {etiqueta}<span className="tabular-nums text-[11px] opacity-70">{n}</span>
                </button>
              )
            })}
          </div>
          <ul className="divide-y divide-edge border border-edge rounded-xl overflow-hidden">
            {docsVisibles.map(d => (
              <li key={`${d.tipo}-${d.id}`} className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-surface-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink truncate">
                    <span className="text-mute font-normal">{ETIQUETA_DOC[d.tipo]}</span> {d.folio}
                  </p>
                  {/* La FECHA es la mitad de la respuesta: "me rentó una
                      revolvedora" sin saber si fue el mes pasado o hace tres
                      años no dice nada del cliente. */}
                  <p className="text-[12px] text-mute truncate">
                    {d.fecha ? new Date(d.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} · {d.concepto} · {d.estado}
                  </p>
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
                {c.tiene_cuenta && (
                  <p className="text-[11.5px] text-mute mt-1 truncate">
                    Entra con <span className="text-ink">{c.cuenta_correo}</span>
                    {c.cuenta_ultimo_acceso
                      ? <> · última vez {new Date(c.cuenta_ultimo_acceso).toLocaleDateString('es-MX')}</>
                      : <> · nunca ha entrado</>}
                  </p>
                )}
              </div>
              {c.tiene_cuenta && (
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {/* Tres estados distintos, no uno: "tiene cuenta" a secas
                      mentiría sobre quien no ha confirmado su correo —no puede
                      iniciar sesión— o sobre quien ya no tiene acceso. */}
                  {c.cuenta_activa === false ? (
                    <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-[10.5px] font-bold uppercase tracking-wide text-red-500">Sin acceso</span>
                  ) : c.cuenta_verificada === false ? (
                    <span title="Todavía no abre el correo de confirmación: no puede iniciar sesión"
                      className="px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/5 text-[10.5px] font-bold uppercase tracking-wide text-taller-ink">Sin verificar</span>
                  ) : (
                    <span title={c.cuenta_correo || ''}
                      className="px-2 py-0.5 rounded-full bg-gold-soft text-[10.5px] font-bold uppercase tracking-wide text-ink">Con cuenta</span>
                  )}
                  {puedeCuentas && c.cuenta_id && (
                    <button onClick={() => cambiarAcceso(c)}
                      className="text-[11.5px] font-semibold text-mute hover:text-ink transition-colors">
                      {c.cuenta_activa === false ? 'Devolver acceso' : 'Quitar acceso'}
                    </button>
                  )}
                </div>
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

      {/* Duplicados. Va al FINAL y sin color de alarma: no es una acción del
          día a día, es la que se busca el día que alguien nota que el mismo
          señor está dos veces en el padrón. */}
      {puedeFusionar && (
        <section className="pt-4 mt-2 border-t border-edge flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold text-ink">¿Está duplicado?</h3>
            <p className="text-[12.5px] text-mute">
              Trae la otra ficha aquí: su historial se suma a esta y aquella se desactiva.
            </p>
          </div>
          <button onClick={() => setFusionando(true)}
            className="shrink-0 h-10 px-5 rounded-full border border-edge text-[13px] font-bold text-ink hover:bg-surface-2 transition-colors">
            Fusionar una ficha duplicada
          </button>
        </section>
      )}

      {ficha.notas && (
        <section className="pt-4 border-t border-edge">
          <h3 className="text-[11px] uppercase tracking-wide text-mute font-medium mb-1">Notas</h3>
          <p className="text-[13px] text-ink whitespace-pre-line">{ficha.notas}</p>
        </section>
      )}

      {fusionando && (
        <ElegirCliente
          titulo="¿Cuál es la ficha duplicada?"
          ayuda={`Lo que elijas se funde en ${ficha.nombre} y deja de aparecer en el padrón. Esta ficha es la que sobrevive.`}
          excluir={ficha.id}
          notify={notify}
          onElegir={fundirAqui}
          onClose={() => setFusionando(false)}
        />
      )}
    </Modal>
  )
}

/* ════════════════════════════════════════
   ELEGIR UN CLIENTE DEL PADRÓN
   ════════════════════════════════════════ */
/* El buscador del mostrador (`BuscadorCliente`) no sirve para esto: busca por
   TELÉFONO de 10 dígitos, porque allá el vendedor tiene el número a la mano.
   Las dos decisiones que abren este modal —de quién es esta cuenta, cuál ficha
   es la duplicada— se toman por NOMBRE, y muchas veces la cuenta ni teléfono
   trae. Aquí se pregunta al mismo endpoint del padrón, que ya busca por nombre,
   razón social, RFC y nombre de contacto. */
function ElegirCliente({ titulo, ayuda, excluir, notify, onElegir, onClose }: {
  titulo: string; ayuda: string
  /** La ficha desde la que se abrió: no tiene caso ofrecerla contra sí misma. */
  excluir?: number
  notify: Notify; onElegir: (c: ClienteFila) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [filas, setFilas] = useState<ClienteFila[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    // Sin teclear se muestran los primeros del padrón: con dos clientes dados de
    // alta, obligar a escribir para ver una lista de dos es puro trámite.
    const t = setTimeout(() => {
      setCargando(true)
      const p = new URLSearchParams({ limite: '8', desde: '0' })
      if (q.trim()) p.set('q', q.trim())
      api.get<{ clientes: ClienteFila[] }>(`/clientes/?${p}`, { fondo: true })
        // Fuera las desactivadas: una ficha inactiva casi siempre es el
        // residuo de una fusión anterior, y ni se le vincula una cuenta ni se
        // vuelve a fundir. El padrón sí las lista (marcadas "inactivo") porque
        // allá sirven de rastro; aquí solo estorban.
        .then(r => setFilas((r.data?.clientes || [])
          .filter(c => c.id !== excluir && c.activo !== false)))
        .catch(() => { setFilas([]); notify('No se pudo buscar en el padrón', 'err') })
        .finally(() => setCargando(false))
    }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, excluir, notify])

  return (
    <Modal titulo={titulo} onClose={onClose}>
      <p className="text-[13px] text-mute -mt-2 mb-4">{ayuda}</p>
      <input className={input} autoFocus value={q} onChange={e => setQ(e.target.value)}
        placeholder="Nombre, teléfono o RFC…" aria-label="Buscar cliente en el padrón" />

      {cargando ? (
        <p className="py-8 text-center text-[13px] text-mute">Buscando…</p>
      ) : filas.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-mute">
          {q.trim() ? 'Ningún cliente con ese nombre.' : 'El padrón está vacío.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-edge border border-edge rounded-xl overflow-hidden">
          {filas.map(c => (
            <li key={c.id}>
              <button onClick={() => onElegir(c)}
                className="w-full text-left px-4 py-3 bg-surface-2 hover:bg-surface transition-colors flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{c.nombre}</span>
                  <span className="block text-[12.5px] text-mute truncate">
                    {[c.tipo_display, c.telefono, c.rfc].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-mute tabular-nums">
                  {c.documentos_total} doc.
                </span>
              </button>
            </li>
          ))}
        </ul>
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
