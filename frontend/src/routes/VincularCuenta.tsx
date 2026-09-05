import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { formatMoney } from '../lib/utils'
import { MarcaVeredicto, TarjetaViva } from '../components/Veredicto'

type Info = {
  tipo: string
  id: number
  total: string
  concepto?: string
  cliente?: string
  ya_ligada?: boolean
  fecha?: string
  fecha_inicio?: string
  fecha_fin?: string
}

/** Página pública de la "liga de vinculación": el cliente abre el enlace que le
 *  mandó el admin; si no tiene sesión se le pide iniciar, y al confirmar la
 *  venta/renta queda ligada a SU cuenta (la liga es de un solo uso). */
export default function VincularCuenta({ tipo }: { tipo: 'venta' | 'renta' | 'cotizacion' | 'reparacion' }) {
  const { token } = useParams()
  const nav = useNavigate()
  const { token: sesion } = useAuth()
  const ruta = `/vincular/${tipo}/${token}`
  const titulo = tipo === 'renta' ? 'renta' : tipo === 'cotizacion' ? 'cotización' : tipo === 'reparacion' ? 'reparación' : 'compra'

  const [info, setInfo] = useState<Info | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [vinculando, setVinculando] = useState(false)

  useEffect(() => {
    // Sin sesión NO redirigimos a ciegas: mostramos la tarjeta con el aviso de
    // iniciar sesión (abajo), para que el cliente entienda POR QUÉ se le pide y
    // no aparezca en el login sin contexto.
    if (!sesion) { setCargando(false); return }
    let vivo = true
    api.get<Info>(`/vinculo/${tipo}/${token}/`, { fondo: true } as never)
      .then(r => { if (vivo) setInfo(r.data) })
      .catch(e => { if (vivo) setError(e?.response?.data?.detalle || 'No se pudo abrir el enlace.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [tipo, token, sesion])

  const vincular = async () => {
    setVinculando(true)
    setError('')
    try {
      await api.post(`/vinculo/${tipo}/${token}/`, {}, { fondo: true } as never)
      setOk(true)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo vincular.')
    } finally {
      setVinculando(false)
    }
  }

  /* Qué está mostrando la tarjeta. Cuando esto cambia se hace el relevo: lo
     anterior se va y la caja viaja a su nuevo alto en vez de saltar. */
  const paso = cargando ? 'cargando' : !sesion ? 'sin-sesion' : ok ? 'listo' : error ? 'error' : info ? 'confirmar' : 'vacio'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <TarjetaViva paso={paso}
        className="w-full max-w-md rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)]"
        interior="p-8 text-center">
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Abriendo tu enlace…</p>
          </div>
        ) : !sesion ? (
          <>
            <div className="vc-pop w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mb-5">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            </div>
            <h1 className="vc-rise text-[22px] font-black text-ink leading-tight" style={{ animationDelay: '120ms' }}>Vincular {titulo} a tu cuenta</h1>
            <p className="vc-rise text-mute text-sm mt-2 max-w-[34ch] mx-auto" style={{ animationDelay: '180ms' }}>
              Para guardarla en tu historial de REMALI, primero <b className="text-ink">inicia sesión</b> con tu cuenta. Al entrar, vuelves aquí solo.
            </p>
            <button onClick={() => nav(`/login?next=${encodeURIComponent(ruta)}`)}
              style={{ animationDelay: '260ms' }}
              className="vc-rise mt-7 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm transition-[transform,opacity] duration-150 ease-out hover:opacity-95 active:scale-[0.97]">
              Iniciar sesión para vincular
            </button>
            <p className="vc-rise text-[12px] text-mute mt-3" style={{ animationDelay: '320ms' }}>¿No tienes cuenta? En el login puedes crearla.</p>
          </>
        ) : ok ? (
          <>
            {/* El sí: anillo que pulsa una vez, rebote mínimo y la palomita
                trazándose. El texto sube en cascada detrás. */}
            <MarcaVeredicto tipo="exito" className="mb-6" />
            <h1 className="vc-rise text-[26px] font-black tracking-tight text-ink" style={{ animationDelay: '300ms' }}>¡Listo!</h1>
            <p className="vc-rise text-mute text-sm mt-2 max-w-[30ch] mx-auto" style={{ animationDelay: '370ms' }}>Tu {titulo} ya vive en tu cuenta.</p>
            <button
              onClick={() => nav(tipo === 'renta' ? '/mis-rentas' : tipo === 'cotizacion' ? '/mis-cotizaciones' : tipo === 'reparacion' ? '/mis-reparaciones' : '/mis-compras')}
              style={{ animationDelay: '450ms' }}
              className="vc-rise group mt-7 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm inline-flex items-center justify-center gap-2 transition-[transform,opacity] duration-150 ease-out hover:opacity-95 active:scale-[0.97]"
            >
              Ver mi historial
              <svg className="w-4 h-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-6-6m6 6l-6 6" /></svg>
            </button>
          </>
        ) : error ? (
          <>
            {/* Contraparte sobria del sí: entra calmada, sin anillo, y hace un
                "no" sutil una sola vez. */}
            <MarcaVeredicto tipo="alerta" className="mb-5" />
            <h1 className="vc-rise text-[22px] font-black text-ink" style={{ animationDelay: '160ms' }}>Enlace no disponible</h1>
            <p className="vc-rise text-mute text-sm mt-2" style={{ animationDelay: '230ms' }}>{error}</p>
            <button onClick={() => nav('/')} style={{ animationDelay: '310ms' }} className="vc-rise mt-7 w-full py-3.5 rounded-full border border-edge text-ink font-semibold text-sm transition-[transform,background-color] duration-150 ease-out hover:bg-surface-2 active:scale-[0.97]">
              Ir al inicio
            </button>
          </>
        ) : info ? (
          <>
            <div className="vc-pop w-16 h-16 mx-auto rounded-full bg-gold-soft text-gold-ink flex items-center justify-center mb-5">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            </div>
            <h1 className="vc-rise text-[22px] font-black text-ink leading-tight" style={{ animationDelay: '120ms' }}>Vincular {titulo} a tu cuenta</h1>
            <p className="vc-rise text-mute text-sm mt-2" style={{ animationDelay: '180ms' }}>Confírmalo y quedará guardada en tu historial de REMALI.</p>

            <div className="vc-rise mt-6 rounded-2xl bg-surface-2 border border-edge p-5 text-left text-sm" style={{ animationDelay: '250ms' }}>
              <div className="flex justify-between gap-4">
                <span className="text-mute">Concepto</span>
                <span className="text-ink font-semibold text-right">{info.concepto || '—'}</span>
              </div>
              {info.cliente && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">A nombre de</span>
                  <span className="text-ink font-semibold text-right">{info.cliente}</span>
                </div>
              )}
              {info.fecha && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">Fecha</span>
                  <span className="text-ink font-semibold">{new Date(info.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              )}
              {info.fecha_fin && (
                <div className="flex justify-between gap-4 mt-3">
                  <span className="text-mute">Vence</span>
                  <span className="text-ink font-semibold">{new Date(info.fecha_fin).toLocaleDateString('es-MX')}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-4 pt-4">
                <span className="text-[15px] font-bold text-ink">Total</span>
                <span className="text-[24px] font-black tracking-tight text-ink">{formatMoney(Number(info.total))}</span>
              </div>
            </div>

            {info.ya_ligada && (
              <p className="vc-rise text-taller-ink text-xs mt-3" style={{ animationDelay: '310ms' }}>Esta {titulo} ya estaba en una cuenta; al confirmar pasará a la tuya.</p>
            )}
            <button onClick={vincular} disabled={vinculando}
              style={{ animationDelay: '340ms' }}
              className="vc-rise mt-6 w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm transition-[transform,opacity] duration-150 ease-out hover:opacity-95 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100">
              {vinculando ? 'Vinculando…' : 'Vincular a mi cuenta'}
            </button>
            <p className="vc-rise text-[11.5px] text-mute mt-3" style={{ animationDelay: '400ms' }}>Se guardará en la cuenta con la que iniciaste sesión.</p>
          </>
        ) : null}
      </TarjetaViva>
    </div>
  )
}
