import jsPDF from 'jspdf'
import { formatCurrency } from '../store/priceUnit'
import { cargarConfigPublica } from './configPublica'

type Unit = 'dia' | 'semana' | 'mes'

type ProductRow = {
  id: number
  title: string
  brand?: string
  category?: string
  type?: string
  condition?: string
  modo?: 'venta' | 'renta'
  price: number | string | null
  precioDia?: number | null
  precioSemana?: number | null
  precioMes?: number | null
}

export type EquiposPdfOpts = {
  venta?: boolean          // incluir equipos en venta
  renta?: boolean          // incluir equipos en renta
  rentaTodosPrecios?: boolean  // renta: mostrar día/semana/mes (true) o solo la unidad actual (false)
}

function summarizeFilters(filters: Record<string, string[]>): string {
  const parts: string[] = []
  const add = (key: string, label: string) => {
    const vals = (filters[key] || []).filter(Boolean)
    if (vals.length) parts.push(`${label}: ${vals.join(', ')}`)
  }
  add('brand', 'Marca')
  add('category', 'Categoría')
  add('type', 'Tipo')
  add('condition', 'Condición')
  const priceSel = (filters['price'] || [])[0]
  if (priceSel) {
    const [minStr, maxStr] = priceSel.split(':')
    const min = Number(minStr) || 0
    const max = Number(maxStr) || 0
    if (min || max) parts.push(`Precio: ${min ? `$${formatCurrency(min)}` : ''}${min && max ? ' - ' : ''}${max ? `$${formatCurrency(max)}` : ''}`)
  }
  return parts.length ? parts.join(' | ') : 'Sin filtros'
}

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { mode: 'cors' })
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result || ''))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function downloadEquiposPdf(
  items: ProductRow[],
  filters: Record<string, string[]>,
  unit: Unit,
  opts: EquiposPdfOpts = {},
) {
  const { venta = true, renta = true, rentaTodosPrecios = true } = opts

  // Datos del negocio + logo para el membrete (mismo formato que la cotización).
  const cfg = await cargarConfigPublica()
  const logo = await toDataUrl('/logo-remali.png')

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const inner = pageWidth - margin * 2
  const bottom = pageHeight - 46
  const unitLabel = unit === 'mes' ? 'mes' : unit === 'semana' ? 'semana' : 'día'

  // Paleta (impresa sobre papel blanco → tinta oscura, acentos de marca).
  const INK: [number, number, number] = [17, 24, 39]      // #111827
  const MUTE: [number, number, number] = [122, 128, 138]
  const LINE: [number, number, number] = [226, 227, 231]
  const CARD: [number, number, number] = [250, 250, 252]
  const WHITE: [number, number, number] = [255, 255, 255]
  const GOLD: [number, number, number] = [184, 135, 46]   // #B8872E marca
  const AZUL: [number, number, number] = [43, 95, 173]    // venta  #2B5FAD
  const NARANJA: [number, number, number] = [234, 88, 12] // renta  #EA580C

  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const money = (n: number | string | null | undefined) => `$${formatCurrency(Number(n) || 0)}`

  // Recorta a una línea con elipsis según la fuente/tamaño activos.
  const clip = (txt: string, maxW: number) => {
    if (doc.getTextWidth(txt) <= maxW) return txt
    let t = txt
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
    return t + '…'
  }

  // Rellena los tres precios de renta derivando los que falten (mismos
  // multiplicadores que el catálogo: semana = día×7, mes = día×30, mes = semana×4).
  const triple = (i: ProductRow): Array<number | null> => {
    const d = i.precioDia ?? null, s = i.precioSemana ?? null, m = i.precioMes ?? null
    const dia = d ?? (s != null ? Math.round(s / 7) : m != null ? Math.round(m / 30) : null)
    const sem = s ?? (d != null ? d * 7 : m != null ? Math.round(m / 4) : null)
    const mes = m ?? (d != null ? d * 30 : s != null ? s * 4 : null)
    return [dia, sem, mes]
  }

  const ventas = venta ? items.filter(i => i.modo === 'venta') : []
  const rentas = renta ? items.filter(i => i.modo !== 'venta') : []

  // Datos para el membrete (mismo formato que el PDF de cotización).
  const nombre = cfg.negocio_nombre || 'REMALI'
  const contacto = [
    cfg.negocio_telefono ? `Tel. ${cfg.negocio_telefono}` : '',
    cfg.negocio_email, cfg.negocio_web,
    cfg.negocio_rfc ? `RFC: ${cfg.negocio_rfc}` : '',
  ].filter(Boolean).join('   ·   ')
  const negLineas = [cfg.negocio_direccion, contacto].filter(Boolean)
  const dudas = cfg.negocio_telefono || cfg.whatsapp_principal || ''

  // ── Membrete + pie (una vez por página) ──
  const marco = () => {
    const pagina = doc.getNumberOfPages()
    const s = 30, lx = margin, ly = margin - 6
    if (logo) { try { doc.addImage(logo, 'PNG', lx, ly, s, s) } catch { /* logo opcional */ } }
    else {
      fill([17, 17, 17]); doc.roundedRect(lx, ly, s, s, 5, 5, 'F')
      ink(WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
      doc.text('R', lx + s / 2, ly + s / 2 + 6, { align: 'center' })
    }
    const wx = lx + s + 10
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); ink(INK)
    const wm = clip(nombre, pageWidth - margin - wx - 155)
    doc.text(wm, wx, margin + 9)
    fill(GOLD); doc.rect(wx, margin + 14, doc.getTextWidth(wm), 2.2, 'F') // subrayado dorado
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); ink(MUTE)
    doc.text('CATÁLOGO DE EQUIPOS', pageWidth - margin, margin + 2, { align: 'right' })
    doc.text(new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }),
      pageWidth - margin, margin + 14, { align: 'right' })
    stroke(LINE); doc.setLineWidth(0.8)
    doc.line(margin, margin + 30, pageWidth - margin, margin + 30)
    if (pagina === 1) {
      ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      let by = margin + 42
      negLineas.forEach(l => { doc.text(clip(l, inner), margin, by); by += 11 })
      doc.setFontSize(8)
      doc.text(clip(`Filtros: ${summarizeFilters(filters)}`, inner), margin, by)
    }
    // Pie: información importante + contacto
    ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.text('Precios en pesos (MXN), sujetos a cambio sin previo aviso  ·  Este catálogo es informativo y no aparta el equipo.',
      pageWidth / 2, pageHeight - 30, { align: 'center' })
    const pie = [`Página ${pagina}`, dudas ? `Dudas: ${dudas}` : '', cfg.negocio_web || cfg.negocio_footer || 'REMALI']
      .filter(Boolean).join('   ·   ')
    doc.text(pie, pageWidth / 2, pageHeight - 20, { align: 'center' })
    ink(INK)
  }

  const topFor = (pagina: number) =>
    pagina === 1 ? margin + 42 + negLineas.length * 11 + 16 : margin + 44

  let y = 0
  const nuevaPagina = () => { doc.addPage(); marco(); y = topFor(doc.getNumberOfPages()) }
  const ensure = (h: number) => { if (y + h > bottom) nuevaPagina() }

  // Pill de sección + conteo.
  const seccion = (titulo: string, n: number, color: [number, number, number]) => {
    ensure(46)
    const label = titulo.toUpperCase()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    const tw = doc.getTextWidth(label)
    const padX = 12, ph = 20
    fill(color); doc.roundedRect(margin, y, tw + padX * 2, ph, 5, 5, 'F')
    ink(WHITE); doc.text(label, margin + padX, y + 13.5)
    ink(color); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(`${n} ${n === 1 ? 'equipo' : 'equipos'}`, margin + tw + padX * 2 + 10, y + 13.5)
    ink(INK)
    y += ph + 12
  }

  // Tarjeta de un equipo. kind: 'venta' | 'renta1' (una modalidad) | 'renta3' (día/semana/mes).
  const tarjeta = (i: ProductRow, color: [number, number, number], kind: 'venta' | 'renta1' | 'renta3') => {
    const h = kind === 'renta3' ? 76 : 52
    ensure(h + 10)
    const x = margin, w = inner
    fill(CARD); stroke(LINE); doc.setLineWidth(0.8)
    doc.roundedRect(x, y, w, h, 7, 7, 'FD')
    fill(color); doc.rect(x + 1.2, y + 8, 3.2, h - 16, 'F') // franja de acento

    const lx = x + 16
    const rightW = kind === 'renta3' ? 0 : 152
    const titleMaxW = w - 32 - rightW - 6
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); ink(INK)
    doc.text(clip(i.title || '—', titleMaxW), lx, y + 20)
    const meta = [i.brand, i.category, i.type].filter(Boolean).join('   ·   ') || '—'
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); ink(MUTE)
    doc.text(clip(meta, kind === 'renta3' ? w - 34 : titleMaxW), lx, y + 33)

    if (kind === 'renta3') {
      stroke(LINE); doc.setLineWidth(0.6)
      doc.line(lx, y + 43, x + w - 14, y + 43)
      const gridW = (x + w - 14) - lx, cw = gridW / 3
      const vals = triple(i)
      const us = ['DÍA', 'SEMANA', 'MES']
      vals.forEach((v, idx) => {
        const cx = lx + cw * idx + cw / 2
        ink(MUTE); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
        doc.text(us[idx], cx, y + 55, { align: 'center' })
        ink(v == null ? MUTE : color); doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
        doc.text(v == null ? '—' : money(v), cx, y + 68, { align: 'center' })
      })
    } else {
      const rx = x + w - 16
      const label = kind === 'venta' ? 'PRECIO DE VENTA' : `PRECIO / ${unitLabel.toUpperCase()}`
      ink(MUTE); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text(label, rx, y + 21, { align: 'right' })
      ink(color); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
      doc.text(money(i.price), rx, y + 38, { align: 'right' })
    }
    ink(INK)
    y += h + 10
  }

  marco()
  y = topFor(1)

  if (ventas.length) {
    seccion('Equipos en venta', ventas.length, AZUL)
    ventas.forEach(i => tarjeta(i, AZUL, 'venta'))
    y += 6
  }
  if (rentas.length) {
    seccion('Equipos en renta', rentas.length, NARANJA)
    rentas.forEach(i => tarjeta(i, NARANJA, rentaTodosPrecios ? 'renta3' : 'renta1'))
  }
  if (!ventas.length && !rentas.length) {
    ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
    doc.text('No hay equipos que coincidan con lo seleccionado.', margin, y + 10)
  }

  doc.save('equipos.pdf')
}

