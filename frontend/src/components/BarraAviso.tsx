import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConfigPublica } from '../lib/configPublica'

/**
 * El listón de arriba de la tienda: temporada, promoción, un cambio de horario.
 *
 * Lo enciende y lo escribe el admin en Configuración › Tienda. Llega ya resuelto
 * del backend —si está apagado o su fecha pasó, no viene—, así que aquí no se
 * decide nada sobre si mostrarlo: solo si ESTE visitante ya lo cerró.
 *
 * Tres detalles que separan una barra de aviso buena de una molesta:
 *
 * · **Se cierra, y se queda cerrada.** Una barra que reaparece en cada página
 *   deja de leerse y empieza a estorbar.
 * · **Pero un aviso NUEVO sí vuelve a salir.** Lo cerrado se recuerda por la
 *   huella del CONTENIDO, no por "ya cerró la barra alguna vez": si en
 *   diciembre cambia el texto, cambia la huella y la barra reaparece. Guardar
 *   un simple `cerrada=true` habría dejado ciego para siempre a quien cerró el
 *   aviso de agosto, que es el error clásico de este componente.
 * · **No empuja la página.** Se revela con opacidad, no con altura: si creciera
 *   desde cero, el contenido daría un brinco justo cuando alguien ya estaba
 *   leyendo o a punto de tocar algo.
 *
 * Sobre el encaje con la navegación: el Navbar es `fixed top-0`, así que una
 * barra puesta simplemente antes en el DOM le queda DEBAJO —invisible y con los
 * clics interceptados—. Por eso esta también se fija, por encima, y publica su
 * alto real en `--alto-aviso`; el Navbar baja esa distancia y la tienda se
 * recorre otro tanto. Se MIDE en vez de fijarse un número porque en un teléfono
 * el texto se parte en dos renglones y la barra crece.
 */
const CLAVE = 'remali_aviso_cerrado'

export default function BarraAviso() {
  const { aviso } = useConfigPublica()
  const [cerradoId, setCerradoId] = useState<string | null>(() => {
    try { return localStorage.getItem(CLAVE) } catch { return null }
  })

  /* La config llega por red, así que el aviso aparece un instante después de
     pintar la página. Se marca "listo" en el primer frame que ya lo tiene para
     poder revelarlo con una transición en vez de un parpadeo seco. */
  const [listo, setListo] = useState(false)
  useEffect(() => {
    if (!aviso) return
    const t = requestAnimationFrame(() => setListo(true))
    return () => cancelAnimationFrame(t)
  }, [aviso])

  /* El alto real viaja en una variable CSS para que el Navbar (fijo) y el
     contenido sepan cuánto bajar. Se recalcula al cambiar de tamaño: girar el
     teléfono puede pasar el texto de dos renglones a uno. */
  const ref = useRef<HTMLDivElement>(null)
  const visible = Boolean(aviso) && cerradoId !== aviso?.id
  useLayoutEffect(() => {
    const raiz = document.documentElement
    if (!visible || !ref.current) {
      raiz.style.removeProperty('--alto-aviso')
      return
    }
    const el = ref.current
    const medir = () => raiz.style.setProperty('--alto-aviso', `${el.offsetHeight}px`)
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => { obs.disconnect(); raiz.style.removeProperty('--alto-aviso') }
  }, [visible, aviso?.id])

  if (!aviso || !visible) return null

  const cerrar = () => {
    setCerradoId(aviso.id)
    try { localStorage.setItem(CLAVE, aviso.id) } catch { /* modo privado: vuelve a salir, y está bien */ }
  }

  const contenido = (
    <>
      <span className="min-w-0 flex-1 text-center leading-snug">{aviso.texto}</span>
      {aviso.liga && (
        <span className="shrink-0 font-black underline underline-offset-2 whitespace-nowrap">
          {aviso.liga_texto}
        </span>
      )}
    </>
  )

  /* Una liga interna va con <Link> (sin recargar la SPA) y una externa con <a>.
     Distinguirlas por el prefijo y no por una bandera nueva: quien escribe el
     aviso ya dice a dónde va cuando teclea la dirección. */
  const externa = /^https?:\/\//i.test(aviso.liga)
  const clasesLiga = 'flex items-center justify-center gap-2 px-4 py-3 transition-opacity hover:opacity-80'

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Aviso de REMALI"
      /* z-[60] para quedar sobre el Navbar (z-50), que es fijo.
         `transition-opacity` y no de altura: animar el alto empuja el contenido
         de abajo durante toda la animación. Ver la nota de arriba. */
      className={`fixed top-0 left-0 right-0 z-[60] bg-gold text-gold-on text-[13.5px] font-bold transition-opacity duration-300 ${listo ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="contenedor">
        {aviso.liga ? (
          externa ? (
            <a href={aviso.liga} target="_blank" rel="noopener noreferrer" className={`${clasesLiga} pr-12`}>
              {contenido}
            </a>
          ) : (
            <Link to={aviso.liga} className={`${clasesLiga} pr-12`}>{contenido}</Link>
          )
        ) : (
          <div className="flex items-center justify-center gap-2 px-4 py-3 pr-12">{contenido}</div>
        )}
      </div>

      {/* 44×44 reales aunque el aspa se vea de 16px: por debajo de eso se falla
          el toque en un teléfono y la gente acaba picando la liga sin querer. */}
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar aviso"
        className="absolute right-0 top-0 grid h-full w-11 place-items-center transition-opacity hover:opacity-70 active:scale-95"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
