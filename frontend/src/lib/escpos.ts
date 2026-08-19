/**
 * Generador ESC/POS — arma los bytes que entiende una impresora térmica
 * directamente, SIN driver del sistema operativo. Se envían por Web Serial.
 *
 * Referencia de comandos: estándar Epson ESC/POS (compatible con la mayoría de
 * las térmicas de 58/80 mm y sus clones).
 */

import { rasterCacheado } from './ticketLogo'

type Linea = { nombre: string; detalle?: string; importe?: string }
type Total = { label: string; value: string; fuerte?: boolean }
export type Comprobante = {
  tipo: string; titulo: string; folio: string; fecha: string
  meta: { label: string; value: string }[]
  items: Linea[]; totales: Total[]; pie: string[]
}

// ── Códigos base ──
const ESC = 0x1b, GS = 0x1d
const INIT = [ESC, 0x40]                    // inicializa
const CODEPAGE_CP850 = [ESC, 0x74, 2]       // selecciona CP850 (acentos y ñ)
const ALIGN = (n: 0 | 1 | 2) => [ESC, 0x61, n]     // 0 izq, 1 centro, 2 der
const BOLD = (on: boolean) => [ESC, 0x45, on ? 1 : 0]
const SIZE = (w: number, h: number) => [GS, 0x21, ((w - 1) << 4) | (h - 1)]  // 1..8
const FEED = (n: number) => [ESC, 0x64, n]
const CUT = [GS, 0x56, 66, 0]               // corte parcial con avance (no-op si no hay cutter)

// Mapa de caracteres Latin → CP850 (preserva acentos y ñ en la mayoría de impresoras).
const CP850: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ü': 0x81,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, 'Ü': 0x9a,
  'ñ': 0xa4, 'Ñ': 0xa5, 'ç': 0x87, 'Ç': 0x80,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, '€': 0xd5, '£': 0x9c, '·': 0xfa, '–': 0x2d, '—': 0x2d,
}

function encodeText(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code < 128) { out.push(code); continue }
    if (CP850[ch] != null) { out.push(CP850[ch]); continue }
    // Fallback: quita el acento (á→a); si no se puede, '?'
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out.push(base && base.charCodeAt(0) < 128 ? base.charCodeAt(0) : 0x3f)
  }
  return out
}

function line(text = ''): number[] {
  return [...encodeText(text), 0x0a]
}

function separador(width: number): number[] {
  return line('-'.repeat(width))
}
function separadorFuerte(width: number): number[] {
  return line('='.repeat(width))
}

// Datos de un CODE128 (conjunto B) para el comando GS k.
function code128B(s: string): number[] {
  const out = [0x7b, 0x42] // {B
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c === 0x7b) out.push(0x7b, 0x7b)
    else if (c >= 32 && c < 128) out.push(c)
  }
  return out
}

type NegocioTicket = { nombre?: string; direccion?: string; telefono?: string; rfc?: string; web?: string; footer?: string }

/** Lo que el admin arma en Configuración › Ticket. Viaja en la config pública. */
export type TicketCfg = {
  logo: string            // data URI PNG ya monocromo (lo que la térmica imprime)
  logoEscala: number      // % del ancho del papel
  mostrarLogo: boolean
  lema: string
  mostrarDireccion: boolean
  mostrarTelefono: boolean
  mostrarRfc: boolean
  mostrarWeb: boolean
  codigoBarras: boolean
  leyenda: string         // aviso al pie (devoluciones, garantía)
}

export const TICKET_DEFAULT: TicketCfg = {
  logo: '', logoEscala: 70, mostrarLogo: true, lema: 'Renta · Venta · Servicio',
  mostrarDireccion: true, mostrarTelefono: true, mostrarRfc: true, mostrarWeb: false,
  codigoBarras: true, leyenda: '',
}

// Texto de "fila" (etiqueta izq / valor der) de exactamente `width` caracteres.
function padStr(left: string, right: string, width: number): string {
  const r = right || ''
  const maxLeft = Math.max(0, width - r.length - 1)
  let l = left || ''
  if (l.length > maxLeft) l = l.slice(0, maxLeft)
  const espacios = Math.max(1, width - l.length - r.length)
  return l + ' '.repeat(espacios) + r
}

/** Parte un texto en líneas de `width` caracteres sin cortar palabras.
 *  Sin esto, una dirección larga se sale del papel: la rejilla es fija. */
