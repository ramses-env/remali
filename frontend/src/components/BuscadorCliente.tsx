/**
 * El buscador del mostrador: "¿Es Juan Pérez?"
 *
 * Se monta en venta de maquinaria, renta, cotización y caja. UN componente, no
 * cuatro: los tres puestos que atienden mostrador (cajero, asesor, técnico) ven
 * pantallas distintas, pero la pregunta que hacen es la misma.
 *
 * La regla que sostiene el diseño: **nunca se une por teléfono solo.** El
 * sistema sugiere; quien atiende confirma. Un dígito mal tecleado no debe
 * colgarle la compra a otro cliente.
 */
import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { soloTelefono } from '../lib/utils'

const input =
  'w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

export type ObraBreve = { id: number; nombre: string; ubicacion: string }

export type ClienteEncontrado = {
  id: number
  nombre: string
  tipo: 'fisica' | 'moral'
  tipo_display: string
  telefono: string
  rfc: string
  requiere_revision: boolean
  contactos: { id: number; nombre: string; telefono: string; principal: boolean; tiene_cuenta: boolean }[]
  obras: ObraBreve[]
  resumen: {
    compras: number; rentas_activas: number; rentas: number; cotizaciones: number; reparaciones: number
    saldo: string; credito_a_favor: string; tiene_adeudo: boolean; tiene_credito: boolean
  }
}

/** Lo que el formulario de arriba necesita saber. */
export type SeleccionCliente = {
  cliente: ClienteEncontrado | null
  /** Nombre y teléfono tecleados. Se mandan igual: son el respaldo legible
   *  del documento, y con ellos el backend crea la ficha si no había. */
  nombre: string
  telefono: string
}

export default function BuscadorCliente({ valor, onChange, autoFocus }: {
  valor: SeleccionCliente
  onChange: (v: SeleccionCliente) => void
  autoFocus?: boolean
}) {
  const [candidatos, setCandidatos] = useState<ClienteEncontrado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [descartado, setDescartado] = useState(false)
  const ultimaBusqueda = useRef('')

  const { cliente, nombre, telefono } = valor
  const set = (parcial: Partial<SeleccionCliente>) => onChange({ ...valor, ...parcial })

  // Se busca por TELÉFONO mientras se teclea, pero solo con 10 dígitos: con
  // menos, media lista coincide y el vendedor termina ignorando el aviso.
  useEffect(() => {
    if (cliente || descartado || telefono.length < 10) { setCandidatos([]); return }
    if (ultimaBusqueda.current === telefono) return

    const t = setTimeout(() => {
      ultimaBusqueda.current = telefono
      setBuscando(true)
      api.get<{ clientes: ClienteEncontrado[] }>(`/clientes/buscar/?telefono=${telefono}`)
        .then(r => setCandidatos(r.data?.clientes || []))
        .catch(() => setCandidatos([]))
        .finally(() => setBuscando(false))
    }, 350)
    return () => clearTimeout(t)
  }, [telefono, cliente, descartado])

  function elegir(c: ClienteEncontrado) {
    const principal = c.contactos.find(x => x.principal) || c.contactos[0]
    onChange({ cliente: c, nombre: principal?.nombre || c.nombre, telefono: c.telefono || telefono })
    setCandidatos([])
  }

  function soltar() {
    onChange({ cliente: null, nombre, telefono })
    setDescartado(false)
    ultimaBusqueda.current = ''
  }

  // ── Ya está elegido: se muestra a quién se le está vendiendo ──
  if (cliente) {
    const r = cliente.resumen
    return (
      <div className="rounded-xl border border-gold/40 bg-gold-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-ink truncate">{cliente.nombre}</p>
            <p className="text-[12.5px] text-mute">
              {cliente.tipo_display}
              {cliente.telefono ? ` · ${cliente.telefono}` : ''}
              {cliente.rfc ? ` · ${cliente.rfc}` : ''}
            </p>
            <p className="text-[12.5px] text-mute mt-1">{resumenTexto(r)}</p>
            <Dinero r={r} />
          </div>
          <button
            type="button"
            onClick={soltar}
            className="shrink-0 text-[13px] font-bold text-mute hover:text-ink transition-colors"
          >
            Cambiar
          </button>
        </div>
      </div>
    )
  }

  // ── Captura ──
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="bc-tel">Teléfono</label>
          <input
            id="bc-tel"
            className={input}
            inputMode="numeric"
            autoFocus={autoFocus}
            value={telefono}
            placeholder="10 dígitos"
            onChange={e => { setDescartado(false); set({ telefono: soloTelefono(e.target.value) }) }}
          />
        </div>
        <div>
          <label className={label} htmlFor="bc-nombre">Cliente</label>
          <input
            id="bc-nombre"
            className={input}
            value={nombre}
            placeholder="Nombre de quien compra"
            onChange={e => set({ nombre: e.target.value })}
          />
        </div>
      </div>

      {buscando && <p className="text-[12.5px] text-mute">Buscando…</p>}

      {candidatos.length > 0 && (
        <div className="rounded-xl border border-edge bg-surface-2 divide-y divide-edge">
          <p className="px-4 py-2 text-[11px] uppercase tracking-wide text-mute font-medium">
            {candidatos.length === 1 ? '¿Es este cliente?' : 'Ese número es de:'}
          </p>
          {candidatos.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{c.nombre}</p>
                <p className="text-[12.5px] text-mute">{resumenTexto(c.resumen)}</p>
                <Dinero r={c.resumen} />
              </div>
              <button
                type="button"
                onClick={() => elegir(c)}
                className="shrink-0 btn-acento h-9 px-4 rounded-full text-[13px] font-black"
              >
                Sí, es él
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setDescartado(true); setCandidatos([]) }}
            className="w-full px-4 py-2.5 text-[13px] font-bold text-mute hover:text-ink transition-colors"
          >
            No, es otro cliente
          </button>
        </div>
      )}

      {descartado && telefono.length === 10 && (
        <p className="text-[12.5px] text-mute">
          Se dará de alta como cliente nuevo. Quedará marcado para revisión, porque
          ese teléfono ya está en el padrón.
        </p>
      )}
    </div>
  )
}

