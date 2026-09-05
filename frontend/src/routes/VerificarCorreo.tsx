import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

import api from '../lib/api'
import { olvidarAcceso } from '../lib/acceso'
import { useAuth } from '../store/auth'
import { useIrTrasEntrar } from '../lib/sesion'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { Input } from '@/components/ui/input'

const LARGO = 6

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
 * Las seis casillas del código.
 *
 * Por dentro es UN solo `<input>` transparente encima de seis cajas dibujadas,
 * no seis inputs. Seis campos separados se ven bien y se comportan mal: pegar
 * el código desde el correo llena solo el primero, el borrado hacia atrás se
 * pelea con el foco, y el autorrelleno del sistema no encuentra dónde escribir.
 * Con uno solo, `autocomplete="one-time-code"` deja que iOS y Android ofrezcan
 * el código desde la notificación, que es la diferencia entre teclear seis
 * dígitos y tocar una vez.
 *
 * Las cajas son presentación pura (`aria-hidden`): quien usa lector de pantalla
 * oye un campo normal con su etiqueta, no seis casillas sueltas.
 */
function CasillasCodigo({ valor, onValor, onCompleto, error, deshabilitado, quieto }: {
  valor: string
  onValor: (v: string) => void
  onCompleto: (v: string) => void
  error: boolean
  deshabilitado: boolean
  quieto: boolean
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [enfocado, setEnfocado] = useState(false)

  // El foco entra solo: quien llega aquí viene a teclear el código y nada más.
  useEffect(() => { ref.current?.focus() }, [])

  const casillas = useMemo(
    () => Array.from({ length: LARGO }, (_, i) => valor[i] ?? ''),
    [valor],
  )
  // La caja "activa" es la que recibirá el próximo dígito. Al estar lleno el
  // código no hay ninguna: si no, la última se quedaría marcada como pendiente.
  const activa = enfocado && valor.length < LARGO ? valor.length : -1

  return (
    <div
      className={`relative ${error ? 'otp-error' : ''}`}
      onClick={() => ref.current?.focus()}
    >
      <div className="flex justify-center gap-2 sm:gap-2.5" aria-hidden="true">
        {casillas.map((d, i) => {
          const esActiva = i === activa
          return (
            <div
              key={i}
              /* La cascada de entrada usa el `vc-rise` de la casa, con un
                 desfase corto por caja. Más de ~60ms y deja de leerse como un
                 gesto para leerse como espera. */
              className={`vc-rise otp-casilla grid h-14 w-11 place-items-center rounded-xl border text-2xl font-black tabular-nums sm:h-16 sm:w-12
                ${error
                  ? 'border-red-500/60 bg-red-500/5 text-red-500'
                  : esActiva
                    ? 'otp-activa border-gold/60 bg-surface-2 text-ink'
                    : d
                      ? 'otp-llena border-edge bg-surface-2 text-ink'
                      : 'border-edge bg-surface-2 text-mute'}
                ${deshabilitado ? 'opacity-60' : ''}`}
              style={{ animationDelay: quieto ? '0ms' : `${i * 45}ms` }}
            >
              {d || (esActiva ? <span className="otp-caret h-6 w-[2px] rounded-full bg-gold" /> : '')}
            </div>
          )
        })}
      </div>

      <input
        ref={ref}
        // `one-time-code` es lo que hace que el teléfono ofrezca el código desde
        // la notificación en vez de obligar a cambiar de app y volver.
        autoComplete="one-time-code"
        inputMode="numeric"
        aria-label="Código de verificación de 6 dígitos"
        maxLength={LARGO}
        disabled={deshabilitado}
        value={valor}
        onFocus={() => setEnfocado(true)}
        onBlur={() => setEnfocado(false)}
        onChange={e => {
          // Se filtra a dígitos aquí y no con `type=number`: ese trae flechitas,
          // acepta "e" y "-", y en móvil no siempre saca el teclado numérico.
          const limpio = e.target.value.replace(/\D/g, '').slice(0, LARGO)
          onValor(limpio)
          // Al completarse se manda solo. Obligar a tocar un botón después de
          // teclear el último dígito es un paso que no decide nada.
          if (limpio.length === LARGO) onCompleto(limpio)
        }}
        /* Invisible pero REAL: ocupa el mismo lugar que las cajas para que el
           teclado del móvil no tape lo que se está escribiendo, y `text-transparent`
           en vez de `opacity-0` para que el cursor nativo no se vea encima. */
        className="absolute inset-0 h-full w-full cursor-pointer rounded-xl border-0 bg-transparent text-center text-transparent caret-transparent outline-none"
      />
    </div>
  )
}

type Estado = 'capturando' | 'listo' | 'inactiva'

/**
 * Confirmación del correo con el CÓDIGO de 6 dígitos.
 *
 * Sustituyó a la liga. Una liga la abren solos los escáneres de correo
 * (SafeLinks, antivirus corporativos) y quemaban el token antes de que el
 * usuario llegara; un código no se puede "hacer clic" por accidente.
 *
 * Tener el código ya prueba que el buzón es suyo, así que aquí no se vuelve a
 * pedir la contraseña: el backend devuelve la sesión junto con el "verificado"
 * y esta pantalla entra sola.
 */
export default function VerificarCorreo() {
  const [params] = useSearchParams()
  const reducir = useReducedMotion()
  const quieto = Boolean(reducir)
  const { entrarConToken } = useAuth()
  const irTrasEntrar = useIrTrasEntrar('')

  const [estado, setEstado] = useState<Estado>('capturando')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState((params.get('correo') || '').trim().toLowerCase())
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [reenviado, setReenviado] = useState(false)

  // Si el navegador traía la sesión de OTRA cuenta, se olvida su acento y nivel
  // para que el panel no abra un instante con los del anterior.
  useEffect(() => { olvidarAcceso() }, [])

  async function verificar(cod: string) {
    const email = correo.trim().toLowerCase()
    if (!email || cod.length !== LARGO || enviando) return
    setEnviando(true)
    setError('')
    try {
      const r = await api.post<{ ok: boolean; access: string; nombre: string }>(
        '/auth/verificar-correo/', { correo: email, codigo: cod }, { fondo: true } as never,
      )
      const access = r.data?.access
      if (!access) { setError('No pudimos abrir tu sesión. Intenta de nuevo.'); return }
      setNombre((r.data?.nombre || '').trim())
      entrarConToken(access)
      setEstado('listo')
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { detail?: string; codigo?: string } } })?.response
      if (res?.data?.codigo === 'inactiva') { setEstado('inactiva'); return }
      // Sin `response` no hubo respuesta: red caída o tiempo agotado. Decir
      // "código incorrecto" mandaría a corregir algo que está bien.
      setError(!res
        ? 'No hubo respuesta del servidor. Revisa tu conexión y reintenta.'
        : res.data?.detail || 'No pudimos confirmar el código.')
      // El campo se vacía SOLO cuando el código estaba mal. Si fue la red, lo
      // que tecleó sigue sirviendo y borrárselo lo obliga a repetirlo.
      if (res && res.data?.codigo !== 'formato') setCodigo('')
    } finally {
      setEnviando(false)
    }
  }

  async function pedirCodigoNuevo() {
    const email = correo.trim().toLowerCase()
    if (!email || reenviando) return
    setReenviando(true)
    setError('')
    setCodigo('')
    // Respuesta neutra a propósito: decir "ese correo no existe" convertiría
    // esta pantalla en un buscador de cuentas.
    try { await api.post('/auth/reenviar-verificacion-publica/', { email }) } catch { /* neutra */ }
    setReenviando(false)
    setReenviado(true)
  }

  // Ya con sesión, la pantalla se retira sola. `irTrasEntrar` carga el perfil
  // antes de navegar, así que cada quien cae en su lugar (tienda o panel).
  useEffect(() => {
    if (estado !== 'listo') return
    const t = setTimeout(() => { void irTrasEntrar() }, quieto ? 600 : ESPERA_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  if (estado === 'listo') {
    return (
      <>
        <AuthItem className="flex justify-center">
          <Palomita quieto={quieto} />
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
              initial={{ width: quieto ? '100%' : '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: quieto ? 0 : ESPERA_MS / 1000, ease: 'linear' }}
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
        title="Escribe tu código"
        description={correo
          ? `Te mandamos 6 dígitos a ${correo}. Vencen en 15 minutos.`
          : 'Te mandamos 6 dígitos por correo. Vencen en 15 minutos.'}
      />

      {/* Sin el correo en la liga no hay a quién verificar: se pide una vez y
          la pantalla sigue igual. Pasa si alguien llega aquí de memoria. */}
      {!correo && (
        <AuthItem>
          <Input
            type="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            value={correo}
            onChange={e => setCorreo(e.target.value)}
          />
        </AuthItem>
      )}

      <AuthItem>
        <CasillasCodigo
          valor={codigo}
          onValor={v => { setCodigo(v); if (error) setError('') }}
          onCompleto={cod => { void verificar(cod) }}
          error={Boolean(error)}
          deshabilitado={enviando}
          quieto={quieto}
        />
      </AuthItem>

      {error && (
        <AuthItem>
          <p role="alert" className="text-center text-[13px] font-semibold text-red-500">{error}</p>
        </AuthItem>
      )}

      {enviando && (
        <AuthItem className="flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-mute" />
        </AuthItem>
      )}

      <AuthItem className="text-center text-sm text-mute">
        {reenviado ? (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            Si esa cuenta existe, ya va en camino un código nuevo.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => { void pedirCodigoNuevo() }}
            disabled={reenviando || !correo.trim()}
            className="transition-[transform,color] duration-150 hover:text-ink hover:underline active:scale-[0.98] disabled:opacity-50"
          >
            {reenviando ? 'Enviando…' : '¿No te llegó? Mándame otro'}
          </button>
        )}
      </AuthItem>

      <AuthItem className="text-center text-sm text-mute">
        <Link to="/login" className="hover:underline">Volver a iniciar sesión</Link>
      </AuthItem>
    </>
  )
}
