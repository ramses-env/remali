import api from './api'
import { guardarEspacio, leerEspacio } from './espacio'
import type { Modalidad } from '../store/cart'

/* ── Borradores de cotización del cliente ──────────────────────────────────
   El taller privado del cliente: arma varias versiones, las compara, y decide
   cuáles manda. Viven en el SERVIDOR (antes vivían en localStorage y se perdían
   al cambiar de dispositivo), pero REMALI no los ve: son otra tabla, y el panel
   nunca la consulta.

   El folio nace cuando el cliente decide mandarla —directo o autorizada por su
   jefe—, nunca antes. Un borrador no existe para el negocio. */

/** Una línea del borrador = una línea del carrito (misma forma que store/cart). */
export type LineaBorrador = {
  lineId: number
  id: number
  title: string
  price: number
  qty: number
  duracion?: number
  image?: string
  unit?: Modalidad
}

/** Como la manda el servidor: el precio lo resuelve él, no el navegador. */
export type ItemServidor = {
  id: number
  equipo: number | null
  descripcion: string
  cantidad: number
  duracion: number
  modalidad: Modalidad
  precio_unitario: string
  precio_lista: string
  subtotal: string
  /** false = el equipo ya no está en el catálogo; no cuenta en el total. */
  disponible: boolean
}

export type EstadoBorrador = 'armando' | 'esperando' | 'rechazado' | 'entregado'

export type Borrador = {
  id: number
  nombre: string
  estado: EstadoBorrador
  estado_label: string
  /** Congelado = ya se mandó a autorizar; su precio dejó de seguir al catálogo. */
  congelado: boolean
  requiere_factura: boolean
  tipo: 'venta' | 'renta' | 'mixta'
  total: string
  items: ItemServidor[]
  decision: '' | 'autorizado' | 'rechazado' | 'cambios'
  rechazo_motivo: string
  /** Lo que quien autoriza pidió cambiar. Se limpia en cuanto el cliente lo edita. */
  cambios_pedidos: string
  paquete: number | null
  cotizacion: number | null
  folio: string | null
  creado: string
  actualizado: string
}

export type Paquete = {
  id: number
  token: string
  liga: string
  modo: 'opciones' | 'lista'
  mensaje: string
  estado: 'pendiente' | 'resuelto' | 'retirado'
  vencido: boolean
  vence_el: string | null
  autorizada_por: string
  resuelto_en: string | null
  total: string
  congelado_en: string
  borradores?: Borrador[]
}

/** Tope del servidor (cotizaciones/models_borrador.py). */
export const MAX_BORRADORES = 20

// ── Lectura ──

export async function listarBorradores(): Promise<{ borradores: Borrador[]; paquetes: Paquete[] }> {
  const r = await api.get<{ borradores: Borrador[]; paquetes: Paquete[]; espacio_token: string }>('/borradores/')
  guardarEspacio(r.data.espacio_token)
  return { borradores: r.data.borradores || [], paquetes: r.data.paquetes || [] }
}

// ── Escritura ──

type DatosBorrador = {
  nombre?: string
  items: LineaBorrador[]
  requiere_factura?: boolean
  datos_contacto?: Record<string, string>
  obra?: Record<string, string>
}

/** Solo se manda la INTENCIÓN (qué equipo, cuánto, en qué modalidad). El precio
 *  lo pone el servidor: si lo mandara el navegador, cualquiera podría cotizarse
 *  una revolvedora en $1. */
const aPayload = (items: LineaBorrador[]) =>
  items.map(i => ({ id: i.id, cantidad: i.qty, duracion: i.duracion || 1, unit: i.unit || 'venta' }))

export async function crearBorrador(d: DatosBorrador): Promise<Borrador> {
  const r = await api.post<{ borrador: Borrador; espacio_token: string }>('/borradores/', {
    nombre: d.nombre || '',
    items: aPayload(d.items),
    requiere_factura: !!d.requiere_factura,
    datos_contacto: d.datos_contacto || {},
    obra: d.obra || {},
  })
  guardarEspacio(r.data.espacio_token)
  return r.data.borrador
}

export async function actualizarBorrador(id: number, d: Partial<DatosBorrador>): Promise<Borrador> {
  const cuerpo: Record<string, unknown> = {}
  if (d.nombre !== undefined) cuerpo.nombre = d.nombre
  if (d.items !== undefined) cuerpo.items = aPayload(d.items)
  if (d.requiere_factura !== undefined) cuerpo.requiere_factura = d.requiere_factura
  if (d.datos_contacto !== undefined) cuerpo.datos_contacto = d.datos_contacto
  if (d.obra !== undefined) cuerpo.obra = d.obra
  const r = await api.patch<{ borrador: Borrador }>(`/borradores/${id}/`, cuerpo)
  return r.data.borrador
}

