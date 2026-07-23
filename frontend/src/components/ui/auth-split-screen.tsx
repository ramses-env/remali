import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'

import ThemeToggle from '@/components/ThemeToggle'

/* El escalonado va aquí y no en cada pantalla: sign-in y sign-up deben entrar
   igual, y si cada una define sus tiempos terminan desincronizadas. */
const contenedor = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
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

/**
 * Marco de las pantallas de acceso: formulario a la izquierda, imagen a la
 * derecha (se oculta en móvil, donde el formulario manda).
 *
 * Los colores salen de los tokens del panel, no de valores fijos: así el marco
 * sigue el tema claro/oscuro y el acento del Dueño sin tocar nada aquí.
 */
export function AuthSplitScreen({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const reducir = useReducedMotion()
  return (
    <div className="relative flex min-h-screen w-full flex-col md:flex-row bg-app text-ink">
      {/* ── Formulario ── */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 sm:px-10 md:w-1/2">
        <div className="absolute top-5 right-5 md:right-auto md:left-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md">
          <motion.div
            variants={reducir ? contenedorQuieto : contenedor}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-6"
          >
            <AuthItem>
              <Link to="/" className="flex items-center gap-3 w-fit">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]">
                  <div className="w-full h-full bg-app rounded-[10px] flex items-center justify-center">
                    <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">
                      R
                    </span>
                  </div>
                </div>
                <span className="text-xl font-black tracking-tight text-ink">REMALI</span>
              </Link>
            </AuthItem>

            <AuthItem className="text-left">
              <h1 className="text-3xl font-black tracking-tight text-ink">{title}</h1>
              <p className="text-sm text-mute mt-1.5">{description}</p>
            </AuthItem>

            {children}

            {footer && <AuthItem className="text-center text-sm text-mute">{footer}</AuthItem>}
          </motion.div>
        </div>
      </div>

      {/* ── Imagen ── */}
      <div className="relative hidden w-1/2 md:block">
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
