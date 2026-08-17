import { createPortal } from 'react-dom'
import { useCart, esVenta, tipoCotizacion } from '../store/cart'
import { useToast } from '../store/toast'

/* Una cotización es de UN solo tipo (venta O renta). Cuando el cliente intenta
   agregar un equipo del tipo contrario, el reducer lo deja "pendiente" y este
   modal (montado una vez, en la tienda) pregunta si empieza una nueva. */
export default function CambioTipoCotizacion() {
  const { state, dispatch } = useCart()
  const { notify } = useToast()
  const pendiente = state.conflicto
  if (!pendiente) return null

  const tipoActual = tipoCotizacion(state.items) === 'venta' ? 'venta' : 'renta'
  const tipoNuevo = esVenta(pendiente.unit) ? 'venta' : 'renta'
  const n = state.items.length

  return createPortal(
    <div className="modal-in fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => dispatch({ type: 'conflicto-cancelar' })}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-surface border border-edge rounded-2xl p-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gold-ink mb-2">Cotización de {tipoActual}</p>
        <h2 className="text-lg font-extrabold text-ink leading-snug">Las cotizaciones no mezclan venta y renta</h2>
        <p className="text-sm text-mute mt-2">
          Llevas <strong className="text-ink">{n} equipo{n === 1 ? '' : 's'} de {tipoActual}</strong>. Para cotizar
          «{pendiente.title}» ({tipoNuevo}) hay que empezar una cotización nueva; la actual se vaciará.
        </p>
        <div className="mt-5 space-y-2.5">
          <button
            onClick={() => { dispatch({ type: 'conflicto-aceptar' }); notify(`Nueva cotización de ${tipoNuevo} iniciada`) }}
            className="w-full py-3 rounded-full bg-gold text-black text-sm font-bold btn-acento">
            Empezar cotización de {tipoNuevo}
          </button>
          <button
            onClick={() => dispatch({ type: 'conflicto-cancelar' })}
            className="w-full py-2.5 rounded-full border border-edge text-ink text-sm font-semibold hover:bg-surface-2 transition-colors">
            Conservar mi cotización de {tipoActual}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
