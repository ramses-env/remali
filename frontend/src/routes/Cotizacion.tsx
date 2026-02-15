import { useState, useMemo } from 'react'
import { useCart } from '../store/cart'
import { usePriceUnit } from '../store/priceUnit'
import { downloadCotizacionPdf } from '../lib/pdf'
import { Link } from 'react-router-dom'
import { useToast } from '../store/toast'

export default function Cotizacion() {
  const { state, dispatch, total } = useCart()
  const { unit } = usePriceUnit()
  const { notify } = useToast()
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
  const formValid = useMemo(() => {
    return (
      (state.items.length > 0) &&
      validNombre &&
      validEmpresa &&
      validClientEmail &&
      validTelefono &&
      validDireccion &&
      validResponsable &&
      validObraTelefono &&
      validObraEmail
    )
  }, [state.items, validNombre, validEmpresa, validClientEmail, validTelefono, validDireccion, validResponsable, validObraTelefono, validObraEmail])

  async function handleDownload() {
    if (!formValid) {
      notify('Completa los campos obligatorios para generar la cotización', 'x')
      setShowErrors(false)
      setTimeout(() => {
        setShowErrors(true)
        const el = document.querySelector('.cotiza-form .group.invalid input') as HTMLInputElement | null
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus()
      }, 0)
      return
    }
    await downloadCotizacionPdf({
      items: state.items,
      client: { nombre, empresa, email, telefono, direccion, responsable, obra_telefono: obraTelefono, obra_email: obraEmail },
      coupon: state.coupon,
      iva: factura,
    })
  }

  const subtotal = state.items.reduce((s, i) => s + i.price * i.qty, 0)
  const discountAmt = state.coupon ? subtotal * state.coupon.discount : 0
  const preTaxTotal = Math.max(0, subtotal - discountAmt)
  const ivaAmt = factura ? preTaxTotal * 0.16 : 0
  const totalConIVA = preTaxTotal + ivaAmt

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold text-black">Cotización</h2>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          {state.items.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-10 rounded-xl border border-neutral-200 bg-white">
              <div className="w-16 h-16 rounded-full bg-[#e9f2f7] flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-8 h-8 stroke-[#517ea0] fill-none">
                  <path d="M7 3h6l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" strokeWidth="1.5"></path>
                  <path d="M13 3v5h5" strokeWidth="1.5"></path>
                  <path d="M8 12h8M8 16h8" strokeWidth="1.5" strokeLinecap="round"></path>
                </svg>
              </div>
              <p className="text-lg font-semibold text-neutral-800">No hay equipos para cotizar</p>
              <p className="text-sm text-neutral-500">Explora equipos y añade los que necesites</p>
              <Link to="/equipos" className="mt-4 px-4 py-2 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white inline-block">Ver equipos</Link>
            </div>
          )}
          {state.items.map(it => (
            <div
              key={it.lineId}
              className="flex items-center gap-3 p-2 rounded-xl border border-neutral-200 bg-white"
            >
              <div className="shrink-0">
                {it.image && (
                  <img
                    src={it.image}
                    alt={it.title}
                    className="w-12 h-12 object-cover rounded-md"
                  />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate text-neutral-900">{it.title}</p>
                <p className="text-[10px] text-gray-500 truncate">
                  ${it.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {it.unit ? `/${it.unit}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  aria-label="Menos"
                  className="w-6 h-6 grid place-items-center rounded-full border border-neutral-200 text-xs hover:bg-neutral-50 active:scale-95 transition-transform text-neutral-600"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })}
                >−</button>
                <span className="w-6 text-center text-xs font-medium text-neutral-900">{it.qty}</span>
                <button
                  aria-label="Más"
                  className="w-6 h-6 grid place-items-center rounded-full border border-neutral-200 text-xs hover:bg-neutral-50 active:scale-95 transition-transform text-neutral-600"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })}
                >＋</button>
              </div>

              <div className="text-right shrink-0 min-w-[60px]">
                <p className="font-bold text-sm text-neutral-900">
                  ${(it.price * it.qty).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </div>

              <button
                className="w-6 h-6 grid place-items-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                onClick={() => dispatch({ type: 'remove', lineId: it.lineId })}
                aria-label="Eliminar"
              >✕</button>
            </div>
          ))}
          
        </div>

        <div className="space-y-3 rounded-xl border border-neutral-200 p-3 bg-white h-fit cotiza-form">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 stroke-[#517ea0] fill-none">
              <path d="M12 12a5 5 0 100-10 5 5 0 000 10z" strokeWidth="1.5"></path>
              <path d="M4 20a8 8 0 0116 0" strokeWidth="1.5"></path>
            </svg>
            <span className="text-lg font-extrabold text-neutral-900">Datos del cliente</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className={`group ${showErrors && !validNombre ? 'invalid' : ''}`}>
              <input required type="text" className="input" placeholder=" " value={nombre} onChange={e => setNombre(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Nombre</label>
            </div>
            <div className={`group ${showErrors && !validEmpresa ? 'invalid' : ''}`}>
              <input required type="text" className="input" placeholder=" " value={empresa} onChange={e => setEmpresa(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Empresa</label>
            </div>
            <div className={`group ${showErrors && !validClientEmail ? 'invalid' : ''}`}>
              <input type="email" className="input" placeholder=" " value={email} onChange={e => setEmail(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Email</label>
            </div>
            <div className={`group ${showErrors && !validTelefono ? 'invalid' : ''}`}>
              <input required type="tel" inputMode="numeric" pattern="\d{10}" maxLength={10} className="input" placeholder=" " value={telefono} onChange={e => setTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Teléfono</label>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-2 border-t text-sm font-semibold text-neutral-700">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 stroke-[#517ea0] fill-none">
                <path d="M12 5c-3 0-5 2.5-5 5v2h10v-2c0-2.5-2-5-5-5z" strokeWidth="1.5"></path>
                <path d="M4 14h16v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4z" strokeWidth="1.5"></path>
              </svg>
              <span className="text-lg font-extrabold text-neutral-900">Datos de la obra</span>
            </div>
            <div className={`group ${showErrors && !validResponsable ? 'invalid' : ''}`}>
              <input required type="text" className="input" placeholder=" " value={responsable} onChange={e => setResponsable(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Responsable</label>
            </div>
            <div className={`group ${showErrors && !validDireccion ? 'invalid' : ''}`}>
              <input required type="text" className="input" placeholder=" " value={direccion} onChange={e => setDireccion(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Dirección</label>
            </div>
            <div className={`group ${showErrors && !validObraTelefono ? 'invalid' : ''}`}>
              <input required type="tel" inputMode="numeric" pattern="\d{10}" maxLength={10} className="input" placeholder=" " value={obraTelefono} onChange={e => setObraTelefono(e.target.value.replace(/\D+/g, '').slice(0, 10))} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Teléfono</label>
            </div>
            <div className={`group ${showErrors && !validObraEmail ? 'invalid' : ''}`}>
              <input required type="email" className="input" placeholder=" " value={obraEmail} onChange={e => setObraEmail(e.target.value)} />
              <span className="highlight"></span>
              <span className="bar"></span>
              <label>Email</label>
            </div>
          </div>
            <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Descuento</span>
              <span>{state.coupon ? `${(state.coupon.discount * 100).toFixed(0)}%` : '0%'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>IVA 16%</span>
              <span>${ivaAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
              <div className="flex items-center gap-3 text-sm text-neutral-900">
                <label className="switch">
                  <input id="factura-iva" type="checkbox" checked={factura} onChange={e => setFactura(e.target.checked)} />
                  <span className="slider"></span>
                </label>
                <span>¿Desea factura? Sumar IVA 16%</span>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t">
                <span className="font-bold">Total</span>
                <span className="font-bold">${totalConIVA.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
          </div>
          <div className="flex justify-center w-full pt-6">
            <button
              onClick={handleDownload}
              className="fancy"
            >
              <span className="top-key"></span>
              <span className="text">Descargar PDF</span>
              <span className="bottom-key-1"></span>
              <span className="bottom-key-2"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
