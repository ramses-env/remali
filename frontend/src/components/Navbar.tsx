import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Navbar() {
  const { token, logout } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const { user } = useProfile()
  const [confirm, setConfirm] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const isHome = location.pathname === '/'

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${
        isHome
          ? scrolled 
            ? 'bg-neutral-900/90 backdrop-blur-md border-neutral-800 py-3 shadow-sm' 
            : 'bg-neutral-900/80 backdrop-blur-md border-transparent py-5'
          : scrolled 
            ? 'bg-neutral-100/90 backdrop-blur-md border-neutral-200 py-3 shadow-sm' 
            : 'bg-neutral-100/80 backdrop-blur-md border-transparent py-5'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="relative w-10 h-10 overflow-hidden rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-[2px]">
            <div className="w-full h-full bg-white rounded-[10px] flex items-center justify-center">
              <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-tr from-blue-600 to-indigo-600">R</span>
            </div>
          </div>
          <span className={`text-xl font-bold tracking-tight transition-opacity group-hover:opacity-80 hidden sm:block ${isHome ? 'text-white' : 'text-neutral-900'}`}>
            Remali
          </span>
        </Link>

        <div className="flex-1 flex items-center justify-end gap-3 sm:gap-8 pr-4 sm:pr-8">
          <NavLink to="/" text="Inicio" isHome={isHome} />
          <NavLink to="/equipos" text="Equipos" isHome={isHome} />
          <NavLink to="/cotizacion" text="Cotización" isHome={isHome} />
        </div>

        <nav className="flex items-center gap-4">
          <div className={`flex items-center gap-3 pl-4 sm:pl-8 border-l ${isHome ? 'border-neutral-800' : 'border-neutral-200'}`}>
            
            {token ? (
              <div className="flex items-center gap-3">
                <Link
                  to="/perfil"
                  className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isHome 
                      ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' 
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-[10px] text-white font-bold uppercase">
                    {(user?.username?.[0] || user?.email?.[0] || 'U')}
                  </div>
                  <span className="max-w-[100px] truncate">{user?.first_name || 'Mi Perfil'}</span>
                </Link>
                <button
                  onClick={() => setConfirm(true)}
                  className={`p-2 rounded-full transition-colors ${
                    isHome 
                      ? 'text-neutral-400 hover:text-red-400 hover:bg-red-500/10' 
                      : 'text-neutral-500 hover:text-red-500 hover:bg-red-50'
                  }`}
                  aria-label="Cerrar sesión"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="group relative flex items-center justify-center gap-2 rounded-full sm:rounded-2xl font-semibold shadow-lg shadow-blue-900/20 transition-all hover:-translate-y-0.5 hover:shadow-blue-900/40 overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-2 sm:px-6 sm:py-2.5"
              >
                <span className="relative z-10">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <span className="relative z-10 hidden sm:block">Ingresar</span>
                <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            )}
          </div>
        </nav>
      </div>



      <AnimatePresence>
        {confirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-sm w-full shadow-2xl"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                </div>
                <h3 className="text-xl font-bold text-neutral-900 mb-2">¿Cerrar sesión?</h3>
                <p className="text-neutral-500 mb-8">Tendrás que volver a ingresar tus credenciales para acceder a tu cuenta.</p>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setConfirm(false)}
                    className="px-4 py-2.5 rounded-xl border border-neutral-200 text-neutral-700 font-medium hover:bg-neutral-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => { setConfirm(false); logout(); nav('/') }}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

function NavLink({ to, text, isHome }: { to: string, text: string, isHome?: boolean }) {
  return (
    <Link 
      to={to} 
      className={`text-sm sm:text-base font-medium transition-colors hover:text-blue-500 ${
        isHome 
          ? 'text-neutral-300' 
          : 'text-neutral-600'
      }`}
    >
      {text}
    </Link>
  )
}
