/**
 * Caja — punto de venta de refacciones (mostrador).
 *
 * Pantalla única estilo POS (diseño "Caja REMALI v2"): barra de escaneo arriba,
 * ticket + catálogo a la izquierda y el panel de cobro SIEMPRE visible a la
 * derecha, con teclado en pantalla para el efectivo. A diferencia del mock, el
 * cobro es real: POST /ventas/mostrador/ crea la venta, descuenta stock y
 * desglosa IVA (el precio ya lo incluye); "Imprimir" abre el comprobante y
 * "Corte de caja" el arqueo del día. Del lado del backend la gobierna
 * PuedeUsarCaja (capacidad usar_caja): el técnico de campo no entra aquí.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../lib/api'
import { formatMoney, soloTelefono } from '../lib/utils'
import { usePuede } from '../lib/acceso'
import TicketModal from '../components/TicketModal'

type Notify = (m: string, t?: 'ok' | 'err') => void

type Refaccion = {
  id: number; nombre: string; precio_venta: string
  stock: number; para_venta: boolean; codigo_barras: string
  bajo_stock: boolean; ubicacion?: string; categoria?: string
}
type Linea = { ref: Refaccion; qty: number }
type Metodo = 'efectivo' | 'tarjeta' | 'transferencia'

// La caja opera dentro de un TURNO (sesión). Sin sesión abierta no se cobra.
type Movimiento = {
  id: number; tipo: string; tipo_label: string; metodo_pago: string
  afecta_efectivo: boolean; monto: string; concepto: string; referencia: string
  venta_id: number | null; creado_en: string; usuario: string | null
}
type Sesion = {
  id: number; caja: string; caja_id: number; usuario: string | null; usuario_id: number
  estado: 'abierta' | 'cerrada'; abierta_en: string; cerrada_en: string | null
  monto_inicial: string; monto_esperado: string | null; monto_contado: string | null
  diferencia: string | null; efectivo_esperado?: string
  por_metodo?: Record<string, string>; movimientos?: Movimiento[]
}

const money = formatMoney
// El precio de venta YA trae IVA (16%): no se suma nada, solo se desglosa para
// mostrarlo. Espejo de lo que hace el backend con la venta de mostrador.
const IVA = 1.16
const precioN = (r: Refaccion) => Number(r.precio_venta) || 0
const METODOS: { k: Metodo; label: string }[] = [
  { k: 'efectivo', label: 'Efectivo' },
  { k: 'tarjeta', label: 'Tarjeta' },
  { k: 'transferencia', label: 'Transfer.' },
]
// Chips de categoría del catálogo (familias del diseño). "Todo" = sin filtro.
const CATEGORIAS = ['Todo', 'Puntas', 'Eléctricos', 'Discos', 'Motor', 'Lubricantes', 'Accesorios']

const input = 'w-full bg-surface-2 border border-edge rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/50 transition-colors'
const label = 'block text-[11px] font-medium text-mute mb-1.5 uppercase tracking-wide'

export default function CajaPOS({ notify }: { notify: Notify }) {
  const [refacciones, setRefacciones] = useState<Refaccion[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'venta' | 'corte'>('venta')

  // Sesión de caja (turno). Sin sesión abierta, el POS muestra "Abrir caja".
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [checandoSesion, setChecandoSesion] = useState(true)
  const cargarSesion = () => {
    api.get<{ sesion: Sesion | null }>('/caja/sesion-actual/')
      .then(r => setSesion(r.data.sesion)).catch(() => {}).finally(() => setChecandoSesion(false))
  }
  useEffect(() => { cargarSesion() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Ticket
  const [lineas, setLineas] = useState<Linea[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todo')     // chip de categoría seleccionado
  const [scan, setScan] = useState('')
  const [scanMsg, setScanMsg] = useState<'' | 'ok' | 'fail' | 'out'>('')
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const recibidoRef = useRef<HTMLInputElement>(null)

  // Cliente (opcional)
  const [mostrarCliente, setMostrarCliente] = useState(false)
  const [cliente, setCliente] = useState('')
  const [telefono, setTelefono] = useState('')

  // Cobro
  const [metodo, setMetodo] = useState<Metodo>('efectivo')
  const [cash, setCash] = useState('')       // efectivo recibido (se teclea directo o con F2/F4)
  const [factura, setFactura] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [ultimo, setUltimo] = useState<{ id: number; folio: string; total: number; cambio: number; metodo: Metodo } | null>(null)
  const [ticketId, setTicketId] = useState<number | null>(null)  // comprobante abierto
  const [devolucionOpen, setDevolucionOpen] = useState(false)
  const [confirmando, setConfirmando] = useState(false)   // paso de confirmación antes de cobrar

  const cargar = () => {
    setCargando(true)
    api.get('/refacciones/')
      .then(r => setRefacciones(Array.isArray(r.data) ? r.data : (r.data?.results || [])))
      .catch(() => notify('No se pudieron cargar las refacciones', 'err'))
      .finally(() => setCargando(false))
  }
  useEffect(cargar, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current) }, [])

  // ── Catálogo ──
  const filtradas = useMemo(() => {
    const s = q.trim().toLowerCase()
    const arr = refacciones.filter(r =>
      (cat === 'Todo' || (r.categoria || '') === cat) &&
      (!s || r.nombre.toLowerCase().includes(s) || r.codigo_barras.toLowerCase().includes(s) || (r.ubicacion || '').toLowerCase().includes(s)))
    return [...arr].sort((a, b) =>
      (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) ||
      (b.para_venta ? 1 : 0) - (a.para_venta ? 1 : 0) ||
      a.nombre.localeCompare(b.nombre))
  }, [q, cat, refacciones])

  const enTicket = (id: number) => lineas.find(l => l.ref.id === id)?.qty || 0

  // ── Ticket ──
  function nuevoTicket() {
    setLineas([]); setCash(''); setUltimo(null); setFactura(false)
    setScan(''); setCliente(''); setTelefono(''); setMostrarCliente(false)
    setTimeout(() => scanRef.current?.focus(), 0)
  }
  function agregar(r: Refaccion) {
    if (r.stock <= 0) { notify('Sin stock', 'err'); return }
    if (ultimo) {   // ya se cobró: este toque arranca un ticket nuevo
      nuevoTicket()
      setLineas([{ ref: r, qty: 1 }])
      return
    }
    setLineas(ls => {
      const i = ls.findIndex(l => l.ref.id === r.id)
      if (i < 0) return [...ls, { ref: r, qty: 1 }]
      if (ls[i].qty >= r.stock) { notify(`Solo hay ${r.stock} en stock`, 'err'); return ls }
      const cp = [...ls]; cp[i] = { ...cp[i], qty: cp[i].qty + 1 }; return cp
    })
  }
  function cambiarQty(id: number, delta: number) {
    if (ultimo) return
    setLineas(ls => ls.flatMap(l => {
      if (l.ref.id !== id) return [l]
      const n = l.qty + delta
      if (n <= 0) return []
      if (n > l.ref.stock) { notify(`Solo hay ${l.ref.stock} en stock`, 'err'); return [l] }
      return [{ ...l, qty: n }]
    }))
  }
  function quitar(id: number) { if (!ultimo) setLineas(ls => ls.filter(l => l.ref.id !== id)) }
  function vaciar() { setLineas([]); setCash(''); setUltimo(null) }

  function marcarScan(m: '' | 'ok' | 'fail' | 'out') {
    setScanMsg(m)
    if (scanTimer.current) clearTimeout(scanTimer.current)
    if (m) scanTimer.current = setTimeout(() => setScanMsg(''), 2200)
  }
  // Enter en la barra (o un lector, que teclea + Enter): código exacto, o el
  // primer nombre que coincida.
  function enviarScan() {
    const s = scan.trim()
    if (!s) return
    const exacta = refacciones.find(r => r.codigo_barras.toLowerCase() === s.toLowerCase())
    const r = exacta || refacciones.find(x => x.nombre.toLowerCase().includes(s.toLowerCase()))
    if (r && r.stock > 0) { agregar(r); setScan(''); marcarScan('ok') }
    else marcarScan(r ? 'out' : 'fail')
    scanRef.current?.focus()
  }

  // ── Cálculos ──
  const total = useMemo(() => lineas.reduce((s, l) => s + precioN(l.ref) * l.qty, 0), [lineas])
  const sub = total / IVA
  const iva = total - sub
  const piezas = lineas.reduce((s, l) => s + l.qty, 0)
  const cashNum = Math.round((parseFloat(cash) || 0) * 100) / 100
  const cambio = cashNum - total
  const esEfectivo = metodo === 'efectivo'
  // Reglas de cobro (caja profesional): en efectivo hay que capturar cuánto paga
  // el cliente y cubrir el total; nunca se cobra sin partidas, con importe cero,
  // dos veces, ni mientras procesa.
  const efectivoIncompleto = esEfectivo && cashNum < total
  const puedeCobrar = lineas.length > 0 && total > 0 && !cobrando && !ultimo && !efectivoIncompleto
  const motivoBloqueo = !lineas.length ? ''
    : total <= 0 ? 'El ticket no tiene importe.'
    : esEfectivo && cashNum === 0 ? 'Captura cuánto paga el cliente para calcular su cambio.'
    : esEfectivo && cashNum < total ? `Faltan ${money(total - cashNum)} para cubrir el total.`
    : ''

  // ── Cobro ──
  function cobrar() {
    if (!puedeCobrar) return
    setCobrando(true)
    api.post('/ventas/mostrador/', {
      nombre_cliente: cliente.trim(),
      telefono_cliente: telefono.trim(),
      metodo_pago: metodo,
      requiere_factura: factura,
      items: lineas.map(l => ({ refaccion_id: l.ref.id, cantidad: l.qty })),
    })
      .then(res => {
        const id = res.data?.venta?.id ?? 0
        const folio = res.data?.venta?.folio ?? ''
        setConfirmando(false)
        notify('Venta registrada')
        setUltimo({ id, folio, total, cambio: esEfectivo ? Math.max(0, cambio) : 0, metodo })
        if (id) setTicketId(id)   // el comprobante aparece solo, como imprimir el ticket
        cargar()        // el stock cambió
        cargarSesion()  // refresca el turno
      })
      .catch(err => {
        // La sesión pudo cerrarse en otra pestaña: el backend responde sin_caja.
        if (err?.response?.data?.codigo === 'sin_caja') { setConfirmando(false); setSesion(null); notify('Debes abrir una caja para registrar la venta', 'err'); return }
        notify(err?.response?.data?.detalle || 'No se pudo cobrar', 'err')
      })
      .finally(() => setCobrando(false))
  }

  // El cobro NO es instantáneo: pide confirmación (evita una venta por un toque
  // accidental en un botón grande). El modal es rápido: Enter confirma.
  function pedirCobro() { if (puedeCobrar) setConfirmando(true) }

  // ── Atajos de teclado (caja física): F2 efectivo · F3 escáner · F4 exacto ·
  //    F9 cobrar · Esc limpiar. El ref guarda el estado más reciente para no
  //    re-enganchar el listener en cada render.
  const kb = useRef({ cobrar: pedirCobro, esEfectivo, total, cash, vista })
  kb.current = { cobrar: pedirCobro, esEfectivo, total, cash, vista }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!['F2', 'F3', 'F4', 'F9', 'Escape'].includes(e.key)) return
      const a = kb.current
      if (a.vista !== 'venta') return
      if (e.key === 'F2') { e.preventDefault(); setMetodo('efectivo'); setUltimo(null); setTimeout(() => recibidoRef.current?.focus(), 0) }
      else if (e.key === 'F3') { e.preventDefault(); scanRef.current?.focus() }
      else if (e.key === 'F4') { e.preventDefault(); if (a.esEfectivo && a.total > 0) { setCash(a.total.toFixed(2)); setUltimo(null) } }
      else if (e.key === 'F9') { e.preventDefault(); a.cobrar() }
      else if (e.key === 'Escape') { if (a.cash) setCash('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sin sesión abierta, el POS no opera: primero hay que abrir la caja.
  if (checandoSesion) return <div className="py-24 text-center text-sm text-mute">Cargando caja…</div>
  if (!sesion) return <AbrirCaja notify={notify} onAbierta={s => { setSesion(s); setVista('venta') }} />
  if (vista === 'corte') return <CerrarCaja sesion={sesion} notify={notify} onVolver={() => { cargarSesion(); setVista('venta') }} onCerrada={() => { setSesion(null); setVista('venta') }} />

  const bloqueado = !!ultimo   // ticket ya cobrado: solo lectura hasta "Nuevo"

  return (
    <div className="flex flex-col gap-4">
      {/* Sesión de caja abierta */}
      <div className="flex items-center gap-2.5 px-4 h-11 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] text-[13px] flex-wrap">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="font-bold text-ink">{sesion.caja} · abierta</span>
        <span className="text-mute">fondo {money(Number(sesion.monto_inicial))} · desde {new Date(sesion.abierta_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}{sesion.usuario ? ` · ${sesion.usuario}` : ''}</span>
        <button onClick={() => setVista('corte')} className="ml-auto font-bold text-emerald-600 dark:text-emerald-400 hover:underline">Arqueo / cerrar caja →</button>
      </div>

      {/* Barra de escaneo */}
      <div className="flex items-center gap-3.5 px-4 h-[68px] rounded-2xl border border-edge bg-surface">
        <span className={`w-10 h-10 shrink-0 grid place-items-center rounded-xl transition-colors ${scanMsg === 'ok' ? 'bg-emerald-500/15 text-emerald-500' : scanMsg ? 'bg-red-500/15 text-red-400' : 'bg-gold/15 text-gold-ink'}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16" /><path strokeLinecap="round" d="M6.5 8.5v7M10 8.5v7M14 8.5v7M17.5 8.5v7" /></svg>
        </span>
        <input
          ref={scanRef} value={scan} autoFocus
          onChange={e => setScan(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') enviarScan() }}
          placeholder="Escanea el código de barras o teclea el SKU y Enter"
          className="flex-1 min-w-0 h-full bg-transparent border-none outline-none text-ink text-base md:text-lg placeholder:text-mute"
        />
        <span className={`hidden sm:block text-[13px] font-semibold whitespace-nowrap ${scanMsg === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : scanMsg ? 'text-red-400' : 'text-mute'}`}>
          {scanMsg === 'ok' ? 'Agregada al ticket' : scanMsg === 'fail' ? 'Código no encontrado' : scanMsg === 'out' ? 'Sin unidades en stock' : 'Enter para agregar'}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* ── Izquierda: ticket + catálogo ── */}
        <div className="w-full lg:flex-1 lg:min-w-0 flex flex-col gap-4">

          {/* Ticket */}
          <section className="bg-surface border border-edge rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-edge flex-wrap">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="text-base font-black text-ink">Ticket</span>
                <span className="text-[13px] text-mute">{lineas.length ? `${lineas.length} ${lineas.length === 1 ? 'partida' : 'partidas'} · ${piezas} pz` : 'Sin partidas'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMostrarCliente(v => !v)} className={`h-9 px-3 rounded-lg border text-[13px] font-semibold transition-colors ${cliente.trim() ? 'border-gold/50 text-gold-ink' : 'border-edge text-ink hover:border-gold/50 hover:text-gold-ink'}`}>
                  {cliente.trim() || '+ Asignar cliente'}
                </button>
                {lineas.length > 0 && !bloqueado && (
                  <button onClick={vaciar} className="h-9 px-3 rounded-lg text-[13px] font-semibold text-mute hover:text-red-400 transition-colors">Vaciar</button>
                )}
              </div>
            </div>

            {/* Cliente (colapsable) */}
            {mostrarCliente && (
              <div className="px-5 py-3 border-b border-edge grid grid-cols-1 sm:grid-cols-2 gap-2 bg-surface-2/40">
                <input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre (público general)" className={input} />
                <input value={telefono} onChange={e => setTelefono(soloTelefono(e.target.value))} inputMode="numeric" maxLength={10} placeholder="Teléfono (opcional)" className={input} />
              </div>
            )}

            {/* Partidas */}
            <div className="max-h-[360px] overflow-y-auto">
              {lineas.length === 0 ? (
                <div className="py-14 px-6 text-center">
                  <svg className="w-9 h-9 mx-auto mb-2.5 text-mute opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5"><path d="M6.5 9.5h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6z" /><path d="M6.5 9.5l-1.2-5h-3" /></svg>
                  <div className="text-base font-bold text-ink">Listo para escanear</div>
                  <div className="text-[13.5px] text-mute mt-1.5">Pasa la refacción por el lector o tócala abajo.</div>
                </div>
              ) : lineas.map((l, i) => (
                <div key={l.ref.id} className={`flex items-center gap-4 px-5 py-3.5 border-b border-edge/60 last:border-0 flex-wrap ${i === lineas.length - 1 ? 'bg-gold/[0.04]' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-ink leading-snug">{l.ref.nombre}</div>
                    <div className="text-[12.5px] text-mute mt-1">{money(precioN(l.ref))} c/u{l.qty >= l.ref.stock ? ' · es todo el stock' : ''}</div>
                  </div>
                  {!bloqueado ? (
                    <div className="flex items-center bg-app border border-edge rounded-xl overflow-hidden">
                      <button onClick={() => cambiarQty(l.ref.id, -1)} className="w-9 h-9 grid place-items-center text-mute hover:bg-surface-2 active:scale-90 transition-[transform,background-color] text-lg">−</button>
                      <span className="min-w-[30px] text-center text-[15px] font-bold text-ink tabular-nums">{l.qty}</span>
                      <button onClick={() => cambiarQty(l.ref.id, 1)} className="w-9 h-9 grid place-items-center text-mute hover:bg-surface-2 active:scale-90 transition-[transform,background-color] text-lg">+</button>
                    </div>
                  ) : (
                    <span className="text-[15px] font-bold text-ink tabular-nums px-2">×{l.qty}</span>
                  )}
                  <div className="w-24 text-right whitespace-nowrap">
                    <div className="text-[15px] font-black text-ink tabular-nums">{money(precioN(l.ref) * l.qty)}</div>
                    {!bloqueado && <button onClick={() => quitar(l.ref.id)} className="text-[12px] font-semibold text-mute hover:text-red-400 transition-colors">Quitar</button>}
                  </div>
                </div>
              ))}
            </div>

            {/* Totales */}
            <div className="px-5 py-3.5 border-t border-edge flex items-end justify-between gap-5 flex-wrap">
              <div className="flex flex-col gap-1 text-[13px] text-mute">
                <span>{piezas === 1 ? '1 pieza' : `${piezas} piezas`}</span>
                <span>Subtotal {money(sub)}</span>
                <span>IVA incluido (16%) {money(iva)}</span>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold tracking-[0.1em] text-mute">TOTAL</div>
                <div className="text-4xl font-black text-price tracking-tight leading-none mt-1 tabular-nums">{money(total)}</div>
              </div>
            </div>
          </section>

          {/* Catálogo */}
          <section className="bg-surface border border-edge rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[15px] font-bold text-ink">Refacciones</span>
              <div className="flex items-center gap-2 h-10 px-3.5 rounded-xl border border-edge bg-app min-w-[220px]">
                <svg className="w-4 h-4 text-mute shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, SKU o ubicación" className="flex-1 min-w-0 bg-transparent border-none outline-none text-ink text-sm placeholder:text-mute" />
              </div>
            </div>

            {/* Chips de categoría */}
            <div className="flex flex-wrap gap-2 mt-3.5">
              {CATEGORIAS.map(c => (
                <button key={c} onClick={() => setCat(c)}
                  className={`h-8 px-3.5 rounded-full text-[13px] border transition-colors ${cat === c ? 'bg-gold/15 border-gold text-gold-ink font-bold' : 'border-edge text-mute hover:text-ink font-medium'}`}>
                  {c}
                </button>
              ))}
            </div>

            {cargando ? (
              <p className="text-sm text-mute py-14 text-center">Cargando refacciones…</p>
            ) : filtradas.length === 0 ? (
              <div className="border border-dashed border-edge rounded-xl p-8 text-center text-[13.5px] text-mute mt-4">
                {q ? `Sin resultados para "${q.trim()}"` : 'No hay refacciones registradas.'}
              </div>
            ) : (
              <div className="grid gap-2.5 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                {filtradas.map(r => {
                  const n = enTicket(r.id)
                  const out = r.stock <= 0
                  const low = r.stock > 0 && r.stock <= 3
                  return (
                    <button
                      key={r.id} onClick={() => agregar(r)} disabled={out}
                      className={`flex flex-col items-start gap-2.5 p-3.5 rounded-xl text-left border transition-[transform,border-color,background-color] active:scale-[0.98] ${n ? 'border-gold bg-gold/[0.06]' : 'border-edge bg-surface-2 hover:border-gold/40'} ${out ? 'opacity-45 cursor-not-allowed active:scale-100 hover:border-edge' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-md ${out ? 'bg-app text-mute' : low ? 'bg-gold/15 text-gold-ink' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                          {out ? 'Agotada' : r.stock === 1 ? 'Última pieza' : low ? `Quedan ${r.stock}` : `${r.stock} pz`}
                        </span>
                        {n > 0 && <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-gold/15 text-gold-ink">{n} en ticket</span>}
                      </div>
                      <div className="w-full">
                        <div className="text-[14px] font-semibold text-ink leading-snug line-clamp-2">{r.nombre}</div>
                        <div className="text-[11.5px] text-mute mt-0.5 truncate">{r.codigo_barras}{r.ubicacion ? ` · ${r.ubicacion}` : ''}</div>
                      </div>
                      <div className="text-[15px] font-black text-ink tabular-nums">{money(precioN(r))}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        {/* ── Derecha: cobro (siempre visible) ── */}
        <section className="w-full lg:w-[340px] lg:shrink-0 lg:sticky lg:top-4 bg-surface border border-edge rounded-2xl p-5 flex flex-col gap-4">
          {/* Método */}
          <div className="grid grid-cols-3 gap-2">
            {METODOS.map(m => (
              <button
                key={m.k} onClick={() => { setMetodo(m.k); setUltimo(null) }}
                className={`h-11 rounded-xl text-sm border transition-colors ${metodo === m.k ? 'bg-gold text-gold-on border-gold font-bold' : 'border-edge text-mute hover:text-ink font-semibold'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Recibido + Cambio (se teclea directo o con F2/F4) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] font-semibold text-mute">{esEfectivo ? 'Recibido' : 'Se cobra'}</span>
              {esEfectivo && <kbd className="px-1.5 py-0.5 rounded border border-edge text-[11px] font-bold text-mute">F2</kbd>}
            </div>
            <div className="bg-app border border-edge rounded-2xl px-5 h-[68px] flex items-center focus-within:border-gold/60 transition-colors">
              {esEfectivo ? (
                <input
                  ref={recibidoRef} value={cash} inputMode="decimal" placeholder="0.00"
                  onChange={e => { setCash(numOnly(e.target.value)); setUltimo(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') pedirCobro() }}
                  className="w-full bg-transparent border-none outline-none text-[32px] font-black text-ink tabular-nums placeholder:text-mute"
                />
              ) : (
                <span className="text-[32px] font-black text-ink tabular-nums">{money(total)}</span>
              )}
            </div>
          </div>
          <div className="bg-app border border-edge rounded-2xl px-5 h-[60px] flex items-center justify-between">
            <span className="text-[13px] font-semibold text-mute">Cambio</span>
            <span className={`text-[26px] font-black tabular-nums ${!esEfectivo || cashNum === 0 ? 'text-mute' : cambio >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-400'}`}>
              {!esEfectivo ? '—' : cashNum > 0 ? (cambio >= 0 ? money(cambio) : `Falta ${money(-cambio)}`) : '—'}
            </span>
          </div>

          {/* Factura */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Necesita factura</span>
            <button
              onClick={() => { setFactura(f => !f); setUltimo(null) }} aria-pressed={factura} aria-label="Necesita factura"
              className={`w-12 h-7 shrink-0 rounded-full p-0.5 flex transition-colors ${factura ? 'bg-gold justify-end' : 'bg-surface-2 justify-start'}`}
            >
              <span className="w-6 h-6 rounded-full bg-white shadow-sm" />
            </button>
          </div>
          {factura && <p className="text-[11.5px] text-mute -mt-2">Se manda a <span className="font-semibold text-ink">Por facturar</span>; los datos fiscales se completan ahí.</p>}

          {/* Cobrar / éxito */}
          {ultimo ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 text-lg font-black">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5L20 6" /></svg>
                  Venta registrada
                </div>
                {ultimo.folio && <div className="text-[12px] font-mono text-mute mt-1">{ultimo.folio}</div>}
                {ultimo.metodo === 'efectivo' && ultimo.cambio > 0 && (
                  <div className="mt-3 pt-3 border-t border-emerald-500/20">
                    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-mute">Cambio a entregar</div>
                    <div className="text-4xl font-black text-ink tabular-nums leading-none mt-1">{money(ultimo.cambio)}</div>
                  </div>
                )}
                <div className="text-[12.5px] text-mute mt-2.5">Cobrado {money(ultimo.total)} · {METODOS.find(m => m.k === ultimo.metodo)?.label}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ultimo.id > 0 && (
                  <button onClick={() => setTicketId(ultimo.id)} className="h-11 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 transition-colors">Ver ticket</button>
                )}
                <button onClick={nuevoTicket} className={`h-11 rounded-xl bg-ink text-app text-sm font-bold hover:opacity-90 transition-opacity ${ultimo.id > 0 ? '' : 'col-span-2'}`}>Nueva venta</button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={pedirCobro} disabled={!puedeCobrar}
                className={`h-14 rounded-2xl text-[17px] font-black active:scale-[0.98] transition-[transform,filter,opacity] ${puedeCobrar ? 'bg-gold text-gold-on shadow-[0_8px_24px_-6px_var(--c-gold-glow)] hover:brightness-[1.06]' : 'bg-surface-2 text-mute cursor-not-allowed active:scale-100'}`}
              >
                {lineas.length ? `Cobrar ${money(total)}` : 'Cobrar'}
              </button>
              {motivoBloqueo && <p className="text-[13px] text-amber-600 dark:text-amber-400 text-center -mt-2">{motivoBloqueo}</p>}
            </>
          )}

          {/* Pendiente / Devolución */}
          <div className="flex gap-2">
            <button onClick={() => notify('Ventas pendientes (apartado): próximamente')} className="flex-1 h-10 rounded-xl border border-edge text-mute hover:text-ink hover:bg-surface-2 text-[13px] font-semibold transition-colors">Pendiente</button>
            <button onClick={() => setDevolucionOpen(true)} className="flex-1 h-10 rounded-xl border border-edge text-mute hover:text-ink hover:bg-surface-2 text-[13px] font-semibold transition-colors">Devolución</button>
          </div>

          {/* Atajos de teclado (caja física) */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] text-mute pt-3 border-t border-edge">
            {([['F3', 'ir al escáner'], ['F2', 'capturar efectivo'], ['F4', 'importe exacto'], ['F9', 'cobrar'], ['Esc', 'limpiar monto']] as const).map(([k, d]) => (
              <span key={k} className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded border border-edge text-[11px] font-bold text-mute shrink-0">{k}</kbd>{d}</span>
            ))}
          </div>
        </section>
      </div>

      {ticketId && <TicketModal url={`/ventas/${ticketId}/comprobante/`} onClose={() => setTicketId(null)} />}
      {devolucionOpen && <DevolucionModal notify={notify} onClose={() => setDevolucionOpen(false)} onDone={() => { setDevolucionOpen(false); cargar(); cargarSesion() }} />}
      {confirmando && (
        <ConfirmarCobro
          total={total} piezas={piezas} metodo={metodo}
          recibido={esEfectivo ? cashNum : total} cambio={esEfectivo ? Math.max(0, cambio) : 0} efectivo={esEfectivo}
          factura={factura} busy={cobrando}
          onConfirm={cobrar} onCancel={() => setConfirmando(false)}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   CONFIRMAR COBRO — paso deliberado antes de finalizar
════════════════════════════════════════ */
function ConfirmarCobro({ total, piezas, metodo, recibido, cambio, efectivo, factura, busy, onConfirm, onCancel }: {
  total: number; piezas: number; metodo: Metodo; recibido: number; cambio: number
  efectivo: boolean; factura: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void
}) {
  // Enter confirma, Esc cancela: deliberado pero rápido.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return createPortal(
    <div className="modal-in fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-[380px] bg-surface border border-edge rounded-3xl overflow-hidden">
        <div className="px-6 pt-6 pb-5 text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-mute">Confirmar venta</p>
          <p className="text-5xl font-black text-ink tabular-nums leading-none mt-2.5">{money(total)}</p>
          <p className="text-[13px] text-mute mt-2.5">{piezas} {piezas === 1 ? 'pieza' : 'piezas'} · {METODOS.find(m => m.k === metodo)?.label}{factura ? ' · con factura' : ''}</p>
        </div>
        {efectivo && (
          <div className="mx-6 mb-5 rounded-2xl bg-app border border-edge divide-y divide-edge">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] text-mute">Recibido</span>
              <span className="text-[15px] font-bold text-ink tabular-nums">{money(recibido)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">Cambio a entregar</span>
              <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{money(cambio)}</span>
            </div>
          </div>
        )}
        <div className="px-6 pb-6 flex gap-2.5">
          <button onClick={onCancel} disabled={busy} className="px-5 h-12 rounded-2xl border border-edge text-mute font-bold hover:text-ink transition-colors disabled:opacity-50">Cancelar</button>
          <button onClick={onConfirm} disabled={busy} autoFocus className="flex-1 h-12 rounded-2xl bg-gold text-gold-on font-black active:scale-[0.98] transition-[transform,filter] hover:brightness-[1.06] disabled:opacity-60 shadow-[0_8px_24px_-6px_var(--c-gold-glow)]">
            {busy ? 'Cobrando…' : 'Confirmar cobro'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ════════════════════════════════════════
   CAJA · abrir sesión, movimientos y arqueo/cierre
════════════════════════════════════════ */
const METODO_LABEL: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }
const numOnly = (s: string) => s.replace(/[^\d.]/g, '')

/* Gate: se muestra cuando el usuario NO tiene una sesión abierta. */
function AbrirCaja({ notify, onAbierta }: { notify: Notify; onAbierta: (s: Sesion) => void }) {
  const [inicial, setInicial] = useState('')
  const [busy, setBusy] = useState(false)
  function abrir() {
    if (busy) return
    setBusy(true)
    api.post<{ sesion: Sesion }>('/caja/sesiones/abrir/', { monto_inicial: inicial || '0' })
      .then(r => { notify('Caja abierta'); onAbierta(r.data.sesion) })
      .catch(e => { setBusy(false); notify(e?.response?.data?.detalle || 'No se pudo abrir la caja', 'err') })
  }
  return (
    <div className="max-w-md mx-auto mt-6 bg-surface border border-edge rounded-2xl p-6 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-gold/15 text-gold-ink grid place-items-center mb-4">
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><rect x="3.5" y="9" width="17" height="10.5" rx="1.5" /><path d="M6.6 9V6.4A1.8 1.8 0 0 1 8.4 4.6h3.2a1.8 1.8 0 0 1 1.6 1L14 9" /><path d="M3.5 12.7h17" /></svg>
      </div>
      <h2 className="text-xl font-black text-ink">Debes abrir una caja</h2>
      <p className="text-[13.5px] text-mute mt-1.5">Para registrar ventas necesitas un turno abierto. Captura con cuánto efectivo empiezas (fondo de caja).</p>
      <div className="mt-5 text-left">
        <label className={label}>Fondo inicial</label>
        <input value={inicial} onChange={e => setInicial(numOnly(e.target.value))} inputMode="decimal" placeholder="0.00" autoFocus className={`${input} text-lg`} onKeyDown={e => { if (e.key === 'Enter') abrir() }} />
      </div>
      <button onClick={abrir} disabled={busy} className="mt-4 w-full h-12 rounded-xl bg-gold text-gold-on font-black hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60">
        {busy ? 'Abriendo…' : 'Abrir caja'}
      </button>
    </div>
  )
}

/* Corte de caja (diseño "Corte de Caja REMALI"): lo que registró el sistema,
   conteo por denominación, movimientos del turno, "debe haber en caja" vs lo
   contado → diferencia, fondo a dejar y cierre. Cableado a la sesión real. */
const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]

function CerrarCaja({ sesion, notify, onVolver, onCerrada }: {
  sesion: Sesion; notify: Notify; onVolver: () => void; onCerrada: () => void
}) {
  const puede = usePuede()
  const [det, setDet] = useState<Sesion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [leave, setLeave] = useState(String(Math.round(Number(sesion.monto_inicial)) || ''))
  const [nota, setNota] = useState('')
  const [cerrando, setCerrando] = useState(false)
  const [cerrada, setCerrada] = useState(false)
  // Registrar movimiento (inline, como el "+ Registrar movimiento" del diseño)
  const [movOpen, setMovOpen] = useState(false)
  const [movMonto, setMovMonto] = useState('')
  const [movConcepto, setMovConcepto] = useState('')
  const [movBusy, setMovBusy] = useState(false)

  const cargar = () => {
    setCargando(true)
    api.get<{ sesion: Sesion }>(`/caja/sesiones/${sesion.id}/`)
      .then(r => setDet(r.data.sesion)).catch(() => notify('No se pudo cargar la caja', 'err')).finally(() => setCargando(false))
  }
  useEffect(cargar, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const movs = det?.movimientos || []
  const porMetodo = det?.por_metodo || {}
  const tickets = movs.filter(m => m.tipo === 'venta').length
  const totalVendido = ['efectivo', 'tarjeta', 'transferencia'].reduce((a, k) => a + Number(porMetodo[k] || 0), 0)
  // Movimientos de efectivo que NO son venta/apertura/cierre: retiros, entradas, devoluciones, ajustes.
  const cashMovs = movs.filter(m => !['venta', 'apertura', 'cierre'].includes(m.tipo))
  const movesTotal = cashMovs.filter(m => m.afecta_efectivo).reduce((a, m) => a + Number(m.monto), 0)
  const fondo = Number(det?.monto_inicial ?? sesion.monto_inicial)
  const ventaEfectivo = Number(porMetodo['efectivo'] || 0)
  const esperado = Number(det?.efectivo_esperado || 0)

  const counted = DENOMS.reduce((a, d) => a + d * (parseInt(counts[d], 10) || 0), 0)
  const anyCount = DENOMS.some(d => (parseInt(counts[d], 10) || 0) > 0)
  const dif = counted - esperado
  const needsNote = anyCount && Math.abs(dif) >= 1
  const blocked = !anyCount || (needsNote && !nota.trim())
  const leaveNum = Math.max(0, parseFloat(numOnly(leave)) || 0)
  const toDeliver = Math.max(0, counted - leaveNum)

  const rows = [
    { k: 'Efectivo', v: money(Number(porMetodo['efectivo'] || 0)) },
    { k: 'Tarjeta', v: money(Number(porMetodo['tarjeta'] || 0)) },
    { k: 'Transferencia', v: money(Number(porMetodo['transferencia'] || 0)) },
    { k: 'Tickets cobrados', v: String(tickets) },
  ]

  function setCount(d: number, v: string) {
    setCounts(c => ({ ...c, [d]: v.replace(/[^0-9]/g, '').slice(0, 4) }))
    setCerrada(false)
  }
  function registrarMov(tipo: 'entrada' | 'retiro' | 'ajuste') {
    if (Number(movMonto) <= 0) { notify('Escribe un monto mayor a cero', 'err'); return }
    setMovBusy(true)
    api.post<{ sesion: Sesion }>(`/caja/sesiones/${sesion.id}/movimiento/`, { tipo, monto: movMonto, concepto: movConcepto.trim() })
      .then(r => { setDet(r.data.sesion); setMovMonto(''); setMovConcepto(''); setMovOpen(false); notify('Movimiento registrado') })
      .catch(e => notify(e?.response?.data?.detalle || 'No se pudo registrar', 'err'))
      .finally(() => setMovBusy(false))
  }
  function cerrar() {
    if (blocked || cerrando) return
    setCerrando(true)
    api.post(`/caja/sesiones/${sesion.id}/cerrar/`, { monto_contado: counted, notas_cierre: nota.trim() })
      .then(() => { setCerrada(true); notify('Turno cerrado') })
      .catch(e => { setCerrando(false); notify(e?.response?.data?.detalle || 'No se pudo cerrar', 'err') })
  }

  // Tono de la caja de diferencia: neutro / cuadra (verde) / sobra (azul) / falta (rojo).
  const tono = !anyCount ? { box: 'border-edge bg-surface-2 text-mute', label: 'DIFERENCIA', val: '—' }
    : Math.abs(dif) < 1 ? { box: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'CUADRA', val: money(0) }
    : dif > 0 ? { box: 'border-blue-500/35 bg-blue-500/10 text-blue-600 dark:text-blue-400', label: 'SOBRA', val: money(dif) }
    : { box: 'border-red-500/35 bg-red-500/10 text-red-500 dark:text-red-400', label: 'FALTA', val: money(-dif) }
  const difNota = !anyCount ? 'Captura el conteo del cajón para comparar.'
    : Math.abs(dif) < 1 ? 'El conteo coincide con lo esperado.'
    : dif > 0 ? 'Hay más efectivo del esperado. Revisa si falta registrar una venta.'
    : 'Falta efectivo. Revisa cambios entregados y tickets en efectivo.'
  const fechaTurno = new Date(sesion.abierta_en).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onVolver} aria-label="Volver a la caja" className="w-10 h-10 shrink-0 grid place-items-center rounded-xl border border-edge text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="min-w-0">
            <h2 className="text-base font-black text-ink">Corte de caja</h2>
            <p className="text-[12.5px] text-mute truncate">{det?.caja || sesion.caja} · turno desde {fechaTurno}{det?.usuario ? ` · ${det.usuario}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => notify('Impresión del corte: próximamente')} className="h-10 px-4 rounded-xl border border-edge text-mute hover:text-ink hover:bg-surface-2 text-[13.5px] font-semibold transition-colors">Imprimir</button>
          <button onClick={() => notify('Descarga PDF del corte: próximamente')} className="h-10 px-4 rounded-xl border border-edge text-mute hover:text-ink hover:bg-surface-2 text-[13.5px] font-semibold transition-colors">Descargar PDF</button>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-mute py-16 text-center">Cargando corte…</p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* ── Izquierda ── */}
          <div className="w-full lg:flex-1 lg:min-w-0 flex flex-col gap-4">

            {/* Lo que registró el sistema */}
            <section className="bg-surface border border-edge rounded-2xl p-6">
              <div className="text-[17px] font-black text-ink">Lo que registró el sistema</div>
              <div className="text-[13px] text-mute mt-1">{tickets} {tickets === 1 ? 'ticket cobrado' : 'tickets cobrados'} en el turno.</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 mt-4">
                {rows.map(r => (
                  <div key={r.k} className="flex items-baseline justify-between gap-4 py-3 border-t border-edge/70">
                    <span className="text-sm text-mute">{r.k}</span>
                    <span className="text-[15px] font-bold text-ink tabular-nums">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline justify-between gap-4 mt-3 pt-4 border-t border-edge">
                <span className="text-[15px] font-bold text-ink">Total vendido</span>
                <span className="text-2xl font-black text-price tabular-nums">{money(totalVendido)}</span>
              </div>
            </section>

            {/* Cuenta el efectivo */}
            <section className="bg-surface border border-edge rounded-2xl p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[17px] font-black text-ink">Cuenta el efectivo</div>
                  <div className="text-[13px] text-mute mt-1">Escribe cuántos billetes y monedas hay en el cajón.</div>
                </div>
                <button onClick={() => { setCounts({}); setNota(''); setCerrada(false) }} className="h-9 px-3 rounded-lg text-[13px] font-semibold text-mute hover:text-ink hover:bg-surface-2 transition-colors">Limpiar</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-5">
                {DENOMS.map(d => {
                  const n = parseInt(counts[d], 10) || 0
                  return (
                    <div key={d} className="flex items-center gap-3 px-3.5 py-2.5 border border-edge rounded-xl bg-surface-2">
                      <span className="text-sm font-semibold text-ink w-[62px] shrink-0">${d.toLocaleString('es-MX')}</span>
                      <input value={counts[d] || ''} onChange={e => setCount(d, e.target.value)} inputMode="numeric" placeholder="0" className="w-16 shrink-0 h-10 px-2 text-center text-[15px] font-bold text-ink bg-app border border-edge rounded-lg focus:outline-none focus:border-gold/60 transition-colors" />
                      <span className={`flex-1 min-w-0 text-right text-[13.5px] tabular-nums ${n ? 'text-ink' : 'text-mute'}`}>{n ? money(d * n).replace('.00', '') : '—'}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-baseline justify-between gap-4 mt-4 pt-4 border-t border-edge">
                <span className="text-[15px] font-bold text-ink">Contado en cajón</span>
                <span className="text-2xl font-black text-ink tabular-nums">{money(counted)}</span>
              </div>
            </section>

            {/* Movimientos del turno */}
            <section className="bg-surface border border-edge rounded-2xl overflow-hidden">
              <div className="p-6 pb-4">
                <div className="text-[17px] font-black text-ink">Movimientos del turno</div>
                <div className="text-[13px] text-mute mt-1">Retiros, ingresos y devoluciones que afectan el efectivo.</div>
              </div>
              {cashMovs.length === 0 ? (
                <div className="px-6 pb-2 text-[13.5px] text-mute">Sin movimientos de efectivo en el turno.</div>
              ) : cashMovs.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-4 px-6 py-3.5 border-t border-edge/70 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold text-ink">{m.tipo_label}{m.concepto ? ` · ${m.concepto}` : ''}</div>
                    <div className="text-[12.5px] text-mute mt-0.5">{new Date(m.creado_en).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}{m.referencia ? ` · ${m.referencia}` : ''}{m.usuario ? ` · ${m.usuario}` : ''}</div>
                  </div>
                  <span className={`text-[15px] font-bold tabular-nums whitespace-nowrap ${Number(m.monto) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{Number(m.monto) >= 0 ? '+' : '−'}{money(Math.abs(Number(m.monto)))}</span>
                </div>
              ))}
              <div className="p-6 pt-4 border-t border-edge/70">
                {movOpen ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={movMonto} onChange={e => setMovMonto(numOnly(e.target.value))} inputMode="decimal" placeholder="Monto" className={input} />
                      <input value={movConcepto} onChange={e => setMovConcepto(e.target.value)} placeholder="Concepto (ej. retiro a bóveda)" className={input} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => registrarMov('entrada')} disabled={movBusy} className="h-10 px-3.5 rounded-xl border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[13px] font-bold hover:bg-emerald-500/10 transition disabled:opacity-50">+ Entrada</button>
                      <button onClick={() => registrarMov('retiro')} disabled={movBusy} className="h-10 px-3.5 rounded-xl border border-red-500/30 text-red-500 text-[13px] font-bold hover:bg-red-500/10 transition disabled:opacity-50">− Retiro</button>
                      {puede('ver_dinero') && <button onClick={() => registrarMov('ajuste')} disabled={movBusy} className="h-10 px-3.5 rounded-xl border border-edge text-mute text-[13px] font-bold hover:text-ink transition disabled:opacity-50">Ajuste</button>}
                      <button onClick={() => { setMovOpen(false); setMovMonto(''); setMovConcepto('') }} className="h-10 px-3.5 rounded-xl text-mute text-[13px] font-semibold hover:text-ink transition ml-auto">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setMovOpen(true)} className="h-10 px-4 rounded-xl border border-edge text-ink text-[13.5px] font-semibold hover:border-gold/50 hover:text-gold-ink transition-colors">+ Registrar movimiento</button>
                )}
              </div>
            </section>
          </div>

          {/* ── Derecha (sticky) ── */}
          <aside className="w-full lg:w-[340px] lg:shrink-0 lg:sticky lg:top-4 bg-surface border border-edge rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <div className="text-[11px] font-bold tracking-[0.1em] text-mute">DEBE HABER EN CAJA</div>
              <div className="text-3xl font-black text-ink tracking-tight mt-1 tabular-nums">{money(esperado)}</div>
              <p className="text-[12.5px] text-mute leading-relaxed mt-2">Fondo inicial más ventas en efectivo, menos retiros y devoluciones.</p>
            </div>

            <div className={`rounded-2xl border p-4 ${tono.box}`}>
              <div className="text-[12px] font-bold tracking-[0.06em]">{tono.label}</div>
              <div className="text-[28px] font-black tracking-tight mt-1 tabular-nums">{tono.val}</div>
              <p className="text-[12.5px] leading-relaxed mt-1.5 opacity-90">{difNota}</p>
            </div>

            {needsNote && (
              <label className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-ink">Explica la diferencia</span>
                <input value={nota} onChange={e => { setNota(e.target.value); setCerrada(false) }} placeholder="Ej. faltó cambio de un ticket" className={input} />
              </label>
            )}

            <div className="flex flex-col gap-2.5 pt-4 border-t border-edge text-[13.5px]">
              <div className="flex justify-between gap-3"><span className="text-mute">Fondo inicial</span><span className="font-semibold text-ink tabular-nums">{money(fondo)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-mute">Ventas en efectivo</span><span className="font-semibold text-ink tabular-nums">{money(ventaEfectivo)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-mute">Movimientos</span><span className="font-semibold text-ink tabular-nums">{movesTotal >= 0 ? '+' : '−'}{money(Math.abs(movesTotal))}</span></div>
            </div>

            <label className="flex items-center justify-between gap-4 pt-4 border-t border-edge">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Dejar fondo para mañana</span>
                <span className="block text-[12.5px] text-mute mt-0.5">Se queda en el cajón.</span>
              </span>
              <input value={leave} onChange={e => setLeave(numOnly(e.target.value))} inputMode="decimal" className="w-24 h-11 px-3 text-center text-[15px] font-bold text-ink bg-app border border-edge rounded-xl focus:outline-none focus:border-gold/60 transition-colors" />
            </label>
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-mute">A entregar en oficina</span><span className="font-bold text-ink tabular-nums">{money(toDeliver)}</span>
            </div>

            {cerrada ? (
              <>
                <div className="h-14 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center text-base font-black">✓ Turno cerrado</div>
                <p className="text-[13px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-xl p-3.5 leading-relaxed">Se envió el corte a administración y la caja quedó lista para el siguiente turno.</p>
                <button onClick={onCerrada} className="h-11 rounded-xl bg-ink text-app font-black hover:opacity-90 active:scale-[0.99] transition">Listo</button>
              </>
            ) : (
              <>
                <button onClick={cerrar} disabled={blocked || cerrando} className={`h-14 rounded-2xl text-base font-black active:scale-[0.99] transition-[transform,background-color,opacity] ${!blocked ? 'bg-gold text-gold-on hover:opacity-90' : 'bg-surface-2 text-mute cursor-not-allowed active:scale-100'}`}>
                  {cerrando ? 'Cerrando…' : 'Cerrar turno y entregar'}
                </button>
                <p className="text-[12.5px] text-mute text-center leading-relaxed -mt-1.5">
                  {!anyCount ? 'Captura el conteo del cajón para cerrar el turno.' : needsNote && !nota.trim() ? 'Explica la diferencia para poder cerrar.' : 'Se registrará el arqueo y se cerrará el turno.'}
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════
   DEVOLUCIÓN — busca una venta y la reversa
════════════════════════════════════════ */
type VentaReciente = { id: number; folio: string | null; fecha: string; cliente: string; metodo_pago: string; total: string; piezas: number; resumen: string }

function DevolucionModal({ notify, onClose, onDone }: { notify: Notify; onClose: () => void; onDone: () => void }) {
  // Quien ya ve las cuentas se autoriza solo; el cajero pide las credenciales de
  // un gerente (override de supervisor en el mostrador).
  const verDinero = usePuede()('ver_dinero')
  const [q, setQ] = useState('')
  const [ventas, setVentas] = useState<VentaReciente[]>([])
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState<VentaReciente | null>(null)
  const [motivo, setMotivo] = useState('')
  const [autUsuario, setAutUsuario] = useState('')
  const [autPassword, setAutPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const buscar = (texto: string) => {
    setCargando(true)
    api.get<{ ventas: VentaReciente[] }>('/caja/ventas-recientes/', { params: texto ? { q: texto } : {} })
      .then(r => setVentas(r.data.ventas)).catch(() => notify('No se pudieron cargar las ventas', 'err')).finally(() => setCargando(false))
  }
  // Carga inicial + búsqueda con debounce.
  useEffect(() => {
    const t = setTimeout(() => buscar(q.trim()), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q])   // eslint-disable-line react-hooks/exhaustive-deps

  function confirmar() {
    if (!sel || busy) return
    if (!verDinero && (!autUsuario.trim() || !autPassword)) { notify('Ingresa el usuario y la contraseña del gerente que autoriza', 'err'); return }
    setBusy(true)
    api.post<{ reembolso: string; autorizo?: string }>('/caja/devolucion/', {
      venta_id: sel.id, motivo: motivo.trim(),
      ...(verDinero ? {} : { autoriza_usuario: autUsuario.trim(), autoriza_password: autPassword }),
    })
      .then(r => { notify(`Devolución registrada · reembolso ${money(Number(r.data.reembolso))}${r.data.autorizo ? ' · autorizó ' + r.data.autorizo : ''}`); onDone() })
      .catch(e => { setBusy(false); notify(e?.response?.data?.detalle || 'No se pudo devolver', 'err') })
  }

  return createPortal(
    <div className="modal-in fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-[520px] bg-surface border border-edge rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-ink text-lg">Devolución</h2>
            <p className="text-[12.5px] text-mute">Busca la venta a devolver. El reembolso sale de esta caja.</p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1 shrink-0"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {!sel ? (
          <>
            <div className="px-6 py-3 border-b border-edge">
              <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Buscar por folio o cliente…" className={input} />
            </div>
            <div className="flex-1 overflow-y-auto min-h-[160px]">
              {cargando ? (
                <p className="text-sm text-mute py-12 text-center">Cargando…</p>
              ) : ventas.length === 0 ? (
                <p className="text-sm text-mute py-12 text-center">{q ? 'Sin coincidencias.' : 'Sin ventas de mostrador.'}</p>
              ) : (
                <ul className="divide-y divide-edge">
                  {ventas.map(v => (
                    <li key={v.id}>
                      <button onClick={() => setSel(v)} className="w-full text-left px-6 py-3 hover:bg-surface-2 transition-colors flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-ink">{v.folio || `#${v.id}`}</span>
                            <span className="text-[11px] text-mute">{new Date(v.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-[12.5px] text-mute truncate">{v.cliente} · {v.piezas} pz · {v.resumen}</p>
                        </div>
                        <span className="font-black text-ink tabular-nums shrink-0">{money(Number(v.total))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="p-6 flex flex-col gap-4">
            <div className="rounded-xl border border-edge bg-surface-2/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-ink">{sel.folio || `#${sel.id}`}</span>
                <span className="text-lg font-black text-ink tabular-nums">{money(Number(sel.total))}</span>
              </div>
              <p className="text-[12.5px] text-mute mt-1">{sel.cliente} · {sel.piezas} pz · {METODO_LABEL[sel.metodo_pago] || sel.metodo_pago}</p>
              <p className="text-[12.5px] text-ink mt-1">{sel.resumen}</p>
            </div>
            <div>
              <label className={label}>Motivo (opcional)</label>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Pieza defectuosa, equivocada…" className={input} />
            </div>
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400">
              Se reabastece el stock y {sel.metodo_pago === 'efectivo' ? `se entregan ${money(Number(sel.total))} en efectivo` : 'se revierte el pago'}. Queda registrado (la venta no se borra).
            </div>
            {!verDinero && (
              <div className="rounded-xl border border-gold/30 bg-gold/[0.06] p-4">
                <p className="text-[12.5px] font-bold text-ink">Autorización del gerente</p>
                <p className="text-[11px] text-mute mb-2.5">Un gerente o administrador debe autorizar la devolución.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={autUsuario} onChange={e => setAutUsuario(e.target.value)} autoComplete="off" placeholder="Usuario del gerente" className={input} />
                  <input value={autPassword} onChange={e => setAutPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Contraseña" className={input} onKeyDown={e => { if (e.key === 'Enter') confirmar() }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setSel(null)} disabled={busy} className="px-4 py-3 rounded-xl border border-edge text-mute text-sm font-semibold hover:text-ink transition-colors disabled:opacity-50">Volver</button>
              <button onClick={confirmar} disabled={busy} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-black hover:bg-red-600 active:scale-[0.99] transition disabled:opacity-60">
                {busy ? 'Procesando…' : `${verDinero ? 'Devolver' : 'Autorizar y devolver'} ${money(Number(sel.total))}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
