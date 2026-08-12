import { useEffect, useState } from 'react'
import api from './api'

export type ConfigPublica = {
  whatsapp_principal: string
  negocio_nombre: string
  negocio_telefono: string
  negocio_direccion: string
  negocio_email: string
  negocio_web: string
  negocio_rfc: string
  negocio_representante: string
  negocio_footer: string
  cotizacion_condiciones: string
  cotizacion_condiciones_renta: string
  datos_bancarios: string
  cotizacion_cierre: string
  descuento_contado_pct: number
  anticipo_minimo_pct: number
  ajuste_requiere_codigo: boolean
}

const VACIA: ConfigPublica = {
  whatsapp_principal: '', negocio_nombre: 'REMALI', negocio_telefono: '',
  negocio_direccion: '', negocio_email: '', negocio_web: '', negocio_rfc: '',
  negocio_representante: '', negocio_footer: '',
  cotizacion_condiciones: '', cotizacion_condiciones_renta: '', datos_bancarios: '', cotizacion_cierre: '',
  descuento_contado_pct: 5, anticipo_minimo_pct: 60, ajuste_requiere_codigo: false,
}

// Cache a nivel módulo: la config pública se pide UNA vez por sesión de página.
let cache: ConfigPublica | null = null
let inflight: Promise<ConfigPublica> | null = null

export function cargarConfigPublica(): Promise<ConfigPublica> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api.get<ConfigPublica>('/config/publica/')
      .then(r => { cache = { ...VACIA, ...(r.data || {}) }; return cache })
      .catch(() => VACIA)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Lo que ya está en memoria, sin esperar a la red (para rutas de impresión síncronas). */
export function configPublicaEnCache(): ConfigPublica {
  return cache || VACIA
}

/** Fuerza recargar la config tras guardarla en el panel. */
export function invalidarConfigPublica() {
  cache = null
  cargarConfigPublica().then(() => window.dispatchEvent(new CustomEvent(EVT_CONFIG)))
}

export const EVT_CONFIG = 'config-publica-change'

/** Config pública del sitio (WhatsApp, datos del negocio). La edita el admin. */
export function useConfigPublica(): ConfigPublica {
  const [cfg, setCfg] = useState<ConfigPublica>(cache || VACIA)
  useEffect(() => {
    let vivo = true
    const refrescar = () => { cargarConfigPublica().then(c => { if (vivo) setCfg(c) }) }
    refrescar()
    window.addEventListener(EVT_CONFIG, refrescar)
    return () => { vivo = false; window.removeEventListener(EVT_CONFIG, refrescar) }
  }, [])
  return cfg
}
