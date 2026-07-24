import * as React from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'

import ThemeToggle from '@/components/ThemeToggle'
import { useRedirigirSiHaySesion } from '@/lib/sesion'

/* El escalonado va aquí y no en cada pantalla: sign-in y sign-up deben entrar
   igual, y si cada una define sus tiempos terminan desincronizadas. */
const contenedor: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

export const itemAuth: Variants = {
  hidden: { y: 12, opacity: 0 },
  visible: { y: 0, opacity: 1 },
}

/* Variantes "quietas" para quien pide menos movimiento (PRODUCT.md). Se dejan
   con la misma forma en vez de quitar la animación: así el contenido nace
   visible y nunca depende de que una animación llegue a su fin para poder
   leerse — un formulario de acceso invisible no es un detalle estético. */
const contenedorQuieto: Variants = { hidden: { opacity: 1 }, visible: { opacity: 1 } }
const itemQuieto: Variants = { hidden: { y: 0, opacity: 1 }, visible: { y: 0, opacity: 1 } }

/** Envuelve un bloque para que herede el escalonado del contenedor. */
export function AuthItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const reducir = useReducedMotion()
  return (
    <motion.div variants={reducir ? itemQuieto : itemAuth} className={className}>
      {children}
    </motion.div>
  )
}

/** Título y bajada de cada pantalla. Vive con el contenido, no con el marco,
 *  porque cambia al pasar de "iniciar sesión" a "crear cuenta". */
export function AuthCabecera({ title, description }: { title: string; description: string }) {
  return (
    <AuthItem className="text-center">
      <h1 className="text-3xl font-black tracking-tight text-ink">{title}</h1>
      <p className="text-sm text-mute mt-1.5">{description}</p>
    </AuthItem>
  )
}

/* El panel ya cruza media pantalla; si el contenido además se desplazara serían
   dos movimientos compitiendo. Aquí solo se funde, y la salida va más rápida que
   la entrada: el sistema responde de inmediato y se toma su tiempo al presentar. */
const fundido: Variants = {
  entra: { opacity: 0 },
  centro: { opacity: 1, transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] } },
  sale: { opacity: 0, transition: { duration: 0.13, ease: [0.23, 1, 0.32, 1] } },
}

/** ¿Estamos en el layout de dos columnas? Debajo de `md` la foto no se muestra y
 *  el formulario ocupa todo: ahí no debe aplicarse ningún desplazamiento. */
function useEsEscritorio() {
  const consulta = '(min-width: 768px)'
  const [es, setEs] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(consulta).matches,
  )
  React.useEffect(() => {
    const mq = window.matchMedia(consulta)
    const alCambiar = () => setEs(mq.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])
  return es
}

/**
 * Marco de las pantallas de acceso.
 *
 * Es un layout de ruta, no un componente que cada pantalla envuelve. Esa es la
 * diferencia entre que login y registro se sientan la MISMA ventana —el marco y
 * la foto nunca se desmontan— y que parezcan dos páginas distintas.
 *
 * Al cambiar de pantalla, la foto y el formulario **intercambian lado**
 * deslizándose. El movimiento es CSS y no JavaScript a propósito: son dos
 * estados fijos y conocidos, así que la transición corre fuera del hilo
 * principal y, si el usuario cambia de opinión a media animación, se re-dirige
 * desde donde va en vez de reiniciar.
 */
