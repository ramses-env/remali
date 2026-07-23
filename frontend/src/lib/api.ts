import axios from 'axios'
import { notificarMutacion } from './realtime'

function normalizeBase(url?: string) {
  let u = (url || '').trim()
  if (!u) return '/api'
  if (u.startsWith('/')) return u
  if (u.startsWith(':')) return `http://localhost${u}`
  if (!/^https?:\/\//.test(u)) return `http://${u}`
  return u
}

const api = axios.create({ baseURL: normalizeBase(import.meta.env.VITE_API_URL) })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Si el token expira o es inválido (401), limpiar sesión y mandar a login
api.interceptors.response.use(
  response => {
    // Toda mutación exitosa avisa al bus: lo que quedó viejo se recarga solo.
    notificarMutacion(response.config?.url || '', response.config?.method || '')
    return response
  },
  error => {
    const status = error?.response?.status
    const hadToken = Boolean(localStorage.getItem('token'))
    const url: string = error?.config?.url || ''
    // No redirigir por el propio intento de login
    const isAuthCall = url.includes('/auth/token') || url.includes('/auth/login')
    if (status === 401 && hadToken && !isAuthCall) {
      localStorage.removeItem('token')
      const path = window.location.pathname
      if (!path.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(path)}&expired=1`
      }
    }
    return Promise.reject(error)
  }
)

export default api
