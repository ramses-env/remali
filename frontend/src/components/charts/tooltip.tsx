/* El globito de las gráficas.
 *
 * Adaptado del `ClientTooltip` de Rosen Charts (MIT), con tres cambios que
 * importan:
 *
 *  · El original envuelve cada dato en un `<TooltipTrigger>` que renderiza un
 *    `<g>`. Dentro de un `<svg>` está bien; en las gráficas hechas con `div`
 *    —que son la mitad— un `<g>` es un elemento desconocido en HTML y ahí ya
 *    solo funciona de casualidad. Aquí es un HOOK: devuelve los manejadores
 *    para colgarlos de lo que sea, `div` o `path`, y no impone etiqueta.
 *  · El original guarda la POSICIÓN del ratón en estado de React, así que cada
 *    pixel que se mueve el cursor vuelve a renderizar la gráfica entera —treinta
 *    columnas, su rejilla y sus ejes— sesenta veces por segundo. Aquí el estado
 *    solo guarda QUÉ se enseña (cambia una vez por columna); la posición se
 *    escribe directo en el nodo.
 *  · Los colores salen de los tokens del panel (`bg-surface`, `border-edge`),
 *    así el globito se ve igual que el resto en claro y en oscuro. El original
 *    trae `bg-white dark:bg-zinc-900` cableado.
 *
 * Se mantiene lo bueno del original: portal al `body` (para que ningún
 * `overflow-hidden` de una tarjeta lo recorte), volteo cuando se sale por la
 * derecha, y en táctil se abre al tocar y se cierra solo.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function useTooltip() {
  const [contenido, setContenido] = useState<ReactNode>(null)
  const caja = useRef<HTMLDivElement>(null)
  const punto = useRef({ x: 0, y: 0 })
  const cerrarEn = useRef<number | null>(null)

  useEffect(() => () => { if (cerrarEn.current) window.clearTimeout(cerrarEn.current) }, [])

  /** Coloca el globito pegado al cursor, sin pasar por React. */
  const colocar = () => {
    const el = caja.current
    if (!el) return
    const { x, y } = punto.current
    const seSaleDerecha = x + el.offsetWidth + 16 > window.innerWidth
    el.style.left = `${seSaleDerecha ? Math.max(8, x - el.offsetWidth - 12) : x + 12}px`
    el.style.top = `${Math.max(8, y - el.offsetHeight - 12)}px`
  }

  // Antes de pintar, no después: si se colocara en un `useEffect` normal el
  // globito parpadearía una vez en la esquina superior izquierda.
  useLayoutEffect(() => { if (contenido) colocar() }, [contenido])

  /** Manejadores para el elemento que dispara el globito. */
  const disparador = (nodo: ReactNode) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      punto.current = { x: e.clientX, y: e.clientY }
      setContenido(nodo)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      punto.current = { x: e.clientX, y: e.clientY }
      colocar()
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      setContenido(null)
    },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      punto.current = { x: t.clientX, y: t.clientY }
      setContenido(nodo)
      if (cerrarEn.current) window.clearTimeout(cerrarEn.current)
      cerrarEn.current = window.setTimeout(() => setContenido(null), 2500)
    },
  })

  const capa = contenido && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={caja}
        role="tooltip"
        className="fixed left-0 top-0 z-[70] pointer-events-none rounded-xl border border-edge bg-surface px-3.5 py-2.5 shadow-[0_12px_32px_rgba(17,24,39,0.18)]"
      >
        {contenido}
      </div>,
      document.body,
    )
    : null

  return { disparador, capa }
}
