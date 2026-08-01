import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../lib/api'
import { cn } from '../lib/utils'
import { useLang } from '../lib/i18n'
import { VoicePoweredOrb } from './ui/voice-powered-orb'

type Msg = { autor: 'tu' | 'ia'; texto: string }
type Me = { username?: string; first_name?: string; last_name?: string } | null

function iniciales(me: Me) {
  const fn = (me?.first_name || '').trim()
  const ln = (me?.last_name || '').trim()
  if (fn || ln) return ((fn[0] || '') + (ln[0] || '')).toUpperCase()
  return ((me?.username || 'yo').slice(0, 2)).toUpperCase()
}

/** Anillo tipo "orbe" en CSS (barato) para los avatares de los mensajes.
 *  El orbe real (WebGL) se usa solo en el indicador de "escribiendo" para no
 *  abrir muchos contextos WebGL a la vez. */
function OrbRing({ size = 34 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: 'conic-gradient(from 210deg, #9c43fe, #4cc2e9, #7c5cff, #9c43fe)',
        WebkitMask: 'radial-gradient(circle at center, transparent 52%, #000 54%)',
        mask: 'radial-gradient(circle at center, transparent 52%, #000 54%)',
        boxShadow: '0 0 10px rgba(124,92,255,0.45)',
      }}
    />
  )
}

const TXT = {
  ES: {
    hola: 'Qué bueno verte',
    placeholder: 'Pregúntame lo que sea…',
    send: 'Enviar',
    greeting: '¡Hola! Soy tu asistente REMALI. Puedo responderte sobre los datos del negocio. Prueba con:',
    examples: [
      '¿Cuántas unidades disponibles hay?',
      '¿Qué rentas vencen esta semana?',
      '¿Cuánto llevo de ventas este mes?',
      'Resume el estado del inventario',
    ],
    error: 'No se pudo consultar al asistente.',
  },
  EN: {
    hola: 'Good to see you',
    placeholder: 'Ask me anything…',
    send: 'Send',
    greeting: "Hi! I'm your REMALI assistant. I can answer questions about your business data. Try:",
    examples: [
      'How many units are available?',
      'Which rentals are due this week?',
      'How much have I sold this month?',
      'Summarize the inventory status',
    ],
    error: 'Could not reach the assistant.',
  },
}

/** Asistente de IA del panel: chat de texto sobre los datos del negocio.
 *  El backend (/asistente/preguntar/) resuelve datos y modelo respetando el rol. */
export default function AsistenteIA({ notify, me }: { notify?: (m: string, t?: 'ok' | 'err') => void; me?: Me }) {
  const { lang } = useLang()
  const L = TXT[lang === 'EN' ? 'EN' : 'ES']
  const [mensajes, setMensajes] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)
  const yo = useMemo(() => iniciales(me ?? null), [me])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, cargando])

  const enviar = async (pregunta: string) => {
    const q = pregunta.trim()
    if (!q || cargando) return
    setMensajes(m => [...m, { autor: 'tu', texto: q }])
    setTexto('')
    setCargando(true)
    try {
      // `fondo: true` → esta petición NO enciende el loader global de la app.
      // El único aviso de "está pensando" es el indicador del chat (orbe +
      // puntitos); si no, el overlay global parece que algo se rompió.
      const r = await api.post<{ respuesta: string }>('/asistente/preguntar/', { pregunta: q }, { fondo: true } as never)
      setMensajes(m => [...m, { autor: 'ia', texto: r.data.respuesta || '—' }])
    } catch (e: unknown) {
      const detalle =
        (e as { response?: { data?: { detalle?: string } } })?.response?.data?.detalle || L.error
      setMensajes(m => [...m, { autor: 'ia', texto: detalle }])
      notify?.(detalle, 'err')
    } finally {
      setCargando(false)
    }
  }

  const nombre = ((me?.first_name || me?.username || '').trim().split(' ')[0]) || 'admin'

  const entrada = (
    <form onSubmit={e => { e.preventDefault(); enviar(texto) }} className="mt-3 shrink-0">
      <div className="flex items-center gap-2 rounded-full border border-edge bg-surface px-5 py-1.5 shadow-sm focus-within:border-gold/50 transition-colors">
        <input
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder={L.placeholder}
          className="flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-mute"
        />
        <button
          type="submit"
          disabled={cargando || !texto.trim()}
          aria-label={L.send}
          className={cn(
            'shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gold transition-colors',
            'hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent',
          )}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
      <p className="text-center text-[10px] text-mute mt-2">v1.0.0</p>
    </form>
  )

  // Sin conversación: héroe centrado (orbe + saludo + ejemplos), como recién llegas.
  if (mensajes.length === 0 && !cargando) {
    return (
      <div className="flex flex-col h-full min-h-[72vh] max-w-3xl mx-auto w-full">
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-36 h-36 sm:w-44 sm:h-44"><VoicePoweredOrb enableVoiceControl={false} /></div>
          <h2 className="mt-4 text-[22px] sm:text-[26px] font-black text-ink text-center">{L.hola}, {nombre}.</h2>
          <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-lg">
            {L.examples.map(s => (
              <button key={s} onClick={() => enviar(s)} className="text-xs px-3 py-1.5 rounded-full border border-edge text-mute hover:text-ink hover:bg-surface-2 hover:border-gold/40 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
        {entrada}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-[72vh] max-w-3xl mx-auto w-full">
      {/* Conversación */}
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-5">
        {/* Saludo con ejemplos (siempre visible) */}
        <div className="flex items-start gap-3">
          <OrbRing />
          <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-surface border border-edge px-4 py-3 shadow-sm">
            <p className="text-sm text-ink leading-relaxed mb-2.5">{L.greeting}</p>
            <div className="flex flex-wrap gap-2">
              {L.examples.map(s => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-edge text-ink hover:bg-surface-2 hover:border-gold/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {mensajes.map((m, i) =>
          m.autor === 'ia' ? (
            <div key={i} className="flex items-start gap-3">
              <OrbRing />
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-surface border border-edge px-4 py-3 shadow-sm text-sm text-ink leading-relaxed whitespace-pre-wrap">
                {m.texto}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-3 justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-gold text-black px-4 py-2.5 shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
                {m.texto}
              </div>
              <span className="shrink-0 w-9 h-9 rounded-full bg-ink text-app text-xs font-bold flex items-center justify-center">
                {yo}
              </span>
            </div>
          ),
        )}

        {/* "Escribiendo…" con el orbe real (WebGL) */}
        {cargando && (
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 shrink-0">
              <VoicePoweredOrb enableVoiceControl={false} />
            </div>
            <div className="rounded-2xl rounded-tl-md bg-surface border border-edge px-4 py-3.5 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mute animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {entrada}
    </div>
  )
}
