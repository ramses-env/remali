import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useCart } from '../store/cart'

export default function FloatingCart() {
  const { state, total, dispatch } = useCart()
  const count = state.items.reduce((s, i) => s + i.qty, 0)
  const [open, setOpen] = useState(false)
  const [badgePulse, setBadgePulse] = useState(false)
  const prevCountRef = useRef(count)

  useEffect(() => {
    if (count > prevCountRef.current) {
      setBadgePulse(true)
      const t = setTimeout(() => setBadgePulse(false), 400)
      return () => clearTimeout(t)
    }
    prevCountRef.current = count
  }, [count])

  return (
    <>
      <button
        aria-label="Abrir carrito"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-6 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 z-40 p-4 rounded-full bg-gradient-to-br from-[#5488af] to-[#487aa1] text-white shadow-lg hover:shadow-xl"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.25 3h1.386c.51 0 .955.343 1.088.834l.383 1.437M7.5 14.25h9.563a1.875 1.875 0 001.822-1.416l1.32-5.274A.938.938 0 0019.31 6.75H5.107" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7.5 21a.75.75 0 100-1.5.75.75 0 000 1.5zm9 0a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
        {count > 0 && (
          <span className={`absolute top-[1px] right-[1px] min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] bg-red-600 text-white font-semibold z-10 flex items-center justify-center pointer-events-none ${badgePulse ? 'cart-badge-pulse' : ''}`}>
            {count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-neutral-50 z-50 shadow-2xl flex flex-col rounded-l-3xl"
              initial={{ x: 420 }}
              animate={{ x: 0 }}
              exit={{ x: 420 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
                <p className="text-lg font-extrabold text-[#517ea0]">Tu carrito</p>
                <button aria-label="Cerrar" className="button button-sm" onClick={() => setOpen(false)}>
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 6l12 12M18 6L6 18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                </button>
              </div>
              <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                {state.items.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-center py-10">
                    <div className="w-16 h-16 rounded-full bg-[#e9f2f7] flex items-center justify-center mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-8 h-8 text-[#517ea0]">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.25 3h1.386c.51 0 .955.343 1.088.834l.383 1.437M7.5 14.25h9.563a1.875 1.875 0 001.822-1.416l1.32-5.274A.938.938 0 0019.31 6.75H5.107" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7.5 21a.75.75 0 100-1.5.75.75 0 000 1.5zm9 0a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                      </svg>
                    </div>
                    <p className="text-lg font-semibold text-neutral-800">Tu carrito está vacío</p>
                    <p className="text-sm text-neutral-500">Explora productos y añade tus favoritos</p>
                  </div>
                )}
                {state.items.map(it => (
                  <motion.div
                    key={it.lineId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    whileHover={{ scale: 1.01 }}
                    className="group grid grid-cols-1 sm:grid-cols-6 items-center gap-3 py-4 sm:py-3 px-3 sm:px-2 rounded-lg border-b border-neutral-200 last:border-b-0 bg-white/60 hover:bg-white transition-colors shadow-sm hover:shadow-md"
                  >
                    <div className="order-1 sm:order-none sm:col-span-1">
                      {it.image && <img src={it.image} alt={it.title} className="w-12 h-12 object-cover rounded-md transition-transform duration-200 group-hover:scale-105" />}
                    </div>
                    <div className="order-2 sm:order-none sm:col-span-3">
                      <p className="font-semibold uppercase text-sm">{it.title}</p>
                      <p className="text-xs text-gray-600">${it.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {it.unit ? `por ${it.unit}` : 'unidad'}</p>
                    </div>
                    <div className="order-3 sm:order-none sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                      <button className="px-2 py-1 rounded border hover:bg-[#e9f2f7] transition-colors" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: Math.max(1, it.qty - 1) })}>-</button>
                      <span className="w-8 text-center text-sm font-semibold rounded px-2 bg-neutral-100 group-hover:bg-[#e9f2f7] transition-colors">{it.qty}</span>
                      <button className="px-2 py-1 rounded border hover:bg-[#e9f2f7] transition-colors" onClick={() => dispatch({ type: 'qty', lineId: it.lineId, qty: it.qty + 1 })}>+</button>
                      <button className="p-2 rounded-full border border-neutral-300 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-[#517ea0]" onClick={() => dispatch({ type: 'remove', lineId: it.lineId })}>✕</button>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="p-4 border-t border-neutral-200 space-y-4 sticky bottom-0 bg-neutral-50">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Link to="/checkout" className="col-span-1 text-center px-4 py-2 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white shine-button" onClick={() => setOpen(false)}>Pagar</Link>
                  <Link to="/carrito" className="col-span-1 text-center px-4 py-2 rounded-full border whitespace-nowrap" onClick={() => setOpen(false)}>Ver carrito</Link>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
