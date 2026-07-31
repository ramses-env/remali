import { useEffect, useMemo, useState } from 'react'
import LogoRemali from '@/components/ui/logo-remali'
import { useConfigPublica } from '../lib/configPublica'
import { waLink } from '../lib/whatsapp'

/** Estreno del sitio: lunes 3 de agosto de 2026, 12:00 AM (Guerrero, UTC-6). */
export const LANZAMIENTO = new Date('2026-08-03T00:00:00-06:00').getTime()

/** Bypass para el equipo: visitar /?acceso=remali una vez (queda en sessionStorage). */
export function bypassEstreno(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('acceso') === 'remali') {
      sessionStorage.setItem('remali_preview', '1')
      return true
    }
    return sessionStorage.getItem('remali_preview') === '1'
  } catch { return false }
}

function restante(ahora: number) {
  const ms = Math.max(0, LANZAMIENTO - ahora)
  return {
    ms,
    dias: Math.floor(ms / 86_400_000),
    horas: Math.floor(ms / 3_600_000) % 24,
    min: Math.floor(ms / 60_000) % 60,
    seg: Math.floor(ms / 1_000) % 60,
  }
}

const dos = (n: number) => String(n).padStart(2, '0')

/** Portada de cuenta regresiva a pantalla completa (estreno del lunes).
 *
 *  En producción NUNCA destapa el sitio por sí sola: el sitio nuevo se libera
 *  con el deploy del lunes. Si el reloj llega a cero antes de ese deploy,
 *  muestra "estamos abriendo" y recarga sola cada minuto — en cuanto la
 *  versión nueva esté arriba, el visitante la recibe sin tocar nada. */
export default function CuentaRegresiva() {
  const cfg = useConfigPublica()
  const [t, setT] = useState(() => restante(Date.now()))
  const llego = t.ms <= 0

  useEffect(() => {
    const id = window.setInterval(() => setT(restante(Date.now())), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!llego) return
    // Ya es la hora: recarga a los 75 s. Tras la recarga, si el deploy nuevo
    // aún no está, este componente vuelve a montarse y reintenta — un ciclo
    // de recargas espaciadas hasta que el sitio nuevo responda.
    const id = window.setTimeout(() => window.location.reload(), 75_000)
    return () => window.clearTimeout(id)
  }, [llego])

  const bloques = useMemo(() => ([
    { v: dos(t.dias), l: 'DÍAS' },
    { v: dos(t.horas), l: 'HORAS' },
    { v: dos(t.min), l: 'MINUTOS' },
    { v: dos(t.seg), l: 'SEGUNDOS' },
  ]), [t])

  const tel = cfg.whatsapp_principal || cfg.negocio_telefono

  return (
    <div className="fixed inset-0 z-[100] bg-[#080808] text-white overflow-x-hidden overflow-y-auto flex flex-col"
      style={{ ['--c-gold' as any]: '#f2b736' }}>

      {/* Fondo (capa fija y recortada: no genera scroll): rejilla + resplandores */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize: '72px 72px' }} />
        <div className="absolute -top-32 -right-24 w-[480px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(242,183,54,0.16), transparent 65%)' }} />
        <div className="absolute -bottom-40 -left-28 w-[520px] h-[520px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(242,183,54,0.09), transparent 65%)' }} />
      </div>

      {/* Marca */}
      <header className="relative z-10 flex items-center gap-3 px-6 sm:px-12 pt-8">
        <LogoRemali className="w-9 h-9 text-white" />
        <span className="text-lg font-bold tracking-tight">REMALI</span>
      </header>

      {/* Centro */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] font-mono tracking-[0.4em] text-white/50 uppercase mb-5 animate-[fadeUp_0.8s_ease-out]">
          Maquinaria ligera · Renta y venta
        </p>

        <h1 className="font-black tracking-tighter leading-[0.95] mb-3 animate-[fadeUp_0.8s_ease-out_0.1s_both]">
          <span className="block text-[clamp(2.6rem,8vw,5.5rem)]">EQUIPO QUE</span>
          <span className="block text-[clamp(2.6rem,8vw,5.5rem)] text-[#f2b736]">MUEVE TU OBRA</span>
        </h1>

        <p className="text-white/60 text-sm sm:text-base mb-10 sm:mb-12 animate-[fadeUp_0.8s_ease-out_0.2s_both]">
          {llego
            ? <>¡Hoy es el día! <strong className="text-white">Estamos abriendo las puertas…</strong></>
            : <>Estrenamos el <strong className="text-white">lunes 3 de agosto</strong> · 12:00 AM</>}
        </p>

        {/* Contador — al llegar a cero se vuelve "abriendo" (la página se
            recarga sola hasta que el sitio nuevo esté desplegado). */}
        {llego ? (
          <div className="flex flex-col items-center gap-4 animate-[fadeUp_0.8s_ease-out_0.3s_both]" role="status" aria-live="polite">
            <span className="w-9 h-9 rounded-full border-2 border-[#f2b736] border-t-transparent animate-spin" />
            <span className="text-white/50 text-sm">Un momento, por favor — esta página se actualizará sola.</span>
          </div>
        ) : (
          <div className="flex items-stretch gap-2.5 sm:gap-4 animate-[fadeUp_0.8s_ease-out_0.3s_both]" role="timer" aria-live="polite"
            aria-label={`Faltan ${t.dias} días, ${t.horas} horas, ${t.min} minutos y ${t.seg} segundos`}>
            {bloques.map((b, i) => (
              <div key={b.l} className="flex items-center gap-2.5 sm:gap-4">
                {i > 0 && <span className="text-white/25 text-2xl sm:text-4xl font-black self-center pb-5 select-none">:</span>}
                <div className="w-[72px] sm:w-[104px] rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-2 py-4 sm:py-6">
                  <div className="font-mono font-black text-3xl sm:text-5xl tabular-nums leading-none text-white">{b.v}</div>
                  <div className="mt-2.5 text-[9px] sm:text-[10px] font-bold tracking-[0.25em] text-[#f2b736]">{b.l}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contacto mientras tanto */}
        {tel && (
          <a href={waLink(tel, 'Hola REMALI, quiero información antes del estreno.')} target="_blank" rel="noopener noreferrer"
            className="mt-10 sm:mt-12 inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-[#f2b736] text-black text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all animate-[fadeUp_0.8s_ease-out_0.45s_both]">
            <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.9-1.4A10 10 0 1 0 12 2zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5s.8 1.9.8 2c.1.1.1.3 0 .5l-.4.6c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.1.1.7-.2 1.4z"/></svg>
            Escríbenos por WhatsApp
          </a>
        )}
      </main>

      <footer className="relative z-10 px-6 pb-7 text-center text-[11px] text-white/35">
        © 2026 REMALI · Acapulco, Gro.
      </footer>

      {/* Animación de entrada (standalone: sin depender del CSS del sitio) */}
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  )
}
