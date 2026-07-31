import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Loader2, PackageOpen, RotateCcw } from 'lucide-react'

import api from '../lib/api'
import { formatMoney } from '../lib/utils'
import { useAuth } from '../store/auth'
import { useCart, type Modalidad } from '../store/cart'
import { useToast } from '../store/toast'

type CotMia = {
  folio: string
  estado: string
  estado_label: string
  tipo: string
  total: string
  aplica_iva: boolean
  creada: string
  vence_el: string | null
  items: { descripcion: string; cantidad: number }[]
  carrito: { id: number; title: string; price: number; qty: number; unit: Modalidad }[]
  pdf: string | null
}

const money = formatMoney
const fecha = (s: string) => new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })

/* Color del estado, de cara al cliente. Verde = lista; ámbar = en revisión;
   rojo = no disponible; gris = vencida. */
function estiloEstado(estado: string) {
  if (estado === 'aceptada') return 'bg-libre/10 text-libre'
  if (estado === 'rechazada') return 'bg-red-500/10 text-red-500'
  if (estado === 'vencida') return 'bg-ink/10 text-mute'
  return 'bg-gold/15 text-gold'
}

export default function MisCotizaciones() {
  const { token } = useAuth()
  const nav = useNavigate()
  const { dispatch } = useCart()
  const { notify } = useToast()
  const [cargando, setCargando] = useState(true)
  const [cots, setCots] = useState<CotMia[]>([])

  useEffect(() => {
    if (!token) {
      nav('/login?next=/mis-cotizaciones', { replace: true })
      return
    }
    let vivo = true
    api.get<{ cotizaciones: CotMia[] }>('/cotizaciones/mias/')
      .then(r => vivo && setCots(r.data.cotizaciones || []))
      .catch(() => {})
      .finally(() => vivo && setCargando(false))
    return () => { vivo = false }
  }, [token, nav])

  // "Volver a cotizar": re-carga esas líneas al carrito y lleva al formulario.
  // El precio es el de aquella solicitud; el total final lo confirma el servidor
  // al generar la cotización, así que no queda amarrado a un precio viejo.
  function volverACotizar(c: CotMia) {
    if (!c.carrito?.length) return
    // Reemplaza lo que hubiera: se retoma ESA cotización (una cotización es de
    // un solo tipo, así que mezclar con lo anterior no tiene sentido).
    dispatch({
      type: 'reemplazar',
      items: c.carrito.map((l, idx) => ({ lineId: Date.now() + idx, id: l.id, title: l.title, price: l.price, qty: l.qty, unit: l.unit })),
    })
    notify('Cotización cargada de nuevo')
    nav('/cotizacion')
  }

  return (
    <div className="mx-auto max-w-4xl px-6 pt-28 pb-16">
      <header className="mb-8">
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">Mis cotizaciones</h1>
        <p className="mt-1 text-sm text-mute">Tus solicitudes, su estado y el PDF de cada una.</p>
      </header>

      {cargando ? (
        <div className="flex justify-center py-20">
          {/* Giro un poco más rápido que el default: hace sentir la carga más ágil. */}
          <Loader2 className="h-7 w-7 animate-spin text-gold" style={{ animationDuration: '0.7s' }} />
        </div>
      ) : cots.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface px-6 py-14 text-center">
          <PackageOpen className="mx-auto h-10 w-10 text-mute" />
          <p className="mt-4 text-sm font-semibold text-ink">Aún no has solicitado cotizaciones</p>
          <p className="mt-1 text-sm text-mute">Arma tu solicitud desde el catálogo y aquí verás su seguimiento.</p>
          <Link to="/equipos" className="btn-acento mt-5 inline-flex h-10 items-center rounded-full px-6 text-sm font-bold">
            Ver maquinaria
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {cots.map((c, i) => (
            <div key={c.folio} style={{ animationDelay: `${i * 40}ms` }} className="stagger-item rounded-2xl border border-edge bg-surface p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-extrabold text-ink">{c.folio}</span>
                <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${estiloEstado(c.estado)}`}>
                  {c.estado_label}
                </span>
                <span className="text-[13px] text-mute">{fecha(c.creada)}</span>
                <span className="ml-auto text-sm font-extrabold text-price">
                  {money(Number(c.total))}
                  {!c.aplica_iva && <span className="ml-1 text-[11px] font-medium text-mute">+ IVA</span>}
                </span>
              </div>

              {c.items.length > 0 && (
                <p className="mt-2.5 text-[13px] text-mute leading-relaxed">
                  {c.items.map(i => `${i.cantidad}× ${i.descripcion}`).join(' · ')}
                </p>
              )}

              {(c.pdf || c.carrito.length > 0) && (
                <div className="mt-3.5 pt-3.5 border-t border-edge flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Link to={`/mis-cotizaciones/${c.folio}`}
                    className="inline-flex items-center gap-2 text-sm font-bold text-gold transition-opacity hover:opacity-80 active:scale-[0.98]">
                    Ver estado →
                  </Link>
                  {c.pdf && (
                    <a href={c.pdf} target="_blank" rel="noopener noreferrer"
                       className="group inline-flex items-center gap-2 text-sm font-semibold text-ink transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-gold active:scale-[0.98]">
                      <FileText className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5" />
                      Ver / descargar PDF
                    </a>
                  )}
                  {c.carrito.length > 0 && (
                    <button type="button" onClick={() => volverACotizar(c)}
                       className="group inline-flex items-center gap-2 text-sm font-semibold text-mute transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-gold active:scale-[0.98]">
                      <RotateCcw className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-rotate-[45deg]" />
                      Volver a cotizar
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
