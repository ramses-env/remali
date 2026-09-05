import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/* Al cambiar de página, de vuelta al encabezado.
   Una SPA no recarga nada: conserva la posición del scroll anterior, así que si
   ibas a media página la ruta nueva abría también a media página.

   Tres detalles son los que hacen que funcione SIEMPRE, no "en algunas páginas":
   - No todo el scroll es el de la ventana. El panel admin scrollea dentro de su
     <main> (la ventana ahí no se mueve nunca), y a ese `window.scrollTo` no le
     hacía ni cosquillas. Cualquier contenedor marcado con [data-scroll-top]
     también se sube.
   - Instantáneo, no `smooth`: el CSS anima el scroll de todo el sitio, y con
     rutas lazy la caída se cancelaba a medio camino cuando llegaba el contenido.
   - Segunda pasada al pintar: las rutas lazy montan un frame después y el
     navegador recoloca el scroll cuando la página crece de golpe. */
export default function ScrollAlTope() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    // Un ancla (#seccion) manda: quien pidió un punto de la página va a ese punto.
    if (hash) return
    const alTope = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      document.querySelectorAll<HTMLElement>('[data-scroll-top]').forEach(el => {
        el.scrollTop = 0
        el.scrollLeft = 0
      })
    }
    alTope()
    const id = requestAnimationFrame(alTope)
    return () => cancelAnimationFrame(id)
  }, [pathname, hash])
  return null
}

/** Sube al tope cuando una pantalla se transforma SIN cambiar de ruta.
 *
 *  `ScrollAlTope` mira el pathname, así que no se entera de esto: enviar una
 *  cotización, autorizarla o rechazarla dejan la misma dirección y cambian todo
 *  el contenido debajo de ti. El botón de enviar vive hasta abajo, así que la
 *  confirmación nacía arriba, fuera de la pantalla, y quedabas viendo el pie de
 *  página — como si no hubiera pasado nada.
 *
 *  Aquí el scroll SÍ va suave (a diferencia del cambio de ruta, que es
 *  instantáneo): la página no se reemplazó, se transformó, y ver el viaje es lo
 *  que explica que te movieron. Con movimiento reducido va directo. */
export function useIrAlTope(activo: boolean) {
  useEffect(() => {
    if (!activo) return
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const modo: ScrollBehavior = quieto ? 'auto' : 'smooth'
    window.scrollTo({ top: 0, left: 0, behavior: modo })
    document.querySelectorAll<HTMLElement>('[data-scroll-top]').forEach(el => {
      el.scrollTo({ top: 0, behavior: modo })
    })
  }, [activo])
}
