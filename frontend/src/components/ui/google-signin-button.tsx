import { useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { useTheme } from '@/store/theme'

/* El client ID es público: viaja en el HTML del botón, así que no es un secreto
   y puede tener valor por defecto. El client secret NO participa en este flujo. */
const CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '796001180849-nqdgu48bai3retv926fliliebfnscl94.apps.googleusercontent.com'

/* Un solo <script> por pestaña aunque se monten sign-in y sign-up: la promesa se
   comparte a nivel de módulo. Cargarlo dos veces reinicia el estado de Google. */
let cargaGIS: Promise<void> | null = null
function cargarGIS(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve()
  if (cargaGIS) return cargaGIS
  cargaGIS = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      cargaGIS = null // permite reintentar si fue un fallo de red pasajero
      reject(new Error('No se pudo cargar Google'))
    }
    document.head.appendChild(s)
  })
  return cargaGIS
}

/**
 * Botón oficial "Entrar con Google".
 *
 * Se usa el botón que dibuja Google (`renderButton`) y no uno propio: además de
 * ser lo que piden sus lineamientos de marca, es el único camino fiable — el One
 * Tap se autosuprime tras varios cierres, así que un botón casero que lo invoque
 * se queda mudo sin avisar.
 *
 * El token que Google entrega aquí NO es la sesión: se manda al backend, que lo
 * verifica y responde con el JWT del proyecto. Este componente nunca decide quién
 * entra.
 */
export function GoogleSignInButton({
  onToken,
  onError,
}: {
  onToken: (access: string) => void
  onError: (mensaje: string) => void
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const [fallo, setFallo] = useState(false)

  /* Los handlers viven en refs porque `initialize` se llama una vez y su callback
     congelaría la versión que existía en ese render. */
  const alToken = useRef(onToken)
  const alError = useRef(onError)
  alToken.current = onToken
  alError.current = onError

  useEffect(() => {
    let vivo = true
    let observador: ResizeObserver | null = null
    cargarGIS()
      .then(() => {
        if (!vivo || !contenedor.current) return
        const google = (window as any).google
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (respuesta: any) => {
            try {
              const r = await api.post('/auth/google/', { credential: respuesta.credential })
              alToken.current(r.data.access)
            } catch (e: any) {
              alError.current(
                e?.response?.data?.detail || 'No se pudo entrar con Google. Intenta de nuevo.',
              )
            }
          },
        })
        const dibujar = () => {
          const caja = contenedor.current
          if (!vivo || !caja) return
          // Google fija el ancho EN LÍNEA (`width:400px; max-width:400px`) y no
          // lo vuelve a mirar. Medido antes de que el layout se asiente, en un
          // teléfono salía 400 dentro de una columna de ~340: el botón se
          // desbordaba de la tarjeta. `clientWidth` en el momento de dibujar, y
          // 400 es solo el techo que admite Google.
          const ancho = Math.min(400, Math.max(200, caja.clientWidth || 320))
          caja.innerHTML = ''
          google.accounts.id.renderButton(caja, {
            theme: theme === 'dark' ? 'filled_black' : 'outline',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            locale: 'es',
            width: ancho,
          })
        }
        dibujar()
        // Girar el teléfono, o abrir el teclado, cambia el ancho disponible; sin
        // esto el botón se queda con el de hace un momento.
        if ('ResizeObserver' in window) {
          observador = new ResizeObserver(() => dibujar())
          observador.observe(contenedor.current)
        }
      })
      .catch(() => vivo && setFallo(true))
    return () => { vivo = false; observador?.disconnect() }
    // Se vuelve a dibujar al cambiar de tema: el botón de Google no hereda CSS,
    // su color se fija al crearlo.
  }, [theme])

  if (fallo) {
    return (
      <p className="text-center text-xs text-mute">
        No se pudo cargar el acceso con Google. Entra con tu usuario y contraseña.
      </p>
    )
  }

  // `data-google` es el gancho del CSS (ver index.css): en oscuro le imponemos
  // el fondo del sistema en vez de confiar en que la hoja de estilos de Google
  // llegue entera.
  return <div ref={contenedor} data-google className="flex justify-center min-h-[44px]" />
}
