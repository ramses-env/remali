import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

import api from '../lib/api'
import { useAuth } from '../store/auth'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const esquema = z.object({
  password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
  confirmar: z.string().min(1, { message: 'Repite la contraseña.' }),
}).refine(d => d.password === d.confirmar, { path: ['confirmar'], message: 'Las contraseñas no coinciden.' })
type Valores = z.infer<typeof esquema>

/** Paso 2+3 del restablecimiento: llega desde el enlace del correo
 *  (/restablecer/:uid/:token). Primero pregunta al backend si el enlace sigue
 *  vivo (para no hacer teclear en vano), luego fija la contraseña nueva. */
export default function Restablecer() {
  const { uid = '', token = '' } = useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [estado, setEstado] = useState<'cargando' | 'valido' | 'invalido'>('cargando')
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [verPass, setVerPass] = useState(false)

  useEffect(() => {
    let vivo = true
    api.get<{ valido: boolean; nombre: string }>(`/auth/password/restablecer/${uid}/${token}/`, { fondo: true } as never)
      .then(r => { if (vivo) { setEstado(r.data?.valido ? 'valido' : 'invalido'); setNombre(r.data?.nombre || '') } })
      .catch(() => { if (vivo) setEstado('invalido') })
    return () => { vivo = false }
  }, [uid, token])

  const form = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: { password: '', confirmar: '' },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: Valores) {
    setError(undefined)
    try {
      await api.post('/auth/password/restablecer/', { uid, token, password: datos.password })
      // La contraseña cambió: si quedaba una sesión abierta (p. ej. el admin la
      // olvidó pero seguía logueado en otra pestaña), se cierra para entrar
      // limpio con la nueva y no dejar viva la anterior.
      logout()
      // Al login con un aviso de éxito. `replace` para que "atrás" no vuelva a
      // este formulario con un token ya quemado.
      navigate('/login?restablecida=1', { replace: true })
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'No se pudo restablecer. Intenta de nuevo.'
      setError(msg)
      // Si el backend dice que el enlace ya no vale, cambiamos a la vista de
      // "enlace inválido" (pedir uno nuevo) en vez de dejar el formulario muerto.
      // Ojo: solo por el ENLACE. Un 400 por contraseña débil (los validadores de
      // Django) debe quedarse aquí, con el mensaje, para poder corregirla.
      if (err?.response?.status === 400 && /venci|inv[áa]lid|no es v[áa]lid/i.test(msg)) setEstado('invalido')
    }
  }

  if (estado === 'cargando') {
    return (
      <>
        <AuthCabecera title="Un momento…" description="Validando tu enlace." />
        <AuthItem>
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-mute" /></div>
        </AuthItem>
      </>
    )
  }

  if (estado === 'invalido') {
    return (
      <>
        <AuthCabecera title="Enlace no válido" description="Este enlace ya venció o se usó. Pide uno nuevo y vuelve a intentarlo." />
        <AuthItem className="text-center text-sm">
          <Link to="/recuperar" className="font-semibold text-gold hover:underline">Pedir un enlace nuevo</Link>
        </AuthItem>
        <AuthItem className="text-center text-sm text-mute">
          <Link to="/login" className="hover:underline">Volver a iniciar sesión</Link>
        </AuthItem>
      </>
    )
  }

  return (
    <>
      <AuthCabecera
        title="Crea tu contraseña nueva"
        description={nombre ? `Hola ${nombre}, elige una contraseña para tu cuenta.` : 'Elige una contraseña para tu cuenta.'}
      />

      {error && (
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">{error}</div>
        </AuthItem>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <AuthItem>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-mute">Contraseña nueva</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={verPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Mínimo 8 caracteres" disabled={enviando} {...field} />
                      <button type="button" onClick={() => setVerPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-ink transition-colors" aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
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
                <FormItem>
                  <FormLabel className="text-mute">Repite la contraseña</FormLabel>
                  <FormControl>
                    <Input type={verPass ? 'text' : 'password'} autoComplete="new-password" placeholder="La misma de arriba" disabled={enviando} {...field} />
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
              {enviando ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </AuthItem>
        </form>
      </Form>
    </>
  )
}
