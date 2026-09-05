import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Une clases de Tailwind resolviendo las que se contradicen.
 *
 * Antes solo concatenaba. El problema: los componentes de shadcn traen clases
 * propias y encima reciben `className`, así que `h-10` + `h-8` acababan las dos
 * en el DOM y ganaba la que estuviera después en el CSS, no la que pidió quien
 * usa el componente. `twMerge` deja solo la última de cada conflicto.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "DEMOLICIÓN" → "Demolición", "DEMOLEDOR 11 KG" → "Demoledor 11 Kg".
 *  Para mostrar en Título nombres que en la data vienen en MAYÚSCULAS (categorías,
 *  modelos). Deja los conectores en minúscula (de, del, la…) para que se lea natural. */
export function tituloCaso(texto: string | null | undefined): string {
  const conectores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'a', 'en', 'con', 'el'])
  return (texto || '').trim().toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && conectores.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Teléfono: SOLO dígitos y máximo 10 (los de México son de 10). Úsalo en el
 *  onChange de todo input de teléfono para que no admita letras ni de más. */
export function soloTelefono(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '').slice(0, 10)
}

/** true si el teléfono ya tiene los 10 dígitos exactos. */
export function telefonoValido(v: string | null | undefined): boolean {
  return soloTelefono(v).length === 10
}

/** Email SIEMPRE en minúsculas y sin espacios (no existen correos con espacios).
 *  Úsalo en el onChange de todo input de correo: nunca se guarda en MAYÚSCULAS. */
export function normalizarEmail(v: string | null | undefined): string {
  return (v || '').replace(/\s+/g, '').toLowerCase()
}

/** '1200', 1200 o null → número o null. La API manda los decimales como string. */
export function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : null
  if (n === null || Number.isNaN(n)) return null
  return n
}

/** Moneda con SIEMPRE dos decimales — mismo formato en pantalla, carta y PDF.
 *  (Sin maximumFractionDigits un total con 3+ decimales imprimía distinto.) */
export function formatMoney(n: number | string | null | undefined): string {
  const v = toNumber(n) ?? 0
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Completa una liga pública con el origen desde el que se está viendo la app.

    El backend manda estas ligas RELATIVAS a propósito (`/api/cotizaciones/…`):
    detrás del proxy de Vite, `build_absolute_uri` resuelve al host interno y
    escupe `http://localhost:8000/…`, que no abre desde ningún otro lado —ni
    desde el túnel de pruebas, ni desde el celular del cliente—. Como <a href>
    la ruta relativa funciona sola; el problema es COPIARLA: un
    `/api/…/pdf/` pegado en WhatsApp no es un link, es texto.

    El origen correcto es siempre el de la app: es el mismo host que sirve /api. */
export function ligaAbsoluta(url: string): string {
  try { return new URL(url, window.location.origin).href } catch { return url }
}


/**
 * Cuándo llegó un aviso: qué tan reciente es Y a qué hora exacta.
 *
 * "hace 3 h" contesta si algo es nuevo, pero no sirve para lo que la gente
 * hace de verdad con una notificación: cotejarla contra una llamada, una
 * entrega o un turno. "¿A qué hora entró ese abono?" no se responde con un
 * relativo, y menos con "hace 3 d", que era todo lo que daba la campana del
 * panel. Van los dos: el relativo para ordenar de un vistazo, la hora para
 * poder decirla por teléfono.
 *
 * Vive aquí porque la campana del cliente y la del panel tenían cada una su
 * propia copia del cálculo, con reglas distintas —una decía "ahora" y la otra
 * "hace un momento", una llegaba a días y la otra a semanas—: el mismo aviso
 * se fechaba distinto según quién lo mirara.
 */
export function cuandoLlego(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  // 12 horas con a.m./p.m., que es como se lee la hora aquí y como ya la
  // pintaba el resto de la aplicación.
  const hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })

  const seg = Math.floor((Date.now() - d.getTime()) / 1000)
  // Un reloj adelantado en el navegador daba "hace -2 min"; por delante no hay
  // nada que medir, así que se enseña la hora sola.
  if (seg < 0) return hora

  let relativo: string
  const min = Math.floor(seg / 60)
  const h = Math.floor(min / 60)
  const dias = Math.floor(h / 24)
  if (min < 1) relativo = 'ahora'
  else if (min < 60) relativo = `hace ${min} min`
  else if (h < 24) relativo = `hace ${h} h`
  else if (dias === 1) relativo = 'ayer'
  else if (dias < 7) relativo = `hace ${dias} días`
  else relativo = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })

  return `${relativo} · ${hora}`
}
