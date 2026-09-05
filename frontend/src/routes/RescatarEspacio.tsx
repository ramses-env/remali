import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { rescatarDeLaUrl } from '../lib/espacio'

/* La liga /mis-borradores/<token>: recupera el taller del cliente SIN cuenta en
   otro dispositivo. Lo primero que hace es sacar el token de la barra de
   direcciones — un secreto ahí se filtra por historial, logs y el Referer de
   cualquier recurso externo que cargue la página. */
export default function RescatarEspacio() {
  const { token } = useParams()
  const nav = useNavigate()

  useEffect(() => {
    if (token) rescatarDeLaUrl(token)
    nav('/mis-cotizaciones?tab=borradores', { replace: true })
  }, [token, nav])

  return (
    <div className="min-h-[60vh] grid place-items-center px-4">
      <div className="flex flex-col items-center gap-4">
        <span className="w-8 h-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
        <p className="text-mute text-sm">Recuperando tus borradores…</p>
      </div>
    </div>
  )
}
