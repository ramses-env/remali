import { useCart } from '../store/cart'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import api from '../lib/api'

export default function Cart() {
  const { state, dispatch, total } = useCart()
  const [code, setCode] = useState('')
  const nav = useNavigate()
  
  function applyCoupon() {
    api.post('/cupones/aplicar/', { code, items: state.items })
      .then(r => {
        const discount = r.data.discount || 0
        dispatch({ type: 'coupon', code, discount })
      })
      .catch(() => {})
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => nav(-1)}
          className="w-10 h-10 grid place-items-center rounded-full hover:bg-black/5 transition-colors"
          aria-label="Volver"
        >
          <svg className="w-6 h-6 text-neutral-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-extrabold text-black">Carrito</h2>
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          {state.items.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-10 rounded-xl border border-neutral-200 bg-white">
              <div className="w-16 h-16 rounded-full bg-[#e9f2f7] flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-8 h-8 text-[#517ea0]">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.25 3h1.386c.51 0 .955.343 1.088.834l.383 1.437M7.5 14.25h9.563a1.875 1.875 0 001.822-1.416l1.32-5.274A.938.938 0 0019.31 6.75H5.107" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7.5 21a.75.75 0 100-1.5.75.75 0 000 1.5zm9 0a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                </svg>
              </div>
              <p className="text-lg font-semibold text-neutral-800">Tu carrito está vacío</p>
              <p className="text-sm text-neutral-500">Explora productos y añade tus favoritos</p>
              <Link to="/equipos" className="mt-4 px-4 py-2 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white inline-block hover:shadow-lg hover:-translate-y-0.5 transition-all">Ver productos</Link>
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
                <p className="font-semibold text-sm truncate">{it.title}</p>
                <p className="text-[10px] text-gray-500 truncate">
                  ${it.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {it.unit ? `/${it.unit}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  aria-label="Menos"
                  className="w-6 h-6 grid place-items-center rounded-full border border-neutral-200 text-xs hover:bg-neutral-50 active:scale-95 transition-transform"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })}
                >−</button>
                <span className="w-6 text-center text-xs font-medium">{it.qty}</span>
                <button
                  aria-label="Más"
                  className="w-6 h-6 grid place-items-center rounded-full border border-neutral-200 text-xs hover:bg-neutral-50 active:scale-95 transition-transform"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })}
                >＋</button>
              </div>

              <div className="text-right shrink-0 min-w-[60px]">
                <p className="font-bold text-sm">
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
        <div className="space-y-6 rounded-xl border border-neutral-200 p-6 bg-white h-fit">
          <p className="text-xl font-extrabold">Resumen</p>
          <form
            className="flex flex-col sm:flex-row items-center gap-4 sm:gap-2"
            onSubmit={e => { e.preventDefault(); applyCoupon() }}
          >
            <div className="wave-group w-full sm:flex-1">
              <input
                required
                type="text"
                className="input"
                placeholder=" "
                value={code}
                onChange={e => setCode(e.target.value)}
              />
              <span className="bar"></span>
              <label className="label">
                <span className="label-char" style={{ ['--index' as any]: 0 }}>C</span>
                <span className="label-char" style={{ ['--index' as any]: 1 }}>u</span>
                <span className="label-char" style={{ ['--index' as any]: 2 }}>p</span>
                <span className="label-char" style={{ ['--index' as any]: 3 }}>ó</span>
                <span className="label-char" style={{ ['--index' as any]: 4 }}>n</span>
              </label>
            </div>
            <button
              type="submit"
              className="btn-universe-primary btn-sm w-full sm:w-auto rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white"
            >
              Aplicar
            </button>
          </form>
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span>${state.items.reduce((s, i) => s + i.price * i.qty, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Descuento</span>
            <span>{state.coupon ? `${(state.coupon.discount * 100).toFixed(0)}%` : '0%'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold">Total</span>
            <span className="font-bold">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <Link
            to="/cotizacion"
            className="btn-universe-primary block text-center rounded-full border border-[#5488af] text-[#487aa1]"
          >
            Generar cotización
          </Link>
          <Link
            to="/checkout"
            className="btn-universe-primary block text-center rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white"
          >
            Continuar
          </Link>
        </div>
      </div>
    </div>
  )
}
