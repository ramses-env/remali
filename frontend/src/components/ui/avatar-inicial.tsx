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

  return (
    <span
      // El aro dorado es un borde de 1.5px, no un relleno degradado: el dorado
      // es el acento de las acciones principales y un avatar macizo compite con
      // el botón que sí quieres que pulsen.
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full',
        'bg-surface-2 ring-[1.5px] ring-gold/45',
        'font-black uppercase tracking-tight text-gold select-none',
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
