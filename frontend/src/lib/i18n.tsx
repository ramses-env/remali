/**
 * i18n ligero (ES/EN) — contexto + hook `useLang()` con `t(clave)`.
 * Persiste el idioma en localStorage y ajusta <html lang>.
 *
 * Traduce el "shell" de la app (menú, títulos de sección, barra superior,
 * ajustes). El contenido profundo de cada módulo se puede ir agregando por clave.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'ES' | 'EN'

type Dict = Record<string, string>

const ES: Dict = {
  // Grupos del menú
  'navgroup.catalogo': 'Catálogo',
  'navgroup.operacion': 'Operación',
  'navgroup.clientes': 'Clientes',
  'navgroup.cuenta': 'Cuenta',
  // Ítems del menú / títulos de sección
  'sec.resumen.title': 'Resumen',
  'sec.resumen.sub': 'Monitorea tus métricas y gestiona tu operación.',
  'sec.equipos.title': 'Productos',
  'sec.equipos.sub': 'Administra tu catálogo de maquinaria.',
  'sec.inventario.title': 'Inventario',
  'sec.inventario.sub': 'Controla cada unidad física y su estado.',
  'sec.refacciones.title': 'Refacciones',
  'sec.refacciones.sub': 'Piezas para mantenimiento (y venta ocasional al público).',
  'sec.reparaciones.title': 'Reparaciones',
  'sec.reparaciones.sub': 'Órdenes de servicio: recibe equipos, registra el trabajo y entrega la orden.',
  'sec.cotizaciones.title': 'Cotizaciones',
  'sec.cotizaciones.sub': 'Presupuestos para clientes: arma partidas, envía y da seguimiento.',
  'sec.facturacion.title': 'Por facturar',
  'sec.facturacion.sub': 'Ventas y rentas que el cliente pidió facturar. Timbra aparte y márcalas.',
  'sec.catalogos.title': 'Clasificación',
  'sec.catalogos.sub': 'Organiza categorías, tipos y marcas.',
  'sec.rentas.title': 'Rentas',
  'sec.rentas.sub': 'Gestiona rentas activas, reservas y devoluciones.',
  'sec.ubicaciones.title': 'Tu día',
  'sec.ubicaciones.sub': 'Tus entregas, recolecciones y reparaciones del día.',
  'sec.usuarios.title': 'Usuarios',
  'sec.usuarios.sub': 'Quién entra al panel y qué puede hacer.',
  'sec.ventas.title': 'Ventas',
  'sec.ventas.sub': 'Historial de ventas de maquinaria y refacciones.',
  'sec.cupones.title': 'Cupones',
  'sec.cupones.sub': 'Crea y administra códigos de descuento.',
  'sec.notificaciones.title': 'Notificaciones',
  'sec.notificaciones.sub': 'Eventos operativos y pendientes por resolver.',
  'sec.mensajeria.title': 'Mensajería',
  'sec.mensajeria.sub': 'Conversaciones de soporte con clientes.',
  'sec.empresas.title': 'Empresas',
  'sec.empresas.sub': 'Clientes registrados y sus obras.',
  'sec.perfil.title': 'Perfil',
  'sec.perfil.sub': 'Tu información de cuenta.',
  'sec.configuracion.title': 'Configuración',
  'sec.configuracion.sub': 'Ajustes de perfil, seguridad y preferencias.',
  // Barra superior
  'top.search': 'Buscar…',
  'palette.search': 'Buscar módulos, productos, unidades, clientes…',
  'top.language': 'Idioma',
  'top.profile': 'Perfil',
  'top.settings': 'Configuración',
  'top.logout': 'Cerrar sesión',
  'top.notifications': 'Notificaciones',
  'top.messages': 'Mensajería',
  // Configuración
  'cfg.perfil': 'Perfil',
  'cfg.seguridad': 'Seguridad',
  'cfg.preferencias': 'Preferencias',
  'cfg.preferencias.desc': 'Idioma y apariencia de tu panel.',
  'cfg.idioma': 'Idioma',
  'cfg.idioma.desc': 'Idioma de la interfaz',
  'cfg.tema': 'Tema',
  'cfg.tema.desc': 'Claro u oscuro',
  'palette.goto': 'Ir a',
}

const EN: Dict = {
  'navgroup.catalogo': 'Catalog',
  'navgroup.operacion': 'Operations',
  'navgroup.clientes': 'Clients',
  'navgroup.cuenta': 'Account',
  'sec.resumen.title': 'Overview',
  'sec.resumen.sub': 'Monitor your metrics and run your operation.',
  'sec.equipos.title': 'Products',
  'sec.equipos.sub': 'Manage your machinery catalog.',
  'sec.inventario.title': 'Inventory',
  'sec.inventario.sub': 'Track every physical unit and its status.',
  'sec.refacciones.title': 'Spare parts',
  'sec.refacciones.sub': 'Parts for maintenance (and occasional retail sale).',
  'sec.reparaciones.title': 'Repairs',
  'sec.reparaciones.sub': 'Service orders: receive equipment, log the work, hand over the order.',
  'sec.cotizaciones.title': 'Quotes',
  'sec.cotizaciones.sub': 'Client estimates: build line items, send and follow up.',
  'sec.facturacion.title': 'To invoice',
  'sec.facturacion.sub': 'Sales and rentals the client asked to invoice. Stamp separately and mark them.',
  'sec.catalogos.title': 'Classification',
  'sec.catalogos.sub': 'Organize categories, types and brands.',
  'sec.rentas.title': 'Rentals',
  'sec.rentas.sub': 'Manage active rentals, reservations and returns.',
  'sec.ubicaciones.title': 'Your day',
  'sec.ubicaciones.sub': 'Your deliveries, pickups and repairs for the day.',
  'sec.usuarios.title': 'Users',
  'sec.usuarios.sub': 'Who can access the panel and what they can do.',
  'sec.ventas.title': 'Sales',
  'sec.ventas.sub': 'History of machinery and spare-part sales.',
  'sec.cupones.title': 'Coupons',
  'sec.cupones.sub': 'Create and manage discount codes.',
  'sec.notificaciones.title': 'Notifications',
  'sec.notificaciones.sub': 'Operational events and pending items.',
  'sec.mensajeria.title': 'Messages',
  'sec.mensajeria.sub': 'Support conversations with clients.',
  'sec.empresas.title': 'Companies',
  'sec.empresas.sub': 'Registered clients and their sites.',
  'sec.perfil.title': 'Profile',
  'sec.perfil.sub': 'Your account information.',
  'sec.configuracion.title': 'Settings',
  'sec.configuracion.sub': 'Profile, security and preferences.',
  'top.search': 'Search…',
  'palette.search': 'Search modules, products, units, clients…',
  'top.language': 'Language',
  'top.profile': 'Profile',
  'top.settings': 'Settings',
  'top.logout': 'Log out',
  'top.notifications': 'Notifications',
  'top.messages': 'Messages',
  'cfg.perfil': 'Profile',
  'cfg.seguridad': 'Security',
  'cfg.preferencias': 'Preferences',
  'cfg.preferencias.desc': 'Language and appearance of your panel.',
  'cfg.idioma': 'Language',
  'cfg.idioma.desc': 'Interface language',
  'cfg.tema': 'Theme',
  'cfg.tema.desc': 'Light or dark',
  'palette.goto': 'Go to',
}

const DICTS: Record<Lang, Dict> = { ES, EN }

type I18nCtx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string }
const Ctx = createContext<I18nCtx>({ lang: 'ES', setLang: () => {}, t: (k) => ES[k] ?? k })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('lang') as Lang) || 'ES')

  useEffect(() => { document.documentElement.lang = lang === 'EN' ? 'en' : 'es' }, [lang])

  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem('lang', l) } catch { /* ignore */ } }
  const t = (key: string) => DICTS[lang][key] ?? ES[key] ?? key

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)