/** El dinero va aparte del resumen y con peso visual propio: que el cliente
 *  deba es lo que puede cambiar la decisión de venderle, y no debe leerse como
 *  un dato más de la lista. */
function Dinero({ r }: { r: ClienteEncontrado['resumen'] }) {
  if (!r.tiene_adeudo && !r.tiene_credito) return null
  return (
    <p className="text-[12.5px] font-bold mt-1 flex flex-wrap gap-x-3">
      {r.tiene_adeudo && (
        <span className="text-[color:var(--c-price)]">Debe ${Number(r.saldo).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
      )}
      {r.tiene_credito && (
        <span className="text-[color:var(--c-libre)]">A favor ${Number(r.credito_a_favor).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
      )}
    </p>
  )
}

function resumenTexto(r: ClienteEncontrado['resumen']): string {
  const partes: string[] = []
  if (r.compras) partes.push(`${r.compras} compra${r.compras === 1 ? '' : 's'}`)
  if (r.rentas_activas) partes.push(`${r.rentas_activas} renta${r.rentas_activas === 1 ? '' : 's'} activa${r.rentas_activas === 1 ? '' : 's'}`)
  else if (r.rentas) partes.push(`${r.rentas} renta${r.rentas === 1 ? '' : 's'}`)
  if (r.reparaciones) partes.push(`${r.reparaciones} reparación${r.reparaciones === 1 ? '' : 'es'}`)
  return partes.length ? partes.join(' · ') : 'Sin movimientos todavía'
}

/** Lo que se manda al backend. Los tres campos viajan juntos siempre: el id
 *  identifica, y el texto queda como respaldo legible del documento. */
export function cuerpoCliente(v: SeleccionCliente) {
  return {
    cliente_id: v.cliente?.id || undefined,
    nombre_cliente: v.nombre.trim(),
    telefono_cliente: v.telefono,
  }
}

export const SELECCION_VACIA: SeleccionCliente = { cliente: null, nombre: '', telefono: '' }
