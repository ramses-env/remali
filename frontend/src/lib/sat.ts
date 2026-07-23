/**
 * Catálogos SAT (México) para facturación CFDI 4.0.
 * Se almacena la CLAVE (ej. '601', 'G03'); la etiqueta es solo para el dropdown.
 * Lista curada con las claves más usadas; se puede ampliar cuando haga falta.
 */
export type SatOption = { code: string; label: string }

export const REGIMEN_FISCAL: SatOption[] = [
  { code: '601', label: '601 · General de Ley Personas Morales' },
  { code: '603', label: '603 · Personas Morales con Fines no Lucrativos' },
  { code: '605', label: '605 · Sueldos y Salarios e Ingresos Asimilados' },
  { code: '606', label: '606 · Arrendamiento' },
  { code: '608', label: '608 · Demás ingresos' },
  { code: '612', label: '612 · Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '614', label: '614 · Ingresos por intereses' },
  { code: '616', label: '616 · Sin obligaciones fiscales' },
  { code: '621', label: '621 · Incorporación Fiscal' },
  { code: '622', label: '622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { code: '625', label: '625 · Actividades Empresariales vía Plataformas Tecnológicas' },
  { code: '626', label: '626 · Régimen Simplificado de Confianza (RESICO)' },
]

export const USO_CFDI: SatOption[] = [
  { code: 'G01', label: 'G01 · Adquisición de mercancías' },
  { code: 'G02', label: 'G02 · Devoluciones, descuentos o bonificaciones' },
  { code: 'G03', label: 'G03 · Gastos en general' },
  { code: 'I01', label: 'I01 · Construcciones' },
  { code: 'I03', label: 'I03 · Equipo de transporte' },
  { code: 'I04', label: 'I04 · Equipo de cómputo y accesorios' },
  { code: 'I08', label: 'I08 · Otra maquinaria y equipo' },
  { code: 'S01', label: 'S01 · Sin efectos fiscales' },
  { code: 'CP01', label: 'CP01 · Pagos' },
]

/** RFC genérico para público en general (SAT). */
export const RFC_PUBLICO_GENERAL = 'XAXX010101000'
