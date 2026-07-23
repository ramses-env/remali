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
}

export type Yo = {
  id?: number; username?: string; email?: string
  is_staff?: boolean; is_superuser?: boolean
  groups?: string[]
  puede?: Capacidades
}

export const CLAVE_NIVEL = 'remali_nivel'
export const CLAVE_DUENO = 'remali_dueno'

/** Con nivel 0 la cuenta existe pero no tiene rol: no entra al panel. */
export function entraAlPanel(yo: Yo | null | undefined): boolean {
  return Number(yo?.puede?.nivel ?? 0) > 0
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
  } catch { /* modo privado: se resuelve al cargar el perfil */ }
  document.documentElement.classList.toggle('tema-dueno', dueno)
}

/** Borra el rastro de la cuenta anterior en este navegador. */
export function olvidarAcceso() {
  try {
    localStorage.removeItem(CLAVE_NIVEL)
    localStorage.removeItem(CLAVE_DUENO)
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
