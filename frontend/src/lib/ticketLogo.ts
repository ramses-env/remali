/**
 * Logo del ticket — de una imagen cualquiera a puntos negros.
 *
 * Una impresora térmica no tiene tintas ni grises: cada punto del papel sale
 * NEGRO o no sale. Por eso el logo se convierte a 1 bit AQUÍ, en el panel, y se
 * guarda ya convertido: así la vista previa que ve el admin es exactamente el
 * mismo mapa de puntos que la impresora quema en el papel, y todas las cajas
 * imprimen igual sin volver a decidir umbral ni tramado.
 */

/** Puntos de ancho del cabezal según el papel. Es física de la impresora, no un ajuste. */
export function anchoPuntos(mm: number): number {
  return mm >= 80 ? 576 : 384
}

/** Un logo más alto que esto se come el rollo. ~30 mm a 203 dpi. */
const ALTO_MAX = 240

export type OpcionesLogo = {
  anchoPx: number          // ancho final en puntos de impresora
  umbral: number           // 0-255: a partir de qué gris se considera negro
  tramado: boolean         // true = Floyd-Steinberg (fotos), false = corte limpio (logos planos)
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => mal(new Error('No se pudo leer la imagen.'))
    img.src = src
  })
}

export type LogoProcesado = {
  dataUrl: string
  ancho: number     // puntos de impresora
  alto: number
  tinta: number     // 0-1: proporción de puntos que salen negros
}

/**
 * Convierte la imagen a PNG blanco y negro puro, del ancho exacto que imprime
 * la térmica. El blanco queda TRANSPARENTE para que se vea igual sobre el papel
 * de la vista previa que sobre el papel real.
 *
 * Devuelve también cuánta tinta quedó: es el único dato que distingue un logo
 * bien convertido de un borrón negro o de uno que se desvaneció, y la pantalla
 * del admin no siempre lo delata.
 */
export async function procesarLogo(origen: File | string, o: OpcionesLogo): Promise<LogoProcesado> {
  const url = typeof origen === 'string' ? origen : URL.createObjectURL(origen)
  try {
    const img = await cargarImagen(url)
    if (!img.width || !img.height) throw new Error('La imagen está vacía.')

    let w = Math.max(1, Math.round(o.anchoPx))
    let h = Math.max(1, Math.round((img.height / img.width) * w))
    if (h > ALTO_MAX) { h = ALTO_MAX; w = Math.max(1, Math.round((img.width / img.height) * h)) }
    // El cabezal trabaja por bytes: un ancho múltiplo de 8 evita una columna partida.
    w = Math.max(8, Math.round(w / 8) * 8)

    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) throw new Error('El navegador no permite procesar la imagen.')
    // Fondo blanco: un PNG con transparencia se leería como negro y saldría un borrón.
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h)
    cx.imageSmoothingQuality = 'high'
    cx.drawImage(img, 0, 0, w, h)

    const px = cx.getImageData(0, 0, w, h)
    const d = px.data
    // Luminancia percibida (el verde pesa más que el azul para el ojo).
    const gris = new Float32Array(w * h)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gris[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    }

    let negros = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        const viejo = gris[p]
        const negro = viejo < o.umbral
        if (negro) negros++
        const nuevo = negro ? 0 : 255
        if (o.tramado) {
          // Floyd-Steinberg: el error de redondeo se reparte a los vecinos, que
          // es lo que crea la ilusión de grises con puntos de un solo tono.
          const err = viejo - nuevo
          if (x + 1 < w) gris[p + 1] += err * 7 / 16
          if (y + 1 < h) {
            if (x > 0) gris[p + w - 1] += err * 3 / 16
            gris[p + w] += err * 5 / 16
            if (x + 1 < w) gris[p + w + 1] += err * 1 / 16
          }
        }
        const i = p * 4
        d[i] = d[i + 1] = d[i + 2] = 0
        d[i + 3] = negro ? 255 : 0        // el blanco desaparece; solo quedan los puntos
      }
    }
    cx.putImageData(px, 0, 0)
    return { dataUrl: cv.toDataURL('image/png'), ancho: w, alto: h, tinta: negros / (w * h) }
  } finally {
    if (typeof origen !== 'string') URL.revokeObjectURL(url)
  }
}

