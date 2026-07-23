import { GoogleSignInButton } from '@/components/ui/google-signin-button'

/**
 * Acceso con proveedores externos.
 *
 * Google funciona de verdad: el backend verifica su ID token y emite el JWT del
 * proyecto. Apple sigue deshabilitado a propósito — no depende de código sino de
 * cuenta de desarrollador de pago, dominio con HTTPS y verificación; un botón
 * habilitado sería una promesa falsa.
 */

function IconoApple() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.78c.02 2.48 2.17 3.3 2.2 3.31-.02.06-.34 1.18-1.13 2.34-.68 1-1.39 2-2.5 2.02-1.1.02-1.45-.65-2.7-.65-1.26 0-1.65.63-2.68.67-1.08.04-1.9-1.08-2.58-2.08-1.4-2.03-2.47-5.75-1.03-8.26.71-1.25 1.99-2.04 3.38-2.06 1.06-.02 2.06.71 2.7.71.65 0 1.86-.88 3.14-.75.53.02 2.03.22 2.99 1.62-.08.05-1.79 1.04-1.77 3.13M14.3 4.6c.57-.69.95-1.65.85-2.6-.82.03-1.81.54-2.4 1.23-.53.61-.99 1.59-.86 2.53.91.07 1.84-.46 2.41-1.15" />
    </svg>
  )
}

export function SocialAuthButtons({
  onToken,
  onError,
}: {
  onToken: (access: string) => void
  onError: (mensaje: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[11px] uppercase tracking-wider text-mute">o continúa con</span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      <div className="mt-4">
        <GoogleSignInButton onToken={onToken} onError={onError} />
      </div>

      <div className="mt-3">
        <button
          type="button"
          disabled
          title="Disponible próximamente"
          className="inline-flex w-full items-center justify-center gap-2 h-11 rounded-full border border-edge bg-surface-2 text-sm font-semibold text-mute opacity-60 cursor-not-allowed"
        >
          <IconoApple />
          Continuar con Apple
        </button>
        <p className="mt-2 text-center text-[11px] text-mute">Apple: disponible próximamente.</p>
      </div>
    </div>
  )
}
