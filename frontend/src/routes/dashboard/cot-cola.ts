/* ═══════════════════════════════════════════════════════════════════════════
   LA COLA DE UNA COTIZACIÓN QUE SE ESTÁ CONCRETANDO

   Vive aparte de `comun.tsx` por una razón práctica: aquí no se importa React
   ni la API ni `sessionStorage`, así que estas cuatro funciones se pueden
   ejecutar y comprobar solas. Son las que deciden cuántas máquinas faltan y
   cuál toca, y equivocarse ahí significa dejar un equipo sin salir.
   ═══════════════════════════════════════════════════════════════════════════ */
export type Proposito = 'renta' | 'venta'

/** Una máquina de la cotización, esperando su turno. */
export type PasoCot = {
  modalidad?: 'dia' | 'semana' | 'mes' | null
  duracion?: number | null
  equipo_id?: number | null
  equipo_nombre?: string | null
  /** Solo venta: el precio por máquina que el cliente ya aceptó. */
  precio?: string | number | null
  /** Cuántas máquinas de ese equipo había libres cuando se armó la cola.
   *  `undefined` = no se sabe (partida sin equipo del catálogo). */
  libres?: number
}

export type CotEnCurso = {
  id: number; folio: string | null; cliente: string; telefono: string; direccion: string
  usuario_id: number | null
  /** Qué se va a hacer con la máquina: define filtro, letrero y hoja. */
  proposito: Proposito
  /* ── LA COLA ──────────────────────────────────────────────────────────────
     Una cotización de dos equipos se concretaba a medias: el puente tomaba la
     PRIMERA partida con `.find()` y el segundo equipo quedaba huérfano —había
     que acordarse de él y repetir el viaje a mano—. En venta ni siquiera se
     intentaba: el código avisaba "la primera que se venda cierra la cotización
     y las demás se quedan fuera".

     Ahora viaja la lista completa y en cuál vas. Los campos sueltos de abajo
     siguen existiendo y son SIEMPRE el paso actual: así las hojas de renta y de
     venta no se enteran de que hay una cola detrás. */
  cola?: PasoCot[]
  paso?: number

  /* Los campos del paso ACTUAL, planos. Son los que leen las hojas de renta y
     de venta, que no saben —ni tienen por qué— que hay una cola detrás. */
  modalidad?: 'dia' | 'semana' | 'mes' | null; duracion?: number | null
  equipo_id?: number | null; equipo_nombre?: string | null
  /** Solo venta: el precio por máquina que el cliente ya aceptó. */
  precio?: string | number | null
  /** Unidades libres del equipo de este paso. 0 = no hay ninguna. */
  libres?: number
}

/** El nombre del equipo, sin la coletilla que le pega la cotización
 *  (" · renta por día", " (promo)"). */
export function nombreDePartida(descripcion: string) {
  return descripcion.split(' · ')[0].split(' (promo')[0]
}

/** Las máquinas pendientes de una cotización, una por una.
 *
 *  Expande por `cantidad`: dos revolvedoras en la misma partida son DOS pasos,
 *  porque son dos rentas —una renta lleva una unidad física—. Contar partidas
 *  en vez de máquinas dejaría fuera la segunda revolvedora sin que nadie lo
 *  note, que es el mismo agujero de antes con otra forma. */
export function pasosDeCotizacion(
  items: { descripcion: string; modalidad: string; cantidad?: number; duracion?: number; equipo?: number | null; precio_unitario?: string | number; unidades_libres?: number | null }[],
  proposito: Proposito,
): PasoCot[] {
  const esDeRenta = (m: string) => m === 'dia' || m === 'semana' || m === 'mes'
  const suyas = items.filter(i => (proposito === 'renta' ? esDeRenta(i.modalidad) : i.modalidad === 'venta'))
  const pasos: PasoCot[] = []
  for (const i of suyas) {
    // `cantidad` puede venir en 0 por un dato viejo: se cuenta como una, que es
    // lo que significa una partida escrita en una cotización.
    const piden = Math.max(1, i.cantidad || 1)
    for (let n = 0; n < piden; n++) {
      pasos.push({
        modalidad: esDeRenta(i.modalidad) ? (i.modalidad as 'dia' | 'semana' | 'mes') : null,
        duracion: i.duracion || null,
        equipo_id: i.equipo ?? null,
        equipo_nombre: nombreDePartida(i.descripcion),
        precio: proposito === 'venta' ? (i.precio_unitario ?? null) : null,
        // Se reparten entre las máquinas de la MISMA partida: si el cliente
        // pidió dos revolvedoras y solo hay una libre, la primera sale y la
        // segunda queda marcada como sin unidad. Contarlas todas con el mismo
        // número diría que hay para las dos.
        libres: typeof i.unidades_libres === 'number' ? Math.max(0, i.unidades_libres - n) : undefined,
      })
    }
  }
  /* Los que SÍ hay van primero. Es la diferencia entre poder trabajar y quedarse
     atorado: si el demoledor está todo rentado y era la primera partida, sin
     este orden el admin abre Inventario, no encuentra nada y ahí se acaba el
     recorrido —aunque la revolvedora esté esperando en la bodega—. */
  return pasos.sort((a, b) => Number(a.libres === 0) - Number(b.libres === 0))
}

/** El puente con su paso `n` al frente. Función pura: es la que se prueba. */
export function conPasoActual(base: Omit<CotEnCurso, 'cola' | 'paso' | keyof PasoCot>, cola: PasoCot[], paso: number): CotEnCurso {
  return { ...base, ...(cola[paso] || {}), cola, paso }
}

/** Avanza a la siguiente máquina, o `null` si ya no queda ninguna.
 *
 *  Devolver `null` es lo que apaga el puente: sin eso, terminar la última renta
 *  dejaría el banner encendido y la siguiente unidad que alguien tocara en
 *  Inventario saldría precargada con una cotización ya cerrada. */
export function siguientePaso(v: CotEnCurso | null): CotEnCurso | null {
  if (!v || !v.cola || v.cola.length === 0) return null
  const sig = (v.paso ?? 0) + 1
  if (sig >= v.cola.length) return null
  return { ...v, ...v.cola[sig], paso: sig }
}

/** Cuántas máquinas de la cola no tienen unidad libre. */
export function sinUnidad(v: CotEnCurso | null): number {
  if (!v?.cola) return 0
  return v.cola.filter(p => p.libres === 0).length
}

/** "2 de 3". `null` cuando no hay cola (una sola máquina: no hay nada que contar). */
export function progresoCot(v: CotEnCurso | null): { actual: number; total: number } | null {
  if (!v?.cola || v.cola.length < 2) return null
  return { actual: (v.paso ?? 0) + 1, total: v.cola.length }
}
