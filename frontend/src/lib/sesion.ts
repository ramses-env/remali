import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { consultarYo, destinoTrasEntrar, recordarAcceso } from './acceso'
import { useAuth } from '../store/auth'

/**
 * Con sesión abierta, las pantallas de acceso no se pintan: mandan a cada quien
 * a su lugar.
 *
 * Vive aquí y no copiado en login y registro porque es la misma regla, y dos
 * copias de una regla de acceso terminan divergiendo (ya pasó con "quién entra
 * al panel", ver acceso.ts).
 *
 * Devuelve `true` mientras comprueba: quien lo use debe pintar un estado de
 * espera, no el formulario, o se vería un parpadeo antes del redirect.
 */
/**
 * Qué hacer justo después de quedar autenticado, venga de donde venga la sesión
 * (contraseña, Google o un alta recién hecha).
 *
 * Carga el perfil ANTES de navegar para que el panel abra ya con el acento y la
 * sección del rol correcto, sin pasar por los de la cuenta anterior.
 */
export function useIrTrasEntrar(next: string) {
  const nav = useNavigate()
  return async function irTrasEntrar() {
    try {
      const yo = await consultarYo()
      recordarAcceso(yo)
      nav(destinoTrasEntrar(yo, next), { replace: true })
    } catch {
      // La sesión existe pero el perfil no cargó: mejor entrar a un lugar seguro
      // que dejar al usuario mirando el formulario que acaba de completar.
      nav(next || '/', { replace: true })
    }
  }
}

export function useRedirigirSiHaySesion(next: string): boolean {
  const { token, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  // Las pantallas que vienen de una liga del correo DEBEN funcionar aunque haya
  // sesión abierta:
  //  · restablecer: el caso típico es que alguien olvidó la clave pero seguía
  //    logueado en otra pestaña; si redirigiéramos al panel, jamás vería el
  //    formulario del enlace.
  //  · verificar: la liga trae su propia sesión y manda sobre la del navegador
  //    (puede ser de otra cuenta); rebotar al panel dejaría el correo sin
  //    confirmar para siempre.
  const esLigaDeCorreo =
    loc.pathname.startsWith('/restablecer') || loc.pathname.startsWith('/verificar')
  const [verificando, setVerificando] = useState(() => !esLigaDeCorreo && Boolean(token))

  useEffect(() => {
    if (esLigaDeCorreo || !token) return
    let vivo = true
    consultarYo()
      .then(yo => {
        if (!vivo) return
        recordarAcceso(yo)
        nav(destinoTrasEntrar(yo, next), { replace: true })
      })
      .catch(() => {
        // Token vencido o cuenta desactivada: se limpia y se muestra el formulario,
        // en vez de dejar al usuario atorado en una pantalla que no avanza.
        if (!vivo) return
        logout()
        setVerificando(false)
      })
    return () => { vivo = false }
    // Solo al montar: importa la sesión con la que se llegó, no la que se cree
    // después (de eso se encarga el submit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return verificando
}
