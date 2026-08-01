import { Link, useNavigate } from 'react-router-dom'

/** Migas de pan de la tienda: flecha de REGRESO + "Inicio / Sección / Actual".
 *  La flecha vuelve a la página anterior (o al inicio si se llegó directo);
 *  el último elemento va en tinta y sin enlace; el resto en gris con hover. */
export default function Migas({ items }: { items: { label: string; to?: string }[] }) {
  const nav = useNavigate()
  return (
    <nav aria-label="Ruta" className="flex items-center gap-2.5 flex-wrap text-[13.5px] text-mute">
      <button
        onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}
        aria-label="Regresar"
        className="w-8 h-8 rounded-full border border-edge bg-surface grid place-items-center text-mute hover:text-ink hover:border-gold/50 active:scale-95 transition-all shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
      </button>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span>/</span>}
          {it.to
            ? <Link to={it.to} className="hover:text-ink transition-colors">{it.label}</Link>
            : <span className="text-ink font-semibold">{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}
