import axios from 'axios'

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

export default api
