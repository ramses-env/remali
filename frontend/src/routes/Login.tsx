import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

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
  usuario: z.string().min(1, { message: 'Escribe tu usuario o tu correo.' }),
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

  const [error, setError] = useState<string | undefined>(undefined)
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
      if (data?.detail) {
        const d = String(data.detail).toLowerCase()
        if (d.includes('no active account')) setError('Tu cuenta no está activa. Contacta al administrador.')
        else setError(String(data.detail))
      } else if (err?.response?.status === 429) {
        setError('Demasiados intentos. Espera un minuto y vuelve a probar.')
      } else {
        setError('No coinciden. Revisa tu usuario y tu contraseña.')
      }
    }
  }

  return (
    <>
      <AuthCabecera
        title="Iniciar sesión"
        description="Administración y técnicos entran al panel; los clientes, a la tienda."
      />

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
                  <FormLabel className="text-mute">Usuario o correo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="tu usuario o tu correo"
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
                        placeholder="••••••••"
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
                </FormItem>
              )}
            />
          </AuthItem>

          <AuthItem className="flex items-center justify-between">
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
                  <FormLabel className="font-normal text-mute cursor-pointer">Recordarme</FormLabel>
                </FormItem>
              )}
            />
            <Link to="/" className="text-sm font-medium text-mute hover:text-gold transition-colors">
              ¿Olvidaste tu contraseña?
            </Link>
          </AuthItem>

          <AuthItem>
            <button
              type="submit"
              disabled={enviando}
              className="w-full h-11 rounded-full bg-gold text-gold-on font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Verificando…' : 'Entrar'}
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

      <AuthItem className="text-center text-sm text-mute">
        ¿No tienes cuenta?{' '}
        <Link to="/registro" className="font-semibold text-gold hover:underline">
          Crea una aquí
        </Link>
        .
      </AuthItem>
    </>
  )
}
