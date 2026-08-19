import { useState, useMemo, useEffect } from 'react'
import { useCart, MODALIDAD_LABEL } from '../store/cart'
// Solo el TIPO: la función se importa dinámicamente al descargar, para que
// jsPDF (~350 KB) no entre al bundle inicial de la tienda.
import type { downloadCotizacionPdf } from '../lib/pdf'
import { Link } from 'react-router-dom'
import { useToast } from '../store/toast'
import api from '../lib/api'
import {
  listarBorradores, crearBorrador, actualizarBorrador, eliminarBorrador as borrarEnServidor,
  enviarBorrador as enviarAlServidor, mandarAAutorizar, migrarBorradoresLocales,
  reclamarEspacio, aLineasDeCarrito, tieneEquiposCaidos, totalBorrador,
  MAX_BORRADORES, type Borrador,
} from '../lib/borradores'
import Migas from '../components/Migas'
import { waLink } from '../lib/whatsapp'
import { useConfigPublica } from '../lib/configPublica'
import { useProfile } from '../store/profile'
import { formatMoney } from '../lib/utils'

const inputBase = 'w-full bg-surface-2 border rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none transition-colors'
const money = formatMoney

// Periodos que se cobran de una línea: la duración en renta; 1 en venta.
type LineaMin = { price: number; qty: number; unit?: string; duracion?: number }
const periodosDe = (i: LineaMin) => (i.unit && i.unit !== 'venta') ? (i.duracion || 1) : 1
const importeLinea = (i: LineaMin) => i.price * i.qty * periodosDe(i)
const PERIODO_PLURAL: Record<string, string> = { dia: 'días', semana: 'semanas', mes: 'meses' }
const periodoTxt = (unit: string | undefined, n: number) => {
  const base = ((MODALIDAD_LABEL as Record<string, string>)[unit || 'dia'] || '').replace('renta por ', '') || 'día'
  return n === 1 ? base : (PERIODO_PLURAL[unit || 'dia'] || base + 's')
}

/** Carga jsPDF bajo demanda y genera el PDF de la cotización. */
const pedirPdf = async (args: Parameters<typeof downloadCotizacionPdf>[0]) =>
  (await import('../lib/pdf')).downloadCotizacionPdf(args)

/* A NIVEL DE MÓDULO a propósito. Si se define dentro de Cotizacion(), cada
   tecleo re-crea el componente y React remonta el <input> de adentro: pierde el
   foco y solo deja escribir un carácter. Fuera, su identidad es estable. */
function Field({ label, ok, showErrors, children }: { label: string; ok: boolean; showErrors: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold tracking-wide text-mute mb-1.5 uppercase">{label}</label>
      {children}
      {showErrors && !ok && <p className="text-[11px] text-red-500 mt-1">Campo obligatorio</p>}
    </div>
  )
}

type ObraCli = { id: number; nombre: string; responsable: string; direccion: string; telefono: string }