function envolver(texto: string, width: number): string[] {
  const out: string[] = []
  for (const parrafo of String(texto || '').split(/\r?\n/)) {
    let linea = ''
    for (const palabra of parrafo.trim().split(/\s+/).filter(Boolean)) {
      if (!linea) { linea = palabra.slice(0, width); continue }
      if (linea.length + 1 + palabra.length <= width) { linea += ' ' + palabra; continue }
      out.push(linea)
      linea = palabra.length > width ? palabra.slice(0, width) : palabra
    }
    out.push(linea)   // un párrafo vacío deja su renglón en blanco, a propósito
  }
  return out
}

/**
 * Modelo de línea del ticket — FUENTE ÚNICA que alimenta tanto la vista previa
 * (HTML) como la impresión (ESC/POS), para que se vean IGUAL.
 */
export type TLine =
  | { k: 'text'; t: string; a: 'l' | 'c' | 'r'; b?: boolean; big?: boolean; z?: Zona }
  | { k: 'hr'; heavy?: boolean; z?: Zona }
  | { k: 'sp'; z?: Zona }
  | { k: 'bc'; v: string; z?: Zona }
  | { k: 'logo'; src: string; escala: number; z?: Zona }

/** Zona del ticket a la que pertenece cada línea. La impresión la ignora; sirve
 *  para que el configurador pueda señalar en el papel qué acabas de tocar. */
export type Zona = 'logo' | 'cabeza' | 'cuerpo' | 'pie'

/** Arma el ticket como una lista de líneas sobre una rejilla de `width` caracteres. */
export function layoutTicket(data: Comprobante, opts: { width: number; negocio?: NegocioTicket; ticket?: Partial<TicketCfg> }): TLine[] {
  const W = opts.width
  const n = opts.negocio || {}
  const c: TicketCfg = { ...TICKET_DEFAULT, ...(opts.ticket || {}) }
  const L: TLine[] = []
  let zona: Zona = 'cabeza'
  const add = (l: TLine) => L.push({ ...l, z: zona } as TLine)
  const txt = (t: string, a: 'l' | 'c' | 'r' = 'l', o: { b?: boolean; big?: boolean } = {}) => add({ k: 'text', t, a, ...o })
  // Los textos libres se envuelven a la rejilla: nada puede salirse del papel.
  const parrafo = (t: string, a: 'l' | 'c' | 'r' = 'c', o: { b?: boolean } = {}) => envolver(t, W).forEach(l => txt(l, a, o))
  // Doble tamaño SOLO si el texto cabe a 2x (≤ W/2 caracteres); si no, se pone
  // en negrita a tamaño normal para que NUNCA se desborde del papel.
  const cabe2x = (s: string) => s.length <= Math.floor(W / 2)

  // Encabezado del negocio
  if (c.mostrarLogo && c.logo) { zona = 'logo'; add({ k: 'logo', src: c.logo, escala: c.logoEscala }); zona = 'cabeza' }
  const nombre = n.nombre || 'REMALI MAQUINARIA'
  txt(nombre, 'c', { b: true, big: cabe2x(nombre) })
  if (c.lema) parrafo(c.lema)
  if (c.mostrarDireccion && n.direccion) parrafo(n.direccion)
  if (c.mostrarTelefono && n.telefono) txt('Tel: ' + n.telefono, 'c')
  if (c.mostrarWeb && n.web) txt(n.web, 'c')
  if (c.mostrarRfc && n.rfc) txt('RFC: ' + n.rfc, 'c')

  // Título
  zona = 'cuerpo'
  add({ k: 'hr', heavy: true })
  const titulo = (data.titulo || '').toUpperCase()
  txt(titulo, 'c', { b: true, big: cabe2x(titulo) })
  txt(padStr('Folio:', data.folio, W))
  txt(padStr('Fecha:', data.fecha, W))

  // Cliente / meta
  if (data.meta.length) {
    add({ k: 'hr' })
    data.meta.forEach(m => txt(padStr(m.label, m.value, W)))
  }

  // Conceptos
  add({ k: 'hr', heavy: true })
  txt(padStr('CONCEPTO', 'IMPORTE', W), 'l', { b: true })
  add({ k: 'hr' })
  data.items.forEach(it => {
    txt(it.nombre, 'l', { b: true })
    if (it.detalle || it.importe) txt(padStr('  ' + (it.detalle || ''), it.importe ? `$${it.importe}` : '', W))
  })

  // Totales
  add({ k: 'hr' })
  data.totales.forEach(t => {
    const val = `$${t.value}`
    // TOTAL a doble tamaño solo si cabe a 2x; si no, negrita a ancho completo.
    if (t.fuerte && (t.label.length + val.length + 1) <= Math.floor(W / 2)) {
      txt(padStr(t.label, val, Math.floor(W / 2)), 'l', { b: true, big: true })
    } else {
      txt(padStr(t.label, val, W), 'l', { b: !!t.fuerte })
    }
  })

  // Pie
  add({ k: 'hr', heavy: true })
  zona = 'pie'
  add({ k: 'sp' })
  data.pie.forEach(p => parrafo(p))
  if (c.leyenda) { add({ k: 'sp' }); parrafo(c.leyenda) }
  if (n.footer) { add({ k: 'sp' }); parrafo(n.footer, 'c', { b: true }) }
  if (c.codigoBarras && data.folio) add({ k: 'bc', v: data.folio })

  return L
}

