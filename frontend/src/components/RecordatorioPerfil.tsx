import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'

import { useProfile } from '../store/profile'

/* Cerrarlo NO lo mata: guarda CUÁNDO se cerró y el aviso reaparece pasado el
   intervalo — la insistencia es a propósito (el 5% es el gancho para tener
   datos de contacto reales). Se apaga solo al completar el perfil. */
const CLAVE = 'remali_recordatorio_perfil_cerrado'
const REAPARECE_MS = 2 * 60 * 60 * 1000   // ← perilla: cada cuánto vuelve a insistir

function cerradoHace() {
  try {
    const v = Number(localStorage.getItem(CLAVE) || 0)
    return v ? Date.now() - v : Infinity
  } catch { return Infinity }
}

/**
 * Recordatorio para completar el perfil, con la cara de las alertas de la
 * casa (barra gris, círculo de color, ✕). Se queda puesto hasta que el
 * cliente lo cierra; pasado el intervalo, vuelve a aparecer.
 */
export default function RecordatorioPerfil() {
  const { user } = useProfile()
  const loc = useLocation()
  const reducir = useReducedMotion()
  const [oculto, setOculto] = useState(true)
  const [descartado, setDescartado] = useState(() => cerradoHace() < REAPARECE_MS)

  const esCliente = (user?.puede?.nivel ?? 0) === 0 && Boolean(user)
  const incompleto = user?.datos_completos === false
  // En /perfil sobra: ya está ahí para hacerlo.
  const enPerfil = loc.pathname === '/perfil'
  const mostrar = esCliente && incompleto && !descartado && !enPerfil

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
    const t = window.setTimeout(() => setOculto(false), 900)
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
          /* Fluye dentro del apilador de recordatorios (App.tsx): así nunca se
             encima con el de adeudo cuando salen juntos. */
          className="w-full pointer-events-auto"
        >
          {/* Misma anatomía que las alertas: barra gris, círculo de color, ✕ */}
          <div className="flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-2xl border border-edge bg-alert shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
            <span className="w-7 h-7 rounded-full grid place-items-center shrink-0 bg-amber-500 text-white text-[12px] font-black">%</span>
            <Link to="/perfil" className="group min-w-0 flex-1 flex items-center gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">Completa tu perfil y obtén 5%</span>
                <span className="block text-[12.5px] leading-snug text-mute">Tu descuento de bienvenida, de un solo uso, por darnos tus datos.</span>
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
