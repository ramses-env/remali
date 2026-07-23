/**
 * Ajustes de impresión.
 *
 * Lo que depende del EQUIPO (ancho térmico, puerto serial, tamaño de hoja) vive
 * en localStorage: cada caja tiene su impresora. Los DATOS DEL NEGOCIO que van
 * en el encabezado del ticket vienen del servidor (Configuración › Negocio y
 * contacto), para que sean los mismos en todas las computadoras.
 */
import { useEffect, useState } from 'react'
import { cargarConfigPublica, configPublicaEnCache, EVT_CONFIG } from './configPublica'

export type PrintMethod = 'usb' | 'serial' | 'navegador'
export type Negocio = { nombre: string; direccion: string; telefono: string; rfc: string; footer: string }
export type PrintSettings = {
  method: PrintMethod           // cómo se conecta la impresora térmica
  thermalWidth: 58 | 80         // ancho del papel térmico en mm
  baud: number                  // velocidad del puerto serial (solo método 'serial')
  docSize: 'carta' | 'a4'       // tamaño de documentos grandes (órdenes)
  negocio: Negocio              // encabezado/pie del ticket — SOLO LECTURA, viene del servidor
  printSpeed: number            // velocidad de impresión mm/s (para que la animación coincida)
}

/** Lo que sí se guarda por equipo. `negocio` queda fuera a propósito. */
type PrintSettingsLocales = Omit<PrintSettings, 'negocio'>

const KEY = 'print_settings'
const EVT = 'print-settings-change'
export const NEGOCIO_DEFAULT: Negocio = {
  nombre: 'REMALI MAQUINARIA', direccion: '', telefono: '', rfc: '',
  footer: '¡Gracias por su preferencia!',
}
const LOCALES_DEFAULT: PrintSettingsLocales = {
  method: 'usb', thermalWidth: 58, baud: 9600, docSize: 'carta', printSpeed: 70,
}
export const DEFAULTS: PrintSettings = { ...LOCALES_DEFAULT, negocio: NEGOCIO_DEFAULT }

/** Datos del negocio publicados por el panel; con respaldo a los de fábrica. */
export function getNegocio(): Negocio {
  const c = configPublicaEnCache()
  return {
    nombre: c.negocio_nombre || NEGOCIO_DEFAULT.nombre,
    direccion: c.negocio_direccion || '',
    telefono: c.negocio_telefono || '',
    rfc: c.negocio_rfc || '',
    footer: c.negocio_footer || NEGOCIO_DEFAULT.footer,
  }
}

export function getPrintSettings(): PrintSettings {
  let locales = LOCALES_DEFAULT
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const { negocio: _viejo, ...resto } = JSON.parse(raw)   // ignora el negocio local heredado
      locales = { ...LOCALES_DEFAULT, ...resto }
    }
  } catch { /* json corrupto: nos quedamos con los de fábrica */ }
  return { ...locales, negocio: getNegocio() }
}

export function setPrintSettings(patch: Partial<PrintSettings>) {
  const { negocio: _ignorado, ...resto } = patch              // el negocio se edita en Configuración
  const { negocio, ...actuales } = getPrintSettings()
  const locales = { ...actuales, ...resto }
  try { localStorage.setItem(KEY, JSON.stringify(locales)) } catch { /* ignore */ }
  const next: PrintSettings = { ...locales, negocio }
  window.dispatchEvent(new CustomEvent(EVT, { detail: next }))
  return next
}

/** Nº de caracteres por línea según el ancho térmico (fuente estándar). */
export function charsPerLine(widthMm: number): number {
  return widthMm >= 80 ? 48 : 32
}

export function usePrintSettings(): [PrintSettings, (p: Partial<PrintSettings>) => void] {
  const [s, setS] = useState<PrintSettings>(getPrintSettings)
  useEffect(() => {
    const onChange = () => setS(getPrintSettings())
    cargarConfigPublica().then(onChange)   // trae los datos del negocio del servidor
    window.addEventListener(EVT, onChange)
    window.addEventListener(EVT_CONFIG, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVT, onChange)
      window.removeEventListener(EVT_CONFIG, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  return [s, setPrintSettings]
}
