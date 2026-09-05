import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useAuth } from './auth'
import { useProfile } from './profile'

export type OnboardingEstado = {
  completado: boolean
  pasos_completados: string[]
  version: number
  iniciado_en?: string
  finalizado_en?: string
}

type OnboardingContextType = {
  estado: OnboardingEstado | null
  cargando: boolean
  forzarInicio: () => Promise<void>
  marcarPaso: (pasoId: string) => Promise<void>
  marcarCompletado: () => Promise<void>
  reiniciar: (version?: number) => Promise<void>
  tourActivo: string | null
  activarTour: (tourId: string | null) => void
}

const OnboardingContext = createContext<OnboardingContextType | null>(null)

const ESTADO_VACIO: OnboardingEstado = {
  completado: false,
  pasos_completados: [],
  version: 1,
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const { user, refresh: refreshPerfil } = useProfile()
  const [estado, setEstado] = useState<OnboardingEstado | null>(null)
  const [cargando, setCargando] = useState(false)
  const [tourActivo, setTourActivo] = useState<string | null>(null)

  const esCliente = useMemo(() => {
    return Boolean(token) && (user?.puede?.nivel ?? 99) === 0
  }, [token, user])

  const cargarEstado = useCallback(async () => {
    if (!token || !esCliente) {
      setEstado(null)
      return
    }
    if (user?.onboarding) {
      setEstado({
        completado: Boolean(user.onboarding.completado),
        pasos_completados: Array.isArray(user.onboarding.pasos_completados) ? user.onboarding.pasos_completados : [],
        version: Number(user.onboarding.version) || 1,
      })
      return
    }
    try {
      setCargando(true)
      const r = await api.get('/auth/onboarding/estado/')
      setEstado(r.data)
    } catch {
      setEstado(ESTADO_VACIO)
    } finally {
      setCargando(false)
    }
  }, [token, esCliente, user])

  useEffect(() => {
    cargarEstado()
  }, [cargarEstado])

  const forzarInicio = useCallback(async () => {
    setEstado(ESTADO_VACIO)
    setTourActivo(null)
  }, [])

  const marcarPaso = useCallback(async (pasoId: string) => {
    if (!token) return
    setEstado(prev => prev ? {
      ...prev,
      pasos_completados: prev.pasos_completados.includes(pasoId)
        ? prev.pasos_completados
        : [...prev.pasos_completados, pasoId],
    } : prev)
    try {
      await api.post('/auth/onboarding/paso/', { paso_id: pasoId })
      refreshPerfil()
    } catch { /* no op */ }
  }, [token, refreshPerfil])

  const marcarCompletado = useCallback(async () => {
    if (!token) return
    setEstado(prev => prev ? { ...prev, completado: true } : prev)
    try {
      await api.post('/auth/onboarding/completar/')
      refreshPerfil()
    } catch { /* no op */ }
  }, [token, refreshPerfil])

  const reiniciar = useCallback(async (version?: number) => {
    if (!token) return
    try {
      setCargando(true)
      const r = await api.post('/auth/onboarding/reiniciar/', { version: version ?? 1 })
      setEstado({
        completado: r.data.completado,
        pasos_completados: [],
        version: r.data.version,
      })
      setTourActivo(null)
      refreshPerfil()
    } finally {
      setCargando(false)
    }
  }, [token, refreshPerfil])

  const activarTour = useCallback((tourId: string | null) => {
    setTourActivo(tourId)
  }, [])

  return (
    <OnboardingContext.Provider
      value={{
        estado,
        cargando,
        forzarInicio,
        marcarPaso,
        marcarCompletado,
        reiniciar,
        tourActivo,
        activarTour,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding debe usarse dentro de OnboardingProvider')
  return ctx
}
