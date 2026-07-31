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
