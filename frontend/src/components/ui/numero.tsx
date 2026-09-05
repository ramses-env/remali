import * as React from 'react'
import NumberFlow from '@number-flow/react'

import { cn, toNumber } from '@/lib/utils'

/* Cifras que se ANIMAN al cambiar (NumberFlow): los dígitos ruedan del valor
   viejo al nuevo en vez de saltar de golpe.

   Para qué sirve, más allá de que se vea bonito: en la caja el total cambia con
   cada escaneo y en el panel los KPIs cambian al mover el periodo. Cuando el
   número salta seco, el ojo no distingue "se actualizó" de "siempre estuvo así";
   el rodado dice qué cambió y hacia dónde se movió sin necesidad de flechitas.

   Sobre accesibilidad: NumberFlow respeta `prefers-reduced-motion` por su
   cuenta (`respectMotionPreference` viene en true), así que a quien pidió menos
   animación en su sistema le aparece el número ya puesto. No hay que hacer nada.

   Los objetos de formato viven FUERA del componente a propósito: si se crean en
   cada render, NumberFlow los ve como formato nuevo y rearma el Intl.NumberFormat
   en cada pasada. */

/** Mismo formato que `formatMoney`: dos decimales SIEMPRE y el "$" pegado al
 *  frente (en negativos queda "$-1,234.56", igual que en cartas y PDF). */
const FORMATO_MONEDA = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const
/** Pesos redondos, como `dinero()` de las gráficas: en un titular los centavos
 *  son ruido. Se pide con <Monto decimales={0} />. */
const FORMATO_MONEDA_0 = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const
const FORMATO_ENTERO = { maximumFractionDigits: 0 } as const

type Base = {
  /** Acepta el string que manda la API ('1200.00') igual que `formatMoney`. */
  valor: number | string | null | undefined
  className?: string
}

/** Importe animado. Cae a $0.00 con null/undefined, como `formatMoney`. */
export function Monto({ valor, className, decimales = 2 }: Base & { decimales?: 0 | 2 }) {
  return (
    <NumberFlow
      value={toNumber(valor) ?? 0}
      locales="en-US"
      format={decimales === 0 ? FORMATO_MONEDA_0 : FORMATO_MONEDA}
      prefix="$"
      className={cn('tabular-nums', className)}
    />
  )
}

/** Conteo animado (unidades, piezas, clientes…). Entero por defecto. */
export function Numero({ valor, className, decimales = 0 }: Base & { decimales?: number }) {
  const formato = React.useMemo(
    () => (decimales > 0 ? { minimumFractionDigits: decimales, maximumFractionDigits: decimales } : FORMATO_ENTERO),
    [decimales],
  )
  return (
    <NumberFlow
      value={toNumber(valor) ?? 0}
      locales="en-US"
      format={formato}
      className={cn('tabular-nums', className)}
    />
  )
}
