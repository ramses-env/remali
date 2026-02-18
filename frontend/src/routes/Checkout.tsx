import api from '../lib/api'
import { useEffect, useState } from 'react'
import { useCart } from '../store/cart'
import { useAuth } from '../store/auth'
import { useNavigate } from 'react-router-dom'

export default function Checkout() {
  const { state, total, dispatch } = useCart()
  const { token } = useAuth()
  const nav = useNavigate()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    if (!token) {
      setStatus('Inicia sesión para continuar al checkout')
      nav(`/login?next=${encodeURIComponent('/checkout')}`)
    }
  }, [token, nav])

  function applyCoupon() {
    api.post('/cupones/aplicar/', { code, items: state.items })
      .then(r => {
        const discount = r.data.discount || 0
        dispatch({ type: 'coupon', code, discount })
        setStatus('Cupón aplicado')
      })
      .catch(() => setStatus('Cupón inválido'))
  }

  function pay() {
    api.post('/ordenes/', { items: state.items, coupon: state.coupon?.code })
      .then(() => { setStatus('Pago realizado'); dispatch({ type: 'clear' }) })
      .catch(() => setStatus('Error en pago'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => nav(-1)}
          className="w-10 h-10 grid place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors md:hidden"
          aria-label="Volver"
        >
          <svg className="w-6 h-6 text-black dark:text-[#8db4c9]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-extrabold text-black dark:text-[#8db4c9]">Checkout</h2>
      </div>
      <div className="flex items-center gap-3">
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Cupón" className="border rounded-full px-3 py-2 dark:bg-neutral-800 dark:border-neutral-700" />
        <button onClick={applyCoupon} className="px-4 py-2 rounded-full border hover:bg-[#e9f2f7] dark:border-neutral-700 dark:hover:bg-neutral-800">Aplicar</button>
      </div>
      <p className="text-xl font-extrabold text-black dark:text-[#8db4c9]">Total: ${total.toFixed(2)}</p>
      <button onClick={pay} className="px-5 py-2.5 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white">Pagar</button>
      {status && <p className="text-gray-700">{status}</p>}
    </div>
  )
}
