import * as React from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'

import ThemeToggle from '@/components/ThemeToggle'
import { useRedirigirSiHaySesion } from '@/lib/sesion'

/* El escalonado va aquí y no en cada pantalla: sign-in y sign-up deben entrar
   igual, y si cada una define sus tiempos terminan desincronizadas. */
const contenedor = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
}

export const itemAuth = {
  hidden: { y: 16, opacity: 0 },
  visible: { y: 0, opacity: 1 },
}

/* Variantes "quietas" para quien pide menos movimiento (PRODUCT.md). Se dejan
   con la misma forma en vez de quitar la animación: así el contenido nace
   visible y nunca depende de que una animación llegue a su fin para poder
   leerse — un formulario de acceso invisible no es un detalle estético. */
const contenedorQuieto = { hidden: { opacity: 1 }, visible: { opacity: 1 } }
const itemQuieto = { hidden: { y: 0, opacity: 1 }, visible: { y: 0, opacity: 1 } }

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
 *  porque cambia al pasar de "iniciar sesión" a "crear cuenta" y tiene que
 *  desplazarse junto con el formulario. */
export function AuthCabecera({ title, description }: { title: string; description: string }) {
  return (
    <AuthItem className="text-center">
      <h1 className="text-3xl font-black tracking-tight text-ink">{title}</h1>
      <p className="text-sm text-mute mt-1.5">{description}</p>
    </AuthItem>
  )
}

/* Entrar y salir en horizontal. `registro` se considera "hacia adelante" y
   `login` "hacia atrás", así el sentido del desplazamiento coincide siempre con
   el salto que hizo el usuario sin tener que recordar de dónde venía. */
const desplazamiento: Variants = {
  entra: (dir: number) => ({ x: dir * 40, opacity: 0 }),
  centro: { x: 0, opacity: 1, transition: { duration: 0.32, ease: [0.23, 1, 0.32, 1] } },
  sale: (dir: number) => ({
    x: dir * -40,
    opacity: 0,
    transition: { duration: 0.18, ease: 'easeIn' },
  }),
}
const sinDesplazamiento: Variants = {
  entra: { opacity: 0 },
  centro: { opacity: 1 },
  sale: { opacity: 0 },
}

/**
 * Marco de las pantallas de acceso: formulario a la izquierda, imagen a la
 * derecha (se oculta en móvil, donde el formulario manda).
 *
 * Es un layout de ruta, no un componente que cada pantalla envuelve. Esa es la
 * diferencia entre que login y registro se sientan la MISMA ventana —el marco,
 * la foto y el logo nunca se desmontan, solo se desplaza el contenido— y que
 * parezcan dos páginas distintas.
 *
 * Los colores salen de los tokens del panel, no de valores fijos: así el marco
 * sigue el tema claro/oscuro y el acento del Dueño sin tocar nada aquí.
 */
export function AuthSplitScreen() {
  const reducir = useReducedMotion()
  const nav = useNavigate()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next') || ''
  const vinoDelGuard = Boolean(next)

  // La comprobación de sesión vive aquí y no repetida en cada pantalla: es la
  // misma regla para login y registro.
  const verificando = useRedirigirSiHaySesion(next)

  const haciaRegistro = loc.pathname.startsWith('/registro')
  const dir = haciaRegistro ? 1 : -1

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
    <div className="relative flex min-h-screen w-full flex-col bg-app text-ink md:h-screen md:flex-row md:overflow-hidden">
      {/* ── Formulario ── */}
      {/* `relative` aquí, no solo en el contenedor de afuera: si no, "Volver" y el
          selector de tema se posicionan contra la pantalla completa y en escritorio
          el segundo cae encima de la foto, donde no se ve ni se puede usar. */}
      <div className="relative flex w-full flex-col items-center justify-center px-6 py-10 sm:px-10 md:h-screen md:w-1/2 md:overflow-y-auto">
        <button
          type="button"
          onClick={volver}
          className="absolute top-5 left-5 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm text-mute hover:text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/30 transition-colors"
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
            {/* El logo queda FUERA del bloque que se desplaza: es el ancla visual
                que hace sentir que no cambiaste de ventana. */}
            <Link
              to="/"
              aria-label="Ir al inicio"
              className="mx-auto mb-5 block w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]"
            >
              <div className="w-full h-full bg-app rounded-[10px] flex items-center justify-center">
                <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">
                  R
                </span>
              </div>
            </Link>

            {/* `mode="wait"` para que la saliente termine antes de entrar la nueva:
                si se cruzan, dos formularios superpuestos dan un salto de alto feo.
                `initial={false}` evita que la primera carga entre desplazada. */}
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={loc.pathname}
                custom={dir}
                variants={reducir ? sinDesplazamiento : desplazamiento}
                initial="entra"
                animate="centro"
                exit="sale"
              >
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
      <div className="relative hidden w-1/2 md:block md:h-screen">
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
          <p className="text-white text-2xl font-black leading-tight max-w-sm">
            Controla tu maquinaria desde un solo lugar.
          </p>
        </div>
      </div>
    </div>
  )
}
