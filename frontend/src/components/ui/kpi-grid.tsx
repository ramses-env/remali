import * as React from 'react'

import { cn } from '@/lib/utils'

export type KpiTone = 'default' | 'muted' | 'success' | 'info' | 'warning' | 'danger' | 'gold'

export type KpiItem = {
  label: string
  value: React.ReactNode
  tone?: KpiTone
  emphasis?: boolean
  helper?: React.ReactNode
}

function toneDot(tone: KpiTone) {
  switch (tone) {
    case 'success': return 'bg-emerald-500'
    case 'info': return 'bg-blue-500'
    case 'warning': return 'bg-amber-500'
    case 'danger': return 'bg-destructive'
    case 'gold': return 'bg-gold'
    case 'muted': return 'bg-mute'
    default: return 'bg-edge'
  }
}

function toneValue(tone: KpiTone) {
  switch (tone) {
    case 'warning': return 'text-amber-500'
    case 'danger': return 'text-destructive'
    case 'gold': return 'text-gold'
    default: return 'text-ink'
  }
}

export function KpiGrid({
  items,
  className,
  gridClassName,
}: {
  items: KpiItem[]
  className?: string
  gridClassName?: string
}) {
  return (
    <dl className={cn('grid gap-2.5', gridClassName || 'grid-cols-2 sm:grid-cols-3', className)}>
      {items.map((k, idx) => {
        const tone = k.tone ?? 'default'
        return (
          <div
            key={`${k.label}-${idx}`}
            className="min-w-0 bg-surface border border-edge rounded-xl px-3.5 py-3.5 sm:px-4 sm:py-4 shadow-[0_1px_3px_rgba(33,29,22,0.04)]"
          >
            <dt className="flex items-center gap-2 mb-2">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', toneDot(tone))} />
              <span className="text-[11px] sm:text-xs font-medium text-mute truncate">{k.label}</span>
            </dt>
            {/* Valor responsive: más chico en móvil para que un monto largo
                ($14,000) NO se recorte en tarjetas angostas. */}
            <dd className={cn('text-xl sm:text-2xl font-extrabold tracking-tight tabular-nums whitespace-nowrap', k.emphasis ? toneValue(tone) : 'text-ink')}>
              {k.value}
            </dd>
            {k.helper ? <div className="mt-1.5 text-[11px] text-mute">{k.helper}</div> : null}
          </div>
        )
      })}
    </dl>
  )
}

