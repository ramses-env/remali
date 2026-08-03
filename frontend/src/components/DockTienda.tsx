import { useLocation } from 'react-router-dom'
import { LayoutGrid, Heart, ClipboardList, User, LogIn, LayoutDashboard } from 'lucide-react'

import Dock, { type DockItem } from '@/components/ui/dock'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { useCart } from '../store/cart'
import { useFavoritos } from '../store/favoritos'

/**
 * Dock de la tienda pública, para el pulgar en móvil.
 *
 * Son las cuatro acciones que un cliente repite de verdad: explorar el catálogo,
 * volver a lo que guardó, revisar su cotización y entrar a su cuenta. Se dejó
 * fuera "Inicio" (se llega con el logo del encabezado) para no gastar un lugar
 * del pulgar en algo que casi no se usa día a día.
 *
 * El último elemento se adapta a la sesión: quien entró va a su perfil; quien no,
 * al acceso. Poner "Perfil" a un visitante anónimo lo mandaría al login igual,
 * pero con una etiqueta que le miente sobre a dónde va.
 */
export default function DockTienda() {
  const loc = useLocation()
  const { token } = useAuth()
  const { user } = useProfile()
  const { state } = useCart()
  const { count: favoritos } = useFavoritos()

  const enCotizacion = state.items.reduce((n, i) => n + i.qty, 0)
  const esCliente = Boolean(token) && (user?.puede?.nivel ?? 0) === 0
  const perfilIncompleto = esCliente && user?.datos_completos === false

  const ruta = loc.pathname
  const catalogoActivo = ruta === '/equipos' || ruta.startsWith('/equipo/')

  const items: DockItem[] = [
    { key: 'catalogo', label: 'Catálogo', to: '/equipos', activo: catalogoActivo, icon: <LayoutGrid className="h-[22px] w-[22px]" /> },
    { key: 'favoritos', label: 'Favoritos', to: '/favoritos', activo: ruta === '/favoritos', badge: favoritos, icon: <Heart className="h-[22px] w-[22px]" /> },
    { key: 'cotizacion', label: 'Cotización', to: '/cotizacion', activo: ruta === '/cotizacion', badge: enCotizacion, icon: <ClipboardList className="h-[22px] w-[22px]" /> },
    // El último item depende de quién eres: sin sesión, a entrar; cliente (nivel 0),
    // a su perfil; admin o técnico, al panel. Antes mandaba a /perfil a todos, así
    // que en móvil el staff se quedaba sin forma de volver al panel.
    !token
      ? { key: 'entrar', label: 'Entrar', to: '/login', activo: ruta === '/login', icon: <LogIn className="h-[22px] w-[22px]" /> }
      : esCliente
        ? { key: 'perfil', label: 'Perfil', to: '/perfil', activo: ruta === '/perfil', punto: perfilIncompleto, icon: <User className="h-[22px] w-[22px]" /> }
        : { key: 'panel', label: 'Panel', to: '/dashboard', activo: ruta === '/dashboard', icon: <LayoutDashboard className="h-[22px] w-[22px]" /> },
  ]

  return <Dock items={items} />
}
