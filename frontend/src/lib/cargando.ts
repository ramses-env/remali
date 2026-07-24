import { useEffect, useRef, useState } from 'react'

/**
 * Cuántas peticiones de verdad hay en vuelo.
 *
 * El loader anterior no consultaba nada: era un temporizador de 700 ms en cada
 * cambio de ruta. En una SPA navegar es instantáneo, así que aquello inventaba
 * una espera que no existía y hacía sentir la aplicación más lenta de lo que es.
 * Aquí el contador lo mueven los interceptores de axios, así que lo que se
 * muestra corresponde a algo que realmente está pasando.
 */
let enVuelo = 0
const suscriptores = new Set<(n: number) => void>()

function avisar() {
  suscriptores.forEach(fn => fn(enVuelo))
}

export function empiezaPeticion() {
  enVuelo += 1
  avisar()
}

export function terminaPeticion() {
  // Nunca por debajo de cero: si una respuesta llegara dos veces (reintentos,
  // cancelaciones), un contador negativo dejaría el loader colgado para siempre.
  enVuelo = Math.max(0, enVuelo - 1)
  avisar()
}

export function suscribirCarga(fn: (n: number) => void) {
  suscriptores.add(fn)
  fn(enVuelo)
  // Con llaves: Set.delete devuelve boolean y la limpieza de useEffect exige void.
  return () => {
    suscriptores.delete(fn)
  }
}

/* Debajo de este tiempo NO se muestra nada: para una petición de 150 ms, un
   loader que aparece y desaparece es un parpadeo, y se percibe peor que no
   haber puesto nada. */
const RETRASO_MS = 350

/* Y una vez mostrado, se queda al menos esto. Si no, una petición que tarda
   360 ms encendería el loader por 10 ms: otro parpadeo. */
const MINIMO_MS = 400

/**
 * ¿Hay que mostrar el indicador de carga?
 *
 * Dos reglas, y las dos existen para evitar parpadeos, que es el defecto más
 * común de los indicadores de carga: no aparece hasta que la espera se nota, y
 * una vez que apareció se queda el tiempo suficiente para leerse.
 */
export function useCargando(): boolean {
  const [visible, setVisible] = useState(false)
  const mostradoEn = useRef(0)
  const timerMostrar = useRef<number | undefined>(undefined)
  const timerOcultar = useRef<number | undefined>(undefined)

  useEffect(() => {
    return suscribirCarga(n => {
      if (n > 0) {
        window.clearTimeout(timerOcultar.current)
        if (!timerMostrar.current && !mostradoEn.current) {
          timerMostrar.current = window.setTimeout(() => {
            timerMostrar.current = undefined
            mostradoEn.current = Date.now()
            setVisible(true)
          }, RETRASO_MS)
        }
        return
      }

      // Ya no queda nada en vuelo.
      window.clearTimeout(timerMostrar.current)
      timerMostrar.current = undefined
      if (!mostradoEn.current) {
        setVisible(false)
        return
      }
      const restante = Math.max(0, MINIMO_MS - (Date.now() - mostradoEn.current))
      timerOcultar.current = window.setTimeout(() => {
        mostradoEn.current = 0
        setVisible(false)
      }, restante)
    })
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(timerMostrar.current)
      window.clearTimeout(timerOcultar.current)
    },
    [],
  )

  return visible
}
