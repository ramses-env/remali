/**
 * Despachador de impresión térmica — enruta al método elegido por el usuario:
 *   'usb'       → WebUSB (impresoras clase USB-printer, ej. POS58)
 *   'serial'    → Web Serial (impresoras que exponen puerto serie, CH340/FTDI)
 *   'navegador' → diálogo/PDF del navegador (usa el driver del SO)
 *
 * Así distintos negocios con distintas impresoras eligen el que les funcione.
 */
import type { PrintMethod } from './printSettings'
import { imprimirBytes, serialSupported, vincularImpresora, tieneImpresora, infoImpresora } from './thermalPrinter'
import { imprimirUsb, usbSupported, vincularUsb, tieneUsb, infoUsb } from './thermalPrinterUsb'

export const METODOS: { key: PrintMethod; label: string; desc: string }[] = [
  { key: 'usb', label: 'USB directa', desc: 'WebUSB · POS58 y genéricas (sin driver)' },
  { key: 'serial', label: 'Puerto serie', desc: 'Web Serial · impresoras con COM/CH340' },
  { key: 'navegador', label: 'Navegador / PDF', desc: 'Diálogo del sistema (usa driver)' },
]

export function metodoSoportado(m: PrintMethod): boolean {
  if (m === 'usb') return usbSupported()
  if (m === 'serial') return serialSupported()
  return true
}

export async function imprimirTermico(bytes: Uint8Array, opts: { method: PrintMethod; baud: number }): Promise<void> {
  if (opts.method === 'usb') return imprimirUsb(bytes)
  if (opts.method === 'serial') return imprimirBytes(bytes, opts.baud)
  throw new Error('El método Navegador imprime con el diálogo, no por bytes.')
}

export async function vincularMetodo(m: PrintMethod): Promise<void> {
  if (m === 'usb') return vincularUsb()
  if (m === 'serial') return vincularImpresora()
}

export async function metodoVinculado(m: PrintMethod): Promise<boolean> {
  if (m === 'usb') return tieneUsb()
  if (m === 'serial') return tieneImpresora()
  return false
}

export async function infoMetodo(m: PrintMethod): Promise<{ vendorId: string; productId: string; nombre?: string } | null> {
  if (m === 'usb') return infoUsb()
  if (m === 'serial') return infoImpresora()
  return null
}
