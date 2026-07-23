function normalizeBase(url?: string) {
  let u = (url || "").trim();
  if (!u) return "/api";
  if (u.startsWith("/")) return u;
  if (u.startsWith(":")) return `http://localhost${u}`;
  if (!/^https?:\/\//.test(u)) return `http://${u}`;
  return u;
}

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

export default function resolveMediaUrl(src?: string | null) {
  if (!src) return "";
  let s = String(src).trim();
  if (!s) return "";

  if (s.startsWith("blob:") || s.startsWith("data:")) return s;

  s = s.replace(/^https?:\/\/localhost(\/media\/)/, "$1");
  s = s.replace(/^https?:\/\/localhost:\d+(\/media\/)/, "$1");
  s = s.replace(/^https?:\/\/127\.0\.0\.1(\/media\/)/, "$1");
  s = s.replace(/^https?:\/\/127\.0\.0\.1:\d+(\/media\/)/, "$1");

  if (/^https?:\/\//.test(s)) return s;

  const origin = backendOrigin();

  if (s.startsWith("/media/") || s.startsWith("/static/")) {
    return origin ? `${origin}${s}` : s;
  }

  if (s.startsWith("/")) return s;

  return origin ? `${origin}/${s}` : s;
}
