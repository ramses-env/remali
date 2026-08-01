import { Link, useNavigate, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useAuth } from '../store/auth'
import CampanaCliente from './CampanaCliente'
import { useProfile } from '../store/profile'
import { useCart } from '../store/cart'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from './ThemeToggle'
import { AvatarInicial } from '@/components/ui/avatar-inicial'
import LogoRemali from '@/components/ui/logo-remali'

export default function Navbar() {
  const { token, logout } = useAuth()
  const [menuCuenta, setMenuCuenta] = useState(false)
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
          <LogoRemali className="w-10 h-10 text-ink group-hover:text-gold transition-colors" />
          <span className="text-xl font-black tracking-tight text-ink group-hover:opacity-80 transition-opacity hidden sm:block">
            REMALI
          </span>
        </Link>

        {/* Links */}
        {/* En móvil el dock inferior ya trae Inicio/Equipos: arriba sobran. */}
        <nav className="flex-1 hidden md:flex items-center justify-center gap-10">
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
          {/* Cotización del cliente: es el módulo de cotizar, no un carrito de
              tienda — el ícono de documento comunica eso (igual que el dock). */}
          <Link to="/cotizacion" aria-label="Tu cotización" className="relative w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-gold transition-colors flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h4" /></svg>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-black text-[10px] font-black flex items-center justify-center">{cartCount}</span>
            )}
          </Link>
          <ThemeToggle />
          {esCliente && <CampanaCliente />}

          {token ? (
            <div className="relative flex items-center">
              {/* El cliente (nivel 0) no entra al panel: mandarlo ahí solo para que
                  el guard lo rebote es prometerle una puerta que no abre. Su
                  destino es su propio perfil. */}
              {/* Antes era `hidden sm:flex`: en móvil desaparecía y no quedaba
                  forma de ir al perfil/panel desde la barra. Ahora se ve siempre,
                  compacto (solo el avatar) en celular y con etiqueta en pantallas
                  grandes. */}
              {/* Un solo control: avatar → menú (Perfil/Panel + Cerrar sesión).
                  Ahorra espacio en móvil y el logout deja de ocupar la barra. */}
              <button
                onClick={() => setMenuCuenta(v => !v)}
                aria-haspopup="menu" aria-expanded={menuCuenta} aria-label="Tu cuenta"
                className="flex items-center gap-2 p-1.5 sm:pl-2 sm:pr-3 sm:py-1.5 rounded-full bg-surface-2 text-ink text-sm font-medium hover:text-gold transition-colors"
              >
                <span className="relative">
                  <AvatarInicial
                    nombre={user?.first_name || user?.username}
                    correo={user?.email}
                    tamano="sm"
                  />
                  {esCliente && perfilIncompleto && (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-surface" />
                  )}
                </span>
                <span className="hidden sm:block max-w-[100px] truncate">{esCliente ? 'Perfil' : 'Panel'}</span>
                <svg className="hidden sm:block w-3.5 h-3.5 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>

              {menuCuenta && (
                <>
                  <div className="fixed inset-0 z-[80]" onClick={() => setMenuCuenta(false)} />
                  <div role="menu" className="absolute right-0 top-full mt-2 z-[81] w-64 rounded-2xl border border-edge bg-surface shadow-[0_20px_50px_rgba(17,24,39,0.18)] overflow-hidden">
                    <div className="px-4 py-3.5 border-b border-edge flex items-center gap-3">
                      <AvatarInicial nombre={user?.first_name || user?.username} correo={user?.email} tamano="md" />
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-ink truncate">{user?.first_name || user?.username}</p>
                        <p className="text-[12px] text-mute truncate">{user?.email}</p>
                      </div>
                    </div>
                    <Link to={esCliente ? '/perfil' : '/dashboard'} onClick={() => setMenuCuenta(false)}
                      className="flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-ink hover:bg-surface-2 transition-colors">
                      <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
                      {esCliente ? 'Perfil' : 'Panel'}
                    </Link>
                    <button onClick={() => { setMenuCuenta(false); setConfirm(true) }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-red-500 hover:bg-red-500/10 transition-colors border-t border-edge">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      Cerrar sesión
                    </button>
                  </div>
                </>
              )}
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
