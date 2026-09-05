/**
 * Generador ESC/POS — arma los bytes que entiende una impresora térmica
 * directamente, SIN driver del sistema operativo. Se envían por Web Serial.
 *
 * Referencia de comandos: estándar Epson ESC/POS (compatible con la mayoría de
 * las térmicas de 58/80 mm y sus clones).
 */

import { rasterCacheado } from './ticketLogo'

type Linea = {
  nombre: string
  /** Segunda línea del concepto: número de serie, presentación, lo que ayude a reclamar. */
  detalle?: string
  /** Columnas del renglón. Vienen del backend ya formateadas (sin '$'). */
  cantidad?: string
  unitario?: string
  importe?: string
}
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
 * (HTML) como la impresión (ESC/POS): el mismo contenido, en el mismo orden.
 *
 * Las líneas dicen QUÉ es cada cosa (un renglón de venta, una fila
 * etiqueta/valor, el total), no cómo se ve. Así cada medio la dibuja con lo que
 * tiene: la pantalla y el PDF con letra proporcional y columnas de verdad; la
 * térmica con su rejilla de caracteres, que es lo único que sabe imprimir.
 */
export type TLine =
  | { k: 'text'; t: string; a: 'l' | 'c' | 'r'; b?: boolean; z?: Zona }
  | { k: 'name'; t: string; z?: Zona }                              // nombre del negocio
  | { k: 'sub'; t: string; z?: Zona }                               // lema / sucursal
  | { k: 'titulo'; t: string; z?: Zona }                            // "Ticket de Venta"
  | { k: 'row'; l: string; r: string; z?: Zona }                    // etiqueta / valor
  | { k: 'cols'; z?: Zona }                                         // encabezado de la tabla
  | { k: 'item'; nombre: string; detalle?: string; cant: string; unit: string; imp: string; z?: Zona }
  | { k: 'total'; l: string; v: string; fuerte?: boolean; z?: Zona }
  | { k: 'hr'; heavy?: boolean; z?: Zona }
  | { k: 'sp'; z?: Zona }
  | { k: 'bc'; v: string; z?: Zona }
  | { k: 'logo'; src: string; escala: number; z?: Zona }

/** Zona del ticket a la que pertenece cada línea. La impresión la ignora; sirve
 *  para que el configurador pueda señalar en el papel qué acabas de tocar. */
export type Zona = 'logo' | 'cabeza' | 'cuerpo' | 'pie'

/** Encabezados de la tabla de conceptos. Están aquí, y no en cada renderizador,
 *  para que el papel y la pantalla nombren las columnas igual. */
export const COLS = { nombre: 'PRODUCTO', cant: 'CANT.', unit: 'P. UNIT', imp: 'IMPORTE' }

/** Arma el ticket como una lista de líneas. `width` ya no recorta nada: cada
 *  renderizador ajusta el texto a lo suyo. */
export function layoutTicket(data: Comprobante, opts: { width?: number; negocio?: NegocioTicket; ticket?: Partial<TicketCfg> }): TLine[] {
  const n = opts.negocio || {}
  const c: TicketCfg = { ...TICKET_DEFAULT, ...(opts.ticket || {}) }
  const L: TLine[] = []
  let zona: Zona = 'cabeza'
  const add = (l: TLine) => L.push({ ...l, z: zona } as TLine)
  const txt = (t: string, a: 'l' | 'c' | 'r' = 'l', o: { b?: boolean } = {}) => add({ k: 'text', t, a, ...o })

  // ── Encabezado del negocio ──
  if (c.mostrarLogo && c.logo) { zona = 'logo'; add({ k: 'logo', src: c.logo, escala: c.logoEscala }); zona = 'cabeza' }
  add({ k: 'name', t: n.nombre || 'REMALI MAQUINARIA' })
  if (c.lema) add({ k: 'sub', t: c.lema })
  if (c.mostrarDireccion && n.direccion) txt(n.direccion, 'c')
  if (c.mostrarTelefono && n.telefono) txt('Tel. ' + n.telefono, 'c')
  if (c.mostrarWeb && n.web) txt(n.web, 'c')
  if (c.mostrarRfc && n.rfc) txt('RFC ' + n.rfc, 'c')

  // ── Datos del documento ──
  zona = 'cuerpo'
  add({ k: 'hr' })
  if (data.titulo) add({ k: 'titulo', t: data.titulo })
  add({ k: 'row', l: 'Folio', r: data.folio })
  add({ k: 'row', l: 'Fecha', r: data.fecha })
  data.meta.forEach(m => add({ k: 'row', l: m.label, r: m.value }))

  // ── Conceptos ──
  add({ k: 'cols' })
  data.items.forEach(it => add({
    k: 'item',
    nombre: it.nombre,
    detalle: it.detalle,
    // Sin cantidad ni precio unitario (comprobantes viejos) la fila sigue
    // cuadrando: solo se queda con el importe.
    cant: it.cantidad || '',
    unit: it.unitario || '',
    imp: it.importe || '',
  }))

  // ── Totales ──
  add({ k: 'hr' })
  data.totales.forEach(t => add({ k: 'total', l: t.label, v: t.value, fuerte: t.fuerte }))

  // ── Pie ──
  zona = 'pie'
  data.pie.forEach(p => txt(p, 'c'))
  if (c.leyenda) { add({ k: 'sp' }); txt(c.leyenda, 'c') }
  if (n.footer) { add({ k: 'sp' }); txt(n.footer, 'c', { b: true }) }
  if (c.codigoBarras && data.folio) add({ k: 'bc', v: data.folio })

  return L
}

