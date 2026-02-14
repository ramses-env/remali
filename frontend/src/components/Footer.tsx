import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-800 bg-neutral-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center sm:text-left">
          <div className="space-y-2 max-w-sm mx-auto sm:mx-0">
            <p className="text-xl font-extrabold tracking-tight text-white">REMALI</p>
            <p className="text-sm">Tienda moderna con animaciones y experiencia fluida.</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold">Tienda</p>
            <ul className="space-y-1 text-sm">
              <li><Link to="/equipos" className="hover:text-[#517ea0]">Equipos</Link></li>
              <li><Link to="/carrito" className="hover:text-[#517ea0]">Carrito</Link></li>
              <li><Link to="/checkout" className="hover:text-[#517ea0]">Checkout</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-semibold">Soporte</p>
            <ul className="space-y-1 text-sm">
              <li><Link to="/" className="hover:text-[#517ea0]">Ayuda</Link></li>
              <li><Link to="/" className="hover:text-[#517ea0]">Envíos</Link></li>
              <li><Link to="/" className="hover:text-[#517ea0]">Devoluciones</Link></li>
            </ul>
          </div>
          <div className="space-y-3">
            <p className="font-semibold">Síguenos</p>
            <div className="flex items-center gap-4 justify-center sm:justify-start">
              <a href="https://www.facebook.com/share/18Gh2REUbm/" className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800" aria-label="Facebook" target="_blank" rel="noopener noreferrer">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path d="M9 8h3V6a3 3 0 013-3h2v3h-2a1 1 0 00-1 1v2h3l-1 3h-2v7h-3v-7H9V8z"/></svg>
              </a>
            </div>
          </div>
        </div>
        <div className="text-center text-xs text-gray-500">© {new Date().getFullYear()} Remali. Todos los derechos reservados.</div>
      </div>
    </footer>
  )
}
