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
  if (!nombre) return 'C'
  // Si es un correo, solo cuenta lo de antes de la arroba: el dominio no dice
  // nada de la persona, y partiendo por puntos "juan@gmail.com" acababa dando
  // "JC", con la C de ".com".
  const base = nombre.split('@')[0]
  const palabras = base.split(/[\s._-]+/).filter(Boolean)
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase()
  return palabras[0].slice(0, 1).toUpperCase()
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
