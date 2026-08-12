import { useEffect, useMemo, useState } from 'react'
import { AvatarInicial } from './avatar-inicial'
import resolveMediaUrl from '@/lib/resolveMediaUrl'
import { cn } from '@/lib/utils'

/**
 * Avatar de usuario con 3 niveles de fallback (nunca pinta imagen rota).
 *
 * Orden:
 *   1. `avatarUrl` (foto personalizada del usuario: Cloudinary, media local…).
 *   2. `fallbackUrl` (avatar POR ROL precomputado en el backend: PNG estático
 *      de `/static/...` o data-URI SVG inline). Sólo se usa si (1) dio error.
 *   3. `AvatarInicial` (colores por semilla del nombre/correo). Sólo si (1) y
 *      (2) fallaron o no se pasaron URLs.
 *
 * Por qué hay 2 URLs de avatar separadas: la foto personalizada puede
 * convertirse en un 404 en cualquier momento (Cloudinary borra el asset, la
 * URL firma expira, storage se pierde). En ese escenario el usuario NO quería
 * ver una "A" morada aleatoria — quería ver su foto de rol. El backend
 * entrega la capa 2 pre-calculada para no duplicar lógica de roles en JS.
 */
export function AvatarUsuario({
  nombre, correo, avatarUrl, fallbackUrl, tamano, className,
}: {
  nombre?: string | null
  correo?: string | null
  avatarUrl?: string | null
  /** Segunda capa (avatar por rol). Se usa si avatarUrl falla. */
  fallbackUrl?: string | null
  tamano?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0) // 0:avatarUrl 1:fallbackUrl 2:inicial
  useEffect(() => { setStage(0) }, [avatarUrl, fallbackUrl])

  const primarySrc = useMemo(() => resolveMediaUrl(avatarUrl) || avatarUrl || '', [avatarUrl])
  const fallbackSrc = useMemo(() => resolveMediaUrl(fallbackUrl) || fallbackUrl || '', [fallbackUrl])

  const sizeClass =
    tamano === 'sm' ? 'h-7 w-7' :
    tamano === 'lg' ? 'h-16 w-16' :
    'h-10 w-10'
  const imgClass = cn('rounded-full object-cover shrink-0 bg-surface-2', sizeClass, className)

  // Defensive: sin fuentes disponibles, pasar directo a AvatarInicial (stage=2)
  // para NUNCA renderizar una <img src=""> vacía que iOS/Safari pinta como el
  // placeholder roto "?". El onError solo se usa para las fuentes válidas.
  if (!primarySrc && !fallbackSrc) {
    return <AvatarInicial nombre={nombre} correo={correo} tamano={tamano} className={className} />
  }

  if (stage === 0 && primarySrc) {
    return (
      <img
        alt=""
        aria-hidden={!nombre}
        src={primarySrc}
        referrerPolicy="no-referrer"
        decoding="async"
        loading="lazy"
        className={imgClass}
        onError={() => setStage(fallbackSrc ? 1 : 2)}
      />
    )
  }
  if (stage === 1 && fallbackSrc) {
    return (
      <img
        alt=""
        aria-hidden={!nombre}
        src={fallbackSrc}
        referrerPolicy="no-referrer"
        decoding="async"
        loading="lazy"
        className={imgClass}
        onError={() => setStage(2)}
      />
    )
  }
  return <AvatarInicial nombre={nombre} correo={correo} tamano={tamano} className={className} />
}

export default AvatarUsuario