export default function Cotizacion() {
  const { state, dispatch } = useCart()
  const { notify } = useToast()
  const cfg = useConfigPublica()   // WhatsApp del negocio, configurado en el panel
  const { user } = useProfile()    // si hay sesión, precargamos su perfil
  const [prefilled, setPrefilled] = useState(false)
  const [obras, setObras] = useState<ObraCli[]>([])   // obras guardadas del cliente
  const [nombre, setNombre] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [responsable, setResponsable] = useState('')
  const [obraTelefono, setObraTelefono] = useState('')
  const [factura, setFactura] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentFolio, setSentFolio] = useState<string | null>(null)
  const [sentWaMsg, setSentWaMsg] = useState('')
  // Snapshot para poder descargar el PDF DESPUÉS de enviar (el carrito ya se limpió).
  const [sentPdfArgs, setSentPdfArgs] = useState<Parameters<typeof downloadCotizacionPdf>[0] | null>(null)
  // Liga pública (PDF con token) que regresa el backend al crear la solicitud.
  const [sentLiga, setSentLiga] = useState<string | null>(null)
  const [sentResumen, setSentResumen] = useState<{ items: typeof state.items; total: number; obra: string } | null>(null)
  const [ligaCopiada, setLigaCopiada] = useState(false)

  // Autorrelleno desde el perfil: le ahorra al cliente volver a escribir sus
  // datos. Solo rellena lo que está vacío (con `v || ...`), así nunca pisa lo
  // que ya haya tecleado, aunque el fetch llegue tarde.
  useEffect(() => {
    if (!user) return
    let vivo = true
    api.get('/auth/perfil/').then(r => {
      if (!vivo) return
      const p = r.data || {}
      const keep = (v: string, val?: string) => v || (val || '').trim()
      setNombre(v => keep(v, p.first_name))
      setEmpresa(v => keep(v, p.empresa))
      setEmail(v => keep(v, p.email))
      setTelefono(v => v || (p.telefono || '').replace(/\D+/g, '').slice(0, 10))
      setResponsable(v => keep(v, p.obra_responsable))
      setDireccion(v => keep(v, p.obra_direccion))
      if (p.first_name || p.empresa || p.telefono) setPrefilled(true)
    }).catch(() => { /* sin sesión o sin perfil: se llena a mano */ })
    // Obras guardadas: para elegir una y no re-escribir sus datos.
    api.get<ObraCli[]>('/obras-cliente/').then(r => vivo && setObras(r.data || [])).catch(() => {})
    return () => { vivo = false }
  }, [user])

  // Elegir una obra guardada llena sus campos (reemplaza lo que hubiera).
  function usarObra(o: ObraCli) {
    setResponsable(o.responsable || '')
    setDireccion(o.direccion || '')
    setObraTelefono((o.telefono || '').replace(/\D+/g, '').slice(0, 10))
  }

  // Guardar la obra actual en la cuenta, para reusarla después.
  async function guardarObra() {
    if (!direccion.trim() && !responsable.trim()) { notify('Llena la obra antes de guardarla', 'x'); return }
    const nombre = direccion.trim().slice(0, 60) || `Obra ${obras.length + 1}`
    // Sin duplicados: si ya existe una obra igual, no se crea otra.
    const norm = (v: string) => v.trim().toLowerCase()
    if (obras.some(o => norm(o.direccion || o.nombre) === norm(direccion || nombre))) {
      notify('Esa obra ya está guardada en tu cuenta', 'x'); return
    }
    try {
      const r = await api.post<ObraCli>('/obras-cliente/', { nombre, responsable, direccion, telefono: obraTelefono })
      setObras(prev => [...prev.filter(o => o.id !== r.data.id), r.data])
      notify('Obra guardada en tu cuenta')
    } catch { notify('No se pudo guardar la obra', 'x') }
  }

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
  const isPhone10 = (v: string) => v.replace(/\D+/g, '').length === 10
  const validNombre = nombre.trim().length > 0
  const validEmpresa = empresa.trim().length > 0
  const validClientEmail = (email.trim().length === 0) || isEmail(email)
  const validTelefono = isPhone10(telefono)
  const validDireccion = direccion.trim().length > 0
  const validResponsable = responsable.trim().length > 0
  const validObraTelefono = isPhone10(obraTelefono)
  const formValid = useMemo(() => (
    state.items.length > 0 && validNombre && validEmpresa && validClientEmail &&
    validTelefono && validDireccion && validResponsable && validObraTelefono
  ), [state.items, validNombre, validEmpresa, validClientEmail, validTelefono, validDireccion, validResponsable, validObraTelefono])

  // Argumentos del PDF, compartidos por "descargar" y por el snapshot de éxito.
  function pdfArgs() {
    return {
      items: state.items,
      client: { nombre, empresa, email, telefono, direccion, responsable, obra_telefono: obraTelefono },
      coupon: state.coupon,
      iva: factura,
    }
  }
  async function handleDownload() {
    if (!formValid) {
      notify('Completa los campos obligatorios para generar la cotización', 'x')
      setShowErrors(true)
      return
    }
    await pedirPdf(pdfArgs())
  }

  // Envía la solicitud al backend. El navegador manda equipo_id + cantidad + unit;
  // el servidor recalcula los precios (no confía en los del cliente).
  // Éxito del camino "a autorizar": guarda folio y liga del jefe.
  const [sentAut, setSentAut] = useState<{ liga: string } | null>(null)
  const [ligaAutCopiada, setLigaAutCopiada] = useState(false)

  /* Crea el borrador (si no venía de uno) y su liga de autorización. Aquí NO
     nace ninguna cotización ni ningún folio: REMALI no se entera de esto hasta
     que quien autoriza diga que sí. */
  async function crearPorAutorizar(items: typeof state.items, borradorId?: number): Promise<boolean> {
    setSending(true)
    try {
      let id = borradorId
      if (!id) {
        const b = await crearBorrador({ items, ...datosDelFormulario() })
        id = b.id
      } else {
        await actualizarBorrador(id, datosDelFormulario())
      }
      const paquete = await mandarAAutorizar([id], 'lista', '')
      setSentAut({ liga: `${window.location.origin}${paquete.liga}` })
      await recargarBorradores()
      return true
    } catch (err: any) {
      notify(err?.response?.data?.detalle || 'No se pudo preparar la autorización', 'x')
      return false
    } finally { setSending(false) }
  }

  /* El camino con JEFE: la cotización queda "por autorizar", el jefe recibe
     una liga pública (sin cuenta) y al autorizar llega SOLA a REMALI. */
  async function autorizarCarrito() {
    if (!formValid) {
      notify('Completa los campos obligatorios para mandarla a autorizar', 'x')
      setShowErrors(true)
      return
    }
    if (await crearPorAutorizar(state.items)) dispatch({ type: 'clear' })
  }
  async function autorizarBorrador(b: Borrador) {
    const datosValidos = validNombre && validEmpresa && validClientEmail &&
      validTelefono && validDireccion && validResponsable && validObraTelefono
    if (!datosValidos) {
      cargarBorrador(b)
      setShowErrors(true)
      notify('Cargué el borrador; completa tus datos para mandarlo a autorizar', 'x')
      return
    }
    await crearPorAutorizar(aLineasDeCarrito(b), b.id)
  }

  async function handleSend() {
    if (!formValid) {
      notify('Completa los campos obligatorios para enviar la solicitud', 'x')
      setShowErrors(true)
      return
    }
    setSending(true)
    try {
      const r = await api.post<{ folio: string; liga?: string }>('/tienda/cotizacion/', {
        items: state.items.map(i => ({ equipo_id: i.id, cantidad: i.qty, duracion: periodosDe(i), unit: i.unit || 'venta' })),
        cliente: { nombre, empresa, email, telefono },
        obra: { responsable, direccion, telefono: obraTelefono },
        requiere_factura: factura,
      })
      // Mensaje de WhatsApp pre-llenado (se arma ANTES de limpiar el carrito).
      const resumen = state.items.map(i => `${i.qty}x ${i.title}`).join(', ')
      setSentWaMsg(`Hola, soy ${nombre}. Envié la solicitud de cotización ${r.data.folio}${resumen ? ` (${resumen})` : ''}. Quisiera continuar por aquí.`)
      setSentPdfArgs(pdfArgs())   // conserva los datos para descargar el PDF tras limpiar
      setSentResumen({ items: state.items, total: totalConIVA, obra: direccion.trim() || empresa.trim() })
      setSentLiga(r.data.liga || null)
      setSentFolio(r.data.folio)
      dispatch({ type: 'clear' })
    } catch (err: any) {
      notify(err?.response?.data?.detalle || 'No se pudo enviar la solicitud', 'x')
    } finally {
      setSending(false)
    }
  }

  /* Espejo del backend (cotizaciones/models.py): los precios de VENTA ya
     incluyen IVA (solo se desglosa, nunca se suma); los de RENTA van sin IVA
     y se les suma 16% únicamente si el cliente pide factura. El descuento se
     reparte proporcional entre ambas porciones. */
  const subVenta = state.items.reduce((s, i) => s + (i.unit === 'venta' ? importeLinea(i) : 0), 0)
  const subRenta = state.items.reduce((s, i) => s + (i.unit !== 'venta' ? importeLinea(i) : 0), 0)
  const subtotal = subVenta + subRenta
  const discountAmt = state.coupon ? subtotal * state.coupon.discount : 0
  const factor = subtotal > 0 ? Math.max(0, subtotal - discountAmt) / subtotal : 1
  const ventaNeta = subVenta * factor            // IVA incluido
  const rentaNeta = subRenta * factor            // sin IVA
  const ivaVentaIncluido = ventaNeta - ventaNeta / 1.16   // desglose informativo
  const ivaRenta = factura ? rentaNeta * 0.16 : 0
  const baseSinIVA = ventaNeta / 1.16 + rentaNeta
  const ivaAmt = ivaVentaIncluido + ivaRenta     // lo que la factura desglosaría
  const totalConIVA = ventaNeta + rentaNeta + ivaRenta

  const inp = (ok: boolean) => `${inputBase} ${showErrors && !ok ? 'border-red-500' : 'border-edge focus:border-gold/60'}`

  async function copiarLiga() {
    if (!sentLiga) { notify('Primero envía tu solicitud: la liga se genera con el folio', 'x'); return }
    try {
      await navigator.clipboard.writeText(sentLiga)
      setLigaCopiada(true)
      window.setTimeout(() => setLigaCopiada(false), 2000)
    } catch { notify('No se pudo copiar. Mantén presionado para copiar manualmente', 'x') }
  }

  const monoLabel = 'text-[10.5px] font-mono tracking-[0.14em] text-mute uppercase'

  /* ── El taller del cliente ────────────────────────────────────────────────
     Sus versiones viven en el SERVIDOR, no en este navegador: así no se pierden
     al cambiar de dispositivo y las puede mandar a autorizar. REMALI no las ve.
     El folio nace cuando la manda —directo o autorizada—, nunca antes. */
  const [borradores, setBorradores] = useState<Borrador[]>([])

  const recargarBorradores = async () => {
    try { setBorradores((await listarBorradores()).borradores.filter(b => b.estado === 'armando')) }
    catch { /* el armador sigue sirviendo aunque el taller no cargue */ }
  }

  useEffect(() => {
    reclamarEspacio()
      .then(() => migrarBorradoresLocales())
      .then(n => { if (n) notify(`Subimos ${n} borrador(es) que tenías guardados en este navegador`) })
      // Si el taller no carga, el armador sigue sirviendo para cotizar: es lo
      // que el cliente vino a hacer.
      .catch(() => {})
      .finally(recargarBorradores)
    // Solo al montar: el rescate de lo viejo se hace una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Los datos que el cliente ya capturó en el formulario. Se guardan CON el
   *  borrador para que, si lo manda después desde "Mis cotizaciones", no tenga
   *  que volver a escribirlos. */
  const datosDelFormulario = () => ({
    datos_contacto: { nombre, empresa, email, telefono },
    obra: { responsable, direccion, telefono: obraTelefono },
    requiere_factura: factura,
  })

  async function guardarBorrador() {
    if (!state.items.length) { notify('Agrega equipos antes de guardar el borrador', 'x'); return }
    if (borradores.length >= MAX_BORRADORES) { notify(`Máximo ${MAX_BORRADORES} borradores; borra alguno primero`, 'x'); return }
    const tipo = state.items[0].unit === 'venta' ? 'Venta' : 'Renta'
    const nom = `${tipo} · ${state.items.length} equipo${state.items.length === 1 ? '' : 's'} · ${money(totalConIVA)}`
    try {
      await crearBorrador({ nombre: nom, items: state.items, ...datosDelFormulario() })
      await recargarBorradores()
      notify('Borrador guardado')
    } catch (e) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo guardar', 'x')
    }
  }

  function cargarBorrador(b: Borrador) {
    dispatch({ type: 'reemplazar', items: aLineasDeCarrito(b) })
    if (tieneEquiposCaidos(b)) notify('Alguno de sus equipos ya no está en el catálogo; lo quitamos', 'x')
    else notify('Borrador cargado — revisa y envía cuando quieras')
  }

  async function borrarBorrador(id: number) {
    try { await borrarEnServidor(id); await recargarBorradores() }
    catch { notify('No se pudo borrar el borrador', 'x') }
  }

  /* Mandar UN borrador guardado directo a REMALI, sin tocar el carrito: hizo
     cuatro versiones y manda solo la elegida. El servidor ya tiene sus
     partidas y su precio del día; aquí solo se completan los datos de contacto
     si el formulario los tiene. Al mandarse, el borrador pasa a "entregado" y
     sale del taller — ya vive en el sistema, con folio. */
  async function enviarBorrador(b: Borrador) {
    const datosValidos = validNombre && validEmpresa && validClientEmail &&
      validTelefono && validDireccion && validResponsable && validObraTelefono
    if (!datosValidos) {
      cargarBorrador(b)
      setShowErrors(true)
      notify('Cargué el borrador; completa tus datos de contacto y obra para enviarlo', 'x')
      return
    }
    if (sending) return
    setSending(true)
    try {
      await actualizarBorrador(b.id, datosDelFormulario())
      const { folio } = await enviarAlServidor(b.id)
      const lineas = aLineasDeCarrito(b)
      const resumen = lineas.map(i => `${i.qty}x ${i.title}`).join(', ')
      setSentWaMsg(`Hola, soy ${nombre}. Envié la solicitud de cotización ${folio}${resumen ? ` (${resumen})` : ''}. Quisiera continuar por aquí.`)
      setSentPdfArgs({
        items: lineas,
        client: { nombre, empresa, email, telefono, direccion, responsable, obra_telefono: obraTelefono },
        iva: factura,
      })
      setSentResumen({ items: lineas, total: totalBorrador(b), obra: direccion.trim() || empresa.trim() })
      setSentLiga(null)
      setSentFolio(folio)
      await recargarBorradores()
    } catch (err: any) {
      notify(err?.response?.data?.detalle || 'No se pudo enviar la solicitud', 'x')
    } finally {
      setSending(false)
    }
  }

  if (sentAut) {
    const waJefe = `https://wa.me/?text=${encodeURIComponent(`Hola, te comparto la cotización de maquinaria para autorizar. Ábrela, revisa el total y autorízala aquí:\n${sentAut.liga}`)}`
    return (
      <div className="bg-app min-h-screen text-ink">
        <div className="mx-auto max-w-xl px-6 pt-28 pb-20">
          <div className="rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mb-5">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
            </div>
            <h1 className="text-[22px] font-black leading-tight">Lista para autorización</h1>
            <p className="text-mute text-sm mt-2 max-w-[40ch] mx-auto">
              Mándale esta liga a quien autoriza. No necesita cuenta: revisa, pone su nombre y
              <b className="text-ink"> al autorizar nos llega sola</b> — tú no haces nada más.
            </p>

            <div className="mt-6 text-left rounded-2xl bg-surface-2 border border-edge p-4 space-y-2.5 text-[13px]">
              <div className="flex items-center gap-2.5"><span className="w-5 h-5 rounded-full bg-emerald-500 text-white grid place-items-center text-[10px] font-black shrink-0">✓</span><span><b>Lista</b> — todavía sin folio: REMALI la recibe cuando la autoricen</span></div>
              <div className="flex items-center gap-2.5"><span className="w-5 h-5 rounded-full bg-gold text-black grid place-items-center text-[10px] font-black shrink-0">2</span><span><b>Tu jefe la autoriza</b> desde la liga</span></div>
              <div className="flex items-center gap-2.5"><span className="w-5 h-5 rounded-full bg-surface border border-edge text-mute grid place-items-center text-[10px] font-black shrink-0">3</span><span><b>REMALI la recibe al instante</b> y te contacta</span></div>
            </div>

            <div className="mt-5 flex items-center gap-2.5 bg-surface-2 border border-edge rounded-xl px-3 py-2.5">
              <span className="flex-1 min-w-0 text-[12.5px] text-mute overflow-hidden text-ellipsis whitespace-nowrap">{sentAut.liga.replace(/^https?:\/\//, '')}</span>
              <button onClick={async () => { try { await navigator.clipboard.writeText(sentAut.liga); setLigaAutCopiada(true); setTimeout(() => setLigaAutCopiada(false), 1800) } catch { notify('Copia el texto manualmente', 'x') } }}
                className="h-8 px-3 shrink-0 rounded-lg border border-edge bg-surface text-[12px] font-bold text-ink hover:bg-surface-2 transition-colors">
                {ligaAutCopiada ? '✓ Copiada' : 'Copiar'}
              </button>
              <a href={waJefe} target="_blank" rel="noopener noreferrer"
                className="h-8 px-3 shrink-0 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[12px] font-bold inline-flex items-center hover:bg-emerald-500/25 transition-colors">WhatsApp</a>
            </div>

            <p className="text-[11.5px] text-mute mt-3">También puedes reenviarla después desde "Mis cotizaciones".</p>
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <button onClick={() => setSentAut(null)} className="h-[46px] rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">Hacer otra</button>
              <Link to="/mis-cotizaciones" className="h-[46px] rounded-full bg-gold text-black text-sm font-bold grid place-items-center hover:opacity-90 transition-opacity">Mis cotizaciones</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (sentFolio) {
    const wa = waLink(cfg.whatsapp_principal, sentWaMsg)
    // La autorización ya ocurrió antes de llegar (por la liga o el propio
    // cliente); aquí el flujo es recibida → existencia → fecha/hora → entrega.
    const pasos = [
      { t: 'Cotización recibida', d: `Folio ${sentFolio} generado.`, e: 'HOY', estado: 'ok' },
      { t: 'Revisión de disponibilidad', d: 'Confirmamos que hay existencias en inventario.', e: 'EN CURSO', estado: 'activo' },
      { t: 'Fecha y hora de entrega', d: 'Al confirmar existencias, coordinamos día y hora contigo.', e: 'PENDIENTE', estado: 'pendiente' },
      { t: 'Entrega en obra', d: 'Llevamos el equipo probado a tu obra.', e: 'AL CONFIRMAR', estado: 'pendiente' },
    ]
    return (
      <div className="bg-app min-h-screen text-ink">
        <div className="contenedor pt-24 pb-16 flex flex-col gap-5">

          {/* Encabezado */}
          <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7 flex flex-col min-[900px]:flex-row min-[900px]:items-center gap-6 justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/12 grid place-items-center shrink-0">
                <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <h1 className="text-[28px] sm:text-[34px] font-extrabold tracking-tight leading-none">Cotización enviada</h1>
                <p className="text-mute text-[15px] mt-2">Te contestamos con disponibilidad y precio en firme hoy mismo.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="h-[48px] px-6 rounded-xl bg-[#25D366] text-white text-[15px] font-bold grid place-items-center hover:opacity-90 transition-opacity">Continuar por WhatsApp</a>}
              {sentLiga && (
                <button onClick={copiarLiga} className={`h-[48px] px-5 rounded-xl border text-[14.5px] font-semibold transition-colors ${ligaCopiada ? 'border-emerald-500/50 text-emerald-600' : 'border-edge text-ink hover:bg-surface-2'}`}>
                  {ligaCopiada ? '✓ Copiada' : '⧉ Copiar liga'}
                </button>
              )}
              {sentPdfArgs && <button onClick={() => pedirPdf(sentPdfArgs)} className="h-[48px] px-5 rounded-xl border border-edge text-[14.5px] font-semibold text-ink hover:bg-surface-2 transition-colors">↓ PDF</button>}
            </div>
          </div>

          {/* Qué sigue */}
          <div className="rounded-[20px] border border-edge bg-surface px-6 sm:px-8 py-7">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
              <h2 className="text-[18px] font-extrabold">Qué sigue</h2>
              <span className="text-[12.5px] font-semibold text-gold-ink border border-gold/40 rounded-full px-3.5 py-1.5">Paso 2 de 4 · en revisión ahora</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
              {pasos.map((p, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-6 h-6 rounded-full grid place-items-center border-2 shrink-0 ${p.estado === 'ok' ? 'border-emerald-500 bg-emerald-500/12' : p.estado === 'activo' ? 'border-gold' : 'border-edge'}`}>
                      {p.estado === 'ok' && <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    {i < pasos.length - 1 && <span className={`flex-1 h-px ${p.estado === 'ok' ? 'bg-emerald-500/40' : p.estado === 'activo' ? 'bg-gold/40' : 'bg-edge'}`} />}
                  </div>
                  <p className={`text-[15px] font-bold ${p.estado === 'activo' ? 'text-gold-ink' : ''}`}>{p.t}</p>
                  <p className="text-[13px] text-mute mt-1 leading-snug">{p.d}</p>
                  <p className={`${monoLabel} mt-2`}>{p.e}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid min-[980px]:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            {/* Resumen de lo enviado */}
            <div className="rounded-[20px] border border-edge bg-surface overflow-hidden">
              <div className="px-6 sm:px-8 py-6 flex flex-wrap items-end gap-x-10 gap-y-4 justify-between border-b border-edge">
                <div className="flex flex-wrap gap-x-10 gap-y-4">
                  <div><p className={monoLabel}>Folio</p><p className="font-mono text-[15px] font-bold mt-1">{sentFolio}</p></div>
                  {sentResumen?.obra && <div><p className={monoLabel}>Obra</p><p className="text-[15px] font-bold mt-1 max-w-[260px] truncate">{sentResumen.obra}</p></div>}
                  <div><p className={monoLabel}>Total</p><p className="text-[15px] font-extrabold text-price mt-1">{money(sentResumen?.total ?? 0)}</p></div>
                </div>
                {sentLiga && <a href={sentLiga} target="_blank" rel="noopener noreferrer" className="text-[14px] font-semibold text-gold-ink hover:opacity-80">Ver completa →</a>}
              </div>
              {(sentResumen?.items || []).map(it => (
                <div key={it.lineId} className="px-6 sm:px-8 py-4 border-b border-edge/60 flex items-center gap-4 justify-between">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold leading-snug line-clamp-1">{it.title}</p>
                    <p className="text-[13px] text-mute mt-0.5 capitalize">{MODALIDAD_LABEL[it.unit || 'venta']} · {it.qty} equipo{it.qty === 1 ? '' : 's'}{it.unit && it.unit !== 'venta' ? ` × ${it.duracion || 1} ${periodoTxt(it.unit, it.duracion || 1)}` : ''}</p>
                  </div>
                  <span className="text-[15.5px] font-extrabold shrink-0">{money(importeLinea(it))}</span>
                </div>
              ))}
              <p className="px-6 sm:px-8 py-4 text-[12.5px] text-mute">El total definitivo lo confirma REMALI con la disponibilidad — la liga siempre muestra la versión vigente.</p>
            </div>

            {/* Lateral: contacto + guardar obra */}
            <div className="flex flex-col gap-5">
              <div className="rounded-[20px] border border-edge bg-surface p-6">
                <p className={`${monoLabel} mb-4`}>Tu contacto en REMALI</p>
                <div className="flex items-center gap-3.5 mb-4">
                  <div className="w-11 h-11 rounded-full bg-gold-soft text-gold-ink grid place-items-center font-extrabold">R</div>
                  <div>
                    <p className="text-[15px] font-bold">{cfg.negocio_representante || cfg.negocio_nombre || 'REMALI'}</p>
                    <p className="text-[12.5px] text-mute">Acapulco, Gro.</p>
                  </div>
                </div>
                {(cfg.negocio_telefono || cfg.whatsapp_principal) && (
                  <div className="flex justify-between text-[13.5px] py-1.5"><span className="text-mute">Teléfono</span><span className="font-semibold">{cfg.negocio_telefono || cfg.whatsapp_principal}</span></div>
                )}
                {cfg.negocio_email && <div className="flex justify-between text-[13.5px] py-1.5 gap-3"><span className="text-mute">Correo</span><span className="font-semibold truncate">{cfg.negocio_email}</span></div>}
              </div>

              {user && direccion.trim() && (
                <div className="rounded-[20px] border border-gold/40 bg-gold-soft/40 p-6">
                  <p className="text-[15px] font-extrabold">Guarda esta obra y ahorra tiempo</p>
                  <p className="text-[13px] text-mute mt-1.5 leading-snug">La próxima cotización se llena sola con los datos de esta obra.</p>
                  <button onClick={guardarObra} className="mt-4 h-[44px] px-6 rounded-xl bg-gold text-black text-[14px] font-bold btn-acento">Guardar obra</button>
                </div>
              )}

              <Link to="/equipos" className="text-center text-[14px] font-semibold text-mute hover:text-ink transition-colors">Seguir viendo equipos →</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const tipoActual = state.items.length ? (state.items[0].unit === 'venta' ? 'venta' : 'renta') : null

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-24 pb-16">

        {/* Encabezado */}
        <div className="mb-8">
          <div className="mb-4"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Equipos', to: '/equipos' }, { label: 'Tu cotización' }]} /></div>
          <h1 className="text-[34px] sm:text-[44px] font-extrabold tracking-tight leading-none">Arma tu cotización</h1>
          <p className="text-mute text-[15px] mt-2.5 max-w-[560px]">Ajusta cantidades, llena los datos de tu obra y envíala — te contactamos para confirmar disponibilidad.</p>
        </div>

        {/* Mis borradores: varias versiones para comparar o mandar al jefe */}
        {(borradores.length > 0 || state.items.length > 0) && (
          <div className="mb-6 rounded-[20px] border border-edge bg-surface px-6 py-5">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
              <div>
                <p className="text-[15px] font-bold">Mis borradores</p>
                <p className="text-[12.5px] text-mute mt-0.5">Guarda versiones, baja el PDF de cada una, y envía a REMALI solo la elegida.</p>
              </div>
              {state.items.length > 0 && (
                <button onClick={guardarBorrador} className="h-[40px] px-4 rounded-xl border border-gold/50 text-gold-ink text-[13.5px] font-bold hover:bg-gold-soft transition-colors">
                  + Guardar como borrador
                </button>
              )}
            </div>
            {borradores.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {borradores.map(b => (
                  <div key={b.id} className="relative group/bd">
                    <button onClick={() => cargarBorrador(b)}
                      className="flex flex-col items-start gap-0.5 pl-4 pr-24 py-2.5 rounded-xl border border-edge bg-app text-left hover:border-gold/60 transition-colors active:scale-[0.98]">
                      <span className="text-[13.5px] font-bold text-ink">{b.nombre}</span>
                      <span className="text-[11.5px] text-mute">{new Date(b.creado).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} · toca para cargar</span>
                    </button>
                    <button aria-label="Borrar borrador" onClick={() => borrarBorrador(b.id)}
                      className="absolute top-1.5 right-1.5 w-5 h-5 grid place-items-center rounded-full text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                      <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                    {/* Acciones del borrador: a autorización (jefe) o directo a REMALI */}
                    <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                      <button onClick={() => autorizarBorrador(b)} disabled={sending} title="Su jefe recibe una liga y al autorizar llega sola a REMALI"
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-gold/50 text-gold-ink text-[10.5px] font-black hover:bg-gold-soft transition-colors disabled:opacity-50">
                        <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>
                        Autorizar
                      </button>
                      <button onClick={() => enviarBorrador(b)} disabled={sending}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-gold text-black text-[10.5px] font-black hover:opacity-90 transition-opacity disabled:opacity-50">
                        <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
                        Enviar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid min-[980px]:grid-cols-[minmax(0,1fr)_400px] gap-7 items-start">
          {/* ── Columna izquierda ── */}
          <div className="flex flex-col gap-5 min-w-0">

            {/* Equipos */}
            <div className="rounded-[20px] border border-edge bg-surface overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-edge">
                <span className="text-[16px] font-bold">Equipos <span className="text-mute font-semibold">({state.items.length})</span>{tipoActual && <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-gold-ink">{tipoActual}</span>}</span>
                {state.items.length > 0 && (
                  <button onClick={() => dispatch({ type: 'clear' })} className="text-[13.5px] text-mute hover:text-red-500 transition-colors">Vaciar</button>
                )}
              </div>

              {state.items.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-lg font-bold">Tu cotización está vacía</p>
                  <p className="text-sm text-mute mt-2">Agrega equipos desde el catálogo para calcular el total.</p>
                  <Link to="/equipos" className="inline-block mt-5 px-6 py-3 rounded-xl bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">Ver equipos</Link>
                </div>
              ) : (
                state.items.map(it => (
                  <div key={it.lineId} className="grid grid-cols-[64px_minmax(0,1fr)_auto] sm:grid-cols-[80px_minmax(0,1fr)_auto] gap-4 sm:gap-5 px-6 py-5 border-b border-edge items-center">
                    <div className="aspect-square rounded-xl bg-surface-2 border border-edge overflow-hidden grid place-items-center">
                      {it.image ? <img src={it.image} alt={it.title} className="w-full h-full object-contain p-1" /> : <span className="text-[9px] text-mute">Sin foto</span>}
                    </div>
                    <div className="min-w-0 flex flex-col gap-2.5">
                      <div>
                        <p className="text-[15.5px] font-bold leading-snug line-clamp-1">{it.title}</p>
                        <p className={`${monoLabel} mt-1`}>{MODALIDAD_LABEL[it.unit || 'venta']}</p>
                      </div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Máquinas */}
                        <div className="flex items-center border border-edge rounded-[9px] bg-app overflow-hidden">
                          <button aria-label="Menos equipos" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })} className="w-8 h-[34px] grid place-items-center text-ink hover:bg-surface-2 transition-colors">−</button>
                          <span className="min-w-[44px] text-center text-[13.5px] font-bold">{it.qty} eq.</span>
                          <button aria-label="Más equipos" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })} className="w-8 h-[34px] grid place-items-center text-ink hover:bg-surface-2 transition-colors">+</button>
                        </div>
                        {/* Duración (solo renta): cuántos días/semanas/meses */}
                        {it.unit && it.unit !== 'venta' && (
                          <div className="flex items-center border border-edge rounded-[9px] bg-app overflow-hidden">
                            <button aria-label="Menos duración" onClick={() => dispatch({ type: 'duracion', lineId: it.lineId, duracion: Math.max(1, (it.duracion || 1) - 1) })} className="w-8 h-[34px] grid place-items-center text-ink hover:bg-surface-2 transition-colors">−</button>
                            <span className="min-w-[56px] text-center text-[13.5px] font-bold">{it.duracion || 1} {periodoTxt(it.unit, it.duracion || 1)}</span>
                            <button aria-label="Más duración" onClick={() => dispatch({ type: 'duracion', lineId: it.lineId, duracion: (it.duracion || 1) + 1 })} className="w-8 h-[34px] grid place-items-center text-ink hover:bg-surface-2 transition-colors">+</button>
                          </div>
                        )}
                        <span className="text-[13px] text-mute">{money(it.price)} {it.unit === 'venta' ? 'c/u' : `por ${MODALIDAD_LABEL[it.unit || 'dia'].replace('renta por ', '')}`}</span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <span className="text-[17px] sm:text-[19px] font-extrabold tracking-tight">{money(importeLinea(it))}</span>
                      <button onClick={() => dispatch({ type: 'remove', lineId: it.lineId })} className="text-[13px] text-mute hover:text-red-500 transition-colors">Quitar</button>
                    </div>
                  </div>
                ))
              )}

              {state.items.length > 0 && (
                <div className="px-6 py-4 flex items-center justify-between gap-4">
                  <span className="text-[13px] text-mute hidden sm:block">¿Falta algo? Agrega más equipo sin perder esta lista.</span>
                  <Link to="/equipos" className="shrink-0 px-4 py-2 rounded-[10px] border border-edge text-[13.5px] font-semibold text-ink hover:bg-surface-2 transition-colors">+ Agregar equipo</Link>
                </div>
              )}
            </div>

            {/* Datos de contacto y obra */}
            <div className="rounded-[20px] border border-edge bg-surface p-6">
              <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
                <span className="text-[16px] font-bold">Datos de contacto y obra</span>
                {prefilled && <span className="text-[11px] font-bold uppercase tracking-wide text-gold-ink">✓ Desde tu perfil</span>}
              </div>

              {(obras.length > 0 || user) && (
                <div className="mb-6">
                  <p className={`${monoLabel} mb-2.5`}>Mis obras guardadas</p>
                  <div className="flex gap-2 flex-wrap">
                    {obras.map(o => (
                      <div key={o.id} className="relative group/obra">
                        <button type="button" onClick={() => usarObra(o)}
                          className="flex flex-col items-start gap-0.5 pl-4 pr-8 py-2.5 rounded-xl border border-edge bg-app text-left hover:border-gold/60 transition-colors active:scale-[0.98]">
                          <span className="text-[13.5px] font-bold text-ink max-w-[160px] truncate">{o.nombre}</span>
                          {o.responsable && <span className="text-[12px] text-mute max-w-[160px] truncate">{o.responsable}</span>}
                        </button>
                        <button type="button" aria-label={`Borrar ${o.nombre}`}
                          onClick={async () => {
                            try { await api.delete(`/obras-cliente/${o.id}/`); setObras(prev => prev.filter(x => x.id !== o.id)); notify('Obra borrada') }
                            catch { notify('No se pudo borrar la obra', 'x') }
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 grid place-items-center rounded-full text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                          <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </div>
                    ))}
                    {user && (
                      <button type="button" onClick={guardarObra}
                        className="px-4 py-2.5 rounded-xl border border-dashed border-edge text-[13.5px] font-semibold text-mute hover:text-gold-ink hover:border-gold/50 transition-colors">
                        + Guardar esta obra
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="TU NOMBRE" ok={validNombre} showErrors={showErrors}><input className={inp(validNombre)} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido" /></Field>
                <Field label="EMPRESA / OBRA" ok={validEmpresa} showErrors={showErrors}><input className={inp(validEmpresa)} value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Constructora o nombre de la obra" /></Field>
                <Field label="TELÉFONO / WHATSAPP" ok={validTelefono} showErrors={showErrors}><input type="tel" inputMode="numeric" maxLength={10} className={inp(validTelefono)} value={telefono} onChange={e => setTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} placeholder="10 dígitos" /></Field>
                <Field label="CORREO (OPCIONAL)" ok={validClientEmail} showErrors={showErrors}><input type="email" className={inp(validClientEmail)} value={email} onChange={e => setEmail(e.target.value.toLowerCase())} placeholder="correo@ejemplo.com" /></Field>
                <Field label="QUIÉN AUTORIZA" ok={validResponsable} showErrors={showErrors}><input className={inp(validResponsable)} value={responsable} onChange={e => setResponsable(e.target.value)} placeholder="Encargado o jefe de obra" /></Field>
                <Field label="TELÉFONO EN OBRA" ok={validObraTelefono} showErrors={showErrors}><input type="tel" inputMode="numeric" maxLength={10} className={inp(validObraTelefono)} value={obraTelefono} onChange={e => setObraTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} placeholder="10 dígitos" /></Field>
                <div className="sm:col-span-2">
                  <Field label="DIRECCIÓN DE ENTREGA" ok={validDireccion} showErrors={showErrors}><input className={inp(validDireccion)} value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Calle, número, colonia" /></Field>
                </div>
              </div>
            </div>
          </div>

          {/* ── Resumen (sticky) ── */}
          <aside className="min-[980px]:sticky min-[980px]:top-24 flex flex-col gap-4">
            <div className="rounded-[20px] border border-edge bg-surface p-6 flex flex-col gap-5">
              <span className="text-[16px] font-bold">Resumen</span>

              <div className="flex flex-col gap-2.5 text-sm">
                {subRenta > 0 && <div className="flex justify-between gap-3"><span className="text-mute">Renta (sin IVA)</span><span className="font-semibold">{money(rentaNeta)}</span></div>}
                {subVenta > 0 && <div className="flex justify-between gap-3"><span className="text-mute">Venta (IVA incluido)</span><span className="font-semibold">{money(ventaNeta)}</span></div>}
                {state.coupon && <div className="flex justify-between gap-3"><span className="text-mute">Descuento ({(state.coupon.discount * 100).toFixed(0)}%)</span><span className="font-semibold text-red-500">− {money(discountAmt)}</span></div>}
                {factura && (
                  <div className="border-t border-edge pt-2.5 flex flex-col gap-2.5">
                    <div className="flex justify-between gap-3"><span className="text-mute">Base (sin IVA)</span><span className="font-semibold">{money(baseSinIVA)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-mute">IVA 16%</span><span className="font-semibold">{money(ivaAmt)}</span></div>
                  </div>
                )}
              </div>

              {subRenta > 0 ? (
                <div className="flex items-start gap-3 border-t border-edge pt-4">
                  <button type="button" role="switch" aria-checked={factura} onClick={() => setFactura(f => !f)}
                    className={`w-[46px] h-[26px] rounded-full flex-none p-[3px] flex transition-colors ${factura ? 'bg-gold justify-end' : 'bg-ink/15 justify-start'}`}>
                    <span className="w-5 h-5 rounded-full bg-white shadow block" />
                  </button>
                  <div>
                    <p className="text-sm font-semibold">Necesito factura</p>
                    <p className="text-[12.5px] text-mute mt-0.5 leading-snug">Con factura, la renta suma IVA 16%.</p>
                  </div>
                </div>
              ) : (
                <p className="border-t border-edge pt-4 text-[12.5px] text-mute leading-snug">El precio de venta ya incluye IVA · factura disponible al confirmar.</p>
              )}

              <div className="border-t border-edge pt-4 flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-bold">Total</span>
                <span className="text-[30px] font-extrabold tracking-tight text-price">{money(totalConIVA)}</span>
              </div>

              <div className="flex flex-col gap-2.5">
                <button onClick={handleSend} disabled={sending}
                  className="h-[52px] rounded-[13px] bg-gold text-black text-[15.5px] font-extrabold btn-acento disabled:opacity-50 flex items-center justify-center gap-2">
                  {sending && <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                  Enviar a REMALI
                </button>
                {/* Camino con jefe: queda "por autorizar" y él recibe la liga */}
                <button onClick={autorizarCarrito} disabled={sending}
                  className="h-[44px] rounded-[13px] border border-gold/50 text-gold-ink text-[13.5px] font-bold hover:bg-gold-soft transition-colors disabled:opacity-50">
                  Mandar a autorizar (mi jefe decide)
                </button>
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={handleDownload} className="h-[44px] rounded-xl border border-edge text-[13.5px] font-semibold text-ink hover:bg-surface-2 transition-colors">↓ PDF</button>
                  <button onClick={copiarLiga} title={sentLiga ? 'Copiar liga pública' : 'Se genera al enviar tu solicitud'}
                    className={`h-[44px] rounded-xl border text-[13.5px] font-semibold transition-colors ${ligaCopiada ? 'border-emerald-500/50 text-emerald-600' : 'border-edge text-ink hover:bg-surface-2'}`}>
                    {ligaCopiada ? '✓ Copiada' : '⧉ Copiar liga'}
                  </button>
                </div>
                {waLink(cfg.whatsapp_principal, `Hola REMALI, quiero cotizar: ${state.items.map(i => `${i.qty}x ${i.title}`).join(', ')}. Total estimado ${money(totalConIVA)}.`) && state.items.length > 0 && (
                  <a href={waLink(cfg.whatsapp_principal, `Hola REMALI, quiero cotizar: ${state.items.map(i => `${i.qty}x ${i.title}`).join(', ')}. Total estimado ${money(totalConIVA)}.`)} target="_blank" rel="noopener noreferrer"
                    className="h-[46px] rounded-xl bg-emerald-500/12 text-emerald-500 text-sm font-bold grid place-items-center hover:bg-emerald-500/20 transition-colors">
                    Mandar por WhatsApp
                  </a>
                )}
              </div>
            </div>

            {/* Cómo sigue */}
            <div className="rounded-[20px] border border-edge bg-surface px-6 py-5">
              <p className={`${monoLabel} mb-3`}>Cómo sigue</p>
              <div className="flex flex-col gap-3">
                {[
                  'Envías tu solicitud y te llega el folio.',
                  'Te contactamos para confirmar disponibilidad y condiciones.',
                  'Autorizas y agendamos la entrega en tu obra.',
                ].map((t, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-[11px] font-mono text-gold-ink mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                    <p className="text-[13.5px] text-mute leading-relaxed">{t}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
