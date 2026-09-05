/** Dispara la descarga de un Blob en el navegador con el nombre indicado.
 *
 * Se hace por Blob (y no con un <a href> al endpoint) porque la descarga pasa
 * por axios: así lleva el token en el header y respeta los permisos del panel.
 */
export function descargarBlob(data: Blob, nombre: string) {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** El motivo de un error cuando la petición pidió `responseType: 'blob'`.
 *
 * Con blob, axios envuelve TAMBIÉN el cuerpo del error, así que el
 * `err.response.data.detalle` de siempre sale `undefined` y el usuario recibe
 * un mensaje genérico aunque el servidor haya explicado qué pasó. Hay que
 * abrir el Blob y leerlo. Si no es JSON (una página de error, por ejemplo),
 * se usa el respaldo.
 */
export async function motivoDeDescarga(err: any, respaldo: string): Promise<string> {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text())?.detalle || respaldo
    } catch {
      return respaldo
    }
  }
  return data?.detalle || respaldo
}
