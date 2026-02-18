import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'

const heroImages = [
  "/images/apiso.png",
  "/images/revol.png"
]

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } }
} as any

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
} as any

const blobAnimation = {
  animate: {
    x: [0, 30, -20, 0],
    y: [0, -40, 20, 0],
    scale: [1, 1.1, 0.9, 1],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: "linear"
    }
  }
} as any

const floating = {
  animate: {
    y: [0, -20, 0],
    rotate: [1, -1, 1],
    transition: {
      duration: 5,
      repeat: Infinity,
      ease: "easeInOut"
    }
  }
} as any

export default function Home() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"]
  })

  const yBg = useTransform(scrollYProgress, [0, 1], ["0%", "50%"])
  const yHero = useTransform(scrollYProgress, [0, 1], ["0%", "20%"])
  const opacityHero = useTransform(scrollYProgress, [0, 0.5], [1, 0])

  useEffect(() => {
    if (loading) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [loading])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % heroImages.length)
    }, 8000)
    
    // Simulate initial loading for animation
    const loadTimer = setTimeout(() => setLoading(false), 2000)
    
    return () => {
      clearInterval(timer)
      clearTimeout(loadTimer)
    }
  }, [])

  return (
    <div ref={containerRef} className="bg-neutral-950 min-h-screen font-sans selection:bg-blue-500/30">
      
      {/* Intro Overlay */}
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div
            key="loader"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-neutral-950 h-screen w-screen"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="relative"
            >
               <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-indigo-500 to-sky-500 tracking-tighter">
                REMALI
              </h1>
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="h-1 bg-white/20 mt-4 rounded-full overflow-hidden"
              >
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={{ x: "-100%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: 1, ease: "circOut" }}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-neutral-900/50 shadow-2xl border-b border-white/5 min-h-[95vh] flex items-center">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-overlay"></div>
        
        <motion.div style={{ y: yBg }} className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div 
            variants={blobAnimation}
            animate="animate"
            className="absolute -top-[40%] -left-[20%] h-[80vw] w-[80vw] rounded-full bg-blue-600/10 blur-[100px] mix-blend-screen" 
          />
          <motion.div 
            variants={blobAnimation}
            animate="animate"
            transition={{ delay: 5 }} 
            className="absolute -bottom-[40%] -right-[20%] h-[80vw] w-[80vw] rounded-full bg-indigo-600/10 blur-[100px] mix-blend-screen" 
          />
        </motion.div>

        <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={staggerContainer}
            style={{ y: yHero, opacity: opacityHero }}
            className="will-change-transform"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2 text-sm font-medium text-blue-200 mb-8 shadow-lg shadow-blue-900/20 ring-1 ring-white/10 hover:bg-white/10 transition-colors cursor-default">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
              </span>
              <span className="tracking-wide">Lanzamiento 2026 • Alquiler y venta</span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight text-white leading-[1] mb-8">
              Equipos de <br/>
              <span className="relative inline-block mt-2">
                <span className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 blur-3xl opacity-40"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-sky-400">construcción</span>
              </span> <br/>
              de alto nivel
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-neutral-400 max-w-xl leading-relaxed mb-10 border-l-2 border-blue-500/30 pl-6">
              Soluciones integrales en maquinaria ligera. Potencia, durabilidad y servicio técnico especializado para garantizar el éxito de tu obra.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-wrap gap-5">
              <Link to="/equipos" className="group relative px-8 py-4 rounded-full bg-blue-600 text-white font-bold shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] hover:shadow-[0_0_60px_-10px_rgba(37,99,235,0.6)] hover:bg-blue-500 transition-all hover:-translate-y-1 overflow-hidden">
                <span className="relative z-10 flex items-center gap-2">
                  Ver catálogo
                  <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                </span>
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 ease-in-out" />
              </Link>
              <Link to="/cotizacion" className="group px-8 py-4 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-white font-semibold hover:bg-white/10 transition-all hover:-translate-y-1 hover:border-white/20">
                Solicitar cotización
              </Link>
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-16 pt-10 border-t border-white/5 grid grid-cols-3 gap-8">
              {[
                { value: "+150", label: "Proyectos", color: "text-blue-400" },
                { value: "24/7", label: "Soporte", color: "text-indigo-400" },
                { value: "100%", label: "Garantía", color: "text-sky-400" }
              ].map((stat, idx) => (
                <div key={idx} className="group cursor-default">
                  <p className={`text-4xl font-bold text-white mb-1 group-hover:scale-110 transition-transform origin-left ${stat.color} drop-shadow-lg`}>{stat.value}</p>
                  <p className="text-xs font-bold text-neutral-500 group-hover:text-neutral-300 transition-colors uppercase tracking-widest">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            viewport={{ once: true }}
            style={{ y: yHero }}
            className="relative perspective-1000 hidden lg:block"
          >
            <motion.div
              variants={floating}
              animate="animate"
              className="relative z-20 flex justify-center items-center min-h-[600px]"
            >
              <AnimatePresence mode="wait">
                <motion.img
                  key={currentImageIndex}
                  src={heroImages[currentImageIndex]}
                  alt="Equipo Remali"
                  initial={{ opacity: 0, x: 50, scale: 0.9, filter: "blur(10px)" }}
                  animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -50, scale: 1.1, filter: "blur(10px)" }}
                  transition={{ duration: 0.8, ease: "easeInOut" }}
                  className="w-full max-w-[800px] h-auto object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)] will-change-transform"
                />
              </AnimatePresence>

              {/* Decorative elements behind image */}
              <motion.div 
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute -top-10 -right-10 w-64 h-64 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full blur-[80px] opacity-40 -z-10 mix-blend-screen" 
              />
              <motion.div 
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 4, repeat: Infinity, delay: 2 }}
                className="absolute -bottom-10 -left-10 w-64 h-64 bg-gradient-to-tr from-purple-500 to-pink-600 rounded-full blur-[80px] opacity-40 -z-10 mix-blend-screen" 
              />
            </motion.div>
          </motion.div>
        </div>
        
        {/* Scroll Indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ delay: 2, duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-neutral-500 pointer-events-none"
        >
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest opacity-50">Scroll</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>
          </div>
        </motion.div>
      </section>

      {/* Featured Collections */}
      <section className="px-4 py-32 relative z-10">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="max-w-7xl mx-auto"
        >
          <motion.div variants={fadeInUp} className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-bold text-white">Colecciones destacadas</h2>
              <p className="mt-2 text-neutral-400">Todo lo que necesitas para tu obra</p>
            </div>
            <Link to="/equipos" className="hidden sm:flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium transition-colors group">
              Ver todo
              <svg className="w-5 h-5 transform group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
            </Link>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Concreto",
                desc: "Mezcladoras, vibradores, cortadoras",
                color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
                hoverColor: "group-hover:bg-orange-500/20",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21V11l4-2 4 2v10" />
                  </svg>
                )
              },
              {
                title: "Construcción",
                desc: "Herramientas y equipos confiables",
                color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
                hoverColor: "group-hover:bg-blue-500/20",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                )
              },
              {
                title: "Ofertas",
                desc: "Descuentos y combos especiales",
                color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                hoverColor: "group-hover:bg-emerald-500/20",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                )
              }
            ].map((item, idx) => (
              <motion.div variants={fadeInUp} key={idx}>
                <Link to="/equipos" className="group block h-full p-8 rounded-[2rem] border border-white/5 bg-neutral-900/50 hover:bg-neutral-800 transition-all duration-500 relative overflow-hidden">
                  <div className={`absolute inset-0 opacity-0 ${item.hoverColor} transition-opacity duration-500`}></div>
                  
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500 rotate-12">
                    {item.icon}
                  </div>
                  
                  <div className={`w-16 h-16 rounded-2xl ${item.color} border flex items-center justify-center text-3xl mb-8 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500 shadow-lg`}>
                    {item.icon}
                  </div>
                  
                  <h3 className="text-2xl font-bold text-white mb-3 group-hover:translate-x-1 transition-transform">{item.title}</h3>
                  <p className="text-neutral-400 group-hover:text-neutral-300 transition-colors">{item.desc}</p>
                  
                  <div className="mt-8 flex items-center text-sm font-bold text-white/40 group-hover:text-white transition-colors">
                    Explorar
                    <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-2 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Promo Section */}
      <section className="pb-0 !mt-0 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="w-full bg-gradient-to-br from-neutral-900 to-neutral-800 grid md:grid-cols-2 shadow-2xl relative group"
        >
          {/* Efecto de brillo en hover */}
          <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
          
          <div className="p-12 md:p-24 lg:pl-32 flex flex-col justify-center items-start text-left space-y-8 relative z-10">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-semibold"
            >
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Calidad Profesional
            </motion.div>
            
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
              REMALI <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                Tu mejor opción
              </span>
            </h2>
            
            <p className="text-neutral-400 text-lg leading-relaxed max-w-lg font-medium">
              Maquinaria ligera para tu negocio.
              Equipos confiables y de alto rendimiento
              para construcción, mantenimiento y proyectos profesionales.
            </p>
            
            <Link to="/equipos" className="group/btn flex items-center gap-3 text-white font-semibold border-b-2 border-blue-500 pb-1 hover:text-blue-400 transition-colors">
              Explorar equipos
              <svg className="w-5 h-5 transform group-hover/btn:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
            </Link>
          </div>
          
          <div className="relative h-64 md:h-auto min-h-[400px] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-transparent to-transparent z-10 md:bg-gradient-to-l" />
            <motion.img
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.7 }}
              src="/images/maquinas.png"
              alt="Maquinaria ligera"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </motion.div>
      </section>

      {/* Why Choose Us */}
      <section className="relative pt-64 pb-32 overflow-hidden -mt-32 z-0">
        <div className="absolute inset-0 bg-neutral-900/50 -skew-y-3 transform origin-left scale-110"></div>
        <div className="relative max-w-7xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Por qué elegirnos</h2>
            <p className="text-neutral-400">Nos diferenciamos por la calidad de nuestro servicio y la confiabilidad de nuestros equipos.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                title: "Experiencia",
                desc: "Años atendiendo proyectos exigentes.",
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                    <circle cx="12" cy="8" r="7" />
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                  </svg>
                )
              },
              {
                title: "Procesos modernos",
                desc: "Compra y seguimiento transparente.",
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )
              },
              {
                title: "Soporte dedicado",
                desc: "Acompañamiento técnico especializado.",
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                )
              },
              {
                title: "Calidad garantizada",
                desc: "Equipos probados y certificados.",
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                )
              }
            ].map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="group relative p-8 rounded-3xl bg-neutral-900 border border-neutral-800 hover:border-blue-500/30 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="relative z-10">
                  <div className="mb-6 inline-flex p-3 rounded-2xl bg-neutral-800 group-hover:bg-blue-500/10 group-hover:scale-110 transition-all duration-500 ring-1 ring-white/5 group-hover:ring-blue-500/20">
                    {item.icon}
                  </div>
                  <h3 className="font-bold text-xl text-white mb-3 group-hover:text-blue-400 transition-colors">{item.title}</h3>
                  <p className="text-neutral-400 leading-relaxed group-hover:text-neutral-300 transition-colors">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="pb-10 px-4 pt-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-7xl mx-auto w-full bg-gradient-to-r from-blue-900/40 via-neutral-900 to-indigo-900/40 p-12 md:p-24 text-center relative overflow-hidden shadow-2xl rounded-[3rem] border border-white/10"
        >
          <motion.div 
            animate={{ 
              backgroundPosition: ["0px 0px", "100px 100px"],
            }}
            transition={{ 
              duration: 3, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-30 mix-blend-color-dodge" 
          />
          
          {/* Animated Background Blobs */}
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 8, repeat: Infinity }}
            className="absolute -top-24 -left-24 w-96 h-96 bg-blue-600 rounded-full blur-[100px] opacity-30" 
          />
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 8, repeat: Infinity, delay: 4 }}
            className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-600 rounded-full blur-[100px] opacity-30" 
          />

          <div className="relative z-10 max-w-4xl mx-auto">
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-8 tracking-tight">
              ¿Listo para empezar tu proyecto?
            </h2>
            <p className="text-blue-100/80 text-xl mb-12 max-w-2xl mx-auto leading-relaxed">
              Contáctanos hoy mismo y recibe asesoría personalizada para elegir el equipo ideal para tus necesidades.
            </p>
            <div className="flex flex-wrap justify-center gap-6">
              <Link to="/cotizacion" className="px-10 py-5 rounded-full bg-white text-neutral-900 font-bold hover:bg-blue-50 transition-all hover:scale-105 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                Solicitar cotización
              </Link>
              <Link to="/equipos" className="px-10 py-5 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm text-white font-bold hover:bg-white/10 transition-all hover:scale-105 hover:border-white/40">
                Ver catálogo completo
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  )
}