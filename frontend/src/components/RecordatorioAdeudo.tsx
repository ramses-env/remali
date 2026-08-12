import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'

import api from '../lib/api'
import { formatMoney } from '../lib/utils'
import { useProfile } from '../store/profile'

/* Igual que el recordatorio de perfil: cerrarlo no lo mata — reaparece pasado
   el intervalo mientras el adeudo siga vivo. Se apaga solo al quedar en ceros. */
const CLAVE = 'remali_recordatorio_adeudo_cerrado'
const REAPARECE_MS = 2 * 60 * 60 * 1000   // ← perilla: cada cuánto vuelve a insistir

function cerradoHace() {
  try {
    const v = Number(localStorage.getItem(CLAVE) || 0)
    return v ? Date.now() - v : Infinity
  } catch { return Infinity }
}

/**
 * Aviso de adeudo con la cara de las alertas de la casa (barra gris, círculo
 * de color, ✕), arriba a la derecha. Solo para clientes con saldo pendiente.
 */
export default function RecordatorioAdeudo() {
  const { user } = useProfile()
  const loc = useLocation()
  const reducir = useReducedMotion()
  const [deuda, setDeuda] = useState(0)
  const [oculto, setOculto] = useState(true)
  const [descartado, setDescartado] = useState(() => cerradoHace() < REAPARECE_MS)

  const esCliente = (user?.puede?.nivel ?? 0) === 0 && Boolean(user)

  // Un vistazo al entrar (y al cambiar de sección): ¿debe algo?
  useEffect(() => {
    if (!esCliente) { setDeuda(0); return }
    let vivo = true
    api.get<{ rentas: { estado: string; saldo?: string }[] }>('/rentas/mias/', { fondo: true } as never)
      .then(r => {
        if (!vivo) return
        const total = (r.data?.rentas || [])
          .filter(x => x.estado !== 'cancelada')
          .reduce((a, x) => a + Number(x.saldo || 0), 0)
        setDeuda(total)
      })
      .catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esCliente, loc.pathname])

  // En la página de adeudos sobra: ya está viéndolo.
  const enAdeudos = loc.pathname === '/mis-adeudos'
  const mostrar = esCliente && deuda > 0 && !descartado && !enAdeudos

  // Pasado el intervalo, el aviso "revive" aunque la pestaña siga abierta.
  useEffect(() => {
    if (!descartado) return
    const t = window.setInterval(() => {
      if (cerradoHace() >= REAPARECE_MS) setDescartado(false)
    }, 60_000)
    return () => window.clearInterval(t)
  }, [descartado])

  // Entra con retraso para no competir con lo que el usuario vino a ver.
  useEffect(() => {
    if (!mostrar) return
    const t = window.setTimeout(() => setOculto(false), 1200)
    return () => window.clearTimeout(t)
  }, [mostrar])

  function descartar() {
    setDescartado(true)
    setOculto(true)
    try {
      localStorage.setItem(CLAVE, String(Date.now()))
    } catch { /* modo privado: se descarta solo en memoria */ }
  }

  const visible = mostrar && !oculto

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reducir ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducir ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          /* Fluye dentro del apilador de recordatorios (App.tsx), debajo del de
             perfil, con separación real — ya no se enciman. */
          className="w-full pointer-events-auto"
        >
          {/* Misma anatomía que las alertas: barra gris, círculo de color, ✕ */}
          <div className="flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-2xl border border-edge bg-alert shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
            <span className="w-7 h-7 rounded-full grid place-items-center shrink-0 bg-red-500 text-white text-[12px] font-black">$</span>
            <Link to="/mis-adeudos" className="group min-w-0 flex-1 flex items-center gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">Tienes un adeudo de {formatMoney(deuda)}</span>
                <span className="block text-[12.5px] leading-snug text-mute">Ver el detalle y cómo liquidarlo.</span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-gold transition-transform group-hover:translate-x-0.5" />
            </Link>
            {/* Fuera del Link para no anidar controles: el × cierra, no navega. */}
            <button
              type="button"
              onClick={descartar}
              aria-label="Ocultar por ahora"
              className="w-7 h-7 grid place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-ink shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
