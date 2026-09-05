import { useCallback, useEffect, useSyncExternalStore } from 'react'
import api from './api'
import { alInvalidar, temaDeRuta } from './realtime'

/**
 * Caché de lecturas: pinta lo que ya se sabe y refresca por debajo.
 *
 * El problema que resuelve
 * ───────────────────────
 * Cada `useEffect` de cada pantalla pedía sus datos otra vez, siempre. Entrar a
 * un equipo y volver al catálogo repetía `/equipos/`, `/marcas/`, `/categorias/`
 * y `/tipos/` como si fuera la primera visita; abrir y cerrar el cajón de
 * filtros repetía los tres catálogos en cada apertura. La aplicación hacía el
 * trabajo correcto y tiraba el resultado al salir de la pantalla.
 *
 * El único sitio que ya cacheaba era `lib/configPublica.ts` (caché de módulo +
 * `inflight` para no pedir dos veces lo mismo a la vez), y no por casualidad es
 * el dato que nunca se siente lento. Esto es ese mismo patrón, generalizado.
 *
 * Cómo se comporta
 * ────────────────
 * - **Instantáneo si ya se sabe.** Si hay algo en caché se pinta en el primer
 *   render, sin `cargando`. Volver atrás no parpadea.
 * - **Se refresca solo.** Pasado `frescoMs` el dato se considera viejo: se
 *   sigue pintando, pero se pide de nuevo por debajo y se actualiza al llegar.
 *   El usuario nunca se queda mirando un hueco por un dato que ya tenía.
 * - **Una sola petición.** Tres componentes que pidan la misma URL a la vez
 *   comparten la promesa (es lo que arregla el sidebar montado por duplicado).
 * - **Se tira sola cuando cambia algo.** Va colgada del bus de `realtime.ts`:
 *   si una mutación invalida "catalogos", toda URL cacheada de ese tema se cae.
 *   No hay que acordarse de invalidar a mano.
 *
 * Por qué la caché es un *store* y no estado de React
 * ──────────────────────────────────────────────────
 * El dato vive fuera del componente —lo comparten pantallas que ni se conocen—
 * así que la fuente de verdad es este módulo y los componentes solo lo miran con
 * `useSyncExternalStore`. Copiarlo a `useState` y sincronizarlo con efectos era
 * la otra opción, y es la que obliga a llamar `setState` dentro de un efecto en
 * cada montaje: renders encadenados y dos copias del mismo dato que pueden
 * discrepar. Así el primer render ya sale con lo que hay en memoria.
 *
 * Lo que NO es: no sustituye a `useRecurso` en el panel, donde cada módulo ya
 * maneja su propia lista. Esto es para lecturas que se repiten entre pantallas.
 */

type Entrada = {
  valor?: unknown
  /** Cuándo se guardó el valor (para saber si ya está viejo). */
  en: number
  /** Primera carga: no hay NADA que pintar todavía. */
  cargando: boolean
  /** Hay algo en pantalla y se está refrescando por debajo. */
  refrescando: boolean
  error: unknown
}

/* Referencia estable y compartida: `useSyncExternalStore` compara el resultado
   de `getSnapshot()` por identidad, así que devolver un objeto nuevo para una
   URL sin entrada metería a React en un bucle de renders. */
const VACIA: Entrada = { valor: undefined, en: 0, cargando: false, refrescando: false, error: null }

const cache = new Map<string, Entrada>()
const enVuelo = new Map<string, Promise<unknown>>()
const oyentes = new Map<string, Set<() => void>>()

/** Cuánto dura un dato antes de considerarse viejo. */
export const FRESCO_CORTO = 30_000       // listas que se mueven (catálogo)
export const FRESCO_LARGO = 10 * 60_000  // marcas, categorías, tipos

function leer(url: string): Entrada {
  return cache.get(url) ?? VACIA
}

function avisar(url: string) {
  for (const fn of oyentes.get(url) || []) {
    try { fn() } catch { /* un oyente roto no debe frenar a los demás */ }
  }
}

/** Escribe una entrada NUEVA (nunca se muta la anterior) y avisa a quien mire. */
function fijar(url: string, parcial: Partial<Entrada>) {
  cache.set(url, { ...leer(url), ...parcial })
  avisar(url)
}

function suscribirUrl(url: string, fn: () => void): () => void {
  if (!oyentes.has(url)) oyentes.set(url, new Set())
  oyentes.get(url)!.add(fn)
  return () => {
    const set = oyentes.get(url)
    set?.delete(fn)
    if (set && set.size === 0) oyentes.delete(url)
  }
}

/**
 * Pide una URL aprovechando la caché. Sin React, para quien la necesite fuera
 * de un componente.
 *
 * `forzar` salta la caché pero NO la deduplicación: si ya hay una petición en
 * vuelo para esa URL, se engancha a ella en vez de abrir otra.
 */
export function pedirDatos<T>(url: string, forzar = false): Promise<T> {
  const yaVa = enVuelo.get(url)
  if (yaVa) return yaVa as Promise<T>

  const hit = cache.get(url)
  const tieneAlgo = hit?.valor !== undefined
  if (!forzar && tieneAlgo) return Promise.resolve(hit!.valor as T)

  // Con algo ya en pantalla esto es un refresco (se atenúa); sin nada, es la
  // primera carga (se enseña el esqueleto). Son esperas distintas y la pantalla
  // las pinta distinto.
  fijar(url, tieneAlgo ? { refrescando: true } : { cargando: true })

  const promesa = api
    .get<T>(url)
    .then(r => {
      fijar(url, { valor: r.data, en: Date.now(), error: null, cargando: false, refrescando: false })
      return r.data
    })
    .catch(err => {
      // Con datos viejos en pantalla el fallo NO los borra: algo cierto de hace
      // un minuto sirve más que un hueco. El aviso de red ya lo dio el
      // interceptor de api.ts, así que aquí no se avisa dos veces.
      fijar(url, { error: err, cargando: false, refrescando: false })
      throw err
    })
    .finally(() => { enVuelo.delete(url) })

  enVuelo.set(url, promesa)
  return promesa
}

