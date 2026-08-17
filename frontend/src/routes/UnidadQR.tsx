import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useConfigPublica } from '../lib/configPublica'

type Renta = {
  id: number; estado: string; cliente: string; lugar: string
  fecha_inicio?: string; fecha_fin?: string; entregada: boolean; adeudo?: string | null
}
type Info = {
  publico: boolean
  codigo: string; equipo: string; equipo_id?: number | null
  estado?: string; numero_serie?: string | null; condicion?: string
  renta?: Renta | null
}

const ESTADO_UNIDAD: Record<string, { label: string; cls: string }> = {
  disponible: { label: 'Disponible', cls: 'bg-libre/10 text-libre' },
  rentado: { label: 'Rentada', cls: 'bg-[color:var(--c-renta)]/10 text-[color:var(--c-renta)]' },
  mantenimiento: { label: 'En taller', cls: 'bg-amber-500/10 text-amber-600' },
  vendido: { label: 'Vendida', cls: 'bg-ink/10 text-mute' },
}

const f = (s?: string) => (s ? new Date(`${s}T12:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—')

/** La página detrás del QR pegado en la máquina (remali.mx/u/COD-0001).
 *  Operador con sesión: ficha de campo con acciones. Cualquier otra persona:
 *  tarjeta de contacto de REMALI — recuperación y ventas en una. */
export default function UnidadQR() {
  const { codigo } = useParams()
  const cfg = useConfigPublica()
  const [info, setInfo] = useState<Info | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [marcando, setMarcando] = useState(false)
  // Fallo al marcar la entrega. Va aparte de `error` (que pinta la pantalla de
  // "unidad no encontrada"): aquí la unidad sí existe, lo que falló es la acción.
  const [avisoEntrega, setAvisoEntrega] = useState('')

  const cargar = () => api.get<Info>(`/unidades/qr/${codigo}/`, { fondo: true } as never)
    .then(r => setInfo(r.data))
    .catch(e => setError(e?.response?.data?.detalle || 'No encontramos esta unidad.'))
    .finally(() => setCargando(false))
  useEffect(() => { cargar() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [codigo])

  const marcarEntregada = async () => {
    if (!info?.renta) return
    setMarcando(true)
    setAvisoEntrega('')
    try {
      await api.post(`/rentas/${info.renta.id}/entregar/`, { entregado: true })
      await cargar()
    } catch (e: any) {
      // El interceptor global solo avisa de red caída y 5xx. Un 400 ("la unidad
      // está vendida", "está en taller") se quedaba mudo: el técnico picaba el
      // botón y no pasaba nada visible. El motivo se muestra aquí.
      setAvisoEntrega(e?.response?.data?.detalle || 'No se pudo marcar la entrega. Inténtalo de nuevo.')
    } finally { setMarcando(false) }
  }

  const wa = (cfg.whatsapp_principal || '').replace(/\D/g, '')
  const waHref = wa ? `https://wa.me/${wa.length === 10 ? '52' + wa : wa}?text=${encodeURIComponent(`Hola, les escribo por la máquina ${codigo}.`)}` : null

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-edge bg-surface shadow-[0_24px_60px_rgba(17,24,39,0.10)] p-8">
        {cargando ? (
          <div className="py-10 flex flex-col items-center gap-4">
            <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <p className="text-mute text-sm">Buscando la unidad…</p>
          </div>
        ) : error ? (
          <div className="text-center">
            <h1 className="text-[20px] font-black text-ink">Unidad no encontrada</h1>
            <p className="text-mute text-sm mt-2">{error}</p>
            <Link to="/" className="inline-block mt-6 px-6 py-3 rounded-full bg-gold text-black text-sm font-bold">Ir a REMALI</Link>
          </div>
        ) : info && info.publico ? (
          /* ── Tarjeta PÚBLICA: contacto y venta ── */
          <div className="text-center">
            <p className="text-[10.5px] font-mono tracking-[0.2em] text-mute uppercase">Equipo de</p>
            <p className="text-[26px] font-black text-ink tracking-tight">REMALI</p>
            <div className="mt-5 rounded-2xl bg-surface-2 border border-edge px-5 py-4">
              <p className="text-[17px] font-black text-ink">{info.equipo}</p>
              <p className="text-[12.5px] font-mono text-mute mt-0.5">{info.codigo}</p>
            </div>
            <p className="text-[13px] text-mute mt-4 leading-relaxed">
              Esta máquina pertenece a REMALI · Renta y venta de maquinaria ligera en Acapulco.
            </p>
            {waHref && (
              <a href={waHref} target="_blank" rel="noopener noreferrer"
                className="mt-5 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#25D366] text-white text-sm font-bold hover:opacity-90 transition-opacity">
                WhatsApp REMALI
              </a>
            )}
            {info.equipo_id && (
              <Link to={`/equipo/${info.equipo_id}`}
                className="mt-2.5 w-full inline-block py-3 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">
                ¿Necesitas una igual? Réntala aquí
              </Link>
            )}
          </div>
        ) : info ? (
          /* ── Ficha de CAMPO para el equipo de REMALI ── */
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-mono tracking-[0.14em] text-mute uppercase">Ficha de campo</p>
                <h1 className="text-[20px] font-black text-ink leading-tight mt-1">{info.equipo}</h1>
                <p className="text-[13px] font-mono text-mute mt-0.5">{info.codigo}{info.numero_serie ? ` · S/N ${info.numero_serie}` : ''}</p>
              </div>
              <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full uppercase ${(ESTADO_UNIDAD[info.estado || ''] || ESTADO_UNIDAD.disponible).cls}`}>
                {(ESTADO_UNIDAD[info.estado || ''] || ESTADO_UNIDAD.disponible).label}
              </span>
            </div>

            {info.renta ? (
              <div className="mt-5 rounded-2xl bg-surface-2 border border-edge p-4 text-sm space-y-2.5">
                <div className="flex justify-between gap-3"><span className="text-mute">Cliente</span><span className="text-ink font-semibold text-right">{info.renta.cliente || '—'}</span></div>
                {info.renta.lugar && <div className="flex justify-between gap-3"><span className="text-mute">Lugar</span><span className="text-ink font-semibold text-right">{info.renta.lugar}</span></div>}
                <div className="flex justify-between gap-3"><span className="text-mute">Periodo</span><span className="text-ink font-semibold">Del {f(info.renta.fecha_inicio)} al {f(info.renta.fecha_fin)}</span></div>
                {info.renta.adeudo && (
                  <p className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[13px] font-bold text-red-600 dark:text-red-400">
                    Adeudo: cobrar ${Number(info.renta.adeudo).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
                {avisoEntrega && (
                  <p className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[13px] text-red-600 dark:text-red-400">
                    {avisoEntrega}
                  </p>
                )}
                {!info.renta.entregada && (
                  <button onClick={marcarEntregada} disabled={marcando}
                    className="w-full py-3 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">
                    {marcando ? 'Marcando…' : 'Marcar como entregada'}
                  </button>
                )}
                {info.renta.entregada && (
                  <p className="text-[12px] text-mute">Entregada ✓ — la recolección y evidencias van por <b>Mi jornada</b> en el panel.</p>
                )}
              </div>
            ) : (
              <p className="mt-5 text-[13.5px] text-mute">Sin renta en curso. {info.estado === 'disponible' ? 'Lista para rentarse o venderse.' : ''}</p>
            )}

            <Link to="/dashboard" className="mt-5 inline-block text-[13px] font-bold text-gold-ink hover:opacity-80">Abrir el panel →</Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
