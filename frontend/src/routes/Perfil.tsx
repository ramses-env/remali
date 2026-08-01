import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { BadgePercent, CalendarClock, Check, Copy, Eye, EyeOff, FileText, Loader2, Lock, Mail, ReceiptText, ShieldCheck, ShoppingBag, TriangleAlert, User } from 'lucide-react'

import api from '../lib/api'
import Migas from '../components/Migas'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { AvatarInicial } from '@/components/ui/avatar-inicial'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/* Solo se exige lo que de verdad hace falta para entregar una máquina: a quién
   le hablamos, de parte de quién viene y dónde se deja. Pedir más aquí es pedirle
   datos a alguien que solo quiere cotizar. */
const esquemaPerfil = z.object({
  first_name: z.string().trim().max(150).optional(),
  telefono: z
    .string()
    .trim()
    .max(30)
    .refine(v => v.replace(/\D/g, '').length === 10, { message: 'Escribe los 10 dígitos.' }),
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

/* Todo opcional: facturar es una decisión del cliente, no un requisito. Pero lo
   que sí escriba debe estar bien — un RFC chueco truena hasta en el timbrado. */
const esquemaFiscal = z.object({
  fiscal_razon_social: z.string().trim().max(200).optional(),
  fiscal_rfc: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v), { message: 'Revisa el RFC (12 o 13 caracteres).' }),
  fiscal_regimen: z.string().optional(),
  fiscal_cp: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || /^\d{5}$/.test(v), { message: 'Son 5 dígitos.' }),
  fiscal_uso_cfdi: z.string().optional(),
  fiscal_email: z
    .string()
    .trim()
    .optional()
    .refine(v => !v || /.+@.+\..+/.test(v), { message: 'Revisa el correo.' }),
})
type ValoresFiscal = z.infer<typeof esquemaFiscal>

type Perfil = ValoresPerfil & {
  email?: string
  username?: string
  datos_completos?: boolean
  tiene_password?: boolean
  puede?: { rol?: string }
  email_verificado?: boolean
  perfil_verificado?: boolean
  cupon?: { codigo: string; descuento: number } | null
} & Partial<ValoresFiscal>

const CAMPO = 'h-11 rounded-xl bg-surface-2 border-edge text-ink placeholder:text-mute focus-visible:ring-gold/30'

