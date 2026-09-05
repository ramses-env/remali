import { descargarBlob } from '../../lib/descargar'

/**
 * Un CSV que Excel abre bien en español.
 *
 * Dos detalles que se ven feo si se olvidan y no hay forma de adivinarlos:
 *
 * - **BOM al principio.** Sin él, Excel en Windows lee el archivo como Latin-1
 *   y "Demolición" sale "DemoliciÃ³n". El BOM es lo que le dice que es UTF-8.
 * - **Punto y coma, no coma.** Excel en configuración regional de México usa
 *   `;` como separador de listas; con comas, TODO el renglón cae en la primera
 *   celda y el archivo se ve roto aunque esté bien formado.
 *
 * Se arma en el navegador y no en el servidor a propósito: los datos ya están
 * en la pantalla, así que un viaje de ida y vuelta solo agrega una forma más de
 * fallar.
 */
export function descargarCSV(archivo: string, filas: (string | number | null | undefined)[][]) {
  const celda = (v: string | number | null | undefined) => {
    const t = v === null || v === undefined ? '' : String(v)
    // Las comillas dentro de una celda entrecomillada se escapan duplicándolas.
    return `"${t.replace(/"/g, '""')}"`
  }
  const cuerpo = filas.map(f => f.map(celda).join(';')).join('\r\n')
  descargarBlob(new Blob(['﻿' + cuerpo], { type: 'text/csv;charset=utf-8' }), archivo)
}