type CartItem = { id: number; title: string; price: number; qty: number; duracion?: number }
type ClientInfo = { nombre?: string; empresa?: string; email?: string; telefono?: string; direccion?: string; responsable?: string; obra_telefono?: string }
type Coupon = { code: string; discount: number }

/** En una cotización cada partida es venta o renta por unidad de tiempo. */
type Modalidad = 'venta' | Unit

export async function downloadCotizacionPdf(args: {
  items: Array<CartItem & { unit?: Modalidad }>
  extras?: CartItem[]
  client?: ClientInfo
  coupon?: Coupon
  notas?: string
  vigencia?: number
  iva?: boolean
}) {
  const { items, client = {}, coupon, iva = false } = args

  // Estilo de la casa (mismo lenguaje que el PDF del catálogo y la orden carta).
  const cfg = await cargarConfigPublica()
  const logo = await toDataUrl('/logo-remali.png')

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 46
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const inner = pageW - margin * 2

  const INK: [number, number, number] = [17, 24, 39]
  const MUTE: [number, number, number] = [122, 128, 138]
  const LINE: [number, number, number] = [226, 227, 231]
  const CARD: [number, number, number] = [250, 250, 252]
  const AZUL: [number, number, number] = [43, 95, 173]
  const NARANJA: [number, number, number] = [234, 88, 12]
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2])
  const fillc = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2])
  const money = (n: number) => `$${formatCurrency(Math.round(n * 100) / 100)}`

  // Una cotización es de UN solo tipo (regla del negocio).
  const esRenta = items.some(i => i.unit && i.unit !== 'venta')
  const acento = esRenta ? NARANJA : AZUL
  const UNIT_TXT: Record<string, string> = { venta: 'Compra', dia: 'Renta por día', semana: 'Renta por semana', mes: 'Renta por mes' }

  // ── Espejo del backend: venta IVA incluido (se desglosa); renta + 16% con factura ──
  const periodos = (i: { unit?: string; duracion?: number }) => (i.unit && i.unit !== 'venta') ? (i.duracion || 1) : 1
  const subVenta = items.reduce((s2, i) => s2 + (i.unit === 'venta' ? i.price * i.qty : 0), 0)
  const subRenta = items.reduce((s2, i) => s2 + (i.unit !== 'venta' ? i.price * i.qty * periodos(i) : 0), 0)
  const subtotal = subVenta + subRenta
  const discountAmt = coupon ? subtotal * coupon.discount : 0
  const factor = subtotal > 0 ? Math.max(0, subtotal - discountAmt) / subtotal : 1
  const ventaNeta = subVenta * factor
  const rentaNeta = subRenta * factor
  const ivaRenta = iva && esRenta ? rentaNeta * 0.16 : 0
  const baseSinIVA = ventaNeta / 1.16 + rentaNeta
  const ivaDesglosado = (ventaNeta - ventaNeta / 1.16) + ivaRenta
  const total = ventaNeta + rentaNeta + ivaRenta

  // ── Membrete ──
  let y = margin
  if (logo) { try { doc.addImage(logo, 'PNG', margin, y - 6, 30, 30) } catch { /* sin logo */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); ink(INK)
  doc.text(cfg.negocio_nombre || 'REMALI', margin + 40, y + 9)
  fillc(acento); doc.rect(margin + 40, y + 14, doc.getTextWidth(cfg.negocio_nombre || 'REMALI'), 2.2, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  ink(acento)
  doc.text(esRenta ? 'COTIZACIÓN DE RENTA' : 'COTIZACIÓN DE VENTA', pageW - margin, y + 2, { align: 'right' })
  ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }), pageW - margin, y + 15, { align: 'right' })
  y += 34
  const contacto = [cfg.negocio_direccion, [cfg.negocio_telefono && `Tel. ${cfg.negocio_telefono}`, cfg.negocio_email, cfg.negocio_web].filter(Boolean).join('   ·   ')].filter(Boolean)
  contacto.forEach(l => { doc.text(String(l), margin, y); y += 11 })
  y += 4
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.8)
  doc.line(margin, y, pageW - margin, y); y += 18

  // ── Cliente / obra ──
  const meta: Array<[string, string]> = []
  if (client.nombre) meta.push(['CLIENTE', client.nombre])
  if (client.empresa) meta.push(['EMPRESA / OBRA', client.empresa])
  if (client.telefono) meta.push(['TELÉFONO', client.telefono])
  if (client.responsable) meta.push(['AUTORIZA', client.responsable])
  if (client.direccion) meta.push(['DIRECCIÓN DE ENTREGA', client.direccion])
  meta.forEach(([k, v], i) => {
    const col = i % 2, fila = Math.floor(i / 2)
    const x = margin + col * (inner / 2)
    const yy = y + fila * 26
    ink(MUTE); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text(k, x, yy)
    ink(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(String(v).slice(0, 55), x, yy + 11)
  })
  y += Math.ceil(meta.length / 2) * 26 + 8

  // ── Partidas ──
  ink(acento); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text('CONCEPTO', margin, y); doc.text('IMPORTE', pageW - margin, y, { align: 'right' })
  y += 5
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.line(margin, y, pageW - margin, y); y += 15
  for (const it of items) {
    if (y > pageH - 190) { doc.addPage(); y = margin }
    ink(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
    doc.text(String(it.title).slice(0, 62), margin, y)
    doc.text(money(it.price * it.qty * periodos(it)), pageW - margin, y, { align: 'right' })
    ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    const perTxt = (it.unit && it.unit !== 'venta') ? ` × ${periodos(it)} ${({ dia: 'día', semana: 'semana', mes: 'mes' } as Record<string, string>)[it.unit] || ''}${periodos(it) === 1 ? '' : 's'}` : ''
    doc.text(`${UNIT_TXT[it.unit || 'venta'] || 'Compra'} · ${it.qty} eq.${perTxt} × ${money(it.price)}`, margin, y + 11)
    y += 20
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.5)
    doc.line(margin, y, pageW - margin, y); y += 14
  }

  // ── Desglose (tarjeta) ──
  const filas: Array<[string, string, boolean?]> = []
  if (esRenta) filas.push(['Subtotal renta (sin IVA)', money(rentaNeta)])
  else filas.push(['Subtotal venta (IVA incluido)', money(ventaNeta)])
  if (coupon) filas.push([`Descuento (${(coupon.discount * 100).toFixed(0)}%)`, `− ${money(discountAmt)}`])
  if (iva) { filas.push(['Base (sin IVA)', money(baseSinIVA)]); filas.push(['IVA 16%', money(ivaDesglosado)]) }
  filas.push(['TOTAL', money(total), true])
  const cajaH = filas.length * 16 + 18
  if (y > pageH - cajaH - 120) { doc.addPage(); y = margin }
  const cajaW = 250, cajaX = pageW - margin - cajaW
  fillc(CARD); doc.setDrawColor(LINE[0], LINE[1], LINE[2])
  doc.roundedRect(cajaX, y, cajaW, cajaH, 8, 8, 'FD')
  let fy = y + 20
  for (const [k, v, fuerte] of filas) {
    ink(fuerte ? acento : MUTE); doc.setFont('helvetica', fuerte ? 'bold' : 'normal'); doc.setFontSize(fuerte ? 12 : 9.5)
    doc.text(k, cajaX + 14, fy)
    ink(fuerte ? acento : INK); doc.setFont('helvetica', 'bold')
    doc.text(v, cajaX + cajaW - 14, fy, { align: 'right' })
    fy += fuerte ? 18 : 16
  }
  ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(esRenta
    ? (iva ? 'Renta con factura: IVA 16% incluido en el total.' : 'Precios de renta sin IVA; con factura se suma 16%.')
    : 'El precio de venta ya incluye IVA · factura disponible.', cajaX + cajaW, y + cajaH + 12, { align: 'right' })
  y += cajaH + 30

  // ── Condiciones (letra chica, según el tipo) ──
  const cond = (esRenta ? cfg.cotizacion_condiciones_renta : cfg.cotizacion_condiciones) || ''
  const lineas = cond.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 10)
  if (lineas.length) {
    if (y > pageH - 120) { doc.addPage(); y = margin }
    ink(acento); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text(esRenta ? 'CONDICIONES DE RENTA' : 'CONDICIONES DE VENTA', margin, y); y += 10
    ink(MUTE); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    for (const l of lineas) {
      const wrap = doc.splitTextToSize(`• ${l}`, inner) as string[]
      wrap.forEach(w => { if (y > pageH - 60) { doc.addPage(); y = margin } doc.text(w, margin, y); y += 8.5 })
    }
  }

  // ── Pie ──
  ink(MUTE); doc.setFontSize(7.5)
  doc.text('Cotización informativa: la disponibilidad y el total en firme los confirma REMALI. Solicítala para recibir folio y liga oficial.',
    pageW / 2, pageH - 26, { align: 'center' })

  doc.save('cotizacion.pdf')
}
