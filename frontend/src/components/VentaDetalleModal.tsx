import { useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../lib/api'
import { confirmar } from './Dialogo'

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
  origen?: { folio: string; resumen: string } | null
}

const money = (n?: string | number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

/** Detalle de una venta (reemplaza el ticket térmico): info + acciones
 *  (cancelar, vincular a una cuenta por liga, y la orden carta en PDF). */
export default function VentaDetalleModal({ venta, onClose, onChanged, notify }: {
  venta: VentaLike
  onClose: () => void
  onChanged: () => void
  notify: (m: string, t?: 'ok' | 'err') => void
}) {
  const [liga, setLiga] = useState('')
  const [generando, setGenerando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [pdf, setPdf] = useState(false)
  const cancelada = venta.estado === 'cancelada'

  const generarLiga = async () => {
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
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      notify('No se pudo copiar; copia el texto manualmente', 'err')
    }
  }

  const cancelar = async () => {
    const ok = await confirmar({
      titulo: 'Cancelar venta',
      mensaje: `¿Cancelar la venta #${venta.id}? Se devuelve la máquina a inventario y se repone el stock de refacciones.`,
      aceptar: 'Cancelar venta',
    })
    if (!ok) return
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
      const url = URL.createObjectURL(r.data as Blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
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

  const fila = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2 border-b border-edge last:border-0">
      <span className="text-mute text-sm">{k}</span>
      <span className="text-ink text-sm font-medium text-right">{v}</span>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-2xl border border-edge shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Encabezado */}
        <div className="px-6 py-4 border-b border-edge flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-ink">Venta #{venta.id}</h3>
            <p className="text-xs text-mute">{new Date(venta.fecha).toLocaleString('es-MX')}</p>
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold uppercase ${cancelada ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-600'}`}>
            {cancelada ? 'Cancelada' : 'Activa'}
          </span>
        </div>

        {/* Información */}
        <div className="px-6 py-4">
          {fila('Cliente', venta.nombre_cliente || venta.empresa || 'Cliente general')}
          {fila('Equipo', venta.unidad ? `${venta.unidad.equipo || '—'} (${venta.unidad.codigo})` : (venta.origen?.resumen || '—'))}
          {venta.origen && fila('Cotización', venta.origen.folio)}
          {fila('Método de pago', <span className="capitalize">{venta.metodo_pago}</span>)}
          {venta.vendedor && fila('Vendedor', venta.vendedor)}
          {venta.cuenta && fila('Cuenta ligada', <span className="text-emerald-600 dark:text-emerald-400">{venta.cuenta}</span>)}
          {venta.subtotal && fila('Subtotal', money(venta.subtotal))}
          {venta.iva && fila('IVA', money(venta.iva))}
          {fila('Total', <span className="text-price font-black text-base">{money(venta.total)}</span>)}
        </div>

        {/* Vincular a una cuenta */}
        {!cancelada && (
          <div className="px-6 pb-4">
            <div className="rounded-xl bg-surface-2 border border-edge p-4">
              <p className="text-sm font-semibold text-ink">Vincular a la cuenta de un cliente</p>
              <p className="text-xs text-mute mt-1">Genera una liga y envíasela. Al abrirla con su sesión, esta venta queda en su historial. Un solo uso · caduca en 30 días.</p>
              {liga ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input readOnly value={liga} onFocus={e => e.currentTarget.select()} className="flex-1 bg-app border border-edge rounded-lg px-3 py-2 text-xs text-ink outline-none" />
                    <button onClick={copiar} className="shrink-0 px-3 py-2 rounded-lg bg-gold text-black text-xs font-bold">{copiado ? '✓' : 'Copiar'}</button>
                  </div>
                  <a href={waHref()} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[#25D366] text-white text-xs font-bold hover:opacity-90 transition-opacity">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.15-1.7-.84-2-.94-.26-.1-.45-.15-.64.15-.19.29-.74.94-.9 1.13-.17.19-.33.22-.62.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.5.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.08-.15-.64-1.55-.88-2.12-.23-.56-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38s1.02 2.76 1.17 2.95c.15.19 2.01 3.07 4.87 4.3.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12 2a10 10 0 00-8.6 15.06L2 22l5.06-1.33A10 10 0 1012 2z"/></svg>
                    Enviar por WhatsApp
                  </a>
                </div>
              ) : (
                <button onClick={generarLiga} disabled={generando} className="mt-3 px-4 py-2 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface transition-colors disabled:opacity-50">
                  {generando ? 'Generando…' : 'Generar liga'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="px-6 py-4 border-t border-edge flex items-center justify-between gap-2 flex-wrap">
          <button onClick={ordenCarta} disabled={pdf} className="text-sm text-mute hover:text-ink font-semibold disabled:opacity-50">
            {pdf ? 'Abriendo…' : 'Orden carta (PDF)'}
          </button>
          <div className="flex items-center gap-2">
            {!cancelada && (
              <button onClick={cancelar} disabled={cancelando} className="px-4 py-2 rounded-full border border-red-500/30 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50">
                {cancelando ? 'Cancelando…' : 'Cancelar venta'}
              </button>
            )}
            <button onClick={onClose} className="px-5 py-2 rounded-full bg-ink text-app text-sm font-bold">Cerrar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
