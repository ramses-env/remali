// Helpers de WhatsApp. Los NÚMEROS ya no viven aquí: se configuran desde el
// panel (Configuración) y se leen del backend — ver lib/configPublica.ts.

/** Normaliza un teléfono a formato internacional MX para wa.me (52 + 10 dígitos). */
export function normalizarWhatsApp(raw?: string | null): string {
  const d = (raw || '').replace(/\D+/g, '')
  if (!d) return ''
  if (d.length === 10) return '52' + d
  if (d.length === 12 && d.startsWith('52')) return d
  if (d.length === 13 && d.startsWith('521')) return d
  return d
}

/** URL de WhatsApp con mensaje pre-llenado. '' si el número es inválido. */
export function waLink(phone: string | null | undefined, text: string): string {
  const num = normalizarWhatsApp(phone)
  if (!num) return ''
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}
