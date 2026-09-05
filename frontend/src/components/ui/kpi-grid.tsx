import * as React from 'react'

import { cn } from '@/lib/utils'
import { Numero } from '@/components/ui/numero'

/* ─────────────────────────────────────────────────────────────────────────────
   LAS CIFRAS DE CABECERA DE CADA SECCIÓN

   Quince pantallas empiezan con esta fila, así que es lo primero que ve el
   cajero al entrar a cualquier lado.

   LA TARJETA SE MIDE A SÍ MISMA. Es la decisión que manda sobre todas las
   demás. La misma pieza aparece en filas de dos, de tres y de cinco: en una
   columna de 750px, cinco tarjetas miden 145px. Un diseño con una sola talla
   —el número a 30px, el ícono a la derecha robándole ancho a la etiqueta—
   revienta ahí: los títulos salen como "POR CO…" y el importe se sale por el
   borde. Por eso las medidas van en `@container` y no en breakpoints de
   pantalla: lo que decide el tamaño del número NO es qué tan grande es el
   monitor, sino cuánto espacio tiene ESTA tarjeta.

   De ahí salen las tres reglas del dibujo:

   1. EL ÍCONO VA A LA IZQUIERDA, pegado a la etiqueta, en el lugar del punto.
      A la derecha le quitaba 40px al título justo donde más falta hacen. Si la
      tarjeta es más angosta que 165px, el ícono desaparece y queda el punto.

   2. LA ETIQUETA NO ES VERSALITA. "Monto vendido (sin cancelar)" en versalitas
      con tracking mide casi el doble; en caja baja cabe. Se le reservan dos
      renglones siempre, aunque ocupe uno: sin esa reserva, "Rentas activas"
      (una línea) sube su número y queda desalineado del vecino de dos.

   3. EL NÚMERO ES EL PUNTO FOCAL, pero de un tamaño que quepa. Va de 20 a 30px
      según el ancho real, con `tabular-nums` para que no baile al actualizarse.

   Y una regla que no es de dibujo sino de honestidad: EL COLOR SOLO ENCIENDE
   CUANDO HAY ALGO. `tone` dice de qué habla la cifra; `emphasis` dice si hoy
   importa. Una tarjeta "Vencidas: 0" en rojo miente. El riel de color, el tinte
   y el número teñido salen únicamente con `emphasis`; sin él queda el punto,
   que ubica sin alarmar.

   El riel de la izquierda es la firma: como la etiqueta de color en el estante
   del taller, se ve desde el mostrador sin leer una palabra.
   ───────────────────────────────────────────────────────────────────────────── */

export type KpiTone = 'default' | 'muted' | 'success' | 'info' | 'warning' | 'danger' | 'gold'

export type KpiItem = {
  label: string
  /** Si es `number` se pinta animado (NumberFlow): los conteos suben o bajan
   *  rodando cuando cambia el periodo o llegan datos nuevos, en vez de saltar.
   *  Para importes pasa <Monto valor={n}/>, que anima igual y ya trae el "$". */
  value: React.ReactNode
  tone?: KpiTone
  emphasis?: boolean
  helper?: React.ReactNode
  /** Trazos de un <svg> 24×24 (como los del menú): `<><path d="…"/></>`. */
  icon?: React.ReactNode
  /** 0..1 — la misma cifra como LONGITUD, para leerla de lejos. Solo tiene
   *  sentido cuando el número es parte de un todo (disponibles / flota). */
  progreso?: number
  /** Convierte la tarjeta en botón: la cifra lleva a donde se resuelve. */
  onClick?: () => void
  /** Texto del title/aria cuando la tarjeta es accionable. */
  accion?: string
}

/** El color del tono en sus DOS roles. Un color que sirve de fondo no siempre
 *  sirve de texto: el dorado sobre blanco da 1.57:1 y no pasa AA, por eso el
 *  sistema ya tenía el par `--c-gold` / `--c-gold-ink`. `marca` pinta el riel,
 *  el tinte y el ícono; `tinta` pinta el número. Para el resto de los tonos son
 *  el mismo valor, y eso está bien: el par existe donde hace falta, no por
 *  simetría. */
