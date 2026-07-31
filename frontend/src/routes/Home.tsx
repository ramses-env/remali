import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { TextPlugin } from 'gsap/TextPlugin'
import { ContainerScroll } from '../components/ui/container-scroll-animation'

gsap.registerPlugin(ScrollTrigger, TextPlugin)
// Solo en dev: poder inspeccionar los triggers desde la consola.
if (import.meta.env.DEV) (window as any).__ST = ScrollTrigger

const machines = [
  {
    src: '/images/remali-1.jpg',
    label: '01',
    title: 'Mezcladoras de Concreto',
    category: 'Concreto',
    desc: 'Capacidad de 1 a 9 pies cúbicos. Motores eléctricos y a gasolina.',
    color: '#f59e0b',
  },
  {
    src: '/images/remali-2.jpg',
    label: '02',
    title: 'Apisonadoras',
    category: 'Compactación',
    desc: 'Compactación de suelos blandos y cohesivos con alto rendimiento.',
    color: '#3b82f6',
  },
  {
    src: '/images/maquinas.png',
    label: '03',
    title: 'Equipos de Demolición',
    category: 'Demolición',
    desc: 'Rompedores eléctricos y neumáticos para concreto, asfalto y roca.',
    color: '#ef4444',
  },
  {
    src: '/images/remali-3.jpg',
    label: '04',
    title: 'Cortadoras de Piso',
    category: 'Acabados',
    desc: 'Corte limpio y preciso en concreto y asfalto. Discos diamantados.',
    color: '#10b981',
  },
]

