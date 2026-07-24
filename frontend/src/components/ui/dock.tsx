import * as React from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/**
 * Dock inferior para móvil.
 *
 * Barra flotante con la navegación principal al alcance del pulgar. Se muestra
 * solo por debajo de `md`: en escritorio ya está la barra de arriba y un dock
 * abajo sería repetir la misma navegación dos veces.
 *
 * Cada elemento puede ser una ruta (`to`) o una acción (`onClick`): la tienda
 * navega entre páginas y el panel cambia de sección con estado, y así el mismo
 * componente sirve para ambos sin bifurcarse.
 */
export type DockItem = {
  key: string
  label: string
  /** Icono ya renderizado (p. ej. `<Home className="h-5 w-5" />`). */
  icon: React.ReactNode
  activo?: boolean
  /** Aviso numérico (carrito, no leídas). 0 o ausente = sin globo. */
  badge?: number
  /** Aviso sin número (perfil incompleto): solo un punto. */
  punto?: boolean
  to?: string
  onClick?: () => void
}

export default function Dock({ items, className }: { items: DockItem[]; className?: string }) {
  return (
    // pb con safe-area: en iPhone la barra de gestos se come el borde inferior,
    // y sin esto el dock queda medio tapado por el indicador de inicio.
    <nav
      aria-label="Navegación principal"
      className={cn(
        // px-2.5: poco margen a los lados. El dock se estira casi de borde a
        // borde y se adapta a cualquier ancho de pantalla.
        'fixed inset-x-0 bottom-0 z-40 flex justify-center px-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] md:hidden',
        'pointer-events-none',
        className,
      )}
    >
      <ul
        className={cn(
          // w-full + items flex-1: ocupan todo el ancho disponible y se reparten
          // parejo, en vez de encogerse al centro dejando aire a los lados.
          'pointer-events-auto flex w-full items-stretch gap-0.5 rounded-[22px] border border-edge/80 bg-surface/85 p-1.5',
          'shadow-lg shadow-black/25 backdrop-blur-md',
        )}
      >
        {items.map(it => (
          <li key={it.key} className="flex-1">
            <DockBoton item={it} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function DockBoton({ item }: { item: DockItem }) {
  const contenido = (
    <>
      <span className="relative grid place-items-center">
        {item.icon}
        {/* Globo con número (carrito, no leídas). Se posiciona sobre el icono. */}
        {!!item.badge && item.badge > 0 && (
          <span className="absolute -right-2 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-gold px-1 text-[10px] font-black leading-none text-gold-on">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        )}
        {/* Punto sin número (perfil incompleto). Solo si no hay globo, para no
            apilar dos avisos sobre el mismo icono. */}
        {item.punto && !item.badge && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-surface" />
        )}
      </span>
      <span className="text-[10px] font-semibold leading-none">{item.label}</span>
    </>
  )

  // Presionar hunde un poco el botón (feedback táctil), pero no cuando se pide
  // menos movimiento. El estado activo se marca con el acento, no con tamaño.
  const clases = cn(
    // w-full para llenar la celda flex-1; sin min-width que fuerce el centrado.
    'flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-2',
    'transition-[color,background-color,transform] duration-150 ease-out',
    'active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40',
    item.activo ? 'bg-gold-soft text-gold' : 'text-mute hover:text-ink',
  )

  if (item.to) {
    return (
      <Link to={item.to} aria-current={item.activo ? 'page' : undefined} className={clases}>
        {contenido}
      </Link>
    )
  }
  return (
    <button type="button" onClick={item.onClick} aria-current={item.activo ? 'page' : undefined} className={clases}>
      {contenido}
    </button>
  )
}
