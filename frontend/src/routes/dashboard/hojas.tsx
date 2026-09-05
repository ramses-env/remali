/**
 * Las HOJAS: rentar, vender y levantar un pedido/apartado.
 *
 * Viven aparte porque las abren desde varios lados (el inventario, la caja, una
 * cotizacion que se convierte). Una sola hoja de cada cosa en todo el panel:
 * asi el IVA, el deposito y el padron se comportan igual entren por donde
 * entren.
 */
import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { formatMoney, soloTelefono } from '../../lib/utils'
import { confirmar, } from '../../components/Dialogo'
import BuscadorCliente, { SELECCION_VACIA, type SeleccionCliente } from '../../components/BuscadorCliente'
import { useConfigPublica } from '../../lib/configPublica'
import { motion } from 'framer-motion'
import { type Notify } from '../../store/toast'
import {
  type Empresa, type Equipo, FACTURA_VACIA, type FacturaData, FacturaFields,
  InputDinero, type Unidad, abrirOrdenCartaPDF, fijarCotEnCurso, fijarVentaAAbrir,
  input, label, leerCotEnCursoPara, num, progresoCot, type RentaFull, Segmentado,
  siguientePaso, errorMsg, validarFactura,
} from './comun'
import { anotarFallo } from '../../lib/fallo'
import AddressAutocomplete from '../../components/AddressAutocomplete'

