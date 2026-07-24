import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

import api from '../lib/api'
import { useIrTrasEntrar } from '../lib/sesion'
import { useAuth } from '../store/auth'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { SocialAuthButtons } from '@/components/ui/social-auth-buttons'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/* Aquí sí se valida fuerte: es donde se crea la contraseña. El backend vuelve a
   validarla con los AUTH_PASSWORD_VALIDATORS del proyecto — esto es solo para
   avisar antes de gastar un viaje al servidor, nunca la única defensa. */
const esquema = z
  .object({
    nombre: z.string().trim().min(2, { message: 'Escribe tu nombre.' }),
    email: z.string().trim().email({ message: 'Escribe un correo válido.' }),
    password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
    confirmar: z.string(),
  })
  .refine(d => d.password === d.confirmar, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmar'],
  })

type Valores = z.infer<typeof esquema>

export default function Registro() {
  const { login, entrarConToken } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next') || ''

  const [error, setError] = useState<string | undefined>(undefined)
  const [verPass, setVerPass] = useState(false)

  // El redirect "si ya hay sesión" lo hace el layout, una sola vez para ambas.
  const irTrasEntrar = useIrTrasEntrar(next)

  const form = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: { nombre: '', email: '', password: '', confirmar: '' },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: Valores) {
    setError(undefined)
    try {
      await api.post('/auth/registro/', {
        nombre: datos.nombre,
        email: datos.email,
        password: datos.password,
      })
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 429) setError('Demasiadas altas desde esta red. Intenta más tarde.')
      else setError(err?.response?.data?.detail || 'No se pudo crear la cuenta. Revisa tus datos.')
      return
    }

    // Cuenta creada: se entra de una vez. Mandar al login a repetir el correo y
    // la contraseña recién escritos sería trabajo de más sin ninguna ganancia.
    try {
      await login(datos.email, datos.password, true)
      await irTrasEntrar()
    } catch {
      // La cuenta sí quedó creada; solo falló entrar. Que lo intente a mano.
      nav('/login?creada=1', { replace: true })
    }
  }

  return (
    <>
      <AuthCabecera
        title="Crear cuenta"
        description="Regístrate para cotizar y dar seguimiento a tus rentas."
      />

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
              name="nombre"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-mute">Nombre</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Tu nombre"
                      autoComplete="name"
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
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-mute">Correo</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
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
                <FormItem className="space-y-3">
                  <FormLabel className="text-mute">Contraseña</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={verPass ? 'text' : 'password'}
                        placeholder="Mínimo 8 caracteres"
                        autoComplete="new-password"
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

          <AuthItem>
            <FormField
              control={form.control}
              name="confirmar"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="text-mute">Confirmar contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type={verPass ? 'text' : 'password'}
                      placeholder="Repite tu contraseña"
                      autoComplete="new-password"
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
            <button
              type="submit"
              disabled={enviando}
              className="w-full h-11 rounded-full bg-gold text-gold-on font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
          </AuthItem>
        </form>
      </Form>

      <AuthItem>
        <SocialAuthButtons
          onToken={async access => {
            setError(undefined)
            entrarConToken(access, true)
            await irTrasEntrar()
          }}
          onError={setError}
        />
      </AuthItem>

      <AuthItem className="text-center text-sm text-mute">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-semibold text-gold hover:underline">
          Inicia sesión
        </Link>
        .
      </AuthItem>
    </>
  )
}
