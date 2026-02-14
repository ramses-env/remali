import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-800 bg-neutral-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center sm:text-left">
          <div className="space-y-2 max-w-sm mx-auto sm:mx-0">
            <p className="text-xl font-extrabold tracking-tight text-white">Shoping Fal</p>
            <p className="text-sm">Tienda moderna con animaciones y experiencia fluida.</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold">Tienda</p>
            <ul className="space-y-1 text-sm">
              <li><Link to="/productos" className="hover:text-[#517ea0]">Productos</Link></li>
              <li><Link to="/carrito" className="hover:text-[#517ea0]">Carrito</Link></li>
              <li><Link to="/checkout" className="hover:text-[#517ea0]">Checkout</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-semibold">Soporte</p>
            <ul className="space-y-1 text-sm">
              <li><a href="#" className="hover:text-[#517ea0]">Ayuda</a></li>
              <li><a href="#" className="hover:text-[#517ea0]">Envíos</a></li>
              <li><a href="#" className="hover:text-[#517ea0]">Devoluciones</a></li>
            </ul>
          </div>
          <div className="space-y-3">
            <p className="font-semibold">Síguenos</p>
            <div className="flex items-center gap-4 justify-center sm:justify-start">
              <a href="#" className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800" aria-label="Instagram">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>
              </a>
              <a href="#" className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800" aria-label="Facebook">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path d="M9 8h3V6a3 3 0 013-3h2v3h-2a1 1 0 00-1 1v2h3l-1 3h-2v7h-3v-7H9V8z"/></svg>
              </a>
              <a href="#" className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800" aria-label="Twitter">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path d="M22 5.92a8.5 8.5 0 01-2.43.67 4.24 4.24 0 001.86-2.35 8.46 8.46 0 01-2.69 1.02 4.25 4.25 0 00-7.24 3.87A12.06 12.06 0 013 4.89a4.25 4.25 0 001.31 5.67 4.2 4.2 0 01-1.92-.53v.05a4.25 4.25 0 003.41 4.17 4.27 4.27 0 01-1.91.07 4.25 4.25 0 003.97 2.95A8.52 8.52 0 013 19.11a12.05 12.05 0 006.53 1.91c7.85 0 12.15-6.5 12.15-12.13 0-.18-.01-.36-.02-.53A8.66 8.66 0 0022 5.92z"/></svg>
              </a>
            </div>
          </div>
        </div>
        <div className="text-center text-xs text-gray-500">© {new Date().getFullYear()} Shoping Fal. Todos los derechos reservados.</div>
      </div>
    </footer>
  )
}
