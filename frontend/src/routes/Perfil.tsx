import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BadgePercent, CalendarClock, Check, Copy, Eye, EyeOff, FileText, Loader2,
  Pencil, Plus, ShoppingBag, Trash2, TriangleAlert,
} from 'lucide-react'

import api from '../lib/api'
import Migas from '../components/Migas'
import { useAuth } from '../store/auth'
import { useProfile } from '../store/profile'
import { AvatarInicial } from '@/components/ui/avatar-inicial'

/* ── Tipos ── */

type Obra = {
  id: number
  nombre: string
  responsable: string
  direccion: string
  telefono: string
  email: string
  predeterminada: boolean
}

type Perfil = {
  email?: string
  username?: string
  first_name?: string
  telefono?: string
  empresa?: string
  datos_completos?: boolean
  tiene_password?: boolean
  email_verificado?: boolean
  perfil_verificado?: boolean
  cupon?: { codigo: string; descuento: number } | null
  fiscal_razon_social?: string
  fiscal_rfc?: string
  fiscal_regimen?: string
  fiscal_cp?: string
  fiscal_uso_cfdi?: string
  fiscal_email?: string
}

/* Lo que edita la página en un solo formulario: datos + fiscales. La barra de
   guardar de abajo compara contra `base` para saber si hay cambios. */
type Form = {
  first_name: string; telefono: string; empresa: string
  fiscal_razon_social: string; fiscal_rfc: string; fiscal_regimen: string
  fiscal_cp: string; fiscal_uso_cfdi: string; fiscal_email: string
}

const formDe = (p: Perfil | null): Form => ({
  first_name: p?.first_name || '',
  telefono: p?.telefono || '',
  empresa: p?.empresa || '',
  fiscal_razon_social: p?.fiscal_razon_social || '',
  fiscal_rfc: p?.fiscal_rfc || '',
  fiscal_regimen: p?.fiscal_regimen || '',
  fiscal_cp: p?.fiscal_cp || '',
  fiscal_uso_cfdi: p?.fiscal_uso_cfdi || '',
  fiscal_email: p?.fiscal_email || '',
})

/* Catálogos SAT que un cliente de maquinaria usa en la práctica. */
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

/* Estilo de la casa para esta página (inputs 50px, tarjetas 20px). */
const CAMPO = 'h-[50px] w-full rounded-[13px] border border-edge bg-surface-2 px-4 text-[15px] text-ink placeholder-mute outline-none transition-colors focus:border-gold/60 focus:bg-surface'
const TARJETA = 'rounded-[20px] border border-edge bg-surface p-6 sm:p-7'
const SECCIONES = ['datos', 'obras', 'facturacion', 'seguridad'] as const

