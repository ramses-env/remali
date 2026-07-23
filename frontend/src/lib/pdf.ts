import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from '../store/priceUnit'
import api from './api'

type Unit = 'dia' | 'semana' | 'mes'

type ProductRow = {
  id: number
  title: string
  brand?: string
  category?: string
  type?: string
  condition?: string
  price: number | string | null
}

type EquipoLike = {
  id: number
  modelo: string
  descripcion?: string
  estado?: string
  condicion?: string
  disponible_venta?: boolean
  disponible_renta?: boolean
  categoria?: { id: number; nombre: string }
  tipo?: { id: number; nombre: string }
  marca?: { id: number; nombre: string }
  precio_dia?: number | string | null
  precio_semana?: number | string | null
  precio_mes?: number | string | null
}

function toNumber(v: any): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : null
  if (n === null || Number.isNaN(n)) return null
  return n
}

function availabilityText(e: EquipoLike): string {
  const v = e?.disponible_venta
  const r = e?.disponible_renta
  if (v && r) return 'Venta y renta'
  if (v) return 'Venta'
  if (r) return 'Renta'
  return 'No disponible'
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

export async function downloadEquiposPdf(items: ProductRow[], filters: Record<string, string[]>, unit: Unit) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const centerX = pageWidth / 2
  const avail = pageWidth - margin * 2
  const w0 = Math.floor(avail * 0.30)
  const w1 = Math.floor(avail * 0.14)
  const w2 = Math.floor(avail * 0.12)
  const wType = Math.floor(avail * 0.20)
  const w3 = Math.floor(avail * 0.10)
  const w4 = avail - w0 - w1 - w2 - wType - w3
  const unitLabel = unit === 'mes' ? 'Mes' : unit === 'semana' ? 'Semana' : 'Día'

  autoTable(doc, {
    margin: { top: margin + 70, bottom: margin + 30, left: margin, right: margin },
    didDrawPage: data => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text('Catálogo de Equipos', centerX, margin, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Remali • Fecha: ${new Date().toLocaleDateString('es-MX')}`, centerX, margin + 16, { align: 'center' })
      doc.text(`Unidad de precio: ${unit}`, centerX, margin + 30, { align: 'center' })
      if (data.pageNumber === 1) {
        doc.setFontSize(10)
        doc.text(`Filtros: ${summarizeFilters(filters)}`, margin, margin + 48)
      }
      doc.setFontSize(10)
      doc.text(`Página ${data.pageNumber}`, centerX, pageHeight - 18, { align: 'center' })
    },
    head: [['Modelo', 'Marca', 'Categoría', 'Tipo', 'Estado', 'Precio']],
    body: items.map(i => [
      i.title || '—',
      (i.brand || '—'),
      (i.category || '—'),
      (i.type || '—'),
      (i.condition || '—'),
      `por ${unitLabel} $${formatCurrency(Number(i.price) || 0)}`,
    ]),
    styles: { fontSize: 10, cellPadding: 6, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: {
      0: { cellWidth: w0 },
      1: { cellWidth: w1 },
      2: { cellWidth: w2 },
      3: { cellWidth: wType },
      4: { cellWidth: w3 },
      5: { cellWidth: w4, halign: 'right' },
    },
    theme: 'striped',
  })

  doc.save('equipos.pdf')
}

export async function downloadEquipoPdf(e: EquipoLike, unit: Unit, imageUrl?: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const centerX = pageWidth / 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Ficha de Equipo', centerX, margin, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Remali • Fecha: ${new Date().toLocaleDateString('es-MX')}`, centerX, margin + 16, { align: 'center' })
  doc.text(`Unidad de precio: ${unit}`, centerX, margin + 30, { align: 'center' })

  let y = margin + 48
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(e.modelo || 'Equipo', margin, y)
  y += 18

  const precioDia = toNumber(e.precio_dia)
  const precioSemana = toNumber(e.precio_semana)
  const precioMes = toNumber(e.precio_mes)
  const displayPrice =
    unit === 'dia' ? (precioDia ?? precioSemana ?? precioMes ?? 0) :
    unit === 'semana' ? (precioSemana ?? (precioDia ? precioDia * 7 : null) ?? precioMes ?? 0) :
    (precioMes ?? (precioDia ? precioDia * 30 : null) ?? (precioSemana ? precioSemana * 4 : null) ?? 0)

  const info: Array<[string, string]> = [
    ['Precio', `$${formatCurrency(displayPrice)} por ${unit}`],
    ['Disponibilidad', availabilityText(e)],
    ['Estado', e.estado || '—'],
    ['Categoría', e.categoria?.nombre || '—'],
    ['Tipo', e.tipo?.nombre || '—'],
    ['Marca', e.marca?.nombre || '—'],
    ['Condición', e.condicion || '—'],
  ]

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Campo', 'Valor']],
    body: info,
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [84, 136, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 248, 251] },
    columnStyles: {
      0: { cellWidth: 160 },
      1: { cellWidth: pageWidth - margin * 2 - 160 },
    },
    didDrawPage: data => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Página ${data.pageNumber}`, centerX, pageHeight - 18, { align: 'center' })
    },
    theme: 'striped',
  })

  let imgY = (doc as any).lastAutoTable?.finalY || (margin + 48)
  imgY += 20
  if (imageUrl) {
    const dataUrl = await toDataUrl(imageUrl)
    if (dataUrl) {
      const imgW = pageWidth - margin * 2
      const imgH = 220
      try {
        doc.addImage(dataUrl, 'JPEG', margin, imgY, imgW, imgH, undefined, 'FAST')
        imgY += imgH + 12
      } catch {}
    }
  }

  const desc = (e.descripcion || '').trim()
  if (desc) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('Descripción', margin, imgY)
    imgY += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(desc, pageWidth - margin * 2)
    doc.text(lines, margin, imgY)
  }

  doc.save(`equipo-${e.id}.pdf`)
}

type CartItem = { id: number; title: string; price: number; qty: number }
type ExtraItem = { id: number; title: string; price: number; qty: number }
type ClientInfo = { nombre?: string; empresa?: string; email?: string; telefono?: string; direccion?: string; responsable?: string; obra_telefono?: string; obra_email?: string }
type Coupon = { code: string; discount: number }

/** En una cotización cada partida es venta o renta por unidad de tiempo. */
type Modalidad = 'venta' | Unit

export async function downloadCotizacionPdf(args: {
  items: Array<CartItem & { unit?: Modalidad }>
  extras?: ExtraItem[]
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

  const subtotalCart = items.reduce((s, i) => s + i.price * i.qty, 0)
  const subtotalExtras = extras.reduce((s, i) => s + i.price * i.qty, 0)
  const subtotal = subtotalCart + subtotalExtras
  const discountAmt = coupon ? subtotal * coupon.discount : 0
  const preTaxTotal = Math.max(0, subtotal - discountAmt)
  const ivaAmt = iva ? preTaxTotal * 0.16 : 0
  const total = preTaxTotal + ivaAmt

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
      let displayPrice = esVenta ? (toNumber(e?.precio_venta) ?? i.price) :
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
      ['Subtotal', `$${formatCurrency(subtotal)}`],
      ['Descuento', `$${formatCurrency(discountAmt)}`],
      ...(iva ? [['IVA 16%', `$${formatCurrency(ivaAmt)}`]] as Array<[string, string]> : []),
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
  let startY = margin + 60

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
