import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'

import { useProfile } from '../store/profile'
import { AvatarInicial } from '@/components/ui/avatar-inicial'

/* Descartado por SESIÓN, no para siempre: si el cliente lo cierra hoy no vuelve
   a estorbarle en esta visita, pero reaparece la próxima. La idea es insistir sin
   volverse molesto; guardarlo permanente sería regalar el empujón tras un clic. */
const CLAVE = 'remali_recordatorio_perfil'

/**
 * Recordatorio flotante para que el cliente complete su perfil.
 *
 * Aparece en toda la tienda, abajo, sin tapar el contenido. Solo para clientes
 * (nivel 0) con datos incompletos; el estado sale de /auth/me/, que el store ya
 * carga, así que no pide nada extra y se apaga solo cuando el perfil se completa.
 */
export default function RecordatorioPerfil() {
  const { user } = useProfile()
  const loc = useLocation()
  const reducir = useReducedMotion()
  const [oculto, setOculto] = useState(true)
  const [descartado, setDescartado] = useState(
    () => sessionStorage.getItem(CLAVE) === 'oculto',
  )

  const esCliente = (user?.puede?.nivel ?? 0) === 0 && Boolean(user)
  const incompleto = user?.datos_completos === false
  // En /perfil sobra: ya está ahí para hacerlo.
  const enPerfil = loc.pathname === '/perfil'
  const mostrar = esCliente && incompleto && !descartado && !enPerfil

  // Entra con retraso para no competir con lo que el usuario vino a ver. Un
  // recordatorio que salta encima de la página en el primer instante estorba
  // justo lo que dijimos que no queríamos.
  useEffect(() => {
    if (!mostrar) return
    const t = window.setTimeout(() => setOculto(false), 900)
    return () => window.clearTimeout(t)
  }, [mostrar])

  function descartar() {
    setDescartado(true)
    try {
      sessionStorage.setItem(CLAVE, 'oculto')
    } catch { /* modo privado: se descarta solo en memoria */ }
  }

  const visible = mostrar && !oculto

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reducir ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducir ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          /* En móvil sube por encima del dock (bottom-24) para no encimarse; en
             md+ no hay dock, así que baja a la esquina. */
          className="fixed bottom-24 left-4 right-4 z-40 md:bottom-5 md:left-auto md:right-5 md:max-w-[340px]"
        >
          <div className="relative">
            <Link
              to="/perfil"
              className="group flex items-center gap-3 rounded-2xl border border-gold/40 bg-surface/95 p-3.5 pr-11 shadow-lg shadow-black/20 backdrop-blur transition-colors hover:border-gold/70"
            >
              <AvatarInicial nombre={user?.first_name} correo={user?.email} tamano="md" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">Completa tu perfil</span>
                <span className="block text-[13px] leading-snug text-mute">
                  Así te cotizamos y entregamos más rápido.
                </span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-gold transition-transform group-hover:translate-x-0.5" />
            </Link>

            {/* Fuera del Link para no anidar controles: el × cierra, no navega. */}
            <button
              type="button"
              onClick={descartar}
              aria-label="Ocultar por ahora"
              className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-mute transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
