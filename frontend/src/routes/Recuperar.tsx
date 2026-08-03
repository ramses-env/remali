import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Loader2 } from 'lucide-react'

import api from '../lib/api'
import { AuthCabecera, AuthItem } from '@/components/ui/auth-split-screen'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const esquema = z.object({
  email: z.string().email({ message: 'Escribe un correo válido.' }),
})
type Valores = z.infer<typeof esquema>

/** Paso 1 del restablecimiento: pedir el correo. El backend responde SIEMPRE lo
 *  mismo (no revela si la cuenta existe), así que aquí mostramos el mismo mensaje
 *  de "revisa tu correo" pase lo que pase. */
export default function Recuperar() {
  const [enviado, setEnviado] = useState(false)
  const [correo, setCorreo] = useState('')

  const form = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: { email: '' },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: Valores) {
    const email = datos.email.trim().toLowerCase()
    // `fondo: true`: sin overlay global; el botón ya muestra su propio spinner.
    try { await api.post('/auth/password/olvide/', { email }, { fondo: true } as never) } catch { /* respuesta neutra */ }
    setCorreo(email)
    setEnviado(true)
  }

  if (enviado) {
    return (
      <>
        <AuthCabecera
          title="Revisa tu correo"
          description="Si hay una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva."
        />
        <AuthItem>
          <div className="px-4 py-3 rounded-xl bg-gold-soft border border-gold/30 text-sm text-ink">
            <p>Enviamos el enlace a <b>{correo}</b>. Vence en unas horas.</p>
            <p className="mt-1 text-mute">¿No lo ves? Revisa Spam o Promociones.</p>
          </div>
        </AuthItem>
        <AuthItem className="text-center text-sm">
          <Link to="/login" className="font-semibold text-gold hover:underline">Volver a iniciar sesión</Link>
        </AuthItem>
      </>
    )
  }

  return (
    <>
      <AuthCabecera
        title="¿Olvidaste tu contraseña?"
        description="Escribe tu correo y te enviamos un enlace para crear una nueva."
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <AuthItem>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-mute">Correo</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="tu@correo.com" disabled={enviando} {...field} />
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
              {enviando ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </AuthItem>
        </form>
      </Form>

      <AuthItem className="text-center text-sm text-mute">
        ¿Ya la recordaste?{' '}
        <Link to="/login" className="font-semibold text-gold hover:underline">Iniciar sesión</Link>
      </AuthItem>
    </>
  )
}
