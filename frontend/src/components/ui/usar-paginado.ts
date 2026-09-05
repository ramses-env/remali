/* La mitad NO visual de la paginación: el corte de la lista y el salto a la
 * cabecera de la tabla. Vive en su propio archivo porque un `.tsx` que exporta
 * componentes Y otras cosas rompe el recargado en caliente de Vite (y su regla
 * de eslint lo dice). El dibujo está en `paginador.tsx`.
 */
import { useRef, useState, type RefObject } from 'react'

/** Renglones por página. 25 es lo que cabe sin que la tabla se sienta cortada
 *  ni obligue a paginar por todo. */
export const POR_PAGINA = 25

/** Lleva la página al principio de su tabla. Sin esto, pasar de página deja al
 *  usuario mirando el pie de una lista que ya cambió. */
export function subirA(ancla?: RefObject<HTMLElement | null>) {
  const el = ancla?.current
  if (!el) return
  const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  el.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' })
}

/**
 * Paginación en el navegador, para listas que ya se bajaron completas.
 *
 * Recibe el arreglo YA FILTRADO: la página se calcula sobre lo que se está
 * viendo, no sobre el total sin filtrar, o buscar dejaría páginas vacías.
 */
export function usePaginado<T>(items: T[], porPagina = POR_PAGINA, filtros?: unknown) {
  const [pagina, setPagina] = useState(1)
  const ancla = useRef<HTMLDivElement | null>(null)

  /* Al cambiar un FILTRO se vuelve a la primera página. Sin esto, buscar desde
     la página 3 deja al usuario a media lista de resultados nuevos, o mirando
     una tabla vacía. Se compara una firma de los filtros y se corrige en el
     mismo render —el patrón que documenta React para "ajustar estado cuando
     cambia una prop"—, no en un efecto: así no se pinta la página equivocada
     ni siquiera un instante.
     Ojo: son los FILTROS, no la lista. Si se reiniciara al cambiar el número de
     renglones, una orden nueva que llega por el latido te sacaría de la página
     que estás leyendo. */
  const firmaActual = JSON.stringify(filtros ?? null)
  const [firma, setFirma] = useState(firmaActual)
  if (firma !== firmaActual) {
    setFirma(firmaActual)
    setPagina(1)
  }

  const paginas = Math.max(1, Math.ceil(items.length / porPagina))
  // Al filtrar, la página 7 puede dejar de existir. Se ACOTA al vuelo en vez de
  // corregir el estado en un efecto: así nunca se pinta una tabla vacía, ni
  // siquiera un instante, y no hace falta un render de más.
  const pag = Math.min(pagina, paginas)

  const enPantalla = items.slice((pag - 1) * porPagina, pag * porPagina)

  return {
    enPantalla,
    ancla,
    pagina: pag,
    /** Lo que espera `<Paginador>`, listo para esparcir. */
    props: {
      pagina: pag,
      paginas,
      total: items.length,
      porPagina,
      ancla,
      onIr: setPagina,
    },
  }
}
