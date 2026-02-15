import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

type Slide = {
  image: string
  title?: string
  subtitle?: string
  ctaText?: string
  ctaLink?: string
}

type Props = {
  items: Slide[]
  autoPlayMs?: number
  className?: string
  showDots?: boolean
}

export default function Carousel({ items, autoPlayMs = 5000, className = '', showDots = true }: Props) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const timer = useRef<number | null>(null)
  const length = items.length

  useEffect(() => {
    if (length <= 1 || paused) return
    if (timer.current) window.clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      setIndex(i => (i + 1) % length)
    }, autoPlayMs)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [length, autoPlayMs, paused])

  useEffect(() => {
    if (length <= 1 || paused) {
      setProgress(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const pct = Math.max(0, Math.min(100, (elapsed / autoPlayMs) * 100))
      setProgress(pct)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [index, paused, autoPlayMs, length])

  const go = (dir: number) => {
    setIndex(i => (i + dir + length) % length)
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
      onKeyDown={e => {
        if (length <= 1) return
        if (e.key === 'ArrowLeft') go(-1)
        if (e.key === 'ArrowRight') go(1)
      }}
    >
      <div className="absolute left-0 right-0 top-0 h-0.5 bg-black/10">
        <div className="h-full bg-black/50" style={{ width: `${progress}%` }} />
      </div>

      <div className="relative">
        <img
          src={items[index].image}
          alt={items[index].title || 'slide'}
          className="w-full h-56 sm:h-72 md:h-[28rem] object-cover transition-opacity duration-300"
          loading="lazy"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          onError={e => {
            const t = e.currentTarget
            if (t.dataset.fallbackApplied === '1') return
            t.dataset.fallbackApplied = '1'
            t.src = '/hero1.svg'
          }}
<<<<<<< HEAD
          onPointerMove={() => {
            if (!drag.current.active) return
          }}
          onPointerUp={e => {
            if (!drag.current.active) return
            const delta = e.clientX - drag.current.startX
            drag.current.active = false
            if (Math.abs(delta) > 30) go(delta < 0 ? 1 : -1)
          }}
          onPointerCancel={() => {
            drag.current.active = false
          }}
        >
          <img
            src={items[index].image}
            alt={items[index].title || 'slide'}
            className="w-full h-56 sm:h-72 md:h-[28rem] object-cover"
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={e => {
              const t = e.currentTarget
              if (t.dataset.fallbackApplied === '1') return
              t.dataset.fallbackApplied = '1'
              t.src = '/hero1.svg'
            }}
          />
          {(items[index].title || items[index].subtitle) && (
            <div className="absolute inset-x-0 bottom-0 p-6 md:p-8 bg-gradient-to-t from-black/50 to-black/0 text-white">
              {items[index].title && <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight">{items[index].title}</h3>}
              {items[index].subtitle && <p className="mt-1 text-sm md:text-base opacity-90">{items[index].subtitle}</p>}
              {items[index].ctaLink && items[index].ctaText && (
                <Link to={items[index].ctaLink} className="inline-block mt-4 px-4 py-2 rounded-full bg-white/90 text-black hover:bg-white">{items[index].ctaText}</Link>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
=======
        />
        {(items[index].title || items[index].subtitle) && (
          <div className="absolute inset-x-0 bottom-0 p-6 md:p-8 bg-gradient-to-t from-black/50 to-black/0 text-white">
            {items[index].title && <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight">{items[index].title}</h3>}
            {items[index].subtitle && <p className="mt-1 text-sm md:text-base opacity-90">{items[index].subtitle}</p>}
            {items[index].ctaLink && items[index].ctaText && (
              <Link to={items[index].ctaLink} className="inline-block mt-4 px-4 py-2 rounded-full bg-white/90 text-black hover:bg-white">{items[index].ctaText}</Link>
            )}
          </div>
        )}
      </div>
>>>>>>> ramses

      {length > 1 && (
        <>
          <button
            aria-label="Anterior"
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 hidden sm:grid place-items-center w-10 h-10 rounded-full bg-white/90 text-black shadow hover:bg-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            aria-label="Siguiente"
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:grid place-items-center w-10 h-10 rounded-full bg-white/90 text-black shadow hover:bg-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </>
      )}

      {showDots && length > 1 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2">
          {items.map((_, i) => (
            <button
              key={i}
              aria-label={`Ir a slide ${i + 1}`}
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={`w-2.5 h-2.5 rounded-full ${i === index ? 'bg-black' : 'bg-black/30'} hover:bg-black/60`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
