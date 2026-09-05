/**
 * Las piezas de una HOJA de detalle: la vista de sólo lectura que abre el "Ver"
 * de una tabla del panel, en su propia dirección (`/dashboard/<seccion>/<id>`).
 *
 * Viven aparte de `comun.tsx` porque son de una sola familia de pantallas —el
 * marco, la etiqueta+valor, el hito de historial, las migas— y `comun.tsx` ya
 * carga con los tipos y helpers de TODO el panel.
 *
 * El criterio que las gobierna está en `.interface-design/system.md`:
 * profundidad por BORDES (nada de sombras nuevas), un solo acento dorado, y
 * jerarquía por peso y color antes que por tamaño. De ahí que los títulos de
 * sección vayan callados: un título en 15px negro compite con el dato que
 * envuelve, y aquí el marco no debe verse.
 */
import { type ReactNode } from 'react'
import { fechaLarga } from './hoja-fechas'

/** El panel canónico: borde de baja opacidad y la sombra mínima. */
export function Bloque({ titulo, extra, children, className = '' }: {
  titulo?: string; extra?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)] ${className}`}>
      {titulo && (
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-mute">{titulo}</h2>
          {extra && <span className="text-[11px] font-semibold text-mute shrink-0 tabular-nums">{extra}</span>}
        </div>
      )}
      <div className={titulo ? 'px-5 pb-5' : 'p-5'}>{children}</div>
    </section>
  )
}

/** Etiqueta + valor. Donde se decide la jerarquía: la etiqueta se hunde (11px,
 *  versalitas, gris) y el valor sube (peso 600, tinta). Dos niveles con un solo
 *  tamaño de letra. */
export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-mute">{etiqueta}</p>
      <p className="text-[14px] font-semibold text-ink mt-1 leading-snug">{children}</p>
    </div>
  )
}

/** Un renglón del historial. Un SOLO matiz: dorado lo que ya pasó, gris hueco lo
 *  que falta, rojo sólo lo que salió mal —ahí el color es dato, no adorno—. */
export function Hito({ tono, titulo, cuando, nota, ultimo }: {
  tono: 'hecho' | 'malo' | 'pendiente'; titulo: ReactNode
  cuando?: string | null; nota?: string; ultimo?: boolean
}) {
  const punto = tono === 'malo' ? 'bg-red-500' : tono === 'hecho' ? 'bg-gold' : 'bg-transparent border-2 border-edge'
  return (
    <li className="relative pl-[22px] pb-4 last:pb-0">
      {!ultimo && <span aria-hidden="true" className="absolute left-[4px] top-[15px] bottom-0 w-[1.5px] bg-edge" />}
      <span aria-hidden="true" className={`absolute left-0 top-[5px] w-[10px] h-[10px] rounded-full ${punto}`} />
      <p className={`text-[13px] leading-snug font-semibold ${tono === 'pendiente' ? 'text-mute' : 'text-ink'}`}>{titulo}</p>
      {cuando && <p className="text-[11.5px] text-mute mt-0.5 tabular-nums">{fechaLarga(cuando)}</p>}
      {nota && <p className="text-[11.5px] text-mute mt-0.5 italic">{nota}</p>}
    </li>
  )
}

/** Iniciales del cliente. El padrón no guarda foto, así que la pastilla es el
 *  ancla visual del renglón: lo que deja distinguir de un vistazo dos filas del
 *  mismo cliente en una lista que se recorre con el ojo, no leyendo. El tinte
 *  sale del nombre, así que es el mismo siempre. */
const TINTES_AVATAR = [
  'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/14 text-taller-ink',
  'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  'bg-teal-500/12 text-teal-600 dark:text-teal-400',
]
export function Avatar({ nombre, icono }: { nombre: string; icono?: ReactNode }) {
  const txt = (nombre || '').trim()
  const iniciales = txt.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  let h = 7
  for (const ch of txt) h = (h * 31 + ch.charCodeAt(0)) % 997
  /* `icono` gana cuando la fila NO es de una persona —una máquina propia en el
     taller, por ejemplo—: unas iniciales inventadas ahí mentirían. */
  if (icono) {
    return <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-surface-2 border border-edge text-mute">{icono}</span>
  }
  return (
    <span aria-hidden="true" className={`shrink-0 w-9 h-9 rounded-full grid place-items-center text-[12px] font-bold ${TINTES_AVATAR[h % TINTES_AVATAR.length]}`}>
      {iniciales}
    </span>
  )
}

/** El avance como anillo, para la columna "Estado" de una tabla. La pastilla
 *  dice QUÉ es; el anillo dice CUÁNTO le falta, que es lo que se busca al
 *  barrer la lista con la vista. */
export function AnilloEtapa({ pct, cerrada }: { pct: number; cerrada: boolean }) {
  const C = 2 * Math.PI * 13
  return (
    <span className="relative shrink-0 grid place-items-center w-8 h-8" title={cerrada ? 'Cerrada: no avanza' : `${pct}% del camino`}>
      <svg className="absolute inset-0 w-8 h-8 -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="none" strokeWidth="2.5" stroke="currentColor" className="text-edge" />
        {pct > 0 && (
          <circle cx="16" cy="16" r="13" fill="none" strokeWidth="2.5" strokeLinecap="round"
            stroke={cerrada ? '#B91C1C' : 'var(--c-gold)'} strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
        )}
      </svg>
      <span className="relative text-[10px] font-bold tabular-nums text-ink">{pct}</span>
    </span>
  )
}

/** Los pasos del camino, numerados. Los círculos van CHICOS y sin relleno
 *  blanco: en grande son lo más ruidoso de la pantalla para decir algo que la
 *  pastilla de estado ya dijo. El dorado marca dónde estás, el gris de dónde
 *  vienes, y el borde a dónde falta. */
export function Pasos({ pasos, paso, cerrada }: { pasos: string[]; paso: number; cerrada?: boolean }) {
  return (
    <ol className="flex items-start">
      {pasos.map((etiqueta, i) => {
        const andado = i < paso
        const aqui = i === paso
        return (
          <li key={etiqueta} className="flex-1 min-w-0 flex flex-col items-center relative">
            {i > 0 && (
              <span aria-hidden="true" className={`absolute top-[11px] right-1/2 left-[-50%] h-[2px] ${i <= paso ? (cerrada ? 'bg-red-500/40' : 'bg-gold/60') : 'bg-edge'}`} />
            )}
            <span className={`relative z-[1] w-[23px] h-[23px] rounded-full grid place-items-center text-[10.5px] font-bold border transition-colors ${
              aqui
                ? (cerrada ? 'border-red-500 bg-red-500 text-white' : 'border-gold bg-gold text-black')
                : andado
                  ? (cerrada ? 'border-red-500/40 text-red-500 bg-surface' : 'border-gold/50 text-gold-ink bg-surface')
                  : 'border-edge text-mute bg-surface'
            }`}>{i + 1}</span>
            <span className={`mt-2 text-[11px] text-center leading-tight ${aqui ? 'text-ink font-bold' : 'text-mute font-medium'}`}>{etiqueta}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Las migas de una hoja: 🏠 › Sección › #folio. */
export function Migas({ seccion, etiqueta, folio, onInicio, onSeccion }: {
  seccion: string; etiqueta: string; folio: string; onInicio: () => void; onSeccion: () => void
}) {
  return (
    <nav aria-label="Ruta" className="flex items-center gap-2 text-[13px] font-semibold text-mute" data-seccion={seccion}>
      <button onClick={onInicio} className="hover:text-ink transition-colors" title="Inicio" aria-label="Inicio">
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.7"><path strokeLinecap="round" strokeLinejoin="round" d="M3 11.4L12 4l9 7.4" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.8V19a1.2 1.2 0 0 0 1.2 1.2h10.6A1.2 1.2 0 0 0 18.5 19V9.8" /></svg>
      </button>
      <Flecha />
      <button onClick={onSeccion} className="hover:text-ink transition-colors">{etiqueta}</button>
      <Flecha />
      <span className="text-ink font-bold font-mono truncate">{folio}</span>
    </nav>
  )
}

/** El separador de las migas. Iba en `text-edge`, que en oscuro es
 *  `rgba(255,255,255,0.09)` —el color de un BORDE, no de un glifo— y a ese nivel
 *  la flecha simplemente no estaba: las migas se leían como tres palabras
 *  sueltas. Un separador va más tenue que el texto, no invisible. */
export function Flecha() {
  return <span aria-hidden="true" className="text-mute/70 select-none">›</span>
}

/** Los dos botones del encabezado de una hoja: bajarse el documento y bajarse
 *  los datos. No hay "Volver" —las migas de arriba ya son la salida, y tenerlo
 *  dos veces gastaba el sitio más visible de la pantalla en repetirse. */
export function DocsHoja({ onPDF, onCSV, bajando, pdfRazon }: {
  onPDF: () => void; onCSV: () => void; bajando?: boolean; pdfRazon?: string
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={onPDF} disabled={bajando || Boolean(pdfRazon)} title={pdfRazon}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-gold text-black text-[13.5px] font-bold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100">
        {bajando
          ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}
        Descargar PDF
      </button>
      <button onClick={onCSV}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-edge bg-surface text-[13.5px] font-semibold text-ink hover:bg-surface-2 transition active:scale-[0.98]">
        <svg className="w-4 h-4 text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h3M8 17h5" /></svg>
        Exportar CSV
      </button>
    </div>
  )
}

/** El botón chico de documento (ver la orden / bajar el PDF). */
export const BTN_DOC = 'h-9 px-3 rounded-lg border border-edge text-[12.5px] font-semibold text-ink hover:bg-surface-2 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-1.5'