export type Raster = { w: number; h: number; bytes: Uint8Array }

/**
 * Empaqueta el PNG monocromo como lo pide `GS v 0`: filas de bits, 1 = punto
 * negro, ocho puntos por byte y el bit más significativo a la izquierda.
 */
export async function rasterDeLogo(dataUrl: string, anchoMax: number): Promise<Raster | null> {
  if (!dataUrl) return null
  const img = await cargarImagen(dataUrl)
  let w = img.width, h = img.height
  if (!w || !h) return null
  if (w > anchoMax) { h = Math.round((h / w) * anchoMax); w = anchoMax }
  w = Math.max(8, Math.floor(w / 8) * 8)

  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const cx = cv.getContext('2d', { willReadFrequently: true })
  if (!cx) return null
  cx.drawImage(img, 0, 0, w, h)
  const d = cx.getImageData(0, 0, w, h).data

  const porFila = w / 8
  const bytes = new Uint8Array(porFila * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // Ya viene en blanco y negro: opaco = punto. El umbral 128 solo cubre el
      // borde suavizado que el escalado pudiera haber dejado.
      if (d[i + 3] > 128 && d[i] < 128) bytes[y * porFila + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return { w, h, bytes }
}

/** Caché por sesión: el mismo logo se imprime muchas veces al día. */
const cache = new Map<string, Raster | null>()

export async function rasterCacheado(dataUrl: string, anchoMax: number): Promise<Raster | null> {
  const clave = `${anchoMax}:${dataUrl.length}:${dataUrl.slice(-64)}`
  if (cache.has(clave)) return cache.get(clave) || null
  let r: Raster | null = null
  try { r = await rasterDeLogo(dataUrl, anchoMax) } catch { r = null }
  cache.set(clave, r)
  return r
}

/**
 * Guarda una copia chica del original para poder reajustar el umbral después.
 * Se conserva en PNG: los logos suelen ser planos y el JPEG les mete basura en
 * los bordes justo donde el umbral decide qué es negro.
 */
export async function reducirOriginal(origen: File | string, anchoMax = 576): Promise<string> {
  const url = typeof origen === 'string' ? origen : URL.createObjectURL(origen)
  try {
    const img = await cargarImagen(url)
    const w = Math.min(anchoMax, img.width || anchoMax)
    const h = Math.max(1, Math.round((img.height / img.width) * w))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const cx = cv.getContext('2d')
    if (!cx) return ''
    cx.imageSmoothingQuality = 'high'
    cx.drawImage(img, 0, 0, w, h)
    return cv.toDataURL('image/png')
  } catch {
    return ''
  } finally {
    if (typeof origen !== 'string') URL.revokeObjectURL(url)
  }
}

/** Medidas de un logo ya guardado (para calcular cuánto papel se lleva). */
export async function medirLogo(dataUrl: string): Promise<{ ancho: number; alto: number } | null> {
  if (!dataUrl) return null
  try {
    const img = await cargarImagen(dataUrl)
    return img.width && img.height ? { ancho: img.width, alto: img.height } : null
  } catch {
    return null
  }
}

/** Cuánta tinta gasta un logo ya convertido (0-1). Al recargar el panel no hay
 *  conversión de la cual sacarlo, y sin el dato no se puede avisar que quedó
 *  como mancha o casi en blanco. */
export async function analizarTinta(dataUrl: string): Promise<number | null> {
  if (!dataUrl) return null
  try {
    const img = await cargarImagen(dataUrl)
    const w = img.width, h = img.height
    if (!w || !h) return null
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) return null
    cx.drawImage(img, 0, 0)
    const d = cx.getImageData(0, 0, w, h).data
    let negros = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) negros++
    return negros / (w * h)
  } catch {
    return null
  }
}