/* ── Registrar renta ── */
export function RentModal({ unit, equipo, onClose, onDone, notify, desdeCaja = false }: {
  unit: Unidad; equipo: Equipo; onClose: () => void; onDone: () => void; notify: Notify
  /** Levantada/vendida desde la caja: el cobro entra al turno del mostrador. */
  desdeCaja?: boolean
}) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [sel, setSel] = useState<SeleccionCliente>(SELECCION_VACIA)
  const [direccion, setDireccion] = useState('')
  const [modalidad, setModalidad] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [duracion, setDuracion] = useState('1')
  const [fechaInicio, setFechaInicio] = useState(hoy)
  /* Hora ESTIMADA de entrega, opcional. La renta solo guardaba el día, así que
     el cliente veía "del 20 al 22 ago" y nada más; su agenda anclaba todo al
     mediodía porque no había hora que mostrar. Vacía, todo queda como antes. */
  const [horaEntrega, setHoraEntrega] = useState('')
  const [descuento, setDescuento] = useState('')
  const [deposito, setDeposito] = useState('')
  const [obraId, setObraId] = useState('')
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [clientes, setClientes] = useState<{ id: number; nombre: string; empresa?: string }[]>([])
  const [usuarioId, setUsuarioId] = useState('')
  // ¿Venimos de "Concretar renta" de una cotización? Precarga y liga. Solo el
  // puente de renta: si trae una venta en curso, esta hoja no es la suya.
  const [deCot, setDeCot] = useState(leerCotEnCursoPara('renta'))
  // Cobro inicial de la renta: un método, o pago dividido en dos (efectivo + tarjeta…).
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [splitPago, setSplitPago] = useState(false)
  const [metodo2, setMetodo2] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('tarjeta')
  const [monto1, setMonto1] = useState('')
  const [monto2, setMonto2] = useState('')
  /* Cuánto DEJA hoy. Una renta no se paga siempre de golpe: la máquina sale a la
     obra con un anticipo (o sin nada) y el cliente abona durante el periodo. Lo
     que no se cobre aquí nace como saldo —Adeudos para el mostrador, "Mis
     adeudos" para el cliente— en vez de darse por cobrado, que es lo que pasaba
     antes: toda renta nacía liquidada y la cobranza no existía. */
  const [cobra, setCobra] = useState('')
  // Arranca en blanco a propósito. Antes se precargaba con el total y había que
  // BORRARLO cuando el cliente no pagaba completo, así que casi ninguna renta se
  // corregía y todas nacían liquidadas. Ahora el total se llena con un clic
  // ("Pagó todo"), y a partir de ahí sigue al total si cambia la duración.
  const [cobraSigueTotal, setCobraSigueTotal] = useState(false)
  const [busy, setBusy] = useState(false)

  // "Sucio" = el operador ya invirtió trabajo aquí. Los valores que nacen con
  // contenido (fecha de hoy, duración 1, método efectivo) no cuentan.
  const sucio = Boolean(
    sel.nombre.trim() || sel.telefono.trim() || sel.cliente || direccion.trim() ||
    descuento.trim() || deposito.trim() || obraId || usuarioId || requiereFactura ||
    duracion !== '1' || modalidad !== 'dia' || splitPago || monto1.trim() || monto2.trim() ||
    cobra.trim(),
  )

  /* Cerrar con un clic afuera borraba catorce campos sin preguntar, y esto se
     llena con el cliente enfrente. Solo estorba si de verdad hay algo escrito:
     una hoja intacta se cierra de inmediato, como antes. */
  async function cerrarConAviso() {
    if (!sucio) { onClose(); return }
    if (await confirmar({
      titulo: '¿Descartar lo que llevas?',
      mensaje: 'Cerraste la hoja sin registrar. Lo capturado se pierde.',
      aceptar: 'Descartar', cancelar: 'Seguir aquí', tono: 'peligro',
    })) onClose()
  }

  useEffect(() => {
    // Cuentas de cliente, para vincular la renta a su panel ("Tus rentas").
    api.get<{ clientes: { id: number; nombre: string; empresa?: string }[] }>('/clientes-lookup/').then(r => setClientes(r.data.clientes || [])).catch(anotarFallo)
    // Datos de la cotización que se está concretando (si aplica).
    const puente = leerCotEnCursoPara('renta')
    if (puente) {
      // La cotización trae nombre y teléfono como TEXTO: se precargan en el
      // buscador para que el vendedor confirme de quién se trata, no se dan
      // por buenos sin más.
      if (puente.cliente || puente.telefono) {
        setSel(v => ({ ...v, nombre: puente.cliente || v.nombre, telefono: soloTelefono(puente.telefono || v.telefono) }))
      }
      if (puente.direccion) setDireccion(puente.direccion)
      if (puente.usuario_id) setUsuarioId(String(puente.usuario_id))
      if (puente.modalidad) setModalidad(puente.modalidad)
      if (puente.duracion) setDuracion(String(puente.duracion))
    }
  }, [])
  useEffect(() => {
    /* las obras llegan con el cliente que devuelve el buscador */
  }, [])

  function elegirCliente(v: SeleccionCliente) {
    setSel(v)
    if (!v.cliente) { setObraId(''); return }
    // Con una sola obra se propone sola: es lo que pasa casi siempre y
    // ahorra un clic con el cliente enfrente.
    const unica = v.cliente.obras.length === 1 ? v.cliente.obras[0] : null
    setObraId(unica ? String(unica.id) : '')
    if (unica?.ubicacion) setDireccion(unica.ubicacion)
  }
  // Al elegir obra: la dirección de la renta es la de esa obra.
  function elegirObra(id: string) {
    setObraId(id)
    const o = sel.cliente?.obras.find(ob => String(ob.id) === id)
    if (o?.ubicacion) setDireccion(o.ubicacion)
  }

  const precio = modalidad === 'dia' ? equipo.precio_dia : modalidad === 'semana' ? equipo.precio_semana : equipo.precio_mes
  const total = Math.max(0, (Number(precio) || 0) * (Number(duracion) || 1) - (Number(descuento) || 0))
  const ivaRenta = requiereFactura ? Math.round(total * 0.16 * 100) / 100 : 0
  const totalConIva = total + ivaRenta
  const esReserva = fechaInicio > hoy
  // Lo cobrado hoy no se propone: se captura. Vacío = el cliente no dejó nada y
  // la máquina sale igual, debiendo. Solo cuando marcaron "Pagó todo" el monto
  // persigue al total, para que cambiar la duración después no deje un cobro
  // viejo fabricando un saldo que nadie pidió.
  const recibido = Number(cobra) || 0
  const saldoRenta = Math.max(0, Math.round((totalConIva - recibido) * 100) / 100)
  useEffect(() => {
    if (cobraSigueTotal) setCobra(totalConIva > 0 ? String(totalConIva) : '')
  }, [totalConIva, cobraSigueTotal])

  function submit() {
    if ((!sel.nombre.trim() && !sel.cliente) || !direccion.trim()) { notify('Cliente y dirección son obligatorios', 'err'); return }
    const errFactura = validarFactura(requiereFactura, sel.cliente ? String(sel.cliente.id) : '', factura)
    if (errFactura) { notify(errFactura, 'err'); return }
    if (recibido > totalConIva) { notify(`No puedes cobrar más que el total (${formatMoney(totalConIva)})`, 'err'); return }
    let pagos: { metodo: string; monto: number }[] | undefined
    if (splitPago) {
      const m1 = Number(monto1) || 0, m2 = Number(monto2) || 0
      if (metodo === metodo2) { notify('Elige dos métodos distintos para dividir el pago', 'err'); return }
      if (m1 <= 0 || m2 <= 0) { notify('Con pago dividido, ambos montos deben ser mayores a 0', 'err'); return }
      // Los dos métodos reparten lo que se RECIBE hoy, no el total: con anticipo,
      // el saldo no es de nadie todavía.
      if (Math.round((m1 + m2) * 100) / 100 !== Math.round(recibido * 100) / 100) {
        notify(`Los dos montos deben sumar lo que recibes (${formatMoney(recibido)})`, 'err'); return
      }
      pagos = [{ metodo, monto: m1 }, { metodo: metodo2, monto: m2 }]
    }
    setBusy(true)
    api.post('/rentas/crear/', {
      // Levantada desde la caja: el cobro y el depósito entran al turno del
      // mostrador. Sin esta bandera el backend no toca la caja para nada.
      desde_caja: desdeCaja || undefined,
      inventario_id: unit.id, modalidad, duracion: Number(duracion) || 1,
      cliente: sel.nombre.trim(), telefono_cliente: sel.telefono, direccion: direccion.trim(),
      fecha_inicio: fechaInicio || undefined,
      hora_entrega_estimada: horaEntrega || undefined,
      cliente_id: sel.cliente?.id || undefined, obra_id: obraId || undefined, usuario_id: usuarioId || undefined,
      cotizacion_id: deCot?.id || undefined,
      descuento: Number(descuento) || 0, deposito: Number(deposito) || 0,
      // Va SIEMPRE, aunque sea 0: el backend cobra lo que se capture y nada más.
      metodo_pago: metodo, monto_pago: recibido, pagos,
      requiere_factura: requiereFactura, factura,
    })
      .then(res => {
        // Igual que en la venta: si el backend abrió el turno solo, hay que
        // decirlo, porque el fondo inicial quedó en $0.
        if (res.data?.turno_abierto) {
          notify('Se abrió tu turno de caja con fondo $0. Ajústalo en el arqueo.', 'warning')
        }
        const est = res.data?.renta?.estado
        /* La cotización puede traer más máquinas. Si quedan, el puente avanza a
           la siguiente en vez de apagarse: al cerrar esta hoja el admin se queda
           en Inventario, ya filtrado al equipo que sigue. */
        const sigue = siguientePaso(deCot)
        fijarCotEnCurso(sigue)
        // Salir debiendo no es un error, pero tampoco es un "todo bien" a secas:
        // en ámbar, para que el mostrador registre que quedó dinero en la calle.
        const cola = saldoRenta > 0 ? ` · queda ${formatMoney(saldoRenta)} en adeudos` : ''
        notify((est === 'reservada' ? 'Reserva registrada' : 'Renta registrada') + cola,
               saldoRenta > 0 ? 'warning' : 'ok')
        if (sigue) {
          const p = progresoCot(sigue)
          notify(`Falta${p && p.total - p.actual > 0 ? '' : ''} ${sigue.equipo_nombre || 'la siguiente máquina'}${p ? ` (${p.actual} de ${p.total})` : ''}: elige la unidad y tócale Rentar`, 'info')
        } else if (deCot?.cola && deCot.cola.length > 1) {
          notify(`${deCot.folio || 'Cotización'} completa: salieron las ${deCot.cola.length} máquinas`, 'ok')
        }
        const id = res.data?.renta?.id
        if (id) abrirOrdenCartaPDF('rentas', id)   // orden carta en PDF (ya no ticket térmico)
        onDone()
      })
      .catch(err => {
        const d = err?.response?.data
        // El servidor dice que esa cotización ya se concretó. El puente traía
        // una cotización quemada (pestaña vieja, o alguien más la concretó):
        // se suelta, o el admin se queda reintentando contra el mismo error.
        if (d?.codigo === 'ya_concretada') {
          fijarCotEnCurso(null)
          setDeCot(null)
        }
        notify(d?.detalle || 'Error al rentar', 'err')
      })
      .finally(() => setBusy(false))
  }

  return (
    <Modal className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClose={cerrarConAviso} label={`${esReserva ? 'Reservar' : 'Rentar'} ${unit.codigo}`}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-ink">{esReserva ? 'Reservar' : 'Rentar'} {unit.codigo}</h3>
            <p className="text-xs text-mute mt-0.5">{equipo.modelo}</p>
            {deCot && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full bg-[color:var(--c-renta)]/10 text-[color:var(--c-renta)]">
                Concretando {deCot.folio || 'cotización'} · {deCot.cliente || 'cliente'}
                <button onClick={() => { fijarCotEnCurso(null); setDeCot(null) }} aria-label="Quitar vínculo" className="hover:opacity-70">✕</button>
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
        <div className="space-y-3">
          {/* Se teclea el teléfono y, si ya está en el padrón, aparece con su
              historial para confirmarlo. El sistema sugiere; quien atiende decide. */}
          <BuscadorCliente valor={sel} onChange={elegirCliente} autoFocus />
          {sel.cliente && sel.cliente.obras.length > 0 && (
            <div>
              <label className={label}>Obra</label>
              <select aria-label="Obra" className={input} value={obraId} onChange={e => elegirObra(e.target.value)}>
                <option value="" className="bg-surface">— Sin obra —</option>
                {sel.cliente.obras.map(o => <option key={o.id} value={o.id} className="bg-surface">{o.nombre}</option>)}
              </select>
            </div>
          )}
          {clientes.length > 0 && (
            <div>
              <label className={label}>Cuenta del cliente <span className="text-mute font-normal normal-case">(opcional — para que la vea en "Tus rentas")</span></label>
              <select aria-label="Cuenta del cliente" className={input} value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
                <option value="" className="bg-surface">— Sin vincular —</option>
                {clientes.map(c => <option key={c.id} value={c.id} className="bg-surface">{c.nombre}{c.empresa ? ` — ${c.empresa}` : ''}</option>)}
              </select>
            </div>
          )}
          {/* Mismo autocompletado que usa el cliente en el armador: una sola
              forma de capturar una dirección en todo el sistema. Aquí importa
              igual o más — es la que acaba en la hoja que lleva el chofer. */}
          <div>
            <label className={label}>Dirección / ubicación de obra *</label>
            <AddressAutocomplete
              value={direccion}
              onChange={setDireccion}
              onSelect={a => setDireccion(a.display_name)}
              placeholder="Dónde estará el equipo"
              inputClassName={`${input} pl-11 pr-11`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Modalidad</label>
              <select aria-label="Modalidad" className={input} value={modalidad} onChange={e => setModalidad(e.target.value as any)}>
                <option value="dia" className="bg-surface">Por día</option>
                <option value="semana" className="bg-surface">Por semana</option>
                <option value="mes" className="bg-surface">Por mes</option>
              </select>
            </div>
            <div><label className={label}>Duración</label><input aria-label="Duración" type="number" min={1} className={input} value={duracion} onChange={e => setDuracion(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Fecha de inicio</label><input aria-label="Fecha de inicio" type="date" min={hoy} className={input} value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} /></div>
            <div>
              <label className={label}>Hora estimada de entrega</label>
              <input aria-label="Hora estimada de entrega" type="time" className={input}
                value={horaEntrega} onChange={e => setHoraEntrega(e.target.value)} />
              <p className="text-[10.5px] text-mute mt-1">Opcional. El cliente la ve como estimada.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Descuento</label><InputDinero valor={descuento} onValor={setDescuento} /></div>
            <div><label className={label}>Depósito / garantía</label><InputDinero valor={deposito} onValor={setDeposito} /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${label} mb-0`}>Método de pago</label>
              <button type="button" onClick={() => setSplitPago(s => !s)} className="text-[11px] font-bold text-gold-ink hover:underline">
                {splitPago ? 'Un solo método' : 'Dividir en 2 métodos'}
              </button>
            </div>
            {!splitPago ? (
              <select aria-label="Método de pago" className={input} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
                <option value="efectivo" className="bg-surface">Efectivo</option>
                <option value="tarjeta" className="bg-surface">Tarjeta</option>
                <option value="transferencia" className="bg-surface">Transferencia</option>
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select aria-label="Método de pago 1" className={`${input} flex-1`} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
                    <option value="efectivo" className="bg-surface">Efectivo</option>
                    <option value="tarjeta" className="bg-surface">Tarjeta</option>
                    <option value="transferencia" className="bg-surface">Transferencia</option>
                  </select>
                  <div className="w-[44%]"><InputDinero valor={monto1} onValor={setMonto1} placeholder="Monto" /></div>
                </div>
                <div className="flex gap-2">
                  <select aria-label="Método de pago 2" className={`${input} flex-1`} value={metodo2} onChange={e => setMetodo2(e.target.value as any)}>
                    <option value="efectivo" className="bg-surface">Efectivo</option>
                    <option value="tarjeta" className="bg-surface">Tarjeta</option>
                    <option value="transferencia" className="bg-surface">Transferencia</option>
                  </select>
                  <div className="w-[44%] flex gap-1">
                    <InputDinero valor={monto2} onValor={setMonto2} placeholder="Resto" className="flex-1" />
                    <button type="button" onClick={() => { const m1 = Number(monto1) || 0; setMonto2(String(Math.max(0, Number((recibido - m1).toFixed(2))))) }}
                      className="px-2 rounded-lg border border-edge text-[11px] font-semibold text-mute hover:text-ink shrink-0 whitespace-nowrap">Resto</button>
                  </div>
                </div>
                {(() => {
                  const s = (Number(monto1) || 0) + (Number(monto2) || 0)
                  const ok = Math.round(s * 100) / 100 === Math.round(recibido * 100) / 100
                  return <p className={`text-[11px] ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-taller-ink'}`}>{ok ? '✓ Los montos suman lo que recibes' : `Deben sumar ${formatMoney(recibido)} · llevas ${formatMoney(s)}`}</p>
                })()}
              </div>
            )}
          </div>
          {/* Cuánto deja HOY. La máquina se entrega igual: lo que falte queda como
              saldo vivo y el cliente lo abona durante la renta. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${label} mb-0`}>Recibes ahora</label>
              <div className="flex gap-1.5">
                {/* El caso común —pagó completo— es UN clic, y desde ahí el monto
                    sigue al total si después cambia la duración. */}
                <button type="button" onClick={() => setCobraSigueTotal(true)}
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors ${cobraSigueTotal ? 'border-gold bg-gold/15 text-gold-ink' : 'border-edge text-mute hover:text-ink'}`}>Pagó todo</button>
                <button type="button" onClick={() => { setCobraSigueTotal(false); setCobra(String(Math.round(totalConIva * 50) / 100)) }}
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-edge text-mute hover:text-ink transition-colors">Mitad</button>
                <button type="button" onClick={() => { setCobraSigueTotal(false); setCobra('0') }}
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-edge text-mute hover:text-ink transition-colors">Nada</button>
              </div>
            </div>
            <InputDinero valor={cobra} onValor={v => { setCobraSigueTotal(false); setCobra(v) }} placeholder="0" />
            {recibido > totalConIva ? (
              <p className="text-[11px] text-red-500 font-semibold mt-1.5">No puedes cobrar más que el total ({formatMoney(totalConIva)}).</p>
            ) : saldoRenta > 0 ? (
              <p className="text-[11px] text-taller-ink mt-1.5">
                Queda un saldo de <b>{formatMoney(saldoRenta)}</b>. El equipo se entrega igual: el cliente lo abona durante la renta y lo ve en “Mis adeudos”.
              </p>
            ) : (
              <p className="text-[10.5px] text-mute mt-1.5">Queda liquidada al levantarla. Si el cliente solo deja una parte, captúrala aquí.</p>
            )}
          </div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} empresaNombre={sel.cliente?.rfc ? sel.cliente.nombre : undefined} />
          {Number(precio) <= 0 && (
            <p className="text-[11px] text-taller-ink bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Este equipo no tiene precio {modalidad === 'dia' ? 'por día' : modalidad === 'semana' ? 'por semana' : 'por mes'} configurado: el total sale en $0. Cárgalo en el producto o elige otra modalidad.
            </p>
          )}
          {esReserva && <p className="text-[11px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">Inicia el {fechaInicio}: se guarda como <b>reserva</b> y no ocupa la unidad hasta esa fecha.</p>}
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            {requiereFactura ? (<>
              <div className="flex items-center justify-between text-xs text-mute"><span>Renta{Number(descuento) > 0 ? ' (con descuento)' : ''} sin IVA</span><span>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaRenta.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total con IVA</span><span className="text-lg font-black text-price">${totalConIva.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            </>) : (
              <div className="flex items-center justify-between"><span className="text-sm text-mute">Total{Number(descuento) > 0 ? ' (con descuento)' : ''}</span><span className="text-lg font-black text-price">${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
            )}
            {saldoRenta > 0 && recibido <= totalConIva && (
              <div className="flex items-center justify-between pt-1 border-t border-edge text-xs">
                <span className="text-mute">Recibes ahora · queda a deber</span>
                <span className="font-bold text-ink tabular-nums">{formatMoney(recibido)} · <span className="text-red-600 dark:text-red-400">{formatMoney(saldoRenta)}</span></span>
              </div>
            )}
          </div>
        </div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn-renta px-7 py-2.5 rounded-full text-sm font-bold">{esReserva ? 'Reservar' : 'Registrar renta'}</button>
        </div>
      </motion.div>
    </Modal>
  )
}

/* ── Registrar venta ── */
export function SellModal({ unit, equipo, onClose, onDone, notify, desdeCaja = false }: {
  unit: Unidad; equipo: Equipo; onClose: () => void; onDone: () => void; notify: Notify
  /** Levantada/vendida desde la caja: el cobro entra al turno del mostrador. */
  desdeCaja?: boolean
}) {
  const nav = useNavigate()
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  // Pago dividido: dos métodos que reparten el total con IVA (p. ej. efectivo + tarjeta).
  const [splitPago, setSplitPago] = useState(false)
  const [metodo2, setMetodo2] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('tarjeta')
  const [monto1, setMonto1] = useState('')
  const [monto2, setMonto2] = useState('')
  /* ¿Venimos de "Concretar venta" de una cotización? Igual que la renta:
     Inventario filtrado al equipo cotizado, y al elegir la unidad esta hoja
     llega precargada y liga la venta a la cotización. */
  const [deCot, setDeCot] = useState(leerCotEnCursoPara('venta'))
  // Con cotización manda el precio que el cliente YA aceptó, no el de catálogo:
  // si difieren, el de catálogo cambió después de cotizar y el cliente no lo vio.
  const [total, setTotal] = useState(String(deCot?.precio ?? equipo.precio_venta ?? ''))
  const [sel, setSel] = useState<SeleccionCliente>(
    deCot ? { ...SELECCION_VACIA, nombre: deCot.cliente || '', telefono: soloTelefono(deCot.telefono || '') } : SELECCION_VACIA,
  )
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [factura, setFactura] = useState<FacturaData>(FACTURA_VACIA)
  const [busy, setBusy] = useState(false)

  // "Sucio" = ya hay trabajo capturado. El precio arranca con el de catálogo,
  // así que solo cuenta si lo cambiaron a mano.
  /* Lo que llegó precargado desde la cotización no es "trabajo capturado": si
     contara, cerrar una hoja intacta preguntaría siempre. */
  const arranque = String(deCot?.precio ?? equipo.precio_venta ?? '')
  const sucio = Boolean(
    (!deCot && (sel.nombre.trim() || sel.telefono.trim())) || sel.cliente || requiereFactura ||
    splitPago || monto1.trim() || monto2.trim() ||
    total !== arranque,
  )

  /* Cerrar con un clic afuera borraba catorce campos sin preguntar, y esto se
     llena con el cliente enfrente. Solo estorba si de verdad hay algo escrito:
     una hoja intacta se cierra de inmediato, como antes. */
  async function cerrarConAviso() {
    if (!sucio) { onClose(); return }
    if (await confirmar({
      titulo: '¿Descartar lo que llevas?',
      mensaje: 'Cerraste la hoja sin registrar. Lo capturado se pierde.',
      aceptar: 'Descartar', cancelar: 'Seguir aquí', tono: 'peligro',
    })) onClose()
  }

  // En VENTAS el precio de catálogo YA INCLUYE IVA: es el precio al público y no
  // se le suma nada encima. El IVA se DESGLOSA del total (total / 1.16), igual que
  // hace el backend en Venta.recalcular_total() y que el POS y la cotización de
  // venta. La renta es el caso contrario: ahí el IVA sí se suma si hay factura.
  const precioNum = Number(total) || 0
  const baseNum = Math.round((precioNum / 1.16) * 100) / 100
  const ivaNum = Math.round((precioNum - baseNum) * 100) / 100

  function submit() {
    if (precioNum <= 0) { notify('El precio debe ser mayor a 0', 'err'); return }
    const errFactura = validarFactura(requiereFactura, sel.cliente ? String(sel.cliente.id) : '', factura)
    if (errFactura) { notify(errFactura, 'err'); return }
    let pagos: { metodo: string; monto: number }[] | undefined
    if (splitPago) {
      const m1 = Number(monto1) || 0, m2 = Number(monto2) || 0
      if (metodo === metodo2) { notify('Elige dos métodos distintos para dividir el pago', 'err'); return }
      if (m1 <= 0 || m2 <= 0) { notify('Con pago dividido, ambos montos deben ser mayores a 0', 'err'); return }
      if (Math.round((m1 + m2) * 100) / 100 !== Math.round(precioNum * 100) / 100) {
        notify(`Los dos montos deben sumar el total (${formatMoney(precioNum)})`, 'err'); return
      }
      pagos = [{ metodo, monto: m1 }, { metodo: metodo2, monto: m2 }]
    }
    setBusy(true)
    api.post(`/unidades/${unit.id}/vender/`, {
      // Vendida desde la caja: el cobro entra al turno del mostrador.
      desde_caja: desdeCaja || undefined,
      nombre_cliente: sel.nombre.trim(), telefono_cliente: sel.telefono,
      metodo_pago: metodo, cliente_id: sel.cliente?.id || undefined, total: precioNum,
      pagos,
      // Concretando una cotización: el backend liga la venta, la marca
      // convertida y se la muestra al cliente en "Mis compras".
      cotizacion_id: deCot?.id || undefined,
      requiere_factura: requiereFactura, factura,
    })
      .then(res => {
        const sigue = siguientePaso(deCot)
        fijarCotEnCurso(sigue)
        if (sigue) {
          const p = progresoCot(sigue)
          notify('Venta registrada')
          notify(`Falta ${sigue.equipo_nombre || 'la siguiente máquina'}${p ? ` (${p.actual} de ${p.total})` : ''}: elige la unidad y tócale Vender`, 'info')
        } else {
          notify(deCot ? `Venta registrada · ${deCot.folio || 'cotización'} concretada` : 'Venta registrada')
        }
        // El backend abre el turno solo si hacía falta, para no detener al
        // mostrador con el cliente enfrente. Se avisa porque el fondo inicial
        // quedó en $0 y hay que corregirlo al cerrar, o el arqueo saldrá alto.
        if (res.data?.turno_abierto) {
          notify('Se abrió tu turno de caja con fondo $0. Ajústalo en el arqueo.', 'warning')
        }
        const id = res.data?.venta?.id
        if (id) abrirOrdenCartaPDF('ventas', id)   // orden carta en PDF (ya no ticket térmico)
        onDone()
        /* Y te deja parado en la venta, igual que la renta. Desde la CAJA no:
           ahí hay fila y el cliente enfrente, y sacar al cajero del mostrador
           para enseñarle un detalle que no pidió cuesta más de lo que ayuda. */
        if (id && !desdeCaja) { fijarVentaAAbrir(id); nav('/dashboard/ventas') }
      })
      .catch(err => {
        const detalle = err?.response?.data?.detalle || 'Error al vender'
        /* La cotización del puente ya se convirtió (pestaña vieja, o alguien
           más la concretó). Se suelta o el admin se queda reintentando contra
           el mismo error, sin entender de dónde sale. */
        if (/ya se convirtió|ya se concret/i.test(detalle)) { fijarCotEnCurso(null); setDeCot(null) }
        notify(detalle, 'err')
      })
      .finally(() => setBusy(false))
  }

  return (
    <Modal className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClose={cerrarConAviso} label={`Vender ${unit.codigo}`}>
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[560px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-ink">Vender {unit.codigo}</h3>
            <p className="text-xs text-mute mt-0.5">{equipo.modelo} · {unit.condicion}</p>
            {deCot && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full bg-gold-soft text-gold-ink">
                Concretando {deCot.folio || 'cotización'} · {deCot.cliente || 'cliente'}
                <button onClick={() => { fijarCotEnCurso(null); setDeCot(null) }} aria-label="Quitar vínculo" className="hover:opacity-70">✕</button>
              </p>
            )}
          </div>
          <button onClick={cerrarConAviso} className="w-8 h-8 rounded-[9px] flex items-center justify-center text-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0" aria-label="Cerrar"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
        <div className="space-y-3">
          {/* Una máquina no se vende a un desconocido: el teléfono trae su
              ficha con lo que ya nos compró, antes de cerrar. */}
          <BuscadorCliente valor={sel} onChange={setSel} autoFocus />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${label} mb-0`}>Método de pago</label>
              <button type="button" onClick={() => setSplitPago(s => !s)} className="text-[11px] font-bold text-gold-ink hover:underline">
                {splitPago ? 'Un solo método' : 'Dividir en 2 métodos'}
              </button>
            </div>
            {!splitPago ? (
              <select aria-label="Método de pago" className={input} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
                <option value="efectivo" className="bg-surface">Efectivo</option>
                <option value="tarjeta" className="bg-surface">Tarjeta</option>
                <option value="transferencia" className="bg-surface">Transferencia</option>
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select aria-label="Método de pago 1" className={`${input} flex-1`} value={metodo} onChange={e => setMetodo(e.target.value as any)}>
                    <option value="efectivo" className="bg-surface">Efectivo</option>
                    <option value="tarjeta" className="bg-surface">Tarjeta</option>
                    <option value="transferencia" className="bg-surface">Transferencia</option>
                  </select>
                  <div className="w-[44%]"><InputDinero valor={monto1} onValor={setMonto1} placeholder="Monto" /></div>
                </div>
                <div className="flex gap-2">
                  <select aria-label="Método de pago 2" className={`${input} flex-1`} value={metodo2} onChange={e => setMetodo2(e.target.value as any)}>
                    <option value="efectivo" className="bg-surface">Efectivo</option>
                    <option value="tarjeta" className="bg-surface">Tarjeta</option>
                    <option value="transferencia" className="bg-surface">Transferencia</option>
                  </select>
                  <div className="w-[44%] flex gap-1">
                    <InputDinero valor={monto2} onValor={setMonto2} placeholder="Resto" className="flex-1" />
                    <button type="button" onClick={() => { const m1 = Number(monto1) || 0; setMonto2(String(Math.max(0, Number((precioNum - m1).toFixed(2))))) }}
                      className="px-2 rounded-lg border border-edge text-[11px] font-semibold text-mute hover:text-ink shrink-0 whitespace-nowrap">Resto</button>
                  </div>
                </div>
                {(() => {
                  const s = (Number(monto1) || 0) + (Number(monto2) || 0)
                  const ok = Math.round(s * 100) / 100 === Math.round(precioNum * 100) / 100
                  return <p className={`text-[11px] ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-taller-ink'}`}>{ok ? '✓ Los montos suman el total' : `Deben sumar ${formatMoney(precioNum)} · llevas ${formatMoney(s)}`}</p>
                })()}
              </div>
            )}
          </div>
          <div>
            <label className={label}>Precio de venta (IVA incluido)</label>
            <InputDinero valor={total} onValor={setTotal} placeholder="16,500" />
            <p className="text-[11px] text-mute mt-1">Es el precio al público. El IVA ya va dentro; abajo se desglosa para la factura.</p>
          </div>
          <div className="px-4 py-3 rounded-xl bg-surface-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-mute"><span>Subtotal (sin IVA)</span><span>${baseNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between text-xs text-mute"><span>IVA (16%)</span><span>${ivaNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            <div className="flex items-center justify-between pt-1 border-t border-edge"><span className="text-sm text-ink font-semibold">Total a cobrar</span><span className="text-lg font-black text-price">${precioNum.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
          </div>
          <FacturaFields requiere={requiereFactura} onRequiere={setRequiereFactura} factura={factura} onFactura={setFactura} empresaNombre={sel.cliente?.rfc ? sel.cliente.nombre : undefined} />
        </div>
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="px-7 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">Registrar venta</button>
        </div>
      </motion.div>
    </Modal>
  )
}

