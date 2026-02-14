import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import api from '../lib/api'
import { useAuth } from '../store/auth'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; general?: string }>({})
  const [info, setInfo] = useState<string | null>(null)
  const loc = useLocation()

  useEffect(() => {
    const p = new URLSearchParams(loc.search)
    const expired = p.get('expired') === '1'
    const verified = p.get('verified') === '1'
    const emailParam = p.get('email') || ''
    if (emailParam) setEmail(emailParam)
    if (verified) setInfo('Cuenta verificada, ya puedes entrar')
    else if (expired) setInfo('El enlace de verificación expiró. Ingresa tu correo para reenviarlo')
  }, [loc.search])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    try {
      if (!email.trim() || !password) {
        const errs: { email?: string; password?: string } = {}
        if (!email.trim()) errs.email = 'Campo obligatorio'
        if (!password) errs.password = 'Campo obligatorio'
        setFieldErrors(errs)
        return
      }
      await login(email, password)
      const p = new URLSearchParams(loc.search)
      const next = p.get('next') || ''
      try {
        const r = await api.get('/auth/me/')
        const isAdmin = Boolean(r.data?.is_staff) || (Array.isArray(r.data?.groups) && r.data.groups.includes('Administrador'))
        if (next) nav(next)
        else if (isAdmin) nav('/equipos')
        else nav('/perfil')
      } catch {
        if (next) nav(next)
        else nav('/perfil')
      }
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.detail) {
        const d = String(data.detail).toLowerCase()
        if (d.includes('email')) setFieldErrors({ email: data.detail })
        else if (d.includes('no active account')) setFieldErrors({ general: 'Tu cuenta no está activa. Contacta al administrador.' })
        else setFieldErrors({ general: data.detail })
      } else if (Array.isArray(data?.errors)) {
        setFieldErrors({ password: data.errors[0] })
      } else {
        setError('Error de autenticación')
      }
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-white px-4">
      <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} onSubmit={onSubmit} className="relative w-full max-w-xl md:max-w-2xl sm:p-10 p-8 border rounded-3xl bg-white shadow-md hover:shadow-lg transition-shadow space-y-6">
        <div className="absolute -top-5 left-6">
          <div className="px-4 py-1.5 rounded-b-2xl rounded-t-lg bg-[#517ea0] text-white text-sm font-semibold shadow">
            Login
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight">Bienvenido</h1>
            <p className="text-gray-600">Accede con tu correo</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <input aria-invalid={!!fieldErrors.email} type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="Correo o usuario" className={`w-full border rounded-full px-3 py-2 ${fieldErrors.email ? 'border-red-500' : ''}`} />
            {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input aria-invalid={!!fieldErrors.password} type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña" className={`w-full border rounded-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#517ea0] ${fieldErrors.password ? 'border-red-500' : ''}`} />
            <button type="button" aria-label={showPass ? 'Ocultar contraseña' : 'Ver contraseña'} onClick={() => setShowPass(s => !s)} className="p-2 rounded border hover:bg-gray-50">
              {showPass ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18M10.58 10.58A2 2 0 0112 10c1.1 0 2 .9 2 2 0 .42-.13.81-.35 1.13m-2.54-2.55A2 2 0 0010 12c0 1.1.9 2 2 2 .36 0 .7-.1 1-.28M4.11 7.2C6.05 5.42 8.74 4 12 4c4.77 0 8.88 2.66 10.89 6.5-.57 1.11-1.3 2.12-2.17 3.01M6.53 9.63C5.58 10.5 4.8 11.5 4.22 12.5c2.01 3.84 6.12 6.5 10.89 6.5 1.4 0 2.75-.23 4-.66" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>
          {fieldErrors.password && <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>}
        </div>

        {(error || fieldErrors.general) && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-600 text-sm">{fieldErrors.general || error}</motion.p>}
        {info && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#517ea0] text-sm flex items-center gap-2">
            <span>{info}</span>
          </motion.div>
        )}

        <div className="flex items-center justify-between">
          <button type="submit" className="px-5 py-2.5 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white hover:shadow-md disabled:opacity-50 w-full sm:w-auto">Entrar</button>
        </div>

        {/* UI de reenviar en login eliminada según requerimiento */}
      </motion.form>
    </div>
  )
}
