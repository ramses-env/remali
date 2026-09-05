import { lazy, Suspense, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useOnboarding } from '../../store/onboarding'
import { elegirTour } from './elegirTour'
import TODOS_TOURS from './tours'

/* react-joyride (+ react-floater) son ~19 KB comprimidos que solo sirven para
   la guía de primer uso: la ve el cliente nuevo una vez en su vida, y nadie más
   —ni el panel, ni quien entra por una liga pública, ni el cliente de siempre—.
   Estaba importado desde App, así que viajaba en el chunk de entrada de TODOS.
   Aquí se decide primero (con las definiciones de los tours, que son datos
   sueltos) si hay guía que correr, y solo entonces se baja la librería. */
const OnboardingTour = lazy(() => import('./OnboardingTour'))

export default function OnboardingGate() {
  const loc = useLocation()
  const { estado, tourActivo } = useOnboarding()
  const { def } = elegirTour(TODOS_TOURS, estado, tourActivo, loc.pathname)

  /* Una vez montado se queda montado. La guía automática marca el onboarding
     como visto EN CUANTO arranca (para que no reaparezca ni al refrescar), así
     que `def` se vuelve null a los pocos milisegundos: si el portero cerrara al
     verlo, la guía moriría en el primer paso. Quien decide cuándo termina es
     OnboardingTour, y ya montado no cuesta nada —sin guía en curso devuelve
     null—. Se ajusta durante el render, no en un efecto, para no pintar dos
     veces. */
  const [montado, setMontado] = useState(false)
  if (def && !montado) setMontado(true)
  if (!montado) return null

  return (
    <Suspense fallback={null}>
      <OnboardingTour tours={TODOS_TOURS} />
    </Suspense>
  )
}
