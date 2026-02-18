import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 transition-colors duration-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center sm:text-left">
          <div className="space-y-4 max-w-sm mx-auto sm:mx-0">
            <Link to="/" className="flex items-center justify-center sm:justify-start gap-2 group">
              <div className="relative w-8 h-8 overflow-hidden rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 p-[2px]">
                <div className="w-full h-full bg-white dark:bg-neutral-900 rounded-[6px] flex items-center justify-center">
                  <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-tr from-blue-600 to-indigo-600">R</span>
                </div>
              </div>
              <span className="text-xl font-extrabold tracking-tight text-neutral-900 dark:text-white">Remali</span>
            </Link>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Equipos de construcción de alto desempeño para tus proyectos más exigentes. Calidad y soporte garantizado.
            </p>
          </div>
          
          <div className="space-y-4">
            <p className="font-bold text-neutral-900 dark:text-white">Tienda</p>
            <ul className="space-y-2 text-sm text-neutral-600 dark:text-white">
              <li><Link to="/equipos" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Equipos</Link></li>
              <li><Link to="/carrito" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Carrito</Link></li>
              <li><Link to="/checkout" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Checkout</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <p className="font-bold text-neutral-900 dark:text-white">Soporte</p>
            <ul className="space-y-2 text-sm text-neutral-600 dark:text-white">
              <li><Link to="/contacto" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Contacto</Link></li>
              <li><Link to="/" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Envíos</Link></li>
              <li><Link to="/" className="hover:text-blue-600 dark:text-white dark:hover:text-blue-400 transition-colors">Devoluciones</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <p className="font-bold text-neutral-900 dark:text-white">Síguenos</p>
            <div className="flex items-center gap-4 justify-center sm:justify-start">
              <a 
                href="https://www.facebook.com/share/18Gh2REUbm/" 
                className="p-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-all duration-300 shadow-sm hover:shadow-md" 
                aria-label="Facebook" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
              </a>
              <a 
                href="#" 
                className="p-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition-all duration-300 shadow-sm hover:shadow-md" 
                aria-label="Ubicación"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              </a>
            </div>
          </div>
        </div>
        
        <div className="pt-8 border-t border-neutral-100 dark:border-neutral-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-neutral-500 dark:text-neutral-500">
          <p>© {new Date().getFullYear()} Remali. Todos los derechos reservados.</p>
          <div className="flex items-center gap-6">
            <Link to="/privacidad" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Privacidad</Link>
            <Link to="/terminos" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Términos</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
