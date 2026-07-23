/**
 * Dónde vive el token de sesión.
 *
 * "Recordarme" no es decorativo: marcado guarda en localStorage y la sesión
 * sobrevive al cerrar el navegador; sin marcar va a sessionStorage y muere con
 * la pestaña — que es lo que espera quien entra desde una computadora prestada.
 * Se lee de los dos porque el usuario pudo haber elegido cualquiera.
 */
const CLAVE = 'token'

export function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE) ?? sessionStorage.getItem(CLAVE)
  } catch {
    return null
  }
}

export function guardarToken(token: string, recordar: boolean) {
  try {
    // Un solo almacén a la vez: si no se limpia el otro, entrar "sin recordarme"
    // dejaría vivo el token anterior en localStorage y la sesión no moriría.
    localStorage.removeItem(CLAVE)
    sessionStorage.removeItem(CLAVE)
    ;(recordar ? localStorage : sessionStorage).setItem(CLAVE, token)
  } catch { /* modo privado: la sesión dura lo que dure la pestaña */ }
}

export function borrarToken() {
  try {
    localStorage.removeItem(CLAVE)
    sessionStorage.removeItem(CLAVE)
  } catch { /* nada que limpiar */ }
}