function toneVars(tone: KpiTone): { marca: string; tinta: string } | null {
  switch (tone) {
    case 'success': return { marca: 'var(--c-libre)', tinta: 'var(--c-libre)' }
    case 'info': return { marca: 'var(--c-renta)', tinta: 'var(--c-renta)' }
    case 'warning': return { marca: 'var(--c-taller)', tinta: 'var(--c-gold-ink)' }
    case 'danger': return { marca: 'var(--c-vencida)', tinta: 'var(--c-vencida)' }
    case 'gold': return { marca: 'var(--c-gold)', tinta: 'var(--c-gold-ink)' }
    case 'muted': return { marca: 'var(--c-mute)', tinta: 'var(--c-mute)' }
    default: return null
  }
}

function KpiCard({ item }: { item: KpiItem }) {
  const tono = toneVars(item.tone ?? 'default')
  const encendida = !!item.emphasis && !!tono
  const accionable = !!item.onClick

  /* Un cero sin énfasis se atenúa. No es un efecto: en una fila de cinco cifras,
     las que están en cero son justo las que NO hay que mirar, y bajarles el
     contraste deja que el ojo caiga solo en las que tienen algo. */
  const enCero = typeof item.value === 'number' && item.value === 0 && !encendida

  return (
    <div
      style={tono ? ({ '--marca': tono.marca, '--tinta': tono.tinta } as React.CSSProperties) : undefined}
      className={cn(
        '@container group relative min-w-0 overflow-hidden rounded-xl border',
        // El respiro también se mide contra la tarjeta: 18px de aire en una de
        // 145px se comen el ancho que necesita el importe.
        'px-3.5 @min-[205px]:px-4 py-[13px] shadow-[0_1px_3px_rgba(33,29,22,0.04)]',
        'transition-[border-color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        encendida
          // Borde, riel y fondo salen del MISMO color: un solo dato, imposible
          // que se desincronicen.
          ? 'border-[color-mix(in_oklab,var(--marca)_34%,transparent)] bg-[color-mix(in_oklab,var(--marca)_6%,var(--c-surface))]'
          : 'border-edge bg-surface',
        accionable && 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold/40 hover:-translate-y-[1px] hover:shadow-[0_4px_14px_-6px_rgba(33,29,22,0.16)] active:translate-y-0 motion-reduce:hover:translate-y-0',
        accionable && !encendida && 'hover:border-[color-mix(in_oklab,var(--c-ink)_22%,var(--c-border))]',
      )}
    >
      {/* Toda la tarjeta es el botón (patrón "stretched link"): así el <dl>
          conserva sus pares dt/dd —que es lo que lee un lector de pantalla— y
          el área táctil sigue siendo la tarjeta entera, no un textito. */}
      {accionable && (
        <button
          type="button"
          onClick={item.onClick}
          title={item.accion}
          className="absolute inset-0 z-10 w-full h-full cursor-pointer focus:outline-none"
        >
          <span className="sr-only">{item.accion || `Ver ${item.label}`}</span>
        </button>
      )}

      {/* Riel: la etiqueta de color del estante. Solo cuando hay algo que ver. */}
      {encendida && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-[var(--marca)]" />}

      {/* Etiqueta. `min-h` reserva DOS renglones aunque ocupe uno, para que los
          números de tarjetas vecinas caigan en la misma línea. 2.6em = dos
          renglones exactos a leading-[1.3]. */}
      <dt className="flex items-start gap-2 min-h-[2.6em]">
        {item.icon ? (
          <>
            {/* Bajo ~165px de tarjeta el ícono estorba más de lo que ayuda: se
                va y deja el punto, que ocupa 7px y dice lo mismo del tono. */}
            <span
              aria-hidden="true"
              className={cn(
                'hidden @min-[165px]:grid shrink-0 w-[26px] h-[26px] rounded-[8px] place-items-center border mt-[-1px]',
                encendida
                  ? 'border-transparent bg-[color-mix(in_oklab,var(--marca)_14%,transparent)] text-[var(--marca)]'
                  : 'border-edge bg-surface-2 text-mute',
              )}
            >
              <svg className="w-[14px] h-[14px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
            </span>
            <span aria-hidden="true" className={cn('@min-[165px]:hidden w-[7px] h-[7px] rounded-full shrink-0 mt-[5px]', !tono && 'bg-edge')} style={tono ? { background: tono.marca, opacity: encendida ? 1 : 0.55 } : undefined} />
          </>
        ) : (
          <span aria-hidden="true" className={cn('w-[7px] h-[7px] rounded-full shrink-0 mt-[5px]', !tono && 'bg-edge')} style={tono ? { background: tono.marca, opacity: encendida ? 1 : 0.55 } : undefined} />
        )}
        <span className="min-w-0 text-[11.5px] font-semibold leading-[1.3] text-mute line-clamp-2 text-pretty">{item.label}</span>
      </dt>

      {/* La cifra. Crece con la tarjeta, no con la pantalla: en una fila de
          cinco cabe a 20px y en una de dos se estira a 30. */}
      <dd
        className={cn(
          'mt-1.5 leading-none font-extrabold tracking-[-0.025em] tabular-nums whitespace-nowrap',
          // Los cortes salen de la cuenta real: un importe de 7 cifras con
          // separadores mide ~5.4em, y con centavos ~6.9em. Cada escalón es el
          // tamaño más grande con el que ESE caso todavía deja aire al borde.
          'text-[20px] @min-[158px]:text-[23px] @min-[215px]:text-[26px]',
          encendida ? 'text-[var(--tinta)]' : enCero ? 'text-ink/40' : 'text-ink',
        )}
      >
        {typeof item.value === 'number' ? <Numero valor={item.value} /> : item.value}
      </dd>

      {/* La misma cifra como longitud: se lee de lejos, sin números. */}
      {typeof item.progreso === 'number' && (
        <div aria-hidden="true" className="mt-2.5 h-[3px] rounded-full bg-surface-2 overflow-hidden">
          <span
            className="block h-full rounded-full origin-left barra-crece"
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, item.progreso)) * 100)}%`,
              background: tono?.marca ?? 'var(--c-ink)',
              opacity: encendida ? 1 : 0.45,
            }}
          />
        </div>
      )}

      {item.helper ? (
        <div className="mt-1.5 text-[11px] leading-[1.35] text-mute truncate" title={typeof item.helper === 'string' ? item.helper : undefined}>{item.helper}</div>
      ) : null}

      {/* La flecha aparece al pasar: dice "esto lleva a algún lado" sin ocupar
          sitio cuando nadie está mirando esta tarjeta. Solo donde hay margen
          para ella; en una tarjeta angosta se encimaría con el texto. */}
      {accionable && (
        <span aria-hidden="true" className="hidden @min-[205px]:block absolute right-3.5 bottom-3.5 text-mute opacity-0 -translate-x-1 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:transition-none">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </span>
      )}
    </div>
  )
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
    <dl
      className={cn('grid gap-2.5', gridClassName, className)}
      /* LAS COLUMNAS TIENEN TOPE Y LA FILA NO SE PARTE.

         Antes era `grid-cols-3` a secas: con tres cifras en un monitor de
         1600px salían tres tarjetas de 430px, con el número perdido en una
         pradera. Una cifra no necesita medio metro para leerse; necesita 250 y
         el resto es aire que hace ver el panel desordenado.

         Dos reglas resuelven todos los casos, de dos tarjetas a cinco:

         · `max-width` = lo que miden N tarjetas de 250 con sus separaciones.
           Es lo que impide que dos KPIs se estiren a lo ancho de la pantalla.
         · `auto-fit` con `1fr` reparte ESE ancho entre las que hay. Se usa
           auto-FIT y no auto-fill a propósito: `auto-fill` deja creadas las
           columnas que sobran, y entonces cinco tarjetas en una columna
           angosta o se encogen a 129px con cuatro fantasmas al lado, o peor,
           la quinta se cae sola a un segundo renglón. `auto-fit` colapsa lo
           vacío y reparte entre las que existen.

         El piso de 128px es el que deja pasar cinco tarjetas en la columna del
         Resumen (750px) y dos en un teléfono de 360. Va en `style` porque
         `minmax(min(100%,128px), 1fr)` no tiene utilidad equivalente. */
      style={gridClassName ? undefined : {
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 128px), 1fr))',
        maxWidth: items.length * 250 + (items.length - 1) * 10,
      }}
    >
      {items.map((k, idx) => <KpiCard key={`${k.label}-${idx}`} item={k} />)}
    </dl>
  )
}
