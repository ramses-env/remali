/**
 * Quién puede entrar al panel, en un solo lugar.
 *
 * Esta regla estaba escrita a mano en el login y en el guard de ruta, y las dos
 * copias preguntaban por `is_staff` o el grupo 'Administrador'. Un almacenista
 * cumple ninguna de las dos, así que iniciaba sesión y el guard lo devolvía al
 * login. Aquí vive una sola versión; el backend es quien manda (ver
 * `permissions.puede_de`).
 */
import api from './api'

export type Capacidades = {
  nivel: number; rol: string
  gestionar_usuarios: boolean; configurar_negocio: boolean
  /** Las cuentas del negocio: métricas, ingresos, historial de ventas. */
  ver_dinero: boolean
  /** Los montos de lo que uno mismo opera: quien entrega también cobra. */
  ver_montos_operacion: boolean
  vender: boolean; rentar: boolean; cotizar: boolean
  facturar: boolean; editar_catalogo: boolean
  /** Dar de alta equipo nuevo, distinto de mover el que ya existe. */
  alta_inventario: boolean
  operar_inventario: boolean; reparar: boolean
  /** La caja: punto de venta de refacciones en el mostrador. */
  usar_caja: boolean
  /** Cerrar el turno de caja (arqueo). */
  corte_caja: boolean
  /** Buscar en el padrón y abrir la ficha de un cliente. Nivel 1: el
   *  mostrador es quien más lo necesita. */
  ver_clientes: boolean
  /** Dar de alta clientes y contactos. Los fiscales siguen siendo de admin. */
  editar_clientes: boolean
  /** "Mi jornada": el escritorio del técnico de campo (no cascadea a admin). */
  jornada_campo: boolean
  /** Mirar el tablero de campo sin poder tocarlo (supervisión de administración). */
  ver_jornada: boolean
}

export type Yo = {
  id?: number; username?: string; email?: string
  is_staff?: boolean; is_superuser?: boolean
  groups?: string[]
  puede?: Capacidades
}

export const CLAVE_NIVEL = 'remali_nivel'
export const CLAVE_DUENO = 'remali_dueno'
/** ¿Esta cuenta ACTÚA en campo? Decide en qué sección abre el panel, y hay que
 *  saberlo antes de que llegue el perfil por red. El nivel no basta: el cajero y
 *  el asesor comparten el nivel 1 con el técnico y no andan en campo. */
export const CLAVE_JORNADA = 'remali_jornada'

/** Con nivel 0 la cuenta existe pero no tiene rol: no entra al panel. */
export function entraAlPanel(yo: Yo | null | undefined): boolean {
  return Number(yo?.puede?.nivel ?? 0) > 0
}

/**
 * A dónde va cada quien al quedar autenticado.
 *
 * El login es el mismo para los tres públicos; lo que cambia es el destino:
 * dueño, administrador y técnico operan en el panel; el cliente (nivel 0) tiene
 * cuenta pero su lugar es la tienda.
 */
export function destinoSegun(yo: Yo | null | undefined): string {
  return entraAlPanel(yo) ? '/dashboard' : '/'
}

/**
 * Destino final tomando en cuenta el `next` con el que el guard mandó al login.
 *
 * El `next` NO se obedece a ciegas: un cliente que llega con `next=/dashboard`
 * entraría, el guard lo rechazaría y lo devolvería al login con el mismo `next`,
 * en bucle. Si no entra al panel, una ruta del panel no es destino válido.
 */
export function destinoTrasEntrar(yo: Yo | null | undefined, next?: string | null): string {
  const base = destinoSegun(yo)
  // Admin/dueño/técnico SIEMPRE entran al panel: su lugar es administrar, no la
  // tienda ni el perfil de cliente. Un `next` de la tienda (perfil, favoritos,
  // un equipo…) no los desvía — para eso entraron.
  if (entraAlPanel(yo)) return '/dashboard'
  // Cliente (no entra al panel): un `next` que apunte al panel lo mandaría al
  // guard, que lo rechaza y lo regresa al login con el mismo `next` → bucle
  // (parpadeo). Para él, una ruta del panel NO es un destino válido.
  if (!next || next.startsWith('/dashboard')) return base
  return next
}

/**
 * Guarda lo que el panel necesita ANTES de pintarse: el acento del dueño y la
 * sección donde abre. Ambos dependen del rol, y el perfil llega por red.
 */
export function recordarAcceso(yo: Yo | null | undefined) {
  const nivel = Number(yo?.puede?.nivel ?? 0)
  const dueno = Boolean(yo?.is_superuser)
  try {
    localStorage.setItem(CLAVE_NIVEL, String(nivel))
    localStorage.setItem(CLAVE_DUENO, dueno ? '1' : '0')
    localStorage.setItem(CLAVE_JORNADA, yo?.puede?.jornada_campo ? '1' : '0')
  } catch { /* modo privado: se resuelve al cargar el perfil */ }
  document.documentElement.classList.toggle('tema-dueno', dueno)
}

/** Borra el rastro de la cuenta anterior en este navegador. */
export function olvidarAcceso() {
  try {
    localStorage.removeItem(CLAVE_NIVEL)
    localStorage.removeItem(CLAVE_DUENO)
    localStorage.removeItem(CLAVE_JORNADA)
  } catch { /* nada que limpiar */ }
  document.documentElement.classList.remove('tema-dueno')
}

export function consultarYo() {
  return api.get<Yo>('/auth/me/').then(r => r.data)
}

/* ── Consulta de permisos desde cualquier componente ──
   Sin esto habría que pasar `puede` como prop por media docena de módulos, y el
   que se olvidara mostraría botones que responden 403. */
import { createContext, useContext } from 'react'

const CtxPermisos = createContext<Capacidades | null>(null)
export const ProveedorPermisos = CtxPermisos.Provider

/** Capacidad del usuario actual. Ante la duda (aún cargando) responde false. */
export function usePuede(): (cap: keyof Capacidades) => boolean {
  const caps = useContext(CtxPermisos)
  return (cap) => Boolean(caps?.[cap])
}
