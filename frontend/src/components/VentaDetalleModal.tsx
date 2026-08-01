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
                <div className="mt-3 flex items-center gap-2">
                  <input readOnly value={liga} onFocus={e => e.currentTarget.select()} className="flex-1 bg-app border border-edge rounded-lg px-3 py-2 text-xs text-ink outline-none" />
                  <button onClick={copiar} className="shrink-0 px-3 py-2 rounded-lg bg-gold text-black text-xs font-bold">{copiado ? '✓ Copiada' : 'Copiar'}</button>
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
