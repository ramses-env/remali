import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from '../store/priceUnit'
import { toNumber } from './utils'
import { cargarConfigPublica } from './configPublica'
import api from './api'

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

type CartItem = { id: number; title: string; price: number; qty: number }
type ClientInfo = { nombre?: string; empresa?: string; email?: string; telefono?: string; direccion?: string; responsable?: string; obra_telefono?: string; obra_email?: string }
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
  const { items, extras = [], client = {}, coupon, notas = '', vigencia, iva = false } = args
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const centerX = pageWidth / 2
  const avail = pageWidth - margin * 2
  const w0 = Math.floor(avail * 0.24)
  const wUnit = Math.floor(avail * 0.14)
  const wTipo = Math.floor(avail * 0.18)
  const wQty = Math.floor(avail * 0.10)
  const w2 = Math.floor(avail * 0.12)
  const wRent = Math.floor(avail * 0.10)
  const w3 = avail - w0 - wUnit - wTipo - wQty - w2 - wRent

  /* Espejo del backend: VENTA ya incluye IVA (solo se desglosa); RENTA va sin
     IVA y suma 16% únicamente si el cliente pidió factura. Los extras siguen
     la regla de renta (sin IVA incluido). Descuento proporcional. */
  const subVenta = items.reduce((s, i) => s + (i.unit === 'venta' ? i.price * i.qty : 0), 0)
  const subRenta = items.reduce((s, i) => s + (i.unit !== 'venta' ? i.price * i.qty : 0), 0)
    + extras.reduce((s, i) => s + i.price * i.qty, 0)
  const subtotal = subVenta + subRenta
  const discountAmt = coupon ? subtotal * coupon.discount : 0
  const factor = subtotal > 0 ? Math.max(0, subtotal - discountAmt) / subtotal : 1
  const ventaNeta = subVenta * factor            // IVA incluido
  const rentaNeta = subRenta * factor            // sin IVA
  const ivaVentaIncluido = ventaNeta - ventaNeta / 1.16
  const ivaRenta = iva ? rentaNeta * 0.16 : 0
  const baseSinIVA = ventaNeta / 1.16 + rentaNeta
  const ivaAmt = ivaVentaIncluido + ivaRenta
  const total = ventaNeta + rentaNeta + ivaRenta

  // Solo tiene sentido anunciar "unidad de precio" si TODO se renta con la misma.
  const units = items.map(i => i.unit).filter(u => u && u !== 'venta') as Unit[]
  const commonUnit = units.length === items.length && units.every(u => u === units[0]) ? units[0] : null
  const drawHeaderFooter = (data: any) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('Cotización', centerX, margin, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Remali • Fecha: ${new Date().toLocaleDateString('es-MX')}`, centerX, margin + 16, { align: 'center' })
    if (commonUnit) {
      doc.text(`Unidad de precio: ${commonUnit}`, centerX, margin + 30, { align: 'center' })
    }
    doc.text(`Página ${data.pageNumber}`, centerX, pageHeight - 18, { align: 'center' })
  }

  autoTable(doc, {
    startY: margin + 48,
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Datos del cliente', '']],
    body: [],
    styles: { fontSize: 10, cellPadding: 4 },
    theme: 'plain',
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY || (margin + 64),
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Campo', 'Valor']],
    body: [
      ['Nombre', (client.nombre || '—')],
      ['Email', (client.email || '—')],
      ['Teléfono', (client.telefono || '—')],
      ...(typeof vigencia === 'number' ? [['Vigencia', `${vigencia} días`]] as Array<[string, string]> : []),
    ],
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: pageWidth - margin * 2 - 140 } },
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY || (margin + 64),
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Datos de la empresa', '']],
    body: [],
    styles: { fontSize: 10, cellPadding: 4 },
    theme: 'plain',
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY || (margin + 64),
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Campo', 'Valor']],
    body: [
      ['Empresa', (client.empresa || '—')],
      ['Dirección', (client.direccion || '—')],
    ],
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: pageWidth - margin * 2 - 140 } },
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY || (margin + 64),
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Datos de la obra', '']],
    body: [],
    styles: { fontSize: 10, cellPadding: 4 },
    theme: 'plain',
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable?.finalY || (margin + 64),
    margin: { left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Campo', 'Valor']],
    body: [
      ['Responsable', (client.responsable || '—')],
      ['Teléfono', (client.obra_telefono || '—')],
      ['Email', (client.obra_email || '—')],
    ],
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: pageWidth - margin * 2 - 140 } },
  })

  let y = (doc as any).lastAutoTable?.finalY || (margin + 100)
  y += 12
  const detalleRows: Array<[string, string, string, string, string, string, string]> = []
  for (const i of items) {
    try {
      const modalidad: Modalidad | undefined = i.unit
      const esVenta = modalidad === 'venta'
      const u: Unit | undefined = esVenta ? undefined : (modalidad as Unit | undefined)
      const r = await api.get(`/equipos/${i.id}/` + (u ? `?unit=${u}` : ''))
      const e = r.data || {}
      const precioDia = toNumber(e?.precio_dia)
      const precioSemana = toNumber(e?.precio_semana)
      const precioMes = toNumber(e?.precio_mes)
      const precioPorUnidadApi = toNumber((e as any)?.precio_por_unidad)
      const unidadEfectivaApi: Unit | null = ((e as any)?.unidad_efectiva || null)
      const displayPrice = esVenta ? (toNumber(e?.precio_venta) ?? i.price) :
        precioPorUnidadApi != null ? precioPorUnidadApi :
        u === 'dia' ? (precioDia ?? precioSemana ?? precioMes ?? i.price) :
        u === 'semana' ? (precioSemana ?? (precioDia ? precioDia * 7 : null) ?? precioMes ?? i.price) :
        u === 'mes' ? (precioMes ?? (precioDia ? precioDia * 30 : null) ?? (precioSemana ? precioSemana * 4 : null) ?? i.price) :
        (precioDia ?? precioSemana ?? precioMes ?? i.price)
      const rentUnit: Unit | null = esVenta ? null :
        unidadEfectivaApi ? unidadEfectivaApi :
        u ? u :
        (precioDia != null) ? 'dia' :
        (precioSemana != null) ? 'semana' :
        (precioMes != null) ? 'mes' :
        null
      const eq = (a?: number | null, b?: number | null) => {
        if (a == null || b == null) return false
        return Math.round((a - b) * 100) === 0
      }
      const dNum = precioDia != null ? Number(precioDia) : null
      const sNum = precioSemana != null ? Number(precioSemana) : null
      const mNum = precioMes != null ? Number(precioMes) : null
      const dispNum = displayPrice != null ? Number(displayPrice) : null
      let rentUnitResolved: Unit | null = rentUnit
      if (dispNum != null && !esVenta) {
        if (eq(dNum, dispNum)) rentUnitResolved = 'dia'
        else if (eq(sNum, dispNum)) rentUnitResolved = 'semana'
        else if (eq(mNum, dispNum)) rentUnitResolved = 'mes'
      }
      const unitLabel =
        esVenta ? 'Venta' :
        rentUnitResolved === 'mes' ? 'Renta / mes' :
        rentUnitResolved === 'semana' ? 'Renta / semana' :
        rentUnitResolved === 'dia' ? 'Renta / día' :
        null
      detalleRows.push([
        String(e?.modelo || i.title || '—'),
        String(e?.marca?.nombre || '—'),
        String(e?.tipo?.nombre || '—'),
        String(i.qty ?? 1),
        String(e?.estado || '—'),
        String(unitLabel || '—'),
        `$${formatCurrency(Number(displayPrice) || 0)}`
      ])
    } catch {
      detalleRows.push([
        String(i.title || '—'),
        '—',
        '—',
        String(i.qty ?? 1),
        '—',
        '—',
        `$${formatCurrency(Number(i.price) || 0)}`
      ])
    }
  }
  if (extras.length) {
    for (const x of extras) {
      detalleRows.push([`${x.title} (extra)`, '—', '—', String(x.qty ?? 1), '—', '—', `$${formatCurrency(x.price)}`])
    }
  }
  autoTable(doc, {
    startY: y,
    margin: { top: margin + 70, bottom: margin + 30, left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Modelo', 'Marca', 'Tipo', 'Cantidad', 'Estado', 'Modalidad', 'Precio']],
    body: detalleRows,
    styles: { fontSize: 10, cellPadding: 6, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: {
      0: { cellWidth: w0 },
      1: { cellWidth: wUnit },
      2: { cellWidth: wTipo },
      3: { cellWidth: wQty, halign: 'center' },
      4: { cellWidth: w2 },
      5: { cellWidth: wRent, halign: 'center' },
      6: { cellWidth: w3, halign: 'right' },
    },
    theme: 'striped',
  })

  y = (doc as any).lastAutoTable?.finalY || y
  y += 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Resumen', margin, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  autoTable(doc, {
    startY: y,
    margin: { top: margin + 70, bottom: margin + 30, left: margin, right: margin },
    didDrawPage: drawHeaderFooter,
    head: [['Detalle', 'Monto']],
    body: [
      ...(subRenta > 0 ? [['Subtotal renta (sin IVA)', `$${formatCurrency(rentaNeta)}`]] as Array<[string, string]> : []),
      ...(subVenta > 0 ? [['Subtotal venta (IVA incluido)', `$${formatCurrency(ventaNeta)}`]] as Array<[string, string]> : []),
      ['Descuento', `$${formatCurrency(discountAmt)}`],
      ...(iva ? [['Base (sin IVA)', `$${formatCurrency(baseSinIVA)}`], ['IVA 16%', `$${formatCurrency(ivaAmt)}`]] as Array<[string, string]> : []),
      ['Total', `$${formatCurrency(total)}`],
    ],
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: { 0: { cellWidth: avail * 0.5 }, 1: { cellWidth: avail * 0.5, halign: 'right' } },
  })

  y = (doc as any).lastAutoTable?.finalY || y
  y += 16
  const notes = (notas || '').trim()
  if (notes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Notas', margin, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(notes, pageWidth - margin * 2)
    doc.text(lines, margin, y)
  }
  const condiciones = [
    'Pago por adelantado',
    'Comprobante de domicilio',
    'Identificación oficial',
    'Depósito en garantía reembolsable (según equipo)',
    'Uso adecuado y responsabilidad por daños o pérdidas',
    'Disponibilidad sujeta a confirmación',
    'Penalizaciones por retraso en devolución según contrato',
    'Facturación: se aplicará IVA 16% cuando se solicite',
    'El equipos se entrega Libre a bordo Acapulco'
  ]
  const condLines = condiciones.flatMap(c => doc.splitTextToSize(`• ${c}`, pageWidth - margin * 2))
  const disclaimers = [
    'Los precios pueden variar sin previo aviso.',
    'Si solicita factura, se enviará al correo proporcionado en la cotización.',
  ]
  const dlines = doc.splitTextToSize(disclaimers.join(' '), pageWidth - margin * 2)
  const lineHeight = 10
  const condHeight = condLines.length * lineHeight
  const signatureHeight = 100
  const spacing = 10

  doc.addPage()
  const last = (doc as any).internal.getNumberOfPages?.() || 1
  doc.setPage(last)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Cotización', centerX, margin, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Remali • Fecha: ${new Date().toLocaleDateString('es-MX')}`, centerX, margin + 16, { align: 'center' })
  doc.text(`Página ${last}`, centerX, pageHeight - 18, { align: 'center' })
  const startY = margin + 60

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(0)
  const sigLineY = startY + 28
  const midX = centerX
  const leftLineStart = margin
  const leftLineEnd = midX - 20
  const rightLineStart = midX + 20
  const rightLineEnd = pageWidth - margin
  const leftMid = (leftLineStart + leftLineEnd) / 2
  const rightMid = (rightLineStart + rightLineEnd) / 2
  doc.line(leftLineStart, sigLineY, leftLineEnd, sigLineY)
  doc.line(rightLineStart, sigLineY, rightLineEnd, sigLineY)
  doc.text('Firma del Cliente', leftMid, sigLineY + 18, { align: 'center' })
  doc.text('Firma de Remali', rightMid, sigLineY + 18, { align: 'center' })

  let condY = startY + signatureHeight + spacing
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text('Condiciones', margin, condY)
  condY += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(condLines, margin, condY)
  condY += condHeight + spacing
  doc.text(dlines, margin, condY)

  doc.save('cotizacion.pdf')
}
