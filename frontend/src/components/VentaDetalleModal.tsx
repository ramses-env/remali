import { useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../lib/api'
import { descargarBlob } from '../lib/descargar'

type VentaLike = {
  id: number
  nombre_cliente?: string | null
  empresa?: string | null
  subtotal?: string
  iva?: string
  estado?: string
  total: string
  metodo_pago: string
  fecha: string
  vendedor?: string | null
  telefono_cliente?: string | null
  cuenta?: string | null
  unidad?: { codigo: string; equipo?: string | null } | null
  factura_estado?: string | null
  origen?: { folio: string; resumen: string } | null
}

const money = (n?: string | number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

/** Detalle de una venta, fiel al diseño "Modal Venta REMALI": tarjeta del
 *  equipo, totales con el cobrado en grande, la liga de vinculación con sus
 *  estados y la confirmación de cancelar como franja inline (no diálogo). */
export default function VentaDetalleModal({ venta, onClose, onChanged, notify }: {
  venta: VentaLike
  onClose: () => void
  onChanged: () => void
  notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [liga, setLiga] = useState('')
  const [generando, setGenerando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [pdf, setPdf] = useState(false)
  // Estado en la bandeja de facturación; local para que el chip aparezca al
  // instante al mandarla, sin esperar el refetch de la lista.
  const [factura, setFactura] = useState<string | null>(venta.factura_estado ?? null)
  const [mandando, setMandando] = useState(false)
  const cancelada = venta.estado === 'cancelada'

  const mandarPorFacturar = async () => {
    setMandando(true)
    try {
      await api.post(`/ventas/${venta.id}/por-facturar/`, {}, { fondo: true } as never)
      setFactura('pendiente')
      notify('En la bandeja Por facturar')
      onChanged()
    } catch (e: unknown) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo mandar a facturar', 'err')
    } finally {
      setMandando(false)
    }
  }

  const generarLiga = async () => {
    if (liga || generando) return
    setGenerando(true)
    try {
      const r = await api.post<{ ruta: string }>(`/ventas/${venta.id}/vinculo/`, {}, { fondo: true } as never)
      setLiga(`${window.location.origin}${r.data.ruta}`)
    } catch (e: unknown) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo generar la liga', 'err')
    } finally {
      setGenerando(false)
    }
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(liga)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      notify('No se pudo copiar; copia el texto manualmente', 'err')
    }
  }

  const cancelar = async () => {
    setCancelando(true)
    try {
      await api.post(`/ventas/${venta.id}/cancelar/`, {})
      notify('Venta cancelada')
      onChanged()
      onClose()
    } catch (e: unknown) {
      notify((e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || 'No se pudo cancelar', 'err')
    } finally {
      setCancelando(false)
    }
  }

  // Orden carta en PDF (misma que recibía el cliente): se baja como blob con la
  // sesión del axios, no con un <a href> (que no llevaría el token).
  const ordenCarta = async () => {
    setPdf(true)
    try {
      const r = await api.get(`/ventas/${venta.id}/ticket/`, { responseType: 'blob', fondo: true } as never)
      descargarBlob(r.data as Blob, `orden-venta-${venta.id}.pdf`)
    } catch {
      notify('No se pudo abrir el PDF', 'err')
    } finally {
      setPdf(false)
    }
  }

  const waHref = () => {
    const msg = `Hola${venta.nombre_cliente ? ' ' + venta.nombre_cliente : ''}, aquí tienes tu compra en REMALI. Ábrela para guardarla en tu cuenta:\n${liga}`
    const tel = (venta.telefono_cliente || '').replace(/\D/g, '')
    const num = tel.length === 10 ? '52' + tel : tel
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
  }

  const fecha = new Date(venta.fecha)
  const cuandoQuien = [
    fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }),
    fecha.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }),
    venta.vendedor ? `vendió ${venta.vendedor}` : '',
  ].filter(Boolean).join(' · ')
  const equipoNombre = venta.unidad?.equipo || venta.origen?.resumen || 'Venta de refacciones'
  const equipoDetalle = venta.unidad
    ? `${venta.unidad.codigo} · 1 equipo · venta`
    : (venta.origen ? `Cotización ${venta.origen.folio}` : 'mostrador')

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/45 backdrop-blur-[2px] overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-[560px] bg-surface rounded-[22px] border border-edge shadow-[0_30px_70px_rgba(0,0,0,0.28)] overflow-hidden my-auto" onClick={e => e.stopPropagation()}>

        {/* Encabezado */}
        <div className="flex items-start justify-between gap-5 px-6 sm:px-[26px] pt-6 pb-5 border-b border-edge">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[22px] font-bold tracking-[-0.02em] text-ink m-0">Venta #{venta.id}</h2>
              <span className={`text-[12px] font-bold tracking-[0.04em] px-2.5 py-[5px] rounded-full ${cancelada ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'}`}>
                {cancelada ? 'CANCELADA' : 'ACTIVA'}
              </span>
              {factura && (
                <span className={`text-[12px] font-bold tracking-[0.04em] px-2.5 py-[5px] rounded-full ${factura === 'facturada' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
                  {factura === 'facturada' ? 'FACTURADA' : 'POR FACTURAR'}
                </span>
              )}
            </div>
            <div className="text-[13.5px] text-mute mt-1.5">{cuandoQuien}</div>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="w-[34px] h-[34px] shrink-0 rounded-[10px] bg-surface-2 text-mute hover:text-ink hover:bg-edge/60 transition-colors grid place-items-center text-[16px]">
            ×
          </button>
        </div>

        <div className="px-6 sm:px-[26px] pt-[22px]">
          {/* Equipo */}
          <div className="flex items-center gap-3.5 border border-edge rounded-[14px] px-4 py-3.5">
            <div className="w-12 h-12 shrink-0 rounded-[11px]" style={{ background: 'repeating-linear-gradient(135deg, var(--c-surface-2, #f4f4f5) 0 7px, rgba(120,120,130,0.12) 7px 14px)' }} />
            <div className="min-w-0">
              <div className="text-[15.5px] font-bold text-ink truncate">{equipoNombre}</div>
              <div className="text-[13px] text-mute mt-[3px] truncate">{equipoDetalle}</div>
            </div>
          </div>

          {/* Cliente / pago */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-[18px]">
            <div>
              <div className="text-[12.5px] text-mute">Cliente</div>
              <div className="text-[15px] font-semibold text-ink mt-1">{venta.nombre_cliente || venta.empresa || 'Cliente general'}</div>
              {venta.cuenta && <div className="text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">Ligada a {venta.cuenta}</div>}
            </div>
            <div>
              <div className="text-[12.5px] text-mute">Método de pago</div>
              <div className="text-[15px] font-semibold text-ink mt-1 capitalize">{venta.metodo_pago}</div>
            </div>
          </div>

          {/* Totales */}
          <div className="border border-edge rounded-[14px] px-[18px] py-4 mt-[18px]">
            <div className="flex justify-between gap-4 text-sm text-mute">
              <span>Subtotal</span><span className="font-semibold text-ink">{money(venta.subtotal)}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm text-mute mt-2.5">
              <span>IVA 16%</span><span className="font-semibold text-ink">{money(venta.iva)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-edge mt-3.5 pt-3.5">
              <span className="text-[15px] font-bold text-ink">Total cobrado</span>
              <span className="text-[26px] font-extrabold tracking-[-0.025em] text-ink">{money(venta.total)}</span>
            </div>
          </div>

          {/* Vincular a la cuenta del cliente */}
          {!cancelada && !venta.cuenta && (
            <div className="border border-edge rounded-[14px] p-[18px] mt-4 bg-surface-2/60">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold text-ink">Vincular a la cuenta del cliente</div>
                  <div className="text-[13.5px] text-mute leading-relaxed mt-[5px]">Al abrir la liga con su sesión, esta venta aparece en su historial. Un solo uso · caduca en 30 días.</div>
                </div>
                <button onClick={generarLiga} disabled={generando}
                  className={`h-[42px] px-[18px] rounded-[11px] text-sm font-bold whitespace-nowrap transition-colors disabled:opacity-60 ${
                    liga
                      ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 cursor-default'
                      : 'bg-ink text-app hover:opacity-90'
                  }`}>
                  {liga ? '✓ Liga generada' : generando ? 'Generando…' : 'Generar liga'}
                </button>
              </div>

              {liga && (
                <div className="flex items-center gap-2.5 bg-surface border border-edge rounded-[11px] px-3 py-2.5 mt-3.5">
                  <span className="flex-1 min-w-0 text-[13px] text-mute overflow-hidden text-ellipsis whitespace-nowrap">{liga.replace(/^https?:\/\//, '')}</span>
                  <button onClick={copiar}
                    className="h-[34px] px-[13px] shrink-0 rounded-[9px] border border-edge bg-surface text-[13px] font-semibold text-ink hover:bg-surface-2 transition-colors whitespace-nowrap">
                    {copiado ? '✓ Copiada' : 'Copiar'}
                  </button>
                  <a href={waHref()} target="_blank" rel="noopener noreferrer"
                    className="h-[34px] px-[13px] shrink-0 rounded-[9px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[13px] font-bold hover:bg-emerald-500/25 transition-colors whitespace-nowrap inline-flex items-center">
                    WhatsApp
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-between gap-4 px-6 sm:px-[26px] py-5 mt-[22px] border-t border-edge flex-wrap">
          <div className="flex gap-2">
            <button onClick={ordenCarta} disabled={pdf}
              className="h-[44px] px-4 rounded-[12px] border border-edge bg-surface text-[14px] font-semibold text-ink hover:bg-surface-2 transition-colors whitespace-nowrap disabled:opacity-50">
              {pdf ? 'Abriendo…' : '↓ Orden carta (PDF)'}
            </button>
            {!cancelada && !factura && (
              <button onClick={mandarPorFacturar} disabled={mandando}
                className="h-[44px] px-4 rounded-[12px] border border-amber-500/40 bg-amber-500/10 text-[14px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors whitespace-nowrap disabled:opacity-50">
                {mandando ? 'Mandando…' : 'Mandar a Por facturar'}
              </button>
            )}
            {!cancelada && (
              <button onClick={() => setConfirmando(true)}
                className="h-[44px] px-4 rounded-[12px] text-[14px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors whitespace-nowrap">
                Cancelar venta
              </button>
            )}
          </div>
          <button onClick={onClose} className="h-[46px] px-[26px] rounded-[12px] bg-ink text-app text-[15px] font-bold hover:opacity-90 transition-opacity">
            Cerrar
          </button>
        </div>

        {/* Confirmación inline de cancelar (franja, como el diseño) */}
        {confirmando && !cancelada && (
          <div className="border-t border-red-500/30 bg-red-500/10 px-6 sm:px-[26px] py-[18px] flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[14.5px] font-bold text-red-700 dark:text-red-300">¿Cancelar la venta #{venta.id}?</div>
              <div className="text-[13.5px] text-red-600 dark:text-red-400 mt-1">
                {venta.unidad ? 'Se devuelve la unidad al inventario' : 'Se repone el stock'} y el cobro queda sin efecto.
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmando(false)}
                className="h-10 px-4 rounded-[11px] border border-red-500/30 bg-surface text-[13.5px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/5 transition-colors">
                Mejor no
              </button>
              <button onClick={cancelar} disabled={cancelando}
                className="h-10 px-4 rounded-[11px] bg-red-600 text-white text-[13.5px] font-bold hover:bg-red-700 transition-colors whitespace-nowrap disabled:opacity-60">
                {cancelando ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
