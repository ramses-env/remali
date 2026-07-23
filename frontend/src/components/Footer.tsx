import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="border-t border-edge bg-surface text-mute">
      <div className="mx-auto max-w-7xl px-6 lg:px-12 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]">
                <div className="w-full h-full bg-surface rounded-[10px] flex items-center justify-center">
                  <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">R</span>
                </div>
              </div>
              <span className="text-ink text-xl font-bold tracking-tight">REMALI</span>
            </div>
            <p className="text-sm leading-relaxed max-w-xs">
              Maquinaria ligera para construcción. Renta y venta de equipos confiables con soporte técnico especializado.
            </p>
          </div>

          <div>
            <p className="font-semibold text-ink mb-4">Equipos</p>
            <ul className="space-y-2 text-sm">
              <li><Link to="/equipos" className="hover:text-ink transition-colors">Catálogo</Link></li>
              <li><Link to="/cotizacion" className="hover:text-ink transition-colors">Cotización</Link></li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-ink mb-4">Contáctanos</p>
            <ul className="space-y-2 text-sm">
              <li><a href="mailto:contacto@remali.mx" className="hover:text-ink transition-colors">contacto@remali.mx</a></li>
              <li><a href="tel:+521234567890" className="hover:text-ink transition-colors">+52 123 456 7890</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-edge flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-mute">© {new Date().getFullYear()} REMALI. Todos los derechos reservados.</p>
          <div className="flex items-center gap-4">
            <a href="#" aria-label="Instagram" className="p-2 rounded-full border border-edge hover:border-gold hover:text-gold transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.5" /></svg>
            </a>
            <a href="#" aria-label="Facebook" className="p-2 rounded-full border border-edge hover:border-gold hover:text-gold transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 8h3V6a3 3 0 013-3h2v3h-2a1 1 0 00-1 1v2h3l-1 3h-2v7h-3v-7H9V8z" /></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