export function AuthSplitScreen() {
  const reducir = useReducedMotion()
  const esEscritorio = useEsEscritorio()
  const nav = useNavigate()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next') || ''
  const vinoDelGuard = Boolean(next)

  // La comprobación de sesión vive aquí y no repetida en cada pantalla: es la
  // misma regla para login y registro.
  const verificando = useRedirigirSiHaySesion(next)

  const enRegistro = loc.pathname.startsWith('/registro')

  // Los dos paneles nacen pegados a la izquierda; el que va a la derecha se
  // desplaza el 100% de su propio ancho (que es media pantalla). En porcentaje
  // y no en píxeles: se adapta solo a cualquier tamaño de ventana.
  const cruzar = esEscritorio && !reducir
  const desplazarFormulario = cruzar && enRegistro ? 'translateX(100%)' : 'translateX(0%)'
  const desplazarFoto = cruzar && !enRegistro ? 'translateX(100%)' : 'translateX(0%)'

  // Se mueve por la pantalla (no entra ni sale), así que lleva ease-in-out: acelera
  // y frena como algo con masa. Un ease-out aquí se sentiría un frenazo.
  const transicionPanel = 'transform 420ms cubic-bezier(0.77, 0, 0.175, 1)'

  function volver() {
    // Si el guard lo trajo aquí (llegó con ?next=), retroceder lo devolvería a la
    // ruta protegida y el guard lo rebotaría al login otra vez: bucle. En ese caso
    // el único destino seguro es el inicio.
    if (!vinoDelGuard && window.history.length > 1) nav(-1)
    else nav('/')
  }

  /* En escritorio el alto se fija a UNA pantalla. Con solo min-h-screen, cuando el
     formulario superaba el alto de la ventana el documento crecía y la foto —que
     ocupa el alto completo— se estiraba con él, quedando enorme. */
  return (
    <div className="relative flex min-h-screen w-full flex-col bg-app text-ink md:block md:h-screen md:overflow-hidden">
      {/* ── Formulario ── */}
      <div
        style={{ transform: desplazarFormulario, transition: transicionPanel }}
        className="relative z-10 flex w-full flex-col items-center justify-center bg-app px-6 py-10 sm:px-10 md:absolute md:inset-y-0 md:left-0 md:w-1/2 md:overflow-y-auto"
      >
        <button
          type="button"
          onClick={volver}
          className="absolute top-5 left-5 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm text-mute transition-colors duration-150 hover:text-ink hover:bg-surface-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </button>
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        {verificando ? (
          <div className="flex flex-col items-center gap-4">
            <span className="w-8 h-8 border-2 border-edge border-t-gold rounded-full animate-spin" />
            <p className="text-mute text-sm">Verificando tu sesión…</p>
          </div>
        ) : (
          <div className="w-full max-w-md">
            {/* El logo queda FUERA del bloque que se funde: viaja con el panel pero
                no parpadea, y es el ancla que sostiene la sensación de continuidad. */}
            <Link
              to="/"
              aria-label="Ir al inicio"
              className="mx-auto mb-5 block w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px] transition-transform duration-150 active:scale-[0.97]"
            >
              <div className="w-full h-full bg-app rounded-[10px] flex items-center justify-center">
                <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">
                  R
                </span>
              </div>
            </Link>

            {/* `mode="wait"`: la saliente termina antes de entrar la nueva. Si se
                cruzan, dos formularios de distinto alto superpuestos dan un salto.
                `initial={false}` evita que la primera carga entre fundida. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={loc.pathname} variants={fundido} initial="entra" animate="centro" exit="sale">
                <motion.div
                  variants={reducir ? contenedorQuieto : contenedor}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-col gap-5"
                >
                  <Outlet />
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Imagen ── */}
      <div
        style={{ transform: desplazarFoto, transition: transicionPanel }}
        className="relative hidden overflow-hidden md:absolute md:inset-y-0 md:left-0 md:block md:w-1/2"
      >
        <img
          src="/images/remali-1.jpg"
          alt=""
          className="h-full w-full object-cover"
          onError={e => {
            const t = e.currentTarget
            if (t.dataset.fb !== '1') {
              t.dataset.fb = '1'
              t.src = '/images/maquinas.png'
            }
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-10 left-10 right-10">
          <p className="text-gold text-[11px] font-mono uppercase tracking-[0.3em] mb-3">
            Renta y venta de maquinaria
          </p>
          {/* "Controla tu maquinaria desde un solo lugar" era relleno de plantilla:
              describe cualquier software. Esta dice lo que el panel hace de verdad
              —seguir cada unidad, quién la tiene y cuándo vuelve— con las palabras
              del negocio. */}
          <p className="text-white text-2xl font-black leading-tight max-w-sm text-balance">
            Sabes qué máquina salió, con quién y cuándo vuelve.
          </p>
        </div>
      </div>
    </div>
  )
}
