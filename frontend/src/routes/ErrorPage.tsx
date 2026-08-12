import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import React from 'react'

/* ─────────────────────────────────────────────────────────────────────────
   Página de error de REMALI.

   Dirección de diseño: aterrizarla en el mundo de la empresa —maquinaria
   ligera, obra, taller—. La pieza-firma es la BANDA DE PRECAUCIÓN: la franja
   amarilla y negra de las máquinas pesadas y las barreras de obra. Un error
   ES una zona bloqueada, así que la señalética de obra cae natural.

   Sin gradiente en el texto, sin burbujas genéricas. Usa los tokens del tema
   (bg-app / text-ink / text-gold…), así que se ve bien en claro y en oscuro.
   Respeta prefers-reduced-motion. ──────────────────────────────────────── */

type ErrorType = '404' | '500' | '403' | 'maintenance'

type Cfg = {
  code: string
  title: string
  message: string
  glyph: React.ReactNode
  action?: { label: string; to: string }   // to === '.' → recargar
  volver?: boolean                          // muestra el botón secundario "Regresar"
}

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 sm:w-10 sm:h-10">
    {children}
  </svg>
)

const CFG: Record<ErrorType, Cfg> = {
  '404': {
    code: '404',
    title: 'Esta ruta no existe',
    message: 'La página que buscas no está en el mapa. Quizá la movimos o el enlace ya quedó viejo.',
    // Mapa de obra doblado.
    glyph: svg(<><path d="M9 6 3.5 4v14L9 20l6-2 5.5 2V6L15 4 9 6Z" /><path d="M9 6v14M15 4v14" /></>),
    action: { label: 'Ir al inicio', to: '/' },
    volver: true,
  },
  '403': {
    code: '403',
    title: 'Zona restringida',
    message: 'Tu cuenta no tiene acceso a esta área. Si crees que deberías entrar, pídele acceso a un administrador.',
    // Casco de obra.
    glyph: svg(<><path d="M3 18.5h18" /><path d="M5.5 18.5v-1.5a6.5 6.5 0 0 1 13 0v1.5" /><path d="M12 4.5v3.2" /><path d="M8.6 7.7A4.5 4.5 0 0 0 6.2 11" /><path d="M15.4 7.7A4.5 4.5 0 0 1 17.8 11" /></>),
    action: { label: 'Ir al inicio', to: '/' },
    volver: true,
  },
  '500': {
    code: '500',
    title: 'Se nos descompuso algo',
    message: 'Falló una pieza de nuestro lado, no fuiste tú. Ya lo estamos revisando; intenta de nuevo en un momento.',
    // Engrane con chispa.
    glyph: svg(<><circle cx="11" cy="12" r="3" /><path d="M11 5.5V4M11 20v-1.5M5.5 12H4M18 12h-1.5M6.9 7.9 5.8 6.8M16.2 17.2l-1.1-1.1M6.9 16.1l-1.1 1.1M16.2 6.8l-1.1 1.1" /><path d="M19 3v4M19 10.5h.01" /></>),
    action: { label: 'Reintentar', to: '.' },
  },
  'maintenance': {
    code: '—',
    title: 'En mantenimiento',
    message: 'Estamos afinando la maquinaria. Volvemos en unos minutos; gracias por la paciencia.',
    // Llave de tuercas.
    glyph: svg(<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6v3h3l6-6a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1 2.1-2.1z" />),
    action: { label: 'Reintentar', to: '.' },
  },
}

export default function ErrorPage({ type = '404' }: { type?: ErrorType }) {
  const cfg = CFG[type]
  const nav = useNavigate()
  const reduce = useReducedMotion()

  const go = (to: string) => (to === '.' ? window.location.reload() : nav(to))

  // Banda de precaución (amarillo/oscuro en diagonal). El tramo es de 44px, así
  // que animar background-position 44px la hace "correr" sin costura.
  const bandStyle: React.CSSProperties = {
    backgroundImage: 'repeating-linear-gradient(-45deg, var(--c-gold) 0 12px, var(--c-gold-on) 12px 24px)',
    backgroundSize: '44px 100%',
  }

  return (
    <main className="relative min-h-[78vh] overflow-hidden bg-app text-ink flex flex-col items-center justify-center px-6 py-12">
      {/* Halo dorado tenue de fondo — atmósfera, no decoración chillona. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 h-[42rem] w-[42rem] rounded-full opacity-[0.5]"
        style={{ background: 'radial-gradient(closest-side, var(--c-gold-soft), transparent)' }} />

      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex w-full max-w-lg flex-col items-center text-center"
      >
        {/* Glifo de obra en placa dorada suave */}
        <div className="mb-7 grid h-16 w-16 sm:h-[72px] sm:w-[72px] place-items-center rounded-2xl bg-gold-soft text-gold ring-1 ring-[color:var(--c-gold)]/20">
          {cfg.glyph}
        </div>

        {/* Código gigante, sólido (nada de gradiente en texto) */}
        <div className="relative">
          <span className="block text-[92px] leading-[0.9] sm:text-[128px] font-black tracking-tighter text-ink tabular-nums select-none">
            {cfg.code}
          </span>
          {/* PIEZA-FIRMA: banda de precaución de obra */}
          <motion.div
            aria-hidden
            className="mx-auto mt-2 h-3.5 w-[min(320px,86%)] overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/10"
            style={bandStyle}
            animate={reduce ? undefined : { backgroundPositionX: ['0px', '44px'] }}
            transition={reduce ? undefined : { duration: 1.6, ease: 'linear', repeat: Infinity }}
          />
        </div>

        <h1 className="mt-8 text-[26px] sm:text-[30px] font-black tracking-tight text-ink text-balance">
          {cfg.title}
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-mute text-pretty">
          {cfg.message}
        </p>

        {/* Acciones */}
        <div className="mt-9 flex w-full flex-col-reverse items-center justify-center gap-3 sm:w-auto sm:flex-row">
          {cfg.volver && (
            <button onClick={() => nav(-1)}
              className="h-11 w-full sm:w-auto px-6 rounded-full border border-edge bg-surface text-[14px] font-bold text-ink transition-colors hover:bg-surface-2 active:scale-[0.98]">
              Regresar
            </button>
          )}
          {cfg.action && (
            <button onClick={() => go(cfg.action!.to)}
              className="h-11 w-full sm:w-auto px-7 rounded-full bg-gold text-[color:var(--c-gold-on)] text-[14px] font-black transition-[transform,box-shadow] hover:shadow-[0_10px_30px_var(--c-gold-glow)] active:scale-[0.98] inline-flex items-center justify-center gap-2">
              {cfg.action.label}
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </motion.div>

      {/* Anclaje de marca/localidad — grounding, letra chica */}
      <p className="relative mt-14 text-[12px] font-medium tracking-wide text-mute">
        REMALI · Maquinaria ligera · Acapulco, Gro.
      </p>
    </main>
  )
}
