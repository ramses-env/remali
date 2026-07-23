/**
 * Impresión térmica directa por Web Serial — SIN driver del sistema operativo.
 *
 * El navegador (Chrome/Edge/Brave) abre el puerto serie de la impresora USB y le
 * envía los bytes ESC/POS. Funciona en Windows, macOS y Linux por igual.
 * Requisitos: navegador Chromium, contexto seguro (localhost o HTTPS) y un
 * permiso único al elegir el dispositivo (luego se recuerda).
 */

type SerialLike = any

export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

let puerto: SerialLike | null = null

/** Obtiene el puerto: reutiliza uno ya autorizado o muestra el selector una vez. */
async function obtenerPuerto(pedir = false): Promise<SerialLike> {
  const nav = navigator as any
  if (!('serial' in nav)) {
    throw new Error('Este navegador no soporta impresión directa. Usa Chrome, Edge o Brave.')
  }
  if (puerto) return puerto
  const previos = await nav.serial.getPorts()
  if (previos.length && !pedir) { puerto = previos[0]; return puerto }
  // Muestra el selector de dispositivos (requiere gesto del usuario → botón).
  puerto = await nav.serial.requestPort()
  return puerto
}

/** Fuerza el selector para (re)vincular la impresora. */
export async function vincularImpresora(): Promise<void> {
  puerto = null
  await obtenerPuerto(true)
}

/** Identificador USB (VID/PID) de la impresora vinculada — para saber el modelo/lenguaje. */
export async function infoImpresora(): Promise<{ vendorId: string; productId: string } | null> {
  if (!serialSupported()) return null
  try {
    const previos = await (navigator as any).serial.getPorts()
    const p = puerto || previos[0]
    if (!p || typeof p.getInfo !== 'function') return null
    const info = p.getInfo()
    const hex = (n?: number) => (n == null ? '—' : '0x' + n.toString(16).padStart(4, '0'))
    return { vendorId: hex(info.usbVendorId), productId: hex(info.usbProductId) }
  } catch {
    return null
  }
}

/** ¿Ya hay una impresora vinculada (permiso concedido)? */
export async function tieneImpresora(): Promise<boolean> {
  if (!serialSupported()) return false
  try {
    const previos = await (navigator as any).serial.getPorts()
    return previos.length > 0
  } catch {
    return false
  }
}

/** Envía bytes ESC/POS a la impresora.
 * Patrón robusto: abrir → escribir → CERRAR. Cerrar el writer y el puerto es lo
 * que fuerza el vaciado (flush) real al dispositivo; sin eso, muchas impresoras
 * "aceptan" los bytes pero no imprimen nada. */
export async function imprimirBytes(bytes: Uint8Array, baud = 9600): Promise<void> {
  const port = await obtenerPuerto(false)

  // Si quedó abierto de un intento anterior, ciérralo para reabrir limpio.
  try { if (port.readable || port.writable) await port.close() } catch { /* ignore */ }

  await port.open({
    baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none',
    flowControl: 'none', bufferSize: 8192,
  })
  if (!port.writable) throw new Error('El puerto de la impresora no acepta escritura.')

  // Algunos chips USB-serie necesitan un instante tras abrir antes de aceptar datos.
  await new Promise(res => setTimeout(res, 60))

  const writer = port.writable.getWriter()
  let escrito = false
  try {
    await writer.write(bytes)
    escrito = true
  } finally {
    // Cerrar el writer vacía la cola hacia el dispositivo; luego se cierra el puerto.
    try { await writer.close() } catch { try { writer.releaseLock() } catch { /* ignore */ } }
    try { await port.close() } catch { /* ignore */ }
  }
  if (!escrito) throw new Error('No se pudo enviar a la impresora.')
}
