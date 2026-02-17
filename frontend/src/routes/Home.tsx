import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Carousel from '../components/Carousel'

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } }
}

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
}

export default function Home() {
  return (
    <div className="space-y-24 pb-20 overflow-hidden">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-white dark:bg-neutral-900 shadow-xl border border-neutral-200 dark:border-neutral-800">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px] animate-pulse" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-[100px] animate-pulse delay-1000" />
        
        <div className="relative z-10 p-8 md:p-16 grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={staggerContainer}
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Lanzamiento 2026 • Alquiler y venta</span>
            </motion.div>
            
            <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl font-bold tracking-tight text-neutral-900 dark:text-white leading-[1.1]">
              Equipos de <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">construcción</span> de alto desempeño
            </motion.h1>
            
            <motion.p variants={fadeInUp} className="mt-6 text-lg md:text-xl text-neutral-600 dark:text-neutral-300 max-w-lg leading-relaxed">
              Compactadores, cortadoras y demoledores listos para obra. Atención rápida y soporte experto para tus proyectos más exigentes.
            </motion.p>
            
            <motion.div variants={fadeInUp} className="mt-10 flex flex-wrap gap-4">
              <Link to="/equipos" className="group relative px-8 py-4 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold shadow-lg shadow-neutral-900/20 hover:shadow-xl hover:shadow-neutral-900/30 transition-all hover:-translate-y-1">
                Ver catálogo
                <span className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all" />
              </Link>
              <Link to="/cotizacion" className="px-8 py-4 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all hover:-translate-y-1">
                Solicitar cotización
              </Link>
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
              {[
                { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", text: "Entrega el mismo día*" },
                { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", text: "Garantía total" },
                { icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z", text: "Soporte técnico 24/7" }
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 text-neutral-600 dark:text-neutral-400">
                  <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </div>
                  <span className="font-medium">{item.text}</span>
                </div>
              ))}
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-10 pt-10 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-3 gap-8">
              {[
                { value: "+150", label: "Proyectos" },
                { value: "24h", label: "Respuesta" },
                { value: "+30", label: "Equipos" }
              ].map((stat, idx) => (
                <div key={idx}>
                  <p className="text-3xl font-bold text-neutral-900 dark:text-white">{stat.value}</p>
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-3xl blur-2xl -z-10" />
            <Carousel
              className="shadow-2xl shadow-neutral-200/50 dark:shadow-black/50 aspect-[4/3] object-cover rounded-3xl border border-white/20"
              items={[
                { image: '/images/remali-1.jpg', title: 'Remali tu mejor Opcion', subtitle: 'Potencia y estabilidad para suelos' , ctaText: 'Ver compactadores', ctaLink: '/equipos' },
                { image: '/images/remali-2.jpg', title: 'Cortadora de piso', subtitle: 'Cortes limpios y precisos' },
                { image: '/images/remali-3.jpg', title: 'Demoledor eléctrico', subtitle: 'Demoliciones controladas' },
              ]}
              autoPlayMs={5000}
              showDots
            />
          </motion.div>
        </div>
      </section>

      {/* Featured Collections */}
      <section className="px-4">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={staggerContainer}
          className="max-w-7xl mx-auto"
        >
          <motion.div variants={fadeInUp} className="flex justify-between items-end mb-10">
            <div>
              <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">Colecciones destacadas</h2>
              <p className="mt-2 text-neutral-600 dark:text-neutral-400">Todo lo que necesitas para tu obra</p>
            </div>
            <Link to="/equipos" className="hidden sm:flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors">
              Ver todo
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7l7 7-7 7"/></svg>
            </Link>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { 
                title: "Concreto", 
                desc: "Mezcladoras, vibradores, cortadoras", 
                color: "bg-orange-50 dark:bg-orange-900/10 text-orange-600 dark:text-orange-400", 
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21V11l4-2 4 2v10" />
                  </svg>
                )
              },
              { 
                title: "Construcción", 
                desc: "Herramientas y equipos confiables", 
                color: "bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400", 
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                )
              },
              { 
                title: "Ofertas", 
                desc: "Descuentos y combos especiales", 
                color: "bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400", 
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                )
              }
            ].map((item, idx) => (
              <motion.div variants={fadeInUp} key={idx}>
                <Link to="/equipos" className="group block h-full p-8 rounded-3xl border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:shadow-xl hover:shadow-neutral-200/50 dark:hover:shadow-black/50 transition-all duration-300 hover:-translate-y-1">
                  <div className={`w-14 h-14 rounded-2xl ${item.color} flex items-center justify-center text-2xl mb-6 group-hover:scale-110 transition-transform duration-300`}>
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                  <p className="text-neutral-600 dark:text-neutral-400">{item.desc}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Why Choose Us */}
      <section className="py-20 bg-neutral-50 dark:bg-neutral-900/50 rounded-[3rem]">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">Por qué elegirnos</h2>
            <p className="text-neutral-600 dark:text-neutral-400">Nos diferenciamos por la calidad de nuestro servicio y la confiabilidad de nuestros equipos.</p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { 
                title: "Experiencia", 
                desc: "Años atendiendo proyectos exigentes.", 
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400">
                    <circle cx="12" cy="8" r="7" />
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                  </svg>
                )
              },
              { 
                title: "Procesos modernos", 
                desc: "Compra y seguimiento transparente.", 
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600 dark:text-purple-400">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )
              },
              { 
                title: "Soporte dedicado", 
                desc: "Acompañamiento técnico especializado.", 
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                )
              },
              { 
                title: "Calidad garantizada", 
                desc: "Equipos probados y certificados.", 
                icon: (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600 dark:text-orange-400">
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
                className="bg-white dark:bg-neutral-800 p-8 rounded-3xl shadow-sm border border-neutral-100 dark:border-neutral-700 hover:shadow-lg transition-all"
              >
                <div className="mb-6">{item.icon}</div>
                <h3 className="font-bold text-lg text-neutral-900 dark:text-white mb-2">{item.title}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Equipment in Action */}
      <section className="px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="mb-10"
          >
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">Equipos en acción</h2>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="rounded-[2.5rem] overflow-hidden shadow-2xl"
          >
            <Carousel
              items={[
                { image: '/images/inicio-compactador-2.jpg', title: 'Obra urbana', subtitle: 'Compactación eficiente en campo' },
                { image: '/images/inicio-cortadora-2.jpg', title: 'Taller y mantenimiento', subtitle: 'Corte de pavimento y concreto' },
                { image: '/images/inicio-compactador-3.jpg', title: 'Construcción residencial', subtitle: 'Equipos confiables y potentes' },
              ]}
              autoPlayMs={4500}
              showDots
            />
          </motion.div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="px-4 pb-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto bg-neutral-900 dark:bg-white rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" />
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500 rounded-full blur-[80px] opacity-40" />
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-purple-500 rounded-full blur-[80px] opacity-40" />
          
          <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl font-bold text-white dark:text-neutral-900 mb-6">
              ¿Listo para empezar tu proyecto?
            </h2>
            <p className="text-neutral-300 dark:text-neutral-600 text-lg mb-10 max-w-2xl mx-auto">
              Contáctanos hoy mismo y recibe asesoría personalizada para elegir el equipo ideal.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link to="/cotizacion" className="px-8 py-4 rounded-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-bold hover:bg-neutral-100 transition-transform hover:scale-105">
                Solicitar cotización
              </Link>
              <Link to="/equipos" className="px-8 py-4 rounded-full border border-neutral-700 dark:border-neutral-200 text-white dark:text-neutral-900 font-bold hover:bg-white/10 dark:hover:bg-neutral-100/10 transition-transform hover:scale-105">
                Ver catálogo completo
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
