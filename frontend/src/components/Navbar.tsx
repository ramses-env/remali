import { Link, useNavigate, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { useCart } from '../store/cart'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from './ThemeToggle'
import { AvatarInicial } from '@/components/ui/avatar-inicial'

export default function Navbar() {
  const { token, logout } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const { user } = useProfile()
  const { state } = useCart()
  const cartCount = state.items.reduce((n, i) => n + i.qty, 0)
  const [confirm, setConfirm] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // Nivel 0 = cuenta sin rol en el panel, que es lo que son los clientes.
  const esCliente = Boolean(token) && (user?.puede?.nivel ?? 0) === 0
  // datos_completos viene de /auth/me/ (lo carga el store al entrar): sin fetch
  // aparte, y se refresca solo cuando el perfil llama a refresh() al guardar.
  const perfilIncompleto = esCliente && user?.datos_completos === false

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const isActive = (path: string) => location.pathname === path

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${
        scrolled
          ? 'bg-app/90 backdrop-blur-md border-edge py-3'
          : 'bg-app/70 backdrop-blur-md border-transparent py-5'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]">
            <div className="w-full h-full bg-app rounded-[10px] flex items-center justify-center">
              <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">R</span>
            </div>
          </div>
          <span className="text-xl font-black tracking-tight text-ink group-hover:opacity-80 transition-opacity hidden sm:block">
            REMALI
          </span>
        </Link>

        {/* Links */}
        <nav className="flex-1 flex items-center justify-center gap-6 sm:gap-10">
          {[
            { to: '/', label: 'Inicio' },
            { to: '/equipos', label: 'Equipos' },
          ].map(l => (
            <Link
              key={l.to}
              to={l.to}
              className={`text-sm font-medium transition-colors ${isActive(l.to) ? 'text-gold' : 'text-mute hover:text-ink'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Acciones */}
        <div className="flex items-center gap-3">
          {/* Carrito / cotización del cliente */}
          <Link to="/cotizacion" aria-label="Tu cotización" className="relative w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-gold transition-colors flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-black text-[10px] font-black flex items-center justify-center">{cartCount}</span>
            )}
          </Link>
          <ThemeToggle />

          {token ? (
            <div className="flex items-center gap-2">
              {/* El cliente (nivel 0) no entra al panel: mandarlo ahí solo para que
                  el guard lo rebote es prometerle una puerta que no abre. Su
                  destino es su propio perfil. */}
              <Link
                to={esCliente ? '/perfil' : '/dashboard'}
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-full bg-surface-2 text-ink text-sm font-medium hover:text-gold transition-colors"
              >
                <span className="relative">
                  <AvatarInicial
                    nombre={user?.first_name || user?.username}
                    correo={user?.email}
                    tamano="sm"
                  />
                  {/* Punto de aviso: el perfil incompleto se nota sin abrirlo. El
                      aro del color del fondo lo despega del avatar; sin él los dos
                      círculos se tocan y se lee como una mancha. */}
                  {esCliente && perfilIncompleto && (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-surface" />
                  )}
                </span>
                <span className="max-w-[100px] truncate">{esCliente ? 'Perfil' : 'Panel'}</span>
              </Link>
              <button
                onClick={() => setConfirm(true)}
                className="w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-red-400 transition-colors flex items-center justify-center"
                aria-label="Cerrar sesión"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-full font-bold bg-gold text-black px-5 py-2.5 text-sm hover:opacity-90 transition-opacity"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              <span className="hidden sm:block">Ingresar</span>
            </Link>
          )}
        </div>
      </div>

      {/* Modal de confirmación (portal a body para centrar sobre toda la pantalla) */}
      {createPortal(
        <AnimatePresence>
          {confirm && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md"
              onClick={() => setConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.97, opacity: 0, y: 6 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                onClick={e => e.stopPropagation()}
                className="relative w-full max-w-[380px] bg-surface border border-edge rounded-2xl p-7 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.55)] overflow-hidden"
              >
                {/* Acento dorado superior sutil */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-surface-2 border border-edge text-gold mb-5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5m0 0l-5-5m5 5H9" />
                  </svg>
                </div>

                <h3 className="text-lg font-bold text-ink tracking-tight">¿Cerrar sesión?</h3>
                <p className="text-mute text-sm mt-1.5 leading-relaxed">
                  Saldrás de tu cuenta y tendrás que volver a ingresar tus credenciales para acceder al panel.
                </p>

                <div className="flex gap-2.5 mt-7">
                  <button
                    onClick={() => setConfirm(false)}
                    className="flex-1 px-4 py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => { setConfirm(false); logout(); nav('/') }}
                    className="flex-1 px-4 py-2.5 rounded-full bg-ink text-app text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </header>
  )
}
