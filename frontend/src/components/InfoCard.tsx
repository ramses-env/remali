import React from 'react'

type Props = {
  priceFormatted: string
  unitLabel?: string
  headerRight?: React.ReactNode
  stockText?: string
  qty: number
  onQtyChange: (v: number) => void
  onAddToCart: () => void
  onBuyNow: () => void
  locationText?: string
  vendorName?: string
}

export default function InfoCard({
  priceFormatted,
  unitLabel,
  headerRight,
  stockText = 'Stock disponible',
  qty,
  onQtyChange,
  onAddToCart,
  onBuyNow,
  locationText,
  vendorName,
}: Props) {
  return (
    <div className="lg:sticky lg:top-6 rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-3xl sm:text-4xl font-extrabold text-black">{priceFormatted}</p>
          <p className="text-sm text-green-600">12 meses sin intereses desde {(Number(priceFormatted.replace(/[^0-9.]/g, '')) / 12).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-gray-600">IVA incluido</p>
        </div>
        {headerRight}
      </div>
      {unitLabel && <p className="text-xs text-gray-600">Mostrando precio por {unitLabel}</p>}
      {locationText && (
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded-full bg-[#517ea0] text-white text-xs">Envío en {locationText}</span>
        </div>
      )}
      <div className="space-y-2">
        <p className="font-semibold text-black">{stockText}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs sm:text-sm text-gray-700">Cantidad</label>
          <div className="flex items-center gap-2">
            <button onClick={() => onQtyChange(Math.max(1, qty - 1))} className="w-8 h-8 rounded-full border grid place-items-center">-</button>
            <span className="w-10 text-center font-semibold">{qty}</span>
            <button onClick={() => onQtyChange(Math.min(99, qty + 1))} className="w-8 h-8 rounded-full border grid place-items-center">+</button>
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          className="btn-universe-primary w-full sm:flex-1 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
          onClick={onAddToCart}
        >
          Añadir al carrito
        </button>
        <button
          className="btn-universe-black w-full sm:flex-1 focus:outline-none focus:ring-2 focus:ring-[#517ea0]"
          onClick={onBuyNow}
        >
          Comprar ahora
        </button>
      </div>
      {vendorName && (
        <div className="rounded-xl bg-white border p-3">
          <p className="text-sm font-semibold">Vendido por</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#517ea0] text-white grid place-items-center">{String(vendorName || 'R').slice(0, 1).toUpperCase()}</div>
            <div>
              <p className="text-sm font-semibold">{vendorName}</p>
              <p className="text-xs text-gray-600">Compra protegida</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
