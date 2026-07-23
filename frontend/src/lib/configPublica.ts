import { useEffect, useState } from 'react'
import api from './api'

export type ConfigPublica = {
  whatsapp_principal: string
  negocio_nombre: string
  negocio_telefono: string
  negocio_direccion: string
  negocio_rfc: string
  negocio_footer: string
}

const VACIA: ConfigPublica = {
  whatsapp_principal: '', negocio_nombre: 'REMALI', negocio_telefono: '',
  negocio_direccion: '', negocio_rfc: '', negocio_footer: '',
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
