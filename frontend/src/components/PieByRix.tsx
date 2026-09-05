import { VERSION } from '../lib/version'

/**
 * La FIRMA del sistema: quién lo construyó y qué versión está corriendo.
 *
 * Vive en los dos recorridos —el panel de operación y la tienda del cliente—
 * con el mismo aspecto, porque es la misma firma. La versión NO se escribe
 * aquí: sale de `package.json` (ver `lib/version`), así que publicar una versión
 * nueva no obliga a tocar este archivo.
 *
 * El azul de "Rix" es su propio token (`text-byrix`), no el del estado
 * "rentado": ese azul significa un dato de la operación y este es una marca.
 */
export default function PieByRix({
  /** El © lo pone la tienda por su cuenta en la fila de arriba; ahí sobra. */
  copyright = true,
  /** Contra QUÉ se para la barra. En el panel cae sobre el fondo de la página
   *  (`bg-app`) y va como tarjeta; en la tienda cae DENTRO del pie, que ya es
   *  `bg-surface`, y ahí una barra del mismo color sería un borde flotando. */
  fondo = 'surface',
  className = '',
}: { copyright?: boolean; fondo?: 'surface' | 'surface-2'; className?: string }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-[14px] border border-edge px-5 py-3.5 ${
        fondo === 'surface-2' ? 'bg-surface-2' : 'bg-surface'
      } ${className}`}
    >
      <p className="text-[12px] font-medium text-mute tabular-nums">
        {copyright && (
          <>
            © {new Date().getFullYear()}
            <span aria-hidden="true" className="px-2.5 opacity-60">·</span>
          </>
        )}
        v{VERSION}
      </p>
      <p className="text-[12px] text-mute">
        by{' '}
        <span className="font-bold text-ink">
          By<span className="text-byrix">Rix</span>
        </span>
      </p>
    </div>
  )
}
