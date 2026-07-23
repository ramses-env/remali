/**
 * Impresión térmica por WebUSB — para impresoras USB de "clase impresora"
 * (POS58 y la mayoría de las genéricas de 58/80 mm). SIN driver del SO.
 *
 * Web Serial solo ve puertos serie; muchas térmicas (como la POS58) son clase
 * USB-printer y NO aparecen como serie → se les habla por WebUSB (transferencia
 * bulk directa). Requisitos: Chrome/Edge, contexto seguro (localhost o HTTPS),
 * permiso único al elegir el dispositivo.
 *
 * Nota Windows: si el driver del fabricante (POS58.EXE) está instalado, Windows
 * "reserva" la impresora y WebUSB no la puede tomar → en ese caso conviene el
 * método "Navegador/PDF" o liberar el driver (WinUSB/Zadig).
 */

// Filtros amplios para que aparezcan impresoras de distintas marcas.
const FILTROS_USB = [
  { classCode: 7 },          // clase impresora USB (cubre la mayoría, incl. POS58)
  { vendorId: 0x0416 },      // Winbond (POS58 / genéricas)
  { vendorId: 0x0fe6 },      // ICS Advent / Kingtype (POS-5890)
  { vendorId: 0x28e9 },      // GigaDevice / GD32
  { vendorId: 0x0483 },      // STMicroelectronics
  { vendorId: 0x04b8 },      // Epson
  { vendorId: 0x0519 },      // Star Micronics
  { vendorId: 0x1504 },      // Bixolon
  { vendorId: 0x1a86 },      // QinHeng (CH340 en algunas)
  { vendorId: 0x6868 },      // varias térmicas chinas
  { vendorId: 0x0dd4 },      // Custom / Citizen
]

let dispositivo: any = null

export function usbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

async function obtenerDispositivo(pedir = false): Promise<any> {
  const nav = navigator as any
  if (!('usb' in nav)) throw new Error('Este navegador no soporta WebUSB. Usa Chrome, Edge o Brave.')
  if (dispositivo) return dispositivo
  const previos = await nav.usb.getDevices()
  if (previos.length && !pedir) { dispositivo = previos[0]; return dispositivo }
  dispositivo = await nav.usb.requestDevice({ filters: FILTROS_USB })
  return dispositivo
}

/** Fuerza el selector para (re)vincular la impresora USB. */
export async function vincularUsb(): Promise<void> {
  dispositivo = null
  await obtenerDispositivo(true)
}

export async function tieneUsb(): Promise<boolean> {
  if (!usbSupported()) return false
  try { return (await (navigator as any).usb.getDevices()).length > 0 } catch { return false }
}

export async function infoUsb(): Promise<{ vendorId: string; productId: string; nombre?: string } | null> {
  if (!usbSupported()) return null
  try {
    const previos = await (navigator as any).usb.getDevices()
    const d = dispositivo || previos[0]
    if (!d) return null
    const hex = (n?: number) => (n == null ? '—' : '0x' + n.toString(16).padStart(4, '0'))
    return { vendorId: hex(d.vendorId), productId: hex(d.productId), nombre: d.productName || d.manufacturerName }
  } catch {
    return null
  }
}

/** Busca la interfaz con un endpoint bulk de SALIDA (el canal de impresión). */
function buscarSalida(device: any): { iface: number; endpoint: number } | null {
  const cfg = device.configuration
  if (!cfg) return null
  for (const iface of cfg.interfaces) {
    const alts = [iface.alternate, ...(iface.alternates || [])].filter(Boolean)
    for (const alt of alts) {
      const ep = (alt.endpoints || []).find((e: any) => e.direction === 'out' && e.type === 'bulk')
      if (ep) return { iface: iface.interfaceNumber, endpoint: ep.endpointNumber }
    }
  }
  return null
}

/** Envía bytes ESC/POS a la impresora USB por transferencia bulk. */
export async function imprimirUsb(bytes: Uint8Array): Promise<void> {
  const d = await obtenerDispositivo(false)
  await d.open()
  if (!d.configuration) await d.selectConfiguration(1)

  const salida = buscarSalida(d)
  if (!salida) throw new Error('No se encontró el canal de impresión USB en el dispositivo.')

  try {
    await d.claimInterface(salida.iface)
  } catch {
    throw new Error('No se pudo tomar la impresora (¿la está usando el driver del sistema?). Prueba el método "Navegador/PDF" o libera el driver.')
  }
  try {
    await d.transferOut(salida.endpoint, bytes)
  } finally {
    try { await d.releaseInterface(salida.iface) } catch { /* ignore */ }
  }
}
