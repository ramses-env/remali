import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Check, Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert, User } from 'lucide-react'

import api from '../lib/api'
import { useAuth } from '../store/auth'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/* Solo se exige lo que de verdad hace falta para entregar una máquina: a quién
   le hablamos, de parte de quién viene y dónde se deja. Pedir más aquí es pedirle
   datos a alguien que solo quiere cotizar. */
const esquemaPerfil = z.object({
  first_name: z.string().trim().max(150).optional(),
  telefono: z.string().trim().min(10, { message: 'Escribe los 10 dígitos.' }).max(30),
  empresa: z.string().trim().min(2, { message: 'Escribe el nombre de la empresa.' }),
  obra_direccion: z.string().trim().min(5, { message: 'Escribe dónde se entrega.' }),
  obra_responsable: z.string().trim().min(2, { message: '¿Quién recibe en la obra?' }),
})
type ValoresPerfil = z.infer<typeof esquemaPerfil>

const esquemaPassword = z
  .object({
    password_actual: z.string().optional(),
    password_nueva: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
    confirmar: z.string(),
  })
  .refine(d => d.password_nueva === d.confirmar, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmar'],
  })
type ValoresPassword = z.infer<typeof esquemaPassword>

type Perfil = ValoresPerfil & {
  email?: string
  datos_completos?: boolean
  tiene_password?: boolean
}

const CAMPO = 'h-11 rounded-xl bg-surface-2 border-edge text-ink placeholder:text-mute focus-visible:ring-gold/30'

