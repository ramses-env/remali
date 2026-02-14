import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { useState } from 'react'

export default function Navbar() {
  const { token, logout } = useAuth()
  const nav = useNavigate()
  const { user } = useProfile()
  const [confirm, setConfirm] = useState(false)
  return (
    <header className="border-b border-neutral-300 bg-neutral-100/90 backdrop-blur shadow-sm sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/vite.svg"
            alt="Logo"
            className="h-8 w-8 cursor-pointer"
            onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('toggleFilters')) }}
          />
          <span className="hidden sm:inline text-xl font-extrabold tracking-tight text-[#517ea0]">Remali</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <Link to="/" className="px-3 py-1.5 rounded-full text-neutral-600 font-medium hover:text-neutral-800 hover:bg-neutral-100">Inicio</Link>
          <Link to="/equipos" className="px-3 py-1.5 rounded-full text-neutral-600 font-medium hover:text-neutral-800 hover:bg-neutral-100">Equipo</Link>
          <Link to="/cotizacion" className="px-3 py-1.5 rounded-full text-neutral-600 font-medium hover:text-neutral-800 hover:bg-neutral-100">Cotización</Link>
          {token ? (
            <>
              {(user?.is_staff || (user?.groups || []).includes('Administrador')) && (
                <Link to="/admin" className="px-3 py-1.5 rounded-full text-neutral-600 font-medium hover:text-neutral-800 hover:bg-neutral-100">Admin</Link>
              )}
              <button
                aria-label="Logout"
                className="px-3 py-1.5 rounded-full text-neutral-600 font-medium hover:text-neutral-800 hover:bg-neutral-100"
                onClick={() => setConfirm(true)}
              >
                Logout
              </button>
              <Link
                to="/perfil"
                aria-label="Perfil"
                className="user-profile shine-button"
              >
                <span className="user-profile-inner">
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="shine-icon"
                  >
                    <g data-name="Layer 2" id="Layer_2">
                      <path
                        d="m15.626 11.769a6 6 0 1 0 -7.252 0 9.008 9.008 0 0 0 -5.374 8.231 3  3 0 0 0 3 3h12a3 3 0 0 0 3-3 9.008 9.008 0  0 0 -5.374-8.231zm-7.626-4.769a4  4 0 1 1 4 4 4 4 0  0 1 -4-4zm10 14h-12a1 1 0 0 1 -1-1 7 7 0 0 1 14 0 1 1 0  0 1 -1 1z"
                      ></path>
                    </g>
                  </svg>
                  <span className="hidden sm:inline">{(user && (user.first_name || user.username || user.email)) || 'Mi Perfil'}</span>
                </span>
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              aria-label="Login"
              className="user-profile shine-button"
            >
              <span className="user-profile-inner">
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="shine-icon"
                >
                  <g data-name="Layer 2" id="Layer_2">
                    <path
                      d="m15.626 11.769a6 6 0 1 0 -7.252 0 9.008 9.008 0 0 0 -5.374 8.231 3  3 0 0 0 3 3h12a3 3 0 0 0 3-3 9.008 9.008 0  0 0 -5.374-8.231zm-7.626-4.769a4 4 0 1 1 4 4 4 4 0  0 1 -4-4zm10 14h-12a1 1 0 0 1 -1-1 7 7 0 0 1 14 0 1 1 0  0 1 -1 1z"
                    ></path>
                  </g>
                </svg>
                <span className="hidden sm:inline">Login</span>
              </span>
            </Link>
          )}
        </nav>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-[60] bg-black/40 grid place-items-center">
          <div className="w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-white border border-neutral-200 shadow-2xl p-5 w-[92vw] max-w-sm text-center max-h-[80vh] overflow-auto mx-auto">
              <p className="text-lg font-extrabold text-[#517ea0]">¿Seguro de cerrar sesión?</p>
              <p className="text-sm text-neutral-700 mt-1">Se cerrará tu sesión actual.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button className="px-4 py-2 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white" onClick={() => { setConfirm(false); logout(); nav('/') }}>Sí, cerrar</button>
                <button className="px-4 py-2 rounded-full border border-neutral-300 hover:bg-neutral-100" onClick={() => setConfirm(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