/* ════════════════════════════════════════
   PEDIDOS Y APARTADOS (venta con anticipo)
════════════════════════════════════════ */
// Contexto opcional cuando el pedido nace de una cotización sin stock (sobre pedido).
export type PedidoDesde = {
  id: number                 // id de la cotización de origen
  equipoId?: number | null
  equipoNombre?: string
  precio?: number
  cliente?: string
  telefono?: string
  empresaId?: number | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENOVAR UNA RENTA — "me la quedo otra semana"

   El endpoint existía completo desde hacía tiempo y NADIE lo llamaba: no había
   botón en ninguna pantalla. Así que cuando el cliente pedía más tiempo, alguien
   cerraba la renta a mano y levantaba otra desde cero — se perdía el vínculo
   entre periodos, había que volver a pedir el depósito, y en la jornada del
   técnico aparecían una devolución y una entrega que nunca ocurrieron.

   Cada periodo es su propia renta, ligada a la anterior: así el historial no se
   pisa y cada una lleva su total, sus abonos y su vencimiento.
   ═══════════════════════════════════════════════════════════════════════════ */
export function RenovarRentaModal({ renta, onClose, onHecho, notify }: {
  renta: RentaFull
  onClose: () => void
  onHecho: (nuevaId: number) => void
  notify: Notify
}) {
  const activa = renta.estado === 'activa'
  const [modalidad, setModalidad] = useState<'dia' | 'semana' | 'mes'>(
    (renta.modalidad as 'dia' | 'semana' | 'mes') || 'dia')
  const [duracion, setDuracion] = useState('1')
  /* El depósito viene PRECARGADO con el que ya dejó: en una renovación no se
     pide otro, se traslada. Que el campo salga vacío invitaría a cobrarlo dos
     veces, que es justo lo que este flujo evita. */
  const [deposito, setDeposito] = useState(String(Number(renta.deposito || 0) || ''))
  const [abono, setAbono] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo')
  const [busy, setBusy] = useState(false)

  const dias = { dia: 1, semana: 7, mes: 30 }[modalidad] * Math.max(1, Number(duracion) || 1)
  const vence = new Date()
  vence.setDate(vence.getDate() + dias)

  function submit() {
    const n = Math.max(1, Number(duracion) || 1)
    setBusy(true)
    const pagos = Number(abono) > 0 ? [{ monto: Number(abono), metodo }] : undefined
    api.post<{ renta: { id: number }; origen_id: number }>(`/rentas/${renta.id}/renovar/`, {
      modalidad, duracion: n,
      deposito: deposito === '' ? undefined : Number(deposito),
      ...(pagos ? { pagos } : {}),
    })
      .then(r => {
        notify(activa ? 'Renta renovada' : 'Renta revivida')
        onHecho(r.data.renta.id)
      })
      .catch(err => notify(errorMsg(err, 'No se pudo renovar'), 'err'))
      .finally(() => setBusy(false))
  }

  return createPortal(
    <Modal className="modal-in fixed inset-0 z-[70] bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4" onClose={onClose} label="Renovar renta">
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[460px] bg-surface rounded-t-3xl sm:rounded-2xl border-t sm:border border-edge shadow-[0_24px_60px_rgba(17,24,39,0.28)] overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-edge">
          <h2 className="text-[17px] font-extrabold text-ink">{activa ? 'Renovar renta' : 'Volver a rentar'}</h2>
          <p className="text-[12.5px] text-mute mt-1 leading-snug">
            {renta.inventario.equipo} · {renta.inventario.codigo}
            {activa
              ? ' — el periodo actual se cierra y arranca uno nuevo. La máquina no se mueve.'
              : ' — se levanta un periodo nuevo con la misma unidad.'}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={label}>Periodo</label>
            <Segmentado
              valor={modalidad}
              onChange={k => setModalidad(k as typeof modalidad)}
              opciones={[{ key: 'dia', label: 'Días' }, { key: 'semana', label: 'Semanas' }, { key: 'mes', label: 'Meses' }]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>¿Cuántos?</label>
              <input aria-label="Cuántos periodos" type="number" min={1} value={duracion}
                onChange={e => setDuracion(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Depósito</label>
              <InputDinero etiqueta="Depósito en garantía" valor={deposito} onValor={setDeposito} placeholder="0" />
            </div>
          </div>
          {activa && Number(renta.deposito || 0) > 0 && (
            /* Se dice en voz alta: sin esto, quien atiende vuelve a cobrarle el
               depósito al cliente porque no tiene forma de saber que ya viajó. */
            <p className="text-[12px] leading-snug text-mute">
              Su depósito de <b className="text-ink">{formatMoney(renta.deposito)}</b> se traslada a este periodo; no se le vuelve a cobrar.
            </p>
          )}
          <div>
            <label className={label}>Abono ahora (opcional)</label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <InputDinero etiqueta="Abono" valor={abono} onValor={setAbono} placeholder="0" />
              <select aria-label="Método de pago" value={metodo} onChange={e => setMetodo(e.target.value as typeof metodo)} className="campo w-[150px]">
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
          </div>
          <p className="rounded-xl border border-edge bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-mute">
            Vence el <b className="text-ink tabular-nums">{vence.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</b>
          </p>
        </div>

        <div className="px-6 py-4 border-t border-edge flex items-center gap-2.5">
          <button onClick={onClose} className="flex-1 h-11 rounded-[9px] border border-edge text-ink text-[13.5px] font-bold hover:bg-surface-2 transition-colors">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn-acento flex-1 h-11 rounded-[9px] text-[13.5px] font-bold disabled:opacity-50">
            {busy ? 'Renovando…' : activa ? 'Renovar' : 'Volver a rentar'}
          </button>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

export function NuevoPedidoModal({ desde, equipos = [], empresas, onClose, onDone, notify }: {
  desde?: PedidoDesde | null
  equipos?: Equipo[]; empresas: Empresa[]
  onClose: () => void; onDone: () => void; notify: Notify
}) {
  const [equipoId, setEquipoId] = useState<string>(desde?.equipoId ? String(desde.equipoId) : '')
  const equipo = equipos.find(e => String(e.id) === equipoId) || null
  const [precio, setPrecio] = useState<string>(
    desde?.precio ? String(desde.precio) : (equipo && num(equipo.precio_venta) ? String(num(equipo.precio_venta)) : '')
  )
  const [cliente, setCliente] = useState(desde?.cliente || '')
  const [telefono, setTelefono] = useState(desde?.telefono || '')
  const [empresaId, setEmpresaId] = useState<string>(desde?.empresaId ? String(desde.empresaId) : '')
  const [anticipo, setAnticipo] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [fecha, setFecha] = useState('')     // ETA opcional (yyyy-mm-dd)
  /* El respaldo del PROVEEDOR hacia REMALI: por si la máquina que nos surtió
     sale defectuosa y hay que reclamarle a él. No confundir con la garantía que
     REMALI le da al CLIENTE, que nace sola al vender y no se captura. */
  const [garProvMeses, setGarProvMeses] = useState('')
  const [garProvNota, setGarProvNota] = useState('')
  const [codigo, setCodigo] = useState('')   // por si el anticipo va bajo el mínimo
  const [busy, setBusy] = useState(false)
  // Sobre pedido = se ordena al proveedor: pide un anticipo mínimo (config, 60% por
  // defecto). El backend lo impone; aquí se sugiere y se avisa antes de enviar.
  const cfg = useConfigPublica()
  const pctMin = Number(cfg.anticipo_minimo_pct) || 60
  // Ligar a una cuenta de cliente para que vea su pedido y su avance en "Mis compras".
  const [clientes, setClientes] = useState<{ id: number; nombre: string; empresa?: string }[]>([])
  const [clienteCuenta, setClienteCuenta] = useState('')
  useEffect(() => {
    api.get<{ clientes: { id: number; nombre: string; empresa?: string }[] }>('/clientes-lookup/')
      .then(r => setClientes(r.data.clientes || [])).catch(anotarFallo)
  }, [])

  // Al elegir equipo (cuando no viene de una cotización), sugiere su precio de venta.
  useEffect(() => {
    if (desde?.precio) return
    const e = equipos.find(x => String(x.id) === equipoId)
    if (e && num(e.precio_venta)) setPrecio(String(num(e.precio_venta)))
  }, [equipoId])   // eslint-disable-line react-hooks/exhaustive-deps

  const precioNum = Number(precio) || 0
  const anticipoNum = Number(anticipo) || 0
  const saldo = Math.max(0, precioNum - anticipoNum)
  // El pedido es SOLO para máquinas sin stock: agotadas (en inventario, 0 disponibles)
  // o especiales de proveedor (sin inventario). Las que tienen stock se venden directo.
  const equiposPedibles = equipos.filter(e => Number(e.stock_disponible || 0) === 0 && num(e.precio_venta) > 0)
  const anticipoMin = precioNum > 0 ? Math.round(precioNum * pctMin / 100 * 100) / 100 : 0
  const anticipoBajo = anticipoNum > 0 && anticipoMin > 0 && anticipoNum < anticipoMin
  // Sugerir el anticipo mínimo cuando ya hay precio y aún no se capturó (el común es el 60%).
  useEffect(() => {
    if (anticipoMin > 0 && !anticipo) setAnticipo(String(anticipoMin))
  }, [anticipoMin])   // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    if (!equipoId) { notify('Elige el equipo a pedir', 'err'); return }
    if (precioNum <= 0) { notify('Captura el precio del pedido', 'err'); return }
    if (!cliente.trim()) { notify('Escribe el nombre del cliente', 'err'); return }
    // Un pedido se entrega días o semanas después: sin teléfono no hay forma de
    // avisar que llegó, y la máquina se queda en bodega esperando a alguien que
    // no sabe que ya está.
    if (telefono.replace(/\D/g, '').length !== 10) {
      notify('El teléfono es obligatorio: es como le avisas cuando llegue su máquina', 'err'); return
    }
    if (anticipoNum > precioNum) { notify('El anticipo no puede ser mayor al precio', 'err'); return }
    if (anticipoBajo && codigo.length !== 6) {
      notify(`Anticipo abajo del mínimo (${pctMin}% = ${formatMoney(anticipoMin)}). Súbelo o autoriza con el código.`, 'err'); return
    }
    setBusy(true)
    api.post('/ventas/pedidos/crear/', {
      equipo_id: Number(equipoId),
      cotizacion_id: desde?.id || undefined,
      precio: precioNum,
      nombre_cliente: cliente.trim(),
      telefono_cliente: telefono.trim(),
      cliente_id: empresaId || undefined,
      cliente_usuario_id: clienteCuenta || undefined,
      anticipo: anticipoNum,
      metodo_pago: metodo,
      fecha_estimada_entrega: fecha || undefined,
      garantia_proveedor_meses: Number(garProvMeses) || undefined,
      garantia_proveedor_nota: garProvNota.trim() || undefined,
      codigo_ajuste: codigo || undefined,
    })
      .then(() => { notify('Pedido registrado'); onDone() })
      .catch(err => { const d = err?.response?.data?.detalle; if (d) notify(d, 'err') })
      .finally(() => setBusy(false))
  }

  return (
    <Modal className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" onClose={onClose} label="Nuevo pedido">
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        onClick={e => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-[520px] bg-surface border-l border-edge shadow-[-24px_0_60px_rgba(33,29,22,0.22)] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-edge flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-ink">Nuevo pedido</h3>
            <p className="text-xs text-mute mt-0.5">Aparta una máquina sin stock con anticipo. La unidad se asigna cuando llega.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full hover:bg-surface-2 text-mute hover:text-ink transition-colors shrink-0">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {desde && (
            <div className="rounded-xl border border-gold/35 bg-gold/[0.06] px-3.5 py-2.5 text-[12px] text-mute">
              Nace de la cotización <b className="text-ink">#{desde.id}</b>: hereda al cliente y aplica su cupón al guardar.
            </div>
          )}
          {desde?.equipoId ? (
            <div>
              <label className={label}>Equipo a pedir</label>
              <div className="h-10 px-3 flex items-center rounded-lg border border-edge bg-surface-2 text-[13.5px] font-medium text-ink">{desde.equipoNombre || equipo?.modelo || 'Equipo de la cotización'}</div>
            </div>
          ) : (
            <div>
              <label className={label}>Equipo a pedir</label>
              <select aria-label="Equipo a pedir" value={equipoId} onChange={e => setEquipoId(e.target.value)} className={input}>
                <option value="">Elige el equipo…</option>
                {equiposPedibles.map(e => (
                  <option key={e.id} value={e.id}>{e.modelo}{e.unidades_total ? ' · agotado' : ' · sobre pedido'}</option>
                ))}
              </select>
              {equiposPedibles.length === 0
                ? <p className="text-[11px] text-taller-ink mt-1">No hay máquinas sin stock. Solo se piden las agotadas o especiales; las que tienen stock se venden directo.</p>
                : <p className="text-[11px] text-mute mt-1">Solo máquinas sin stock (agotadas o especiales de proveedor). Al llegar, se asigna la unidad.</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Precio</label><InputDinero valor={precio} onValor={setPrecio} placeholder="0" /></div>
            <div><label className={label}>Anticipo</label><InputDinero valor={anticipo} onValor={setAnticipo} placeholder="0" /></div>
          </div>
          <div className="flex items-center justify-between text-[12px] px-1">
            <span className="text-mute">Saldo tras el anticipo</span>
            <span className="font-bold text-ink tabular-nums">{formatMoney(saldo)}</span>
          </div>
          {precioNum > 0 && (
            <div className={`flex items-center justify-between gap-2 text-[11.5px] rounded-lg px-3 py-2 border ${anticipoBajo ? 'border-amber-500/30 bg-amber-500/[0.06] text-taller-ink' : 'border-edge bg-surface-2 text-mute'}`}>
              <span>Anticipo mínimo <b>{pctMin}%</b> = {formatMoney(anticipoMin)}{anticipoBajo ? ' · va bajo, pide código' : ''}</span>
              <button type="button" onClick={() => setAnticipo(String(anticipoMin))} className="font-bold text-gold-ink hover:underline shrink-0 whitespace-nowrap">Usar {pctMin}%</button>
            </div>
          )}
          <div>
            <label className={label}>Método del anticipo</label>
            <div className="flex gap-2">
              {(['efectivo', 'tarjeta', 'transferencia'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMetodo(m)}
                  className={`flex-1 h-10 rounded-lg border text-[12.5px] font-semibold capitalize transition-colors ${metodo === m ? 'border-gold bg-gold/10 text-ink' : 'border-edge text-mute hover:text-ink'}`}>{m}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Cliente</label><input aria-label="Cliente" value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre" className={input} /></div>
            {/* El teléfono NO es opcional. Sin él no hay cómo avisar de la
                entrega ni cómo encontrar al cliente después; y ahora que su
                ficha nace junto con su cuenta, es el dato que evita que el
                mismo señor termine con tres fichas distintas. */}
            <div><label className={label}>Teléfono *</label><input aria-label="Teléfono" aria-required="true" type="tel" inputMode="numeric" maxLength={10} value={telefono} onChange={e => setTelefono(soloTelefono(e.target.value))} placeholder="10 dígitos" className={input} /></div>
          </div>
          {desde ? (
            <p className="text-[11px] text-mute px-1">Se liga al cliente de la cotización #{desde.id} (verá su pedido en "Mis compras").</p>
          ) : (
            <div>
              <label className={label}>Ligar a cuenta de cliente (opcional)</label>
              <select aria-label="Ligar a cuenta de cliente (opcional)" value={clienteCuenta} onChange={e => { setClienteCuenta(e.target.value); const c = clientes.find(x => String(x.id) === e.target.value); if (c && !cliente.trim()) setCliente(c.nombre) }} className={input}>
                <option value="">Sin cuenta (solo nombre)</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)}
              </select>
              <p className="text-[11px] text-mute mt-1">Si lo ligas, el cliente ve su pedido y su avance en "Mis compras".</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Empresa (opcional)</label>
              <select aria-label="Empresa (opcional)" value={empresaId} onChange={e => setEmpresaId(e.target.value)} className={input}>
                <option value="">Sin empresa</option>
                {empresas.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}
              </select>
            </div>
            <div><label className={label}>Llega aprox.</label><input aria-label="Llega aprox." type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={input} /></div>
          </div>
          {/* El respaldo de QUIEN NOS SURTE. Se pregunta aquí, con la factura del
              proveedor a la mano; buscarlo meses después, cuando la máquina ya
              falló, es cuando ya no aparece. La del cliente no se captura: nace
              sola al vender, con los meses del catálogo. */}
          <div className="rounded-xl border border-edge bg-surface-2/50 px-3.5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-mute mb-2.5">Respaldo del proveedor (opcional)</p>
            <div className="grid grid-cols-[110px_1fr] gap-2.5">
              <div>
                <label className={label}>Garantía</label>
                <div className="relative">
                  <input aria-label="Meses de garantía del proveedor" type="number" min={0} max={120}
                    value={garProvMeses} onChange={e => setGarProvMeses(e.target.value)}
                    placeholder="0" className={`${input} pr-14`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-mute pointer-events-none">meses</span>
                </div>
              </div>
              <div>
                <label className={label}>Nota</label>
                <input aria-label="Nota de la garantía del proveedor" value={garProvNota}
                  onChange={e => setGarProvNota(e.target.value)} maxLength={200}
                  placeholder="Factura, proveedor, contacto…" className={input} />
              </div>
            </div>
          </div>
          {anticipoBajo && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-3.5 py-3 space-y-2">
              <p className="text-[12.5px] font-bold text-taller-ink">Recibir menos del {pctMin}% requiere autorización</p>
              <p className="text-[11.5px] text-mute">Queda a criterio de administración. Escribe el código de 6 dígitos de un administrador o gerente para registrar este anticipo bajo.</p>
              <input aria-label="Código de seguridad" type="password" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={codigo}
                onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••"
                className={`${input} text-center font-mono tracking-[0.4em]`} />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-edge flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-full border border-edge text-mute text-sm font-medium hover:text-ink transition-colors active:scale-[0.97]">Cancelar</button>
          <button onClick={submit} disabled={busy} className="px-7 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 active:scale-[0.96] transition disabled:opacity-50">{busy ? 'Guardando…' : 'Registrar pedido'}</button>
        </div>
      </motion.div>
    </Modal>
  )
}
