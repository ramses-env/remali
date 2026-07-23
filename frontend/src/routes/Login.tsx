import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { consultarYo, destinoTrasEntrar, recordarAcceso } from '../lib/acceso'
import { useAuth } from '../store/auth'
import ThemeToggle from '../components/ThemeToggle'

export default function Login() {
  const { token, login, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const next = new URLSearchParams(loc.search).get('next') || ''

  /* Con sesión abierta el formulario no se pinta: se manda a cada quien a su
     lugar. Solo al montar, porque lo que importa es la sesión con la que se
     llegó; el login posterior navega por su cuenta. */
  const [verificando, setVerificando] = useState(() => Boolean(token))
  useEffect(() => {
    if (!token) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (!email.trim() || !password) {
      setError('Escribe tu usuario y tu contraseña.')
      return
    }
    setLoading(true)
    try {
      await login(email, password)
      try {
        const yo = await consultarYo()
        // Antes de navegar: así el panel abre de una vez con el acento y la
        // sección que le tocan, sin pasar por los de la cuenta anterior.
        recordarAcceso(yo)
        nav(destinoTrasEntrar(yo, next), { replace: true })
      } catch {
        nav(next || '/', { replace: true })
      }
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.detail) {
        const d = String(data.detail).toLowerCase()
        if (d.includes('no active account')) setError('Tu cuenta no está activa. Contacta al administrador.')
        else setError(String(data.detail))
      } else {
        setError('No coinciden. Revisa tu usuario y tu contraseña.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (verificando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="flex flex-col items-center gap-4">
          <span className="w-8 h-8 border-2 border-edge border-t-gold rounded-full animate-spin" />
          <p className="text-mute text-sm">Verificando tu sesión…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr] bg-app text-ink">
      {/* ── Panel de marca (solo desktop) ── */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <img
          src="/images/remali-1.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={e => { const t = e.currentTarget; if (t.dataset.fb !== '1') { t.dataset.fb = '1'; t.src = '/images/maquinas.png' } }}
        />
        {/* Veladura + rejilla + glow dorado */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/90 via-black/70 to-black/40" />
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '54px 54px' }} />
        <div className="absolute -bottom-24 -left-16 w-96 h-96 rounded-full bg-gold/20 blur-[120px]" />

        <Link to="/" className="stagger-item relative z-10 flex items-center gap-3 w-fit">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]">
            <div className="w-full h-full bg-black rounded-[10px] flex items-center justify-center">
              <span className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">R</span>
            </div>
          </div>
          <span className="text-xl font-black tracking-tight text-white">REMALI</span>
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="stagger-item text-gold text-[11px] font-mono uppercase tracking-[0.3em] mb-5">Acceso a tu cuenta</p>
          <h2 className="stagger-item text-4xl xl:text-5xl font-black leading-[1.05] text-white">
            Controla tu<br />maquinaria desde<br />un solo lugar.
          </h2>
          <p className="stagger-item text-white/60 mt-5 text-sm leading-relaxed">
            Inventario por unidad con QR, rentas, ventas y mantenimiento — todo sincronizado y en tiempo real.
          </p>
        </div>

        <div className="stagger-item relative z-10 flex items-center gap-5 text-white/50 text-xs font-mono">
          <span>Inventario · QR</span>
          <span className="w-1 h-1 rounded-full bg-gold/70" />
          <span>Rentas · Ventas</span>
          <span className="w-1 h-1 rounded-full bg-gold/70" />
          <span>Tiempo real</span>
        </div>
      </aside>

      {/* ── Panel del formulario ── */}
      <main className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="absolute top-5 right-5"><ThemeToggle /></div>

        <div className="w-full max-w-sm">
          {/* Logo en móvil */}
          <Link to="/" className="stagger-item lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 p-[2px]">
              <div className="w-full h-full bg-app rounded-[10px] flex items-center justify-center">
                <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-tr from-amber-400 to-orange-500">R</span>
              </div>
            </div>
            <span className="text-2xl font-black tracking-tight text-ink">REMALI</span>
          </Link>

          <div className="stagger-item mb-8">
            <h1 className="text-3xl font-black text-ink tracking-tight">Iniciar sesión</h1>
            <p className="text-mute text-sm mt-2">Bienvenido de vuelta. Accede con tu cuenta.</p>
            <p className="text-mute text-xs mt-1.5">Administración y técnicos entran al panel; los clientes, a la tienda.</p>
          </div>

          {error && (
            <div className="stagger-item mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-start gap-2.5">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 8v4m0 4h.01" /></svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="stagger-item">
              <label className="block text-xs font-medium text-mute mb-2 uppercase tracking-wide">Usuario o correo</label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu usuario o tu correo"
                autoComplete="username"
                className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10 transition-[border-color,box-shadow] duration-150"
              />
            </div>

            <div className="stagger-item">
              <label className="block text-xs font-medium text-mute mb-2 uppercase tracking-wide">Contraseña</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-surface-2 border border-edge rounded-xl px-4 py-3 pr-12 text-sm text-ink placeholder-mute focus:outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10 transition-[border-color,box-shadow] duration-150"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-gold active:scale-90 transition-transform duration-100"
                  aria-label={showPass ? 'Ocultar' : 'Mostrar'}
                >
                  {showPass ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58M9.88 4.24A9 9 0 0112 4c5 0 9 5 9 8a9.7 9.7 0 01-1.67 2.92M6.1 6.1A9.66 9.66 0 003 12c0 3 4 8 9 8a9 9 0 003.9-.88" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="stagger-item w-full py-3.5 rounded-full bg-gold text-black font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />Verificando…</>
              ) : (
                <>Entrar
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </>
              )}
            </button>
          </form>

          <Link to="/" className="stagger-item block text-center mt-7 text-xs text-mute hover:text-ink transition-colors">
            ← Volver al sitio
          </Link>
        </div>
      </main>
    </div>
  )
}