export default function Perfil() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  // La sección vive en la URL: así se puede volver a "Seguridad" desde el
  // historial o compartir el enlace, en vez de perderse al recargar.
  const s = params.get('s')
  const seccion = s === 'seguridad' || s === 'facturacion' ? s : 'perfil'

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
    // pt-28: la barra de la tienda es fija y mide 81px. Sin este respiro se
    // monta encima del contenido, que es lo que pasaba en esta pantalla.
    return (
      <div className="mx-auto flex max-w-5xl justify-center px-6 pt-28 pb-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-gold" />
      </div>
    )
  }

  const secciones = [
    { id: 'perfil', etiqueta: 'Perfil', icono: User },
    { id: 'facturacion', etiqueta: 'Facturación', icono: ReceiptText },
    { id: 'seguridad', etiqueta: 'Seguridad', icono: ShieldCheck },
  ] as const

  return (
    /* pt-28 (112px) despeja los 81px de la barra fija y deja aire. Cada página de
       la tienda repite este cálculo con un número distinto; convendría subirlo al
       layout algún día, pero eso toca cuatro pantallas. */
    <div className="mx-auto max-w-5xl px-6 pt-28 pb-16">
      {/* Cabecera de identidad: quién eres, con qué correo y qué eres aquí. Antes
          solo había un título; nadie sabía con qué cuenta estaba mirando. */}
      <header className="mb-9 flex flex-wrap items-center gap-5">
        <AvatarInicial nombre={perfil?.first_name} correo={perfil?.email} tamano="lg" />

        <div className="min-w-0">
          <div className="mb-3"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mi perfil' }]} /></div>
          <h1 className="truncate text-2xl font-black tracking-tight text-ink sm:text-3xl">
            {perfil?.first_name?.trim() || 'Tu cuenta'}
          </h1>
          <p className="mt-1 truncate text-sm text-mute">{perfil?.email || perfil?.username}</p>
          {/* Solo se marca cuando está COMPLETO, como refuerzo positivo. El
              "faltan datos" ya no vive aquí: lo dice el aviso de abajo, y
              repetirlo como badge era decir dos veces lo mismo. Tampoco va el rol
              ("Sin acceso" asusta a un cliente y no le sirve en su propia cuenta). */}
          {perfil?.datos_completos && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-libre/10 px-2.5 py-1 text-[11px] font-semibold text-libre">
              <Check className="h-3 w-3" />
              Datos completos
            </span>
          )}
        </div>
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
          {/* Ruta aparte (no una sección de esta página): sus solicitudes. */}
          <Link
            to="/mis-cotizaciones"
            className="inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-mute transition-colors hover:text-ink"
          >
            <FileText className="h-4 w-4" />
            Mis cotizaciones
          </Link>
          <Link
            to="/mis-rentas"
            className="inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-mute transition-colors hover:text-ink"
          >
            <CalendarClock className="h-4 w-4" />
            Tus rentas
          </Link>
          <Link
            to="/mis-compras"
            className="inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-mute transition-colors hover:text-ink"
          >
            <ShoppingBag className="h-4 w-4" />
            Mis compras
          </Link>
        </nav>

        <div className="rounded-2xl border border-edge bg-surface p-6 sm:p-8">
          {seccion === 'perfil' ? (
            <PanelPerfil perfil={perfil} onGuardado={setPerfil} />
          ) : seccion === 'facturacion' ? (
            <PanelFacturacion perfil={perfil} onGuardado={setPerfil} />
          ) : (
            <PanelSeguridad perfil={perfil} onGuardado={setPerfil} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Perfil ───────────────────────── */

/* Un solo lugar que muestra en qué punto va el cliente hacia el 5%:
   1) correo sin confirmar → botón para reenviar; 2) confirmado pero sin datos →
   invita con el premio; 3) todo listo → enseña el cupón para copiar. */
function EstadoVerificacion({ perfil }: { perfil: Perfil | null }) {
  const [reenviando, setReenviando] = useState(false)
  const [aviso, setAviso] = useState<string | undefined>(undefined)
  const [copiado, setCopiado] = useState(false)

  const verificado = perfil?.email_verificado
  const completo = Boolean(perfil?.datos_completos)
  const cupon = perfil?.cupon

  async function reenviar() {
    setReenviando(true)
    setAviso(undefined)
    try {
      const r = await api.post('/auth/reenviar-verificacion/')
      setAviso(r.data?.detail || 'Te reenviamos el correo.')
    } catch {
      setAviso('No se pudo reenviar. Intenta más tarde.')
    } finally {
      setReenviando(false)
    }
  }

  function copiar() {
    if (!cupon?.codigo) return
    navigator.clipboard?.writeText(cupon.codigo).then(() => {
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1600)
    }).catch(() => {})
  }

  // 1) Premio desbloqueado: correo confirmado + datos completos + cupón.
  if (verificado && completo && cupon) {
    return (
      <div className="stagger-item mb-7 rounded-2xl border border-gold/40 bg-gold-soft px-5 py-5">
        <div className="flex items-center gap-2 text-ink">
          <BadgePercent className="h-5 w-5 text-gold" />
          <p className="text-sm font-bold">¡Ganaste {Math.round(cupon.descuento * 100)}% por completar tu perfil!</p>
        </div>
        <p className="mt-1 text-sm text-mute">Usa este código en tu próxima cotización:</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="rounded-lg border border-gold/40 bg-surface px-3 py-2 font-mono text-base font-bold tracking-wider text-ink">
            {cupon.codigo}
          </code>
          <button
            type="button"
            onClick={copiar}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge px-3 text-sm text-mute transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-ink active:scale-[0.97]"
          >
            {copiado ? <Check className="h-4 w-4 text-libre" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
    )
  }

  // 2) Correo sin confirmar: es lo primero que hace falta para el 5%.
  if (!verificado) {
    return (
      <div className="stagger-item mb-7 rounded-2xl border border-gold/30 bg-gold-soft px-5 py-4">
        <div className="flex items-center gap-2 text-ink">
          <Mail className="h-5 w-5 text-gold" />
          <p className="text-sm font-semibold">Confirma tu correo</p>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-mute">
          Te enviamos un enlace a <span className="font-medium text-ink">{perfil?.email}</span>.
          Confírmalo y, al completar tu perfil, obtienes un 5% de descuento.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reenviar}
            disabled={reenviando}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gold/40 px-4 text-sm font-semibold text-ink transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-gold/10 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
          >
            {reenviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {reenviando ? 'Enviando…' : 'Reenviar correo'}
          </button>
          {aviso && <span className="text-sm text-mute">{aviso}</span>}
        </div>
      </div>
    )
  }

  // 3) Correo confirmado pero faltan datos: invita con el premio.
  if (!completo) {
    return (
      <div className="stagger-item mb-7 rounded-2xl border border-gold/30 bg-gold-soft px-5 py-4">
        <p className="text-sm font-semibold text-ink">Completa tu perfil y obtén 5%</p>
        <p className="mt-1 text-sm leading-relaxed text-mute">
          Con tu teléfono, tu empresa y los datos de la obra desbloqueas un 5% de
          descuento en tus cotizaciones (y te cotizamos y entregamos más rápido).
        </p>
      </div>
    )
  }

  return null
}

function PanelPerfil({
  perfil,
  onGuardado,
}: {
  perfil: Perfil | null
  onGuardado: (p: Perfil) => void
}) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [guardado, setGuardado] = useState(false)
  const { refresh } = useProfile()

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

  async function onSubmit(datos: ValoresPerfil) {
    setError(undefined)
    setGuardado(false)
    try {
      const r = await api.patch<Perfil>('/auth/perfil/', datos)
      onGuardado(r.data)
      form.reset(datos)
      setGuardado(true)
      // Refresca /auth/me/ global: así el recordatorio flotante y el punto del
      // navbar se apagan en cuanto el perfil queda completo, sin recargar.
      refresh()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron guardar los cambios.')
    }
  }

  return (
    <>
      <EstadoVerificacion perfil={perfil} />

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
              <Campo form={form} name="telefono" label="Teléfono" placeholder="744 123 4567" autoComplete="tel" disabled={enviando} type="tel" inputMode="numeric" />
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

/* ─────────────────────── Facturación ─────────────────────── */

/* Los dos catálogos del SAT que un cliente de maquinaria usa en la práctica.
   La clave viaja tal cual a la solicitud de factura; la etiqueta es para humanos. */
const REGIMENES = [
  ['601', '601 · General de Ley Personas Morales'],
  ['612', '612 · Personas Físicas con Actividades Empresariales'],
  ['626', '626 · Régimen Simplificado de Confianza (RESICO)'],
  ['621', '621 · Incorporación Fiscal'],
  ['606', '606 · Arrendamiento'],
  ['605', '605 · Sueldos y Salarios'],
  ['616', '616 · Sin obligaciones fiscales'],
] as const
const USOS_CFDI = [
  ['G03', 'G03 · Gastos en general'],
  ['G01', 'G01 · Adquisición de mercancías'],
  ['I08', 'I08 · Otra maquinaria y equipo'],
  ['S01', 'S01 · Sin efectos fiscales'],
] as const

function PanelFacturacion({
  perfil,
  onGuardado,
}: {
  perfil: Perfil | null
  onGuardado: (p: Perfil) => void
}) {
  const [error, setError] = useState<string | undefined>(undefined)
  const [guardado, setGuardado] = useState(false)

  const form = useForm<ValoresFiscal>({
    resolver: zodResolver(esquemaFiscal),
    defaultValues: {
      fiscal_razon_social: perfil?.fiscal_razon_social || '',
      fiscal_rfc: perfil?.fiscal_rfc || '',
      fiscal_regimen: perfil?.fiscal_regimen || '',
      fiscal_cp: perfil?.fiscal_cp || '',
      fiscal_uso_cfdi: perfil?.fiscal_uso_cfdi || '',
      fiscal_email: perfil?.fiscal_email || '',
    },
  })
  const enviando = form.formState.isSubmitting

  async function onSubmit(datos: ValoresFiscal) {
    setError(undefined)
    setGuardado(false)
    try {
      // El RFC viaja en mayúsculas siempre: así lo emite el SAT.
      const r = await api.patch<Perfil>('/auth/perfil/', {
        ...datos,
        fiscal_rfc: (datos.fiscal_rfc || '').toUpperCase(),
      })
      onGuardado(r.data)
      form.reset({ ...datos, fiscal_rfc: (datos.fiscal_rfc || '').toUpperCase() })
      setGuardado(true)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron guardar los datos.')
    }
  }

  return (
    <>
      <div className="mb-7 flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
          <ReceiptText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">Datos de facturación</h2>
          <p className="mt-1 text-sm text-mute">
            Llénalos una sola vez. Cuando pidas factura de una renta o compra,
            REMALI los usa tal cual — sin dictar el RFC por teléfono.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <section className="space-y-5">
            <Campo form={form} name="fiscal_razon_social" label="Razón social (como en tu constancia)" placeholder="CONSTRUCTORA DEL PACÍFICO SA DE CV" autoComplete="organization" disabled={enviando} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo form={form} name="fiscal_rfc" label="RFC" placeholder="XAXX010101000" disabled={enviando} className="uppercase" />
              <Campo form={form} name="fiscal_cp" label="Código postal fiscal" placeholder="39300" inputMode="numeric" maxLength={5} disabled={enviando} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <CampoSelect form={form} name="fiscal_regimen" label="Régimen fiscal" opciones={REGIMENES} disabled={enviando} />
              <CampoSelect form={form} name="fiscal_uso_cfdi" label="Uso del CFDI" opciones={USOS_CFDI} disabled={enviando} />
            </div>
            <Campo form={form} name="fiscal_email" label="Correo para recibir facturas" placeholder="facturas@tuempresa.mx" type="email" autoComplete="email" disabled={enviando} />
          </section>

          <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-6">
            <button
              type="submit"
              disabled={enviando}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gold px-7 text-sm font-bold text-gold-on transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? 'Guardando…' : 'Guardar datos fiscales'}
            </button>
            {guardado && !form.formState.isDirty && (
              <span className="inline-flex items-center gap-1.5 text-sm text-libre">
                <Check className="h-4 w-4" />
                Guardado
              </span>
            )}
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
        {/* Candado y no escudo: el escudo con palomita lee "verificado", que es un
            estado. Esta tarjeta es una acción sobre una contraseña, y el candado
            es la convención para eso. El escudo se queda en la navegación, donde
            sí nombra la sección entera. */}
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
          <Lock className="h-5 w-5" />
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

function CampoSelect({ form, name, label, opciones, ...props }: any) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }: any) => (
        <FormItem className="gap-3">
          <FormLabel className="text-mute">{label}</FormLabel>
          <FormControl>
            <select
              className={`${CAMPO} w-full appearance-none border px-3 text-sm focus-visible:outline-none ${field.value ? '' : 'text-mute'}`}
              {...props}
              {...field}
            >
              <option value="">Elegir…</option>
              {opciones.map(([v, l]: [string, string]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
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
