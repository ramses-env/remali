import { useState, useMemo } from 'react'
import { useCart, MODALIDAD_LABEL } from '../store/cart'
import { downloadCotizacionPdf } from '../lib/pdf'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../store/toast'
import api from '../lib/api'
import { waLink } from '../lib/whatsapp'
import { useConfigPublica } from '../lib/configPublica'

const inputBase = 'w-full bg-surface-2 border rounded-xl px-4 py-2.5 text-sm text-ink placeholder-mute focus:outline-none transition-colors'
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Cotizacion() {
  const { state, dispatch } = useCart()
  const { notify } = useToast()
  const nav = useNavigate()
  const cfg = useConfigPublica()   // WhatsApp del negocio, configurado en el panel
  const [nombre, setNombre] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [responsable, setResponsable] = useState('')
  const [obraTelefono, setObraTelefono] = useState('')
  const [obraEmail, setObraEmail] = useState('')
  const [factura, setFactura] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentFolio, setSentFolio] = useState<string | null>(null)
  const [sentWaMsg, setSentWaMsg] = useState('')

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
  const isPhone10 = (v: string) => v.replace(/\D+/g, '').length === 10
  const validNombre = nombre.trim().length > 0
  const validEmpresa = empresa.trim().length > 0
  const validClientEmail = (email.trim().length === 0) || isEmail(email)
  const validTelefono = isPhone10(telefono)
  const validDireccion = direccion.trim().length > 0
  const validResponsable = responsable.trim().length > 0
  const validObraTelefono = isPhone10(obraTelefono)
  const validObraEmail = isEmail(obraEmail)
  const formValid = useMemo(() => (
    state.items.length > 0 && validNombre && validEmpresa && validClientEmail &&
    validTelefono && validDireccion && validResponsable && validObraTelefono && validObraEmail
  ), [state.items, validNombre, validEmpresa, validClientEmail, validTelefono, validDireccion, validResponsable, validObraTelefono, validObraEmail])

  async function handleDownload() {
    if (!formValid) {
      notify('Completa los campos obligatorios para generar la cotización', 'x')
      setShowErrors(true)
      return
    }
    await downloadCotizacionPdf({
      items: state.items,
      client: { nombre, empresa, email, telefono, direccion, responsable, obra_telefono: obraTelefono, obra_email: obraEmail },
      coupon: state.coupon,
      iva: factura,
    })
  }

  // Envía la solicitud al backend. El navegador manda equipo_id + cantidad + unit;
  // el servidor recalcula los precios (no confía en los del cliente).
  async function handleSend() {
    if (!formValid) {
      notify('Completa los campos obligatorios para enviar la solicitud', 'x')
      setShowErrors(true)
      return
    }
    setSending(true)
    try {
      const r = await api.post<{ folio: string }>('/tienda/cotizacion/', {
        items: state.items.map(i => ({ equipo_id: i.id, cantidad: i.qty, unit: i.unit || 'venta' })),
        cliente: { nombre, empresa, email, telefono },
        obra: { responsable, direccion, telefono: obraTelefono, email: obraEmail },
        requiere_factura: factura,
      })
      // Mensaje de WhatsApp pre-llenado (se arma ANTES de limpiar el carrito).
      const resumen = state.items.map(i => `${i.qty}x ${i.title}`).join(', ')
      setSentWaMsg(`Hola, soy ${nombre}. Envié la solicitud de cotización ${r.data.folio}${resumen ? ` (${resumen})` : ''}. Quisiera continuar por aquí.`)
      setSentFolio(r.data.folio)
      dispatch({ type: 'clear' })
    } catch (err: any) {
      notify(err?.response?.data?.detalle || 'No se pudo enviar la solicitud', 'x')
    } finally {
      setSending(false)
    }
  }

  const subtotal = state.items.reduce((s, i) => s + i.price * i.qty, 0)
  const discountAmt = state.coupon ? subtotal * state.coupon.discount : 0
  const preTaxTotal = Math.max(0, subtotal - discountAmt)
  const ivaAmt = factura ? preTaxTotal * 0.16 : 0
  const totalConIVA = preTaxTotal + ivaAmt

  const inp = (ok: boolean) => `${inputBase} ${showErrors && !ok ? 'border-red-500' : 'border-edge focus:border-gold/60'}`
  const Field = ({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) => (
    <div>
      <label className="block text-[11px] font-bold tracking-wide text-mute mb-1.5 uppercase">{label}</label>
      {children}
      {showErrors && !ok && <p className="text-[11px] text-red-500 mt-1">Campo obligatorio</p>}
    </div>
  )

  if (sentFolio) {
    return (
      <div className="bg-app min-h-screen text-ink flex flex-col items-center justify-center px-6 text-center py-32">
        <div className="w-16 h-16 rounded-full bg-emerald-500/12 flex items-center justify-center mb-5">
          <svg className="w-9 h-9 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-extrabold text-ink">¡Solicitud enviada!</h1>
        <p className="text-mute text-sm mt-2 max-w-sm">Recibimos tu solicitud <b className="text-ink font-mono">{sentFolio}</b>. Para agilizar, escríbenos por WhatsApp y continuamos por ahí.</p>
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          {waLink(cfg.whatsapp_principal, sentWaMsg) && (
            <a href={waLink(cfg.whatsapp_principal, sentWaMsg)} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 rounded-full bg-[#25D366] text-white text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
              Continuar por WhatsApp
            </a>
          )}
          <Link to="/equipos" className="px-5 py-2.5 rounded-full border border-edge text-ink text-sm font-bold hover:bg-surface-2 transition-colors flex items-center justify-center">Seguir viendo equipos</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-app min-h-screen text-ink">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-8 lg:px-12 pt-24 pb-16">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => nav(-1)} aria-label="Volver" className="w-10 h-10 grid place-items-center rounded-full text-mute hover:text-ink hover:bg-surface-2 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-2xl font-extrabold text-ink">Tu cotización</h1>
        </div>

        <div className="grid min-[900px]:grid-cols-[1fr_420px] gap-6 items-start">
          {/* ── Equipos a cotizar ── */}
          <div className="space-y-2.5">
            {state.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 rounded-2xl border border-edge bg-surface">
                <div className="w-16 h-16 rounded-full bg-gold-soft flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5"><path d="M7 3h6l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M13 3v5h5" /><path d="M8 12h8M8 16h8" strokeLinecap="round" /></svg>
                </div>
                <p className="text-lg font-bold text-ink">No hay equipos para cotizar</p>
                <p className="text-sm text-mute mt-1">Explora el catálogo y añade los que necesites.</p>
                <Link to="/equipos" className="mt-5 px-5 py-2.5 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity">Ver equipos</Link>
              </div>
            ) : (
              state.items.map(it => (
                <div key={it.lineId} className="flex items-center gap-3 p-3 rounded-2xl border border-edge bg-surface">
                  <div className="w-14 h-14 rounded-xl bg-surface-2 border border-edge shrink-0 flex items-center justify-center overflow-hidden">
                    {it.image ? <img src={it.image} alt={it.title} className="w-full h-full object-contain" /> : <span className="text-[10px] text-mute">Sin foto</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-ink truncate">{it.title}</p>
                    <p className="text-xs text-mute">{money(it.price)} · {MODALIDAD_LABEL[it.unit || 'venta']}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 border border-edge rounded-lg px-1.5 py-1">
                    <button aria-label="Menos" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })} className="w-6 h-6 grid place-items-center rounded-md text-ink hover:bg-surface-2 font-bold">−</button>
                    <span className="w-6 text-center text-sm font-bold text-ink">{it.qty}</span>
                    <button aria-label="Más" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })} className="w-6 h-6 grid place-items-center rounded-md text-ink hover:bg-surface-2 font-bold">＋</button>
                  </div>
                  <div className="text-right shrink-0 min-w-[70px]">
                    <p className="font-extrabold text-sm text-price">{money(it.price * it.qty)}</p>
                  </div>
                  <button onClick={() => dispatch({ type: 'remove', lineId: it.lineId })} aria-label="Eliminar" className="w-7 h-7 grid place-items-center rounded-full text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0">✕</button>
                </div>
              ))
            )}
          </div>

          {/* ── Datos + resumen (sticky) ── */}
          <div className="min-[900px]:sticky min-[900px]:top-24 rounded-2xl border border-edge bg-surface p-6 space-y-5">
            <div>
              <p className="text-sm font-extrabold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full bg-gold" /> Datos del cliente</p>
              <div className="space-y-3">
                <Field label="Nombre" ok={validNombre}><input className={inp(validNombre)} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" /></Field>
                <Field label="Empresa" ok={validEmpresa}><input className={inp(validEmpresa)} value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Empresa" /></Field>
                <Field label="Email (opcional)" ok={validClientEmail}><input type="email" className={inp(validClientEmail)} value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /></Field>
                <Field label="Teléfono" ok={validTelefono}><input type="tel" inputMode="numeric" maxLength={10} className={inp(validTelefono)} value={telefono} onChange={e => setTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} placeholder="10 dígitos" /></Field>
              </div>
            </div>

            <div className="pt-4 border-t border-edge">
              <p className="text-sm font-extrabold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full bg-gold" /> Datos de la obra</p>
              <div className="space-y-3">
                <Field label="Responsable" ok={validResponsable}><input className={inp(validResponsable)} value={responsable} onChange={e => setResponsable(e.target.value)} placeholder="Encargado de obra" /></Field>
                <Field label="Dirección" ok={validDireccion}><input className={inp(validDireccion)} value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Dónde está la obra" /></Field>
                <Field label="Teléfono de la obra" ok={validObraTelefono}><input type="tel" inputMode="numeric" maxLength={10} className={inp(validObraTelefono)} value={obraTelefono} onChange={e => setObraTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} placeholder="10 dígitos" /></Field>
                <Field label="Email de la obra" ok={validObraEmail}><input type="email" className={inp(validObraEmail)} value={obraEmail} onChange={e => setObraEmail(e.target.value)} placeholder="correo@ejemplo.com" /></Field>
              </div>
            </div>

            {/* Resumen */}
            <div className="pt-4 border-t border-edge space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-mute">Subtotal</span><span className="text-ink font-semibold">{money(subtotal)}</span></div>
              {state.coupon && <div className="flex justify-between"><span className="text-mute">Descuento ({(state.coupon.discount * 100).toFixed(0)}%)</span><span className="text-red-500 font-semibold">− {money(discountAmt)}</span></div>}
              {factura && <div className="flex justify-between"><span className="text-mute">IVA (16%)</span><span className="text-ink font-semibold">{money(ivaAmt)}</span></div>}
              <label className="flex items-center gap-3 py-2 cursor-pointer">
                <button type="button" role="switch" aria-checked={factura} onClick={() => setFactura(f => !f)} className={`relative w-10 h-[22px] rounded-full flex-none transition-colors ${factura ? 'bg-gold' : 'bg-ink/15'}`}>
                  <span className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${factura ? 'left-[20px]' : 'left-[2px]'}`} />
                </button>
                <span className="text-[13px] text-ink">¿Deseas factura? (se suma IVA 16%)</span>
              </label>
              <div className="flex justify-between pt-2.5 mt-1 border-t border-edge text-[17px] font-extrabold"><span className="text-ink">Total</span><span className="text-price">{money(totalConIVA)}</span></div>
            </div>

            <div className="space-y-2.5">
              <button onClick={handleSend} disabled={sending} className="w-full py-3.5 rounded-full bg-gold text-black font-bold text-[14.5px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" /></svg>}
                Enviar solicitud
              </button>
              <button onClick={handleDownload} className="w-full py-3 rounded-full border border-edge text-ink font-bold text-[13.5px] hover:bg-surface-2 transition-colors flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar PDF (para tu jefe)
              </button>
            </div>
            <p className="text-[11px] text-mute text-center -mt-1">Envíanos la solicitud y te contactamos, o descarga el PDF para autorizarla internamente.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
