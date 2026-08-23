/**
 * Bus de invalidación: mantiene la UI al día sin recargar la página.
 *
 * Cómo funciona
 * ─────────────
 * 1. Toda mutación (POST/PATCH/PUT/DELETE) pasa por la única instancia de axios
 *    (lib/api.ts). Su interceptor llama aquí a `notificarMutacion()`.
 * 2. De la URL se deduce el TEMA afectado (`/ventas/12/` → "ventas") y de ahí
 *    los temas que esa mutación arrastra (vender cambia también stock y KPIs).
 * 3. Quien esté suscrito a esos temas vuelve a pedir sus datos. Nadie tiene que
 *    acordarse de llamar a reload() en cada handler.
 *
 * Por qué así: los refrescos ya existían, pero cada pantalla refrescaba solo lo
 * suyo. Las métricas del dashboard, por ejemplo, se pedían una vez al montar y
 * se quedaban congeladas hasta el F5. Esto centraliza esa decisión en un lugar.
 *
 * Cuando se agreguen WebSockets, el mensaje del servidor solo tiene que llamar a
 * `invalidar('ventas')`: toda la UI ya sabe reaccionar.
 */
import { useEffect } from 'react'

export type Tema =
  | 'equipos' | 'unidades' | 'catalogos' | 'cupones' | 'rentas' | 'ventas'
  | 'cotizaciones' | 'refacciones' | 'reparaciones' | 'facturacion'
  | 'empresas' | 'clientes' | 'notificaciones' | 'metricas' | 'config' | 'usuarios'
  | 'permisos'

/** Primer segmento de la ruta → tema. Lo que no aparezca aquí se ignora. */
const RUTA_A_TEMA: Record<string, Tema> = {
  equipos: 'equipos',
  unidades: 'unidades',
  categorias: 'catalogos', tipos: 'catalogos', marcas: 'catalogos',
  cupones: 'cupones',
  clientes: 'clientes',
  rentas: 'rentas',
  ventas: 'ventas',
  cotizaciones: 'cotizaciones',
  tienda: 'cotizaciones',          // la solicitud pública crea una cotización
  refacciones: 'refacciones',
  reparaciones: 'reparaciones',
  facturacion: 'facturacion',
  empresas: 'empresas',
  notificaciones: 'notificaciones',
  config: 'config',
  usuarios: 'usuarios',
}

/**
 * Qué se queda viejo cuando algo cambia. Es la parte que de verdad importa:
 * una venta no solo cambia la lista de ventas, también baja el stock, mueve los
 * KPIs y puede generar una solicitud de factura.
 */
const ARRASTRA: Record<Tema, Tema[]> = {
  equipos: ['equipos', 'unidades', 'metricas'],
  unidades: ['unidades', 'equipos', 'metricas'],
  catalogos: ['catalogos', 'equipos'],
  cupones: ['cupones'],
  ventas: ['ventas', 'unidades', 'equipos', 'facturacion', 'metricas', 'notificaciones'],
  rentas: ['rentas', 'unidades', 'equipos', 'facturacion', 'metricas', 'notificaciones'],
  cotizaciones: ['cotizaciones', 'ventas', 'metricas', 'notificaciones'],
  reparaciones: ['reparaciones', 'refacciones', 'unidades', 'metricas'],
  refacciones: ['refacciones', 'metricas'],
  facturacion: ['facturacion', 'metricas'],
  empresas: ['empresas'],
  clientes: ['clientes'],
  notificaciones: ['notificaciones'],
  metricas: ['metricas'],
  config: ['config'],
  usuarios: ['usuarios'],
  // Mover un permiso cambia lo que CADA panel abierto puede hacer, así que
  // arrastra al perfil (`usuarios`): los menús y los botones se reacomodan
  // solos, sin cerrarle la sesión a nadie.
  permisos: ['permisos', 'usuarios'],
}

export function expandTemas(temas: Tema[]): Tema[] {
  const out = new Set<Tema>()
  for (const tema of temas) {
    for (const arrastra of ARRASTRA[tema] || [tema]) out.add(arrastra)
  }
  return Array.from(out)
}

const suscriptores = new Map<Tema, Set<() => void>>()

/** Temas pendientes de avisar. Se juntan para que una ráfaga no dispare N refetch. */
let pendientes = new Set<Tema>()
let timer: number | null = null

function vaciar() {
  timer = null
  const temas = pendientes
  pendientes = new Set()
  for (const tema of temas) {
    for (const fn of suscriptores.get(tema) || []) {
      try { fn() } catch { /* un suscriptor roto no debe frenar a los demás */ }
    }
  }
}

/** Marca temas como viejos. La recarga ocurre en el siguiente tick, agrupada. */
export function invalidar(...temas: Tema[]) {
  for (const t of temas) pendientes.add(t)
  if (timer === null) timer = window.setTimeout(vaciar, 40)
}

/** Deduce el tema de una URL de la API. `/cotizaciones/5/items/3/` → "cotizaciones". */
export function temaDeRuta(url: string): Tema | null {
  const limpia = (url || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '')
  const primero = limpia.split('/').filter(Boolean)[0]
  return (primero && RUTA_A_TEMA[primero]) || null
}

/** La llama el interceptor de axios cuando una mutación responde OK. */
export function notificarMutacion(url: string, metodo: string) {
  const m = (metodo || '').toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return
  const tema = temaDeRuta(url)
  if (tema) invalidar(...expandTemas([tema]))
}

export function suscribir(temas: Tema[], fn: () => void): () => void {
  for (const t of temas) {
    if (!suscriptores.has(t)) suscriptores.set(t, new Set())
    suscriptores.get(t)!.add(fn)
  }
  return () => { for (const t of temas) suscriptores.get(t)?.delete(fn) }
}

// ── Volver a la pestaña ──────────────────────────────────────────────────────
// Mientras estuviste fuera, otra persona pudo haber capturado algo. Al regresar
// se refresca todo lo que alguien esté observando, con tope para no martillar.
const ESPERA_FOCO_MS = 10_000
let ultimoFoco = 0

function alVolver() {
  if (document.visibilityState === 'hidden') return
  const ahora = Date.now()
  if (ahora - ultimoFoco < ESPERA_FOCO_MS) return
  ultimoFoco = ahora
  invalidar(...(Array.from(suscriptores.keys()) as Tema[]))
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', alVolver)
  document.addEventListener('visibilitychange', alVolver)
}

/**
 * Suscribe una carga de datos a sus temas y la ejecuta al montar.
 * `cargar` debe ser estable (useCallback con deps vacías), como los load* actuales.
 */
export function useRecurso(temas: Tema[], cargar: () => void) {
  useEffect(() => {
    cargar()
    return suscribir(temas, cargar)
    // Los temas se declaran fijos en cada llamada; cargar es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar])
}
