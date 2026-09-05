/**
 * Comprime/redimensiona una imagen a JPEG antes de subirla.
 *
 * Las fotos del teléfono pesan varios MB y muchas vienen en HEIC (iPhone):
 * subirlas tal cual es lento y a veces el backend ni las procesa, y la subida
 * "se atora". Redibujarlas en un canvas y exportarlas a JPEG las deja chicas
 * (~200-500 KB) y en un formato universal, así la subida es rápida y segura.
 *
 * Si el navegador no puede (formato raro, sin canvas), devuelve el archivo tal
 * cual: mejor subir el original que perder la foto.
 */
export async function comprimirImagen(file: File, maxLado = 1600, calidad = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * escala))
    const h = Math.max(1, Math.round(bitmap.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', calidad))
    if (!blob) return file
    // Si por algo quedó más grande que el original (imagen ya optimizada), deja el original.
    if (blob.size >= file.size && file.type === 'image/jpeg') return file
    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
