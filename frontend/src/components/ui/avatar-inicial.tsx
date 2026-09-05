import { cn } from '@/lib/utils'

/**
 * Avatar de iniciales.
 *
 * Existe como componente y no suelto en cada pantalla porque antes había dos
 * versiones distintas —círculo relleno con letra negra en la barra, cuadrado
 * con letra dorada en el perfil— y dos avatares para la misma persona hacen
 * dudar de si es la misma cuenta.
 *
 * Es un círculo a propósito: el cuadrado redondeado queda reservado al glifo de
 * la marca. Persona redonda, marca cuadrada; se distinguen de un vistazo sin
 * leer nada.
 */

const TAMANOS = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
} as const

/* Colores de identidad, uno por persona.
 *
 * Son fijos y no cambian con el tema: el avatar lleva su propio fondo, así que
 * se ve igual en claro y en oscuro. Eso ayuda a reconocer a alguien de un
 * vistazo, que es justo para lo que sirve.
 *
 * Ninguno es el dorado de la marca ni los semánticos (verde = disponible,
 * azul = rentado, ámbar = taller). Un avatar verde se leería como un estado, y
 * el dorado compite con los botones que sí hay que pulsar.
 *
 * Todos pasan contraste AA con texto blanco encima; está comprobado.
 */
const PALETA = [
  '#4F46E5', // índigo
  '#0F766E', // verde azulado
  '#BE185D', // frambuesa
  '#1D4ED8', // azul tinta
  '#7E22CE', // púrpura
  '#C2410C', // terracota
  '#0E7490', // cian profundo
  '#A21CAF', // magenta
] as const

/** Mismo usuario, siempre el mismo color. Con pocos colores habrá repeticiones,
 *  que es aceptable: el objetivo es variedad, no identificar por color. */
function colorDe(semilla: string) {
  let h = 0
  for (let i = 0; i < semilla.length; i++) h = (h * 31 + semilla.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}

/** Hasta dos letras: "Juan Pérez" -> JP. Con una sola palabra o un correo, una. */
export function iniciales(...partes: (string | undefined | null)[]) {
  const nombre = partes.map(p => (p || '').trim()).find(Boolean) || ''
  // Vacío, NO una letra de relleno. Antes devolvía 'C' y esa "C" morada era lo
  // que veía el usuario en su propia sesión cuando el backend no contestaba y
  // el perfil nunca llegaba: la inicial de un desconocido. Sin nombre no hay
  // inicial que decir, y quien llama pinta una silueta.
  if (!nombre) return ''
  // Si es un correo, solo cuenta lo de antes de la arroba: el dominio no dice
  // nada de la persona, y partiendo por puntos "juan@gmail.com" acababa dando
  // "JC", con la C de ".com".
  const base = nombre.split('@')[0]
  const palabras = base.split(/[\s._-]+/).filter(Boolean)
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase()
  return palabras[0].slice(0, 1).toUpperCase()
}

/** Silueta neutra: "todavía no sé quién eres".
 *
 * Se pinta cuando no hay ni nombre ni correo, que en la práctica es cuando la
 * comunicación con el backend falló y el perfil nunca llegó. Va en SVG dentro
 * del bundle y no como imagen: si esto aparece es porque la red al backend ya
 * falló, y pedirle un archivo más sería pedirle otra respuesta al que no está
 * respondiendo.
 *
 * Gris a propósito, fuera de la paleta de identidad: los colores de arriba
 * dicen "esta persona", y aquí justamente no sabemos cuál es.
 */
function AvatarAnonimo({
  tamano = 'md',
  className,
}: {
  tamano?: keyof typeof TAMANOS
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full',
        TAMANOS[tamano],
        className,
      )}
    >
      <svg viewBox="0 0 40 40" className="h-full w-full" role="presentation">
        <circle cx="20" cy="20" r="20" fill="#adb2b8" />
        <circle cx="20" cy="15.4" r="6.9" fill="#eceef0" />
        <path
          d="M20 23.8c-6.1 0-11.2 3.9-12.5 9.1A19.9 19.9 0 0 0 20 40c4.9 0 9.4-1.8 12.5-7.1-1.3-5.2-6.4-9.1-12.5-9.1Z"
          fill="#eceef0"
        />
      </svg>
    </span>
  )
}

export function AvatarInicial({
  nombre,
  correo,
  tamano = 'md',
  className,
}: {
  nombre?: string | null
  correo?: string | null
  tamano?: keyof typeof TAMANOS
  className?: string
}) {
  const texto = iniciales(nombre, correo)
  if (!texto) return <AvatarAnonimo tamano={tamano} className={className} />

  // La semilla es el correo antes que el nombre: el nombre se puede editar y el
  // color cambiaría de golpe, y un color que salta deja de servir para reconocer.
  const fondo = colorDe((correo || nombre || '').trim().toLowerCase() || 'cliente')

  return (
    <span
      style={{ backgroundColor: fondo }}
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full',
        'font-black uppercase tracking-tight text-white select-none',
        TAMANOS[tamano],
        className,
      )}
    >
      {/* Las mayúsculas se apoyan en la línea base y quedan ópticamente bajas
          dentro de un círculo. Un pelo hacia arriba y el centro se ve centrado,
          que no es lo mismo que estarlo. */}
      <span aria-hidden="true" className="-translate-y-[0.5px] leading-none">
        {texto}
      </span>
    </span>
  )
}