/* ────────────────────────────────────────────────────────────────────────────
   Rejilla de la térmica

   La impresora no sabe de columnas ni de negritas a medias: escribe caracteres
   de ancho fijo, W por renglón. Aquí es donde el modelo de líneas se convierte
   en esa rejilla — un solo lugar, para que el largo del papel que calculamos y
   los bytes que mandamos digan lo mismo.
   ──────────────────────────────────────────────────────────────────────────── */

/** Línea ya aplanada a la rejilla de la impresora. */
export type GLine =
  | { g: 'text'; t: string; a: 'l' | 'c' | 'r'; b?: boolean; big?: boolean }
  | { g: 'hr'; heavy?: boolean }
  | { g: 'sp' }
  | { g: 'bc'; v: string }
  | { g: 'logo'; src: string; escala: number }

/**
 * Dinero como se lee en el mostrador: con separador de miles y el signo
 * adelante. Sin los miles, "$1250000.00" se cuenta con el dedo.
 * Vive aquí, junto al modelo de líneas, para que la pantalla y el papel
 * escriban las cifras igual.
 */
export function money(v: string): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  const m = t.match(/^(-?)(\d+)(\.\d+)?$/)
  if (!m) return `$${t}`                     // ya viene con formato: no lo tocamos
  const miles = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${m[1]}$${miles}${m[3] || ''}`
}

/**
 * Ancho de las cuatro columnas de conceptos, medido con las cifras de ESTE
 * ticket: una retroexcavadora de $1,250,000.00 no cabe en la misma columna que
 * un filtro de $185.00, y si no se mide, el importe sale cortado.
 *
 * Si después de darle su lugar a los números no queda nombre legible, no hay
 * tabla: el renglón se parte en dos —nombre arriba, "cant x precio ..... importe"
 * abajo—. Lo usan la térmica (contando caracteres) y la pantalla (con los que
 * caben a su cuerpo de letra), para que el acomodo se decida igual en los dos.
 */
export function medirColumnas(items: Extract<TLine, { k: 'item' }>[], W: number) {
  const anchoDe = (titulo: string, vals: string[]) => Math.max(titulo.length, ...vals.map(v => v.length), 1)
  const wCant = anchoDe(COLS.cant, items.map(i => i.cant))
  const wUnit = anchoDe(COLS.unit, items.map(i => money(i.unit)))
  const wImp = anchoDe(COLS.imp, items.map(i => money(i.imp)))
  const wNom = W - wImp - wUnit - wCant - 3
  return { cuatro: wNom >= 16, wNom, wCant, wUnit, wImp }
}

/** Caracteres que caben de ancho en la vista de pantalla. La letra proporcional
 *  mete más texto que la rejilla térmica —medido sobre Figtree, que gasta
 *  ~0.5 em por carácter— pero no tanto como para fiarse del ancho en caracteres
 *  del papel. */
export const anchoLegible = (W: number) => (W >= 44 ? 56 : 38)

export function gridTicket(lineas: TLine[], W: number): GLine[] {
  const out: GLine[] = []
  const txt = (t: string, a: 'l' | 'c' | 'r' = 'l', o: { b?: boolean; big?: boolean } = {}) => out.push({ g: 'text', t, a, ...o })
  const parrafo = (t: string, a: 'l' | 'c' | 'r', o: { b?: boolean } = {}) => envolver(t, W).forEach(l => txt(l, a, o))
  // Doble tamaño SOLO si el texto cabe a 2x; si no, negrita a tamaño normal
  // para que NUNCA se desborde del papel.
  const cabe2x = (s: string) => s.length <= Math.floor(W / 2)

  const items = lineas.filter(l => l.k === 'item') as Extract<TLine, { k: 'item' }>[]
  const { cuatro: cuatroColumnas, wNom, wCant, wUnit, wImp } = medirColumnas(items, W)
  const fila = (nom: string, cant: string, unit: string, imp: string, b = false) =>
    txt(nom.padEnd(wNom).slice(0, wNom) + ' ' + cant.padStart(wCant) + ' ' + unit.padStart(wUnit) + ' ' + imp.padStart(wImp), 'l', { b })

  for (const ln of lineas) {
    switch (ln.k) {
      case 'logo': out.push({ g: 'logo', src: ln.src, escala: ln.escala }); break
      case 'bc': out.push({ g: 'bc', v: ln.v }); break
      case 'sp': out.push({ g: 'sp' }); break
      case 'hr': out.push({ g: 'hr', heavy: ln.heavy }); break
      case 'name': {
        const t = ln.t.toUpperCase()
        envolver(t, cabe2x(t) ? Math.floor(W / 2) : W).forEach(l => txt(l, 'c', { b: true, big: cabe2x(t) }))
        break
      }
      case 'sub': parrafo(ln.t, 'c'); break
      case 'titulo': parrafo(ln.t.toUpperCase(), 'c', { b: true }); break
      case 'text': parrafo(ln.t, ln.a, { b: ln.b }); break
      case 'row': txt(padStr(ln.l, ln.r, W)); break
      case 'cols':
        if (cuatroColumnas) fila(COLS.nombre, COLS.cant, COLS.unit, COLS.imp, true)
        else txt(padStr('CONCEPTO', 'IMPORTE', W), 'l', { b: true })
        out.push({ g: 'hr' })
        break
      case 'item': {
        const detalle = ln.detalle ? ` · ${ln.detalle}` : ''
        if (cuatroColumnas) {
          const lineasNom = envolver(ln.nombre + detalle, wNom)
          fila(lineasNom[0] || '', ln.cant, money(ln.unit), money(ln.imp))
          lineasNom.slice(1).forEach(l => txt(l))
          break
        }
        parrafo(ln.nombre, 'l', { b: true })
        // El sangrado va en cada renglón: `envolver` recorta los espacios de
        // adelante, así que meterlo una vez lo perdería al partir el texto.
        if (ln.detalle) envolver(ln.detalle, W - 2).forEach(l => txt('  ' + l))
        const izq = ln.cant && ln.unit ? `  ${ln.cant} x ${money(ln.unit)}` : ''
        // Si la cuenta y el importe no caben juntos, el importe se va solo a la
        // derecha: cortar el precio unitario dejaría una cifra mentirosa.
        if (izq.length + money(ln.imp).length + 1 <= W) txt(padStr(izq || '  ', money(ln.imp), W))
        else { if (izq) txt(izq); txt(money(ln.imp), 'r') }
        break
      }
      case 'total': {
        const val = money(ln.v)
        if (ln.fuerte && (ln.l.length + val.length + 1) <= Math.floor(W / 2)) {
          txt(padStr(ln.l.toUpperCase(), val, Math.floor(W / 2)), 'l', { b: true, big: true })
        } else {
          txt(padStr(ln.l, val, W), 'l', { b: !!ln.fuerte })
        }
        break
      }
    }
  }
  return out
}

/**
 * Largo del ticket en MILÍMETROS de papel.
 *
 * A 203 dpi la impresora avanza 8 puntos por milímetro; un renglón normal gasta
 * 30 puntos (3.8 mm) y uno a doble alto el doble. Sirve para dos cosas: decirle
 * al admin cuánto papel gasta cada opción que enciende, y para que la animación
 * de la vista previa dure lo que tarda la impresora de verdad.
 */
export function altoTicketMm(lineas: TLine[], logoMm = 12, width = 32): number {
  const LH = 3.8
  let mm = 0
  for (const l of gridTicket(lineas, width)) {
    if (l.g === 'bc') mm += 10            // barras (50 pt) + folio legible debajo
    else if (l.g === 'logo') mm += logoMm
    else if (l.g === 'sp') mm += LH * 0.6
    else if (l.g === 'text' && l.big) mm += LH * 2
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
  for (const ln of gridTicket(layoutTicket(data, opts), W)) {
    if (ln.g === 'logo') {
      const r = await rasterCacheado(ln.src, Math.round(anchoDots * Math.max(30, Math.min(100, ln.escala)) / 100))
      if (!r) continue   // logo ilegible: el ticket sale igual, solo sin él
      const porFila = r.w / 8
      // GS v 0: modo normal, ancho en BYTES y alto en puntos, ambos little-endian.
      push(ALIGN(1), [GS, 0x76, 0x30, 0, porFila & 0xff, (porFila >> 8) & 0xff, r.h & 0xff, (r.h >> 8) & 0xff])
      bytes.push(...r.bytes)
      push(ALIGN(0))
      continue
    }
    if (ln.g === 'hr') { push(line((ln.heavy ? '=' : '-').repeat(W))); continue }
    if (ln.g === 'sp') { push(FEED(1)); continue }
    if (ln.g === 'bc') {
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
  push(ALIGN(0), line('-'.repeat(width)), line('Acentos: áéíóú ñ Ñ ¿? ¡!'), line('Total ....... $1,234.00'))
  push(FEED(4), CUT)
  return new Uint8Array(bytes)
}
