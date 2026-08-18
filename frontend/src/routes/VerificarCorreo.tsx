import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

import api from '../lib/api'
import { olvidarAcceso } from '../lib/acceso'
import { useAuth } from '../store/auth'
import { useIrTrasEntrar } from '../lib/sesion'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { Input } from '@/components/ui/input'

type Estado = 'verificando' | 'listo' | 'vencido' | 'invalido' | 'inactiva' | 'saturado' | 'sin_red'

/** Cuánto dura la pantalla de bienvenida antes de entrar sola. Suficiente para
 *  leer "tu correo quedó confirmado" y no tanto como para parecer que se atoró. */
const ESPERA_MS = 2000

/** Palomita que se dibuja sola: el círculo se cierra y luego el trazo. Es SVG y
 *  no un ícono estático porque este es el único momento de la pantalla —lo que
 *  el usuario vino a ver— y merece ocurrir, no simplemente estar ahí. */
function Palomita({ quieto }: { quieto: boolean }) {
  const trazo = quieto
    ? { initial: { pathLength: 1 }, animate: { pathLength: 1 } }
    : { initial: { pathLength: 0 }, animate: { pathLength: 1 } }
  return (
    <svg viewBox="0 0 52 52" className="h-16 w-16" aria-hidden="true">
      <motion.circle
        cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="text-gold" strokeLinecap="round"
        {...trazo}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      />
      <motion.path
        d="M15 27 l8 8 l15 -16" fill="none" stroke="currentColor" strokeWidth="3.5"
        className="text-gold" strokeLinecap="round" strokeLinejoin="round"
        {...trazo}
        transition={{ duration: 0.35, delay: quieto ? 0 : 0.4, ease: 'easeOut' }}
      />
    </svg>
  )
}

/**
 * Confirmación del correo desde la liga que llega al buzón (/verificar/:token).
 *
 * La liga ya demuestra que el buzón es suyo, así que aquí no se vuelve a pedir
 * la contraseña: el backend devuelve la sesión junto con el "verificado" y esta
 * pantalla entra sola. El POST lo dispara la página (y no el clic en el correo)
 * para que los escáneres de correo, que abren las ligas por su cuenta, no quemen
 * el token antes que el usuario.
 */