const features = [
  { n: '01', title: 'Experiencia', desc: 'Años atendiendo proyectos exigentes en toda la región.' },
  { n: '02', title: 'Procesos claros', desc: 'Renta y venta sin letra pequeña. Transparencia total.' },
  { n: '03', title: 'Soporte 24/7', desc: 'Equipo técnico disponible para emergencias en obra.' },
  { n: '04', title: 'Garantía', desc: 'Todos los equipos revisados y certificados antes de entrega.' },
]

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {

      /* ──────────────────────────────────────
         1. HERO — letras caen una a una
      ────────────────────────────────────── */
      gsap.from('.char', {
        yPercent: 120,
        opacity: 0,
        duration: 1.1,
        ease: 'expo.out',
        stagger: 0.035,
      })
      gsap.from(['.hero-sub', '.hero-actions', '.hero-stats-row'], {
        y: 50,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        stagger: 0.18,
        delay: 0.5,
      })

      /* ──────────────────────────────────────
         2. HERO — parallax suave del grid bg
      ────────────────────────────────────── */
      gsap.to('.hero-grid', {
        yPercent: 40,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      })

      /* ──────────────────────────────────────
         3. MARQUEE infinito
      ────────────────────────────────────── */
      const track = document.querySelector('.marquee-track') as HTMLElement
      if (track) {
        const w = track.scrollWidth / 2
        gsap.to(track, { x: -w, duration: 30, ease: 'none', repeat: -1 })
      }

      /* ──────────────────────────────────────
         4. INTRO TEXTO — "¿Qué hacemos?" aparece con typewriter scrub
      ────────────────────────────────────── */
      gsap.fromTo('.intro-line',
        { width: '0%' },
        {
          width: '100%',
          ease: 'none',
          scrollTrigger: {
            trigger: '.intro-section',
            start: 'top 80%',
            end: 'top 20%',
            scrub: 1,
          },
        }
      )
      gsap.from('.intro-word', {
        y: 80,
        opacity: 0,
        duration: 0.9,
        ease: 'expo.out',
        stagger: 0.07,
        scrollTrigger: {
          trigger: '.intro-section',
          start: 'top 75%',
          toggleActions: 'play none none none',
        },
      })

      /* ──────────────────────────────────────
         5. GALERÍA — clipPath expand + parallax interno
      ────────────────────────────────────── */
      gsap.utils.toArray<HTMLElement>('.expand-card').forEach((card, i) => {
        const img    = card.querySelector<HTMLElement>('.expand-img')
        const overlay= card.querySelector<HTMLElement>('.expand-overlay')
        const info   = card.querySelector<HTMLElement>('.expand-info')
        const num    = card.querySelector<HTMLElement>('.card-num')
        const accent = card.querySelector<HTMLElement>('.card-accent-line')

        // clip abre al entrar
        gsap.fromTo(img,
          { clipPath: 'inset(18% 10% 18% 10% round 28px)', scale: 1.25 },
          {
            clipPath: 'inset(0% 0% 0% 0% round 0px)',
            scale: 1,
            ease: 'power2.inOut',
            scrollTrigger: {
              trigger: card,
              start: 'top 92%',
              end: 'top 5%',
              scrub: 1.8,
            },
          }
        )

        // overlay se aclara
        gsap.fromTo(overlay,
          { opacity: 0.75 },
          {
            opacity: 0.2,
            ease: 'none',
            scrollTrigger: {
              trigger: card,
              start: 'top 92%',
              end: 'top 20%',
              scrub: true,
            },
          }
        )

        // parallax interno de la imagen (se mueve más lento)
        gsap.fromTo(img,
          { yPercent: -10 },
          {
            yPercent: 10,
            ease: 'none',
            scrollTrigger: {
              trigger: card,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          }
        )

        // número grande se hace más pequeño al subir
        if (num) {
          gsap.fromTo(num,
            { scale: 1.6, opacity: 0.05 },
            {
              scale: 1,
              opacity: 0.12,
              ease: 'none',
              scrollTrigger: {
                trigger: card,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
              },
            }
          )
        }

        // línea acento se extiende
        if (accent) {
          gsap.fromTo(accent,
            { scaleX: 0, transformOrigin: 'left center' },
            {
              scaleX: 1,
              duration: 0.8,
              ease: 'expo.out',
              scrollTrigger: {
                trigger: card,
                start: 'top 60%',
                toggleActions: 'play none none none',
              },
            }
          )
        }

        // info sube
        gsap.fromTo(info,
          { y: 70, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 1,
            ease: 'expo.out',
            delay: i * 0.04,
            scrollTrigger: {
              trigger: card,
              start: 'top 65%',
              toggleActions: 'play none none none',
            },
          }
        )
      })

      /* ──────────────────────────────────────
         6. STATS — contadores animados
      ────────────────────────────────────── */
      gsap.utils.toArray<HTMLElement>('.stat-count').forEach((el) => {
        const target = parseInt(el.dataset.target || '0', 10)
        gsap.fromTo(el,
          { innerText: 0 },
          {
            innerText: target,
            duration: 2.5,
            ease: 'power1.out',
            snap: { innerText: 1 },
            scrollTrigger: {
              trigger: '.stats-section',
              start: 'top 75%',
              toggleActions: 'play none none none',
            },
          }
        )
      })

      /* fromTo y no from: con from() el "final" se lee del estado del DOM al
         crear el tween, y si el montaje doble de StrictMode dejó un opacity: 0
         inline, la sección termina la animación… invisible. Con el fin
         explícito eso no puede pasar. `once` además libera el trigger. */
      gsap.fromTo('.stat-item',
        { y: 60, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.12,
          scrollTrigger: { trigger: '.stats-section', start: 'top 80%', once: true },
        })

      /* ──────────────────────────────────────
         7. FEATURES — entrada escalonada con línea que crece
      ────────────────────────────────────── */
      gsap.fromTo('.feature-card',
        { y: 80, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.1,
          scrollTrigger: { trigger: '.features-section', start: 'top 75%', once: true },
        })

      gsap.fromTo('.features-divider',
        { scaleX: 0, transformOrigin: 'left center' },
        {
          scaleX: 1,
          duration: 1.4,
          ease: 'expo.out',
          scrollTrigger: { trigger: '.features-section', start: 'top 70%', once: true },
        }
      )

      /* ──────────────────────────────────────
         8. HORIZONTAL TICKER en stats (frase)
      ────────────────────────────────────── */
      const ticker2 = document.querySelector('.ticker2-track') as HTMLElement
      if (ticker2) {
        const w2 = ticker2.scrollWidth / 2
        gsap.to(ticker2, { x: -w2, duration: 20, ease: 'none', repeat: -1 })
      }

      /* ──────────────────────────────────────
         9. CTA — escala desde abajo + glow pulse
      ────────────────────────────────────── */
      gsap.fromTo('.cta-box',
        { scale: 0.88, opacity: 0, y: 80 },
        {
          scale: 1,
          opacity: 1,
          y: 0,
          duration: 1.4,
          ease: 'expo.out',
          scrollTrigger: { trigger: '.cta-box', start: 'top 85%', once: true },
        }
      )

      gsap.fromTo('.cta-btn',
        { y: 30, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.15,
          scrollTrigger: { trigger: '.cta-box', start: 'top 75%', once: true },
        })

      /* ──────────────────────────────────────
         10. SCROLL PROGRESS BAR
      ────────────────────────────────────── */
      ScrollTrigger.create({
        start: 'top top',
        end: 'max',
        onUpdate: (self) => {
          const bar = document.querySelector('.scroll-bar') as HTMLElement
          if (bar) bar.style.width = `${self.progress * 100}%`
        },
      })

    }, rootRef)

    /* Las imágenes (y los datos) llegan después del montaje y recorren el
       layout. ScrollTrigger midió posiciones viejas: hay secciones que se
       quedan invisibles porque su trigger nunca se cruza. Cada imagen que
       carga refresca las mediciones (con debounce para no recalcular 10 veces
       seguidas). El listener va en fase de captura porque `load` no burbujea. */
    let t: number | undefined
    const refrescar = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    }
    const raiz = rootRef.current
    raiz?.addEventListener('load', refrescar, true)
    window.addEventListener('load', refrescar)

    return () => {
      window.clearTimeout(t)
      raiz?.removeEventListener('load', refrescar, true)
      window.removeEventListener('load', refrescar)
      ctx.revert()
    }
  }, [])

  return (
    <div ref={rootRef} className="bg-app text-ink font-sans overflow-x-hidden">

      {/* ── BARRA DE PROGRESO DE SCROLL ── */}
      <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] bg-transparent pointer-events-none">
        <div className="scroll-bar h-full bg-gold w-0 transition-none" />
      </div>

      {/* ══════════════════════════════════
          HERO
      ══════════════════════════════════ */}
      <section className="hero-section relative min-h-screen flex flex-col justify-center px-6 md:px-16 lg:px-24 pt-32 pb-24 overflow-hidden">

        {/* Grid bg con parallax */}
        <div className="hero-grid absolute inset-[-20%] pointer-events-none will-change-transform">
          <div
            className="absolute inset-0 opacity-[0.045]"
            style={{
              backgroundImage:
                'linear-gradient(var(--c-grid) 1px,transparent 1px),linear-gradient(90deg,var(--c-grid) 1px,transparent 1px)',
              backgroundSize: '80px 80px',
            }}
          />
        </div>

        {/* Glow blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-gold-soft blur-[130px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-orange-600/8 blur-[110px]" />
        </div>

        <p className="relative z-10 text-[11px] font-mono text-mute tracking-[0.35em] mb-10 uppercase">
          Remali — Maquinaria Ligera · Est. 2026
        </p>

        {/* Título letra a letra */}
        <div className="relative z-10 mb-1 overflow-hidden">
          <h1 className="text-[clamp(4rem,11vw,9rem)] font-black leading-[0.9] tracking-tighter">
            {'EQUIPO'.split('').map((c, i) => <span key={i} className="char inline-block">{c}</span>)}
          </h1>
        </div>
        <div className="relative z-10 mb-1 overflow-hidden">
          <h1
            className="text-[clamp(4rem,11vw,9rem)] font-black leading-[0.9] tracking-tighter text-transparent"
            /* El borde del token (--c-stroke) casi no se ve sobre el fondo claro;
               un % de la tinta del tema contrasta bien en claro Y en oscuro. */
            style={{ WebkitTextStroke: '2px color-mix(in srgb, var(--c-ink) 30%, transparent)' }}
          >
            {'QUE MUEVE'.split('').map((c, i) => (
              <span key={i} className="char inline-block">{c === ' ' ? ' ' : c}</span>
            ))}
          </h1>
        </div>
        <div className="relative z-10 mb-14 overflow-hidden">
          <h1 className="text-[clamp(4rem,11vw,9rem)] font-black leading-[0.9] tracking-tighter text-gold">
            {'TU OBRA'.split('').map((c, i) => (
              <span key={i} className="char inline-block">{c === ' ' ? ' ' : c}</span>
            ))}
          </h1>
        </div>

        <div className="relative z-10 hero-sub flex flex-col sm:flex-row items-start sm:items-end gap-10 max-w-4xl">
          <p className="text-mute text-base md:text-lg leading-relaxed max-w-sm border-l-2 border-gold/40 pl-5">
            Renta y venta de maquinaria ligera para construcción. Potencia, durabilidad y soporte técnico especializado.
          </p>
          <div className="hero-actions flex flex-wrap gap-4">
            <Link
              to="/equipos"
              className="group inline-flex items-center gap-3 px-8 py-4 bg-gold text-black font-bold rounded-full text-sm tracking-wide hover:opacity-90 transition-colors"
            >
              Ver catálogo
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              to="/cotizacion"
              className="inline-flex items-center gap-2 px-8 py-4 border border-edge rounded-full text-sm font-medium text-ink/60 hover:text-ink hover:border-white/30 transition-colors"
            >
              Solicitar cotización
            </Link>
          </div>
        </div>

        {/* Mini stats row */}
        <div className="hero-stats-row relative z-10 mt-16 pt-10 border-t border-edge grid grid-cols-3 gap-6 max-w-xs">
          {[
            { v: '+150', l: 'Proyectos' },
            { v: '24/7', l: 'Soporte' },
            { v: '100%', l: 'Garantía' },
          ].map((s) => (
            <div key={s.l}>
              <p className="text-2xl font-black text-gold mb-1">{s.v}</p>
              <p className="text-[10px] text-mute uppercase tracking-widest font-mono">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-10 right-10 hidden md:flex flex-col items-end gap-3 text-mute">
          <span className="text-[9px] font-mono uppercase tracking-[0.3em]">Scroll down</span>
          <div className="w-px h-14 bg-gradient-to-b from-neutral-700 to-transparent ml-auto" />
        </div>
      </section>

      {/* ══════════════════════════════════
          MARQUEE 1 — Categorías
      ══════════════════════════════════ */}
      <div className="border-y border-edge bg-surface py-4 overflow-hidden">
        <div className="marquee-track flex gap-14 whitespace-nowrap w-max">
          {[...Array(2)].flatMap((_, r) =>
            ['Mezcladoras', 'Apisonadoras', 'Rompedores', 'Cortadoras', 'Vibradores', 'Compactadoras', 'Generadores', 'Andamios', 'Taladros', 'Pulidoras'].map((t) => (
              <span key={`${r}-${t}`} className="text-mute text-[11px] font-mono uppercase tracking-[0.25em] flex items-center gap-4">
                {t}<span className="w-1 h-1 rounded-full bg-gold inline-block" />
              </span>
            ))
          )}
        </div>
      </div>

      {/* ══════════════════════════════════
          INTRO — párrafo grande con reveal
      ══════════════════════════════════ */}
      <section className="intro-section py-28 px-6 md:px-16 lg:px-24">
        <div className="max-w-screen-xl mx-auto">
          <div className="intro-line h-px bg-gold/40 w-0 mb-14" />
          <div className="overflow-hidden">
            <p className="text-3xl md:text-4xl lg:text-5xl font-black leading-[1.15] text-ink max-w-4xl">
              {[
                'Maquinaria', 'que', 'trabaja', 'tan', 'duro', 'como', 'tú.',
                'Equipos', 'confiables,', 'servicio', 'sin', 'igual.',
              ].map((w, i) => (
                <span key={i} className="intro-word inline-block mr-[0.3em]">{w}</span>
              ))}
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════
          SCROLL SHOWCASE — Container Scroll Animation
      ══════════════════════════════════ */}
      <section className="overflow-hidden -my-10 md:-my-24">
        <ContainerScroll
          titleComponent={
            <div className="mb-2">
              <p className="text-gold text-xs font-mono uppercase tracking-[0.25em] mb-4">— Nuestra plataforma</p>
              <h2 className="text-3xl md:text-4xl font-semibold text-ink">
                Renta y compra en minutos con <br />
                <span className="text-4xl md:text-[6rem] font-black mt-1 leading-none block">
                  un solo clic
                </span>
              </h2>
            </div>
          }
        >
          <img
            src="/images/maquinas.png"
            alt="Maquinaria ligera Remali"
            draggable={false}
            className="mx-auto rounded-2xl object-cover h-full w-full object-center"
            onError={e => { const t = e.currentTarget; if (t.dataset.fb !== '1') { t.dataset.fb = '1'; t.src = '/images/remali-1.jpg' } }}
          />
        </ContainerScroll>
      </section>

      {/* ══════════════════════════════════
          GALERÍA — imágenes con clipPath expand
      ══════════════════════════════════ */}
      <section className="pb-28 px-6 md:px-16 lg:px-24">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-16">
            <div>
              <p className="text-gold text-[11px] font-mono uppercase tracking-[0.25em] mb-3">— Nuestro equipo</p>
              <h2 className="text-4xl md:text-5xl font-black leading-tight">
                Maquinaria para<br />cada etapa
              </h2>
            </div>
            <Link to="/equipos" className="group text-sm font-semibold text-ink/40 hover:text-gold transition-colors flex items-center gap-2 shrink-0">
              Ver catálogo completo
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            </Link>
          </div>

          <div className="space-y-6">
            {machines.map((m, i) => (
              <div key={i} className="expand-card group">
                {/* Imagen */}
                <div
                  className="relative overflow-hidden"
                  style={{ height: i % 2 === 0 ? 'min(58vw, 660px)' : 'min(44vw, 520px)', minHeight: '260px' }}
                >
                  <img
                    src={m.src}
                    alt={m.title}
                    className="expand-img absolute inset-0 w-full h-full object-cover will-change-transform"
                  />
                  <div className="expand-overlay absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/30 to-transparent" />

                  {/* Número grande */}
                  <div className="card-num absolute top-4 left-6 z-10 select-none">
                    <span className="text-[120px] font-black leading-none text-ink/10">{m.label}</span>
                  </div>

                  {/* Badge categoría */}
                  <div className="absolute top-6 right-6 z-10 flex items-center gap-2 px-3 py-1.5 bg-black/50 backdrop-blur-sm border border-edge rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: m.color }} />
                    <span className="text-[10px] font-mono text-ink uppercase tracking-widest">{m.category}</span>
                  </div>
                </div>

                {/* Info */}
                <div className="expand-info mt-6 px-1">
                  {/* Línea acento que crece */}
                  <div className="card-accent-line h-px mb-5" style={{ backgroundColor: m.color }} />
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                      <h3 className="text-2xl md:text-3xl font-black text-ink mb-1.5 group-hover:text-gold transition-colors duration-300">
                        {m.title}
                      </h3>
                      <p className="text-mute text-sm max-w-md">{m.desc}</p>
                    </div>
                    <Link
                      to="/equipos"
                      className="shrink-0 inline-flex items-center gap-2 text-sm font-semibold text-ink/30 group-hover:text-gold transition-colors"
                    >
                      Ver equipos →
                    </Link>
                  </div>
                </div>

                {i < machines.length - 1 && <div className="mt-6 h-px bg-surface-2" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════
          TICKER 2 — frase motivacional
      ══════════════════════════════════ */}
      <div className="border-y border-edge bg-surface py-4 overflow-hidden">
        <div className="ticker2-track flex gap-16 whitespace-nowrap w-max">
          {[...Array(2)].flatMap((_, r) =>
            ['Renta', '·', 'Venta', '·', 'Soporte 24/7', '·', 'Garantía', '·', 'Calidad', '·', 'Confianza', '·'].map((t, i) => (
              <span key={`${r}-${i}`} className={`text-sm font-mono uppercase tracking-[0.2em] ${t === '·' ? 'text-gold' : 'text-mute'}`}>
                {t}
              </span>
            ))
          )}
        </div>
      </div>

      {/* ══════════════════════════════════
          STATS — contadores
      ══════════════════════════════════ */}
      <section className="stats-section py-28 px-6 md:px-16 lg:px-24">
        <div className="max-w-screen-xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-0 md:divide-x divide-edge">
            {[
              { target: 150, suffix: '+', label: 'Proyectos completados' },
              { target: 40, suffix: '+', label: 'Equipos en catálogo' },
              { target: 8, suffix: ' años', label: 'De experiencia' },
              { target: 98, suffix: '%', label: 'Satisfacción del cliente' },
            ].map((s) => (
              <div key={s.label} className="stat-item text-center px-8">
                <p className="text-5xl md:text-6xl xl:text-7xl font-black text-ink mb-3">
                  <span className="stat-count" data-target={s.target}>0</span>
                  <span className="text-gold">{s.suffix}</span>
                </p>
                <p className="text-mute text-xs uppercase tracking-[0.2em] font-mono">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════
          FEATURES — cuadrícula con hover
      ══════════════════════════════════ */}
      <section className="features-section pb-28 px-6 md:px-16 lg:px-24">
        <div className="max-w-screen-xl mx-auto">
          <div className="mb-14">
            <p className="text-gold text-[11px] font-mono uppercase tracking-[0.25em] mb-3">— Por qué elegirnos</p>
            <h2 className="text-4xl md:text-5xl font-black mb-6">La diferencia REMALI</h2>
            <div className="features-divider h-px bg-white/10 max-w-3xl" />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 border border-edge rounded-2xl overflow-hidden">
            {features.map((f, i) => (
              <div
                key={i}
                className="feature-card group p-8 border-r border-b border-edge hover:bg-surface-2 transition-all duration-500 cursor-default"
              >
                <span className="block text-[10px] font-mono text-gold/50 mb-6 tracking-widest">{f.n}</span>
                <div className="w-8 h-0.5 bg-gold/30 mb-5 group-hover:w-14 group-hover:bg-gold transition-all duration-500" />
                <h3 className="text-lg font-bold text-ink mb-3 group-hover:text-gold transition-colors">{f.title}</h3>
                <p className="text-mute text-sm leading-relaxed group-hover:text-mute transition-colors">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════
          CTA FINAL
      ══════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-screen-xl mx-auto">
          <div className="cta-box relative rounded-3xl overflow-hidden bg-gold p-12 md:p-20">
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  'linear-gradient(#000 1px,transparent 1px),linear-gradient(90deg,#000 1px,transparent 1px)',
                backgroundSize: '44px 44px',
              }}
            />
            {/* Glow */}
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/20 rounded-full blur-[80px] pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-12">
              <div>
                <p className="text-black/40 text-[10px] font-mono uppercase tracking-[0.3em] mb-5">¿Listo para comenzar?</p>
                <h2 className="text-4xl md:text-6xl font-black text-black leading-[1.05]">
                  Haz crecer tu<br />proyecto con<br />REMALI
                </h2>
              </div>
              <div className="flex flex-col gap-4 shrink-0 min-w-[220px]">
                <Link to="/cotizacion" className="cta-btn px-10 py-5 bg-black text-white font-bold rounded-full text-center text-sm hover:bg-neutral-900 transition-colors tracking-wide">
                  Solicitar cotización
                </Link>
                <Link to="/equipos" className="cta-btn px-10 py-5 border-2 border-black/20 text-black font-bold rounded-full text-center text-sm hover:bg-black/10 transition-colors tracking-wide">
                  Ver catálogo
                </Link>
                <p className="text-center text-black/40 text-xs font-mono">Sin compromiso · Respuesta en 24h</p>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  )
}