export default function Perfil() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  // La sección vive en la URL: así se puede volver a "Seguridad" desde el
  // historial o compartir el enlace, en vez de perderse al recargar.
  const seccion = params.get('s') === 'seguridad' ? 'seguridad' : 'perfil'

  const [cargando, setCargando] = useState(true)
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  useEffect(() => {
    if (!token) {
      nav('/login?next=/perfil', { replace: true })
      return
    }
    let vivo = true
    api
      .get<Perfil>('/auth/perfil/')
      .then(r => vivo && setPerfil(r.data))
      .catch(() => {})
      .finally(() => vivo && setCargando(false))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (cargando) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-24 flex justify-center">
        <span className="w-8 h-8 border-2 border-edge border-t-gold rounded-full animate-spin" />
      </div>
    )
  }

  const secciones = [
    { id: 'perfil', etiqueta: 'Perfil', icono: User },
    { id: 'seguridad', etiqueta: 'Seguridad', icono: ShieldCheck },
  ] as const

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-ink">Tu cuenta</h1>
        <p className="text-sm text-mute mt-1.5">{perfil?.email || 'Datos y acceso'}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[220px_1fr] md:items-start">
        {/* En móvil las secciones van en fila: una barra lateral estrecha
            desperdiciaría el ancho justo donde más escasea. */}
        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-edge bg-surface p-2 md:flex-col md:overflow-visible">
          {secciones.map(s => {
            const activa = seccion === s.id
            const Icono = s.icono
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setParams(s.id === 'perfil' ? {} : { s: s.id }, { replace: true })}
                aria-current={activa ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                  activa ? 'bg-surface-2 text-ink' : 'text-mute hover:text-ink'
                }`}
              >
                <Icono className="h-4 w-4" />
                {s.etiqueta}
              </button>
            )
          })}
        </nav>

        <div className="rounded-2xl border border-edge bg-surface p-6 sm:p-8">
          {seccion === 'perfil' ? (
            <PanelPerfil perfil={perfil} onGuardado={setPerfil} />
          ) : (
            <PanelSeguridad perfil={perfil} onGuardado={setPerfil} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Perfil ───────────────────────── */

function PanelPerfil({
  perfil,
  onGuardado,
}: {
  perfil: Perfil | null
  onGuardado: (p: Perfil) => void
}) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [guardado, setGuardado] = useState(false)

  const form = useForm<ValoresPerfil>({
    resolver: zodResolver(esquemaPerfil),
    defaultValues: {
      first_name: perfil?.first_name || '',
      telefono: perfil?.telefono || '',
      empresa: perfil?.empresa || '',
      obra_direccion: perfil?.obra_direccion || '',
      obra_responsable: perfil?.obra_responsable || '',
    },
  })
  const enviando = form.formState.isSubmitting
  const completo = Boolean(perfil?.datos_completos)

  async function onSubmit(datos: ValoresPerfil) {
    setError(undefined)
    setGuardado(false)
    try {
      const r = await api.patch<Perfil>('/auth/perfil/', datos)
      onGuardado(r.data)
      form.reset(datos)
      setGuardado(true)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron guardar los cambios.')
    }
  }

  return (
    <>
      {/* La invitación explica qué gana el cliente. "Completa tu perfil" a secas
          es una tarea; esto es una razón. */}
      {!completo && (
        <div className="mb-7 rounded-2xl border border-gold/30 bg-gold-soft px-5 py-4">
          <p className="text-sm font-semibold text-ink">Termina de completar tu cuenta</p>
          <p className="text-sm text-mute mt-1 leading-relaxed">
            Con tu teléfono, tu empresa y los datos de la obra podemos cotizarte y
            entregarte sin llamarte para preguntar lo mismo cada vez.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <section className="space-y-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">Tus datos</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo form={form} name="first_name" label="Nombre" placeholder="Juan Pérez" autoComplete="name" disabled={enviando} />
              <Campo form={form} name="telefono" label="Teléfono" placeholder="744 123 4567" autoComplete="tel" disabled={enviando} type="tel" />
            </div>
            <Campo form={form} name="empresa" label="Empresa donde trabajas" placeholder="Constructora del Pacífico" autoComplete="organization" disabled={enviando} />
          </section>

          <section className="space-y-5">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute">La obra</h2>
              <p className="mt-2 text-sm text-mute">Adónde llevamos la maquinaria.</p>
            </div>
            <Campo form={form} name="obra_direccion" label="Dirección de la obra" placeholder="Av. Lázaro Cárdenas 120, Los Tulipanes" autoComplete="street-address" disabled={enviando} />
            <Campo form={form} name="obra_responsable" label="Quién recibe en la obra" placeholder="Nombre del encargado" disabled={enviando} />
          </section>

          <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-6">
            <button
              type="submit"
              disabled={enviando}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gold px-7 text-sm font-bold text-gold-on transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {guardado && !form.formState.isDirty && (
              <span className="inline-flex items-center gap-1.5 text-sm text-libre">
                <Check className="h-4 w-4" />
                Guardado
              </span>
            )}
            <Link to="/equipos" className="text-sm text-mute transition-colors hover:text-gold">
              Ver maquinaria
            </Link>
          </div>
        </form>
      </Form>
    </>
  )
}

/* ──────────────────────── Seguridad ──────────────────────── */

function PanelSeguridad({
  perfil,
  onGuardado,
}: {
  perfil: Perfil | null
  onGuardado: (p: Perfil) => void
}) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [listo, setListo] = useState(false)
  const [ver, setVer] = useState(false)

  // Quien entró con Google no tiene contraseña: para él esto es crearla, y
  // pedirle "la actual" lo dejaría sin poder hacerlo nunca.
  const tienePassword = perfil?.tiene_password !== false

  const form = useForm<ValoresPassword>({
    resolver: zodResolver(esquemaPassword),
    defaultValues: { password_actual: '', password_nueva: '', confirmar: '' },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: ValoresPassword) {
    setError(undefined)
    setListo(false)
    try {
      await api.post('/auth/password/', {
        password_actual: datos.password_actual || '',
        password_nueva: datos.password_nueva,
      })
      form.reset({ password_actual: '', password_nueva: '', confirmar: '' })
      setListo(true)
      if (perfil) onGuardado({ ...perfil, tiene_password: true })
    } catch (err: any) {
      if (err?.response?.status === 429) setError('Demasiados intentos. Espera un rato.')
      else setError(err?.response?.data?.detail || 'No se pudo cambiar la contraseña.')
    }
  }

  return (
    <>
      <div className="mb-7 flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">
            {tienePassword ? 'Cambiar contraseña' : 'Crear una contraseña'}
          </h2>
          <p className="mt-1 text-sm text-mute">
            {tienePassword
              ? 'Elige una nueva contraseña para tu cuenta.'
              : 'Entraste con Google, así que tu cuenta todavía no tiene contraseña. Si creas una, podrás entrar de las dos formas.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {listo && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-edge bg-surface-2 px-4 py-3">
          <Check className="h-4 w-4 shrink-0 text-libre" />
          <p className="text-sm text-mute">Listo, tu contraseña quedó guardada.</p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {tienePassword && (
            <CampoPassword form={form} name="password_actual" label="Contraseña actual" placeholder="Tu contraseña de ahora" autoComplete="current-password" ver={ver} setVer={setVer} disabled={enviando} />
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <CampoPassword form={form} name="password_nueva" label="Contraseña nueva" placeholder="Mínimo 8 caracteres" autoComplete="new-password" ver={ver} setVer={setVer} disabled={enviando} />
            <CampoPassword form={form} name="confirmar" label="Confirmar la nueva" placeholder="Repítela" autoComplete="new-password" ver={ver} setVer={setVer} disabled={enviando} />
          </div>

          {/* Aviso honesto: las sesiones de este proyecto son tokens que no se
              invalidan al cambiar la contraseña. Prometer lo contrario daría una
              falsa sensación de seguridad a quien cree que acaba de echar a alguien. */}
          <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface-2 px-4 py-3.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-mute" />
            <p className="text-sm leading-relaxed text-mute">
              Cambiar la contraseña no cierra las sesiones que ya estén abiertas en
              otros dispositivos. Si crees que alguien entró a tu cuenta, avísanos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-6">
            <button
              type="submit"
              disabled={enviando}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gold px-7 text-sm font-bold text-gold-on transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Guardando…' : tienePassword ? 'Cambiar contraseña' : 'Crear contraseña'}
            </button>
          </div>
        </form>
      </Form>
    </>
  )
}

/* ───────────────────────── Campos ───────────────────────── */

function Campo({ form, name, label, ...props }: any) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }: any) => (
        <FormItem className="gap-3">
          <FormLabel className="text-mute">{label}</FormLabel>
          <FormControl>
            <Input className={CAMPO} {...props} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function CampoPassword({ form, name, label, ver, setVer, ...props }: any) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }: any) => (
        <FormItem className="gap-3">
          <FormLabel className="text-mute">{label}</FormLabel>
          <FormControl>
            <div className="relative">
              <Input type={ver ? 'text' : 'password'} className={`${CAMPO} pr-12`} {...props} {...field} />
              <button
                type="button"
                onClick={() => setVer((v: boolean) => !v)}
                aria-label={ver ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mute transition-colors hover:text-gold"
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