export default function VerificarCorreo() {
  const { token = '' } = useParams()
  const reducir = useReducedMotion()
  const { entrarConToken } = useAuth()
  const irTrasEntrar = useIrTrasEntrar('')

  const [estado, setEstado] = useState<Estado>('verificando')
  const [nombre, setNombre] = useState('')
  // Reenvío de liga (estado vencido/inválido)
  const [correo, setCorreo] = useState('')
  const [reenviando, setReenviando] = useState(false)
  const [reenviado, setReenviado] = useState(false)

  // El token es de un solo uso: en StrictMode React monta dos veces y el segundo
  // intento vería una liga ya quemada ("esta liga ya no sirve") sobre una sesión
  // que en realidad sí se abrió. El ref sobrevive al remonte; una bandera `vivo`
  // de las de "cancelar al desmontar" NO sirve aquí y de hecho rompía la pantalla:
  // el desmonte de StrictMode la apagaba, el segundo montaje no volvía a pedir por
  // el ref, y la respuesta del primero se descartaba → "Un momento…" eterno.
  const pedido = useRef(false)

  useEffect(() => {
    if (pedido.current) return
    pedido.current = true

    // Si el navegador traía la sesión de OTRA cuenta, manda la liga del correo:
    // se olvida el acento y el nivel del anterior para que el panel no abra un
    // instante con los suyos.
    olvidarAcceso()

    api.post<{ ok: boolean; access: string; nombre: string }>(
      '/auth/verificar-correo/', { token }, { fondo: true } as never,
    )
      .then(r => {
        const access = r.data?.access
        if (!access) { setEstado('invalido'); return }
        setNombre((r.data?.nombre || '').trim())
        entrarConToken(access)
        setEstado('listo')
      })
      .catch(err => {
        // El 429 (freno anti-barrido de tokens) va aparte: su liga probablemente
        // sirve, y decirle "ya no sirve" lo mandaría a pedir una nueva en vano.
        if (err?.response?.status === 429) { setEstado('saturado'); return }
        const codigo = err?.response?.data?.codigo
        // Sin `response` no hubo respuesta: red caída, tiempo agotado o CORS. No
        // es una liga mala, y decir que lo es manda al usuario a pedir otra que
        // fallará igual.
        setEstado(
          !err?.response ? 'sin_red'
            : codigo === 'vencido' ? 'vencido'
            : codigo === 'inactiva' ? 'inactiva'
            : 'invalido',
        )
      })

    // Solo al montar: el token viene de la URL y no cambia bajo los pies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ya con sesión, la pantalla se retira sola. `irTrasEntrar` carga el perfil
  // antes de navegar, así que cada quien cae en su lugar (tienda o panel).
  useEffect(() => {
    if (estado !== 'listo') return
    const t = setTimeout(() => { void irTrasEntrar() }, reducir ? 600 : ESPERA_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  async function pedirLigaNueva() {
    const email = correo.trim().toLowerCase()
    if (!email || reenviando) return
    setReenviando(true)
    // Respuesta neutra a propósito: decir "ese correo no existe" convertiría
    // esta pantalla en un buscador de cuentas.
    try { await api.post('/auth/reenviar-verificacion-publica/', { email }) } catch { /* neutra */ }
    setReenviando(false)
    setReenviado(true)
  }

  if (estado === 'verificando') {
    return (
      <>
        <AuthCabecera title="Un momento…" description="Estamos confirmando tu correo." />
        <AuthItem>
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-mute" /></div>
        </AuthItem>
      </>
    )
  }

  if (estado === 'listo') {
    return (
      <>
        <AuthItem className="flex justify-center">
          <Palomita quieto={Boolean(reducir)} />
        </AuthItem>
        <AuthCabecera
          title={nombre ? `Listo, ${nombre}.` : 'Listo.'}
          description="Tu correo quedó confirmado. No hace falta que vuelvas a escribir tus datos."
        />
        <AuthItem className="space-y-2">
          <p className="text-center text-sm text-mute">Entrando a tu cuenta…</p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-gold"
              initial={{ width: reducir ? '100%' : '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: reducir ? 0 : ESPERA_MS / 1000, ease: 'linear' }}
            />
          </div>
        </AuthItem>
        <AuthItem className="text-center text-sm text-mute">
          {/* Salida de emergencia: si el perfil tarda o la red se cae a medio
              redirect, la pantalla no se queda sin ninguna puerta. */}
          <button type="button" onClick={() => { void irTrasEntrar() }} className="hover:text-ink hover:underline">
            Entrar ahora
          </button>
        </AuthItem>
      </>
    )
  }

  if (estado === 'saturado' || estado === 'sin_red') {
    return (
      <>
        <AuthCabecera
          title={estado === 'saturado' ? 'Demasiados intentos' : 'No pudimos conectar'}
          description={
            estado === 'saturado'
              ? 'Espera un minuto y vuelve a abrir la liga de tu correo. Tu liga sigue siendo válida.'
              : 'No hubo respuesta del servidor. Revisa tu conexión y reintenta: tu liga sigue siendo válida.'
          }
        />
        <AuthItem>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 w-full rounded-full bg-gold text-sm font-bold text-gold-on transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
          >
            Reintentar
          </button>
        </AuthItem>
        <AuthItem className="text-center text-sm text-mute">
          <Link to="/login" className="hover:underline">Volver a iniciar sesión</Link>
        </AuthItem>
      </>
    )
  }

  if (estado === 'inactiva') {
    return (
      <>
        <AuthCabecera
          title="Tu correo quedó confirmado"
          description="Pero esta cuenta está desactivada, así que no podemos abrirte sesión. Contacta al administrador."
        />
        <AuthItem className="text-center text-sm text-mute">
          <Link to="/login" className="hover:underline">Volver a iniciar sesión</Link>
        </AuthItem>
      </>
    )
  }

  return (
    <>
      <AuthCabecera
        title={estado === 'vencido' ? 'Esta liga venció' : 'Esta liga ya no sirve'}
        description={
          estado === 'vencido'
            ? 'Las ligas de confirmación duran 48 horas porque dejan la sesión abierta. Te mandamos una nueva.'
            : 'Puede que ya la hayas usado. Escribe tu correo y te mandamos una nueva.'
        }
      />

      {reenviado ? (
        <AuthItem>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            Si esa cuenta existe, ya va en camino una liga nueva. Revisa tu correo.
          </div>
        </AuthItem>
      ) : (
        <>
          <AuthItem>
            <Input
              type="email"
              autoComplete="email"
              placeholder="tu@correo.com"
              value={correo}
              disabled={reenviando}
              onChange={e => setCorreo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void pedirLigaNueva() }}
            />
          </AuthItem>
          <AuthItem>
            <button
              type="button"
              onClick={() => { void pedirLigaNueva() }}
              disabled={reenviando || !correo.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gold text-sm font-bold text-gold-on transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reenviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {reenviando ? 'Enviando…' : 'Enviarme una liga nueva'}
            </button>
          </AuthItem>
        </>
      )}

      <AuthItem className="text-center text-sm text-mute">
        <Link to="/login" className="hover:underline">Volver a iniciar sesión</Link>
      </AuthItem>
    </>
  )
}
