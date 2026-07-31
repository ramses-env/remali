import { Link } from 'react-router-dom'

/** Migas de pan de la tienda: "Inicio / Sección / Actual".
 *  El último elemento va en tinta y sin enlace; el resto en gris con hover. */
export default function Migas({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Ruta" className="flex items-center gap-2 flex-wrap text-[13.5px] text-mute">
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
