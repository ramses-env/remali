import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

import api from '../lib/api'
import { useIrTrasEntrar } from '../lib/sesion'
import { useAuth } from '../store/auth'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { SocialAuthButtons } from '@/components/ui/social-auth-buttons'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/* Ojo con este esquema: NO valida formato de correo ni exige largo mínimo de
   contraseña. Entrar no es registrarse — el acceso acepta usuario o correo
   (admin_prueba y tecnico_prueba son usuarios, no correos) y la contraseña ya
   existe: exigir aquí 8 caracteres dejaría fuera a cuentas válidas. Las reglas
   de fuerza van en el registro, que es donde se crea la contraseña. */
const esquema = z.object({
  usuario: z.string().min(1, { message: 'Escribe tu correo.' }),
  password: z.string().min(1, { message: 'Escribe tu contraseña.' }),
  recordar: z.boolean(),
})

type Valores = z.infer<typeof esquema>

export default function Login() {
  const { login, entrarConToken } = useAuth()
  const loc = useLocation()
  const params = new URLSearchParams(loc.search)
  const next = params.get('next') || ''
  const sesionExpirada = params.get('expired') === '1'
  // Estados del candado de correo real: ?correo=verificado|invalido los pone el
  // link del correo; ?confirmar=1&correo=<email> llega desde el registro.
  const correoQ = params.get('correo') || ''
  const correoVerificado = correoQ === 'verificado'
  const linkInvalido = correoQ === 'invalido'

  const [error, setError] = useState<string | undefined>(undefined)
  const [pendiente, setPendiente] = useState<string | null>(
    params.get('confirmar') === '1' && correoQ.includes('@') ? correoQ : null,
  )
  const [reenviado, setReenviado] = useState(false)

  async function reenviarConfirmacion() {
    const escrito = (document.querySelector('input[name="usuario"]') as HTMLInputElement | null)?.value || ''
    const email = (pendiente || '').includes('@') ? (pendiente as string) : escrito
    if (!email.includes('@')) { setError('Escribe tu correo en el campo de arriba y vuelve a tocar Reenviar.'); return }
    try { await api.post('/auth/reenviar-verificacion-publica/', { email: email.trim().toLowerCase() }) } catch { /* respuesta neutra */ }
    setReenviado(true)
  }
  const [verPass, setVerPass] = useState(false)

  // El redirect "si ya hay sesión" lo hace el layout: es la misma regla para
  // login y registro, y ahí se comprueba una sola vez.
  const irTrasEntrar = useIrTrasEntrar(next)

  const form = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: { usuario: '', password: '', recordar: true },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: Valores) {
    setError(undefined)
    try {
      await login(datos.usuario, datos.password, datos.recordar)
      await irTrasEntrar()
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.codigo === 'correo_sin_verificar') {
        setPendiente(datos.usuario.includes('@') ? datos.usuario.trim().toLowerCase() : '')
        return
      }
      if (data?.detail) {
        const d = String(data.detail).toLowerCase()
        if (d.includes('no active account')) setError('Tu cuenta no está activa. Contacta al administrador.')
        else setError(String(data.detail))
      } else if (err?.response?.status === 429) {
        setError('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.')
      } else {
        // "No coinciden" no dice qué no coincide. Y no se precisa cuál de los dos
        // está mal a propósito: decirlo confirmaría a un atacante qué usuarios existen.
        setError('Usuario o contraseña incorrectos. Revísalos e intenta de nuevo.')
      }
    }
  }

  return (
    <>
      {/* La bajada anterior explicaba a dónde va cada rol: eso es cómo funciona el
          sistema por dentro, y quien va a teclear su contraseña ya sabe quién es.
          Esta responde la duda que sí tiene: no hacen falta dos cuentas. */}
      <AuthCabecera
        title="Iniciar sesión"
        description="La misma cuenta sirve para el panel y para la tienda."
      />

      {correoVerificado && !error && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
            Correo confirmado. Ya puedes entrar.
          </div>
        </AuthItem>
      )}

      {linkInvalido && !error && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
            Ese link de confirmación no es válido o ya se usó. Si tu cuenta sigue sin entrar, pide otro abajo.
          </div>
        </AuthItem>
      )}

      {pendiente !== null && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-gold-soft border border-gold/30 text-sm text-ink">
            <p className="font-bold mb-0.5">Confirma tu correo para entrar.</p>
            <p>Te enviamos un link{pendiente ? <> a <b>{pendiente}</b></> : null}. Revisa también Spam o Promociones.</p>
            <button type="button" onClick={reenviarConfirmacion} disabled={reenviado}
              className="mt-2 text-sm font-bold text-gold hover:opacity-80 disabled:opacity-60 transition-opacity">
              {reenviado ? 'Correo reenviado ✓' : 'Reenviar correo'}
            </button>
          </div>
        </AuthItem>
      )}

      {sesionExpirada && !error && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-gold-soft border border-gold/30 text-sm text-ink">
            Tu sesión expiró. Vuelve a entrar.
          </div>
        </AuthItem>
      )}

      {error && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        </AuthItem>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <AuthItem>
            <FormField
              control={form.control}
              name="usuario"
              render={({ field }) => (
                <FormItem className="gap-3">
                  <FormLabel className="text-mute">Correo</FormLabel>
                  <FormControl>
                    {/* Muestra las dos formas válidas en vez de repetir la
                        etiqueta, que no aportaba nada. */}
                    <Input
                      placeholder="tu@correo.com"
                      autoComplete="username"
                      className="h-11 rounded-xl bg-surface-2 border-edge text-ink placeholder:text-mute focus-visible:ring-gold/30"
                      disabled={enviando}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </AuthItem>

          <AuthItem>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="gap-3">
                  <FormLabel className="text-mute">Contraseña</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={verPass ? 'text' : 'password'}
                        autoComplete="current-password"
                        className="h-11 rounded-xl bg-surface-2 border-edge pr-12 text-ink placeholder:text-mute focus-visible:ring-gold/30"
                        disabled={enviando}
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setVerPass(v => !v)}
                        aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-gold transition-colors"
                      >
                        {verPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                  {/* Antes esto era un enlace "¿Olvidaste tu contraseña?" que
                      llevaba a la portada: prometía recuperarla y no hacía nada.
                      No existe flujo de restablecimiento, así que aquí va la ruta
                      real, y donde surge la duda: junto al campo. */}
                  <p className="text-xs text-mute">
                    ¿La olvidaste? Pídele al administrador que te la restablezca.
                  </p>
                </FormItem>
              )}
            />
          </AuthItem>

          <AuthItem>
            <FormField
              control={form.control}
              name="recordar"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={enviando}
                    />
                  </FormControl>
                  {/* "Recordarme" no dice qué recuerda. Esto sí describe lo que
                      hace la casilla: la sesión sobrevive al cerrar el navegador. */}
                  <FormLabel className="font-normal text-mute cursor-pointer">
                    Mantener la sesión abierta
                  </FormLabel>
                </FormItem>
              )}
            />
          </AuthItem>

          <AuthItem>
            <button
              type="submit"
              disabled={enviando}
              className="w-full h-11 rounded-full bg-gold text-gold-on font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {/* El botón dice lo mismo que el título: una acción conserva su
                  nombre durante todo el flujo. "Entrar" era un verbo suelto. */}
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Iniciando sesión…' : 'Iniciar sesión'}
            </button>
          </AuthItem>
        </form>
      </Form>

      <AuthItem>
        <SocialAuthButtons
          onToken={async access => {
            setError(undefined)
            entrarConToken(access, form.getValues('recordar'))
            await irTrasEntrar()
          }}
          onError={setError}
        />
      </AuthItem>

      {/* "Crea una aquí" hace del enlace la palabra "aquí", que fuera de contexto
          no dice nada (un lector de pantalla los anuncia sueltos). */}
      <AuthItem className="text-center text-sm text-mute">
        ¿Todavía no tienes cuenta?{' '}
        <Link to="/registro" className="font-semibold text-gold hover:underline">
          Crear una cuenta
        </Link>
      </AuthItem>
    </>
  )
}
