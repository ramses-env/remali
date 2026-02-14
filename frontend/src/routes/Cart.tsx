import { useCart } from '../store/cart'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import api from '../lib/api'

export default function Cart() {
  const { state, dispatch, total } = useCart()
  const [code, setCode] = useState('')
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
      <h2 className="text-2xl font-extrabold text-black">Carrito</h2>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          {state.items.length === 0 && (
            <p className="text-gray-600">No hay productos en el carrito</p>
          )}
          {state.items.map(it => (
            <div
              key={it.lineId}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
            >
              <div className="shrink-0">
                {it.image && (
                  <img
                    src={it.image}
                    alt={it.title}
                    className="w-14 h-14 object-cover rounded-md"
                  />
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{it.title}</p>
                <p className="text-xs text-gray-600">
                  ${it.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {it.unit ? `por ${it.unit}` : 'unidad'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label="Menos"
                  className="w-8 h-8 grid place-items-center rounded-full border hover:bg-neutral-100"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })}
                >−</button>
                <span className="w-8 text-center">{it.qty}</span>
                <button
                  aria-label="Más"
                  className="w-8 h-8 grid place-items-center rounded-full border hover:bg-neutral-100"
                  onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })}
                >＋</button>
              </div>
              <button
                className="w-8 h-8 grid place-items-center rounded-full border hover:bg-neutral-100"
                onClick={() => dispatch({ type: 'remove', lineId: it.lineId })}
                aria-label="Eliminar"
                title="Eliminar"
              >✕</button>
              <span className="font-semibold">
                ${(it.price * it.qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-xl border border-neutral-200 p-3 bg-white h-fit">
          <p className="text-lg font-extrabold">Resumen</p>
          <form
            className="flex items-center gap-2"
            onSubmit={e => { e.preventDefault(); applyCoupon() }}
          >
            <div className="wave-group flex-1">
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
