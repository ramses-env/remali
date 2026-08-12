import { normalizeBase } from './api'

function backendOrigin() {
  const base = normalizeBase(import.meta.env.VITE_API_URL);
  if (/^https?:\/\//.test(base)) {
    try {
      return new URL(base).origin;
    } catch {
      return "";
    }
  }
  return "";
}

/** Normaliza URLs absolutas de MEDIA en localhost (comportamiento histórico):
 *  si la imagen fue servida a través del mismo backend pero con el host escrito
 *  explícitamente, lo reducimos a /media/... relativa para mantener el mismo
 *  comportamiento de siempre.
 *
 *  NOTA sobre /static/: las avatares por rol (PNG estáticos del paquete) el
 *  backend los entrega como URL ABSOLUTA (http://host:8000/static/...) porque
 *  Vite NO proxyea /static/ (solo /api y /ws). Si quitáramos el host, el
 *  navegador pediría /static al frontend (puerto 5173) → 404. Por eso las
 *  URLs absolutas de /static las dejamos INTACTAS. */
function removerLocalhostHostMediaHistorico(s: string): string {
  const re = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(\/media\/)/
  return s.replace(re, "$2")
}

export default function resolveMediaUrl(src?: string | null) {
  if (!src) return "";
  let s = String(src).trim();
  if (!s) return "";

  if (s.startsWith("blob:") || s.startsWith("data:")) return s;

  s = removerLocalhostHostMediaHistorico(s);

  if (/^https?:\/\//.test(s)) return s;

  const origin = backendOrigin();

  if (s.startsWith("/media/") || s.startsWith("/static/")) {
    return origin ? `${origin}${s}` : s;
  }

  if (s.startsWith("/")) return s;

  return origin ? `${origin}/${s}` : s;
}