export default function Perfil() {
  const { token, logout } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { refresh } = useProfile()

  const [cargando, setCargando] = useState(true)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [obras, setObras] = useState<Obra[]>([])

  /* Formulario unificado (datos + fiscales) con barra de guardar propia. */
  const [base, setBase] = useState<Form>(formDe(null))
  const [form, setForm] = useState<Form>(formDe(null))
  const [errores, setErrores] = useState<Partial<Record<keyof Form, string>>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(base)

  /* El switch de facturación es visual: abre/cierra el bloque. Arranca abierto
     si ya hay algo capturado. Con él abierto, el RFC cuenta para el avance. */
  const [factura, setFactura] = useState(false)

  const [nudgeOculto, setNudgeOculto] = useState(false)
  const [activa, setActiva] = useState<string>('datos')

  const cargarObras = () =>
    api.get<Obra[]>('/obras-cliente/', { fondo: true } as never)
      .then(r => setObras(r.data || []))
      .catch(() => {})

  useEffect(() => {
    if (!token) {
      nav('/login?next=/perfil', { replace: true })
      return
    }
    let vivo = true
    Promise.all([
      api.get<Perfil>('/auth/perfil/').then(r => {
        if (!vivo) return
        setPerfil(r.data)
        setBase(formDe(r.data))
        setForm(formDe(r.data))
        setFactura(Boolean(r.data.fiscal_rfc || r.data.fiscal_razon_social || r.data.fiscal_regimen))
      }),
      api.get<Obra[]>('/obras-cliente/', { fondo: true } as never).then(r => { if (vivo) setObras(r.data || []) }),
    ]).catch(() => {}).finally(() => vivo && setCargando(false))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /* Enlaces viejos (?s=facturacion / ?s=seguridad) siguen llegando a su sección. */
  useEffect(() => {
    if (cargando) return
    const s = params.get('s')
    if (s && (SECCIONES as readonly string[]).includes(s)) {
      document.getElementById(s)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiva(s)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando])

  /* Scroll-spy: marca en la barra lateral la sección que está a la vista. */
  useEffect(() => {
    if (cargando) return
    const obs = new IntersectionObserver(
      entradas => {
        const visible = entradas.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiva(visible.target.id)
      },
      { rootMargin: '-120px 0px -55% 0px' },
    )
    SECCIONES.forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [cargando])

  /* ── Avance del perfil (los 5 datos del diseño) ── */
  const checks = useMemo(() => ([
    { ok: form.first_name.trim() !== '', msg: 'agrega tu nombre completo', id: 'datos' },
    { ok: form.telefono.replace(/\D/g, '').length === 10, msg: 'agrega tu teléfono para avisarte de las entregas', id: 'datos' },
    { ok: form.empresa.trim() !== '', msg: 'agrega la empresa donde trabajas', id: 'datos' },
    { ok: obras.length > 0, msg: 'guarda la obra adónde llevamos la maquinaria', id: 'obras' },
    { ok: !factura || form.fiscal_rfc.trim() !== '', msg: 'agrega tu RFC para poder facturar', id: 'facturacion' },
  ]), [form, obras.length, factura])
  const listos = checks.filter(c => c.ok).length
  const pct = Math.round((listos / checks.length) * 100)
  const falta = checks.find(c => !c.ok)

  /* ── Guardar todo (datos + fiscales) en un solo PATCH ── */
  async function guardar() {
    const errs: Partial<Record<keyof Form, string>> = {}
    const tel = form.telefono.replace(/\D/g, '')
    if (form.telefono.trim() && tel.length !== 10) errs.telefono = 'Escribe los 10 dígitos.'
    const rfc = form.fiscal_rfc.trim().toUpperCase()
    if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) errs.fiscal_rfc = 'Revisa el RFC (12 o 13 caracteres).'
    if (form.fiscal_cp.trim() && !/^\d{5}$/.test(form.fiscal_cp.trim())) errs.fiscal_cp = 'Son 5 dígitos.'
    if (form.fiscal_email.trim() && !/.+@.+\..+/.test(form.fiscal_email.trim())) errs.fiscal_email = 'Revisa el correo.'
    setErrores(errs)
    if (Object.keys(errs).length) {
      const primero = 'telefono' in errs ? 'datos' : 'facturacion'
      document.getElementById(primero)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setGuardando(true)
    setErrorGuardar('')
    try {
      const r = await api.patch<Perfil>('/auth/perfil/', { ...form, fiscal_rfc: rfc })
      setPerfil(r.data)
      setBase(formDe(r.data))
      setForm(formDe(r.data))
      setGuardado(true)
      window.setTimeout(() => setGuardado(false), 2600)
      // Refresca /auth/me/ global: el recordatorio flotante y el punto del
      // navbar se apagan en cuanto el perfil queda completo, sin recargar.
      refresh()
    } catch (err: any) {
      setErrorGuardar(err?.response?.data?.detail || 'No se pudieron guardar los cambios.')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    // pt-28: la barra de la tienda es fija (81px); sin este respiro se encima.
    return (
      <div className="mx-auto flex max-w-6xl justify-center px-6 pt-28 pb-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-gold" />
      </div>
    )
  }

  const irA = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiva(id)
  }

  const nav_ = [
    { id: 'datos', label: 'Perfil' },
    { id: 'obras', label: 'Mis obras', badge: obras.length ? String(obras.length) : '' },
    { id: 'facturacion', label: 'Facturación', badge: factura && !form.fiscal_rfc.trim() ? 'Falta RFC' : '' },
    { id: 'seguridad', label: 'Seguridad' },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-28 pb-36">
      <div className="mb-5"><Migas items={[{ label: 'Inicio', to: '/' }, { label: 'Mi perfil' }]} /></div>

      {/* ── Hero: quién eres + qué tan completo va el perfil ── */}
      <header className="flex flex-wrap items-center gap-6 rounded-[22px] border border-edge bg-surface px-6 py-6 sm:px-8">
        <AvatarInicial nombre={perfil?.first_name} correo={perfil?.email} tamano="lg" />
        <div className="min-w-[200px] flex-1">
          <h1 className="text-[26px] font-black leading-tight tracking-tight text-ink sm:text-[30px]">
            {perfil?.first_name?.trim() || 'Tu cuenta'}
          </h1>
          <p className="mt-1 truncate text-[14.5px] text-mute">
            {perfil?.email || perfil?.username}{form.empresa.trim() ? ` · ${form.empresa.trim()}` : ''}
          </p>
        </div>
        <div className="w-full sm:w-auto sm:min-w-[250px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] text-mute">Perfil completo</span>
            <span className="text-[20px] font-extrabold tracking-tight text-ink">{pct}%</span>
          </div>
          <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-edge/60">
            <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-mute">
            {falta ? `${listos} de ${checks.length} datos listos` : 'Todo listo — ya tienes el 5% aplicado.'}
          </p>
        </div>
      </header>

      <div className="mt-5 flex flex-col items-start gap-5 lg:flex-row lg:gap-6">
        {/* ── Barra lateral (chips horizontales en móvil) ── */}
        <aside className="flex w-full gap-1 overflow-x-auto rounded-[20px] border border-edge bg-surface p-2 lg:sticky lg:top-24 lg:w-[244px] lg:flex-col lg:gap-0.5 lg:p-2.5">
          {nav_.map(n => (
            <button
              key={n.id}
              type="button"
              onClick={() => irA(n.id)}
              className={`flex shrink-0 items-center justify-between gap-2.5 rounded-[13px] px-4 py-3 text-[15px] transition-colors lg:py-3.5 ${
                activa === n.id ? 'bg-surface-2 font-bold text-ink' : 'font-medium text-mute hover:text-ink'
              }`}
            >
              <span>{n.label}</span>
              {n.badge && (
                <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap ${
                  n.badge === 'Falta RFC' ? 'bg-gold-soft text-gold' : 'bg-surface-2 text-mute'
                }`}>
                  {n.badge}
                </span>
              )}
            </button>
          ))}
          <div className="mx-3 my-1.5 hidden border-t border-edge lg:block" />
          <Link to="/mis-cotizaciones" className="flex shrink-0 items-center gap-2.5 rounded-[13px] px-4 py-3 text-[15px] font-medium text-mute transition-colors hover:text-ink lg:py-3.5">
            <FileText className="h-4 w-4" /> Mis cotizaciones
          </Link>
          <Link to="/mis-rentas" className="flex shrink-0 items-center gap-2.5 rounded-[13px] px-4 py-3 text-[15px] font-medium text-mute transition-colors hover:text-ink lg:py-3.5">
            <CalendarClock className="h-4 w-4" /> Tus rentas
          </Link>
          <Link to="/mis-compras" className="flex shrink-0 items-center gap-2.5 rounded-[13px] px-4 py-3 text-[15px] font-medium text-mute transition-colors hover:text-ink lg:py-3.5">
            <ShoppingBag className="h-4 w-4" /> Mis compras
          </Link>
        </aside>

        {/* ── Contenido ── */}
        <div className="flex w-full min-w-0 flex-1 flex-col gap-4.5 sm:gap-5">
          <AvisoArriba perfil={perfil} falta={falta ? { msg: falta.msg, id: falta.id } : null}
            oculto={nudgeOculto} onOcultar={() => setNudgeOculto(true)} onIr={irA} pctCompleto={!falta} />

          {/* ── Tus datos ── */}
          <section id="datos" className={`${TARJETA} scroll-mt-24`}>
            <h2 className="text-[18px] font-bold tracking-tight text-ink">Tus datos</h2>
            <p className="mt-1 text-sm text-mute">Con esto llenamos tus cotizaciones automáticamente.</p>
            <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <CampoTexto label="Nombre completo" value={form.first_name} placeholder="Nombre y apellido"
                autoComplete="name" onChange={v => setForm({ ...form, first_name: v })} />
              <CampoTexto label="Teléfono / WhatsApp" value={form.telefono} placeholder="10 dígitos" type="tel"
                inputMode="numeric" autoComplete="tel" error={errores.telefono}
                onChange={v => setForm({ ...form, telefono: v })} />
              <label className="flex flex-col gap-2">
                <span className="text-[13.5px] font-semibold text-ink/80">Correo</span>
                <input value={perfil?.email || ''} disabled title="Es tu correo de acceso; no se cambia desde aquí."
                  className={`${CAMPO} cursor-not-allowed opacity-60`} />
              </label>
              <CampoTexto label="Empresa donde trabajas" value={form.empresa} placeholder="Constructora o nombre propio"
                autoComplete="organization" onChange={v => setForm({ ...form, empresa: v })} />
            </div>
          </section>

          {/* ── Mis obras ── */}
          <SeccionObras obras={obras} onCambio={cargarObras} />

          {/* ── Facturación ── */}
          <section id="facturacion" className={`${TARJETA} scroll-mt-24`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-[220px] flex-1">
                <h2 className="text-[18px] font-bold tracking-tight text-ink">Facturación</h2>
                <p className="mt-1 text-sm text-mute">Solo si necesitas factura; te lo pedimos una vez.</p>
              </div>
              <button type="button" role="switch" aria-checked={factura} aria-label="Necesito factura"
                onClick={() => setFactura(f => !f)}
                className={`flex h-[27px] w-12 shrink-0 items-center rounded-full p-[3px] transition-colors ${factura ? 'justify-end bg-gold' : 'justify-start bg-edge'}`}>
                <span className="block h-[21px] w-[21px] rounded-full bg-surface shadow-sm" />
              </button>
            </div>
            {factura && (
              <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <CampoTexto label="Razón social (como en tu constancia)" value={form.fiscal_razon_social}
                    placeholder="CONSTRUCTORA DEL PACÍFICO SA DE CV" autoComplete="organization"
                    onChange={v => setForm({ ...form, fiscal_razon_social: v })} />
                </div>
                <CampoTexto label="RFC" value={form.fiscal_rfc} placeholder="XAXX010101000" className="uppercase"
                  error={errores.fiscal_rfc} onChange={v => setForm({ ...form, fiscal_rfc: v })} />
                <CampoTexto label="Código postal fiscal" value={form.fiscal_cp} placeholder="39300" inputMode="numeric"
                  maxLength={5} error={errores.fiscal_cp} onChange={v => setForm({ ...form, fiscal_cp: v })} />
                <CampoSelect label="Régimen fiscal" value={form.fiscal_regimen} opciones={REGIMENES}
                  onChange={v => setForm({ ...form, fiscal_regimen: v })} />
                <CampoSelect label="Uso del CFDI" value={form.fiscal_uso_cfdi} opciones={USOS_CFDI}
                  onChange={v => setForm({ ...form, fiscal_uso_cfdi: v })} />
                <div className="sm:col-span-2">
                  <CampoTexto label="Correo para recibir facturas" value={form.fiscal_email}
                    placeholder="facturas@tuempresa.mx" type="email" error={errores.fiscal_email}
                    onChange={v => setForm({ ...form, fiscal_email: v })} />
                </div>
              </div>
            )}
          </section>

          {/* ── Seguridad ── */}
          <SeccionSeguridad perfil={perfil} onGuardado={p => setPerfil(p)}
            onCerrarSesion={() => { logout(); nav('/') }} />
        </div>
      </div>

      {/* ── Barra de guardar: aparece solo cuando hay cambios ── */}
      {(dirty || guardado || errorGuardar) && (
        <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-edge bg-surface/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
            <span className={`text-sm ${errorGuardar ? 'text-red-500 font-semibold' : 'text-mute'}`}>
              {errorGuardar || (guardado && !dirty ? 'Todo guardado.' : 'Tienes cambios sin guardar.')}
            </span>
            <div className="flex gap-2.5">
              {dirty && (
                <button type="button" onClick={() => { setForm(base); setErrores({}); setErrorGuardar('') }}
                  className="h-[46px] rounded-[12px] border border-edge bg-surface px-5 text-[14.5px] font-semibold text-ink transition-colors hover:bg-surface-2">
                  Descartar
                </button>
              )}
              <button type="button" onClick={guardar} disabled={guardando || (!dirty && guardado)}
                className={`inline-flex h-[46px] items-center gap-2 rounded-[12px] px-6 text-[14.5px] font-bold transition-[opacity,transform] active:scale-[0.98] disabled:cursor-default ${
                  guardado && !dirty ? 'bg-libre/15 text-libre' : 'bg-gold text-gold-on hover:opacity-90 disabled:opacity-60'
                }`}>
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                {guardado && !dirty ? '✓ Guardado' : guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Aviso superior: verificación pendiente → nudge del 5% → cupón ── */

function AvisoArriba({ perfil, falta, oculto, onOcultar, onIr, pctCompleto }: {
  perfil: Perfil | null
  falta: { msg: string; id: string } | null
  oculto: boolean
  onOcultar: () => void
  onIr: (id: string) => void
  pctCompleto: boolean
}) {
  const [reenviando, setReenviando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [copiado, setCopiado] = useState(false)
  const cupon = perfil?.cupon

  // 1) Sin verificar el correo no hay 5% ni avisos: esto va primero.
  if (perfil && perfil.email_verificado === false) {
    const reenviar = async () => {
      setReenviando(true)
      setAviso('')
      try {
        const r = await api.post('/auth/reenviar-verificacion/')
        setAviso(r.data?.detail || 'Te reenviamos el correo.')
      } catch {
        setAviso('No se pudo reenviar. Intenta más tarde.')
      } finally {
        setReenviando(false)
      }
    }
    return (
      <div className="rounded-[20px] border border-amber-500/40 bg-amber-500/10 px-5 py-4">
        <p className="text-sm font-bold text-ink">Confirma tu correo</p>
        <p className="mt-1 text-sm leading-relaxed text-mute">
          Te mandamos un enlace a <b className="text-ink">{perfil.email}</b>. Sin confirmarlo no podemos avisarte de tus cotizaciones.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={reenviar} disabled={reenviando}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-bold text-app transition-opacity hover:opacity-90 disabled:opacity-50">
            {reenviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {reenviando ? 'Enviando…' : 'Reenviar correo'}
          </button>
          {aviso && <span className="text-sm text-mute">{aviso}</span>}
        </div>
      </div>
    )
  }

  // 2) Falta un dato: el gancho del 5%, con el dato exacto que falta.
  if (falta && !oculto) {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-[20px] border border-gold/40 bg-surface px-5 py-5 sm:px-6">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-gold-soft text-[19px] font-extrabold text-gold">%</div>
        <button type="button" onClick={() => onIr(falta.id)} className="min-w-[200px] flex-1 text-left">
          <p className="text-[16px] font-bold text-ink">Completa tu perfil y obtén 5%</p>
          <p className="mt-0.5 text-sm leading-relaxed text-mute">
            Te falta un dato: {falta.msg}. Con el perfil completo cotizamos más rápido y aplicamos el 5%.
          </p>
        </button>
        <button type="button" onClick={onOcultar}
          className="h-9 rounded-[10px] px-3.5 text-[13.5px] font-semibold text-mute transition-colors hover:bg-surface-2 hover:text-ink">
          Ocultar
        </button>
      </div>
    )
  }

  // 3) Todo listo y con cupón: enséñalo para copiar.
  if (pctCompleto && cupon) {
    const copiar = () => {
      navigator.clipboard?.writeText(cupon.codigo).then(() => {
        setCopiado(true)
        window.setTimeout(() => setCopiado(false), 1600)
      }).catch(() => {})
    }
    return (
      <div className="rounded-[20px] border border-gold/40 bg-gold-soft px-5 py-5 sm:px-6">
        <div className="flex items-center gap-2 text-ink">
          <BadgePercent className="h-5 w-5 text-gold" />
          <p className="text-sm font-bold">¡Ganaste {Math.round(cupon.descuento * 100)}% por completar tu perfil!</p>
        </div>
        <p className="mt-1 text-sm text-mute">Usa este código en tu próxima cotización:</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="rounded-lg border border-gold/40 bg-surface px-3 py-2 font-mono text-base font-bold tracking-wider text-ink">
            {cupon.codigo}
          </code>
          <button type="button" onClick={copiar}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge px-3 text-sm text-mute transition-colors hover:text-ink active:scale-[0.97]">
            {copiado ? <Check className="h-4 w-4 text-libre" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
    )
  }

  return null
}

/* ── Mis obras: tarjetas + alta/edición en línea ── */

type ObraForm = { nombre: string; direccion: string; responsable: string; telefono: string }
const OBRA_VACIA: ObraForm = { nombre: '', direccion: '', responsable: '', telefono: '' }

function SeccionObras({ obras, onCambio }: { obras: Obra[]; onCambio: () => void }) {
  const [editando, setEditando] = useState<number | 'nueva' | null>(null)
  const [f, setF] = useState<ObraForm>(OBRA_VACIA)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const abrirNueva = () => {
    setEditando('nueva')
    setF(OBRA_VACIA)
    setError('')
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
  }
  const abrirEditar = (o: Obra) => {
    setEditando(o.id)
    setF({ nombre: o.nombre, direccion: o.direccion, responsable: o.responsable, telefono: o.telefono })
    setError('')
  }

  const guardarObra = async () => {
    if (!f.nombre.trim() || !f.direccion.trim()) {
      setError('Ponle un nombre a la obra y su dirección.')
      return
    }
    setOcupado(true)
    setError('')
    try {
      if (editando === 'nueva') await api.post('/obras-cliente/', f)
      else await api.patch(`/obras-cliente/${editando}/`, f)
      setEditando(null)
      onCambio()
    } catch {
      setError('No se pudo guardar la obra.')
    } finally {
      setOcupado(false)
    }
  }

  const eliminar = async (o: Obra) => {
    if (!window.confirm(`¿Eliminar la obra "${o.nombre}"?`)) return
    setOcupado(true)
    try {
      await api.delete(`/obras-cliente/${o.id}/`)
      setEditando(null)
      onCambio()
    } catch { /* el interceptor avisa */ } finally { setOcupado(false) }
  }

  const usarPorDefecto = async (o: Obra) => {
    if (o.predeterminada) return
    try {
      await api.patch(`/obras-cliente/${o.id}/`, { predeterminada: true })
      onCambio()
    } catch { /* el interceptor avisa */ }
  }

  return (
    <section id="obras" className={`${TARJETA} scroll-mt-24`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-bold tracking-tight text-ink">Mis obras</h2>
          <p className="mt-1 text-sm text-mute">Adónde llevamos la maquinaria. Guarda cada obra una vez y elígela al cotizar.</p>
        </div>
        {editando !== 'nueva' && (
          <button type="button" onClick={abrirNueva}
            className="inline-flex h-[42px] items-center gap-1.5 rounded-[12px] border border-edge bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-2">
            <Plus className="h-4 w-4" /> Agregar obra
          </button>
        )}
      </div>

      {obras.length === 0 && editando === null && (
        <p className="mt-5 rounded-[14px] border border-dashed border-edge px-4 py-5 text-center text-sm text-mute">
          Aún no guardas ninguna obra. Con una guardada, cotizar toma segundos.
        </p>
      )}

      <div className="mt-5 grid gap-3.5 md:grid-cols-2">
        {obras.map(o => (
          editando === o.id ? (
            <FormObra key={o.id} f={f} setF={setF} error={error} ocupado={ocupado}
              onGuardar={guardarObra} onCancelar={() => setEditando(null)} onEliminar={() => eliminar(o)} />
          ) : (
            <div key={o.id} className={`rounded-[16px] border p-4.5 sm:p-5 ${o.predeterminada ? 'border-gold/40 bg-gold-soft/40' : 'border-edge bg-surface'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold leading-tight text-ink">{o.nombre}</p>
                  <p className="mt-1 text-[13.5px] leading-snug text-mute">{o.direccion}</p>
                </div>
                {o.predeterminada && (
                  <span className="shrink-0 rounded-full bg-gold-soft px-2.5 py-1 text-[11.5px] font-bold text-gold whitespace-nowrap">Predeterminada</span>
                )}
              </div>
              {(o.responsable || o.telefono) && (
                <p className="mt-3 border-t border-edge pt-3 text-[13.5px] leading-relaxed text-mute">
                  {o.responsable && <>Recibe {o.responsable}<br /></>}
                  {o.telefono}
                </p>
              )}
              <div className="mt-3.5 flex gap-2">
                <button type="button" onClick={() => usarPorDefecto(o)}
                  className={`h-9 rounded-[10px] px-3.5 text-[13px] font-semibold transition-colors ${
                    o.predeterminada
                      ? 'cursor-default border border-gold/40 bg-gold-soft text-gold'
                      : 'border border-edge bg-surface text-ink hover:bg-surface-2'
                  }`}>
                  {o.predeterminada ? '✓ Predeterminada' : 'Usar por defecto'}
                </button>
                <button type="button" onClick={() => abrirEditar(o)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-mute transition-colors hover:bg-surface-2 hover:text-ink">
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
              </div>
            </div>
          )
        ))}
        {editando === 'nueva' && (
          <div ref={formRef}>
            <FormObra f={f} setF={setF} error={error} ocupado={ocupado}
              onGuardar={guardarObra} onCancelar={() => setEditando(null)} />
          </div>
        )}
      </div>
    </section>
  )
}

function FormObra({ f, setF, error, ocupado, onGuardar, onCancelar, onEliminar }: {
  f: ObraForm; setF: (v: ObraForm) => void; error: string; ocupado: boolean
  onGuardar: () => void; onCancelar: () => void; onEliminar?: () => void
}) {
  const mini = 'h-[42px] w-full rounded-[11px] border border-edge bg-surface-2 px-3.5 text-[14px] text-ink placeholder-mute outline-none transition-colors focus:border-gold/60 focus:bg-surface'
  return (
    <div className="rounded-[16px] border border-gold/40 bg-surface p-4.5 sm:p-5">
      <div className="grid gap-3">
        <input className={mini} value={f.nombre} placeholder='Nombre de la obra (ej. "Torre Costera")'
          onChange={e => setF({ ...f, nombre: e.target.value })} />
        <input className={mini} value={f.direccion} placeholder="Dirección de entrega"
          onChange={e => setF({ ...f, direccion: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <input className={mini} value={f.responsable} placeholder="Quién recibe"
            onChange={e => setF({ ...f, responsable: e.target.value })} />
          <input className={mini} value={f.telefono} placeholder="Teléfono" type="tel" inputMode="numeric"
            onChange={e => setF({ ...f, telefono: e.target.value })} />
        </div>
      </div>
      {error && <p className="mt-2 text-[12.5px] font-semibold text-red-500">{error}</p>}
      <div className="mt-3.5 flex items-center gap-2">
        <button type="button" onClick={onGuardar} disabled={ocupado}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-gold px-4 text-[13px] font-bold text-gold-on transition-opacity hover:opacity-90 disabled:opacity-50">
          {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar obra
        </button>
        <button type="button" onClick={onCancelar} disabled={ocupado}
          className="h-9 rounded-[10px] px-3.5 text-[13px] font-semibold text-mute transition-colors hover:bg-surface-2 hover:text-ink">
          Cancelar
        </button>
        {onEliminar && (
          <button type="button" onClick={onEliminar} disabled={ocupado}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400">
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Seguridad: contraseña (expandible) + cerrar sesión ── */

function SeccionSeguridad({ perfil, onGuardado, onCerrarSesion }: {
  perfil: Perfil | null
  onGuardado: (p: Perfil) => void
  onCerrarSesion: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const [enviando, setEnviando] = useState(false)

  // Quien entró con Google no tiene contraseña: para él esto es crearla, y
  // pedirle "la actual" lo dejaría sin poder hacerlo nunca.
  const tienePassword = perfil?.tiene_password !== false

  const cambiar = async () => {
    setError('')
    setListo(false)
    if (nueva.length < 8) { setError('La contraseña nueva necesita mínimo 8 caracteres.'); return }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden.'); return }
    setEnviando(true)
    try {
      await api.post('/auth/password/', { password_actual: actual || '', password_nueva: nueva })
      setActual(''); setNueva(''); setConfirmar('')
      setListo(true)
      setAbierto(false)
      if (perfil) onGuardado({ ...perfil, tiene_password: true })
    } catch (err: any) {
      if (err?.response?.status === 429) setError('Demasiados intentos. Espera un rato.')
      else setError(err?.response?.data?.detail || 'No se pudo cambiar la contraseña.')
    } finally {
      setEnviando(false)
    }
  }

  const CAMPO_P = 'h-[46px] w-full rounded-[12px] border border-edge bg-surface-2 px-4 pr-12 text-[14.5px] text-ink placeholder-mute outline-none transition-colors focus:border-gold/60 focus:bg-surface'
  const Ojo = () => (
    <button type="button" onClick={() => setVer(v => !v)} aria-label={ver ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mute transition-colors hover:text-gold">
      {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )

  return (
    <section id="seguridad" className={`${TARJETA} scroll-mt-24`}>
      <h2 className="text-[18px] font-bold tracking-tight text-ink">Seguridad</h2>

      {/* Contraseña */}
      <div className="mt-4 border-t border-edge pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-ink">{tienePassword ? 'Contraseña' : 'Crear una contraseña'}</p>
            <p className="mt-0.5 text-[13.5px] text-mute">
              {listo
                ? 'Listo, tu contraseña quedó guardada.'
                : tienePassword
                  ? 'Cámbiala cuando quieras.'
                  : 'Entraste con Google; con una contraseña podrás entrar de las dos formas.'}
            </p>
          </div>
          <button type="button" onClick={() => { setAbierto(a => !a); setError(''); setListo(false) }}
            className="h-[42px] rounded-[12px] border border-edge bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-2">
            {abierto ? 'Cancelar' : tienePassword ? 'Cambiar contraseña' : 'Crear contraseña'}
          </button>
        </div>

        {abierto && (
          <div className="mt-4 grid gap-3.5 sm:max-w-[520px]">
            {tienePassword && (
              <div className="relative">
                <input type={ver ? 'text' : 'password'} className={CAMPO_P} value={actual} placeholder="Contraseña actual"
                  autoComplete="current-password" onChange={e => setActual(e.target.value)} />
                <Ojo />
              </div>
            )}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="relative">
                <input type={ver ? 'text' : 'password'} className={CAMPO_P} value={nueva} placeholder="Nueva (mínimo 8)"
                  autoComplete="new-password" onChange={e => setNueva(e.target.value)} />
                <Ojo />
              </div>
              <div className="relative">
                <input type={ver ? 'text' : 'password'} className={CAMPO_P} value={confirmar} placeholder="Repítela"
                  autoComplete="new-password" onChange={e => setConfirmar(e.target.value)} />
                <Ojo />
              </div>
            </div>
            {error && <p className="text-[13px] font-semibold text-red-500">{error}</p>}
            <div className="flex items-start gap-2.5 rounded-[12px] border border-edge bg-surface-2 px-4 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-mute" />
              <p className="text-[13px] leading-relaxed text-mute">
                Cambiarla no cierra las sesiones ya abiertas en otros dispositivos. Si crees que alguien entró, avísanos.
              </p>
            </div>
            <div>
              <button type="button" onClick={cambiar} disabled={enviando}
                className="inline-flex h-[44px] items-center gap-2 rounded-[12px] bg-gold px-6 text-sm font-bold text-gold-on transition-opacity hover:opacity-90 disabled:opacity-50">
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                {enviando ? 'Guardando…' : tienePassword ? 'Cambiar contraseña' : 'Crear contraseña'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cerrar sesión */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
        <div>
          <p className="text-[15px] font-semibold text-ink">Cerrar sesión en este dispositivo</p>
          <p className="mt-0.5 text-[13.5px] text-mute">Tus cotizaciones guardadas no se borran.</p>
        </div>
        <button type="button" onClick={onCerrarSesion}
          className="h-[42px] rounded-[12px] px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400">
          Cerrar sesión
        </button>
      </div>
    </section>
  )
}

/* ── Campos ── */

function CampoTexto({ label, value, onChange, error, className = '', ...props }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'className'>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13.5px] font-semibold text-ink/80">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`${CAMPO} ${error ? 'border-red-400/70' : ''} ${className}`} {...props} />
      {error && <span className="text-[12.5px] font-semibold text-red-500">{error}</span>}
    </label>
  )
}

function CampoSelect({ label, value, onChange, opciones }: {
  label: string; value: string; onChange: (v: string) => void
  opciones: readonly (readonly [string, string])[]
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13.5px] font-semibold text-ink/80">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`${CAMPO} appearance-none ${value ? '' : 'text-mute'}`}>
        <option value="">Elegir…</option>
        {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
