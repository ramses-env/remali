import { useEffect, useRef } from 'react'

/* ─────────────────────────────────────────────────────────────
   MODAL: el comportamiento que los 33 overlays del panel no tenían.

   Antes cada flujo escribía su propio `<div className="fixed inset-0">` a mano,
   así que ninguno heredaba nada: 0 de 33 atrapaban el foco, 1 cerraba con Esc,
   0 bloqueaban el scroll de atrás y 1 se anunciaba como diálogo. Al abrir una
   hoja de renta el Tab se iba al contenido de abajo, que seguía siendo
   scrolleable y clicable, y al cerrar el foco caía al <body>.

   Aquí vive una sola vez:
     · role="dialog" + aria-modal + nombre accesible
     · Escape cierra (solo el modal de ARRIBA, ver PILA)
     · el Tab da la vuelta dentro del diálogo
     · foco inicial adentro, y de regreso a quien lo abrió al cerrar
     · scroll del body bloqueado mientras está abierto

   El `className` lo sigue poniendo cada llamada: los z-index y los fondos ya
   estaban afinados por pantalla y no es este el cambio para tocarlos.
───────────────────────────────────────────────────────────── */

const FOCUSABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/* Con modales encimados (p. ej. confirmar dentro de una hoja) Escape debe cerrar
   SOLO el de arriba. Los listeners de `document` no se pueden frenar entre sí con
   stopPropagation, así que llevamos la pila a mano. */
const pila: symbol[] = []

type Props = {
  onClose: () => void
  /** Nombre del diálogo para el lector de pantalla. Ej. "Vender REM-0014". */
  label: string
  /** Clases del overlay. Se pasan tal cual para no mover el diseño de cada pantalla. */
  className: string
  /** false cuando cerrar por accidente cuesta trabajo perdido (formularios largos). */
  cerrarAlTocarFuera?: boolean
  children: React.ReactNode
}

export default function Modal({ onClose, label, className, cerrarAlTocarFuera = true, children }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  // `onClose` suele ser una lambda nueva en cada render; guardarla en un ref deja
  // el efecto con deps vacías, así el foco no se reinicia en cada tecla que escribes.
  const cerrar = useRef(onClose)
  useEffect(() => { cerrar.current = onClose })

  useEffect(() => {
    const yo = Symbol('modal')
    pila.push(yo)
    const abridor = document.activeElement as HTMLElement | null
    const scrollPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Foco inicial. Los efectos del HIJO corren antes que los del padre, así que
    // cuando un formulario trae `autoFocus` su campo YA tiene el foco cuando
    // llegamos aquí: si lo reasignáramos, el cursor saltaría del campo útil al
    // botón de cerrar. Solo movemos el foco si todavía está fuera del diálogo.
    const el = caja.current
    if (el && !el.contains(document.activeElement)) {
      const inicial = el.querySelector<HTMLElement>('[data-foco-inicial]')
        ?? el.querySelector<HTMLElement>(FOCUSABLES)
      if (inicial) inicial.focus()
      else el.focus()
    }

    function onKey(e: KeyboardEvent) {
      if (pila[pila.length - 1] !== yo) return   // hay otro modal encima
      if (e.key === 'Escape') { e.preventDefault(); cerrar.current(); return }
      if (e.key !== 'Tab') return
      const nodos = Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLES) ?? [])
        .filter(n => n.offsetParent !== null || n === document.activeElement)
      if (!nodos.length) return
      const primero = nodos[0], ultimo = nodos[nodos.length - 1]
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      pila.splice(pila.indexOf(yo), 1)
      // Con modales encimados, el de abajo sigue abierto: solo el último devuelve
      // el scroll. `scrollPrevio` ya vale 'hidden' cuando había uno debajo.
      document.body.style.overflow = scrollPrevio
      abridor?.focus?.()
    }
  }, [])

  return (
    <div
      ref={caja}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={className}
      onClick={cerrarAlTocarFuera ? onClose : undefined}
    >
      {children}
    </div>
  )
}
