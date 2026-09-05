/* ── El espacio de trabajo del cliente SIN cuenta ──────────────────────────
   Quien no se registra también puede guardar borradores. Su "espacio" es un
   token que el servidor le da al guardar el primero y que vive aquí, en su
   navegador.

   El token viaja en el encabezado `X-Espacio`, NUNCA en la URL de la API: un
   secreto en la barra de direcciones se filtra por el historial, por los logs
   del servidor y por el `Referer` de cualquier recurso externo que cargue la
   página. La liga /mis-borradores/<token> existe solo para RECUPERAR el espacio
   en otro dispositivo, y lo primero que hace es sacar el token de la URL. */

const LLAVE = 'remali_espacio'

export function leerEspacio(): string {
  try {
    return localStorage.getItem(LLAVE) || ''
  } catch {
    return ''
  }
}

export function guardarEspacio(token?: string) {
  if (!token) return
  try {
    localStorage.setItem(LLAVE, token)
  } catch {
    /* modo privado o cuota llena: el espacio dura lo que dure la pestaña */
  }
}

export function olvidarEspacio() {
  try {
    localStorage.removeItem(LLAVE)
  } catch {
    /* nada que hacer */
  }
}

/** Rescate desde la liga /mis-borradores/<token>: guarda el token y lo borra de
 *  la barra de direcciones antes de que la página cargue nada más. */
export function rescatarDeLaUrl(token: string) {
  guardarEspacio(token)
  window.history.replaceState({}, '', '/mis-cotizaciones?tab=borradores')
}
