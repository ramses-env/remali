import { useLocation } from 'react-router-dom'
import { LayoutGrid, Heart, ClipboardList, CalendarClock, LogIn, LayoutDashboard, MessageCircle } from 'lucide-react'

import Dock, { type DockItem } from '@/components/ui/dock'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { useCart } from '../store/cart'
import { useFavoritos } from '../store/favoritos'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'
import { useEsDelNegocio } from '../store/profile'

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
  const delNegocio = useEsDelNegocio()
  const cfg = useConfigPublica()

  const enCotizacion = state.items.reduce((n, i) => n + i.qty, 0)
  const esCliente = Boolean(token) && (user?.puede?.nivel ?? 0) === 0

  const ruta = loc.pathname
  const catalogoActivo = ruta === '/equipos' || ruta.startsWith('/equipo/')

  const items: DockItem[] = [
    { key: 'catalogo', label: 'Catálogo', to: '/equipos', activo: catalogoActivo, icon: <LayoutGrid className="h-[22px] w-[22px]" /> },
    { key: 'favoritos', label: 'Favoritos', to: '/favoritos', activo: ruta === '/favoritos', badge: favoritos, icon: <Heart className="h-[22px] w-[22px]" /> },
    /* La cotización es del cliente: una cuenta del equipo no la arma
       (ver `useEsDelNegocio`), así que su pestaña tampoco aparece. */
    ...(delNegocio ? [] : [{ key: 'cotizacion', label: 'Cotización', to: '/cotizacion', activo: ruta === '/cotizacion', badge: enCotizacion, icon: <ClipboardList className="h-[22px] w-[22px]" /> }]),
    // WhatsApp directo al negocio: lo que un cliente de renta más repite
    // (preguntar disponibilidad, cerrar el trato). Abre el chat con un mensaje listo.
    { key: 'whatsapp', label: 'WhatsApp', 'data-onboarding': 'dock-whatsapp' as any, onClick: () => { const w = waLink(cfg.whatsapp_principal, 'Hola REMALI, quiero información sobre un equipo.'); if (w) window.open(w, '_blank', 'noopener') }, icon: <MessageCircle className="h-[22px] w-[22px]" /> },
    // El último item depende de quién eres: sin sesión, a entrar; cliente (nivel 0),
    // a su perfil; admin o técnico, al panel. Antes mandaba a /perfil a todos, así
    // que en móvil el staff se quedaba sin forma de volver al panel.
    // El perfil ahora se abre desde el encabezado del menú (avatar → nombre),
    // así que el dock aprovecha ese lugar para lo transaccional del cliente.
    !token
      ? { key: 'entrar', label: 'Entrar', to: '/login', activo: ruta === '/login', icon: <LogIn className="h-[22px] w-[22px]" /> }
      : esCliente
        ? { key: 'mis-rentas', label: 'Mis rentas', to: '/mis-rentas', activo: ruta === '/mis-rentas', icon: <CalendarClock className="h-[22px] w-[22px]" /> }
        : { key: 'panel', label: 'Panel', to: '/dashboard', activo: ruta === '/dashboard', icon: <LayoutDashboard className="h-[22px] w-[22px]" /> },
  ]

  return <Dock items={items} />
}