/**
 * Largo del ticket en MILÍMETROS de papel.
 *
 * A 203 dpi la impresora avanza 8 puntos por milímetro; un renglón normal gasta
 * 30 puntos (3.8 mm) y uno a doble alto el doble. Sirve para dos cosas: decirle
 * al admin cuánto papel gasta cada opción que enciende, y para que la animación
 * de la vista previa dure lo que tarda la impresora de verdad.
 */
export function altoTicketMm(lineas: TLine[], logoMm = 12): number {
  const LH = 3.8
  let mm = 0
  for (const l of lineas) {
    if (l.k === 'bc') mm += 10            // barras (50 pt) + folio legible debajo
    else if (l.k === 'logo') mm += logoMm
    else if (l.k === 'sp') mm += LH * 0.6
    else if (l.k === 'text' && l.big) mm += LH * 2
    else mm += LH
  }
  return mm + LH * 3.5                    // avance final y corte
}

/** Arma el ticket en bytes ESC/POS a partir del modelo de líneas (misma fuente que el preview).
 *  Es asíncrona porque el logo se decodifica del PNG a un mapa de bits. */
export async function buildTicket(
  data: Comprobante,
  opts: { width: number; negocio?: NegocioTicket; ticket?: Partial<TicketCfg>; puntos?: number },
): Promise<Uint8Array> {
  const W = opts.width
  const anchoDots = opts.puntos || (W >= 48 ? 576 : 384)
  const bytes: number[] = []
  const push = (...arr: number[][]) => arr.forEach(a => bytes.push(...a))

  push(INIT, CODEPAGE_CP850)
  for (const ln of layoutTicket(data, opts)) {
    if (ln.k === 'logo') {
      const r = await rasterCacheado(ln.src, Math.round(anchoDots * Math.max(30, Math.min(100, ln.escala)) / 100))
      if (!r) continue   // logo ilegible: el ticket sale igual, solo sin él
      const porFila = r.w / 8
      // GS v 0: modo normal, ancho en BYTES y alto en puntos, ambos little-endian.
      push(ALIGN(1), [GS, 0x76, 0x30, 0, porFila & 0xff, (porFila >> 8) & 0xff, r.h & 0xff, (r.h >> 8) & 0xff])
      bytes.push(...r.bytes)
      push(ALIGN(0))
      continue
    }
    if (ln.k === 'hr') { push(ln.heavy ? separadorFuerte(W) : separador(W)); continue }
    if (ln.k === 'sp') { push(FEED(1)); continue }
    if (ln.k === 'bc') {
      push(FEED(1), ALIGN(1), [GS, 0x48, 2], [GS, 0x66, 0], [GS, 0x68, 50], [GS, 0x77, 2])
      const bc = code128B(ln.v)
      push([GS, 0x6b, 73, bc.length, ...bc], ALIGN(0))
      continue
    }
    push(ALIGN(ln.a === 'c' ? 1 : ln.a === 'r' ? 2 : 0))
    if (ln.b) push(BOLD(true))
    if (ln.big) push(SIZE(2, 2))
    push(line(ln.t))
    if (ln.big) push(SIZE(1, 1))
    if (ln.b) push(BOLD(false))
    push(ALIGN(0))
  }
  push(FEED(3), CUT)
  return new Uint8Array(bytes)
}

/** Ticket corto de prueba (para el botón "imprimir prueba").
 *  `nota` se imprime en grande (ej. la velocidad probada) para identificar cuál sirvió. */
export function buildTestTicket(width: number, empresa = 'REMALI MAQUINARIA', nota = ''): Uint8Array {
  const bytes: number[] = []
  const push = (...arr: number[][]) => arr.forEach(a => bytes.push(...a))
  push(INIT, CODEPAGE_CP850, ALIGN(1), BOLD(true), SIZE(2, 2), line(empresa))
  push(SIZE(1, 1), BOLD(false), line('Prueba de impresion'))
  if (nota) push(ALIGN(1), BOLD(true), SIZE(2, 2), line(nota), SIZE(1, 1), BOLD(false))
  push(ALIGN(0), separador(width), line('Acentos: áéíóú ñ Ñ ¿? ¡!'), line('Total ....... $1,234.00'))
  push(FEED(4), CUT)
  return new Uint8Array(bytes)
}