/** Lo que ya está en memoria, sin tocar la red. */
export function datosEnCache<T>(url: string): T | undefined {
  return cache.get(url)?.valor as T | undefined
}

/** Tira lo cacheado. Sin argumento, todo (se usa al cerrar sesión). */
export function olvidarDatos(coincide?: (url: string) => boolean) {
  for (const url of Array.from(cache.keys())) {
    if (coincide && !coincide(url)) continue
    cache.delete(url)
    // Se avisa DESPUÉS de borrar: quien esté mirando vuelve a leer y encuentra
    // la entrada vacía, que es justo lo que dispara su recarga.
    avisar(url)
  }
}

/**
 * Marca lo cacheado como viejo SIN borrarlo: el valor se sigue pintando y la
 * próxima mirada lo vuelve a pedir.
 *
 * La diferencia con `olvidarDatos` es lo que ve el usuario. Borrar la entrada
 * deja a la pantalla sin nada que enseñar por el rato que tarda la respuesta:
 * la lista desaparece y vuelve, que es exactamente el parpadeo que todo esto
 * intenta quitar. Caducarla la deja en pantalla, atenuada, hasta que llega el
 * dato nuevo. Borrar de verdad se reserva para cerrar sesión, donde el dato
 * viejo es de OTRA persona y no puede seguir a la vista.
 */
export function expirarDatos(coincide?: (url: string) => boolean) {
  for (const url of Array.from(cache.keys())) {
    if (coincide && !coincide(url)) continue
    fijar(url, { en: 0 })
  }
}

/* Una mutación en cualquier parte caduca lo que quedó viejo. El tema se deduce
   de la URL cacheada con el mismo `temaDeRuta` que usa el bus, así que la tabla
   de arrastres de `realtime.ts` (vender baja stock, mover un catálogo toca
   equipos) vale igual aquí sin repetirla. */
alInvalidar(temas => {
  const afectados = new Set(temas)
  expirarDatos(url => {
    const t = temaDeRuta(url)
    return t !== null && afectados.has(t)
  })
})

type Opciones = {
  /** Cuánto vale el dato antes de refrescarlo por debajo. */
  frescoMs?: number
  /** En falso ni pide ni se suscribe (sección cerrada, sin sesión…). */
  activo?: boolean
}

type Resultado<T> = {
  datos: T | undefined
  /** Solo la PRIMERA vez, cuando no hay nada que pintar. Un refresco no lo enciende. */
  cargando: boolean
  /** Hay datos en pantalla y se están refrescando por debajo. Para atenuar, no para tapar. */
  refrescando: boolean
  error: unknown
  recargar: () => void
}

/**
 * Lectura cacheada dentro de un componente.
 *
 * `cargando` y `refrescando` separan las dos esperas que antes se confundían en
 * una: no tener NADA que enseñar (esqueleto) y tener algo viejo mientras llega
 * lo nuevo (atenuar la lista sin borrarla). Vaciar una lista que se está
 * recargando es lo que hace que una pantalla parezca romperse cada vez que se
 * toca un filtro.
 */
export function useDatos<T>(url: string | null, opciones: Opciones = {}): Resultado<T> {
  const { frescoMs = FRESCO_CORTO, activo = true } = opciones

  const suscribir = useCallback(
    (cb: () => void) => (url ? suscribirUrl(url, cb) : () => {}),
    [url],
  )
  const instantanea = useCallback(() => (url ? leer(url) : VACIA), [url])

  // El tercer argumento es la instantánea del servidor: sin SSR es la misma.
  const entrada = useSyncExternalStore(suscribir, instantanea, instantanea)

  // Sale a la red solo si hace falta: sin dato, o con uno ya vencido.
  useEffect(() => {
    if (!url || !activo) return
    const hit = cache.get(url)
    if (hit && hit.valor !== undefined && Date.now() - hit.en < frescoMs) return
    pedirDatos<T>(url, true).catch(() => { /* el fallo ya quedó en la entrada */ })
  }, [url, activo, frescoMs])

  /* Cuando el bus invalida el tema de esta URL, se vuelve a pedir. Solo lo hace
     la pantalla montada y activa: la caché ya se vació sola, y sin esto la
     pantalla abierta se quedaría con lo viejo hasta el próximo montaje. */
  useEffect(() => {
    if (!url || !activo) return
    return alInvalidar(temas => {
      const t = temaDeRuta(url)
      if (t && temas.includes(t)) {
        pedirDatos<T>(url, true).catch(() => { /* el fallo ya quedó en la entrada */ })
      }
    })
  }, [url, activo])

  const recargar = useCallback(() => {
    if (!url) return
    // `forzar` ya salta la caché; no hace falta borrar la entrada, y borrarla
    // vaciaría la pantalla justo cuando el usuario pidió refrescarla.
    pedirDatos<T>(url, true).catch(() => { /* el fallo ya quedó en la entrada */ })
  }, [url])

  return {
    datos: entrada.valor as T | undefined,
    cargando: entrada.cargando,
    refrescando: entrada.refrescando,
    error: entrada.error,
    recargar,
  }
}