export async function eliminarBorrador(id: number): Promise<void> {
  await api.delete(`/borradores/${id}/`)
}

/** Una versión nueva a partir de otra. Es lo que reemplaza a "editar el
 *  rechazado": lo que el jefe ya juzgó se queda como registro. */
export async function duplicarBorrador(id: number): Promise<Borrador> {
  const r = await api.post<{ borrador: Borrador }>(`/borradores/${id}/duplicar/`, {})
  return r.data.borrador
}

/** Directo a REMALI, sin pasar por el jefe. */
export async function enviarBorrador(id: number): Promise<{ folio: string }> {
  const r = await api.post<{ folio: string }>(`/borradores/${id}/enviar/`, {})
  return r.data
}

// ── Autorización ──

/** Uno o varios borradores bajo UNA liga. Mandar uno y mandar tres es el mismo
 *  camino: el paquete de uno no es un caso especial. */
export async function mandarAAutorizar(
  ids: number[],
  modo: 'opciones' | 'lista',
  mensaje = '',
): Promise<Paquete> {
  const r = await api.post<{ paquete: Paquete }>('/autorizaciones/', { borradores: ids, modo, mensaje })
  return r.data.paquete
}

export async function retirarPaquete(id: number): Promise<void> {
  await api.delete(`/autorizaciones/${id}/`)
}

/** Adopta a la cuenta los borradores armados como invitado. Idempotente: si no
 *  hay nada que reclamar devuelve 0. */
export async function reclamarEspacio(): Promise<number> {
  if (!leerEspacio()) return 0
  try {
    const r = await api.post<{ reclamados: number }>('/espacio/reclamar/', {})
    return r.data.reclamados || 0
  } catch {
    return 0
  }
}

// ── Rescate de los borradores viejos ──

const CLAVE_VIEJA = 'remali_borradores'

/** Los borradores que quedaron en localStorage de la versión anterior se suben
 *  al servidor una sola vez. Nadie pierde lo que ya tenía guardado. */
export async function migrarBorradoresLocales(): Promise<number> {
  let viejos: { nombre?: string; items?: LineaBorrador[] }[] = []
  try {
    const crudo = localStorage.getItem(CLAVE_VIEJA)
    if (!crudo) return 0
    viejos = JSON.parse(crudo)
  } catch {
    return 0
  }
  if (!Array.isArray(viejos) || !viejos.length) return 0

  let subidos = 0
  for (const v of viejos.slice(0, MAX_BORRADORES)) {
    if (!Array.isArray(v?.items) || !v.items.length) continue
    try {
      await crearBorrador({ nombre: v.nombre || '', items: v.items })
      subidos++
    } catch {
      /* uno que falle no debe frenar a los demás */
    }
  }
  // Solo se borra la llave si TODO lo que tenía contenido llegó al servidor.
  const conContenido = viejos.filter(v => Array.isArray(v?.items) && v.items.length).length
  if (subidos >= conContenido) {
    try { localStorage.removeItem(CLAVE_VIEJA) } catch { /* da igual */ }
  }
  return subidos
}

// ── Presentación ──

/** Las partidas del borrador, en la forma del carrito, para "cargar" o
 *  "volver a cotizar". Se saltan las que ya no están en el catálogo. */
export function aLineasDeCarrito(b: Borrador): LineaBorrador[] {
  return b.items
    .filter(i => i.disponible && i.equipo)
    .map((i, idx) => ({
      lineId: Date.now() + idx,
      id: i.equipo as number,
      title: i.descripcion,
      price: Number(i.precio_unitario) || 0,
      qty: i.cantidad,
      duracion: i.duracion,
      unit: i.modalidad,
    }))
}

export const totalBorrador = (b: Borrador): number => Number(b.total) || 0

export const esVentaBorrador = (b: Borrador): boolean => b.tipo === 'venta'

/** ¿Alguna partida se quedó sin equipo? Hay que decírselo antes de que mande. */
export const tieneEquiposCaidos = (b: Borrador): boolean => b.items.some(i => !i.disponible)

export function resumenBorrador(b: Borrador): string {
  const n = b.items.length
  const nombres = [...new Set(b.items.map(i => i.descripcion))]
  const equipos = nombres.length === 1 ? nombres[0]
    : nombres.length > 1 ? `${nombres[0]} +${nombres.length - 1}`
    : 'Sin equipos'
  return `${n} equipo${n === 1 ? '' : 's'} · ${equipos}`
}
