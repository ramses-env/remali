/**
 * Acceso con Google y Apple — maqueta.
 *
 * Los botones están deshabilitados a propósito: entrar con Google o Apple no se
 * resuelve en el front. Hace falta un endpoint que verifique el token de
 * identidad del proveedor y emita el JWT propio, más credenciales que se crean
 * fuera del código (client ID de Google; y en Apple, cuenta de desarrollador de
 * pago, dominio con HTTPS y verificación). Mientras eso no exista, un botón
 * habilitado sería una promesa falsa.
 */

function IconoGoogle() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z" />
    </svg>
  )
}

function IconoApple() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.78c.02 2.48 2.17 3.3 2.2 3.31-.02.06-.34 1.18-1.13 2.34-.68 1-1.39 2-2.5 2.02-1.1.02-1.45-.65-2.7-.65-1.26 0-1.65.63-2.68.67-1.08.04-1.9-1.08-2.58-2.08-1.4-2.03-2.47-5.75-1.03-8.26.71-1.25 1.99-2.04 3.38-2.06 1.06-.02 2.06.71 2.7.71.65 0 1.86-.88 3.14-.75.53.02 2.03.22 2.99 1.62-.08.05-1.79 1.04-1.77 3.13M14.3 4.6c.57-.69.95-1.65.85-2.6-.82.03-1.81.54-2.4 1.23-.53.61-.99 1.59-.86 2.53.91.07 1.84-.46 2.41-1.15" />
    </svg>
  )
}

function BotonSocial({ icono, texto }: { icono: React.ReactNode; texto: string }) {
  return (
    <button
      type="button"
      disabled
      title="Disponible próximamente"
      className="inline-flex flex-1 items-center justify-center gap-2 h-11 rounded-xl border border-edge bg-surface-2 text-sm font-semibold text-mute opacity-60 cursor-not-allowed"
    >
      {icono}
      {texto}
    </button>
  )
}

export function SocialAuthButtons() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[11px] uppercase tracking-wider text-mute">o continúa con</span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      <div className="mt-4 flex gap-3">
        <BotonSocial icono={<IconoGoogle />} texto="Google" />
        <BotonSocial icono={<IconoApple />} texto="Apple" />
      </div>

      <p className="mt-2.5 text-center text-[11px] text-mute">
        Google y Apple: disponibles próximamente.
      </p>
    </div>
  )
}
