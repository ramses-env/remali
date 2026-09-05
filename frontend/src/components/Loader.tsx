import './Loader.css'

/**
 * Loader de pantalla completa (overlay). Lo muestra CargaGlobal cuando hay una
 * petición real en vuelo que ya se está haciendo notar. Los cuadros siguen el
 * acento del tema (dorado/amarillo, negro para el Dueño) vía --c-gold.
 * Spinner base: Uiverse.io (Nawsome).
 */
export default function Loader() {
  return (
    <div className="loader-overlay" role="status" aria-label="Cargando">
      <div className="loadingspinner" aria-hidden="true">
        <div className="sq sq1" />
        <div className="sq sq2" />
        <div className="sq sq3" />
        <div className="sq sq4" />
        <div className="sq sq5" />
      </div>
    </div>
  )
}
